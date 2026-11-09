<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\bb_core\Form\BbContentEntityDeleteForm;
use Drupal\Core\Entity\EntityPublishedTrait;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityViewBuilder;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\EntityPermissionProvider;
use Drupal\bb_core\Access\BbCommentAccessControlHandler;
use Drupal\bb_core\Access\BbCommentQueryAccessHandler;
use Drupal\bb_core\Form\BbContentEntityFormBase;
use Drupal\bb_core\ListBuilder\BbCommentListBuilder;
use Drupal\bb_core\Workflow\ReviewTransitionHandler;
use Drupal\bb_core\Routing\BbCommentRouteProvider;
use Drupal\user\EntityOwnerInterface;
use Drupal\user\EntityOwnerTrait;

/**
 * Represents a bakers.build comment entity.
 *
 * Comments are structured notes attached to a ticket with an explicit author
 * and a long-text body. They are listed and managed on their ticket.
 */
#[ContentEntityType(
  id: 'bb_comment',
  label: new TranslatableMarkup('bakers.build comment'),
  label_collection: new TranslatableMarkup('bakers.build comments'),
  label_singular: new TranslatableMarkup('bakers.build comment'),
  label_plural: new TranslatableMarkup('bakers.build comments'),
  bundle_label: new TranslatableMarkup('Comment type'),
  bundle_entity_type: 'bb_comment_type',
  entity_keys: [
    'id' => 'id',
    'uuid' => 'uuid',
    'bundle' => 'bundle',
    'owner' => 'author',
    'published' => 'status',
  ],
  handlers: [
    'access' => BbCommentAccessControlHandler::class,
    'view_builder' => EntityViewBuilder::class,
    // Narrowed to the account's OG read scope by
    // WorkspaceReadScopeSubscriber.
    'query_access' => BbCommentQueryAccessHandler::class,
    'permission_provider' => EntityPermissionProvider::class,
    'list_builder' => BbCommentListBuilder::class,
    'form' => [
      'default' => BbContentEntityFormBase::class,
      'add' => BbContentEntityFormBase::class,
      'edit' => BbContentEntityFormBase::class,
      'review' => \Drupal\bb_core\Form\BbReviewCommentForm::class,
      'delete' => BbContentEntityDeleteForm::class,
    ],
    'route_provider' => ['html' => BbCommentRouteProvider::class],
    // Tabs are declared statically in bb_core.links.task.yml. The default
    // provider would synthesise a View/Edit pair from edit-form.
  ],
  // `_workspace` is an INTERNAL prefix that never appears in a URL: the public
  // address is /{workspace}/…, which Drupal's router cannot match directly.
  // BbWorkspacePathProcessor bridges the two forms in both directions.
  links: [
    'canonical' => '/_workspace/{bb_workspace}/comment/{bb_comment}',
    'add-form' => '/_workspace/{bb_workspace}/comment/add',
    'edit-form' => '/_workspace/{bb_workspace}/comment/{bb_comment}/edit',
    'delete-form' => '/_workspace/{bb_workspace}/comment/{bb_comment}/delete',
  ],
  admin_permission: 'administer bakers',
  permission_granularity: 'entity_type',
  base_table: 'bb_comment',
  constraints: ['BbReviewComment' => []],
)]
final class BbComment extends BbContentEntityBase implements BbCommentInterface, EntityOwnerInterface {

  // The owner field is defined in ::baseFieldDefinitions() with its own
  // label and default, so ownerBaseFieldDefinitions() is deliberately not
  // called — it would overwrite both.
  use EntityOwnerTrait;
  use EntityPublishedTrait;

  /**
   * {@inheritdoc}
   */
  public static function preCreate(EntityStorageInterface $storage, array &$values): void {
    parent::preCreate($storage, $values);
    $values += ['bundle' => 'bb_comment'];
    if (($values['bundle'] ?? '') === 'review') {
      $values += [
        'status' => 0,
        'review_state' => 'draft',
      ];
    }
  }

  /**
   * {@inheritdoc}
   */
  public function preSave(EntityStorageInterface $storage): void {
    parent::preSave($storage);
    \Drupal::service(ReviewTransitionHandler::class)->prepareSave($this);
  }

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);
    $fields += static::publishedBaseFieldDefinitions($entity_type);
    $fields['ticket_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Ticket'))
      ->setRequired(TRUE)
      ->addConstraint('BbSessionScope')
      ->setSetting('target_type', 'bb_ticket')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete', 'weight' => 0]);
    $fields['author'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Author'))
      // Server-provided, not client-authored: the default-value callback fills
      // it with the current user, so a client never supplies it. Declaring it
      // required would put `author` in the authoritative JSON:API create schema
      // (jsonapi_schema derives `required` from isRequired()), making dropsh
      // reject an otherwise-valid comment create client-side for a missing,
      // server-owned field. Field access still gates who may set it explicitly.
      ->setSetting('target_type', 'user')
      ->setDefaultValueCallback(self::class . '::getCurrentUserId')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete', 'weight' => 1])
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('view', [
        'type' => 'entity_reference_label',
        'label' => 'inline',
        'weight' => 1,
        'settings' => ['link' => FALSE],
      ]);
    $fields['body'] = BaseFieldDefinition::create('text_long')
      ->setLabel(new TranslatableMarkup('Body'))
      ->setRequired(TRUE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'text_textarea', 'weight' => 2])
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('view', ['type' => 'text_default', 'label' => 'hidden', 'weight' => 3]);
    // Free text, deliberately not an enumeration. The comment vocabulary grows
    // with the workflow, and an enum turns every new handler-output kind into a
    // code change plus a deploy — until then the write 422s and the handoff a
    // later step is waiting for is lost. The conventional values below are
    // documented in docs/daily-work/follow-a-ticket.md; they are conventions
    // readers may match on, not values storage enforces.
    //
    // No max_length override: the `string` default of 255 is what keeps the
    // column identical to the one list_string created. The value is stored
    // verbatim — normalising it would silently rewrite what an agent wrote and
    // break the readers that select on an exact value.
    $fields['type'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Type'))
      ->setRequired(TRUE)
      ->setDefaultValue('comment')
      ->setDescription(new TranslatableMarkup('Free text. Conventional values: comment, qualification, spec, plan, debug_diagnose, summary, acceptance, scenario, test.'))
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 3])
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('view', ['type' => 'string', 'label' => 'inline', 'weight' => 0]);
    $fields['created']
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('view', ['type' => 'timestamp', 'label' => 'inline', 'weight' => 2]);
    $fields['review_state'] = BaseFieldDefinition::create('state')
      ->setLabel(new TranslatableMarkup('Review state'))
      ->setSetting('workflow', 'bb_review')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'state_machine_buttons', 'weight' => 4])
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('view', ['type' => 'list_default', 'label' => 'inline', 'weight' => 4]);
    $fields['submitted_at'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Submitted at'))
      ->setReadOnly(TRUE)
      ->setDisplayConfigurable('view', TRUE);
    $fields['decided_at'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Decided at'))
      ->setReadOnly(TRUE)
      ->setDisplayConfigurable('view', TRUE);
    $fields['decided_by'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Decided by'))
      ->setSetting('target_type', 'user')
      ->setReadOnly(TRUE)
      ->setDisplayConfigurable('view', TRUE);
    return $fields;
  }

  /**
   * {@inheritdoc}
   */
  public function getTicketId(): ?int {
    if ($this->get('ticket_id')->isEmpty()) {
      return NULL;
    }
    $value = $this->get('ticket_id')->target_id;
    return is_numeric($value) ? (int) $value : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getTicket(): ?BbTicketInterface {
    $entity = $this->get('ticket_id')->entity;
    return $entity instanceof BbTicketInterface ? $entity : NULL;
  }

  /**
   * {@inheritdoc}
   *
   * Canonical, edit and delete address the comment by UUID.
   */
  protected function urlRouteParameters($rel) {
    $parameters = parent::urlRouteParameters($rel);
    $template = $this->getEntityType()->getLinkTemplate($rel);
    if (!is_string($template) || !str_contains($template, '{bb_comment}')) {
      return $parameters;
    }
    $uuid = $this->uuid();
    if ($uuid !== '') {
      $parameters['bb_comment'] = $uuid;
    }
    return $parameters;
  }

  /**
   * Default value callback for the 'author' field.
   *
   * @return array<int, array<string, int>>
   *   The current user ID, used when no author is set explicitly.
   */
  public static function getCurrentUserId(): array {
    return [['target_id' => (int) \Drupal::currentUser()->id()]];
  }

}
