<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\bb_core\Form\BbContentEntityDeleteForm;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\EntityPermissionProvider;
use Drupal\entity\QueryAccess\QueryAccessHandler;
use Drupal\bb_core\Access\BbTicketAccessControlHandler;
use Drupal\bb_core\Storage\BbTicketStorage;
use Drupal\bb_core\Field\EffectiveEnvVarsItemList;
use Drupal\bb_core\Form\BbTicketCreateForm;
use Drupal\bb_core\Form\BbTicketForm;
use Drupal\bb_core\Link\LinkNormalizer;
use Drupal\bb_core\ListBuilder\BbTicketListBuilder;
use Drupal\bb_core\Routing\BbTicketRouteProvider;
use Drupal\bb_core\Ticket\BranchName;
use Drupal\bb_core\Ticket\TicketClosure;
use Drupal\bb_core\Ticket\TicketInterventions;
use Drupal\bb_core\ViewsData\BbTicketViewsData;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface;
use Drupal\user\EntityOwnerInterface;
use Drupal\user\EntityOwnerTrait;

/**
 * Represents a bakers.build ticket — a unit of work dispatched to a conductor.
 *
 * Tickets belong to a project, carry a unique identifier, and select a workflow
 * directly via the `workflow` field. Their state is managed by the
 * state_machine module with that workflow resolved at runtime. Open blockers
 * are computed live from the states of the tickets in `blocked_by`.
 *
 * @SuppressWarnings("PHPMD.ExcessiveClassComplexity")
 */
#[ContentEntityType(
  id: 'bb_ticket',
  label: new TranslatableMarkup('bakers.build ticket'),
  label_collection: new TranslatableMarkup('bakers.build tickets'),
  label_singular: new TranslatableMarkup('bakers.build ticket'),
  label_plural: new TranslatableMarkup('bakers.build tickets'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'label' => 'title', 'owner' => 'owner_user_id'],
  handlers: [
    'storage' => BbTicketStorage::class,
    'access' => BbTicketAccessControlHandler::class,
    // Narrowed to the account's OG read scope by
    // WorkspaceReadScopeSubscriber.
    'query_access' => QueryAccessHandler::class,
    'permission_provider' => EntityPermissionProvider::class,
    'list_builder' => BbTicketListBuilder::class,
    'form' => [
      'default' => BbTicketForm::class,
      'add' => BbTicketForm::class,
      'edit' => BbTicketForm::class,
      'property' => \Drupal\bb_core\Form\BbTicketPropertyForm::class,
      // The confirmation dialog of Cancel ticket and Cancel run.
      'action' => \Drupal\bb_core\Form\BbTicketActionForm::class,
      // Ticket Settings: the edit route renders this in the app shell.
      'settings' => BbTicketForm::class,
      'delete' => BbContentEntityDeleteForm::class,
      // The create dialog. The operation selects the `create` form mode
      // (`ContentEntityForm::init()`); `add` stays the admin form.
      'create' => BbTicketCreateForm::class,
    ],
    'views_data' => BbTicketViewsData::class,
    // The canonical route pins the `full` entity view whose Display Builder
    // tree composes the whole detail screen.
    'route_provider' => ['html' => BbTicketRouteProvider::class],
    // Deliberately no `local_task_provider`: the default one would synthesise
    // a View/Edit tab row from the `edit-form` link, and a ticket has a single
    // face. The shell keeps drawing tabs for entities that declare them.
  ],
  // `_workspace` is an INTERNAL prefix that never appears in a URL: the public
  // address is /{workspace}/…, which Drupal's router cannot match directly.
  // BbWorkspacePathProcessor bridges the two forms in both directions.
  links: [
    'canonical' => '/_workspace/{bb_workspace}/ticket/{bb_ticket}',
    'add-form' => '/_workspace/{bb_workspace}/ticket/add',
    'edit-form' => '/_workspace/{bb_workspace}/ticket/{bb_ticket}/edit',
    'delete-form' => '/_workspace/{bb_workspace}/ticket/{bb_ticket}/delete',
  ],
  admin_permission: 'administer bakers',
  base_table: 'bb_ticket',
)]
final class BbTicket extends BbContentEntityBase implements BbTicketInterface, EntityOwnerInterface {

  // The owner field is defined in ::baseFieldDefinitions() with its own
  // label and default, so ownerBaseFieldDefinitions() is deliberately not
  // called — it would overwrite both.
  use EntityOwnerTrait;

  /**
   * Returns the workflow ID for the given ticket, read from its workflow field.
   *
   * Registered as the state field's workflow_callback so the state_machine
   * module resolves the correct workflow at runtime.
   *
   * @param self $ticket
   *   The ticket entity being evaluated.
   *
   * @return string
   *   The workflow plugin ID stored on the ticket.
   */
  public static function workflowCallback(self $ticket): string {
    return $ticket->getWorkflow();
  }

  /**
   * {@inheritdoc}
   *
   * Derives each link item's kind from its URI into `options.bakers.kind`.
   *
   * The kind is classified server-side (never authored) so handoff writes stay
   * the plain `{uri, title}` shape. Existing options keys are preserved and the
   * derivation is idempotent (re-save recomputes the same kind).
   *
   * Run retirement is NOT done here — it reacts to the state-machine
   * transition in TicketTransitionSubscriber (every transition, not just done).
   */
  public function preSave(EntityStorageInterface $storage): void {
    parent::preSave($storage);
    $this->allocateNumber();
    $this->freezeBranchName();
    $this->deriveAssigneeFromConductor();
    $this->normalizeReviewers();
    $this->set('links', LinkNormalizer::normalize($this->get('links')->getValue()));
    // Terminal-close/cleanup lifecycle rules (@see TicketClosure).
    TicketClosure::coerceCleanedUpNull($this);
    TicketClosure::closeIfTerminal($this);
    TicketClosure::cancelIfClosedNonTerminal($this);
    TicketClosure::stampCleanedUpDate($this);
    TicketClosure::coerceFrozenNull($this);
    TicketClosure::stampFrozenAt($this);
  }

  /**
   * {@inheritdoc}
   *
   * Freezing cancels every active run, so a frozen ticket has no live agent.
   * A changed conductor cancels the runs still active on another one, so the
   * new conductor can claim the ticket. Server side: the editor's run access
   * plays no part.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  public function postSave(EntityStorageInterface $storage, $update = TRUE): void {
    parent::postSave($storage, $update);
    $original = $this->getOriginal();
    if (!$update || !$original instanceof BbTicketInterface) {
      return;
    }
    // Before the conductor check, so a save doing both leaves the freeze note.
    if ($this->isFrozen() && !$original->isFrozen()) {
      foreach (TicketInterventions::activeRuns($this, \Drupal::entityTypeManager()) as $run) {
        TicketInterventions::cancelRun($run, 'frozen by ' . \Drupal::currentUser()->getAccountName());
      }
    }
    $conductor = (int) $this->get('conductor_id')->target_id;
    if ($conductor === (int) $original->get('conductor_id')->target_id) {
      return;
    }
    foreach (TicketInterventions::activeRuns($this, \Drupal::entityTypeManager(), $conductor ?: NULL) as $run) {
      TicketInterventions::cancelRun($run, 'conductor reassigned');
    }
  }

  /**
   * Allocates the per-project running number and freezes the identifier.
   *
   * On first save only (guarded on an empty `number`), draws the project's
   * `next_number` under a `FOR UPDATE` row lock, writes it to `number`, bumps
   * the counter, and builds `identifier = <project key>-<number>`. The lock
   * serialises concurrent saves so numbers stay distinct and gapless; the empty
   * guard makes it idempotent, so re-saves never reallocate or renumber. When
   * the ticket has no project (or the project has no key) the identifier keeps
   * the default-callback value and no number is drawn.
   */
  private function allocateNumber(): void {
    $project = $this->get('project_id')->entity;
    if (!$this->get('number')->isEmpty()
      || !$project instanceof BbProjectInterface
      || $project->getKey() === '') {
      return;
    }
    // The project owns the counter and the FOR UPDATE row lock that keeps
    // concurrent allocations distinct; the ticket only freezes the result.
    $next = $project->allocateNextNumber();
    $this->set('number', $next);
    $this->set('identifier', $project->getKey() . '-' . $next);
  }

  /**
   * Freezes the git branch name on first save.
   *
   * Guarded on an empty `branch_name` so it is written exactly once and never
   * changes afterwards — a later title edit leaves the branch untouched, so an
   * already-checked-out worktree keeps its name. Runs after allocateNumber so
   * the frozen `identifier` is available. Identifier-less tickets leave the
   * field empty.
   *
   * The name itself is derived by BranchName; only the once-only guard
   * lives here.
   */
  private function freezeBranchName(): void {
    if (!$this->get('branch_name')->isEmpty()) {
      return;
    }
    $branch = BranchName::derive($this);
    if ($branch !== '') {
      $this->set('branch_name', $branch);
    }
  }

  /**
   * Fills an empty assignee with the assigned conductor's owner.
   *
   * A conductor is owned by a person, so a ticket handed to a conductor has a
   * known human owner. Checked on every save (create and update alike) on one
   * condition — conductor set, assignee empty — rather than on a change, which
   * makes it idempotent and self-healing. A set assignee is never overwritten,
   * conductor switch included; the rule only ever fills a hole. Its accepted
   * consequence is that deliberately clearing an assignee on a
   * conductor-assigned ticket is undone at the next save.
   */
  private function deriveAssigneeFromConductor(): void {
    // Never overwrite: a set assignee wins, which is also what makes every
    // save after the first a no-op.
    if (!$this->get('assignee_user_id')->isEmpty()) {
      return;
    }
    // No conductor, nothing to derive from — and no entity load.
    if ($this->get('conductor_id')->isEmpty()) {
      return;
    }
    $conductor = $this->getConductor();
    // A dangling reference or an owner-less conductor derives nothing and
    // raises nothing; the save succeeds unchanged. owner_user_id is an entity
    // key (NOT NULL), so "owner-less" is target id 0, not an empty field.
    if ($conductor === NULL) {
      return;
    }
    $owner_id = (int) $conductor->get('owner_user_id')->target_id;
    if ($owner_id === 0) {
      return;
    }
    $this->set('assignee_user_id', $owner_id);
  }

  /**
   * Collapses reviewers to a set of real accounts.
   *
   * Core's ValidReference treats target id 0 as an empty reference, so a
   * forged anonymous value would otherwise persist. Duplicate ids from a
   * tags widget are the same account twice.
   */
  private function normalizeReviewers(): void {
    $ids = [];
    foreach ($this->get('reviewers') as $item) {
      $target_id = $item->getValue()['target_id'] ?? NULL;
      $id = is_numeric($target_id) ? (int) $target_id : 0;
      if ($id > 0) {
        $ids[$id] = $id;
      }
    }
    $this->set('reviewers', array_values($ids));
  }

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);
    $fields['project_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Project'))
      // Workspace anchor: every ticket belongs to a project (and thus a
      // workspace via group). Required so multi-workspace query access never
      // meets a project-less row that cannot be scoped.
      ->setRequired(TRUE)
      ->setSetting('target_type', 'bb_project')
      // Both are write gates: core's ValidReference validates through the
      // handler's buildEntityQuery(), and BbWorkspaceScope owns the
      // membership and ambient-match rules.
      ->setSetting('handler', 'bb_project_in_active_workspace')
      ->addConstraint('BbWorkspaceScope')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete', 'weight' => 0]);
    $fields['identifier'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Identifier'))
      // Derived, never client-authored: preSave freezes it to "<project
      // key>-<number>" (see allocateNumber) and the default-value callback
      // fills the projectless fallback. A client must never supply one, and
      // that is enforced, not merely stated — `edit` is denied for every actor
      // in BbTicketAccessControlHandler, which JSON:API applies on CREATE
      // too (createIndividual() checks it before ::validate()), so a POST
      // carrying attributes.identifier is refused with 403 and the add form
      // omits it; BbTicketForm surfaces it read-only once the ticket exists.
      // Deliberately NOT setRequired(TRUE): that would land in the JSON:API
      // create schema (jsonapi_schema reads isRequired()) and dropsh would
      // reject a valid create for a value it must not send. UniqueField holds.
      ->setDefaultValueCallback(self::class . '::defaultIdentifier')
      ->addConstraint('UniqueField')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 1]);
    $fields['number'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('Number'))
      ->setDescription(new TranslatableMarkup('The per-project running ticket number, allocated once on first save and frozen. Read-only; the identifier is built from it.'))
      ->setDisplayConfigurable('view', TRUE);
    $fields['workflow'] = BaseFieldDefinition::create('list_string')
      ->setLabel(new TranslatableMarkup('Workflow'))
      ->setSetting('allowed_values_function', TypeWorkflows::class . '::ticketWorkflowOptions')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'options_select', 'weight' => 2]);
    $fields['title'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Title'))
      ->setRequired(TRUE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 3]);
    $fields['description'] = BaseFieldDefinition::create('text_long')
      ->setLabel(new TranslatableMarkup('Description'))
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'text_textarea', 'weight' => 4]);
    $fields['state'] = BaseFieldDefinition::create('state')
      ->setLabel(new TranslatableMarkup('State'))
      ->setSetting('workflow_callback', self::class . '::workflowCallback')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'state_machine_buttons', 'weight' => 5])
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('view', ['type' => 'bb_state_label', 'weight' => 5]);
    // Named ticket_type, not type: JSON:API reserves `type`.
    $fields['ticket_type'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Ticket type'))
      ->setSetting('target_type', 'bb_term')
      ->setSetting('handler', 'bb_label_in_entity_workspace')
      ->setSetting('handler_settings', ['target_bundles' => ['type' => 'type']])
      ->addConstraint('BbTicketLabelWorkspace')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE);
    $fields['recipe'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Recipe'))
      ->setSetting('target_type', 'bb_term')
      ->setSetting('handler', 'bb_label_in_entity_workspace')
      ->setSetting('handler_settings', ['target_bundles' => ['recipe' => 'recipe']])
      ->addConstraint('BbTicketLabelWorkspace')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE);
    $fields['labels'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Labels'))
      ->setSetting('target_type', 'bb_term')
      ->setSetting('handler', 'bb_label_in_entity_workspace')
      ->setSetting('handler_settings', ['target_bundles' => ['label' => 'label']])
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      // A term must belong to the ticket's own workspace. The
      // read scope narrows what a term collection returns and does not stop a
      // write, so the rule needs its own constraint.
      ->addConstraint('BbTicketLabelWorkspace')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete_tags', 'weight' => 6]);
    $fields['assignee_user_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Assignee user'))
      ->setSetting('target_type', 'user')
      // Core's UserSelection would offer every account on the instance; OG
      // ships no query access, so only this handler scopes users to the
      // ticket's workspace.
      ->setSetting('handler', 'bb_assignee_in_ticket_workspace')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete', 'weight' => 7]);
    $fields['reviewers'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Reviewers'))
      ->setSetting('target_type', 'user')
      ->setSetting('handler', 'bb_assignee_in_ticket_workspace')
      ->setSetting('handler_settings', ['include_anonymous' => FALSE])
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('form', [
        'type' => 'entity_reference_autocomplete_tags',
        'weight' => 8,
      ]);
    $fields['conductor_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Conductor'))
      ->setDescription(new TranslatableMarkup("The conductor this ticket is assigned to. Assigning a conductor is what starts a run, and it fills an empty user assignee with the conductor's owner; an assignee that is already set is never overwritten."))
      ->setSetting('target_type', 'bb_conductor')
      ->setSetting('handler', 'bb_conductor_by_ticket_project')
      ->addConstraint('BbConductorProjectMatch')
      ->addConstraint('BbConductorActive')
      ->addConstraint('BbConductorOwnerAccess')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('form', ['type' => 'options_select', 'weight' => 8]);
    // Server-owned: set only by TicketTemplateInstantiator, never by a
    // client (see BbTicketAccessControlHandler::SERVER_DERIVED_FIELDS).
    $fields['template_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Template'))
      ->setDescription(new TranslatableMarkup('The ticket template this ticket was generated from, if any.'))
      ->setSetting('target_type', 'bb_ticket_template')
      ->setDisplayConfigurable('view', TRUE);
    // Three-level priority. Stored as an integer column (list_integer keeps
    // the int storage, so no schema change), constrained to an allowed-values
    // map. The level→int mapping is forced by dispatch ordering
    // (TicketClaimService::compareCandidates sorts "priority asc, null last"):
    // High is most urgent, null = no priority = dispatched last.
    $fields['priority'] = BaseFieldDefinition::create('list_integer')
      ->setLabel(new TranslatableMarkup('Priority'))
      ->setSetting('allowed_values', [1 => 'High', 2 => 'Medium', 3 => 'Low'])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'options_select', 'weight' => 10]);
    // Accounted time in seconds, agent-proposed and human-confirmed — not the
    // bb_run footprint. No 0 default: unset means "not accounted".
    $fields['time_estimate'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('Estimated time'))
      ->setDescription(new TranslatableMarkup('Estimated effort in seconds, proposed at qualification and confirmed by a human.'))
      ->setSetting('min', 0)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('form', ['type' => 'number', 'weight' => 11])
      ->setDisplayOptions('view', ['type' => 'number_integer', 'label' => 'inline', 'weight' => 11]);
    $fields['time_spent'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('Spent time'))
      ->setDescription(new TranslatableMarkup('Accounted effort in seconds, proposed at review from the ticket runs and confirmed by a human.'))
      ->setSetting('min', 0)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('form', ['type' => 'number', 'weight' => 12])
      ->setDisplayOptions('view', ['type' => 'number_integer', 'label' => 'inline', 'weight' => 12]);
    return $fields + self::relationFields() + self::operationsFields()
      + BbTicketFieldMap::computedAndLifecycle();
  }

  /**
   * How this ticket relates to other tickets, and to what produced it.
   *
   * Split out of {@see baseFieldDefinitions()} to keep it under phpmd's
   * ExcessiveMethodLength threshold.
   *
   * @return array<string, \Drupal\Core\Field\BaseFieldDefinition>
   *   The relation fields, keyed by name.
   */
  private static function relationFields(): array {
    $fields = [];
    $fields['health'] = BaseFieldDefinition::create('list_string')
      ->setLabel(new TranslatableMarkup('Health'))
      ->setReadOnly(TRUE)
      ->setSetting('allowed_values', ['healthy' => 'Healthy', 'warning' => 'Warning', 'critical' => 'Critical']);
    $fields['health_reason'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Health reason'))
      ->setReadOnly(TRUE);
    $fields['health_moved'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Last real movement'))
      ->setReadOnly(TRUE);
    $fields['health_checked'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Health evaluated'))
      ->setReadOnly(TRUE);

    $fields['parent_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Parent ticket'))
      ->setSetting('target_type', 'bb_ticket')
      ->addConstraint('BbParentAcyclic')
      ->addConstraint('BbParentSameProject')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete', 'weight' => 12]);
    $fields['blocked_by'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Blocked by'))
      ->setSetting('target_type', 'bb_ticket')
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      ->addConstraint('BbBlockedByAcyclic')
      ->addConstraint('BbParentSameProject', ['message' => "Choose open blocking tickets from this ticket's project."])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete', 'weight' => 13])
      // View-displayable so the ticket_detail full display can map the
      // blocked_by slot to this field via a display_builder formatter source
      // (entity_reference_entity_view, teaser) — mirrors sub_tickets.
      ->setDisplayConfigurable('view', TRUE);
    $fields['referenced_tickets'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Referenced tickets'))
      ->setDescription(new TranslatableMarkup('Tickets carried by this deployment (the release batch). Set when the deployment is planned. The environments of the deployment say where they are deployed; the carried tickets are not stamped.'))
      ->setSetting('target_type', 'bb_ticket')
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete_tags', 'weight' => 14])
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('view', ['type' => 'entity_reference_label', 'label' => 'above', 'weight' => 14]);
    $fields['origin'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Origin URL'))
      ->setSetting('max_length', 2048)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 8]);
    // Core's `link` formatter; the settings are spelled out because
    // LinkFormatter::defaultSettings() returns strings its own schema types as
    // integer/boolean, which fails strict schema checks on the shipped
    // displays (https://www.drupal.org/project/drupal/issues/3101714, fixed on
    // main only). preSave() still stores `options.bakers.kind` for typed links.
    $fields['links'] = BaseFieldDefinition::create('link')
      ->setLabel(new TranslatableMarkup('Links'))
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'link_default', 'weight' => 14])
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('view', [
        'type' => 'link',
        'label' => 'above',
        'weight' => 14,
        'settings' => [
          'trim_length' => 80,
          'url_only' => FALSE,
          'url_plain' => FALSE,
        ],
      ]);
    return $fields;
  }

  /**
   * What running the work on this ticket needs, and what it measured.
   *
   * The second half of {@see baseFieldDefinitions()}'s ExcessiveMethodLength
   * split — see {@see relationFields()} for why the method was cut at all.
   *
   * @return array<string, \Drupal\Core\Field\BaseFieldDefinition>
   *   The operations fields, keyed by name.
   */
  private static function operationsFields(): array {
    $fields = [];
    // Ticket success metrics. A reusable multi-value bb_metric
    // field: arbitrary named metrics {name, value, unit?, recorded?}. Agent-
    // writable in session scope (no new permission — see
    // BbTicketAccessControlHandler) and aggregatable via the type-level Views
    // handlers. A new metric name needs no schema change (free-string name).
    $fields['metrics'] = BaseFieldDefinition::create('bb_metric')
      ->setLabel(new TranslatableMarkup('Metrics'))
      ->setDescription(new TranslatableMarkup('Named success metrics for this ticket.'))
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'bb_metric_default', 'weight' => 40])
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('view', ['type' => 'bb_metric_default', 'label' => 'above', 'weight' => 40]);
    // Holds no secrets: viewing follows ordinary ticket field access, with no
    // dedicated gate.
    // @see \Drupal\Tests\bb_core\Kernel\TicketEnvVarsFieldAccessTest
    $fields['env_vars'] = BaseFieldDefinition::create('string_long')
      ->setLabel(new TranslatableMarkup('Environment variables'))
      ->setDescription(new TranslatableMarkup('.env-style KEY=value lines (one per line, # comments allowed). Inherited by sub-tickets; injected into hooks + the agent by the conductor. Readable by anyone who can view this ticket.'))
      ->setDisplayOptions('form', ['type' => 'string_textarea', 'weight' => 16, 'settings' => ['rows' => 5]])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE);
    $fields['effective_env_vars'] = BaseFieldDefinition::create('string_long')
      ->setLabel(new TranslatableMarkup('Effective environment variables'))
      ->setDescription(new TranslatableMarkup('env_vars resolved along the parent chain (child wins). Computed, read-only.'))
      ->setComputed(TRUE)
      ->setClass(EffectiveEnvVarsItemList::class)
      ->setDisplayConfigurable('view', TRUE);
    $fields['environments'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Environments'))
      ->setDescription(new TranslatableMarkup('The managed environments this ticket concerns.'))
      ->setSetting('target_type', 'bb_environment')
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      // An environment must belong to the ticket's own project.
      // bb_environment is unique per project, so this a one-hop check
      // against the ticket's own project_id.
      ->addConstraint('BbTicketEnvironmentProject')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete_tags', 'weight' => 15])
      ->setDisplayOptions('view', ['type' => 'entity_reference_label', 'label' => 'above', 'weight' => 15]);
    return $fields;
  }

  /**
   * Default-value callback for the identifier field.
   *
   * Applied during entity initialisation (before validation) when no identifier
   * was provided — i.e. for tickets not created by the GitLab importer, which
   * sets its own deterministic identifier. Shape "<project-slug>-<short-uuid>":
   * readable, scoped to the project, and collision-free via the uuid segment
   * (no sequence query, so no race against the UniqueField constraint).
   *
   * Uppercase because the `/{workspace}/ticket/{identifier}` param converter
   * normalises with strtoupper() and matches exactly.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $entity
   *   The ticket the default is being computed for.
   *
   * @return array
   *   A single field value: [['value' => '<identifier>']].
   */
  public static function defaultIdentifier(ContentEntityInterface $entity): array {
    $project = $entity instanceof BbTicketInterface ? $entity->getProject() : NULL;
    $slug = preg_replace('/[^a-z0-9]+/', '-', mb_strtolower((string) ($project?->label() ?? '')));
    $slug = trim((string) $slug, '-') ?: 'bakers';
    return [['value' => mb_strtoupper($slug . '-' . substr((string) $entity->uuid(), 0, 8))]];
  }

  /**
   * {@inheritdoc}
   */
  public function getIdentifier(): string {
    return (string) $this->get('identifier')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function setIdentifier(string $identifier): static {
    $this->set('identifier', $identifier);
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function getWorkflow(): string {
    return (string) $this->get('workflow')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function getTitle(): string {
    return (string) $this->get('title')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function setTitle(string $title): static {
    $this->set('title', $title);
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function getState(): StateItemInterface {
    $state = $this->get('state')->first();
    assert($state instanceof StateItemInterface);
    return $state;
  }

  /**
   * {@inheritdoc}
   */
  public function getProjectId(): ?int {
    if ($this->get('project_id')->isEmpty()) {
      return NULL;
    }
    $value = $this->get('project_id')->target_id;
    return is_numeric($value) ? (int) $value : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getProject(): ?BbProjectInterface {
    $entity = $this->get('project_id')->entity;
    return $entity instanceof BbProjectInterface ? $entity : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getConductor(): ?BbConductorInterface {
    $entity = $this->get('conductor_id')->entity;
    return $entity instanceof BbConductorInterface ? $entity : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function setConductor(?BbConductorInterface $conductor): static {
    $this->set('conductor_id', $conductor?->id());
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function getPriority(): ?int {
    $value = $this->get('priority')->value;
    return $value === NULL ? NULL : (int) $value;
  }

  /**
   * {@inheritdoc}
   */
  public function hasOpenBlockers(): bool {
    $storage = $this->entityTypeManager()->getStorage('bb_ticket');
    foreach ($this->getBlockedByIds() as $blocker_id) {
      $blocker = $storage->load($blocker_id);
      if ($blocker instanceof BbTicketInterface && $blocker->isBlocking()) {
        return TRUE;
      }
    }
    return FALSE;
  }

  /**
   * {@inheritdoc}
   */
  public function isBlocking(): bool {
    return !in_array((string) $this->get('state')->value, ['done', 'cancelled'], TRUE);
  }

  /**
   * {@inheritdoc}
   */
  public function getParentId(): ?int {
    if ($this->get('parent_id')->isEmpty()) {
      return NULL;
    }
    $value = $this->get('parent_id')->target_id;
    return is_numeric($value) ? (int) $value : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getBlockedByIds(): array {
    $ids = [];
    foreach ($this->get('blocked_by') as $item) {
      $target_id = $item->getValue()['target_id'] ?? NULL;
      if (is_numeric($target_id)) {
        $ids[] = (int) $target_id;
      }
    }
    return $ids;
  }

  /**
   * {@inheritdoc}
   */
  public function getReferencedTickets(): array {
    return $this->get('referenced_tickets')->referencedEntities();
  }

  /**
   * {@inheritdoc}
   */
  public function isFrozen(): bool {
    return (bool) $this->get('frozen')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function setFrozen(bool $frozen): static {
    $this->set('frozen', $frozen);
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function getFrozenAt(): ?int {
    $value = $this->get('frozen_at')->value;
    return $value === NULL ? NULL : (int) $value;
  }

  /**
   * {@inheritdoc}
   */
  public function isClosed(): bool {
    return (bool) $this->get('closed')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function getClosedDate(): ?int {
    $value = $this->get('closed_date')->value;
    return $value === NULL ? NULL : (int) $value;
  }

  /**
   * {@inheritdoc}
   */
  public function markClosed(int $timestamp): static {
    $this->set('closed', TRUE);
    $this->set('closed_date', $timestamp);
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function isCleanedUp(): bool {
    return (bool) $this->get('cleaned_up')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function getCleanedUpDate(): ?int {
    $value = $this->get('cleaned_up_date')->value;
    return $value === NULL ? NULL : (int) $value;
  }

  /**
   * {@inheritdoc}
   */
  public function markCleanedUp(): static {
    $this->set('cleaned_up', TRUE);
    return $this;
  }

  /**
   * The general phase of this ticket, or NULL when its state has drifted.
   *
   * The phase comes from `bb_core.workflows.yml` via TypeWorkflows. The
   * list rail asks `hasBbConductor()` for occupancy and this method
   * only for the review exception. The `Bb` infix satisfies the
   * Twig sandbox without colliding with contrib methods. A state that
   * drifted out of its workflow yields NULL rather than letting `phase()`
   * throw and a listing 500.
   *
   * @return string|null
   *   One of `TypeWorkflows::PHASES`, or NULL when this ticket's stored state
   *   is not defined by its stored workflow.
   */
  public function getBbPhase(): ?string {
    $workflow = (string) ($this->get('workflow')->value ?? '');
    $state = (string) ($this->get('state')->value ?? '');
    if (TypeWorkflows::stateMetadata($workflow, $state) === []) {
      return NULL;
    }
    return TypeWorkflows::phase($workflow, $state);
  }

  /**
   * {@inheritdoc}
   */
  public function hasBbConductor(): bool {
    return !$this->get('conductor_id')->isEmpty();
  }

}
