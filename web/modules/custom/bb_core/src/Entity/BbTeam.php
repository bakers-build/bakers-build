<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\bb_core\Form\BbContentEntityDeleteForm;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\EntityAccessControlHandler;
use Drupal\entity\EntityPermissionProvider;
use Drupal\entity\QueryAccess\QueryAccessHandler;
use Drupal\bb_core\Field\ProjectsItemList;
use Drupal\bb_core\Form\BbTeamForm;
use Drupal\bb_core\ListBuilder\BbLabelListBuilder;
use Drupal\bb_core\Routing\BbTeamRouteProvider;
use Drupal\user\EntityOwnerInterface;
use Drupal\user\EntityOwnerTrait;
use Drupal\bb_core\Form\BbEntityDetailCardForm;

/**
 * Represents a bakers.build team — a workspace-scoped crew.
 *
 * The team cuts across customer projects and answers two questions:
 * reporting (by_team statistics) and visibility — team membership decides
 * which projects an account sees. It grants no rights beyond its own owner
 * role, which governs only the team; every other permission lives on the
 * workspace.
 */
#[ContentEntityType(
  id: 'bb_team',
  label: new TranslatableMarkup('bakers.build team'),
  label_collection: new TranslatableMarkup('bakers.build teams'),
  label_singular: new TranslatableMarkup('bakers.build team'),
  label_plural: new TranslatableMarkup('bakers.build teams'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'label' => 'name', 'owner' => 'owner_user_id'],
  handlers: [
    'access' => EntityAccessControlHandler::class,
    // Narrowed to the account's OG read scope by
    // WorkspaceReadScopeSubscriber.
    'query_access' => QueryAccessHandler::class,
    'permission_provider' => EntityPermissionProvider::class,
    'list_builder' => BbLabelListBuilder::class,
    'form' => [
      'create' => \Drupal\bb_core\Form\BbGroupTeamCreateForm::class,
      'default' => BbTeamForm::class,
      'add' => BbTeamForm::class,
      'edit' => BbTeamForm::class,
      // The Settings surface: exists so `EntityForm::init()` picks the
      // `settings` form mode of the same name.
      'settings' => BbTeamForm::class,
      // Detail page cards, one Save each.
      'identity' => BbEntityDetailCardForm::class,
      'delete' => BbContentEntityDeleteForm::class,
    ],
    // Canonical renders the Overview tab through core's `_entity_view` of the
    // `full` view mode; the provider adds the controller-backed tabs and a
    // title callback.
    // @see \Drupal\bb_core\Routing\BbTeamRouteProvider
    'route_provider' => ['html' => BbTeamRouteProvider::class],
    // Tabs are declared statically in bb_core.links.task.yml, so no
    // `local_task_provider` handler is registered.
  ],
  // `_workspace` is an INTERNAL prefix that never appears in a URL: the public
  // address is /{workspace}/…, which Drupal's router cannot match directly.
  // BbWorkspacePathProcessor bridges the two forms in both directions.
  links: [
    'canonical' => '/_workspace/{bb_workspace}/team/{bb_team}',
    'add-form' => '/_workspace/{bb_workspace}/team/add',
    'edit-form' => '/_workspace/{bb_workspace}/team/{bb_team}/edit',
    'delete-form' => '/_workspace/{bb_workspace}/team/{bb_team}/delete',
  ],
  admin_permission: 'administer bakers',
  base_table: 'bb_team',
)]
final class BbTeam extends BbContentEntityBase implements BbTeamInterface, EntityOwnerInterface {

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
    $fields['workspace_id'] = static::workspaceBaseFieldDefinition(1)
      // Same workspace edge and constraint as BbGroup::workspace_id.
      ->addConstraint('BbWorkspaceScope');
    // The inverse of bb_project.teams, computed: storing one relationship
    // twice lets the copies drift silently.
    $fields['projects'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Projects'))
      ->setDescription(new TranslatableMarkup('The projects assigned to this team. Derived from bb_project.teams; not stored here.'))
      ->setSetting('target_type', 'bb_project')
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      ->setComputed(TRUE)
      ->setClass(ProjectsItemList::class)
      ->setDisplayConfigurable('view', TRUE);
    // The owning account, declared as the entity type's `owner` key so the
    // stock query-access handler can reason about it. The default-value
    // callback is not cosmetic: core marks the column of an `owner` entity
    // key NOT NULL, so a row created without one would fail to save.
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
  public function getProjects(): array {
    $projects = [];
    foreach ($this->get('projects')->referencedEntities() as $project) {
      if ($project instanceof BbProjectInterface) {
        $projects[] = $project;
      }
    }

    return $projects;
  }

}
