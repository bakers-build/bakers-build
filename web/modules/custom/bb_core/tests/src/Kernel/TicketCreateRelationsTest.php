<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Utility\Crypt;
use Drupal\Core\Entity\EntityFormInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Form\BbTicketCreateForm;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * The create dialog's Parent and Blocked by stay in the new ticket's project.
 *
 * The creator is a non-admin team member of workspace a, so the workspace
 * read scope applies: projects A and B (workspace a) are readable, project C
 * (workspace b) is not.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketCreateRelationsTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  private const PARENT_ERROR = "Choose an open parent ticket from this ticket's project.";

  private const PARENT_PROJECT_ERROR = "The parent ticket must be in this ticket's project.";

  private const BLOCKER_ERROR = "Choose open blocking tickets from this ticket's project.";

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'island', 'bb_core',
  ];

  /**
   * Ticket ids keyed by name: a1, a2 (project A), b1 (B), c1 (C).
   *
   * @var array<string, string>
   */
  private array $tickets = [];

  /**
   * Project ids keyed by name: A, B, C.
   *
   * @var array<string, string>
   */
  private array $projects = [];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->installConfig(['system', 'filter', 'bb_core']);
    $this->buildTwoWorkspaceWorld();

    $project_a = $this->fixture('a', 'bb_project');
    $project_b = $this->createEntity('bb_project', [
      'name' => 'project-a-sibling',
      'group_id' => $project_a->get('group_id')->target_id,
      'teams' => [$this->fixture('a', 'bb_team')->id()],
      'owner_user_id' => $project_a->get('owner_user_id')->target_id,
    ]);
    $this->projects = [
      'A' => (string) $project_a->id(),
      'B' => (string) $project_b->id(),
      'C' => (string) $this->fixture('b', 'bb_project')->id(),
    ];
    $this->tickets = [
      'a1' => (string) $this->fixture('a', 'bb_ticket')->id(),
      'a2' => $this->ticket('Second alpha', 'A'),
      'b1' => $this->ticket('Beta ticket', 'B'),
      'c1' => (string) $this->fixture('b', 'bb_ticket')->id(),
    ];

    $creator = $this->createAccount('creator', [
      'view bb_workspace', 'view bb_project', 'view bb_ticket', 'create bb_ticket',
    ]);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $creator, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $creator, []);
    $this->container->get('current_user')->setAccount($creator);
  }

  /**
   * AC-1: a dialog opened on A offers only A's tickets in both pickers.
   */
  public function testBoundDialogOffersOnlyProjectTickets(): void {
    $form = $this->buildForm('A');

    self::assertSame($this->ids('a1', 'a2'), $this->pickerOptions($form, 'parent_id'));
    self::assertSame($this->ids('a1', 'a2'), $this->pickerOptions($form, 'blocked_by'));
  }

  /**
   * AC-2: the dialog without a project offers no relation candidates.
   */
  public function testUnboundDialogOffersNoRelationsBeforeProject(): void {
    $form = $this->buildForm(NULL);

    self::assertSame([], $this->pickerOptions($form, 'parent_id'));
    self::assertSame([], $this->pickerOptions($form, 'blocked_by'));
  }

  /**
   * AC-3: one parent and several blockers are stored exactly.
   */
  public function testSavesOneParentAndSeveralBlockers(): void {
    $ticket = $this->submitExpectingSave([
      'parent_id' => $this->tickets['a1'],
      'blocked_by' => $this->ids('a1', 'a2'),
    ], 'A');

    self::assertSame($this->tickets['a1'], (string) $ticket->get('parent_id')->target_id);
    self::assertSame($this->ids('a1', 'a2'), $this->sorted(array_column($ticket->get('blocked_by')->getValue(), 'target_id')));
  }

  /**
   * AC-3: both relations may stay empty.
   */
  public function testEmptyRelationsStillSave(): void {
    $ticket = $this->submitExpectingSave([], 'A');

    self::assertTrue($ticket->get('parent_id')->isEmpty());
    self::assertTrue($ticket->get('blocked_by')->isEmpty());
  }

  /**
   * AC-4: a cross-project parent is refused; the typed title survives.
   */
  public function testCrossProjectParentIsRejected(): void {
    $before = $this->ticketCount();

    $state = $this->submitForm(['title' => $this->line('Kept title'), 'parent_id' => $this->tickets['b1']], 'A');

    self::assertSame(self::PARENT_PROJECT_ERROR, (string) ($state->getErrors()['parent_id'] ?? ''));
    self::assertSame($before, $this->ticketCount());
    self::assertSame('Kept title', $state->getValue(['title', 0, 'value']));
  }

  /**
   * A closed ticket in the project is refused as parent.
   */
  public function testClosedParentIsRejected(): void {
    $closed = $this->ticket('Closed alpha', 'A');
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->load($closed);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->set('closed', TRUE)->save();

    $state = $this->submitForm(['parent_id' => $closed], 'A');

    self::assertSame(self::PARENT_ERROR, (string) ($state->getErrors()['parent_id'] ?? ''));
  }

  /**
   * AC-4: one foreign value among several blockers is refused.
   */
  public function testCrossProjectBlockerIsRejected(): void {
    $before = $this->ticketCount();

    $state = $this->submitForm(['blocked_by' => $this->ids('a1', 'b1')], 'A');

    self::assertSame(self::BLOCKER_ERROR, (string) ($state->getErrors()['blocked_by'] ?? ''));
    self::assertSame($before, $this->ticketCount());
  }

  /**
   * AC-5: an unreadable ticket is refused without revealing its title.
   */
  public function testInvisibleTicketIsRejectedWithoutLabel(): void {
    $state = $this->submitForm(['parent_id' => $this->tickets['c1']], 'A');

    $errors = implode(' ', array_map('strval', $state->getErrors()));
    self::assertArrayHasKey('parent_id', $state->getErrors());
    self::assertStringNotContainsString('ticket-b', $errors);
  }

  /**
   * A bound dialog checks against its bound project, not a posted one.
   */
  public function testBoundDialogIgnoresPostedProjectForRelations(): void {
    $state = $this->submitForm(['project_id' => $this->projects['B'], 'parent_id' => $this->tickets['b1']], 'A');

    self::assertSame(self::PARENT_PROJECT_ERROR, (string) ($state->getErrors()['parent_id'] ?? ''));
  }

  /**
   * The unbound dialog accepts relations from the project chosen in it.
   */
  public function testUnboundDialogAcceptsChosenProjectRelations(): void {
    $ticket = $this->submitExpectingSave(['project_id' => $this->projects['B'], 'parent_id' => $this->tickets['b1']], NULL);

    self::assertSame($this->projects['B'], (string) $ticket->get('project_id')->target_id);
    self::assertSame($this->tickets['b1'], (string) $ticket->get('parent_id')->target_id);
  }

  /**
   * No project and a relation: both are reported, nothing crashes.
   */
  public function testRelationWithoutProjectIsRejected(): void {
    $state = $this->submitForm(['parent_id' => $this->tickets['a1']], NULL);

    self::assertArrayHasKey('project_id', $state->getErrors());
    self::assertSame(self::PARENT_ERROR, (string) ($state->getErrors()['parent_id'] ?? ''));
  }

  /**
   * A valid ticket beyond the picker's 50 candidates is still accepted.
   */
  public function testValidTicketBeyondCandidateCapIsAccepted(): void {
    for ($i = 0; $i < 50; $i++) {
      $last = $this->ticket("Filler $i", 'A');
    }
    self::assertNotContains($last, $this->pickerOptions($this->buildForm('A'), 'parent_id'), 'The ticket lies beyond the cap.');

    $ticket = $this->submitExpectingSave(['parent_id' => $last], 'A');

    self::assertSame($last, (string) $ticket->get('parent_id')->target_id);
  }

  /**
   * AC-2: the unbound dialog refreshes both pickers on a project change.
   */
  public function testUnboundDialogWiresRelationRefresh(): void {
    $form = $this->buildForm(NULL);

    $refresh = $form['project_id']['#attributes'];
    self::assertArrayHasKey('data-hx-post', $refresh);
    self::assertSame('change', $refresh['data-hx-trigger'] ?? NULL);
    self::assertStringContainsString('"_triggering_element_name":"project_id"', (string) ($refresh['data-hx-vals'] ?? ''));
    self::assertSame('parent_id', $form['parent_id']['#attributes']['data-ticket-project-scoped'] ?? NULL);
    self::assertSame('blocked_by', $form['blocked_by']['#attributes']['data-ticket-project-scoped'] ?? NULL);
    // The htmx swap resolves `hx-select-oob` as element ids only.
    self::assertSame('#' . $form['blocked_by']['#id'], $refresh['data-hx-select-oob'] ?? NULL);
  }

  /**
   * A bound dialog has no project picker and needs no refresh.
   */
  public function testBoundDialogHasNoRelationRefresh(): void {
    $form = $this->buildForm('A');

    self::assertArrayNotHasKey('data-hx-post', $form['project_id']['#attributes'] ?? []);
    self::assertArrayNotHasKey('data-ticket-project-scoped', $form['parent_id']['#attributes'] ?? []);
    self::assertArrayNotHasKey('data-ticket-project-scoped', $form['blocked_by']['#attributes'] ?? []);
  }

  /**
   * AC-2: switching to B drops the A selection, offers B, reports nothing.
   */
  public function testProjectChangeRebuildDropsStaleSelection(): void {
    [$form, $state] = $this->refresh([
      'title' => $this->line('Half filled'),
      'project_id' => $this->projects['B'],
      'parent_id' => $this->tickets['a1'],
      'blocked_by' => [$this->tickets['a2']],
    ]);

    self::assertFalse($state->isSubmitted());
    self::assertSame([], $state->getErrors(), 'A refresh mid-edit reports no errors.');
    self::assertSame($this->ids('b1'), $this->pickerOptions($form, 'parent_id'));
    self::assertSame([], $this->pickerProps($form, 'parent_id')['values']);
    self::assertSame([], $this->pickerProps($form, 'blocked_by')['values']);
  }

  /**
   * A form restored from the form cache keeps its services.
   *
   * A second refresh posts a cached form; validation then reads the
   * candidates again.
   */
  public function testCachedFormKeepsItsReferenceOptions(): void {
    [, $state] = $this->refresh(['project_id' => $this->projects['A']]);
    $restored = unserialize(serialize($state->getFormObject()), ['allowed_classes' => [BbTicketCreateForm::class]]);
    self::assertInstanceOf(BbTicketCreateForm::class, $restored);

    self::assertTrue((new \ReflectionProperty(BbTicketCreateForm::class, 'referenceOptions'))->isInitialized($restored));
  }

  /**
   * Posts a refresh as htmx does when the project picker changes.
   *
   * @param array<string, mixed> $input
   *   The raw user input.
   *
   * @return array{0: array<string, mixed>, 1: \Drupal\Core\Form\FormStateInterface}
   *   The rebuilt form and its state.
   */
  private function refresh(array $input): array {
    $request = Request::create('/', 'POST');
    $request->headers->set('HX-Request', 'true');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $form_id = BbTicketCreateForm::FORM_ID;
    $state = (new FormState())->setRequestMethod('POST')->setUserInput($input + [
      'form_id' => $form_id,
      '_triggering_element_name' => 'project_id',
      'form_token' => $this->container->get('csrf_token')->get('form_token_placeholder_' . Crypt::hashBase64($form_id)),
    ]);
    $form = $this->container->get('form_builder')->buildForm(BbTicketCreateForm::class, $state);
    return [$form, $state];
  }

  /**
   * Builds the dialog, opened on a project or without one.
   *
   * @param string|null $project
   *   The project name (A, B, C) the dialog is opened on, or NULL for none.
   *
   * @return array<string, mixed>
   *   The built form.
   */
  private function buildForm(?string $project): array {
    $this->pushRequest($project);
    return $this->container->get('form_builder')->getForm(BbTicketCreateForm::class);
  }

  /**
   * Submits the dialog, opened on a project or without one.
   *
   * @param array<string, mixed> $values
   *   Submitted values; a title is added when absent.
   * @param string|null $project
   *   The project name (A, B, C) the dialog is opened on, or NULL for none.
   */
  private function submitForm(array $values, ?string $project): FormStateInterface {
    $this->pushRequest($project);
    $state = new FormState();
    $state->setValues($values + ['title' => $this->line('A related ticket'), 'op' => 'Create ticket']);
    $this->container->get('form_builder')->submitForm(BbTicketCreateForm::class, $state);
    return $state;
  }

  /**
   * Submits a valid payload and returns the stored ticket.
   *
   * @param array<string, mixed> $values
   *   Submitted values.
   * @param string|null $project
   *   The project name (A, B, C) the dialog is opened on, or NULL for none.
   */
  private function submitExpectingSave(array $values, ?string $project): BbTicketInterface {
    $state = $this->submitForm($values, $project);
    self::assertSame([], array_map('strval', $state->getErrors()));
    $form_object = $state->getFormObject();
    self::assertInstanceOf(EntityFormInterface::class, $form_object);
    $id = $form_object->getEntity()->id();
    self::assertNotNull($id, 'The ticket was saved.');
    $stored = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->loadUnchanged($id);
    self::assertInstanceOf(BbTicketInterface::class, $stored);
    return $stored;
  }

  /**
   * Pushes the request that opens the dialog.
   *
   * @param string|null $project
   *   The project name (A, B, C) the dialog is opened on, or NULL for none.
   */
  private function pushRequest(?string $project): void {
    $request = Request::create($project !== NULL ? '/?project=' . $this->projects[$project] : '/');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
  }

  /**
   * The props a built picker renders with, after its pre-render.
   *
   * @param array<string, mixed> $form
   *   The built form.
   * @param string $field
   *   The picker field.
   *
   * @return array<string, mixed>
   *   The pill props.
   */
  private function pickerProps(array $form, string $field): array {
    $element = $form[$field]['widget'];
    foreach ($element['#pre_render'] as $callback) {
      $element = $callback($element);
    }
    return $element['control']['#props'];
  }

  /**
   * The sorted option values a built picker offers.
   *
   * @param array<string, mixed> $form
   *   The built form.
   * @param string $field
   *   The picker field.
   *
   * @return list<string>
   *   The option values.
   */
  private function pickerOptions(array $form, string $field): array {
    return $this->sorted(array_column($this->pickerProps($form, $field)['options'], 'value'));
  }

  /**
   * Creates a saved ticket in the given project and returns its id.
   */
  private function ticket(string $title, string $project): string {
    return (string) $this->createEntity('bb_ticket', [
      'title' => $title,
      'workflow' => 'bb_work',
      'project_id' => $this->projects[$project],
    ])->id();
  }

  /**
   * The sorted ticket ids for the given names.
   *
   * @return list<string>
   *   The ids.
   */
  private function ids(string ...$names): array {
    return $this->sorted(array_map(fn (string $name): string => $this->tickets[$name], $names));
  }

  /**
   * Ids as sorted strings.
   *
   * @param array<int|string> $ids
   *   The ids.
   *
   * @return list<string>
   *   The sorted ids.
   */
  private function sorted(array $ids): array {
    $ids = array_values(array_filter(array_map('strval', $ids), static fn (string $id): bool => $id !== ''));
    sort($ids);
    return $ids;
  }

  /**
   * The submitted shape of a single-cardinality core text widget.
   *
   * @return array<int, array<string, string>>
   *   The nested value.
   */
  private function line(string $value): array {
    return [['value' => $value]];
  }

  /**
   * The number of tickets, access-unchecked.
   */
  private function ticketCount(): int {
    return count($this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->getQuery()->accessCheck(FALSE)->execute());
  }

}
