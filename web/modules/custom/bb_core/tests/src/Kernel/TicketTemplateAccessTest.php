<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Database\DatabaseExceptionWrapper;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\Core\Url;
use Drupal\filter\Entity\FilterFormat;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\bb_core\TicketTemplate\TemplateNotFoundException;
use Drupal\bb_core\TicketTemplate\TicketTemplateInstantiator;
use Drupal\bb_core\TicketTemplate\TicketTemplateValidationException;
use Drupal\KernelTests\KernelTestBase;
use Drupal\og\Entity\OgRole;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\Yaml\Yaml;

/**
 * Ticket templates are tenancy-scoped like their project.
 *
 * Two workspaces; the contributor rank is granted the template permissions, so
 * a member of workspace B holds them too, but only inside B.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketTemplateAccessTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'filter', 'field', 'og', 'bb_core',
  ];

  /**
   * The template permissions granted to the contributor rank.
   *
   * @var array<string>
   */
  private const TEMPLATE_PERMISSIONS = [
    'use bb_ticket_template',
    'view bb_ticket_template',
    'create bb_ticket_template',
    'update bb_ticket_template',
    'delete bb_ticket_template',
  ];

  /**
   * A contributor of workspace A.
   */
  private UserInterface $insider;

  /**
   * A contributor of workspace B, a stranger to A.
   */
  private UserInterface $outsider;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    FilterFormat::create(['format' => 'bb_rich', 'name' => 'bakers.build rich'])->save();
    $this->buildTwoWorkspaceWorld();

    $role = OgRole::load('bb_workspace-bb_workspace-contributor');
    self::assertNotNull($role);
    foreach (self::TEMPLATE_PERMISSIONS as $permission) {
      $role->grantPermission($permission);
    }
    $role->save();

    foreach (['a', 'b'] as $side) {
      $fixture = $this->template($side);
      $fixture->set('description', ['value' => 'Body', 'format' => 'bb_rich']);
      $fixture->save();
    }

    $this->insider = $this->member('a');
    $this->outsider = $this->member('b');
    foreach (['a' => $this->insider, 'b' => $this->outsider] as $side => $account) {
      $this->addMembership($this->fixture($side, 'bb_workspace'), $account, ['contributor']);
      $this->addMembership($this->fixture($side, 'bb_team'), $account, []);
    }
  }

  /**
   * The instantiator service.
   */
  private function instantiator(): TicketTemplateInstantiator {
    return $this->container->get('bb_core.ticket_template_instantiator');
  }

  /**
   * Loads the ticket an instantiate() result names.
   *
   * @param array{ticket_uuid: string, identifier: string, created: bool} $result
   *   The instantiate() result.
   */
  private function ticketOf(array $result): BbTicketInterface {
    $ticket = $this->container->get('entity.repository')->loadEntityByUuid('bb_ticket', $result['ticket_uuid']);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Counts every ticket row created from a template, bypassing access.
   */
  private function templateTicketCount(): int {
    return (int) $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->getQuery()->accessCheck(FALSE)->exists('template_id')->count()->execute();
  }

  /**
   * Returns a template fixture.
   */
  private function template(string $side): BbTicketTemplateInterface {
    $template = $this->fixture($side, 'bb_ticket_template');
    self::assertInstanceOf(BbTicketTemplateInterface::class, $template);
    return $template;
  }

  /**
   * Entity-field violation paths of an entity validated as an account.
   *
   * @param \Drupal\bb_core\Entity\BbTicketTemplateInterface|\Drupal\bb_core\Entity\BbTicketInterface $entity
   *   The entity to validate.
   * @param \Drupal\user\UserInterface $account
   *   The account to validate as.
   * @param array<string> $messages
   *   Receives the violation messages.
   *
   * @return array<string>
   *   The violated property paths.
   */
  private function violationPathsAs(BbTicketTemplateInterface|BbTicketInterface $entity, UserInterface $account, array &$messages = []): array {
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($account);
    try {
      $violations = $entity->validate();
    }
    finally {
      $switcher->switchBack();
    }
    $paths = [];
    $messages = [];
    foreach ($violations as $violation) {
      $paths[] = $violation->getPropertyPath();
      $messages[] = (string) $violation->getMessage();
    }
    return $paths;
  }

  /**
   * Builds an unsaved template in a project.
   *
   * @param string $side
   *   The workspace side ('a' or 'b') whose project it belongs to.
   * @param array<string, mixed> $values
   *   Values overriding the defaults.
   */
  private function newTemplate(string $side, array $values = []): BbTicketTemplateInterface {
    $template = $this->container->get('entity_type.manager')->getStorage('bb_ticket_template')->create($values + [
      'name' => 'new',
      'enabled' => TRUE,
      'title_pattern' => 'Ticket',
      'description' => ['value' => 'Body', 'format' => 'bb_rich'],
      'workflow' => 'bb_feature',
      'target_state' => 'qualification',
      'project_id' => $this->fixture($side, 'bb_project')->id(),
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    self::assertInstanceOf(BbTicketTemplateInterface::class, $template);
    return $template;
  }

  /**
   * The insider works on their own template; the outsider is denied everything.
   */
  public function testForeignMemberIsDeniedViewUpdateDeleteAndList(): void {
    $own = $this->template('a');
    foreach (['view', 'update', 'delete'] as $operation) {
      self::assertTrue($own->access($operation, $this->insider), "Insider may $operation their template.");
      self::assertFalse($own->access($operation, $this->outsider), "Outsider may not $operation it.");
    }
    self::assertContains((int) $own->id(), $this->queryIdsAs('bb_ticket_template', $this->insider));
    self::assertNotContains((int) $own->id(), $this->queryIdsAs('bb_ticket_template', $this->outsider));
  }

  /**
   * Creating a template in a foreign project fails validation on project_id.
   */
  public function testForeignMemberCannotCreateInForeignProject(): void {
    self::assertSame([], $this->violationPathsAs($this->newTemplate('a'), $this->insider));
    self::assertContains('project_id.0', $this->violationPathsAs($this->newTemplate('a'), $this->outsider));
  }

  /**
   * A template carrying another project's conductor fails validation.
   */
  public function testForeignConductorFailsTemplateValidation(): void {
    $foreign = $this->fixture('b', 'bb_conductor')->id();
    $messages = [];
    $paths = $this->violationPathsAs($this->newTemplate('a', ['conductor_id' => $foreign]), $this->insider, $messages);
    self::assertContains('conductor_id', $paths);
    self::assertContains('The selected conductor belongs to a different project and cannot be assigned to this ticket.', $messages);
  }

  /**
   * The project of a saved template cannot change: a violation, no exception.
   */
  public function testProjectIsImmutable(): void {
    $template = $this->template('a');
    self::assertSame([], $this->violationPathsAs($template, $this->insider));

    $template->set('project_id', $this->fixture('b', 'bb_project')->id());
    self::assertContains('project_id', $this->violationPathsAs($template, $this->insider));
  }

  /**
   * Builds an unsaved workspace template: a workspace, no project.
   *
   * @param string $side
   *   The workspace side ('a' or 'b') it belongs to.
   * @param array<string, mixed> $values
   *   Values overriding the defaults.
   */
  private function newWorkspaceTemplate(string $side, array $values = []): BbTicketTemplateInterface {
    return $this->newTemplate($side, $values + [
      'project_id' => NULL,
      'workspace_id' => $this->fixture($side, 'bb_workspace')->id(),
    ]);
  }

  /**
   * A workspace template saves with its workspace and without a project.
   */
  public function testWorkspaceTemplateSavesWithoutProject(): void {
    $template = $this->newWorkspaceTemplate('a');
    self::assertSame([], $this->violationPathsAs($template, $this->insider));
    $template->save();
    self::assertTrue($template->isWorkspaceScoped());
    self::assertSame((int) $this->fixture('a', 'bb_workspace')->id(), $template->getScopeWorkspaceId());
    self::assertTrue($template->get('project_id')->isEmpty());
  }

  /**
   * Exactly one of project and workspace: both or neither is a violation.
   */
  public function testScopeIsExactlyOne(): void {
    $message = 'A ticket template belongs to exactly one project or one workspace.';
    $both = $this->newWorkspaceTemplate('a', ['project_id' => $this->fixture('a', 'bb_project')->id()]);
    $neither = $this->newTemplate('a', ['project_id' => NULL]);
    foreach (['both' => $both, 'neither' => $neither] as $case => $template) {
      $messages = [];
      $paths = $this->violationPathsAs($template, $this->insider, $messages);
      self::assertContains('project_id', $paths, "$case: the scope violation sits on project_id.");
      self::assertCount(1, array_keys($messages, $message), "$case: exactly one scope violation.");
    }
    self::assertFalse($this->newTemplate('a')->isWorkspaceScoped());
  }

  /**
   * The workspace of a saved workspace template cannot change.
   */
  public function testWorkspaceIsImmutable(): void {
    $template = $this->newWorkspaceTemplate('a');
    $template->save();
    self::assertSame([], $this->violationPathsAs($template, $this->insider));

    $template->set('workspace_id', $this->fixture('b', 'bb_workspace')->id());
    self::assertContains('workspace_id', $this->violationPathsAs($template, $this->insider));
  }

  /**
   * A workspace template resolves to its workspace and answers only there.
   */
  public function testWorkspaceTemplateResolvesToItsWorkspace(): void {
    foreach (['a', 'b'] as $side) {
      $this->fixture($side, 'bb_workspace')->set('slug', "space-$side")->save();
    }
    $this->container->get('router.builder')->rebuild();
    $template = $this->newWorkspaceTemplate('a');
    $template->save();

    $resolved = $this->container->get('bb_core.workspace_resolver')->resolve($template);
    self::assertSame((int) $this->fixture('a', 'bb_workspace')->id(), (int) $resolved?->id());

    $canonical = static fn (string $slug): Url => Url::fromRoute('entity.bb_ticket_template.canonical', [
      'bb_workspace' => $slug,
      'bb_ticket_template' => $template->id(),
    ]);
    self::assertTrue($canonical('space-a')->access($this->insider), 'The insider reaches it under its workspace.');
    self::assertFalse($canonical('space-b')->access($this->insider), 'Not under another workspace.');
    self::assertFalse($canonical('space-b')->access($this->outsider), 'Nor does the outsider under their own.');
  }

  /**
   * Members of the workspace see a workspace template; nobody else does.
   */
  public function testWorkspaceTemplateVisibility(): void {
    $template = $this->newWorkspaceTemplate('a');
    $template->save();
    $guest = $this->createAccount('guest-a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $guest, ['guest']);
    $anonymous = new AnonymousUserSession();

    self::assertTrue($template->access('view', $this->insider));
    self::assertContains((int) $template->id(), $this->queryIdsAs('bb_ticket_template', $this->insider));
    foreach (['outsider' => $this->outsider, 'guest' => $guest, 'anonymous' => $anonymous] as $who => $account) {
      self::assertFalse($template->access('view', $account), "The $who may not view it.");
      self::assertNotContains((int) $template->id(), $this->queryIdsAs('bb_ticket_template', $account), "The $who does not list it.");
    }
  }

  /**
   * A rank in another workspace does not open a workspace one is a guest of.
   */
  public function testGuestWithRankElsewhereDoesNotListWorkspaceTemplates(): void {
    $template = $this->newWorkspaceTemplate('a');
    $template->save();
    $own = $this->newWorkspaceTemplate('b');
    $own->save();
    $this->addMembership($this->fixture('a', 'bb_workspace'), $this->outsider, ['guest']);

    self::assertFalse($template->access('view', $this->outsider));
    $ids = $this->queryIdsAs('bb_ticket_template', $this->outsider);
    self::assertNotContains((int) $template->id(), $ids);
    self::assertContains((int) $own->id(), $ids, 'Its own workspace stays readable.');
  }

  /**
   * Placing a template in a workspace needs the create right in that workspace.
   */
  public function testWorkspaceTemplateCreateNeedsTheRightInThatWorkspace(): void {
    self::assertSame([], $this->violationPathsAs($this->newWorkspaceTemplate('a'), $this->insider));
    self::assertContains('workspace_id.0', $this->violationPathsAs($this->newWorkspaceTemplate('a'), $this->outsider));
  }

  /**
   * A workspace template without a project override creates nothing.
   */
  public function testWorkspaceTemplateNeedsProject(): void {
    $template = $this->newWorkspaceTemplate('a');
    $template->save();
    try {
      $this->instantiator()->instantiate($template->uuid(), $this->insider);
      self::fail('A validation exception was expected.');
    }
    catch (TicketTemplateValidationException $e) {
      self::assertSame('A project is required for a workspace template.', $e->getMessage());
    }
    self::assertSame(0, $this->templateTicketCount());
  }

  /**
   * Preflight, which passes no project, refuses a workspace template only.
   */
  public function testPreflightRefusesWorkspaceTemplate(): void {
    $template = $this->newWorkspaceTemplate('a');
    $template->save();
    try {
      $this->instantiator()->preflight($template, $this->insider);
      self::fail('A validation exception was expected.');
    }
    catch (TicketTemplateValidationException $e) {
      self::assertSame('A project is required for a workspace template.', $e->getMessage());
    }
    $this->instantiator()->preflight($this->template('a'), $this->insider);
    self::assertSame(0, $this->templateTicketCount());
  }

  /**
   * A workspace template creates the ticket in the project passed.
   */
  public function testWorkspaceTemplateCreatesInPassedProject(): void {
    $label = $this->fixture('a', 'bb_term')->id();
    $template = $this->newWorkspaceTemplate('a', ['labels' => [['target_id' => $label]]]);
    $template->save();
    $project = (int) $this->fixture('a', 'bb_project')->id();

    $ticket = $this->ticketOf($this->instantiator()->instantiate($template->uuid(), $this->insider, ['project_id' => $project]));

    self::assertSame($project, (int) $ticket->get('project_id')->target_id);
    self::assertSame((int) $template->id(), (int) $ticket->get('template_id')->target_id);
    self::assertSame([(int) $label], array_map('intval', array_column($ticket->get('labels')->getValue(), 'target_id')));
    self::assertTrue($ticket->get('conductor_id')->isEmpty());
  }

  /**
   * A project of another workspace is rejected for a workspace template.
   */
  public function testProjectOutsideWorkspaceIsRejected(): void {
    $template = $this->newWorkspaceTemplate('a');
    $template->save();
    try {
      $this->instantiator()->instantiate($template->uuid(), $this->insider, ['project_id' => (int) $this->fixture('b', 'bb_project')->id()]);
      self::fail('A validation exception was expected.');
    }
    catch (TicketTemplateValidationException $e) {
      self::assertSame('The project does not belong to the workspace of this template.', $e->getMessage());
    }
    self::assertSame(0, $this->templateTicketCount());
  }

  /**
   * An explicit empty label list clears the defaults; an absent key keeps them.
   */
  public function testEmptyLabelsOverrideClearsLabels(): void {
    $template = $this->template('a');
    $template->set('labels', [['target_id' => $this->fixture('a', 'bb_term')->id()]])->save();

    $cleared = $this->ticketOf($this->instantiator()->instantiate($template->uuid(), $this->insider, ['labels' => []]));
    $kept = $this->ticketOf($this->instantiator()->instantiate($template->uuid(), $this->insider, ['title' => 'x']));

    self::assertTrue($cleared->get('labels')->isEmpty());
    self::assertCount(1, $kept->get('labels'));
  }

  /**
   * Label and conductor overrides replace the defaults within the tenancy.
   */
  public function testLabelAndConductorOverridesReplaceTheDefaults(): void {
    $template = $this->newWorkspaceTemplate('a');
    $template->save();
    $label = (int) $this->fixture('a', 'bb_term')->id();
    $conductor = (int) $this->fixture('a', 'bb_conductor')->id();

    $ticket = $this->ticketOf($this->instantiator()->instantiate($template->uuid(), $this->insider, [
      'project_id' => (int) $this->fixture('a', 'bb_project')->id(),
      'labels' => [$label],
      'conductor_id' => $conductor,
    ]));

    self::assertSame([$label], array_map('intval', array_column($ticket->get('labels')->getValue(), 'target_id')));
    self::assertSame($conductor, (int) $ticket->get('conductor_id')->target_id);
  }

  /**
   * A foreign label or conductor override creates nothing.
   */
  public function testForeignLabelOrConductorOverrideIs422(): void {
    $template = $this->newWorkspaceTemplate('a');
    $template->save();
    $project = (int) $this->fixture('a', 'bb_project')->id();
    $foreign = [
      'label' => ['labels' => [(int) $this->fixture('b', 'bb_term')->id()]],
      'conductor' => ['conductor_id' => (int) $this->fixture('b', 'bb_conductor')->id()],
    ];
    foreach ($foreign as $case => $override) {
      try {
        $this->instantiator()->instantiate($template->uuid(), $this->insider, $override + ['project_id' => $project]);
        self::fail("A foreign $case must be rejected.");
      }
      catch (TicketTemplateValidationException) {
      }
    }
    self::assertSame(0, $this->templateTicketCount());
  }

  /**
   * A foreign member cannot instantiate, and learns nothing about the template.
   */
  public function testForeignMemberCannotInstantiate(): void {
    try {
      $this->instantiator()->instantiate($this->template('a')->uuid(), $this->outsider);
      self::fail('A not-found exception was expected.');
    }
    catch (TemplateNotFoundException) {
    }
    self::assertSame(0, $this->templateTicketCount());
  }

  /**
   * The insider gets a ticket with the template's labels, body and conductor.
   */
  public function testInsiderInstantiatesWithCopiedFields(): void {
    $template = $this->template('a');
    $label = $this->fixture('a', 'bb_term')->id();
    $conductor = $this->fixture('a', 'bb_conductor')->id();
    $template->set('labels', [['target_id' => $label]]);
    $template->set('conductor_id', $conductor);
    $template->set('description', ['value' => 'Copied body', 'format' => 'bb_rich']);
    $template->save();

    $result = $this->instantiator()->instantiate($template->uuid(), $this->insider);

    self::assertTrue($result['created']);
    $ticket = $this->ticketOf($result);
    self::assertSame([(int) $label], array_map('intval', array_column($ticket->get('labels')->getValue(), 'target_id')));
    self::assertSame((int) $conductor, (int) $ticket->get('conductor_id')->target_id);
    self::assertSame('Copied body', trim((string) $ticket->get('description')->value));
    self::assertSame((int) $this->insider->id(), (int) $ticket->get('owner_user_id')->target_id);
    self::assertSame(
      (int) $this->fixture('a', 'bb_conductor')->get('owner_user_id')->target_id,
      (int) $ticket->get('assignee_user_id')->target_id,
      'The template conductor decides the assignee, as on a normal ticket.',
    );
  }

  /**
   * A template a generated ticket references cannot be deleted.
   */
  public function testReferencedTemplateCannotBeDeleted(): void {
    $template = $this->template('a');
    self::assertTrue($template->access('delete', $this->insider));

    $this->instantiator()->instantiate($template->uuid(), $this->insider);

    $this->container->get('entity_type.manager')->getAccessControlHandler('bb_ticket_template')->resetCache();
    self::assertFalse($template->access('delete', $this->insider), 'A referenced template is disabled, not deleted.');
  }

  /**
   * The Create ticket confirmation answers only in the template's workspace.
   */
  public function testConfirmRouteIsWorkspaceScoped(): void {
    // The two-workspace world carries no slugs; the route's segment needs one.
    foreach (['a', 'b'] as $side) {
      $this->fixture($side, 'bb_workspace')->set('slug', "space-$side")->save();
    }
    $this->container->get('router.builder')->rebuild();
    $template = $this->template('a');
    $url = Url::fromRoute('bb_core.ticket_template_instantiate_form', [
      'bb_workspace' => 'space-a',
      'bb_ticket_template' => $template->id(),
    ]);
    self::assertTrue($url->access($this->insider), 'The insider reaches the confirmation.');
    self::assertFalse($url->access($this->outsider), 'A member of another workspace does not.');

    $foreign_slug = Url::fromRoute('bb_core.ticket_template_instantiate_form', [
      'bb_workspace' => 'space-b',
      'bb_ticket_template' => $template->id(),
    ]);
    self::assertFalse($foreign_slug->access($this->outsider), 'Naming the outsider\'s own workspace does not help.');
  }

  /**
   * A template naming another project's conductor creates nothing.
   */
  public function testForeignConductorTemplateCreatesNoTicket(): void {
    $template = $this->template('a');
    // save() does not validate: this is the stored shape of a forged template.
    $template->set('conductor_id', $this->fixture('b', 'bb_conductor')->id());
    $template->save();

    try {
      $this->instantiator()->instantiate($template->uuid(), $this->insider);
      self::fail('A validation exception was expected.');
    }
    catch (TicketTemplateValidationException) {
    }
    self::assertSame(0, $this->templateTicketCount());
  }

  /**
   * A title that overflows 255 characters once rendered creates nothing.
   */
  public function testOverlongRenderedTitleCreatesNoTicket(): void {
    $template = $this->template('a');
    $template->set('title_pattern', str_repeat('x', 250) . '{{date}}');
    $template->save();

    try {
      $this->instantiator()->instantiate($template->uuid(), $this->insider);
      self::fail('A validation exception was expected.');
    }
    catch (TicketTemplateValidationException) {
    }
    self::assertSame(0, $this->templateTicketCount());
  }

  /**
   * The template_id field is server-owned: no actor may set it on a ticket.
   */
  public function testForgedTemplateIdIsNotWritable(): void {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => 'forged',
      'workflow' => 'bb_feature',
      'project_id' => $this->fixture('a', 'bb_project')->id(),
      'template_id' => $this->template('a')->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    self::assertFalse($ticket->get('template_id')->access('edit', $this->insider), 'Not writable on a new ticket.');

    $ticket->save();
    self::assertFalse($ticket->get('template_id')->access('edit', $this->insider), 'Not writable on a saved ticket.');
  }

  /**
   * A template carrying another workspace's label fails validation.
   */
  public function testForeignLabelFailsTemplateValidation(): void {
    $foreign = $this->fixture('b', 'bb_term')->id();
    $paths = $this->violationPathsAs($this->newTemplate('a', ['labels' => [['target_id' => $foreign]]]), $this->insider);
    self::assertContains('labels', $paths);
  }

  /**
   * A target state the template's workflow cannot reach fails on save.
   */
  public function testUnreachableTargetStateFailsTemplateValidation(): void {
    self::assertSame([], $this->violationPathsAs($this->newTemplate('a', ['target_state' => 'spec']), $this->insider));
    self::assertSame([], $this->violationPathsAs($this->newTemplate('a', ['target_state' => '']), $this->insider));
    // `diagnose` belongs to the bug workflow; `cancelled` is terminal.
    foreach (['diagnose', 'cancelled', 'review'] as $state) {
      $paths = $this->violationPathsAs($this->newTemplate('a', ['target_state' => $state]), $this->insider);
      self::assertContains('target_state', $paths, "Target state $state is rejected for bb_feature.");
    }
  }

  /**
   * Changing only the workflow still trips an unreachable target state.
   *
   * JSON:API keeps only violations of the fields a PATCH names, so the
   * violation must surface on `workflow` too.
   */
  public function testWorkflowChangeAloneRejectsAnUnreachableTargetState(): void {
    $template = $this->template('a');
    $template->set('target_state', 'spec')->save();
    $template->set('workflow', 'bb_bug');
    $violations = $template->validate();
    $violations->filterByFields(array_diff(array_keys($template->getFieldDefinitions()), ['workflow']));
    self::assertGreaterThan(0, $violations->count(), 'A PATCH of the workflow alone reports the unreachable target state.');
  }

  /**
   * The conductor selection offers only the template project's conductors.
   */
  public function testConductorSelectionIsTheTemplateProject(): void {
    // An operator who sees every conductor, so read scope cannot do the work.
    $this->container->get('current_user')->setAccount($this->createAccount('operator', ['administer bakers']));
    $template = $this->newTemplate('a');
    $handler = $this->container->get('plugin.manager.entity_reference_selection')
      ->getSelectionHandler($template->getFieldDefinition('conductor_id'), $template);
    $ids = [];
    foreach ($handler->getReferenceableEntities() as $bundle) {
      $ids = array_merge($ids, array_keys($bundle));
    }
    self::assertSame([(int) $this->fixture('a', 'bb_conductor')->id()], array_map('intval', $ids));
  }

  /**
   * The label selection offers only the template workspace's labels.
   */
  public function testLabelSelectionIsTheTemplateWorkspace(): void {
    // An operator who sees every label, so read scope cannot do the work.
    $this->container->get('current_user')->setAccount($this->createAccount('operator', ['administer bakers']));
    $options = $this->container->get('bb_core.reference_options')->for($this->newTemplate('a'), 'labels');
    self::assertSame([(int) $this->fixture('a', 'bb_term')->id()], array_map('intval', array_keys($options)));
  }

  /**
   * The shipped Drupal-update example imports, validates and instantiates.
   *
   * Follows the recipe README: substitute project, owner and label, keep the
   * UUID. A second import of the same UUID never overwrites the first.
   */
  public function testShippedExampleImportsAndInstantiates(): void {
    $file = dirname(DRUPAL_ROOT) . '/recipes/bb_ticket_templates/templates/bd9e5a3c-7f21-4c68-9a04-2d1e6b8c5f30.yml';
    $example = Yaml::parseFile($file);
    $label = $this->fixture('a', 'bb_term');
    $label->set('name', 'work:code')->save();
    $substitutes = [
      '<project-uuid>' => $this->fixture('a', 'bb_project')->id(),
      '<owner-user-uuid>' => $this->insider->id(),
      array_key_first($example['_meta']['depends']) => $label->id(),
    ];
    $values = ['uuid' => $example['_meta']['uuid']];
    foreach ($example['default'] as $field => $items) {
      $values[$field] = array_map(
        static fn (array $item): array => isset($item['entity']) ? ['target_id' => $substitutes[$item['entity']]] : $item,
        $items,
      );
    }
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket_template');
    $template = $storage->create($values);
    self::assertInstanceOf(BbTicketTemplateInterface::class, $template);
    self::assertSame([], $this->violationPathsAs($template, $this->insider));
    self::assertFalse((bool) $template->get('enabled')->value, 'The example ships disabled.');
    $template->set('enabled', TRUE)->save();

    $ticket = $this->ticketOf($this->instantiator()->instantiate($template->uuid(), $this->insider));
    self::assertSame('bb_chore', $ticket->get('workflow')->value);
    self::assertSame('qualification', $ticket->get('state')->value);
    self::assertSame(['work:code'], array_map(static fn ($term): string => (string) $term->label(), $ticket->get('labels')->referencedEntities()));
    self::assertStringContainsString('keytec-drupal-update', (string) $ticket->get('description')->value);

    $template->set('name', 'Customised')->save();
    try {
      $storage->create($values)->save();
      self::fail('A second import of the same UUID must not save.');
    }
    catch (EntityStorageException | DatabaseExceptionWrapper) {
    }
    $stored = $storage->loadByProperties(['uuid' => $example['_meta']['uuid']]);
    self::assertSame(['Customised'], array_map(static fn ($t): string => (string) $t->label(), array_values($stored)));
  }

}
