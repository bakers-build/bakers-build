<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\bb_core\Access\BbInviteQueryAccessHandler;
use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Form\BbContentEntityDeleteForm;
use Drupal\entity\EntityAccessControlHandler;
use Drupal\entity\EntityPermissionProvider;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Drupal\bb_core\Workspace\WorkspaceProvisioner;
use Drupal\user\EntityOwnerInterface;
use Drupal\user\EntityOwnerTrait;

/**
 * A workspace's standing offer to one e-mail address.
 *
 * Records an address before any account for it exists, which `user` cannot.
 * An invitation is consumed by deletion, so its existence is its pending
 * state: no status or expiry column to disagree with the membership table.
 * `owner_user_id` records the inviter but is deliberately not the `owner`
 * key: the workspace, via query access, decides who may see an invitation.
 */
#[ContentEntityType(
  id: 'bb_invite',
  label: new TranslatableMarkup('bakers.build invitation'),
  label_collection: new TranslatableMarkup('bakers.build invitations'),
  label_singular: new TranslatableMarkup('bakers.build invitation'),
  label_plural: new TranslatableMarkup('bakers.build invitations'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'label' => 'email'],
  handlers: [
    'access' => EntityAccessControlHandler::class,
    // Narrowed by WorkspaceReadScopeSubscriber to the workspaces whose rank
    // grants `view bb_invite`. Without it every account holding the
    // permission anywhere would read every workspace's invitations, which is
    // a list of who is being recruited.
    'query_access' => BbInviteQueryAccessHandler::class,
    'permission_provider' => EntityPermissionProvider::class,
    'form' => ['delete' => BbContentEntityDeleteForm::class],
    'route_provider' => ['html' => AdminHtmlRouteProvider::class],
  ],
  // Only the revoke confirm form: an invitation has no canonical page;
  // member screens list it and `bb_core.workspace_join` addresses it by id.
  links: [
    'delete-form' => '/_workspace/{bb_workspace}/invite/{bb_invite}/delete',
  ],
  base_table: 'bb_invite',
  admin_permission: 'administer bakers',
  constraints: ['BbInviteAssignment' => []],
)]
final class BbInvite extends BbContentEntityBase implements EntityOwnerInterface {

  use EntityOwnerTrait;
  use BbBaseFieldsTrait;

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);

    $fields['workspace_id'] = static::workspaceBaseFieldDefinition(0)
      ->setDescription(new TranslatableMarkup('The workspace this invitation admits somebody to.'))
      // The same workspace edge and constraint `bb_team` and `bb_group`
      // carry, gating a form and a JSON:API write alike — so a lead cannot
      // POST an invitation into a workspace outside their own scope.
      ->addConstraint('BbWorkspaceScope');

    $fields['email'] = BaseFieldDefinition::create('email')
      ->setLabel(new TranslatableMarkup('E-mail address'))
      ->setDescription(new TranslatableMarkup('The address invited. Matched case-insensitively against a signing-in account’s mail.'))
      ->setRequired(TRUE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'email_default', 'weight' => 1]);

    // THE GRANT. Both optional: an empty role is the member role and an empty
    // team is none, which is also what an invitation created before these
    // fields existed carries. Stored as ids, never labels.
    $fields['workspace_role'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Workspace role'))
      ->setDescription(new TranslatableMarkup('The workspace role accepting grants. Empty grants the member role.'))
      ->setSetting('target_type', 'og_role');

    $fields['team_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Team'))
      ->setDescription(new TranslatableMarkup('The team of this workspace accepting joins. Empty joins none.'))
      ->setSetting('target_type', 'bb_team');

    // WHO INVITED, for a member screen to show. Not an entity key: see the
    // class docblock.
    $fields['owner_user_id'] = static::ownerBaseFieldDefinition(95, new TranslatableMarkup('Invited by'));

    // Replaces the base `created`: view-configurable with no form widget.
    $fields['created'] = BaseFieldDefinition::create('created')
      ->setLabel(new TranslatableMarkup('Created'))
      ->setDisplayConfigurable('view', TRUE);

    return $fields;
  }

  /**
   * The invited address, as recorded.
   *
   * @return string
   *   The address.
   */
  public function getEmail(): string {
    return (string) $this->get('email')->value;
  }

  /**
   * The workspace this invitation admits somebody to.
   *
   * @return \Drupal\bb_core\Entity\BbWorkspaceInterface|null
   *   The workspace, or NULL when the reference no longer resolves.
   */
  public function getWorkspace(): ?BbWorkspaceInterface {
    $workspace = $this->get('workspace_id')->entity;
    return $workspace instanceof BbWorkspaceInterface ? $workspace : NULL;
  }

  /**
   * The workspace role id accepting grants.
   *
   * @return string
   *   The stored `og_role` id, or the member role when none is stored.
   */
  public function getRoleId(): string {
    $id = (string) $this->get('workspace_role')->target_id;
    return $id !== '' ? $id : WorkspaceProvisioner::WORKSPACE_MEMBER_ROLE;
  }

  /**
   * The team id accepting joins, if any.
   *
   * @return int|null
   *   The stored team id, which may no longer resolve, or NULL.
   */
  public function getTeamId(): ?int {
    $id = $this->get('team_id')->target_id;
    return $id !== NULL && $id !== '' ? (int) $id : NULL;
  }

  /**
   * Whether this invitation is addressed to a given address.
   *
   * CASE-INSENSITIVE, because an address is (D6, AC-5). `Pascal@Keytec.de` and
   * `pascal@keytec.de` are one mailbox, and a customer who capitalises their
   * own name when typing must not be handed the no-workspace state.
   *
   * @param string $mail
   *   The address to compare, typically the signing-in account's.
   *
   * @return bool
   *   TRUE when this invitation is for that address.
   */
  public function isFor(string $mail): bool {
    return mb_strtolower(trim($this->getEmail())) === mb_strtolower(trim($mail));
  }

}
