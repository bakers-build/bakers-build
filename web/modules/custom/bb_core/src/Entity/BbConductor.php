<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\bb_core\Form\BbContentEntityDeleteForm;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\EntityPermissionProvider;
use Drupal\bb_core\Access\BbConductorAccessControlHandler;
use Drupal\bb_core\Access\BbOwnerGrantQueryAccessHandler;
use Drupal\bb_core\Form\BbConductorActionForm;
use Drupal\bb_core\Form\BbEntityDetailCardForm;
use Drupal\bb_core\ListBuilder\BbConductorListBuilder;
use Drupal\bb_core\Routing\BbConductorRouteProvider;
use Drupal\bb_core\ViewsData\BbConductorViewsData;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\user\EntityOwnerInterface;
use Drupal\user\EntityOwnerTrait;

/**
 * Represents a bakers.build conductor — an agent execution environment.
 *
 * A conductor registers itself per project with a unique conductor_id and the
 * workflow states it handles, and exposes an optional HTTP endpoint URL so
 * the server can push work to it. Status and lease timestamps are managed
 * by the claim API. Concurrent-run capacity lives on the linked bb_machine,
 * not on this entity.
 */
#[ContentEntityType(
  id: 'bb_conductor',
  label: new TranslatableMarkup('bakers.build conductor'),
  label_collection: new TranslatableMarkup('bakers.build conductors'),
  label_singular: new TranslatableMarkup('bakers.build conductor'),
  label_plural: new TranslatableMarkup('bakers.build conductors'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'label' => 'label', 'owner' => 'owner_user_id'],
  handlers: [
    'access' => BbConductorAccessControlHandler::class,
    // Narrowed to the account's OG read scope by
    // WorkspaceReadScopeSubscriber.
    'query_access' => BbOwnerGrantQueryAccessHandler::class,
    'permission_provider' => EntityPermissionProvider::class,
    'list_builder' => BbConductorListBuilder::class,
    'form' => [
      'delete' => BbContentEntityDeleteForm::class,
      // The Overview's card and its Disable/Enable confirmation.
      'identity' => BbEntityDetailCardForm::class,
      'action' => BbConductorActionForm::class,
    ],
    // Views integration is declared HERE rather than attached by a hook. It
    // came from bb_dashboard's hook_entity_type_alter(), which was a detour:
    // the module that owns the entity is the module that declares its
    // handlers.
    'views_data' => BbConductorViewsData::class,
    // The canonical route pins the `full` entity view whose Display Builder
    // tree composes the Overview and its card.
    'route_provider' => ['html' => BbConductorRouteProvider::class],
    // Tabs are declared statically in bb_core.links.task.yml, so no
    // `local_task_provider` handler is registered. The default one would
    // synthesise a View/Edit tab row from the `edit-form` link.
  ],
  // `_workspace` is an INTERNAL prefix that never appears in a URL: the public
  // address is /{workspace}/…, which Drupal's router cannot match directly.
  // BbWorkspacePathProcessor bridges the two forms in both directions.
  links: [
    'canonical' => '/_workspace/{bb_workspace}/conductor/{bb_conductor}',
    'delete-form' => '/_workspace/{bb_workspace}/conductor/{bb_conductor}/delete',
  ],
  admin_permission: 'administer bakers',
  base_table: 'bb_conductor',
)]
final class BbConductor extends BbContentEntityBase implements BbConductorInterface, EntityOwnerInterface {

  // The owner_user_id field is defined below with its own label and the
  // BbConductorOwner constraint, so ownerBaseFieldDefinitions() is
  // deliberately not called — it would overwrite both.
  use EntityOwnerTrait;
  use BbBaseFieldsTrait;

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);
    // Registration key, derived by the CLI as <machine_id>-<project>-<variant>;
    // one owner per id.
    // Not `machine_id`, which would collide with the host concept
    // (bb_machine.host_key / MachineContext.machine_id).
    $fields['conductor_id'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Conductor ID'))
      ->setRequired(TRUE)
      ->addConstraint('UniqueField')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 0]);
    $fields['label'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Label'))
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 1]);
    // Anonymous, i.e. "no owner": core marks the column of an `owner` entity
    // key NOT NULL; who may create a conductor and with which owner stays
    // governed by BbConductorOwner.
    $fields['owner_user_id'] = static::anonymousOwnerBaseFieldDefinition(2)
      ->addConstraint('BbConductorOwner');
    $fields['active'] = BaseFieldDefinition::create('boolean')
      ->setLabel(new TranslatableMarkup('Active'))
      ->setDescription(new TranslatableMarkup('Inactive conductors cannot be assigned and claim no work.'))
      ->setDefaultValue(TRUE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('form', ['type' => 'boolean_checkbox', 'weight' => 3]);
    $fields['status'] = BaseFieldDefinition::create('list_string')
      ->setLabel(new TranslatableMarkup('Status'))
      ->setSetting('allowed_values', [
        'online' => 'Online',
        'offline' => 'Offline',
      ])
      ->setDefaultValue('offline')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'options_select', 'weight' => 4]);
    // Registration always sets it; a deleted project leaves it empty.
    $fields['project_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Project'))
      ->setSetting('target_type', 'bb_project')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete', 'weight' => 5]);
    $fields['states'] = BaseFieldDefinition::create('list_string')
      ->setLabel(new TranslatableMarkup('States'))
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      ->setSetting('allowed_values_function', TypeWorkflows::class . '::stateOptions')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'options_select', 'weight' => 6]);
    // Host capacity entity; registration always sets it.
    $fields['machine'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Machine'))
      ->setSetting('target_type', 'bb_machine')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', [
        'type' => 'entity_reference_autocomplete',
        'weight' => 7,
      ]);
    $fields['workspace_root'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Workspace root'))
      ->setSetting('max_length', 2048)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 9]);
    // Operational telemetry for machine load aggregation.
    // Not capacity: max_parallel/current_load live on bb_machine. Each
    // heartbeat stores this conductor's contribution so the machine can sum
    // reported_load of online conductors.
    $fields['reported_load'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('Reported load'))
      ->setDescription(new TranslatableMarkup('This conductor process load last reported on heartbeat; aggregated into machine.current_load.'))
      ->setDefaultValue(0)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'number', 'weight' => 11]);
    $fields['last_seen'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Last seen'))
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'datetime_timestamp', 'weight' => 13]);
    $fields['lease_expires_at'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Lease expires at'))
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'datetime_timestamp', 'weight' => 14]);
    // Reported by the conductor process about itself, never discovered by the
    // server: the serve loop knows its own pid and which config file it was
    // started from, so both ride the registration payload it already sends.
    // Together they let a cockpit stop a conductor it did not start — the pid
    // says which process to signal, the name says which config of the
    // workspace it belongs to when a repo holds several.
    //
    // last_pid is machine-local data in a user-scoped entity. That is sound
    // only because a conductor_id identifies one conductor on one machine; a
    // pid read from another machine's row means nothing here, which is why
    // the UI only acts on rows whose workspace_root exists locally.
    $fields['last_pid'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('Last PID'))
      ->setDescription(new TranslatableMarkup('The process id last reported by the conductor serve loop. The last known pid — never a liveness signal.'))
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'number', 'weight' => 15]);
    $fields['conductor_name'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Conductor name'))
      ->setDescription(new TranslatableMarkup('The config file stem the conductor was started from, as accepted by --conductor.'))
      ->setSetting('max_length', 255)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 16]);
    return $fields;
  }

  /**
   * {@inheritdoc}
   */
  public function getConductorId(): string {
    return (string) $this->get('conductor_id')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function setConductorId(string $conductor_id): static {
    $this->set('conductor_id', $conductor_id);
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function getStatus(): string {
    return (string) $this->get('status')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function setStatus(string $status): static {
    $this->set('status', $status);
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function getStates(): array {
    return array_values(array_filter(array_map(
      static fn (array $item): string => (string) ($item['value'] ?? ''),
      $this->get('states')->getValue(),
    )));
  }

  /**
   * {@inheritdoc}
   */
  public function getMachine(): ?BbMachineInterface {
    $entity = $this->get('machine')->entity;
    return $entity instanceof BbMachineInterface ? $entity : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function isOwnedBy(AccountInterface $account): bool {
    $owner_id = $this->get('owner_user_id')->target_id;
    return is_numeric($owner_id) && (int) $owner_id > 0 && (int) $owner_id === (int) $account->id();
  }

}
