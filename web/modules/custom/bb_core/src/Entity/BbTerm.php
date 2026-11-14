<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\bb_core\Form\BbContentEntityDeleteForm;
use Drupal\bb_core\Form\BbTermForm;
use Drupal\bb_core\Routing\BbTermRouteProvider;
use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\ContentEntityBase;
use Drupal\Core\Entity\EntityListBuilder;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\EntityAccessControlHandler;
use Drupal\entity\EntityPermissionProvider;
use Drupal\views\EntityViewsData;
use Drupal\user\EntityOwnerTrait;
use Drupal\entity\QueryAccess\QueryAccessHandler;
use Drupal\user\EntityOwnerInterface;

/**
 * Defines the bakers.build term entity — node-free taxonomy replacement.
 *
 * Bundled by bb_vocabulary (`type`, `recipe`, `label`). Flat (no hierarchy).
 * Used by the ticket's `ticket_type`, `recipe` and `labels` fields. Managed on
 * the workspace settings tabs: add, edit and delete forms, no page of its own.
 *
 * Stays on ContentEntityBase: it has no created/changed fields, and inheriting
 * them from BbContentEntityBase would change its schema and API.
 */
#[ContentEntityType(
  id: 'bb_term',
  label: new TranslatableMarkup('bakers.build term'),
  label_collection: new TranslatableMarkup('bakers.build terms'),
  label_singular: new TranslatableMarkup('bakers.build term'),
  label_plural: new TranslatableMarkup('bakers.build terms'),
  bundle_label: new TranslatableMarkup('bakers.build vocabulary'),
  bundle_entity_type: 'bb_vocabulary',
  entity_keys: [
    'id' => 'id',
    'uuid' => 'uuid',
    'bundle' => 'vid',
    'label' => 'name',
    'langcode' => 'langcode',
    'owner' => 'owner_user_id',
  ],
  handlers: [
    'access' => EntityAccessControlHandler::class,
    'query_access' => QueryAccessHandler::class,
    'permission_provider' => EntityPermissionProvider::class,
    'list_builder' => EntityListBuilder::class,
    'views_data' => EntityViewsData::class,
    'form' => [
      'add' => BbTermForm::class,
      'edit' => BbTermForm::class,
      'delete' => BbContentEntityDeleteForm::class,
    ],
    'route_provider' => ['html' => BbTermRouteProvider::class],
  ],
  links: [
    'add-form' => '/_workspace/{bb_workspace}/term/{bb_vocabulary}/add',
    'edit-form' => '/_workspace/{bb_workspace}/term/{bb_term}/edit',
    'delete-form' => '/_workspace/{bb_workspace}/term/{bb_term}/delete',
  ],
  base_table: 'bb_term',
  admin_permission: 'administer bakers',
)]
final class BbTerm extends ContentEntityBase implements BbTermInterface, EntityOwnerInterface {

  // The owner field is defined in ::baseFieldDefinitions() with its own
  // label and default, so ownerBaseFieldDefinitions() is deliberately not
  // called — it would overwrite both.
  use EntityOwnerTrait;
  use BbNameTrait;
  use BbBaseFieldsTrait;

  /**
   * {@inheritdoc}
   *
   * @return array<string, \Drupal\Core\Field\BaseFieldDefinition>
   *   The base field definitions.
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);

    $fields['name'] = static::nameBaseFieldDefinition(0)
      // Unique within (workspace_id, vid). On the name field rather than
      // entity-level so a form renders the message beside the input and a
      // JSON:API error document points at name.0.value; the validator still
      // reaches vid and workspace_id through getEntity().
      ->addConstraint('BbTermUniqueNameInWorkspace');

    $fields['key'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Key'))
      ->addConstraint('BbTermUniqueNameInWorkspace', ['message' => 'A term key %name already exists in this workspace and vocabulary.']);

    $fields['description'] = BaseFieldDefinition::create('string_long')
      ->setLabel(new TranslatableMarkup('Description'))
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textarea', 'weight' => 1]);

    $fields['weight'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('Weight'))
      ->setDefaultValue(0);

    // The tenancy root this term belongs to. A verbatim copy of
    // bb_group.workspace_id's shape: required as a validation constraint
    // rather than a NOT NULL column.
    //
    // BbWorkspaceScope is reused unchanged. The referenced value IS a
    // workspace, so the validator's identity short-circuit answers it without a
    // WorkspaceResolver::CHAINS entry, exactly as it does for bb_group and
    // bb_team. On the add form the workspace comes from the route, so its
    // ambient-match rule holds by construction.
    $fields['workspace_id'] = static::workspaceBaseFieldDefinition(NULL)
      ->addConstraint('BbWorkspaceScope');

    // The owning account. Declared as the entity type's `owner` key so the
    // stock query-access handler and entity_jsonapi_entity_filter_access() can
    // both reason about it. Access-inert under
    // EntityPermissionProvider, which binds `view` to `view <type>` and leaves
    // the owner to the `own` variants of update/delete that no role holds.
    //
    // The default-value callback is not cosmetic: core marks the column of an
    // `owner` entity key NOT NULL, so a row created without one would fail to
    // save. Unlike bb_run — where the owner comes from the conductor and must
    // never follow the session (R3) — the acting account is the right default
    // here.
    $fields['owner_user_id'] = static::ownerBaseFieldDefinition();

    return $fields;
  }

  /**
   * {@inheritdoc}
   */
  public function preSave(EntityStorageInterface $storage): void {
    parent::preSave($storage);
    if (!$this->get('key')->isEmpty()) {
      $this->set('key', mb_strtolower((string) $this->get('key')->value));
    }
    elseif ($this->isNew() && $this->bundle() === 'label') {
      $this->set('key', self::keyOf((string) $this->label()));
      // An unvalidated save of a clashing name keeps no key, never fails.
      if ($this->get('key')->validate()->count() > 0) {
        $this->set('key', NULL);
      }
    }
  }

  /**
   * The stable, lowercase label identity derived from a name.
   */
  public static function keyOf(string $name): string {
    return (string) preg_replace('/[^a-z0-9]+/', '_', mb_strtolower(trim($name)));
  }

  /**
   * {@inheritdoc}
   *
   * The form routes address the term's own workspace by its slug.
   */
  protected function urlRouteParameters($rel) {
    $parameters = parent::urlRouteParameters($rel);
    $workspace = $this->get('workspace_id')->entity;
    if ($workspace instanceof BbWorkspaceInterface) {
      $parameters['bb_workspace'] = $workspace->getSlug();
    }
    return $parameters;
  }

}
