<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Component\Utility\Unicode;
use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\Field\TypedData\FieldItemDataDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\EntityPermissionProvider;
use Drupal\file\FileInterface;
use Drupal\bb_core\Access\BbOwnerGrantQueryAccessHandler;
use Drupal\bb_core\Access\BbRunAccessControlHandler;
use Drupal\bb_core\Form\BbContentEntityDeleteForm;
use Drupal\bb_core\Form\BbRunForm;
use Drupal\bb_core\ListBuilder\BbRunListBuilder;
use Drupal\bb_core\Routing\BbRunRouteProvider;
use Drupal\bb_core\RunLog\RunLogException;
use Drupal\bb_core\RunLog\RunLogPolicy;
use Drupal\bb_core\RunLog\RunLogStorageAllowedItemList;
use Drupal\bb_core\RunLog\RunLogStore;
use Drupal\bb_core\RunLog\UncachedBooleanItem;
use Drupal\bb_core\ViewsData\BbRunViewsData;
use Drupal\user\EntityOwnerInterface;
use Drupal\user\EntityOwnerTrait;

/**
 * Represents one execution attempt of a bakers.build ticket by a conductor.
 *
 * A run is created when a conductor claims a ticket from the dispatch queue.
 * It tracks the full lifecycle of that attempt — from the initial 'claimed'
 * state through 'running' and into a terminal state ('done', or 'expired' when
 * a claimed-but-never-started run is reaped past its lease).  The conductor
 * identity, lease timing, and execution context
 * (worktree path, log) are persisted here for auditing.
 */
#[ContentEntityType(
  id: 'bb_run',
  label: new TranslatableMarkup('bakers.build run'),
  label_collection: new TranslatableMarkup('bakers.build runs'),
  label_singular: new TranslatableMarkup('bakers.build run'),
  label_plural: new TranslatableMarkup('bakers.build runs'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'owner' => 'owner_user_id'],
  handlers: [
    'access' => BbRunAccessControlHandler::class,
    // Narrowed to the account's OG read scope by
    // WorkspaceReadScopeSubscriber.
    'query_access' => BbOwnerGrantQueryAccessHandler::class,
    'permission_provider' => EntityPermissionProvider::class,
    'list_builder' => BbRunListBuilder::class,
    'form' => [
      'default' => BbRunForm::class,
      'add' => BbRunForm::class,
      'edit' => BbRunForm::class,
      'delete' => BbContentEntityDeleteForm::class,
    ],
    // Views integration is declared HERE rather than attached by a hook. It
    // came from bb_dashboard's hook_entity_type_alter(), which was a detour:
    // the module that owns the entity is the module that declares its
    // handlers.
    'views_data' => BbRunViewsData::class,
    'route_provider' => ['html' => BbRunRouteProvider::class],
    // Tabs are declared statically in bb_core.links.task.yml. The default
    // provider would synthesise a View/Edit pair from edit-form.
  ],
  // `_workspace` is an INTERNAL prefix that never appears in a URL: the public
  // address is /{workspace}/…, which Drupal's router cannot match directly.
  // BbWorkspacePathProcessor bridges the two forms in both directions.
  links: [
    'canonical' => '/_workspace/{bb_workspace}/ticket/{bb_ticket}/run/{bb_run}',
    'overlay' => '/_workspace/{bb_workspace}/ticket/{bb_ticket}/run/{bb_run}/overlay',
    'add-form' => '/_workspace/{bb_workspace}/run/add',
    'edit-form' => '/_workspace/{bb_workspace}/run/{bb_run}/edit',
    'delete-form' => '/_workspace/{bb_workspace}/run/{bb_run}/delete',
  ],
  admin_permission: 'administer bakers',
  constraints: ['BbRunLogOmission' => []],
  base_table: 'bb_run',
)]
final class BbRun extends BbContentEntityBase implements BbRunInterface, EntityOwnerInterface {

  // owner_user_id is defined in ::baseFieldDefinitions() and written from the
  // conductor at claim time, so ownerBaseFieldDefinitions() is deliberately not
  // called — its current-user default is exactly what R3 forbids here.
  use EntityOwnerTrait;
  use BbBaseFieldsTrait;

  /**
   * Glyph and tone every run state carries, matching the teaser mapping.
   *
   * @var array<string, array{0: string, 1: string}>
   */
  public const STATE_MARKS = [
    'claimed' => ['lock', 'attention'],
    'running' => ['run', 'running'],
    'done' => ['check', 'idle'],
    'expired' => ['clock', 'stale'],
    'failed' => ['alert-triangle', 'critical'],
    'cancelled' => ['x-circle', 'stale'],
  ];

  /**
   * Line appended to error_log when a transcript upload is omitted for size.
   */
  public const LOG_UPLOAD_OMITTED_WARNING = 'Transcript upload omitted because the run-log upload exceeded a size limit.';

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);
    $fields['ticket_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Ticket'))
      // Workspace anchor via ticket → project → group → workspace. Required so
      // a run is never orphaned outside project scope (multi-workspace).
      ->setRequired(TRUE)
      ->setSetting('target_type', 'bb_ticket')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete', 'weight' => 1]);
    $fields['conductor_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Conductor'))
      ->setSetting('target_type', 'bb_conductor')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete', 'weight' => 3]);
    // Denormalised from the conductor so query access is a column comparison
    // rather than a join, and so entity_jsonapi_entity_filter_access() can map
    // it. Written at claim time by TicketClaimService; a conductor that later
    // changes owner deliberately leaves historical runs alone — a run belongs
    // to whoever ran it.
    // Anonymous, i.e. "no owner known" — deliberately NOT the acting account.
    // A default is required rather than optional: core marks the column of an
    // `owner` entity key NOT NULL, so a run created outside the claim path
    // would otherwise fail to save.
    $fields['owner_user_id'] = static::anonymousOwnerBaseFieldDefinition(4);
    $fields['state'] = BaseFieldDefinition::create('state')
      ->setLabel(new TranslatableMarkup('Run state'))
      ->setRequired(TRUE)
      ->setSetting('workflow', 'bb_run')
      ->addConstraint('BbRunLeaseGuard')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'options_select', 'weight' => 4]);
    $fields['claim_expires_at'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Claim expires at'))
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'datetime_timestamp', 'weight' => 5]);
    $fields['state_at_start'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Ticket state at start'))
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 6]);
    $fields['started_at'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Started at'))
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'datetime_timestamp', 'weight' => 7]);
    $fields['heartbeat'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Heartbeat'))
      ->setDescription(new TranslatableMarkup('Last time the owning conductor observed this run alive. Telemetry only; never drives reclaim.'))
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'datetime_timestamp', 'weight' => 10]);
    $fields['worktree_path'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Worktree path'))
      ->setSetting('max_length', 2048)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 8]);
    $fields['agent'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Agent'))
      ->setDescription(new TranslatableMarkup('Id of the agent the conductor chose for this run, for footprint routing. Records which agent ran; not selection state.'))
      ->setSetting('max_length', 255)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 8]);

    // Runtime provenance: which harness, which configured model, and the model
    // the transcript records for the turn that actually ran. Written by the
    // run-owning conductor in the same close PATCH as the footprint metrics, so
    // token spend can be attributed to a model rather than to an opaque agent.
    // Distinct from `agent` above, which stays the harness id finalize routes
    // on; `harness` repeats that value rather than repointing a live field.
    // No default value — an unwritten field must read NULL, so "no runtime was
    // resolved" stays distinguishable from "the runtime was the empty string".
    $runtime = [
      'harness' => new TranslatableMarkup('Harness'),
      'model' => new TranslatableMarkup('Model'),
      'model_version' => new TranslatableMarkup('Model version'),
    ];
    $runtime_weight = 8;
    foreach ($runtime as $runtime_name => $runtime_label) {
      $fields[$runtime_name] = BaseFieldDefinition::create('string')
        ->setLabel($runtime_label)
        ->setSetting('max_length', 255)
        ->setDisplayConfigurable('form', TRUE)
        ->setDisplayConfigurable('view', TRUE)
        ->setDisplayOptions('form', [
          'type' => 'string_textfield',
          'weight' => $runtime_weight,
        ])
        ->setDisplayOptions('view', [
          'type' => 'string',
          'label' => 'inline',
          'weight' => $runtime_weight,
        ]);
      $runtime_weight++;
    }
    $fields['harness']->setDescription(new TranslatableMarkup('Id of the agent harness package that drove the session, e.g. claude or codex.'));
    $fields['model']->setDescription(new TranslatableMarkup("The candidate's configured model, or the raw transcript model id when unconfigured. Empty only when both are unresolved."));
    $fields['model_version']->setDescription(new TranslatableMarkup("The candidate's configured exact version, or the raw transcript model id when unconfigured. Empty only when both are unresolved."));

    // Custom storage: the payload lives in files, and without this flag the
    // deploy's entity-updates step would reinstall the dropped columns.
    $fields['log'] = BaseFieldDefinition::create('text_long')
      ->setLabel(new TranslatableMarkup('Log'))
      ->setCustomStorage(TRUE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'text_textarea', 'weight' => 9]);
    // Failure detail captured when a dispatch/setup error terminalises the run
    // to `failed`: the dispatch exception message plus any relevant
    // hook/herdr stderr. Deliberately a PLAIN text_long (no filter format) — it
    // holds raw operator diagnostics and must sidestep the bb_rich
    // text-format permission gate that every filtered write is subject to.
    $fields['error_log'] = BaseFieldDefinition::create('text_long')
      ->setLabel(new TranslatableMarkup('Error log'))
      ->setDescription(new TranslatableMarkup('Failure detail recorded when the run terminalised to failed (dispatch/setup error + relevant stderr).'))
      ->setCustomStorage(TRUE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayOptions('form', ['type' => 'text_textarea', 'weight' => 13]);

    // The stored payloads and their metadata. `log` and `error_log` above stay
    // WRITABLE — the conductor's finalize/markFailed/appendRunNote PATCHes are
    // unchanged — but preSave() writes whatever is set on them to the
    // referenced private file and clears the field, so no payload is stored on
    // the row. The checksum is what the migration verifies before it clears a
    // legacy value; the byte count lets a listing show a size without opening
    // the file.
    foreach (['log', 'error_log'] as $base) {
      $fields[$base . '_file'] = BaseFieldDefinition::create('entity_reference')
        ->setLabel(new TranslatableMarkup('@base file', ['@base' => $base]))
        ->setSetting('target_type', 'file')
        ->setDisplayConfigurable('view', TRUE);
      $fields[$base . '_sha256'] = BaseFieldDefinition::create('string')
        ->setLabel(new TranslatableMarkup('@base checksum', ['@base' => $base]))
        ->setSetting('max_length', 64);
      $fields[$base . '_bytes'] = BaseFieldDefinition::create('integer')
        ->setLabel(new TranslatableMarkup('@base bytes', ['@base' => $base]))
        ->setSetting('unsigned', TRUE);
    }

    // Read by the conductor at finalize: send the transcript only when TRUE.
    // preSave() asks the same policy again, so a stale read cannot store.
    $fields[RunLogPolicy::RUN_FIELD] = BaseFieldDefinition::create('boolean')
      ->setLabel(new TranslatableMarkup('Run log storage allowed'))
      ->setDescription(new TranslatableMarkup('Whether the transcript of this run may be uploaded and stored now: the deployment flag and the workspace opt-in. Computed, read-only.'))
      ->setComputed(TRUE)
      ->setReadOnly(TRUE)
      ->setClass(RunLogStorageAllowedItemList::class);
    $item_definition = $fields[RunLogPolicy::RUN_FIELD]->getItemDefinition();
    assert($item_definition instanceof FieldItemDataDefinition);
    $item_definition->setClass(UncachedBooleanItem::class);

    $fields['log_upload_omitted'] = BaseFieldDefinition::create('boolean')
      ->setLabel(new TranslatableMarkup('Log upload omitted'))
      ->setCustomStorage(TRUE)
      ->setDefaultValue(FALSE);

    $fields['closed'] = BaseFieldDefinition::create('boolean')
      ->setLabel(new TranslatableMarkup('Closed'))
      ->setDescription(new TranslatableMarkup('Run is fully wound up: transcript captured and finalised. Distinct from the workflow state.'))
      ->setDefaultValue(FALSE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'boolean_checkbox', 'weight' => 11]);
    $fields['closed_date'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Closed date'))
      ->setDescription(new TranslatableMarkup('When the run was finalised.'))
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'datetime_timestamp', 'weight' => 12]);

    // Footprint metrics. Seven plain integer base fields — each with
    // its own column, so each stays a sortable/filterable Views field and is
    // auto-exposed over JSON:API. Written reliably by the run-owning conductor
    // at close (never the agent session, which cannot PATCH bb_run). Rendered
    // read-only in the form's Footprint sidebar group (see BbRunForm).
    $metrics = [
      'tokens' => new TranslatableMarkup('Tokens'),
      'duration_s' => new TranslatableMarkup('Duration in seconds'),
      'agent_turns' => new TranslatableMarkup('Agent turns'),
      'tool_calls' => new TranslatableMarkup('Tool calls'),
      'user_prompts' => new TranslatableMarkup('User prompts'),
      'user_prompt_words' => new TranslatableMarkup('User prompt words'),
      // duration_s minus the human wait; 0 = not measured.
      'active_s' => new TranslatableMarkup('Active time in seconds'),
    ];
    $weight = 20;
    foreach ($metrics as $name => $label) {
      $fields[$name] = BaseFieldDefinition::create('integer')
        ->setLabel($label)
        ->setDefaultValue(0)
        ->setSetting('min', 0)
        ->setDisplayConfigurable('form', TRUE)
        ->setDisplayConfigurable('view', TRUE)
        ->setDisplayOptions('form', ['type' => 'number', 'weight' => $weight])
        ->setDisplayOptions('view', ['type' => 'number_integer', 'label' => 'inline', 'weight' => $weight]);
      $weight++;
    }

    return $fields;
  }

  /**
   * File ids a `log`/`error_log` rewrite just superseded, keyed by base.
   *
   * Populated in preSave(), consumed and cleared in postSave(): the old
   * file is deleted only once the new file and field
   * values are actually committed, never before.
   *
   * @var array<string, int>
   */
  private array $supersededLogFiles = [];

  /**
   * {@inheritdoc}
   */
  public function preSave(EntityStorageInterface $storage): void {
    parent::preSave($storage);
    $this->consumeLogUploadOmission();
    foreach (['log', 'error_log'] as $base) {
      $written = $this->get($base)->value;
      if ($written === NULL || $written === '') {
        continue;
      }
      $payload = (string) $written;
      // Idempotence guard: a re-save of an unchanged payload must not write a
      // second file. The migration in Task 5 saves each run through this
      // path, so without the guard every migrated row would leave an orphan.
      if ($this->get($base . '_sha256')->value === hash('sha256', $payload)) {
        $this->set($base, NULL);
        continue;
      }
      // The file this base pointed to BEFORE this rewrite — e.g.
      // appendRunNote()'s read-modify-write pattern always changes the
      // payload, which repoints `<base>_file` at a brand-new file and would
      // otherwise leave the previous one orphaned (no file_usage record, so
      // core's temporary-file cleanup can never find it either).
      $previous_file_id = $this->get($base . '_file')->target_id;
      $file = \Drupal::service(RunLogStore::class)->write($this, $payload, $base);
      if ($file === NULL) {
        // Storage is off for this run: drop the incoming transcript, keep the
        // previous file and its metadata, and let the rest of the save land.
        $this->set($base, NULL);
        continue;
      }
      $this->set($base . '_file', $file->id());
      $this->set($base . '_sha256', hash('sha256', $payload));
      $this->set($base . '_bytes', strlen($payload));
      // Clear the payload — this is what keeps it out of the row, the entity
      // cache and Search API's entity load.
      $this->set($base, NULL);
      if ($previous_file_id !== NULL && (int) $previous_file_id !== (int) $file->id()) {
        $this->supersededLogFiles[$base] = (int) $previous_file_id;
      }
    }
  }

  /**
   * Reads the stored error log, appends the omission warning, clears the flag.
   *
   * Runs before the log-field write-through so the appended line uses the same
   * store/cleanup path as any other error_log write. An unreadable existing
   * error log throws rather than replacing unknown content.
   */
  private function consumeLogUploadOmission(): void {
    if (!$this->get('log_upload_omitted')->value) {
      return;
    }
    $existing = $this->readErrorLog() ?? '';
    if (!str_contains($existing, self::LOG_UPLOAD_OMITTED_WARNING)) {
      $this->set('error_log', $existing === ''
        ? self::LOG_UPLOAD_OMITTED_WARNING
        : rtrim($existing, "\r\n") . "\n" . self::LOG_UPLOAD_OMITTED_WARNING);
    }
    $this->set('log_upload_omitted', FALSE);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  public function postSave(EntityStorageInterface $storage, $update = TRUE): void {
    parent::postSave($storage, $update);
    if ($this->supersededLogFiles === []) {
      return;
    }
    // Delete only now that the new file and field values are committed — this
    // is cleanup of an artifact this same save already superseded, not
    // deletion of a transcript: the payload it held was fully moved into the
    // new file before this point.
    $file_storage = \Drupal::entityTypeManager()->getStorage('file');
    foreach ($this->supersededLogFiles as $id) {
      $file = $file_storage->load($id);
      $file?->delete();
    }
    $this->supersededLogFiles = [];
  }

  /**
   * {@inheritdoc}
   *
   * The deferred unlink: a run's `log`/`error_log` files carry no
   * `file_usage` record (the comment on `preSave()`'s `$previous_file_id`
   * names why — the write-through path never registers one), so core's own
   * temporary-file cleanup can never find or reap them. Deleting the run
   * without also deleting the two files it referenced would leave them
   * permanently orphaned on disk once the entity itself is gone and nothing
   * else can name them by id. Each entity is disjoint from every other's
   * files (`RunLogStore` keys a run's directory by its own uuid), so a
   * failure on one run's files cannot touch another's.
   */
  public static function postDelete(EntityStorageInterface $storage, array $entities): void {
    parent::postDelete($storage, $entities);
    $file_storage = \Drupal::entityTypeManager()->getStorage('file');
    foreach ($entities as $entity) {
      if (!$entity instanceof self) {
        continue;
      }
      foreach (['log_file', 'error_log_file'] as $field) {
        $file_id = $entity->get($field)->target_id;
        if ($file_id === NULL) {
          continue;
        }
        $file = $file_storage->load($file_id);
        $file?->delete();
      }
    }
  }

  /**
   * {@inheritdoc}
   */
  public function readLog(): ?string {
    return $this->readStored('log_file');
  }

  /**
   * {@inheritdoc}
   */
  public function readErrorLog(): ?string {
    return $this->readStored('error_log_file');
  }

  /**
   * {@inheritdoc}
   */
  public function failureReason(): ?string {
    $line = $this->failureLine();
    return $line === NULL ? NULL : Unicode::truncate($line, 140, FALSE, TRUE);
  }

  /**
   * {@inheritdoc}
   */
  public function failureLine(): ?string {
    if ($this->getRunState() !== 'failed') {
      return NULL;
    }
    $file = $this->get('error_log_file')->entity;
    $line = '';
    try {
      if ($file instanceof FileInterface) {
        $line = \Drupal::service(RunLogStore::class)->firstLine($file, $this);
      }
    }
    catch (RunLogException $e) {
      // One unreadable log must not break the screens that show the reason.
      \Drupal::logger('bb_core')->warning('Run @id: failure reason unreadable: @message', [
        '@id' => $this->id(),
        '@message' => $e->getMessage(),
      ]);
    }
    $line = preg_replace('/^Error: /', '', $line);
    return $line === '' || $line === NULL
      ? (string) new TranslatableMarkup('No reason was recorded. Open the log for details.')
      : $line;
  }

  /**
   * Reads the stored payload referenced by the given file field, if any.
   */
  private function readStored(string $field): ?string {
    $file = $this->get($field)->entity;
    return $file instanceof FileInterface
      ? \Drupal::service(RunLogStore::class)->read($file, $this)
      : NULL;
  }

  /**
   * {@inheritdoc}
   *
   * Nested canonical and overlay templates need `{bb_ticket}`. The parent
   * only fills the workspace slug and this entity's own slot.
   */
  protected function urlRouteParameters($rel) {
    $parameters = parent::urlRouteParameters($rel);
    $template = $this->getEntityType()->getLinkTemplate($rel);
    if (!is_string($template) || !str_contains($template, '{bb_ticket}')) {
      return $parameters;
    }
    $ticket = $this->getTicket();
    if ($ticket === NULL) {
      return $parameters;
    }
    $reference = $ticket->getIdentifier();
    $parameters['bb_ticket'] = $reference !== '' ? mb_strtolower($reference) : $ticket->id();
    return $parameters;
  }

  /**
   * {@inheritdoc}
   */
  public function getTicketId(): ?int {
    if ($this->get('ticket_id')->isEmpty()) {
      return NULL;
    }
    $value = $this->get('ticket_id')->target_id;
    return is_numeric($value) ? (int) $value : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getTicket(): ?BbTicketInterface {
    $entity = $this->get('ticket_id')->entity;
    return $entity instanceof BbTicketInterface ? $entity : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getRunState(): string {
    return (string) $this->get('state')->value;
  }

  /**
   * Sets the raw state field value without applying a state_machine transition.
   *
   * This writes the value directly via $this->set('state', $state). It is NOT
   * an applyTransition() wrapper; state_machine validates the value and
   * BbRunLeaseGuard enforces allowed transitions on entity save.
   *
   * @param string $state
   *   The target state machine state identifier (e.g. 'claimed', 'running').
   *
   * @return static
   *   The called object, for method chaining.
   */
  public function setRunState(string $state): static {
    $this->set('state', $state);
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function getClaimExpiresAt(): ?int {
    $value = $this->get('claim_expires_at')->value;
    return $value === NULL ? NULL : (int) $value;
  }

  /**
   * {@inheritdoc}
   */
  public function getHeartbeat(): ?int {
    $value = $this->get('heartbeat')->value;
    return $value === NULL ? NULL : (int) $value;
  }

  /**
   * {@inheritdoc}
   */
  public function setHeartbeat(int $timestamp): static {
    $this->set('heartbeat', $timestamp);
    return $this;
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
  public function getErrorLog(): ?string {
    // preSave() moves the payload to a file and clears the field, so read
    // through the file-backed path.
    return $this->readErrorLog();
  }

  /**
   * {@inheritdoc}
   */
  public function setErrorLog(string $error_log): static {
    $this->set('error_log', $error_log);
    return $this;
  }

}
