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
use Drupal\entity\Menu\EntityCollectionLocalActionProvider;
use Drupal\entity\QueryAccess\QueryAccessHandler;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Drupal\bb_core\Form\BbWorkspaceForm;
use Drupal\bb_core\ListBuilder\BbWorkspaceListBuilder;
use Drupal\user\EntityOwnerInterface;
use Drupal\user\EntityOwnerTrait;

/**
 * Represents a bakers.build workspace — the tenancy root.
 *
 * The workspace is the workspace: the object that says "this data belongs to
 * operator X and not to operator Y". It is registered as an OG group in
 * og.settings and carries the roles owner/admin/member/guest/app, which decide
 * which people exist for a workspace at all.
 *
 * Its `billing_profile` is not a move of bb_group's. Both exist, with the
 * same type and different meanings: contract or subscription at the top,
 * customer cost centre below.
 */
#[ContentEntityType(
  id: 'bb_workspace',
  label: new TranslatableMarkup('bakers.build workspace'),
  label_collection: new TranslatableMarkup('bakers.build workspaces'),
  label_singular: new TranslatableMarkup('bakers.build workspace'),
  label_plural: new TranslatableMarkup('bakers.build workspaces'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'label' => 'name', 'owner' => 'owner_user_id'],
  handlers: [
    'access' => EntityAccessControlHandler::class,
    // Narrowed to the account's OG read scope by
    // WorkspaceReadScopeSubscriber.
    'query_access' => QueryAccessHandler::class,
    'permission_provider' => EntityPermissionProvider::class,
    'list_builder' => BbWorkspaceListBuilder::class,
    'form' => [
      'default' => BbWorkspaceForm::class,
      'add' => BbWorkspaceForm::class,
      'edit' => BbWorkspaceForm::class,
      // The Settings surface: exists so `EntityForm::init()` picks the
      // `settings` form mode of the same name.
      'settings' => BbWorkspaceForm::class,
      'delete' => ContentEntityDeleteForm::class,
    ],
    'route_provider' => ['html' => AdminHtmlRouteProvider::class],
    'local_task_provider' => ['default' => DefaultEntityLocalTaskProvider::class],
    'local_action_provider' => ['collection' => EntityCollectionLocalActionProvider::class],
  ],
  links: [
    'canonical' => '/admin/bakers/workspace/{bb_workspace}',
    'add-form' => '/admin/bakers/workspace/add',
    'edit-form' => '/admin/bakers/workspace/{bb_workspace}/edit',
    'delete-form' => '/admin/bakers/workspace/{bb_workspace}/delete',
    'collection' => '/admin/bakers/workspaces',
  ],
  admin_permission: 'administer bakers',
  field_ui_base_route: 'entity.bb_workspace.collection',
  base_table: 'bb_workspace',
)]
final class BbWorkspace extends BbContentEntityBase implements BbWorkspaceInterface, EntityOwnerInterface {

  // The owner field is defined in ::baseFieldDefinitions() with its own label
  // and default, so ownerBaseFieldDefinitions() is deliberately not called — it
  // would overwrite both.
  use EntityOwnerTrait;
  use BbNameTrait;
  use BbBaseFieldsTrait;

  /**
   * The UUID of the workspace every pre-existing group is migrated under.
   *
   * Minted once and never changed afterwards: it — not the name —
   * is the anchor that lets bb_core_post_update_seed_default_workspace() find
   * an already-seeded workspace and do nothing on a second run.
   */
  public const DEFAULT_UUID = '2a92d03c-c4c6-41dc-b194-31aa299ed064';

  /**
   * The name the seeded default workspace falls back to.
   *
   * Used when system.site.name is empty. Deliberately generic: bb_core is a
   * product-neutral module and may carry no customer name.
   */
  public const DEFAULT_NAME_FALLBACK = 'bakers.build';

  /**
   * The slug the seeded default workspace is pinned to.
   *
   * A literal rather than slugify(name): every product URL of the default
   * workspace starts with this segment, so fresh installs must agree on it
   * regardless of the site name. A hand-reslugged default workspace still
   * works; this only fixes the value a fresh install starts from.
   */
  public const DEFAULT_SLUG = 'bakers';

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);
    $fields['name'] = static::nameBaseFieldDefinition(0);
    // The public workspace handle: the first path segment of every product URL
    // Authored rather than derived from the name, because a
    // slug that followed a rename would silently rewrite every URL that
    // already exists. BbWorkspaceSlug carries the three rules that make a
    // value usable as a root segment — pattern, uniqueness, reserved words.
    $fields['slug'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Slug'))
      ->setDescription(new TranslatableMarkup('The workspace handle used as the first path segment of every product URL, for example bakers in /bakers/tickets.'))
      ->setRequired(TRUE)
      ->setSetting('max_length', 64)
      ->addConstraint('BbWorkspaceSlug')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 1]);
    $fields['description'] = static::descriptionBaseFieldDefinition(2);
    $fields['image'] = static::imageBaseFieldDefinition('workspace-images', 3);
    $fields['billing_profile'] = BaseFieldDefinition::create('map')
      ->setLabel(new TranslatableMarkup('Billing profile'));
    // The owning account, declared as the entity type's `owner` key so the
    // stock query-access handler can reason about it, exactly as on
    // bb_group. The default-value callback is not cosmetic: core marks the
    // column of an `owner` entity key NOT NULL, so a row created without one
    // would fail to save.
    $fields['owner_user_id'] = static::ownerBaseFieldDefinition();

    return $fields;
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
  public function getSlug(): string {
    return (string) $this->get('slug')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function setSlug(string $slug): static {
    $this->set('slug', $slug);
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function getBillingProfile(): array {
    $value = $this->get('billing_profile')->first()?->getValue();
    return is_array($value) ? $value : [];
  }

}
