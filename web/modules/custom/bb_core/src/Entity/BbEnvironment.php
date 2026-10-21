<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\ContentEntityDeleteForm;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\EntityAccessControlHandler;
use Drupal\entity\EntityPermissionProvider;
use Drupal\entity\Menu\DefaultEntityLocalTaskProvider;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Drupal\bb_core\Form\BbEnvironmentForm;
use Drupal\user\EntityOwnerTrait;
use Drupal\entity\QueryAccess\QueryAccessHandler;
use Drupal\user\EntityOwnerInterface;

/**
 * Represents a bakers.build managed deployment environment (dev2, prod, …).
 *
 * Each environment belongs to exactly one project and is unique per project.
 * There is deliberately no global collection or add form: environments are
 * created only from within their project (the project-scoped add route
 * pre-fills the project) and are surfaced on the project via its computed
 * `environments` field. Live up/down status is intentionally NOT stored
 * here — this entity holds only the environment's stable descriptor (URL +
 * tier).
 */
#[ContentEntityType(
  id: 'bb_environment',
  label: new TranslatableMarkup('bakers.build environment'),
  label_collection: new TranslatableMarkup('bakers.build environments'),
  label_singular: new TranslatableMarkup('bakers.build environment'),
  label_plural: new TranslatableMarkup('bakers.build environments'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'label' => 'name', 'owner' => 'owner_user_id'],
  handlers: [
    'access' => EntityAccessControlHandler::class,
    // Narrowed to the account's OG read scope by
    // WorkspaceReadScopeSubscriber.
    'query_access' => QueryAccessHandler::class,
    'permission_provider' => EntityPermissionProvider::class,
    'form' => [
      'default' => BbEnvironmentForm::class,
      'add' => BbEnvironmentForm::class,
      'edit' => BbEnvironmentForm::class,
      'delete' => ContentEntityDeleteForm::class,
    ],
    'route_provider' => ['html' => AdminHtmlRouteProvider::class],
    'local_task_provider' => ['default' => DefaultEntityLocalTaskProvider::class],
  ],
  // `_workspace` is an INTERNAL prefix that never appears in a URL: the public
  // address is /{workspace}/…, which Drupal's router cannot match directly.
  // BbWorkspacePathProcessor bridges the two forms in both directions.
  links: [
    'canonical' => '/_workspace/{bb_workspace}/environment/{bb_environment}',
    'edit-form' => '/_workspace/{bb_workspace}/environment/{bb_environment}/edit',
    'delete-form' => '/_workspace/{bb_workspace}/environment/{bb_environment}/delete',
  ],
  admin_permission: 'administer bakers',
  base_table: 'bb_environment',
)]
final class BbEnvironment extends BbContentEntityBase implements BbEnvironmentInterface, EntityOwnerInterface {

  // The owner field is defined in ::baseFieldDefinitions() with its own
  // label and default, so ownerBaseFieldDefinitions() is deliberately not
  // called — it would overwrite both.
  use EntityOwnerTrait;
  use BbNameTrait;
  use BbBaseFieldsTrait;

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);

    $fields['name'] = static::nameBaseFieldDefinition(0)
      ->addConstraint('BbEnvironmentUniquePerProject')
      ->setDisplayConfigurable('view', TRUE);

    $fields['project_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Project'))
      ->setDescription(new TranslatableMarkup('The project this environment belongs to.'))
      ->setSetting('target_type', 'bb_project')
      ->setRequired(TRUE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete', 'weight' => 1]);

    $fields['base_url'] = BaseFieldDefinition::create('uri')
      ->setLabel(new TranslatableMarkup('Base URL'))
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('form', ['type' => 'uri', 'weight' => 2]);

    $fields['tier'] = BaseFieldDefinition::create('list_string')
      ->setLabel(new TranslatableMarkup('Tier'))
      ->setSetting('allowed_values', [
        'production' => 'Production',
        'staging' => 'Staging',
        'development' => 'Development',
        'other' => 'Other',
      ])
      ->setDefaultValue('other')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('form', ['type' => 'options_select', 'weight' => 3]);

    $fields['branch'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Branch'))
      ->setDescription(new TranslatableMarkup('The git branch whose CI deploy targets this environment (e.g. develop, main). Lets a deployment resolve which deploy/URL corresponds to this environment.'))
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 4]);

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
  public function getBaseUrl(): ?string {
    $value = $this->get('base_url')->value;
    return $value !== NULL ? (string) $value : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getTier(): string {
    return (string) ($this->get('tier')->value ?? 'other');
  }

  /**
   * {@inheritdoc}
   */
  public function getBranch(): ?string {
    $value = $this->get('branch')->value;
    return ($value !== NULL && $value !== '') ? (string) $value : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getProject(): ?BbProjectInterface {
    $entity = $this->get('project_id')->entity;
    return $entity instanceof BbProjectInterface ? $entity : NULL;
  }

}
