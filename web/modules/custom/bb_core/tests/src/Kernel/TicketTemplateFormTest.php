<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Render\Element;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\Core\Url;
use Drupal\filter\Entity\FilterFormat;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\bb_core\Form\BbTicketTemplateForm;
use Drupal\bb_core\Form\TicketTemplateInstantiateForm;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\og\Entity\OgRole;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\InputBag;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\Yaml\Yaml;

/**
 * The template add form and the "Create ticket" dialog.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketTemplateFormTest extends KernelTestBase {

  use UserCreationTrait;
  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'filter', 'field', 'og', 'island', 'bb_core',
  ];

  /**
   * A contributor of workspace A holding the template permissions.
   */
  private UserInterface $insider;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->installConfig(['system']);
    FilterFormat::create(['format' => 'bb_rich', 'name' => 'bakers.build rich'])->save();
    $this->buildTwoWorkspaceWorld();

    $role = OgRole::load('bb_workspace-bb_workspace-contributor');
    self::assertNotNull($role);
    foreach (['use', 'view', 'create', 'update'] as $operation) {
      $role->grantPermission($operation . ' bb_ticket_template');
    }
    $role->save();

    // The shipped form display, so the widgets under test are the real ones.
    $display = Yaml::parseFile(dirname(DRUPAL_ROOT) . '/config/sync/core.entity_form_display.bb_ticket_template.bb_ticket_template.default.yml');
    unset($display['uuid'], $display['dependencies']);
    $this->container->get('entity_type.manager')->getStorage('entity_form_display')->create($display)->save();
    // The dialog renders the ticket's shipped `create` form mode and display.
    $shipped = [
      'entity_form_mode' => 'core.entity_form_mode.bb_ticket.create',
      'entity_form_display' => 'core.entity_form_display.bb_ticket.bb_ticket.create',
    ];
    foreach ($shipped as $type => $name) {
      $values = Yaml::parseFile(dirname(__DIR__, 3) . "/config/install/$name.yml");
      unset($values['dependencies']);
      $this->container->get('entity_type.manager')->getStorage($type)->create($values)->save();
    }
    foreach (['a', 'b'] as $side) {
      $this->fixture($side, 'bb_workspace')->set('slug', "space-$side")->save();
    }
    $this->container->get('router.builder')->rebuild();

    $template = $this->template();
    $template->set('description', ['value' => 'Body', 'format' => 'bb_rich']);
    $template->save();

    $this->insider = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $this->insider, ['contributor']);
    $this->addMembership($this->fixture('a', 'bb_team'), $this->insider, []);
    $this->setCurrentUser($this->insider);
  }

  /**
   * The project-scoped add form binds the new template to that project.
   */
  public function testAddForProjectFixesTheProject(): void {
    $project = $this->fixture('a', 'bb_project');
    $route = $this->container->get('router.route_provider')
      ->getRouteByName('entity.bb_ticket_template.add_for_project');
    $request = Request::create('/add');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $request->attributes->add([
      RouteObjectInterface::ROUTE_NAME => 'entity.bb_ticket_template.add_for_project',
      RouteObjectInterface::ROUTE_OBJECT => $route,
      'bb_project' => $project,
      '_raw_variables' => new InputBag(['bb_project' => $project->id()]),
    ]);
    $this->container->get('request_stack')->push($request);

    $form_object = $this->container->get('entity_type.manager')->getFormObject('bb_ticket_template', 'add');
    $entity = $form_object->getEntityFromRouteMatch($this->container->get('current_route_match'), 'bb_ticket_template');
    self::assertInstanceOf(BbTicketTemplateInterface::class, $entity);
    self::assertSame((int) $project->id(), (int) $entity->get('project_id')->target_id);

    $form_object->setEntity($entity);
    $form = $this->container->get('form_builder')->getForm($form_object);
    self::assertFalse($form['project_id']['#access'], 'The project selector is hidden when the route fixes the project.');
  }

  /**
   * The target state is a picker of the chosen workflow's legal targets.
   */
  public function testTargetStateOptionsFollowTheWorkflow(): void {
    $form = $this->buildAddForm('bb_work', []);
    self::assertSame(['qualification', 'plan', 'working'], $this->pickerOptions($form, 'target_state'));
    // The workflow picker fires `change` from its own root, inside the field
    // wrapper; the wrapper posts the form back as triggered by the workflow.
    $refresh = $form['workflow']['#attributes'];
    self::assertArrayHasKey('data-hx-post', $refresh, 'Changing the workflow refreshes the options.');
    self::assertSame('change', $refresh['data-hx-trigger'] ?? NULL);
    self::assertStringContainsString('"_triggering_element_name":"workflow"', (string) ($refresh['data-hx-vals'] ?? ''));

    // No workflow yet: the picker opens on the default workflow, and the
    // targets are that workflow's.
    $form = $this->buildAddForm('', []);
    self::assertSame(['bb_work'], $form['workflow']['widget']['#default_value']);
    self::assertSame(['qualification', 'plan', 'working'], $this->pickerOptions($form, 'target_state'));
  }

  /**
   * The properties are one pill row, target state right of the workflow.
   */
  public function testTargetStateSitsRightOfTheWorkflow(): void {
    $form = $this->buildAddForm('bb_work', []);
    self::assertSame('bb_create_dialog', $form['#theme'] ?? NULL);
    $pills = array_values(array_filter(
      Element::children($form, TRUE),
      static fn (string $name): bool => ($form[$name]['#picker_region'] ?? NULL) === 'pills',
    ));
    self::assertSame(['workflow', 'target_state', 'labels', 'recipe', 'ticket_type', 'conductor_id'], $pills);
  }

  /**
   * The pattern fields read "Title" and "Description".
   */
  public function testPatternFieldsReadTitleAndDescription(): void {
    $form = $this->buildAddForm('bb_work', []);
    self::assertSame('Title', (string) $form['title_pattern']['widget'][0]['value']['#title']);
    self::assertSame('Description', (string) $form['description']['widget'][0]['#title']);
  }

  /**
   * On a page the form posts natively: a save redirects and shows its message.
   */
  public function testPageFormIsNotBoosted(): void {
    self::assertSame('false', $this->buildAddForm('bb_work', [])['#attributes']['data-hx-boost'] ?? NULL);
    self::assertArrayNotHasKey('data-hx-boost', $this->buildAddForm('bb_work', [], TRUE)['#attributes'] ?? []);
  }

  /**
   * A page form posts without the htmx keys of the boosted link that opened it.
   *
   * Re-rendered after an error, a page told its libraries are loaded would
   * arrive without CSS or JavaScript.
   */
  public function testPageFormPostsWithoutHtmxState(): void {
    $request = Request::create('/add', 'GET', ['ajax_page_state' => ['theme' => 'bb_theme'], 'destination' => '/tab']);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $form_object = $this->container->get('entity_type.manager')->getFormObject('bb_ticket_template', 'add');
    $form_object->setEntity($this->container->get('entity_type.manager')->getStorage('bb_ticket_template')->create([
      'project_id' => $this->fixture('a', 'bb_project')->id(),
    ]));
    $form_state = new FormState();
    $action = (string) $this->container->get('form_builder')->buildForm($form_object, $form_state)['#action'];
    self::assertStringNotContainsString('ajax_page_state', $action);
    self::assertStringContainsString('destination=/tab', urldecode($action));
  }

  /**
   * Workflow, target state, conductor and labels use the ticket form's picker.
   */
  public function testPropertiesArePickers(): void {
    $form = $this->buildAddForm('bb_work', []);
    foreach (['workflow', 'target_state', 'conductor_id', 'labels'] as $field) {
      self::assertSame('bb_picker_value', $form[$field]['widget']['#type'] ?? NULL, $field);
    }
  }

  /**
   * A full page offers the pickers' no-JavaScript fallback; a dialog does not.
   */
  public function testPickersFallBackWithoutJavaScriptOnThePage(): void {
    foreach ([FALSE => TRUE, TRUE => FALSE] as $htmx => $expected) {
      $form = $this->buildAddForm('bb_work', [], (bool) $htmx);
      foreach (['workflow', 'target_state', 'conductor_id', 'labels'] as $field) {
        $element = $form[$field]['widget'];
        foreach ($element['#pre_render'] as $callback) {
          $element = $callback($element);
        }
        self::assertSame($expected, $element['control']['#props']['fallback'] ?? FALSE, $field);
      }
    }
  }

  /**
   * Both pattern fields name the placeholders they accept.
   */
  public function testBothPatternsExplainTheirPlaceholders(): void {
    $form = $this->buildAddForm('bb_work', []);
    foreach ([
      (string) $form['title_pattern']['widget'][0]['value']['#description'],
      (string) $form['description']['widget'][0]['#description'],
    ] as $help) {
      self::assertStringContainsString('{{date}}', $help);
      self::assertStringContainsString('{{month}}', $help);
    }
  }

  /**
   * A workflow refresh rebuilds the options without saving or erroring.
   */
  public function testWorkflowRefreshNeitherSavesNorReportsErrors(): void {
    $request = Request::create('/add', 'POST');
    $request->headers->set('HX-Request', 'true');
    $request->headers->set('HX-Trigger-Name', 'workflow');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    // Anonymous: the form token is session-bound, which a kernel test cannot
    // reproduce; core skips it for anonymous forms only.
    $this->setCurrentUser(new AnonymousUserSession());
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket_template');
    $form_object = $this->container->get('entity_type.manager')->getFormObject('bb_ticket_template', 'add');
    $form_object->setEntity($storage->create(['project_id' => $this->fixture('a', 'bb_project')->id()]));
    $form_state = (new FormState())->setRequestMethod('POST')->setUserInput([
      'form_id' => $form_object->getFormId(),
      // What core's htmx-assets.js adds for the element that fired.
      '_triggering_element_name' => 'workflow',
      'name' => [['value' => 'Refreshed only']],
      'workflow' => 'bb_work',
    ]);
    $form = $this->container->get('form_builder')->buildForm($form_object, $form_state);

    self::assertSame('workflow', $form_state->getTriggeringElement()['#name'] ?? NULL, 'The refresh was processed as triggered by the workflow.');
    self::assertFalse($form_state->isSubmitted());
    self::assertSame([], $form_state->getErrors(), 'A half-filled form reports nothing on refresh.');
    self::assertSame(['qualification', 'plan', 'working'], $this->pickerOptions($form, 'target_state'));
    self::assertSame([], $storage->getQuery()->accessCheck(FALSE)->condition('name', 'Refreshed only')->execute());
  }

  /**
   * The description offers no text format help, without a per-form opt-out.
   */
  public function testDescriptionShowsNoFormatHelp(): void {
    $format = $this->buildAddForm('bb_work', [])['description']['widget'][0]['format'];
    self::assertFalse($format['help']['#access']);
    self::assertFalse($format['guidelines']['#access']);
  }

  /**
   * The option values a built picker field offers, after its pre-render.
   *
   * @param array<string, mixed> $form
   *   The built form.
   * @param string $field
   *   The picker field.
   *
   * @return array<int, string>
   *   The option values, in display order.
   */
  private function pickerOptions(array $form, string $field): array {
    $element = $form[$field]['widget'];
    foreach ($element['#pre_render'] as $callback) {
      $element = $callback($element);
    }
    return array_column($element['control']['#props']['options'], 'value');
  }

  /**
   * Builds the add form for a new template of workflow A.
   *
   * @param string $workflow
   *   The workflow stored on the new template.
   * @param array<string, string> $input
   *   Raw user input, as a refresh request posts it.
   * @param bool $htmx
   *   Whether the form is requested as the dialog.
   *
   * @return array<string, mixed>
   *   The built form.
   */
  private function buildAddForm(string $workflow, array $input, bool $htmx = FALSE): array {
    // The dialog: an htmx request through the dialog wrapper format.
    $request = Request::create('/add', 'GET', $htmx ? ['_wrapper_format' => 'island_dialog'] : []);
    if ($htmx) {
      $request->headers->set('HX-Request', 'true');
    }
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $template = $this->container->get('entity_type.manager')->getStorage('bb_ticket_template')->create([
      'workflow' => $workflow,
      'project_id' => $this->fixture('a', 'bb_project')->id(),
    ]);
    $form_object = $this->container->get('entity_type.manager')->getFormObject('bb_ticket_template', 'add');
    $form_object->setEntity($template);
    $form_state = (new FormState())->setUserInput($input);
    return $this->container->get('form_builder')->buildForm($form_object, $form_state);
  }

  /**
   * Opened as the dialog, the create form is the shared dialog posting into it.
   */
  public function testDialogOpensAsDialog(): void {
    $form = $this->buildDialog($this->template(), TRUE);
    self::assertStringContainsString('_wrapper_format=island_dialog', (string) ($form['#attributes']['data-hx-post'] ?? ''));
    self::assertSame('bb_create_dialog', $form['#theme'] ?? NULL, 'The shared create dialog.');
  }

  /**
   * The dialog opens prefilled with the template's rendered defaults.
   */
  public function testDialogIsPrefilledFromTemplate(): void {
    $template = $this->template();
    $label = $this->fixture('a', 'bb_term')->id();
    $template->set('title_pattern', 'Report {{date}}')->set('labels', [['target_id' => $label]])->save();

    $form = $this->buildDialog($template);

    self::assertMatchesRegularExpression('/^Report \d{4}-\d{2}-\d{2}$/', (string) $form['title']['widget'][0]['value']['#default_value']);
    self::assertSame('Body', trim((string) $form['description']['widget'][0]['#default_value']));
    self::assertSame(['bb_work'], (array) $form['workflow']['widget']['#default_value']);
    self::assertSame([(string) $label], array_map('strval', (array) $form['labels']['widget']['#default_value']));
  }

  /**
   * A project template binds its project: conductor offered, no project picker.
   */
  public function testProjectTemplateDialogOffersConductorNotProject(): void {
    $form = $this->buildDialog($this->template());
    self::assertArrayHasKey('conductor_id', $form);
    self::assertFalse(isset($form['project_id']) && ($form['project_id']['#access'] ?? TRUE));
  }

  /**
   * A workspace template binds no project: project picker, no conductor.
   */
  public function testWorkspaceTemplateDialogOffersProjectNotConductor(): void {
    $form = $this->buildDialog($this->workspaceTemplate());
    self::assertArrayHasKey('project_id', $form);
    self::assertArrayNotHasKey('conductor_id', $form);
  }

  /**
   * Parent and blockers are not template fields; the dialog leaves them out.
   */
  public function testDialogHidesParentAndBlockers(): void {
    $form = $this->buildDialog($this->template());
    self::assertArrayNotHasKey('parent_id', $form);
    self::assertArrayNotHasKey('blocked_by', $form);
  }

  /**
   * Submitting creates the ticket from the template and lands on it.
   */
  public function testSubmitCreatesAndLandsOnTicket(): void {
    $state = $this->submitDialog($this->template(), [
      'title' => [['value' => 'Edited title']],
      'workflow' => 'bb_work',
    ]);

    self::assertSame([], array_map('strval', $state->getErrors()));
    $tickets = $this->templateTickets();
    self::assertCount(1, $tickets);
    $ticket = reset($tickets);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    self::assertSame('Edited title', $ticket->label());
    self::assertSame((int) $this->template()->id(), (int) $ticket->get('template_id')->target_id);
    // A programmed submission hides its redirect from getRedirect().
    $redirect = (new \ReflectionProperty(FormState::class, 'redirect'))->getValue($state);
    self::assertInstanceOf(Url::class, $redirect);
    self::assertSame($ticket->toUrl()->toString(), $redirect->toString());
  }

  /**
   * A workspace template's ticket lands in the project picked in the dialog.
   */
  public function testEditedValuesReachTheTicket(): void {
    $project = (string) $this->fixture('a', 'bb_project')->id();
    $state = $this->submitDialog($this->workspaceTemplate(), [
      'title' => [['value' => 'Picked project']],
      'workflow' => 'bb_work',
      'project_id' => $project,
    ]);

    self::assertSame([], array_map('strval', $state->getErrors()));
    $tickets = $this->templateTickets();
    self::assertCount(1, $tickets);
    $ticket = reset($tickets);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    self::assertSame('Picked project', $ticket->label());
    self::assertSame('bb_work', $ticket->get('workflow')->value);
    self::assertSame($project, (string) $ticket->get('project_id')->target_id);
  }

  /**
   * The dialog offers the workflow's target states, preset from the template.
   */
  public function testDialogOffersTargetStateOfTheWorkflow(): void {
    $template = $this->template();
    $template->set('target_state', 'plan')->save();

    $form = $this->buildDialog($template);

    self::assertSame(['qualification', 'plan', 'working'], $this->pickerOptions($form, 'target_state'));
    self::assertSame(['plan'], (array) $form['target_state']['widget']['#default_value']);
    $refresh = $form['workflow']['#attributes'] ?? [];
    self::assertArrayHasKey('data-hx-post', $refresh, 'Changing the workflow refreshes the target states.');
    self::assertStringContainsString('"_triggering_element_name":"workflow"', (string) ($refresh['data-hx-vals'] ?? ''));
  }

  /**
   * A posted workflow offers its own target states.
   */
  public function testDialogTargetStatesFollowThePostedWorkflow(): void {
    $request = Request::create('/instantiate');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $state = (new FormState())->addBuildInfo('args', [$this->template()])->setUserInput(['workflow' => 'bb_work']);
    $form = $this->container->get('form_builder')->buildForm(TicketTemplateInstantiateForm::class, $state);

    self::assertSame(['qualification', 'plan', 'working'], $this->pickerOptions($form, 'target_state'));
  }

  /**
   * After a workflow change the ticket lands in the target state picked for it.
   */
  public function testChangedWorkflowCreatesInPickedTargetState(): void {
    $template = $this->template();
    $template->set('target_state', 'plan')->save();

    $state = $this->submitDialog($template, [
      'title' => [['value' => 'Verification instead']],
      'workflow' => 'bb_verification',
      'target_state' => 'summary',
    ]);

    self::assertSame([], array_map('strval', $state->getErrors()));
    $tickets = $this->templateTickets();
    self::assertCount(1, $tickets);
    $ticket = reset($tickets);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    self::assertSame('bb_verification', $ticket->get('workflow')->value);
    self::assertSame('summary', $ticket->get('state')->value);
  }

  /**
   * A rejected instantiation rebuilds the dialog with the edited values.
   */
  public function testRebuildKeepsEditedValues(): void {
    $template = $this->template();
    $template->set('target_state', 'plan')->save();

    // `plan` is unreachable in bb_verification, so the instantiation is
    // refused.
    $state = $this->submitDialog($template, [
      'title' => [['value' => 'Kept title']],
      'workflow' => 'bb_verification',
      'target_state' => 'plan',
    ]);

    self::assertSame([], $this->templateTickets());
    self::assertTrue($state->isRebuilding(), 'The dialog is shown again.');
    $form_object = $state->getFormObject();
    self::assertInstanceOf(TicketTemplateInstantiateForm::class, $form_object);
    self::assertSame('Kept title', $form_object->getEntity()->label());
    self::assertNotEmpty($this->container->get('messenger')->messagesByType('error'));
  }

  /**
   * The workspace add route fixes the workspace and offers an optional project.
   */
  public function testAddForWorkspaceOffersOptionalProject(): void {
    $route = $this->container->get('router.route_provider')
      ->getRouteByName('entity.bb_ticket_template.add_for_workspace');
    self::assertSame('/_workspace/{bb_workspace}/ticket-template/add-for-workspace', $route->getPath());
    $form_object = $this->workspaceAddForm();
    $entity = $form_object->getEntity();
    self::assertInstanceOf(BbTicketTemplateInterface::class, $entity);
    self::assertSame((int) $this->fixture('a', 'bb_workspace')->id(), $entity->getScopeWorkspaceId());
    self::assertTrue($entity->get('project_id')->isEmpty());

    $form = $this->container->get('form_builder')->getForm($form_object);
    self::assertNotFalse($form['project_id']['#access'] ?? TRUE, 'The project is offered.');
    self::assertSame('bb_picker_value', $form['project_id']['widget']['#type'] ?? NULL, 'A picker, like the other properties.');
    self::assertSame([(string) $this->fixture('a', 'bb_project')->id()], $this->pickerOptions($form, 'project_id'), 'Only projects of this workspace.');
    self::assertNotFalse($form['conductor_id']['#access'] ?? TRUE, 'The conductor is offered, as on the project tab.');
    self::assertArrayHasKey('data-hx-post', $form['project_id']['#attributes'] ?? [], 'Picking a project refreshes the conductor.');
  }

  /**
   * Without a project the template is a workspace template.
   */
  public function testAddForWorkspaceWithoutProjectSavesWorkspaceTemplate(): void {
    $template = $this->submitWorkspaceAdd('Workspace scoped', []);
    self::assertSame((int) $this->fixture('a', 'bb_workspace')->id(), $template->getScopeWorkspaceId());
    self::assertTrue($template->get('project_id')->isEmpty());
  }

  /**
   * With a project of this workspace the template is that project's template.
   */
  public function testAddForWorkspaceWithProjectSavesProjectTemplate(): void {
    $project = (string) $this->fixture('a', 'bb_project')->id();
    $conductor = (string) $this->fixture('a', 'bb_conductor')->id();
    $template = $this->submitWorkspaceAdd('Project scoped', ['project_id' => $project, 'conductor_id' => $conductor]);
    self::assertSame($project, (string) $template->get('project_id')->target_id);
    self::assertSame($conductor, (string) $template->get('conductor_id')->target_id);
    self::assertFalse($template->isWorkspaceScoped());
  }

  /**
   * A project of another workspace is refused; nothing is saved.
   */
  public function testAddForWorkspaceRejectsProjectOfAnotherWorkspace(): void {
    $state = $this->submitWorkspaceAddState('Foreign project', ['project_id' => (string) $this->fixture('b', 'bb_project')->id()]);
    self::assertNotSame([], $state->getErrors());
    self::assertSame([], $this->container->get('entity_type.manager')->getStorage('bb_ticket_template')->loadByProperties(['name' => 'Foreign project']));
  }

  /**
   * The add form on the workspace route, its entity taken from the route.
   */
  private function workspaceAddForm(): BbTicketTemplateForm {
    $route = $this->container->get('router.route_provider')
      ->getRouteByName('entity.bb_ticket_template.add_for_workspace');
    $request = Request::create('/add', 'GET');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $request->attributes->add([
      RouteObjectInterface::ROUTE_NAME => 'entity.bb_ticket_template.add_for_workspace',
      RouteObjectInterface::ROUTE_OBJECT => $route,
      'bb_workspace' => $this->fixture('a', 'bb_workspace'),
      '_raw_variables' => new InputBag(['bb_workspace' => 'space-a']),
    ]);
    $this->container->get('request_stack')->push($request);
    $form_object = $this->container->get('entity_type.manager')->getFormObject('bb_ticket_template', 'add');
    self::assertInstanceOf(BbTicketTemplateForm::class, $form_object);
    $form_object->setEntity($form_object->getEntityFromRouteMatch($this->container->get('current_route_match'), 'bb_ticket_template'));
    return $form_object;
  }

  /**
   * Submits the workspace add form.
   *
   * @param string $name
   *   The template name.
   * @param array<string, mixed> $values
   *   Further submitted values.
   */
  private function submitWorkspaceAddState(string $name, array $values): FormStateInterface {
    $form_object = $this->workspaceAddForm();
    $state = new FormState();
    $state->setValues($values + [
      'name' => [['value' => $name]],
      'title_pattern' => [['value' => 'From the form']],
      'description' => [['value' => 'Body', 'format' => 'bb_rich']],
      'workflow' => 'bb_work',
      'target_state' => 'qualification',
      'op' => 'Save',
    ]);
    $this->container->get('form_builder')->submitForm($form_object, $state);
    return $state;
  }

  /**
   * Submits the workspace add form and returns the saved template.
   *
   * @param string $name
   *   The template name.
   * @param array<string, mixed> $values
   *   Further submitted values.
   */
  private function submitWorkspaceAdd(string $name, array $values): BbTicketTemplateInterface {
    $state = $this->submitWorkspaceAddState($name, $values);
    self::assertSame([], array_map('strval', $state->getErrors()));
    $saved = $this->container->get('entity_type.manager')->getStorage('bb_ticket_template')->loadByProperties(['name' => $name]);
    self::assertCount(1, $saved, 'The template was saved.');
    $template = reset($saved);
    self::assertInstanceOf(BbTicketTemplateInterface::class, $template);
    return $template;
  }

  /**
   * Adding a workspace template needs the create right in that workspace.
   */
  public function testContributorGets403OnWorkspaceAdd(): void {
    $url = static fn (string $slug): Url => Url::fromRoute('entity.bb_ticket_template.add_for_workspace', ['bb_workspace' => $slug]);
    $reader = $this->createAccount('template-reader');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $reader, ['member']);

    self::assertTrue($url('space-a')->access($this->insider), 'A holder of the create right may add.');
    self::assertFalse($url('space-a')->access($reader), 'A member without it may not.');
    self::assertFalse($url('space-b')->access($this->insider), 'Nor in another workspace.');
  }

  /**
   * Builds the create-ticket dialog of a template.
   *
   * @return array<string, mixed>
   *   The built form.
   */
  private function buildDialog(BbTicketTemplateInterface $template, bool $htmx = FALSE): array {
    $request = Request::create('/instantiate', 'GET', $htmx ? ['_wrapper_format' => 'island_dialog'] : []);
    if ($htmx) {
      $request->headers->set('HX-Request', 'true');
    }
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    return $this->container->get('form_builder')->getForm(TicketTemplateInstantiateForm::class, $template);
  }

  /**
   * Submits the create-ticket dialog of a template.
   *
   * @param \Drupal\bb_core\Entity\BbTicketTemplateInterface $template
   *   The template.
   * @param array<string, mixed> $values
   *   The submitted values.
   */
  private function submitDialog(BbTicketTemplateInterface $template, array $values): FormStateInterface {
    $request = Request::create('/instantiate');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $state = (new FormState())->addBuildInfo('args', [$template]);
    $state->setValues($values + ['op' => 'Create ticket']);
    $this->container->get('form_builder')->submitForm(TicketTemplateInstantiateForm::class, $state);
    return $state;
  }

  /**
   * Creates an enabled workspace template.
   */
  private function workspaceTemplate(string $side = 'a'): BbTicketTemplateInterface {
    $template = $this->createEntity('bb_ticket_template', [
      'name' => "workspace-template-$side",
      'enabled' => TRUE,
      'title_pattern' => 'From the workspace',
      'description' => ['value' => 'Body', 'format' => 'bb_rich'],
      'workflow' => 'bb_work',
      'target_state' => 'qualification',
      'workspace_id' => $this->fixture($side, 'bb_workspace')->id(),
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    self::assertInstanceOf(BbTicketTemplateInterface::class, $template);
    return $template;
  }

  /**
   * Editing is the template's Settings tab, titled as such.
   */
  public function testEditFormIsTheSettingsTab(): void {
    $route = $this->container->get('router.route_provider')->getRouteByName('entity.bb_ticket_template.edit_form');
    self::assertStringEndsWith('/settings', $route->getPath());
    self::assertSame('Settings', $route->getDefault('_title'));
    self::assertNull($route->getDefault('_title_callback'));
  }

  /**
   * Tickets generated from any template, bypassing access.
   *
   * @return array<\Drupal\Core\Entity\EntityInterface>
   *   The tickets.
   */
  private function templateTickets(): array {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    return $storage->loadMultiple($storage->getQuery()->accessCheck(FALSE)->exists('template_id')->execute());
  }

  /**
   * The workspace-A template fixture.
   */
  private function template(): BbTicketTemplateInterface {
    $template = $this->fixture('a', 'bb_ticket_template');
    self::assertInstanceOf(BbTicketTemplateInterface::class, $template);
    return $template;
  }

}
