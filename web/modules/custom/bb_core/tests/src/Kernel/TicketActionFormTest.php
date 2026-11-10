<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Form\FormState;
use Drupal\Core\Render\Element;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Ticket\TicketInterventions;
use Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Ticket workflow actions on the detail page and in the in-app Settings.
 *
 * The detail page offers only Cancel ticket and Cancel run, Settings offer no
 * transition, and every submit re-reads the ticket before it writes.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketActionFormTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine', 'views',
    'field', 'og', 'link', 'text', 'filter', 'file', 'image', 'bb_core', 'island',
    'bb_property_access_test',
  ];

  /**
   * The project every ticket belongs to.
   */
  private int $projectId;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_workspace', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_comment', 'bb_run',
      'bb_conductor', 'bb_term', 'bb_environment',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->setUpCurrentUser(['uid' => 1], ['administer bakers']);
    $this->container->get('router.builder')->rebuild();

    $etm = $this->container->get('entity_type.manager');
    $workspace = $etm->getStorage('bb_workspace')->create(['name' => 'Acme', 'slug' => 'acme']);
    $workspace->save();
    $project = $etm->getStorage('bb_project')
      ->create(['name' => 'Platform', 'workspace_id' => $workspace->id()]);
    $project->save();
    $this->projectId = (int) $project->id();
  }

  /**
   * The detail page offers Cancel ticket exactly while the ticket is open.
   */
  #[DataProvider('everyState')]
  public function testTheDetailOffersOnlyCancelWhileTheTicketIsOpen(string $workflow, string $state, bool $open): void {
    $ticket = $this->ticket($workflow, $state);
    self::assertSame($open, TicketInterventions::mayCancelTicket($ticket));
    $form = $this->actionForm($ticket);
    self::assertSame($open ? ['cancel'] : [], $this->transitionsOn($form['actions']));
  }

  /**
   * States of the ticket workflow, open or terminal.
   *
   * @return array<string, array{string, string, bool}>
   *   Workflow, state and whether the ticket can still be cancelled.
   */
  public static function everyState(): array {
    return [
      'work qualification' => ['bb_work', 'qualification', TRUE],
      'work plan' => ['bb_work', 'plan', TRUE],
      'work working' => ['bb_work', 'working', TRUE],
      'work review' => ['bb_work', 'review', TRUE],
      'work done' => ['bb_work', 'done', FALSE],
      'work cancelled' => ['bb_work', 'cancelled', FALSE],
    ];
  }

  /**
   * Settings offer no workflow transition at all: the AI drives the workflow.
   */
  public function testSettingsOfferNoTransition(): void {
    foreach (['qualification', 'plan', 'working', 'review'] as $state) {
      $form = $this->settingsForm($this->ticket('bb_work', $state));
      $transitions = preg_grep('/^bb_transition_/', array_keys($this->buttonLabels($form)));
      self::assertSame([], $transitions, $state);
    }
  }

  /**
   * Update access without state edit access offers no Cancel.
   */
  public function testNoTransitionWithoutStateEditAccess(): void {
    $ticket = $this->ticket('bb_work', 'working');
    $this->container->get('state')->set('bb_property_access_test.denied', ['edit' => ['state']]);

    self::assertFalse(TicketInterventions::mayCancelTicket($ticket));
    self::assertSame([], $this->transitionsOn($this->actionForm($ticket)['actions']));
  }

  /**
   * An illegal transition held in memory is still reported, not filtered.
   *
   * A write sets the target state before validating it. Freezing on that
   * in-memory state would forbid `state` edits and let the field-access
   * filter swallow the violation, so plan → done would pass.
   */
  public function testAnIllegalTransitionIsStillRejected(): void {
    $ticket = $this->ticket('bb_work', 'plan');
    $ticket->set('state', 'done');
    self::assertTrue($ticket->get('state')->access('edit'), 'An unsaved terminal state freezes nothing.');
    $violations = $ticket->validate()->filterByFieldAccess();
    self::assertGreaterThan(0, $violations->count(), 'The illegal transition stays a violation.');
  }

  /**
   * Settings of a closed ticket offer no editable field and no transition.
   */
  public function testSettingsOfClosedTicketsAreReadOnly(): void {
    $ticket = $this->ticket('bb_work', 'done');
    $form = $this->settingsForm($ticket);
    foreach (['title', 'description', 'env_vars'] as $field) {
      self::assertArrayHasKey($field, $form, $field . ' is on the form.');
      self::assertFalse($form[$field]['#access'], $field . ' is not editable.');
    }
    self::assertFalse($form['actions']['submit']['#access'], 'A closed ticket offers no Save.');
  }

  /**
   * Settings keep the description compact: no format help or guidelines.
   */
  public function testSettingsHideTheDescriptionFormatHelp(): void {
    $format = $this->settingsForm($this->ticket('bb_work', 'working'))['description']['widget'][0]['format'];
    self::assertFalse($format['help']['#access']);
    self::assertFalse($format['guidelines']['#access']);
  }

  /**
   * Opening the confirmation writes nothing; confirming cancels the ticket.
   */
  public function testCancelTicketIsConfirmed(): void {
    $ticket = $this->ticket('bb_work', 'plan');
    $this->actionForm($ticket);
    self::assertSame('plan', $this->reload($ticket)->getState()->getId(), 'The confirmation page writes nothing.');

    $this->submit('action', $ticket, $this->postedState('bb_confirm', 'plan'));
    self::assertSame('cancelled', $this->reload($ticket)->getState()->getId());
  }

  /**
   * A confirmation rendered in another state writes nothing.
   */
  public function testStaleConfirmationWritesNothing(): void {
    $ticket = $this->ticket('bb_work', 'working');
    $this->submit('action', $ticket, $this->postedState('bb_confirm', 'plan'));
    self::assertSame('working', $this->reload($ticket)->getState()->getId());
    self::assertNotEmpty($this->container->get('messenger')->messagesByType('error'));
  }

  /**
   * A button that is not on the page never falls back to another action.
   */
  public function testAnAbsentButtonDoesNotTriggerTheFirstOne(): void {
    $ticket = $this->ticket('bb_work', 'working');
    // A forged or stale button name; Drupal would fall back to the first one.
    $this->submit('action', $ticket, $this->postedState('bb_transition_finish', 'working'));
    self::assertSame('working', $this->reload($ticket)->getState()->getId());
  }

  /**
   * Cancel run changes only the named run and leaves the ticket state.
   */
  public function testCancelRunCancelsOnlyThatRun(): void {
    $ticket = $this->ticket('bb_work', 'working');
    $run = $this->createRun($ticket, 'running');
    $other = $this->createRun($this->ticket('bb_work', 'working'), 'running');

    $this->askAboutRun($run);
    $form = $this->actionForm($ticket);
    self::assertSame(['run'], array_map(
      static fn(array $action): string => $action['kind'],
      $this->actionsOn($form['actions']),
    ));
    $question = (string) $form['question']['#slots']['body']['#plain_text'];
    self::assertStringContainsString('Run #' . $run->id() . ' stops', $question, 'The dialog names the run.');
    self::assertStringContainsString('the conductor may start another run', $question, 'The dialog names the consequence.');
    $this->submit('action', $ticket, $this->postedState('bb_confirm', NULL));
    self::assertSame('cancelled', $this->reloadRun($run)->getRunState());
    self::assertSame('running', $this->reloadRun($other)->getRunState());
    self::assertSame('working', $this->reload($ticket)->getState()->getId(), 'Cancel run leaves the ticket state.');
  }

  /**
   * A confirmation for a run that ended never cancels its replacement.
   */
  public function testReplacedRunIsNotCancelled(): void {
    $ticket = $this->ticket('bb_work', 'working');
    $old = $this->createRun($ticket, 'claimed');
    $this->askAboutRun($old);
    $state = $old->get('state')->first();
    self::assertInstanceOf(StateItemInterface::class, $state);
    $state->applyTransitionById('expire');
    $old->save();
    $replacement = $this->createRun($ticket, 'claimed');

    $this->submit('action', $ticket, $this->postedState('bb_confirm', NULL));
    self::assertSame('claimed', $this->reloadRun($replacement)->getRunState());
    self::assertSame('expired', $this->reloadRun($old)->getRunState());
    self::assertSame('working', $this->reload($ticket)->getState()->getId(), 'Nor does it fall back to cancelling the ticket.');
  }

  /**
   * Another ticket's run cannot be cancelled through this ticket.
   */
  public function testForeignRunIsRefused(): void {
    $ticket = $this->ticket('bb_work', 'working');
    $foreign = $this->createRun($this->ticket('bb_work', 'working'), 'running');
    $this->askAboutRun($foreign);
    self::assertFalse(TicketInterventions::mayCancelRun($foreign, $ticket));
    $this->submit('action', $ticket, $this->postedState('bb_confirm', NULL));
    self::assertSame('running', $this->reloadRun($foreign)->getRunState());
    self::assertSame('working', $this->reload($ticket)->getState()->getId());
  }

  /**
   * An account without ticket or run update access cancels nothing.
   */
  public function testNoCancelWithoutUpdateAccess(): void {
    $ticket = $this->ticket('bb_work', 'working');
    $run = $this->createRun($ticket, 'running');
    $viewer = $this->createUser();
    self::assertNotFalse($viewer);
    $this->setCurrentUser($viewer);

    self::assertFalse(TicketInterventions::mayCancelTicket($this->reload($ticket)));
    self::assertFalse(TicketInterventions::mayCancelRun($this->reloadRun($run), $this->reload($ticket)));
    $this->askAboutRun($run);
    $this->submit('action', $ticket, $this->postedState('bb_confirm', NULL));
    $this->submit('action', $ticket, $this->postedState('bb_confirm', 'working'));
    self::assertSame('running', $this->reloadRun($run)->getRunState());
    self::assertSame('working', $this->reload($ticket)->getState()->getId());
  }

  /**
   * Only claimed and running runs can be cancelled.
   */
  public function testOnlyActiveRunsCanBeCancelled(): void {
    $ticket = $this->ticket('bb_work', 'working');
    self::assertTrue(TicketInterventions::mayCancelRun($this->createRun($ticket, 'claimed'), $ticket));
    self::assertTrue(TicketInterventions::mayCancelRun($this->createRun($ticket, 'running'), $ticket));
    foreach (['done', 'failed', 'expired', 'cancelled'] as $state) {
      self::assertFalse(TicketInterventions::mayCancelRun($this->createRun($ticket, $state), $ticket), $state);
    }
  }

  /**
   * Confirming Retry stamps the request and changes nothing else.
   */
  public function testRetryConfirmationRequestsRetry(): void {
    [$ticket, $run] = $this->failedRunOnAssignedTicket();
    $this->askRunAction($run, TicketInterventions::RETRY);
    $form = $this->actionForm($ticket);
    self::assertStringContainsString('claims', (string) $form['question']['#slots']['body']['#plain_text']);
    self::assertStringContainsString('the new run appears in Run history.', (string) $form['question']['#slots']['body']['#plain_text']);
    self::assertNull($this->container->get('bb_core.ticket_retry')->requestedAt($ticket), 'The dialog writes nothing.');

    $this->submit('action', $ticket, $this->postedState('bb_confirm', NULL));
    self::assertSame(
      $this->container->get('datetime.time')->getRequestTime(),
      $this->container->get('bb_core.ticket_retry')->requestedAt($ticket),
    );
    self::assertSame(['Retry requested.'], array_map('strval', $this->container->get('messenger')->messagesByType('status')));
    self::assertSame((int) $ticket->getConductor()?->id(), (int) $this->reload($ticket)->get('conductor_id')->target_id);
  }

  /**
   * Confirming Re-dispatch hands the ticket to the chosen conductor.
   */
  public function testRedispatchMovesTheTicketToTheChosenConductor(): void {
    [$ticket, $run] = $this->failedRunOnAssignedTicket();
    $other = $this->adminConductor('other');
    $this->askRunAction($run, TicketInterventions::REDISPATCH);
    $form = $this->actionForm($ticket);
    self::assertStringContainsString('Choose the conductor that takes over', (string) $form['question']['#slots']['body']['#plain_text']);

    $this->submit('action', $ticket, $this->postedState('bb_confirm', NULL)->setValue('conductor', (string) $other->id()));
    self::assertSame((int) $other->id(), (int) $this->reload($ticket)->get('conductor_id')->target_id);
    self::assertNotNull($this->container->get('bb_core.ticket_retry')->requestedAt($ticket));
    $label = $ticket->getIdentifier() !== '' ? $ticket->getIdentifier() : (string) $ticket->label();
    self::assertSame([$label . ' moved to ' . $other->label() . '.'], array_map('strval', $this->container->get('messenger')->messagesByType('status')));
  }

  /**
   * A conductor the picker did not offer is never assigned.
   */
  public function testRedispatchRefusesConductorOutsideThePicker(): void {
    [$ticket, $run] = $this->failedRunOnAssignedTicket();
    $this->adminConductor('other');
    $this->askRunAction($run, TicketInterventions::REDISPATCH);
    $current = (int) $ticket->getConductor()?->id();

    $this->submit('action', $ticket, $this->postedState('bb_confirm', NULL)->setValue('conductor', (string) $current));
    self::assertSame($current, (int) $this->reload($ticket)->get('conductor_id')->target_id);
    self::assertNull($this->container->get('bb_core.ticket_retry')->requestedAt($ticket));
    self::assertNotEmpty($this->container->get('messenger')->messagesByType('error'));
  }

  /**
   * The edit address is the in-app Settings screen, never the admin theme.
   */
  public function testTheEditRouteIsTheInAppSettings(): void {
    $provider = $this->container->get('router.route_provider');
    $edit = $provider->getRouteByName('entity.bb_ticket.edit_form');
    self::assertSame('bb_ticket.settings', $edit->getDefault('_entity_form'));
    self::assertFalse((bool) $edit->getOption('_admin_route'));
    self::assertFalse((bool) $provider->getRouteByName('entity.bb_ticket.delete_form')->getOption('_admin_route'));
  }

  /**
   * An open ticket with update access offers freeze.
   */
  public function testOpenTicketOffersFreeze(): void {
    $ticket = $this->ticket('bb_work', 'working');
    self::assertTrue(TicketInterventions::mayFreeze($ticket));
    self::assertFalse(TicketInterventions::mayUnfreeze($ticket));
  }

  /**
   * A frozen ticket offers unfreeze instead of freeze.
   */
  public function testFrozenTicketOffersUnfreeze(): void {
    $ticket = $this->ticket('bb_work', 'working');
    $ticket->setFrozen(TRUE)->save();
    $ticket = $this->reload($ticket);
    self::assertFalse(TicketInterventions::mayFreeze($ticket));
    self::assertTrue(TicketInterventions::mayUnfreeze($ticket));
  }

  /**
   * Opening the freeze confirmation writes nothing; confirming freezes it.
   */
  public function testFreezeTicketIsConfirmed(): void {
    $ticket = $this->ticket('bb_work', 'working');
    $this->askFreeze(TRUE);
    $form = $this->actionForm($ticket);
    self::assertStringContainsString('Its active run is ended.', (string) $form['question']['#slots']['body']['#plain_text'], 'The dialog names the consequence.');
    self::assertFalse($this->reload($ticket)->isFrozen(), 'The confirmation page writes nothing.');

    $this->submit('action', $ticket, $this->postedState('bb_confirm', NULL));
    self::assertTrue($this->reload($ticket)->isFrozen());
  }

  /**
   * Confirming unfreeze clears frozen.
   */
  public function testUnfreezeTicketIsConfirmed(): void {
    $ticket = $this->ticket('bb_work', 'working');
    $ticket->setFrozen(TRUE)->save();
    $this->askFreeze(FALSE);
    $this->submit('action', $ticket, $this->postedState('bb_confirm', NULL));
    self::assertFalse($this->reload($ticket)->isFrozen());
  }

  /**
   * Two identical freeze posts leave the ticket frozen.
   */
  public function testFreezeIsIdempotent(): void {
    $ticket = $this->ticket('bb_work', 'working');
    $this->askFreeze(TRUE);
    $this->submit('action', $ticket, $this->postedState('bb_confirm', NULL));
    $this->submit('action', $ticket, $this->postedState('bb_confirm', NULL));
    self::assertTrue($this->reload($ticket)->isFrozen());
  }

  /**
   * An account without ticket update access freezes nothing.
   */
  public function testNoFreezeWithoutUpdateAccess(): void {
    $ticket = $this->ticket('bb_work', 'working');
    $viewer = $this->createUser();
    self::assertNotFalse($viewer);
    $this->setCurrentUser($viewer);

    self::assertFalse(TicketInterventions::mayFreeze($this->reload($ticket)));
    $this->askFreeze(TRUE);
    $this->submit('action', $ticket, $this->postedState('bb_confirm', NULL));
    self::assertFalse($this->reload($ticket)->isFrozen());
  }

  /**
   * Settings carry title, description, env vars and the two relation fields.
   *
   * BB-664 added `parent_id` and `blocked_by`: editable relations an
   * operator may need to correct outside the create dialog's own picker.
   * `team` is gone from the list entirely — the base field itself was
   * removed, not merely hidden here.
   */
  public function testTheSettingsDisplayCarriesOnlyTheApprovedFields(): void {
    $root = dirname(DRUPAL_ROOT);
    $name = 'core.entity_form_display.bb_ticket.bb_ticket.settings.yml';
    foreach (['/recipes/bakers/config/', '/config/sync/'] as $directory) {
      $display = Yaml::decode((string) file_get_contents($root . $directory . $name));
      $content = $display['content'];
      ksort($content);
      self::assertSame(['blocked_by', 'description', 'env_vars', 'parent_id', 'title'], array_keys($content), $directory);
      $removed = [
        'conductor_id', 'environments', 'cleaned_up', 'cleaned_up_date', 'metrics',
        'owner_user_id', 'workflow', 'state', 'project_id', 'assignee_user_id',
        'links', 'origin', 'time_spent', 'time_estimate', 'labels',
        'referenced_tickets', 'priority',
        'frozen', 'stall_reason',
      ];
      foreach ($removed as $field) {
        self::assertTrue($display['hidden'][$field] ?? FALSE, $field . ' is hidden');
      }
    }
  }

  /**
   * Parent and blocked-by are real, enabled widgets on the built form.
   */
  public function testParentAndBlockedByAreEditableOnTheSettingsForm(): void {
    $ticket = $this->ticket('bb_work', 'working');

    $form = $this->settingsForm($ticket);

    foreach (['parent_id', 'blocked_by'] as $field) {
      self::assertArrayHasKey($field, $form, $field . ' is on the built form.');
      self::assertNotFalse($form[$field]['#access'] ?? TRUE, $field . ' is not hidden by access.');
    }
  }

  /**
   * A ticket in a workflow state.
   */
  private function ticket(string $workflow, string $state): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'workflow' => $workflow,
      'title' => $workflow . ' ' . $state,
      'state' => $state,
      'project_id' => $this->projectId,
    ]);
    assert($ticket instanceof BbTicketInterface);
    $ticket->save();
    return $ticket;
  }

  /**
   * A run of a ticket in a run state.
   */
  private function createRun(BbTicketInterface $ticket, string $state): BbRunInterface {
    $etm = $this->container->get('entity_type.manager');
    $owner = $etm->getStorage('user')->create(['name' => $this->randomMachineName()]);
    $owner->save();
    $conductor = $etm->getStorage('bb_conductor')->create([
      'conductor_id' => $this->randomMachineName(),
      'label' => 'srv',
      'owner_user_id' => $owner->id(),
      'status' => 'online',
      'project_id' => $this->projectId,
      'last_seen' => $this->container->get('datetime.time')->getRequestTime(),
    ]);
    $conductor->save();
    $run = $etm->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => $state,
      'state_at_start' => (string) $ticket->getState()->getId(),
      'started_at' => 1770000000,
    ]);
    assert($run instanceof BbRunInterface);
    $run->save();
    return $run;
  }

  /**
   * A conductor of the project that its owner, uid 1, may work for.
   */
  private function adminConductor(string $name): BbConductorInterface {
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => $name,
      'label' => $name,
      'owner_user_id' => 1,
      'status' => 'online',
      'project_id' => $this->projectId,
      'last_seen' => $this->container->get('datetime.time')->getRequestTime(),
    ]);
    assert($conductor instanceof BbConductorInterface);
    $conductor->save();
    return $conductor;
  }

  /**
   * A working ticket on a conductor, with its newest run failed.
   *
   * @return array{0: \Drupal\bb_core\Entity\BbTicketInterface, 1: \Drupal\bb_core\Entity\BbRunInterface}
   *   The ticket and the failed run.
   */
  private function failedRunOnAssignedTicket(): array {
    $ticket = $this->ticket('bb_work', 'working');
    $ticket->setConductor($this->adminConductor('first'))->save();
    return [$this->reload($ticket), $this->createRun($ticket, 'failed')];
  }

  /**
   * Puts a run and a run action on the request, as the dialog link does.
   */
  private function askRunAction(BbRunInterface $run, string $action): void {
    $query = $this->container->get('request_stack')->getCurrentRequest()->query;
    $query->set(TicketInterventions::RUN_PARAMETER, $run->uuid());
    $query->set(TicketInterventions::RUN_ACTION_PARAMETER, $action);
  }

  /**
   * The built action form of a ticket.
   *
   * @return array<string, mixed>
   *   The form.
   */
  private function actionForm(BbTicketInterface $ticket): array {
    return $this->container->get('entity.form_builder')->getForm($this->reload($ticket), 'action');
  }

  /**
   * The built Settings form of a ticket.
   *
   * @return array<string, mixed>
   *   The form.
   */
  private function settingsForm(BbTicketInterface $ticket): array {
    return $this->container->get('entity.form_builder')->getForm($this->reload($ticket), 'settings');
  }

  /**
   * The actions the buttons of a form element stand for, in order.
   *
   * @param array<string, mixed> $element
   *   A form or container.
   *
   * @return array<int, array<string, string>>
   *   The actions.
   */
  private function actionsOn(array $element): array {
    $actions = [];
    foreach (Element::children($element) as $key) {
      if (isset($element[$key]['#bb_action'])) {
        $actions[] = $element[$key]['#bb_action'];
      }
    }
    return $actions;
  }

  /**
   * The transition ids a form element offers, in order.
   *
   * @param array<string, mixed> $element
   *   A form or container.
   *
   * @return array<string>
   *   The transition ids.
   */
  private function transitionsOn(array $element): array {
    return array_column(array_filter(
      $this->actionsOn($element),
      static fn(array $action): bool => $action['kind'] === 'ticket',
    ), 'transition');
  }

  /**
   * Puts a run on the current request, as a run row's confirmation link does.
   */
  private function askAboutRun(BbRunInterface $run): void {
    $this->container->get('request_stack')->getCurrentRequest()->query->set(TicketInterventions::RUN_PARAMETER, $run->uuid());
  }

  /**
   * Puts a freeze target on the request, as a Freeze/Unfreeze link does.
   */
  private function askFreeze(bool $frozen): void {
    $this->container->get('request_stack')->getCurrentRequest()->query->set(
      TicketInterventions::FREEZE_PARAMETER,
      $frozen ? '1' : '0',
    );
  }

  /**
   * A POST form state whose input holds one button and the rendered state.
   */
  private function postedState(string $button, ?string $from): FormState {
    $input = [$button => 'x'];
    if ($from !== NULL) {
      $input['bb_from_state'] = $from;
    }
    return (new FormState())->setRequestMethod('POST')->setValues($input);
  }

  /**
   * Submits a ticket form operation programmatically.
   */
  private function submit(string $operation, BbTicketInterface $ticket, FormState $form_state): void {
    $form = $this->container->get('entity_type.manager')->getFormObject('bb_ticket', $operation);
    $form->setEntity($this->reload($ticket));
    // The posted button value must equal the rendered label to be matched.
    $render_state = (new FormState())->setRequestMethod('POST');
    $labels = $this->buttonLabels($this->container->get('form_builder')->buildForm($form, $render_state));
    $values = $form_state->getValues();
    foreach (array_intersect_key($labels, $values) as $name => $label) {
      $values[$name] = $label;
    }
    $form_state->setValues($values);
    $form->setEntity($this->reload($ticket));
    $this->container->get('form_builder')->submitForm($form, $form_state);
  }

  /**
   * Every submit button's label in a built form, keyed by button name.
   *
   * @param array<string, mixed> $element
   *   A built form or part of one.
   *
   * @return array<string, string>
   *   Labels by name.
   */
  private function buttonLabels(array $element): array {
    $labels = [];
    if (($element['#type'] ?? '') === 'submit' && isset($element['#name'])) {
      $labels[$element['#name']] = (string) $element['#value'];
    }
    foreach (Element::children($element) as $key) {
      $labels += $this->buttonLabels($element[$key]);
    }
    return $labels;
  }

  /**
   * The stored ticket.
   */
  private function reload(BbTicketInterface $ticket): BbTicketInterface {
    $fresh = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->loadUnchanged($ticket->id());
    assert($fresh instanceof BbTicketInterface);
    return $fresh;
  }

  /**
   * The stored run.
   */
  private function reloadRun(BbRunInterface $run): BbRunInterface {
    $fresh = $this->container->get('entity_type.manager')->getStorage('bb_run')->loadUnchanged($run->id());
    assert($fresh instanceof BbRunInterface);
    return $fresh;
  }

}
