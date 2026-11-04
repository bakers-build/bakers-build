<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\bb_core\Form\BbContentEntityDeleteForm;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\EntityPermissionProvider;
use Drupal\entity\Menu\EntityCollectionLocalActionProvider;
use Drupal\bb_core\Access\BbMachineAccessControlHandler;
use Drupal\bb_core\Access\BbMachineQueryAccessHandler;
use Drupal\bb_core\Form\BbMachineForm;
use Drupal\bb_core\ListBuilder\BbMachineListBuilder;
use Drupal\bb_core\Routing\BbMachineRouteProvider;
use Drupal\user\EntityOwnerInterface;
use Drupal\user\EntityOwnerTrait;
use Drupal\views\EntityViewsData;
use Drupal\bb_core\Form\BbEntityDetailCardForm;

/**
 * Represents a bakers.build machine — host capacity for concurrent runs.
 *
 * Capacity (max_parallel / current_load) is owned by the host, not by each
 * per-project conductor. host_key is the machine-context stem; it is not the
 * composed conductor registration key.
 */
#[ContentEntityType(
  id: 'bb_machine',
  label: new TranslatableMarkup('bakers.build machine'),
  label_collection: new TranslatableMarkup('bakers.build machines'),
  label_singular: new TranslatableMarkup('bakers.build machine'),
  label_plural: new TranslatableMarkup('bakers.build machines'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'label' => 'name', 'owner' => 'owner_user_id'],
  handlers: [
    'access' => BbMachineAccessControlHandler::class,
    // Owner rows, plus site-wide view for agent identities. Machines are
    // account-owned and are not in the workspace read-scope set.
    'query_access' => BbMachineQueryAccessHandler::class,
    'permission_provider' => EntityPermissionProvider::class,
    'list_builder' => BbMachineListBuilder::class,
    // Views integration is declared HERE rather than attached by a hook.
    'views_data' => EntityViewsData::class,
    'form' => [
      'default' => BbMachineForm::class,
      'add' => BbMachineForm::class,
      'edit' => BbMachineForm::class,
      // Detail page cards, one Save each.
      'identity' => BbEntityDetailCardForm::class,
      'delete' => BbContentEntityDeleteForm::class,
    ],
    // The canonical route pins the `full` entity view whose Display Builder
    // tree composes the Overview and its cards. Add, edit, delete and the
    // collection stay admin routes.
    'route_provider' => ['html' => BbMachineRouteProvider::class],
    // Tabs are declared statically in bb_core.links.task.yml, so no
    // `local_task_provider` handler is registered. The default one would
    // synthesise a View/Edit tab row from the `edit-form` link.
    'local_action_provider' => ['collection' => EntityCollectionLocalActionProvider::class],
  ],
  // Product View sits next to the account Machines listing. Add, edit,
  // delete and the collection stay admin routes.
  links: [
    'canonical' => '/user/{user}/machine/{bb_machine}',
    'add-form' => '/admin/bakers/machine/add',
    'edit-form' => '/admin/bakers/machine/{bb_machine}/edit',
    'delete-form' => '/admin/bakers/machine/{bb_machine}/delete',
    'collection' => '/admin/bakers/machines',
  ],
  admin_permission: 'administer bakers',
  field_ui_base_route: 'entity.bb_machine.collection',
  base_table: 'bb_machine',
)]
final class BbMachine extends BbContentEntityBase implements BbMachineInterface, EntityOwnerInterface {

  // The owner field is defined in ::baseFieldDefinitions() with its own label
  // and default, so ownerBaseFieldDefinitions() is deliberately not called — it
  // would overwrite both.
  use EntityOwnerTrait;
  use BbNameTrait;
  use BbBaseFieldsTrait;

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);
    $fields['name'] = static::nameBaseFieldDefinition(0);
    // Host identity from machine-context machine_id (stem, not composed).
    $fields['host_key'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Host key'))
      ->setRequired(TRUE)
      ->setSetting('max_length', 255)
      ->addConstraint('UniqueField')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 1]);
    $fields['max_parallel'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('Max parallel'))
      ->setDefaultValue(1)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'number', 'weight' => 2]);
    $fields['current_load'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('Current load'))
      ->setDefaultValue(0)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'number', 'weight' => 3])
      ->setDisplayConfigurable('view', TRUE);
    $fields['owner_user_id'] = static::ownerBaseFieldDefinition();

    return $fields;
  }

  /**
   * {@inheritdoc}
   *
   * Product templates carry `{user}`; parent only fills `{bb_workspace}`
   * when that slot is present. The owner is the account the listing already
   * scopes by.
   */
  protected function urlRouteParameters($rel) {
    $parameters = parent::urlRouteParameters($rel);
    $template = $this->getEntityType()->getLinkTemplate($rel);
    if (!is_string($template) || !str_contains($template, '{user}')) {
      return $parameters;
    }
    $owner_id = $this->getOwnerId();
    if ($owner_id) {
      $parameters['user'] = $owner_id;
    }
    return $parameters;
  }

  /**
   * {@inheritdoc}
   */
  public function setName(string $name): static {
    $this->set('name', $name);
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function getHostKey(): string {
    return (string) $this->get('host_key')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function setHostKey(string $host_key): static {
    $this->set('host_key', $host_key);
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function getMaxParallel(): int {
    return (int) $this->get('max_parallel')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function setMaxParallel(int $max_parallel): static {
    $this->set('max_parallel', $max_parallel);
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function getCurrentLoad(): int {
    return (int) $this->get('current_load')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function setCurrentLoad(int $current_load): static {
    $this->set('current_load', $current_load);
    return $this;
  }

}
