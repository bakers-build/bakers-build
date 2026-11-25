<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Utility\Crypt;
use Drupal\Core\Config\FileStorage;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityFormInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Form\BbTicketCreateForm;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * The create dialog's Project picker offers exactly the creatable projects.
 *
 * Workspace a holds project A (team a) and project S (its own team);
 * workspace b holds project B. No account here holds a site-wide
 * `create bb_ticket`, so only ranks decide.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketCreateProjectPickerTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  private const HANDLER = 'bb_project_ticket_creatable';

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
   * Project ids keyed A, S (workspace a) and B (workspace b).
   *
   * @var array<string, string>
   */
  private array $projects = [];

  /**
   * Conductor ids keyed by their project, A and S.
   *
   * @var array<string, string>
   */
  private array $conductors = [];

  /**
   * The team of project S; readers belong to it without a create right.
   */
  private ContentEntityInterface $teamS;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->installConfig(['system', 'filter', 'bb_core']);
    $this->buildTwoWorkspaceWorld();
    $owner = $this->fixture('a', 'bb_project')->get('owner_user_id')->target_id;
    $this->teamS = $this->createEntity('bb_team', [
      'name' => 'team-s',
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
      'owner_user_id' => $owner,
    ]);
    $sibling = $this->createEntity('bb_project', [
      'name' => 'project-s',
      'key' => 'SIB',
      'group_id' => $this->fixture('a', 'bb_project')->get('group_id')->target_id,
      'teams' => [$this->teamS->id()],
      'owner_user_id' => $owner,
    ]);
    $this->projects = [
      'A' => (string) $this->fixture('a', 'bb_project')->id(),
      'S' => (string) $sibling->id(),
      'B' => (string) $this->fixture('b', 'bb_project')->id(),
    ];
    $this->conductors = [
      'A' => (string) $this->fixture('a', 'bb_conductor')->id(),
      'S' => (string) $this->createEntity('bb_conductor', [
        'conductor_id' => 'node-s',
        'label' => 'node-s',
        'project_id' => $sibling->id(),
        'machine' => $this->fixture('a', 'bb_machine')->id(),
        'owner_user_id' => $owner,
      ])->id(),
    ];
    $data = (new FileStorage(dirname($this->root) . '/config/sync'))->read('og.og_role.bb_team-bb_team-reporter');
    self::assertIsArray($data);
    $this->container->get('entity_type.manager')->getStorage('og_role')->create($data)->save();
  }

  /**
   * AC3: the picker lists exactly the workspace projects one may create in.
   */
  public function testPickerListsExactlyCreatableProjects(): void {
    self::assertSame(['A', 'S'], $this->candidatesFor($this->reader('contributor', ['contributor'])));
    self::assertSame([], $this->candidatesFor($this->reader('member', ['member'])));
    self::assertSame(['A'], $this->candidatesFor($this->reader('reporter', ['member'], ['reporter'])));
  }

  /**
   * Creates a reader of workspace a, a member of teams a and s, and acts as it.
   *
   * @param string $name
   *   The account name.
   * @param array<string> $workspace_roles
   *   Its workspace a roles.
   * @param array<string> $team_roles
   *   Its team a roles; on team s it is a plain member.
   */
  private function reader(string $name, array $workspace_roles, array $team_roles = []): UserInterface {
    $account = $this->createAccount($name, ['view bb_workspace', 'view bb_project', 'view bb_ticket']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, $workspace_roles);
    $this->addMembership($this->fixture('a', 'bb_team'), $account, $team_roles);
    $this->addMembership($this->teamS, $account);
    $this->container->get('current_user')->setAccount($account);
    return $account;
  }

  /**
   * The picker's candidates as project keys, sorted.
   *
   * @return list<string>
   *   Keys of $this->projects.
   */
  private function candidatesFor(UserInterface $reader): array {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create(['workflow' => 'bb_work']);
    self::assertInstanceOf(ContentEntityInterface::class, $ticket);
    $ids = array_keys($this->container->get('bb_core.reference_options')->for($ticket, 'project_id', NULL, 0, self::HANDLER));
    $keys = array_keys(array_intersect($this->projects, array_map('strval', $ids)));
    self::assertCount(count($ids), $keys, 'Only known projects are offered.');
    sort($keys);
    return $keys;
  }

  /**
   * AC1: a dialog opened on a project shows it preselected in the picker.
   */
  public function testOpenedFromProjectPreselectsIt(): void {
    $this->reader('opener', ['contributor']);

    self::assertSame([$this->projects['A']], $this->pickerProps($this->buildForm('A'), 'project_id')['values']);
  }

  /**
   * AC1: opened on A, picking S saves the ticket in S with S's prefix.
   */
  public function testPickingAnotherProjectSavesTicketThere(): void {
    $this->reader('switcher', ['contributor']);

    $ticket = $this->submitExpectingSave(['project_id' => $this->projects['S']], 'A');

    self::assertSame($this->projects['S'], (string) $ticket->get('project_id')->target_id);
    self::assertStringStartsWith('SIB-', (string) $ticket->get('identifier')->value);
  }

  /**
   * AC2: outside a project, the only creatable project is preselected.
   */
  public function testOnlyProjectIsPreselected(): void {
    $this->reader('only-a', ['member'], ['reporter']);

    self::assertSame([$this->projects['A']], $this->pickerProps($this->buildForm(NULL), 'project_id')['values']);
  }

  /**
   * AC2: else the project of the reader's newest own ticket is preselected.
   */
  public function testNewestOwnTicketProjectIsPreselected(): void {
    $reader = $this->reader('recent', ['contributor']);
    $this->createEntity('bb_ticket', ['title' => 'older', 'workflow' => 'bb_work', 'project_id' => $this->projects['A'], 'owner_user_id' => $reader->id()]);
    $this->createEntity('bb_ticket', ['title' => 'newer', 'workflow' => 'bb_work', 'project_id' => $this->projects['S'], 'owner_user_id' => $reader->id()]);

    self::assertSame([$this->projects['S']], $this->pickerProps($this->buildForm(NULL), 'project_id')['values']);
  }

  /**
   * AC2: else nothing is preselected, and the project stays required.
   */
  public function testNoDefaultLeavesPickerEmptyAndRequired(): void {
    $this->reader('fresh', ['contributor']);

    self::assertSame([], $this->pickerProps($this->buildForm(NULL), 'project_id')['values']);
    self::assertArrayHasKey('project_id', $this->submitForm([], NULL)->getErrors());
  }

  /**
   * AC4: a project switch offers only the new project's conductors.
   */
  public function testSwitchOffersOnlyNewProjectsConductors(): void {
    $this->reader('conducting', ['contributor']);
    self::assertSame([$this->conductors['A']], $this->pickerOptions($this->buildForm('A'), 'conductor_id'));

    [$form] = $this->refresh(['project_id' => $this->projects['S'], 'conductor_id' => $this->conductors['A']], 'A');

    self::assertSame([$this->conductors['S']], $this->pickerOptions($form, 'conductor_id'));
    self::assertSame([], $this->pickerProps($form, 'conductor_id')['values']);
    self::assertSame('#bakers-ticket-create-blocked-by,#bakers-ticket-create-conductor', $form['project_id']['#attributes']['data-hx-select-oob'] ?? NULL);
    self::assertSame('bakers-ticket-create-conductor', $form['conductor_id']['#id'] ?? NULL);
  }

  /**
   * AC4: without JavaScript a conductor of the previous project is refused.
   */
  public function testStaleConductorIsRefusedWithoutJs(): void {
    $this->reader('stale', ['contributor']);
    $before = $this->ticketCount();

    $state = $this->submitForm(['project_id' => $this->projects['S'], 'conductor_id' => $this->conductors['A']], 'A');

    self::assertArrayHasKey('conductor_id', $state->getErrors());
    self::assertSame($before, $this->ticketCount());
  }

  /**
   * AC5: a forged project without the create right is refused on the form.
   */
  public function testForgedProjectIsRefusedAndNothingSaved(): void {
    $this->reader('forger', ['member'], ['reporter']);
    $before = $this->ticketCount();

    $state = $this->submitForm(['project_id' => $this->projects['S']], 'A');

    self::assertArrayHasKey('project_id', $state->getErrors());
    self::assertSame($before, $this->ticketCount());
  }

  /**
   * AC5: the entity validation JSON:API runs refuses the same project.
   */
  public function testForgedProjectFailsEntityValidation(): void {
    $this->reader('api-forger', ['member'], ['reporter']);
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create(['title' => 'forged', 'workflow' => 'bb_work', 'project_id' => $this->projects['S']]);
    self::assertInstanceOf(ContentEntityInterface::class, $ticket);

    $paths = [];
    foreach ($ticket->validate() as $violation) {
      $paths[] = explode('.', $violation->getPropertyPath())[0];
    }

    self::assertContains('project_id', $paths);
  }

  /**
   * Builds the dialog, opened on a project or without one.
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
   */
  private function submitForm(array $values, ?string $project): FormStateInterface {
    $this->pushRequest($project);
    $state = new FormState();
    $state->setValues($values + ['title' => [['value' => 'A new ticket']], 'op' => 'Create ticket']);
    $this->container->get('form_builder')->submitForm(BbTicketCreateForm::class, $state);
    return $state;
  }

  /**
   * Submits a valid payload and returns the stored ticket.
   *
   * @param array<string, mixed> $values
   *   Submitted values.
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
   * Posts a refresh as htmx does when the project picker changes.
   *
   * @param array<string, mixed> $input
   *   The raw user input.
   *
   * @return array{0: array<string, mixed>, 1: \Drupal\Core\Form\FormStateInterface}
   *   The rebuilt form and its state.
   */
  private function refresh(array $input, ?string $project): array {
    $request = Request::create($project !== NULL ? '/?project=' . $this->projects[$project] : '/', 'POST');
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
   * Pushes the request that opens the dialog.
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
   *
   * @return list<string>
   *   The option values.
   */
  private function pickerOptions(array $form, string $field): array {
    $values = array_values(array_filter(array_map('strval', array_column($this->pickerProps($form, $field)['options'], 'value')), static fn (string $id): bool => $id !== ''));
    sort($values);
    return $values;
  }

  /**
   * The number of tickets, access-unchecked.
   */
  private function ticketCount(): int {
    return count($this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->getQuery()->accessCheck(FALSE)->execute());
  }

}
