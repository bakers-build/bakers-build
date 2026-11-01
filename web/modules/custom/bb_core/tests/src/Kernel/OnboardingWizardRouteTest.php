<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\FileStorage;
use Drupal\Core\Form\FormState;
use Drupal\Core\Url;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\bb_core\Entity\BbInvite;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Form\BbOnboardingWizardForm;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserDataInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The wizard form is the onboarding route's main content.
 *
 * `_wrapper_format=drupal_htmx` renders the controller/form result only. A
 * form that lives solely on the island profile is never built on next,
 * so Form API never sees the POST.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class OnboardingWizardRouteTest extends KernelTestBase {

  use UserCreationTrait;
  use OgScopeFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'ui_patterns', 'file', 'image', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_team');
    $this->installEntitySchema('bb_invite');
    $this->installSchema('user', ['users_data']);
    $this->installConfig(['system', 'user']);
    $this->installOgScopeFixture();
    $this->container->get('router.builder')->rebuild();
    $this->createUser([], 'uid1-dummy');
    $this->createUser([], 'world-owner');
    $this->installOnboardingFields();
  }

  /**
   * Next POSTs are processed only when the form is the route itself.
   */
  public function testWizardFormIsTheRouteMainContent(): void {
    $route = $this->container->get('router.route_provider')->getRouteByName('bb_core.onboarding');
    self::assertSame(
      BbOnboardingWizardForm::class,
      ltrim((string) $route->getDefault('_form'), '\\'),
    );
  }

  /**
   * Finish swaps the shared canvas rather than emptying `body`.
   *
   * HTMX parses an HX-Location GET as a fragment and strips `html`/`body`,
   * so `select: body` matches nothing. Drupal's off-canvas canvas is present
   * on the wizard and on `/home`, which is the target the spec requires.
   */
  public function testFinishSwapsTheSharedCanvasOntoTheOverview(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);

    $request = $this->container->get('request_stack')->getCurrentRequest();
    self::assertInstanceOf(Request::class, $request);
    $request->headers->set('HX-Request', 'true');

    $form_object = BbOnboardingWizardForm::create($this->container);
    $form_state = new FormState();
    $form_state->set('bb_onboarding_step', 4);
    $form_state->setTriggeringElement(['#name' => 'finish']);
    $form = [];
    $form_object->submitForm($form, $form_state);

    $response = $form_state->getResponse();
    self::assertInstanceOf(Response::class, $response);
    self::assertFalse($response->headers->has('HX-Redirect'));
    $location = json_decode((string) $response->headers->get('HX-Location'), TRUE);
    self::assertIsArray($location);
    self::assertSame('/home', $location['path'] ?? NULL);
    self::assertSame('[data-off-canvas-main-canvas]', $location['target'] ?? NULL);
    self::assertSame('[data-off-canvas-main-canvas]', $location['select'] ?? NULL);
    self::assertSame('outerHTML', $location['swap'] ?? NULL);
    self::assertTrue($form_state->getIgnoreDestination());
    $account = $this->reloadAccount($account);
    $destination = $this->container->get('bb_core.onboarding_destination');
    self::assertTrue($destination->isComplete($account));
    self::assertNull($this->userData()->get('bb_core', (int) $account->id(), 'onboarding_step'));
  }

  /**
   * Step-2 Next saves About-you answers and opens setup without completing.
   */
  public function testStepTwoNextSavesAboutWithoutCompleting(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);

    $form_object = BbOnboardingWizardForm::create($this->container);
    $form_state = new FormState();
    $form_state->set('bb_onboarding_step', 2);
    $form_state->setValue('field_developer_title', 'Product Lead');
    $form_state->setValue('field_bb_background', 'I ship Drupal.');
    $form_state->setTriggeringElement(['#name' => 'next']);
    $form = [];
    $form_object->submitForm($form, $form_state);

    $destination = $this->container->get('bb_core.onboarding_destination');
    $account = $this->reloadAccount($account);
    self::assertFalse($destination->isComplete($account));
    self::assertSame('Product Lead', (string) $account->get('field_developer_title')->value);
    self::assertSame('I ship Drupal.', (string) $account->get('field_bb_background')->value);
    self::assertSame(3, (int) $this->userData()->get('bb_core', (int) $account->id(), 'onboarding_step'));
    self::assertSame(3, (int) $form_state->get('bb_onboarding_step'));
    self::assertTrue($form_state->isRebuilding());
  }

  /**
   * Setup Next opens the project page without completing.
   */
  public function testSetupNextOpensTheProjectPage(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);

    $form_state = new FormState();
    $form_state->set('bb_onboarding_step', 3);
    $form = BbOnboardingWizardForm::create($this->container)->buildForm([], $form_state);
    self::assertArrayHasKey('next', $form['actions']);
    self::assertArrayHasKey('set_up_later', $form['actions']);
    self::assertArrayNotHasKey('finish', $form['actions']);
    self::assertStringContainsString('Step 3 of 4', (string) $form['progress']['#props']['text']);

    $form_state->setTriggeringElement(['#name' => 'next']);
    $submit = [];
    BbOnboardingWizardForm::create($this->container)->submitForm($submit, $form_state);
    self::assertSame(4, (int) $form_state->get('bb_onboarding_step'));
    self::assertSame(4, (int) $this->userData()->get('bb_core', (int) $account->id(), 'onboarding_step'));
    self::assertFalse($this->container->get('bb_core.onboarding_destination')->isComplete($this->reloadAccount($account)));
  }

  /**
   * The project page is last: Finish is offered, Next is not.
   */
  public function testProjectIsTheLastPage(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);

    $form_state = new FormState();
    $form_state->set('bb_onboarding_step', 4);
    $form = BbOnboardingWizardForm::create($this->container)->buildForm([], $form_state);
    self::assertArrayHasKey('finish', $form['actions']);
    self::assertArrayHasKey('finish_create', $form['actions']);
    self::assertArrayHasKey('set_up_later', $form['actions']);
    self::assertArrayHasKey('back', $form['actions']);
    self::assertArrayNotHasKey('next', $form['actions']);
    self::assertSame('Prepare your first project', $form['#bb_copy']['title']);
    self::assertStringContainsString('Step 4 of 4', (string) $form['progress']['#props']['text']);
  }

  /**
   * An incomplete account resumes at its saved step on a fresh form build.
   */
  public function testReloadUsesSavedStep(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);
    $this->userData()->set('bb_core', (int) $account->id(), 'onboarding_step', 3);

    $form = BbOnboardingWizardForm::create($this->container)->buildForm([], new FormState());
    self::assertSame('3', $form['#attributes']['data-bakers-onboarding-step']);
    self::assertSame('Get started - set up bakers.build on your machine', $form['#bb_copy']['title']);
  }

  /**
   * Invalid stored progress for an incomplete account starts at identity.
   */
  public function testInvalidSavedProgressStartsAtIdentity(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);
    $this->userData()->set('bb_core', (int) $account->id(), 'onboarding_step', 99);

    $form = BbOnboardingWizardForm::create($this->container)->buildForm([], new FormState());
    self::assertSame('1', $form['#attributes']['data-bakers-onboarding-step']);
  }

  /**
   * Completed accounts reopen at setup step 3, even with leftover progress.
   */
  public function testCompletedAccountReopensAtSetup(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $account->set('field_onboarding_completed', TRUE)->save();
    $this->container->get('current_user')->setAccount($account);
    $this->userData()->set('bb_core', (int) $account->id(), 'onboarding_step', 1);

    $form = BbOnboardingWizardForm::create($this->container)->buildForm([], new FormState());
    self::assertSame('3', $form['#attributes']['data-bakers-onboarding-step']);
    self::assertArrayNotHasKey('back', $form['actions']);
    self::assertSame('Setup', (string) $form['progress']['#props']['text']);
  }

  /**
   * Set up later dismisses onboarding and lands on home.
   */
  public function testSetUpLaterMarksCompleteAndGoesHome(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);
    $this->userData()->set('bb_core', (int) $account->id(), 'onboarding_step', 3);

    $form_object = BbOnboardingWizardForm::create($this->container);
    $form_state = new FormState();
    $form_state->set('bb_onboarding_step', 3);
    $form_state->setTriggeringElement(['#name' => 'set_up_later']);
    $form = [];
    $form_object->submitForm($form, $form_state);

    $destination = $this->container->get('bb_core.onboarding_destination');
    $account = $this->reloadAccount($account);
    self::assertTrue($destination->isComplete($account));
    self::assertNull($this->userData()->get('bb_core', (int) $account->id(), 'onboarding_step'));
    $redirect = $form_state->getRedirect();
    self::assertInstanceOf(Url::class, $redirect);
    self::assertSame('bb_core.home', $redirect->getRouteName());
    self::assertTrue($form_state->getIgnoreDestination());
  }

  /**
   * Without an invitation offer, HTMX Finish & create uses a full redirect.
   */
  public function testHtmxFinishCreateRedirectsToWorkspaceCreate(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);
    $request = $this->container->get('request_stack')->getCurrentRequest();
    self::assertInstanceOf(Request::class, $request);
    $request->headers->set('HX-Request', 'true');

    $form_object = BbOnboardingWizardForm::create($this->container);
    $form_state = new FormState();
    $form_state->set('bb_onboarding_step', 4);
    $form_state->setTriggeringElement(['#name' => 'finish_create']);
    $form = [];
    $form_object->submitForm($form, $form_state);

    $response = $form_state->getResponse();
    self::assertInstanceOf(Response::class, $response);
    self::assertSame('/home/new-workspace', $response->headers->get('HX-Redirect'));
    self::assertFalse($response->headers->has('HX-Location'));
    self::assertTrue($this->container->get('bb_core.onboarding_destination')->isComplete($this->reloadAccount($account)));
  }

  /**
   * A pending invitation offer turns Finish & create into home.
   */
  public function testFinishCreateWithOfferGoesHome(): void {
    $account = $this->createUser([], 'invitee', FALSE, ['mail' => 'invitee@example.com']);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);
    $this->invite($account, $this->workspace('bakers'));

    $form_object = BbOnboardingWizardForm::create($this->container);
    $form_state = new FormState();
    $form_state->set('bb_onboarding_step', 4);
    $form = $form_object->buildForm([], $form_state);
    self::assertArrayNotHasKey('finish_create', $form['actions']);

    $form_state->setTriggeringElement(['#name' => 'finish_create']);
    $form_object->submitForm($form, $form_state);
    $redirect = $form_state->getRedirect();
    self::assertInstanceOf(Url::class, $redirect);
    self::assertSame('bb_core.home', $redirect->getRouteName());
    self::assertTrue($this->container->get('bb_core.onboarding_destination')->isComplete($this->reloadAccount($account)));
  }

  /**
   * Query destinations are discarded on a successful terminal action.
   */
  public function testTerminalActionIgnoresDestinationQuery(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);
    $request = $this->container->get('request_stack')->getCurrentRequest();
    self::assertInstanceOf(Request::class, $request);
    $request->query->set('destination', 'https://example.invalid/hijack');

    $form_object = BbOnboardingWizardForm::create($this->container);
    $form_state = new FormState();
    $form_state->set('bb_onboarding_step', 4);
    $form_state->setTriggeringElement(['#name' => 'finish']);
    $form = [];
    $form_object->submitForm($form, $form_state);
    self::assertTrue($form_state->getIgnoreDestination());
    $redirect = $form_state->getRedirect();
    self::assertInstanceOf(Url::class, $redirect);
    self::assertSame('bb_core.home', $redirect->getRouteName());
  }

  /**
   * A late finish after completion keeps the flag true.
   */
  public function testLateFinishDoesNotClearCompletion(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $account->set('field_onboarding_completed', TRUE)->save();
    $this->container->get('current_user')->setAccount($account);

    $form_object = BbOnboardingWizardForm::create($this->container);
    $form_state = new FormState();
    $form_state->set('bb_onboarding_step', 4);
    $form_state->setTriggeringElement(['#name' => 'finish']);
    $form = [];
    $form_object->submitForm($form, $form_state);
    self::assertTrue($this->container->get('bb_core.onboarding_destination')->isComplete($this->reloadAccount($account)));
  }

  /**
   * Ordinary account forms cannot author the completion flag.
   */
  public function testCompletionFieldEditAccessIsForbidden(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $items = $account->get('field_onboarding_completed');
    self::assertFalse($items->access('edit', $account));
  }

  /**
   * Uninvited project offers both finish actions; invited offers only home.
   */
  public function testFinishActionsDependOnInvitationOffers(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);
    $form_state = new FormState();
    $form_state->set('bb_onboarding_step', 4);
    $form = BbOnboardingWizardForm::create($this->container)->buildForm([], $form_state);
    self::assertArrayHasKey('finish', $form['actions']);
    self::assertArrayHasKey('finish_create', $form['actions']);
    self::assertArrayHasKey('set_up_later', $form['actions']);
  }

  /**
   * Displayed commands are complete lines in their owning documentation pages.
   */
  public function testSetupCommandsMatchOwningDocumentation(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);

    $install = $this->docLines('docs/get-started/install.md');
    $form_object = BbOnboardingWizardForm::create($this->container);

    $form_state = new FormState();
    $form_state->set('bb_onboarding_step', 3);
    $step3 = $form_object->buildForm([], $form_state);
    $step3Commands = $this->commandsFromForm($step3);
    foreach ($step3Commands as $command) {
      self::assertContains($command, $install, $command . ' must be a complete line in install.md.');
    }
    self::assertNotContains('https://git.key-tec.de/bakers-build/bakers-build.git', $step3Commands);
    self::assertContains('/plugin marketplace add https://bakers.build/marketplace.json', $step3Commands);
    self::assertContains('codex plugin marketplace add https://git.key-tec.de/bakers-build/bakers-build.git', $step3Commands);
    self::assertContains('codex plugin add bakers@bakers', $step3Commands);
    self::assertContains('Use `bakers:bb-init` to guide me through installing and setting up bakers.build.', $step3Commands);
    $pluginInstall = array_search('/plugin install bakers@bakers', $step3Commands, TRUE);
    $initPrompt = array_search('Use `bakers:bb-init` to guide me through installing and setting up bakers.build.', $step3Commands, TRUE);
    self::assertIsInt($pluginInstall);
    self::assertIsInt($initPrompt);
    self::assertLessThan($initPrompt, $pluginInstall);
    self::assertNotContains('npm install -g @bakers-build/bakers', $step3Commands);
    self::assertNotContains('bakers --version', $step3Commands);
    $step3Blob = serialize($step3);
    self::assertStringContainsString('bb_theme:setup_paths', $step3Blob);
    self::assertStringNotContainsString('Install with', $step3Blob);
    self::assertStringContainsString('Agent', $step3Blob);
    $this->assertDocsLinks($step3);
    self::assertNotContains('bakers init', $step3Commands);
    self::assertNotContains('bakers dropsh auth login', $step3Commands);
    self::assertNotContains('herdr --version', $step3Commands);

    $connect = $this->docLines('docs/get-started/connect-a-project.md');
    $form_state = new FormState();
    $form_state->set('bb_onboarding_step', 4);
    $step4 = $form_object->buildForm([], $form_state);
    $step4Commands = $this->commandsFromForm($step4);
    foreach ($step4Commands as $command) {
      self::assertContains($command, $connect, $command . ' must be a complete line in connect-a-project.md.');
    }
    self::assertContains('Use `bakers:bb-init-project` to connect this checkout as a bakers.build project.', $step4Commands);
    self::assertNotContains('bakers init', $step4Commands);
    self::assertNotContains('bakers dropsh auth login', $step4Commands);
    self::assertNotContains('herdr --version', $step4Commands);
    $step4Blob = serialize($step4);
    self::assertStringContainsString('bb_theme:link-group', $step4Blob);
    self::assertStringContainsString('/get-started/connect-a-project', $step4Blob);
    self::assertStringContainsString('Initialize a project', $step4Blob);
  }

  /**
   * The Agent filter is an SDC.
   *
   * PHP passes props and slots, never classes or Alpine.
   */
  public function testSetupAgentFilterUsesSegmentedControlItems(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);

    $form_state = new FormState();
    $form_state->set('bb_onboarding_step', 3);
    $step3 = BbOnboardingWizardForm::create($this->container)->buildForm([], $form_state);
    $paths = $step3['fields']['paths'];
    self::assertSame('component', $paths['#type']);
    self::assertSame('bb_theme:setup_paths', $paths['#component']);
    self::assertArrayNotHasKey('#attributes', $paths);
    self::assertSame('claude', $paths['#props']['items'][0]['value']);
    self::assertSame('codex', $paths['#props']['items'][1]['value']);
    self::assertArrayNotHasKey('filter_items', $paths['#slots'] ?? []);
    $formFile = (new \ReflectionClass(BbOnboardingWizardForm::class))->getFileName();
    self::assertIsString($formFile);
    $src = (string) file_get_contents($formFile);
    self::assertDoesNotMatchRegularExpression("/'x-data'\s*=>/", $src);
    self::assertDoesNotMatchRegularExpression("/'x-show'\s*=>/", $src);
    $blob = serialize($step3);
    self::assertDoesNotMatchRegularExpression('/\[[0-9]+px\]/', $blob);
    self::assertStringNotContainsString("'x-data'", $blob);
    self::assertStringNotContainsString("'x-show'", $blob);
  }

  /**
   * Plugin marketplace commands follow bb_core.settings:plugin_source_base.
   */
  public function testSetupCommandsUseConfiguredPluginSourceBase(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);
    $this->config('bb_core.settings')
      ->set('plugin_source_base', 'https://example.test/org/')
      ->save();

    $form_state = new FormState();
    $form_state->set('bb_onboarding_step', 3);
    $step3 = BbOnboardingWizardForm::create($this->container)->buildForm([], $form_state);
    $commands = $this->commandsFromForm($step3);
    self::assertContains('/plugin marketplace add https://example.test/org/bakers-build.git', $commands);
    self::assertContains('codex plugin marketplace add https://example.test/org/bakers-build.git', $commands);
    self::assertNotContains('/plugin marketplace add https://git.key-tec.de/bakers-build/bakers-build.git', $commands);
  }

  /**
   * User-supplied data never becomes a shell command.
   */
  public function testCommandsContainNoAccountInput(): void {
    $account = $this->createUser([], 'attacker', FALSE, [
      'mail' => 'evil@example.com',
      'name' => 'rm -rf /',
    ]);
    self::assertInstanceOf(UserInterface::class, $account);
    $account->set('field_developer_title', '$(reboot)')->save();
    $this->container->get('current_user')->setAccount($account);
    $form_state = new FormState();
    $form_state->set('bb_onboarding_step', 3);
    $form = BbOnboardingWizardForm::create($this->container)->buildForm([], $form_state);
    $blob = serialize($form);
    self::assertStringNotContainsString('evil@example.com', $blob);
    self::assertStringNotContainsString('$(reboot)', $blob);
    self::assertStringNotContainsString('rm -rf /', $blob);
  }

  /**
   * Core user.data for this wizard.
   */
  private function userData(): UserDataInterface {
    $data = $this->container->get('user.data');
    self::assertInstanceOf(UserDataInterface::class, $data);
    return $data;
  }

  /**
   * Reloads the account from storage.
   */
  private function reloadAccount(UserInterface $account): UserInterface {
    $reloaded = $this->container->get('entity_type.manager')->getStorage('user')->load($account->id());
    self::assertInstanceOf(UserInterface::class, $reloaded);
    return $reloaded;
  }

  /**
   * Creates — or returns — the workspace with the given slug.
   */
  private function workspace(string $slug): BbWorkspaceInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_workspace');
    $existing = $storage->loadByProperties(['slug' => $slug]);
    if ($existing !== []) {
      $workspace = reset($existing);
      self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
      return $workspace;
    }
    $owner = user_load_by_name('world-owner');
    self::assertInstanceOf(UserInterface::class, $owner);
    $workspace = $storage->create([
      'name' => $slug,
      'slug' => $slug,
      'owner_user_id' => $owner->id(),
    ]);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    return $workspace;
  }

  /**
   * Stores an invitation addressed to the account.
   */
  private function invite(UserInterface $account, BbWorkspaceInterface $workspace): BbInvite {
    $owner = user_load_by_name('world-owner');
    self::assertInstanceOf(UserInterface::class, $owner);
    $invite = BbInvite::create([
      'email' => $account->getEmail(),
      'workspace_id' => $workspace->id(),
      'owner_user_id' => $owner->id(),
    ]);
    $invite->save();
    self::assertInstanceOf(BbInvite::class, $invite);
    return $invite;
  }

  /**
   * Command strings rendered into the form.
   *
   * @return list<string>
   *   The displayed commands.
   */
  private function commandsFromForm(array $form): array {
    $commands = [];
    $this->collectCommands($form, $commands);
    return array_values(array_unique($commands));
  }

  /**
   * Walks a render array for setup-command props.
   *
   * @param array<string, mixed> $element
   *   A render element.
   * @param list<string> $commands
   *   Collected command strings.
   */
  private function collectCommands(array $element, array &$commands): void {
    $component = (string) ($element['#component'] ?? '');
    if ($component === 'bb_theme:setup_command') {
      $command = (string) ($element['#props']['command'] ?? '');
      if ($command !== '') {
        $commands[] = $command;
      }
    }
    if (isset($element['#slots']) && is_array($element['#slots'])) {
      foreach ($element['#slots'] as $slot) {
        if (is_array($slot)) {
          $this->collectCommands($slot, $commands);
        }
      }
    }
    foreach ($element as $key => $child) {
      if (!is_array($child)) {
        continue;
      }
      if (!is_string($key) || ($key !== '' && $key[0] !== '#')) {
        $this->collectCommands($child, $commands);
      }
    }
  }

  /**
   * Documentation links on a setup page.
   */
  private function assertDocsLinks(array $form): void {
    $blob = serialize($form);
    self::assertStringContainsString('bb_theme:link-group', $blob);
    self::assertStringContainsString('https://bakers.build/docs/get-started/', $blob);
    self::assertStringContainsString('https://bakers.build/docs/get-started/install', $blob);
    self::assertStringContainsString('skill-wizard-', $blob);
  }

  /**
   * Trimmed lines of a repository documentation page.
   *
   * @return list<string>
   *   Trimmed lines.
   */
  private function docLines(string $relative): array {
    $path = dirname($this->root) . '/' . $relative;
    $contents = file_get_contents($path);
    self::assertNotFalse($contents, $relative . ' exists.');
    $lines = preg_split('/\R/', $contents) ?: [];
    return array_values(array_map(static fn (string $line): string => trim($line), $lines));
  }

  /**
   * Installs onboarding fields from config/sync.
   */
  private function installOnboardingFields(): void {
    $this->container->get('config.typed')->clearCachedDefinitions();
    $storage = new FileStorage(dirname($this->root) . '/config/sync');
    foreach ([
      'field_full_name',
      'field_developer_title',
      'field_bb_background',
      'field_onboarding_completed',
    ] as $name) {
      $storageData = $storage->read("field.storage.user.$name");
      self::assertIsArray($storageData, "config/sync/field.storage.user.$name.yml exists.");
      FieldStorageConfig::create($storageData)->save();
      $fieldData = $storage->read("field.field.user.user.$name");
      self::assertIsArray($fieldData, "config/sync/field.field.user.user.$name.yml exists.");
      FieldConfig::create($fieldData)->save();
    }
  }

}
