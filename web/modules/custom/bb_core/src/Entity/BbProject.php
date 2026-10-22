<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\ContentEntityDeleteForm;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Entity\EntityViewBuilder;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\views\EntityViewsData;
use Drupal\bb_core\Access\BbProjectAccessControlHandler;
use Drupal\bb_core\Field\EnvironmentsItemList;
use Drupal\entity\EntityPermissionProvider;
use Drupal\entity\Menu\EntityCollectionLocalActionProvider;
use Drupal\bb_core\Routing\BbProjectRouteProvider;
use Drupal\bb_core\Form\BbProjectCreateForm;
use Drupal\bb_core\Form\BbProjectForm;
use Drupal\bb_core\ListBuilder\BbProjectListBuilder;
use Drupal\user\EntityOwnerTrait;
use Drupal\entity\QueryAccess\QueryAccessHandler;
use Drupal\user\EntityOwnerInterface;
use Drupal\bb_core\Form\BbEntityDetailCardForm;

/**
 * Represents a bakers.build project owned by a group.
 *
 * A project encapsulates source repository references and a coder
 * configuration map. It is not an OG group and carries no roles or
 * membership of its own: visibility comes from the teams it names.
 */
#[ContentEntityType(
  id: 'bb_project',
  label: new TranslatableMarkup('bakers.build project'),
  label_collection: new TranslatableMarkup('bakers.build projects'),
  label_singular: new TranslatableMarkup('bakers.build project'),
  label_plural: new TranslatableMarkup('bakers.build projects'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'label' => 'name', 'owner' => 'owner_user_id'],
  handlers: [
    'access' => BbProjectAccessControlHandler::class,
    // Required: `AdminHtmlRouteProvider::getCanonicalRoute()` builds no
    // canonical route at all without a view builder.
    'view_builder' => EntityViewBuilder::class,
    // Narrowed to the account's OG read scope by
    // WorkspaceReadScopeSubscriber.
    'query_access' => QueryAccessHandler::class,
    'permission_provider' => EntityPermissionProvider::class,
    'list_builder' => BbProjectListBuilder::class,
    // Plain EntityViewsData: every column is a base field and both
    // relationships are entity references core already exposes.
    'views_data' => EntityViewsData::class,
    'form' => [
      'default' => BbProjectForm::class,
      'add' => BbProjectForm::class,
      'edit' => BbProjectForm::class,
      // The create dialog, separate from the admin `add` form. It renders the
      // `settings` form mode, which BbProjectCreateForm forces itself.
      'create' => BbProjectCreateForm::class,
      // The Settings surface: exists so `EntityForm::init()` picks the
      // `settings` form mode of the same name.
      'settings' => BbProjectForm::class,
      // Detail page cards, one Save each.
      'identity' => BbEntityDetailCardForm::class,
      'properties' => BbEntityDetailCardForm::class,
      'delete' => ContentEntityDeleteForm::class,
    ],
    // Canonical renders the Overview tab through core's `_entity_view` of the
    // `full` view mode, gated on `view` rather than `update`.
    // @see \Drupal\bb_core\Routing\BbProjectRouteProvider
    'route_provider' => ['html' => BbProjectRouteProvider::class],
    // Tabs are declared statically in bb_core.links.task.yml, so no
    // `local_task_provider` handler is registered.
    'local_action_provider' => ['collection' => EntityCollectionLocalActionProvider::class],
  ],
  // `_workspace` is an INTERNAL prefix that never appears in a URL: the public
  // address is /{workspace}/…, which Drupal's router cannot match directly.
  // BbWorkspacePathProcessor bridges the two forms in both directions.
  links: [
    'canonical' => '/_workspace/{bb_workspace}/project/{bb_project}',
    'add-form' => '/_workspace/{bb_workspace}/project/add',
    'edit-form' => '/_workspace/{bb_workspace}/project/{bb_project}/edit',
    'delete-form' => '/_workspace/{bb_workspace}/project/{bb_project}/delete',
    'collection' => '/admin/bakers/projects',
  ],
  admin_permission: 'administer bakers',
  field_ui_base_route: 'entity.bb_project.collection',
  base_table: 'bb_project',
)]
final class BbProject extends BbContentEntityBase implements BbProjectInterface, EntityOwnerInterface {

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
    $fields['group_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Group'))
      ->setRequired(TRUE)
      ->setSetting('target_type', 'bb_group')
      // Both are write gates: core's ValidReference validates through the
      // handler's buildEntityQuery(), and BbWorkspaceScope owns the
      // membership and ambient-match rules.
      ->setSetting('handler', 'bb_group_in_active_workspace')
      ->addConstraint('BbWorkspaceScope')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete', 'weight' => 0]);
    $fields['name'] = static::nameBaseFieldDefinition(1);
    $fields['description'] = static::descriptionBaseFieldDefinition(2);
    $fields['image'] = static::imageBaseFieldDefinition('project-images', 3);
    $fields['key'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Key'))
      ->setDescription(new TranslatableMarkup('Short project prefix used to build ticket identifiers (KEY-<n>), e.g. BB. Uppercase letters/digits, editable.'))
      ->setSetting('max_length', 10)
      // Server-provided (not client-required): the default-value callback fills
      // it from the name, and it is editable in the UI. Declaring it required
      // would put `key` in the authoritative JSON:API create schema
      // (jsonapi_schema derives `required` from isRequired()), so a name-only
      // project create (the documented minimal) would be rejected client-side.
      // UniqueField keeps the prefix distinct so identifiers never collide.
      ->setDefaultValueCallback(self::class . '::defaultKey')
      ->addConstraint('UniqueField')
      // Regex validates the scalar, so it is a property constraint on `value`;
      // a field-list-level Regex would be handed the ItemList and blow up.
      ->addPropertyConstraints('value', [
        'Regex' => [
          'pattern' => '/^[A-Z][A-Z0-9]{1,9}$/',
          'message' => 'The project key must be 2–10 uppercase letters or digits, starting with a letter (e.g. BB).',
        ],
      ])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 2]);
    $fields['next_number'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('Next ticket number'))
      ->setDescription(new TranslatableMarkup('Monotonic per-project counter for the next ticket number. Only ever increments; allocation floors it on max(existing number)+1 so it can never hand out an already-used number even if it drifts behind.'))
      // Server-owned internal counter (never client-supplied); the default
      // keeps it at 1. Not required, so it stays out of the authoritative
      // create schema and a name-only project create validates client-side.
      ->setDefaultValue(1);
    $fields['repository'] = BaseFieldDefinition::create('bb_repo')
      ->setLabel(new TranslatableMarkup('Repository'))
      // Optional: without a repository BaseBranchItemList falls back to
      // `main`. Single-valued, so it lives in the base table.
      ->setCardinality(1)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('form', ['type' => 'bb_repo', 'weight' => 2]);
    $fields['env_vars'] = BaseFieldDefinition::create('string_long')
      ->setLabel(new TranslatableMarkup('Environment variables'))
      ->setDescription(new TranslatableMarkup('Project defaults supplied to hooks and the agent on every run, as .env-style KEY=value lines (one per line, # comments allowed). A parent ticket and the ticket itself override a key set here. Readable by anyone who can view this project.'))
      ->setDisplayOptions('form', ['type' => 'string_textarea', 'weight' => 6, 'settings' => ['rows' => 5]])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE);
    $fields['coder_config'] = BaseFieldDefinition::create('map')
      ->setLabel(new TranslatableMarkup('Coder config'));
    // `teams` carries access: a project is visible to the members of a team
    // named here (or a see-all workspace admin), and `create bb_project` is
    // checked against these teams. Required enforces "at least one team";
    // BbWorkspaceScope keeps every item inside the actor's tenancy.
    $fields['teams'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Teams'))
      ->setDescription(new TranslatableMarkup('The teams this project belongs to. A project belongs to at least one team; visibility and the right to create a project both flow from team membership.'))
      ->setRequired(TRUE)
      ->setSetting('target_type', 'bb_team')
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      ->addConstraint('BbWorkspaceScope')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete_tags', 'weight' => 3]);
    $fields['environments'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Environments'))
      ->setDescription(new TranslatableMarkup('Managed environments belonging to this project.'))
      ->setSetting('target_type', 'bb_environment')
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      ->setComputed(TRUE)
      ->setClass(EnvironmentsItemList::class)
      ->setDisplayConfigurable('view', TRUE);
    // The owning account, declared as the `owner` entity key so query access
    // and JSON:API filter access can reason about it; access-inert otherwise.
    // Core makes the owner column NOT NULL: the default fills an omitted
    // value, and Required refuses an explicitly emptied one at validation
    // instead of a database error.
    $fields['owner_user_id'] = static::ownerBaseFieldDefinition()
      ->setRequired(TRUE);

    return $fields;
  }

  /**
   * Default-value callback for the `key` field.
   *
   * Derives a short, uppercase prefix from the project name: lowercase, strip
   * everything but ASCII letters/digits, uppercase, cap at 10 characters. Falls
   * back to "bakers.build" when the name yields nothing usable. Applied during
   * entity initialisation (before validation) so a created project satisfies
   * the required + format constraints without the caller passing a key.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $entity
   *   The project the default is being computed for.
   *
   * @return array
   *   A single field value: [['value' => '<KEY>']].
   */
  public static function defaultKey(ContentEntityInterface $entity): array {
    $name = (string) ($entity->get('name')->value ?? '');
    $slug = preg_replace('/[^a-z0-9]+/', '', mb_strtolower($name)) ?? '';
    $key = mb_strtoupper(mb_substr($slug, 0, 10));
    return [['value' => $key !== '' ? $key : 'BB']];
  }

  /**
   * {@inheritdoc}
   */
  public function getKey(): string {
    return (string) $this->get('key')->value;
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
  public function getGroupId(): ?int {
    if ($this->get('group_id')->isEmpty()) {
      return NULL;
    }
    $value = $this->get('group_id')->target_id;
    return is_numeric($value) ? (int) $value : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getGroup(): ?BbGroupInterface {
    $entity = $this->get('group_id')->entity;
    return $entity instanceof BbGroupInterface ? $entity : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getTeams(): array {
    $teams = [];
    foreach ($this->get('teams')->referencedEntities() as $team) {
      // A reference whose target was deleted still occupies a delta, and
      // `referencedEntities()` drops it — but a stale row of another type would
      // not be dropped, so the type is checked rather than assumed.
      if ($team instanceof BbTeamInterface) {
        $teams[] = $team;
      }
    }

    return $teams;
  }

  /**
   * {@inheritdoc}
   */
  public function allocateNextNumber(): int {
    $database = \Drupal::database();
    $transaction = $database->startTransaction();
    try {
      $select = $database->select('bb_project', 'p');
      $select->fields('p', ['next_number']);
      $select->condition('id', $this->id());
      $select->forUpdate();
      $next = (int) $select->execute()->fetchField();
      // Self-correcting floor: never hand out a number at or below the highest
      // already allocated in this project. The counter is authoritative but can
      // drift below max(number) (reseed, explicit-number create, lost bump);
      // flooring on max(number)+1 makes reuse impossible even then. Read under
      // the same row lock so concurrent creates still serialise.
      $floor = (int) $database->select('bb_ticket', 't')
        ->condition('project_id', $this->id())
        ->fields('t', ['number'])
        ->orderBy('number', 'DESC')
        ->range(0, 1)
        ->execute()
        ->fetchField() + 1;
      if ($next < $floor) {
        $next = $floor;
      }
      if ($next < 1) {
        $next = 1;
      }
      $database->update('bb_project')
        ->fields(['next_number' => $next + 1])
        ->condition('id', $this->id())
        ->execute();
      return $next;
    }
    catch (\Exception $e) {
      $transaction->rollBack();
      throw $e;
    }
  }

}
