<?php

declare(strict_types=1);

namespace Drupal\bb_webhook\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbBaseFieldsTrait;
use Drupal\bb_core\Entity\BbContentEntityBase;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Routing\BbTicketTemplateRouteProvider;
use Drupal\bb_webhook\Access\BbWebhookAccessControlHandler;
use Drupal\bb_webhook\Access\BbWebhookQueryAccessHandler;
use Drupal\bb_webhook\Form\BbWebhookDeleteForm;
use Drupal\bb_webhook\Form\BbWebhookForm;
use Drupal\Core\Entity\EntityViewBuilder;
use Drupal\entity\EntityPermissionProvider;
use Drupal\views\EntityViewsData;
use Symfony\Component\Validator\Context\ExecutionContextInterface;

/**
 * A webhook of one project, group or workspace.
 */
#[ContentEntityType(
  id: 'bb_webhook',
  label: new TranslatableMarkup('bakers.build webhook'),
  label_collection: new TranslatableMarkup('bakers.build webhooks'),
  label_singular: new TranslatableMarkup('bakers.build webhook'),
  label_plural: new TranslatableMarkup('bakers.build webhooks'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'label' => 'name'],
  handlers: [
    'access' => BbWebhookAccessControlHandler::class,
    'query_access' => BbWebhookQueryAccessHandler::class,
    'permission_provider' => EntityPermissionProvider::class,
    'view_builder' => EntityViewBuilder::class,
    'views_data' => EntityViewsData::class,
    'form' => [
      'default' => BbWebhookForm::class,
      'add' => BbWebhookForm::class,
      'edit' => BbWebhookForm::class,
      'delete' => BbWebhookDeleteForm::class,
    ],
    // Its only job is titling the edit route "Settings", which fits here too.
    'route_provider' => ['html' => BbTicketTemplateRouteProvider::class],
  ],
  links: [
    // Added from the owning scope's Webhooks tab (bb_webhook.routing.yml).
    'canonical' => '/_workspace/{bb_workspace}/webhook/{bb_webhook}',
    'edit-form' => '/_workspace/{bb_workspace}/webhook/{bb_webhook}/settings',
    'delete-form' => '/_workspace/{bb_workspace}/webhook/{bb_webhook}/delete',
  ],
  admin_permission: 'administer bakers',
  internal: TRUE,
  base_table: 'bb_webhook',
  constraints: [
    'Callback' => ['callback' => [self::class, 'validateScope']],
  ],
  additional: [
    // Read by bb_core's workspace resolver and rank fence.
    'bb_workspace_path' => ['workspace_id'],
  ],
)]
final class BbWebhook extends BbContentEntityBase implements BbWebhookInterface {

  use BbBaseFieldsTrait;

  /**
   * The fields that make up the scope, immutable after the first save.
   */
  private const SCOPE_FIELDS = ['workspace_id', 'project_id', 'group_id'];

  /**
   * Enforces exactly one scope inside the webhook's own workspace, for life.
   */
  public static function validateScope(mixed $webhook, ExecutionContextInterface $context): void {
    if (!$webhook instanceof self) {
      return;
    }
    if (!$webhook->get('project_id')->isEmpty() && !$webhook->get('group_id')->isEmpty()) {
      $context->buildViolation('A webhook belongs to exactly one project, group or workspace.')
        ->atPath('group_id')
        ->addViolation();
    }
    $project = $webhook->get('project_id')->entity;
    $group = $webhook->get('group_id')->entity;
    $owners = [
      'project_id' => $project instanceof BbProjectInterface ? $project->getGroup()?->getWorkspace()?->id() : NULL,
      'group_id' => $group instanceof BbGroupInterface ? $group->getWorkspace()?->id() : NULL,
    ];
    foreach ($owners as $field => $owner) {
      if (!$webhook->get($field)->isEmpty() && (int) $owner !== (int) $webhook->get('workspace_id')->target_id) {
        $context->buildViolation("The project or group must belong to the webhook's workspace.")
          ->atPath($field)
          ->addViolation();
      }
    }
    if (!$webhook->isNew()) {
      self::validateImmutable($webhook, $context);
    }
  }

  /**
   * Rejects any change to the scope fields of a saved webhook.
   */
  private static function validateImmutable(self $webhook, ExecutionContextInterface $context): void {
    $stored = \Drupal::entityTypeManager()->getStorage('bb_webhook')->loadUnchanged($webhook->id());
    if (!$stored instanceof self) {
      return;
    }
    foreach (self::SCOPE_FIELDS as $field) {
      if ((int) $stored->get($field)->target_id !== (int) $webhook->get($field)->target_id) {
        $context->buildViolation('The scope of a webhook cannot be changed.')
          ->atPath($field)
          ->addViolation();
      }
    }
  }

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);
    $fields['name'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Name'))
      ->setRequired(TRUE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE);
    $fields['url'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('URL'))
      ->setDescription(new TranslatableMarkup('The HTTPS endpoint that receives the signed POST.'))
      ->setRequired(TRUE)
      ->setSetting('max_length', 2048)
      ->addPropertyConstraints('value', [
        'Regex' => ['pattern' => '#^https://#', 'message' => 'The URL must start with https://.'],
      ])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE);
    // Plain text: HMAC needs the raw key. Field access hides it everywhere.
    $fields['secret'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Secret'))
      ->setSetting('max_length', 64);
    $fields['enabled'] = BaseFieldDefinition::create('boolean')
      ->setLabel(new TranslatableMarkup('Enabled'))
      ->setDefaultValue(TRUE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE);
    // Scope fields are set from the route on add, never edited in a form.
    $fields['workspace_id'] = static::workspaceBaseFieldDefinition(NULL);
    $fields['project_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Project'))
      ->setSetting('target_type', 'bb_project')
      ->setDisplayConfigurable('view', TRUE);
    $fields['group_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Group'))
      ->setSetting('target_type', 'bb_group')
      ->setDisplayConfigurable('view', TRUE);
    $fields['owner_user_id'] = static::ownerBaseFieldDefinition();
    return $fields;
  }

  /**
   * {@inheritdoc}
   */
  public function preSave(EntityStorageInterface $storage): void {
    parent::preSave($storage);
    if ($this->get('secret')->isEmpty()) {
      $this->set('secret', bin2hex(random_bytes(32)));
    }
  }

  /**
   * {@inheritdoc}
   */
  public function getUrl(): string {
    return (string) $this->get('url')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function getSecret(): string {
    return (string) $this->get('secret')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function isEnabled(): bool {
    return (bool) $this->get('enabled')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function scope(): string {
    return match (TRUE) {
      !$this->get('project_id')->isEmpty() => 'project',
      !$this->get('group_id')->isEmpty() => 'group',
      default => 'workspace',
    };
  }

}
