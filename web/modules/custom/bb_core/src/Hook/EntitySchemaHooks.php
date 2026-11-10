<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Entity\EntityFieldManagerInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Access\BbOgMembershipAccessControlHandler;
use Drupal\bb_core\Field\AssigneeColorItemList;
use Drupal\bb_core\Field\AssigneeInitialsItemList;
use Drupal\bb_core\Field\AssigneeNameItemList;
use Drupal\bb_core\Field\ClaimMachineItemList;
use Drupal\bb_core\Field\CommentAuthorColorItemList;
use Drupal\bb_core\Field\CommentAuthorInitialsItemList;
use Drupal\bb_core\Field\CommentAuthorNameItemList;
use Drupal\bb_core\Field\DerivedStatusItemList;
use Drupal\bb_core\Field\EditUrlItemList;
use Drupal\bb_core\Field\LastSeenLabelItemList;
use Drupal\bb_core\Field\NodeLoadLabelItemList;
use Drupal\bb_core\Field\NodeStatesLabelItemList;
use Drupal\bb_core\Field\NodeStatusItemList;
use Drupal\bb_core\Field\OwnerInitialsItemList;
use Drupal\bb_core\Field\OwnerNameItemList;
use Drupal\bb_core\Field\RecipientProfileItemList;
use Drupal\bb_core\Field\RunDurationItemList;
use Drupal\bb_core\Field\SinceLabelItemList;
use Drupal\bb_core\Field\StallReasonItemList;
use Drupal\bb_core\Field\StateFlowItemList;
use Drupal\bb_core\Field\WorkStateItemList;
use Drupal\bb_core\Form\UserProfileForm;
use Drupal\bb_core\Plugin\Validation\Constraint\BbGroupScopeConstraint;
use Drupal\bb_core\Plugin\views\field\BbEntityOperations;
use Drupal\bb_core\Storage\DisplayBuilderInstanceStorage;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Entity-type, Views-data and base-field hooks (schema-shaped, not access).
 *
 * Grouped together because every hook here answers "what does an entity type,
 * a field or a Views table LOOK LIKE" rather than "who may act on it" — the
 * access fence hooks live in AccessFenceHooks instead.
 *
 * @SuppressWarnings("PHPMD.CouplingBetweenObjects")
 *
 * The coupling is the computed-field catalogue itself, unchanged from the
 * procedural hook_entity_base_field_info() this moved out of: one item-list
 * class per derived field, across four entity types. Splitting it into
 * smaller classes would not reduce the number of collaborators this hook
 * needs to know about — it would only hide the same list behind another
 * layer.
 */
final class EntitySchemaHooks {

  public function __construct(
    #[Autowire(service: 'entity_type.manager')]
    private readonly EntityTypeManagerInterface $entityTypeManager,
    #[Autowire(service: 'entity_field.manager')]
    private readonly EntityFieldManagerInterface $entityFieldManager,
  ) {
  }

  /**
   * Implements hook_entity_type_alter().
   *
   * Puts bakers.build's own access handler on og_membership, and the
   * user entity's `profile` form (position and background only).
   *
   * OG reserves membership reads to permissions the `bb:session` scope
   * cannot carry, so rosters were unreadable to machine identities. A
   * replaced handler can grant where `hook_entity_access()` can only forbid;
   * subclassing keeps OG's create/update/delete and field gates. Guarded on
   * presence, not `moduleExists()`, because this runs mid-rebuild.
   *
   * @param array<string, \Drupal\Core\Entity\EntityTypeInterface> $entity_types
   *   Entity type definitions, keyed by entity type id.
   *
   * @see \Drupal\bb_core\Access\BbOgMembershipAccessControlHandler
   * @see \Drupal\bb_core\EventSubscriber\WorkspaceReadScopeSubscriber
   */
  #[Hook('entity_type_alter')]
  public function entityTypeAlter(array &$entity_types): void {
    ($entity_types['user'] ?? NULL)?->setFormClass('profile', UserProfileForm::class);
    if (isset($entity_types['display_builder_instance'])) {
      $entity_types['display_builder_instance']->setHandlerClass('storage', DisplayBuilderInstanceStorage::class);
    }
    $membership = $entity_types['og_membership'] ?? NULL;
    if (!$membership instanceof EntityTypeInterface) {
      return;
    }
    $membership->setHandlerClass(
      'access',
      BbOgMembershipAccessControlHandler::class,
    );
  }

  /**
   * Implements hook_entity_bundle_info().
   *
   * Kernel tests that only install the content schema still need both
   * comment bundles; config entities cover the same ids on a full site.
   *
   * @return array<string, array<string, array{label: \Drupal\Core\StringTranslation\TranslatableMarkup}>>
   *   Bundle info keyed by entity type then bundle.
   */
  #[Hook('entity_bundle_info')]
  public function entityBundleInfo(): array {
    return [
      'bb_comment' => [
        'bb_comment' => [
          'label' => new TranslatableMarkup('Comment'),
        ],
        'review' => [
          'label' => new TranslatableMarkup('Review'),
        ],
      ],
    ];
  }

  /**
   * Implements hook_views_plugins_field_alter().
   *
   * @param array<string, array<string, mixed>> $plugins
   *   The field plugin definitions.
   */
  #[Hook('views_plugins_field_alter')]
  public function viewsPluginsFieldAlter(array &$plugins): void {
    if (isset($plugins['entity_operations'])) {
      $plugins['entity_operations']['class'] = BbEntityOperations::class;
    }
  }

  /**
   * Implements hook_views_data_alter().
   *
   * @param array<string, mixed> $data
   *   The Views data to alter.
   */
  #[Hook('views_data_alter')]
  public function viewsDataAlter(array &$data): void {
    $data['views']['bb_empty'] = [
      'title' => new TranslatableMarkup('Empty state with configured text'),
      'help' => new TranslatableMarkup('Adds the shared inbox icon to the configured empty text.'),
      'area' => ['id' => 'bb_empty'],
    ];
    $data['views']['bb_contextual_empty'] = [
      'title' => new TranslatableMarkup('Contextual ticket empty state'),
      'help' => new TranslatableMarkup('Shows the empty context text or a
        no-match message when exposed filters are selected.'),
      'area' => ['id' => 'bb_contextual_empty'],
    ];

    // Counts of what references a project, a group or a conductor, for their
    // listings: a small icon badge each, with a tooltip saying what is counted.
    $open = ['closed' => 0];
    foreach ([
      [
        'bb_project', 'open_tickets', 'Open tickets', 'bb_ticket', 'project_id', $open,
        'ticket', 'neutral', '1 open ticket', '@count open tickets',
      ],
      [
        'bb_project', 'conductor_tickets', 'Open tickets with a conductor', 'bb_ticket', 'project_id',
        $open + ['conductor_id' => ['operator' => 'IS NOT NULL']], 'conductor', 'lease',
        '1 open ticket with a conductor', '@count open tickets with a conductor',
      ],
      [
        'bb_conductor', 'open_tickets', 'Open tickets', 'bb_ticket', 'conductor_id', $open,
        'ticket', 'neutral', '1 open ticket', '@count open tickets',
      ],
      [
        'bb_project', 'closed_tickets', 'Closed tickets', 'bb_ticket', 'project_id', ['closed' => 1],
        'check', 'neutral', '1 closed ticket', '@count closed tickets',
      ],
      [
        'bb_group', 'projects', 'Projects', 'bb_project', 'group_id', [],
        'project', 'neutral', '1 project', '@count projects',
      ],
    ] as [$table, $key, $title, $entity_type, $field, $conditions, $icon, $tone, $singular, $plural]) {
      if (isset($data[$table])) {
        $data[$table][$key] = [
          'title' => $title,
          'help' => new TranslatableMarkup('How many entities reference this one.'),
          'field' => [
            'id' => 'bb_reference_count',
            'count_entity_type' => $entity_type,
            'count_field' => $field,
            'conditions' => $conditions,
            'icon' => $icon,
            'tone' => $tone,
            'singular' => $singular,
            'plural' => $plural,
          ],
        ];
      }
    }

    // Ticket-list run count: occupancy is the conductor rail; this is how
    // often the ticket has already run. Zero is omitted so idle rows stay
    // quiet. The field lives on the Search API table the tickets view uses.
    if (isset($data['search_api_index_bb_tickets'])) {
      $data['search_api_index_bb_tickets']['run_count'] = [
        'title' => 'Runs',
        'help' => new TranslatableMarkup('How many entities reference this one.'),
        'field' => [
          'id' => 'bb_reference_count',
          'count_entity_type' => 'bb_run',
          'count_field' => 'ticket_id',
          'conditions' => [],
          'icon' => 'run',
          'tone' => 'neutral',
          'singular' => '1 run',
          'plural' => '@count runs',
          'hide_zero' => TRUE,
        ],
      ];
      $data['search_api_index_bb_tickets']['stall_reason'] = [
        'title' => 'Stall reason',
        'help' => new TranslatableMarkup('Why this ticket is standing still: frozen, blocked, no conductor, conductor no access, or failing.'),
        'field' => [
          'id' => 'bb_stall_reason',
        ],
      ];
    }

    // Latest conductor heartbeat on a machine, for the listing caption.
    if (isset($data['bb_machine'])) {
      $data['bb_machine']['last_run'] = [
        'title' => new TranslatableMarkup('Last run'),
        'help' => new TranslatableMarkup('The latest last_seen of conductors on this machine.'),
        'field' => [
          'id' => 'bb_related_max_timestamp',
          'related_entity_type' => 'bb_conductor',
          'related_field' => 'machine',
          'timestamp_field' => 'last_seen',
        ],
      ];
    }

    // Core's combined-fields filter, with the LIKE escape clause it drops.
    if (isset($data['views']['combine']['filter'])) {
      $data['views']['combine']['filter']['id'] = 'bb_combine';
    }

    // The listings' unique last sort, following the chosen direction.
    foreach ([
      'bb_project' => 'id',
      'bb_group' => 'id',
      'search_api_index_bb_tickets' => 'search_api_id',
      'search_api_index_bb_runs' => 'search_api_id',
    ] as $table => $real_field) {
      if (isset($data[$table])) {
        $data[$table]['bb_tie_breaker'] = [
          'title' => new TranslatableMarkup('Tie-breaker'),
          'help' => new TranslatableMarkup('A unique last sort that follows the chosen direction.'),
          'real field' => $real_field,
          'sort' => ['id' => 'bb_tie_breaker'],
        ];
      }
    }

    // Type-driven: runs for every bb_metric field, independent of bb_run.
    $this->metricViewsDataAlter($data);

    // The two scoping filters the `my_work` display needs.
    $this->ticketScopeViewsDataAlter($data);

    // The closed-rows filter on both the ticket and run indexes.
    $this->runScopeViewsDataAlter($data);

    // The filter summary area comes from `views_filters_summary`, and
    // `error_log_bytes` is a plain base field Views exposes by itself.
  }

  /**
   * Registers ticket-scoping filters on every ticket search index.
   *
   * "Assigned to me", "not terminal in its own workflow" and the Board
   * Conductor select have no stock Search API handler, so they are added
   * as pseudo-fields beside the real ones (pointing at them via `real field`)
   * rather than replacing them. Every index with an `entity:bb_ticket`
   * datasource gets them.
   *
   * @param array<string, mixed> $data
   *   The Views data to alter.
   */
  private function ticketScopeViewsDataAlter(array &$data): void {
    // `search_api` is an ordinary dependency of the tickets view, not of this
    // module: `bb_core` is installed without it by several Kernel tests, and
    // asking for a storage handler of an entity type that does not exist is a
    // `PluginNotFoundException` inside a views-data alter — which fails the
    // config installer of every view in the module, not just the ticket one.
    if (!$this->entityTypeManager->hasDefinition('search_api_index')) {
      return;
    }
    $storage = $this->entityTypeManager->getStorage('search_api_index');
    foreach ($storage->loadMultiple() as $index) {
      $datasources = array_keys($index->getDatasources());
      if (!in_array('entity:bb_ticket', $datasources, TRUE)) {
        continue;
      }
      $table = 'search_api_index_' . $index->id();
      if (!isset($data[$table])) {
        continue;
      }
      $this->addTicketIndexFilters($data[$table]);
    }
  }

  /**
   * Adds bakers.build ticket filter handlers onto one Search API Views table.
   *
   * @param array<string, mixed> $table
   *   One index's Views data, keyed by field.
   */
  private function addTicketIndexFilters(array &$table): void {
    if (isset($table['assignee_user_id'])) {
      $table['bb_assignee_is_current_user'] = [
        'title' => new TranslatableMarkup('Assignee is the current user'),
        'help' => new TranslatableMarkup('Narrows the list to the tickets
          assigned to whoever is reading it.'),
        'real field' => 'assignee_user_id',
        'filter' => ['id' => 'bb_search_api_current_user'],
      ];
    }
    if (isset($table['state'], $table['workflow'])) {
      $table['bb_ticket_is_open'] = [
        'title' => new TranslatableMarkup('State is not terminal'),
        'help' => new TranslatableMarkup("Narrows the list to the tickets no
          transition of their own workflow has finished. The terminal states
          are derived from the workflows, never listed in config."),
        'real field' => 'state',
        'filter' => [
          'id' => 'bb_non_terminal_ticket_state',
          // INSIDE `filter`, not beside it:
          // `ViewsHandlerManager::getHandler()` copies only a fixed list of
          // field-level keys onto a handler definition, so a key of ours
          // there would be dropped silently.
          'bb_workflow_field' => 'workflow',
        ],
      ];
    }
    if (isset($table['closed'])) {
      $table['bb_closed_rows'] = [
        'title' => new TranslatableMarkup('Closed rows'),
        'help' => new TranslatableMarkup('Follows the closed control in the
          address: open rows, closed rows, or both.'),
        'real field' => 'closed',
        'filter' => ['id' => 'bb_closed_rows'],
      ];
    }
    if (isset($table['search_api_fulltext'], $table['origin_ref'])) {
      $table['bb_ticket_search'] = [
        'title' => new TranslatableMarkup('Ticket search'),
        'help' => new TranslatableMarkup('Fulltext search that also accepts
          a ticket identifier, an origin reference such as #19 or bakers#19,
          and an origin issue URL.'),
        'filter' => ['id' => 'bb_ticket_search'],
      ];
    }
  }

  /**
   * Registers the closed pseudo-field on every run index.
   *
   * @param array<string, mixed> $data
   *   The Views data to alter.
   */
  private function runScopeViewsDataAlter(array &$data): void {
    if (!$this->entityTypeManager->hasDefinition('search_api_index')) {
      return;
    }
    $storage = $this->entityTypeManager->getStorage('search_api_index');
    foreach ($storage->loadMultiple() as $index) {
      $datasources = array_keys($index->getDatasources());
      if (!in_array('entity:bb_run', $datasources, TRUE)) {
        continue;
      }
      $table = 'search_api_index_' . $index->id();
      if (!isset($data[$table]['closed'])) {
        continue;
      }
      $data[$table]['bb_closed_rows'] = [
        'title' => new TranslatableMarkup('Closed rows'),
        'help' => new TranslatableMarkup('Follows the closed control in the
          address: open rows, closed rows, or both.'),
        'real field' => 'closed',
        'filter' => ['id' => 'bb_closed_rows'],
      ];
    }
  }

  /**
   * Upgrades every bb_metric field's Views handlers, keyed on the field type.
   *
   * EntityViewsData surfaces a multi-value bb_metric field as a dedicated
   * table (<entity>__<field>) with plain numeric/string column handlers. Swap
   * the value column onto the metric-name-configurable bb_metric field + the
   * bb_metric_value sort/filter, and the name column onto the
   * bb_metric_name filter, so a view can pin the value to one metric and
   * aggregate it.
   *
   * Discovery is by field TYPE (getFieldMapByFieldType), never a hardcoded
   * field name — bb_ticket.metrics today, bb_run.metrics later, both
   * inherit this with no per-field glue.
   *
   * @param array<string, mixed> $data
   *   The Views data to alter.
   */
  private function metricViewsDataAlter(array &$data): void {
    $map = $this->entityFieldManager->getFieldMapByFieldType('bb_metric');
    foreach ($map as $entity_type_id => $fields) {
      foreach (array_keys($fields) as $field_name) {
        $table = $entity_type_id . '__' . $field_name;
        if (!isset($data[$table])) {
          continue;
        }
        $value_column = $field_name . '_value';
        $name_column = $field_name . '_name';
        if (isset($data[$table][$value_column])) {
          $data[$table][$value_column]['field']['id'] = 'bb_metric';
          $data[$table][$value_column]['field']['bb_metric_name_column'] =
            $name_column;
          $data[$table][$value_column]['sort']['id'] = 'bb_metric_value';
          $data[$table][$value_column]['sort']['bb_metric_name_column'] =
            $name_column;
          $data[$table][$value_column]['filter']['id'] = 'bb_metric_value';
          $data[$table][$value_column]['filter']['bb_metric_name_column'] =
            $name_column;
        }
        if (isset($data[$table][$name_column])) {
          $data[$table][$name_column]['filter']['id'] = 'bb_metric_name';
        }
      }
    }
  }

  /**
   * Implements hook_entity_base_field_info_alter().
   *
   * Attaches the create-side half of the rank fence to each scoped anchor
   * named by BbGroupScopeConstraint::ANCHORS.
   *
   * An alter rather than six edits to six baseFieldDefinitions(): the property
   * being asserted is identical for all of them, and keeping it in one list is
   * what lets GroupScopeConstraintTest enumerate the set rather than sample
   * it, so a type added later cannot be left without one silently.
   *
   * @param array<string, \Drupal\Core\Field\FieldDefinitionInterface> $fields
   *   The base field definitions to alter.
   * @param \Drupal\Core\Entity\EntityTypeInterface $entity_type
   *   The entity type the fields belong to.
   */
  #[Hook('entity_base_field_info_alter')]
  public function entityBaseFieldInfoAlter(
    array &$fields,
    EntityTypeInterface $entity_type,
  ): void {
    $anchors = [
      BbGroupScopeConstraint::ANCHORS[$entity_type->id()] ?? NULL,
      BbGroupScopeConstraint::ALTERNATE_ANCHORS[$entity_type->id()] ?? NULL,
    ];
    foreach (array_filter($anchors) as $anchor) {
      if (isset($fields[$anchor])) {
        $fields[$anchor]->addConstraint('BbGroupScope');
      }
    }
  }

  /**
   * Implements hook_entity_base_field_info().
   *
   * The derived presentation fields on bb_ticket, bb_comment, bb_run
   * and bb_conductor. They are JSON:API surface (read by bakers-cli and the
   * Designbook mappings), so they belong to the module owning the entities.
   * All are computed and not stored: no DB column, no update hook.
   *
   * @return array<string, \Drupal\Core\Field\BaseFieldDefinition>
   *   The base field definitions this hook adds.
   */
  #[Hook('entity_base_field_info')]
  public function entityBaseFieldInfo(EntityTypeInterface $entity_type): array {
    $fields = [];

    if ($entity_type->id() === 'bb_ticket') {
      $fields['derived_status'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Derived status'))
        ->setComputed(TRUE)
        ->setClass(DerivedStatusItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      $fields['work_state'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Work state'))
        ->setComputed(TRUE)
        ->setClass(WorkStateItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      $fields['stall_reason'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Stall reason'))
        ->setDescription(new TranslatableMarkup('Why this ticket is standing still: frozen, blocked, no conductor, conductor no access, or failing.'))
        ->setComputed(TRUE)
        ->setClass(StallReasonItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      $fields['claim_machine'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Claim machine'))
        ->setComputed(TRUE)
        ->setClass(ClaimMachineItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      $fields['since_label'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Since'))
        ->setComputed(TRUE)
        ->setClass(SinceLabelItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      $fields['assignee_initials'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Assignee initials'))
        ->setComputed(TRUE)
        ->setClass(AssigneeInitialsItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      $fields['assignee_name'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Assignee name'))
        ->setComputed(TRUE)
        ->setClass(AssigneeNameItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      $fields['assignee_color'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Assignee colour'))
        ->setComputed(TRUE)
        ->setClass(AssigneeColorItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      $fields['recipient_profile'] = BaseFieldDefinition::create('string_long')
        ->setLabel(new TranslatableMarkup('Recipient profile'))
        ->setComputed(TRUE)
        ->setClass(RecipientProfileItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      $fields['owner_name'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Owner name'))
        ->setComputed(TRUE)
        ->setClass(OwnerNameItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      $fields['owner_initials'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Owner initials'))
        ->setComputed(TRUE)
        ->setClass(OwnerInitialsItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      // Ordered workflow states for the ticket_detail state-flow bar, derived
      // from the ticket's state_machine workflow (single source of truth).
      $fields['state_flow'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('State flow'))
        ->setComputed(TRUE)
        ->setClass(StateFlowItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      // Access-gated edit-form URL for the ticket_detail Edit link. Computed +
      // non-stored ⇒ no DB column ⇒ no update hook; empty when the current user
      // has no update access, so the SDC Edit link stays hidden.
      $fields['edit_url'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Edit URL'))
        ->setComputed(TRUE)
        ->setClass(EditUrlItemList::class)
        ->setDisplayConfigurable('view', TRUE);
    }

    if ($entity_type->id() === 'bb_comment') {
      $fields['author_name'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Author name'))
        ->setComputed(TRUE)
        ->setClass(CommentAuthorNameItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      $fields['author_initials'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Author initials'))
        ->setComputed(TRUE)
        ->setClass(CommentAuthorInitialsItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      $fields['author_color'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Author colour'))
        ->setComputed(TRUE)
        ->setClass(CommentAuthorColorItemList::class)
        ->setDisplayConfigurable('view', TRUE);
    }

    if ($entity_type->id() === 'bb_run') {
      // Ordered workflow states for the run_row state-flow bar (claimed →
      // running → done), derived from the bb_run state_machine workflow —
      // same source and presentation as the ticket_detail bar.
      $fields['state_flow'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('State flow'))
        ->setComputed(TRUE)
        ->setClass(StateFlowItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      // Compact humanised run duration (closed_date − started_at, "1m 12s") for
      // the run_row timing column — derived live, no schema change.
      $fields['duration'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Duration'))
        ->setComputed(TRUE)
        ->setClass(RunDurationItemList::class)
        ->setDisplayConfigurable('view', TRUE);
    }

    if ($entity_type->id() === 'bb_conductor') {
      $fields['node_status'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Node status'))
        ->setComputed(TRUE)
        ->setClass(NodeStatusItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      $fields['node_states_label'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Node states'))
        ->setComputed(TRUE)
        ->setClass(NodeStatesLabelItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      $fields['node_load_label'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Node load'))
        ->setComputed(TRUE)
        ->setClass(NodeLoadLabelItemList::class)
        ->setDisplayConfigurable('view', TRUE);
      $fields['last_seen_label'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('Last seen label'))
        ->setComputed(TRUE)
        ->setClass(LastSeenLabelItemList::class)
        ->setDisplayConfigurable('view', TRUE);
    }

    return $fields;
  }

}
