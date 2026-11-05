<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\bb_core\Form\BbContentEntityDeleteForm;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityListBuilder;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\BundlePlugin\BundlePluginHandler;
use Drupal\entity\EntityPermissionProvider;
use Drupal\bb_core\Entity\BbContentEntityBase;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_ticket_trigger\Access\BbTicketTriggerAccessControlHandler;
use Drupal\bb_ticket_trigger\Access\BbTicketTriggerQueryAccessHandler;
use Drupal\bb_ticket_trigger\Form\BbTicketTriggerForm;
use Drupal\bb_ticket_trigger\Form\TicketTriggerToggleForm;
use Drupal\bb_ticket_trigger\Routing\BbTicketTriggerRouteProvider;
use Drupal\bb_ticket_trigger\TicketTrigger\BbTicketTriggerTypeInterface;
use Drupal\bb_ticket_trigger\TicketTrigger\BbTicketTriggerTargetInterface;
use Drupal\plugin\Plugin\Field\FieldType\PluginCollectionItemInterface;
use Drupal\user\UserInterface;
use Drupal\bb_ticket_trigger\BbTicketTriggerViewsData;
use Symfony\Component\Validator\Context\ExecutionContextInterface;

/**
 * Represents a trigger that acts on its target when its type fires.
 *
 * Each bundle is a target plugin (`template`: create a ticket from a
 * template). Every trigger is anchored on its own `workspace_id`, which must
 * be its target's. Internal: managed on the template's Triggers tab only, not
 * through JSON:API. Several triggers per target are allowed.
 */
#[ContentEntityType(
  id: 'bb_ticket_trigger',
  label: new TranslatableMarkup('bakers.build ticket trigger'),
  label_collection: new TranslatableMarkup('bakers.build ticket triggers'),
  label_singular: new TranslatableMarkup('bakers.build ticket trigger'),
  label_plural: new TranslatableMarkup('bakers.build ticket triggers'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'bundle' => 'bundle'],
  bundle_label: new TranslatableMarkup('Target'),
  handlers: [
    'bundle_plugin' => BundlePluginHandler::class,
    'access' => BbTicketTriggerAccessControlHandler::class,
    'query_access' => BbTicketTriggerQueryAccessHandler::class,
    'permission_provider' => EntityPermissionProvider::class,
    'views_data' => BbTicketTriggerViewsData::class,
    'list_builder' => EntityListBuilder::class,
    'form' => [
      'default' => BbTicketTriggerForm::class,
      'add' => BbTicketTriggerForm::class,
      'edit' => BbTicketTriggerForm::class,
      'delete' => BbContentEntityDeleteForm::class,
      'toggle' => TicketTriggerToggleForm::class,
    ],
    'route_provider' => ['html' => BbTicketTriggerRouteProvider::class],
  ],
  links: [
    'add-form' => '/_workspace/{bb_workspace}/ticket-template/{bb_ticket_template}/trigger/add',
    'edit-form' => '/_workspace/{bb_workspace}/ticket-template/{bb_ticket_template}/trigger/{bb_ticket_trigger}/edit',
    'delete-form' => '/_workspace/{bb_workspace}/ticket-template/{bb_ticket_template}/trigger/{bb_ticket_trigger}/delete',
  ],
  admin_permission: 'administer bakers',
  base_table: 'bb_ticket_trigger',
  // The runner's reload under the row lock must read storage, not a cache.
  persistent_cache: FALSE,
  internal: TRUE,
  constraints: [
    'Callback' => ['callback' => [self::class, 'validateImmutable']],
    'BbTicketTriggerActivation' => [],
    'BbTicketTriggerTargetWorkspace' => [],
  ],
  additional: ['bundle_plugin_type' => 'bb_ticket_trigger_target'],
)]
final class BbTicketTrigger extends BbContentEntityBase implements BbTicketTriggerInterface {

  /**
   * Set while recordOutcome() saves, so preSave() keeps the runner's values.
   */
  private bool $recordingOutcome = FALSE;

  /**
   * Rejects a changed workspace, target or type plugin on a saved trigger.
   *
   * Moving a trigger to another target would re-point its execution
   * identity's tenancy; changing its type would reinterpret its replay key.
   */
  public static function validateImmutable(mixed $trigger, ExecutionContextInterface $context): void {
    if (!$trigger instanceof self || $trigger->isNew()) {
      return;
    }
    $stored = \Drupal::entityTypeManager()->getStorage('bb_ticket_trigger')->loadUnchanged($trigger->id());
    if (!$stored instanceof self) {
      return;
    }
    // Another bundle has another target field; compare nothing further.
    if ($stored->bundle() !== $trigger->get('bundle')->value) {
      $context->buildViolation('The target of a trigger cannot be changed.')->atPath('bundle')->addViolation();
      return;
    }
    if ((int) $stored->get('workspace_id')->target_id !== (int) $trigger->get('workspace_id')->target_id) {
      $context->buildViolation('The workspace of a trigger cannot be changed.')->atPath('workspace_id')->addViolation();
    }
    $field = $trigger->getTargetPlugin()->targetField();
    if ((int) $stored->get($field)->target_id !== (int) $trigger->get($field)->target_id) {
      $context->buildViolation('The target of a trigger cannot be changed.')->atPath($field)->addViolation();
    }
    if ($stored->getType() !== $trigger->getType()) {
      $context->buildViolation('The type of a trigger cannot be changed.')->atPath('trigger_type')->addViolation();
    }
  }

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);
    // The tenancy anchor bb_core's fence, resolver and scope constraint
    // follow; the target's own reference is its bundle's field.
    $fields['workspace_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Workspace'))
      ->setRequired(TRUE)
      ->setSetting('target_type', 'bb_workspace');
    $fields['trigger_type'] = BaseFieldDefinition::create('plugin:bb_ticket_trigger_type')
      ->setLabel(new TranslatableMarkup('Trigger type'))
      ->setRequired(TRUE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'plugin_selector:plugin_select_list', 'weight' => 0]);
    $fields['actor_uid'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Service account'))
      ->setDescription(new TranslatableMarkup("The workspace service account that owns the tickets this trigger creates. Everything else, such as the conductor, comes from the template. The account needs the Contributor rank and a membership in the project's team."))
      ->setSetting('target_type', 'user')
      ->addConstraint('BbTicketTriggerActor')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'options_select', 'weight' => 1]);
    $fields['enabled'] = BaseFieldDefinition::create('boolean')
      ->setLabel(new TranslatableMarkup('Enabled'))
      ->setDescription(new TranslatableMarkup('Paused triggers do not run; resuming does not catch up on missed occurrences.'))
      ->setDefaultValue(FALSE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'boolean_checkbox', 'weight' => 2]);
    $fields['next_run'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Next run'));
    $fields['last_occurrence'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Last finished occurrence'));
    $fields['attempts'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('Failed attempts'))
      ->setDefaultValue(0);
    $fields['last_run'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Last run'));
    $fields['last_status'] = BaseFieldDefinition::create('list_string')
      ->setLabel(new TranslatableMarkup('Last outcome'))
      ->setSetting('allowed_values', [
        self::STATUS_SUCCESS => 'Success',
        self::STATUS_FAILED => 'Failed',
        self::STATUS_RETRYING => 'Retrying',
        self::STATUS_SKIPPED => 'Skipped',
        self::STATUS_UNAVAILABLE => 'Unavailable',
      ]);
    $fields['last_message'] = BaseFieldDefinition::create('string_long')
      ->setLabel(new TranslatableMarkup('Last message'));
    $fields['last_ticket_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Last ticket'))
      ->setSetting('target_type', 'bb_ticket');
    return $fields;
  }

  /**
   * {@inheritdoc}
   *
   * Enabling, or changing the type configuration of an enabled trigger,
   * recomputes `next_run` from now, so a resume never catches up on the pause.
   * Pausing clears it.
   */
  public function preSave(EntityStorageInterface $storage): void {
    parent::preSave($storage);
    if (!$this->isEnabled()) {
      $this->set('next_run', NULL);
      return;
    }
    if ($this->recordingOutcome) {
      return;
    }
    $original = $this->getOriginal();
    $unchanged = $original instanceof self
      && $original->isEnabled()
      && $original->get('trigger_type')->getValue() == $this->get('trigger_type')->getValue();
    if ($unchanged) {
      return;
    }
    $now = new \DateTimeImmutable('@' . \Drupal::time()->getCurrentTime());
    $this->set('next_run', $this->getTypePlugin()->nextOccurrence($now)?->getTimestamp());
    $this->set('attempts', 0);
  }

  /**
   * {@inheritdoc}
   */
  public function label(): string {
    return $this->getTypePlugin()->summary();
  }

  /**
   * {@inheritdoc}
   */
  protected function urlRouteParameters($rel) {
    $parameters = parent::urlRouteParameters($rel);
    $template = $this->getEntityType()->getLinkTemplate($rel);
    if (is_string($template) && str_contains($template, '{bb_ticket_template}') && $this->hasField('template_id')) {
      $parameters['bb_ticket_template'] = $this->get('template_id')->target_id;
    }
    return $parameters;
  }

  /**
   * {@inheritdoc}
   */
  public function getTarget(): ?EntityInterface {
    return $this->getTargetPlugin()->getTarget($this);
  }

  /**
   * {@inheritdoc}
   */
  public function getTargetPlugin(): BbTicketTriggerTargetInterface {
    $target = \Drupal::service('plugin.manager.bb_ticket_trigger_target')->createInstance($this->bundle());
    assert($target instanceof BbTicketTriggerTargetInterface);
    return $target;
  }

  /**
   * {@inheritdoc}
   */
  public function getWorkspace(): ?BbWorkspaceInterface {
    $workspace = $this->get('workspace_id')->entity;
    return $workspace instanceof BbWorkspaceInterface ? $workspace : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getType(): string {
    return (string) $this->get('trigger_type')->plugin_id;
  }

  /**
   * {@inheritdoc}
   */
  public function getTypePlugin(): BbTicketTriggerTypeInterface {
    $item = $this->get('trigger_type')->first();
    $plugin = $item instanceof PluginCollectionItemInterface ? $item->getContainedPluginInstance() : NULL;
    if ($plugin instanceof BbTicketTriggerTypeInterface) {
      return $plugin;
    }
    $manager = \Drupal::service('plugin.manager.bb_ticket_trigger_type');
    return $manager->createInstance($this->getType());
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
  public function getActor(): ?UserInterface {
    $actor = $this->get('actor_uid')->entity;
    return $actor instanceof UserInterface ? $actor : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getNextRun(): ?int {
    return $this->intOrNull('next_run');
  }

  /**
   * {@inheritdoc}
   */
  public function getLastOccurrence(): ?int {
    return $this->intOrNull('last_occurrence');
  }

  /**
   * {@inheritdoc}
   */
  public function getAttempts(): int {
    return (int) $this->get('attempts')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function getLastStatus(): string {
    return (string) $this->get('last_status')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function recordOutcome(string $status, string $message, ?int $occurrence, ?BbTicketInterface $ticket, ?int $nextRun, int $attempts): void {
    $this->set('last_status', $status);
    $this->set('last_message', $message);
    $this->set('last_run', \Drupal::time()->getCurrentTime());
    if ($occurrence !== NULL) {
      $this->set('last_occurrence', $occurrence);
    }
    if ($ticket !== NULL) {
      $this->set('last_ticket_id', $ticket->id());
    }
    $this->set('next_run', $nextRun);
    $this->set('attempts', $attempts);
    $this->recordingOutcome = TRUE;
    try {
      $this->save();
    }
    finally {
      $this->recordingOutcome = FALSE;
    }
  }

  /**
   * A nullable integer field value.
   */
  private function intOrNull(string $field): ?int {
    $value = $this->get($field)->value;
    return $value === NULL || $value === '' ? NULL : (int) $value;
  }

}
