<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\ContentEntityDeleteForm;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\views\EntityViewsData;
use Drupal\entity\EntityAccessControlHandler;
use Drupal\entity\EntityPermissionProvider;
use Drupal\entity\Menu\EntityCollectionLocalActionProvider;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Drupal\bb_core\Form\BbGroupForm;
use Drupal\bb_core\ListBuilder\BbLabelListBuilder;
use Drupal\user\EntityOwnerTrait;
use Drupal\entity\QueryAccess\QueryAccessHandler;
use Drupal\user\EntityOwnerInterface;
use Drupal\bb_core\Form\BbEntityDetailCardForm;

/**
 * Represents a bakers.build group — the top-level organisational and billing unit.
 *
 * Each group record stores a human-readable name and an optional structured
 * billing profile used for cost attribution and invoicing.
 */
#[ContentEntityType(
  id: 'bb_group',
  label: new TranslatableMarkup('bakers.build group'),
  label_collection: new TranslatableMarkup('bakers.build groups'),
  label_singular: new TranslatableMarkup('bakers.build group'),
  label_plural: new TranslatableMarkup('bakers.build groups'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'label' => 'name', 'owner' => 'owner_user_id'],
  handlers: [
    'access' => EntityAccessControlHandler::class,
    // Narrowed to the account's OG read scope by
    // WorkspaceReadScopeSubscriber.
    'query_access' => QueryAccessHandler::class,
    'permission_provider' => EntityPermissionProvider::class,
    'list_builder' => BbLabelListBuilder::class,
    // Views integration, declared HERE rather than attached by a hook — see
    // BbProject for the same declaration and the same reasoning. Plain
    // EntityViewsData: the Groups block reads two base fields and one entity
    // reference, none of which needs the upgrade BbTicketViewsData exists
    // for.
    //
    // `billing_profile` is exposed as a single column and stays unusable as
    // two: it is a `map`, and core views has no handler for a map's sub-keys.
    // Giving the type views data does not change that.
    'views_data' => EntityViewsData::class,
    'form' => [
      'create' => \Drupal\bb_core\Form\BbGroupTeamCreateForm::class,
      'default' => BbGroupForm::class,
      'add' => BbGroupForm::class,
      'edit' => BbGroupForm::class,
      // The Settings surface: exists so `EntityForm::init()` picks the
      // `settings` form mode of the same name.
      'settings' => BbGroupForm::class,
      // Detail page cards; they only show the group.
      'identity' => BbEntityDetailCardForm::class,
      'properties' => BbEntityDetailCardForm::class,
      'delete' => ContentEntityDeleteForm::class,
    ],
    // Canonical renders core's `_entity_view` of the `full` view mode; the
    // Settings route is static in bb_core.routing.yml.
    'route_provider' => ['html' => AdminHtmlRouteProvider::class],
    // Tabs are declared statically in bb_core.links.task.yml, so no
    // `local_task_provider` handler is registered.
    'local_action_provider' => ['collection' => EntityCollectionLocalActionProvider::class],
  ],
  // `_workspace` is an INTERNAL prefix that never appears in a URL: the public
  // address is /{workspace}/…, which Drupal's router cannot match directly.
  // BbWorkspacePathProcessor bridges the two forms in both directions.
  links: [
    'canonical' => '/_workspace/{bb_workspace}/group/{bb_group}',
    'add-form' => '/_workspace/{bb_workspace}/group/add',
    'edit-form' => '/_workspace/{bb_workspace}/group/{bb_group}/edit',
    'delete-form' => '/_workspace/{bb_workspace}/group/{bb_group}/delete',
    'collection' => '/admin/bakers/groups',
  ],
  admin_permission: 'administer bakers',
  field_ui_base_route: 'entity.bb_group.collection',
  base_table: 'bb_group',
)]
final class BbGroup extends BbContentEntityBase implements BbGroupInterface, EntityOwnerInterface {

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
    $fields['name'] = static::nameBaseFieldDefinition(0);
    $fields['description'] = static::descriptionBaseFieldDefinition(1);
    $fields['image'] = static::imageBaseFieldDefinition('group-images', 2);
    $fields['billing_profile'] = BaseFieldDefinition::create('map')
      ->setLabel(new TranslatableMarkup('Billing profile'));
    // The tenancy root this group belongs to. Required as a
    // validation constraint rather than a NOT NULL column, which is exactly
    // what makes the migration possible: the column can exist empty and be
    // filled by bb_core_post_update_seed_default_workspace() afterwards.
    $fields['workspace_id'] = static::workspaceBaseFieldDefinition(5)
      // The workspace edge may only point at one the acting account belongs
      // to, and — under a workspace-scoped route — at the one being created
      // in. The constraint runs on the form AND on a JSON:API write, which is
      // why the rule does not live in the form class.
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
  public function setName(string $name): static {
    $this->set('name', $name);
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function getBillingProfile(): array {
    $value = $this->get('billing_profile')->first()?->getValue();
    return is_array($value) ? $value : [];
  }

  /**
   * {@inheritdoc}
   */
  public function getWorkspace(): ?BbWorkspaceInterface {
    $workspace = $this->get('workspace_id')->entity;
    return $workspace instanceof BbWorkspaceInterface ? $workspace : NULL;
  }

}
