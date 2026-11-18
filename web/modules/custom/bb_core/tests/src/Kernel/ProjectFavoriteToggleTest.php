<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Form\ProjectFavoriteForm;
use Drupal\Core\Form\FormState;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Profile\Profiles;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\Entity\User;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * The project overview's favorite form: form token, project access, ownership.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectFavoriteToggleTest extends KernelTestBase {

  use UserCreationTrait;
  use OgScopeFixtureTrait;
  use RailRequestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'og', 'ui_patterns', 'island', 'bb_core',
  ];

  /**
   * The project's workspace.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * The project under test.
   */
  private BbProjectInterface $project;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_group', 'bb_project', 'bb_profile'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->installOgScopeFixture();
    $this->createUser([], 'uid1-dummy');
    $etm = $this->container->get('entity_type.manager');
    $workspace = $etm->getStorage('bb_workspace')->create(['name' => 'Acme', 'slug' => 'acme']);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;
    $group = $etm->getStorage('bb_group')->create(['name' => 'Platform Group', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $etm->getStorage('bb_project')->create([
      'name' => 'Platform',
      'key' => 'PLAT',
      'group_id' => $group->id(),
    ]);
    $project->save();
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $this->project = $project;
  }

  /**
   * A submission with a forged form token is refused and stores nothing.
   */
  public function testForgedFormTokenIsRefused(): void {
    $this->lead();
    self::assertArrayHasKey('form_token', $this->submitForged());
    self::assertSame([], $this->container->get('entity_type.manager')->getStorage('bb_profile')->loadMultiple());
  }

  /**
   * A viewer marks and unmarks; another account's favorites stay untouched.
   */
  public function testViewerTogglesOwnFavoriteOnly(): void {
    $lead = $this->lead();
    $colleague = $this->lead();
    $this->setCurrentUser($lead);
    $profiles = $this->container->get(Profiles::class);

    self::assertTrue($this->access($lead));
    $this->submit();
    self::assertSame([(int) $this->project->id()], $profiles->forAccount((int) $lead->id(), (int) $this->workspace->id())->favoriteProjectIds());
    self::assertTrue($profiles->forAccount((int) $colleague->id(), (int) $this->workspace->id())->isNew(), 'another account is untouched');

    $this->submit();
    self::assertSame([], $profiles->forAccount((int) $lead->id(), (int) $this->workspace->id())->favoriteProjectIds());
  }

  /**
   * An account that may not view the project, or anonymous, is refused.
   */
  public function testNonViewerAndAnonymousAreRefused(): void {
    $outsider = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $outsider);
    $this->setCurrentUser($outsider);
    self::assertFalse($this->access($outsider));

    $anonymous = User::getAnonymousUser();
    $this->setCurrentUser($anonymous);
    self::assertFalse($this->access($anonymous));
  }

  /**
   * The overview offers the toggle form, naming the state; elsewhere nothing.
   */
  public function testOverviewActionNamesTheState(): void {
    $this->lead();
    $this->visit('entity.bb_project.canonical', $this->parameters());
    $action = $this->action();
    self::assertSame(ProjectFavoriteForm::WRAPPER_ID, $action['#attributes']['id']);
    self::assertSame('Add to favorites', (string) $action['form']['toggle']['#value']);
    self::assertFalse($action['form']['toggle']['#bb_pressed']);
    self::assertSame('/acme/project/' . $this->project->id() . '/favorite', $action['form']['#action']);
    self::assertContains('user', $action['#cache']['contexts']);

    $this->submit();
    $action = $this->action();
    self::assertSame('Remove from favorites', (string) $action['form']['toggle']['#value']);
    self::assertTrue($action['form']['toggle']['#bb_pressed']);

    $this->setCurrentUser(User::getAnonymousUser());
    self::assertArrayNotHasKey('form', $this->action(), 'anonymous');
    $this->lead();
    $this->visit('bb_core.home');
    self::assertArrayNotHasKey('form', $this->action(), 'another route');
  }

  /**
   * The favorite action's value on the current route.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  private function action(): array {
    $source = $this->container->get('plugin.manager.ui_patterns_source')->createInstance(
      'bb_project_favorite_action',
      SourcePluginBase::buildConfiguration('actions', ['type' => 'object'], ['source' => []], []),
    );
    self::assertInstanceOf(SourcePluginBase::class, $source);
    $value = $source->getPropValue();
    self::assertIsArray($value);
    return $value;
  }

  /**
   * A lead of the workspace, made the current account.
   */
  private function lead(): UserInterface {
    $lead = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $lead);
    $this->addMembership($this->workspace, $lead, ['lead']);
    $this->setCurrentUser($lead);
    return $lead;
  }

  /**
   * Whether the route admits the account.
   */
  private function access(UserInterface $account): bool {
    return $this->container->get('access_manager')->checkNamedRoute('bb_core.project.favorite', $this->parameters(), $account);
  }

  /**
   * Submits the toggle form as the current account, without JavaScript.
   */
  private function submit(): void {
    $this->container->get('request_stack')->push(Request::create('/favorite', 'POST'));
    try {
      $form_state = (new FormState())->addBuildInfo('args', [$this->project]);
      $this->container->get('form_builder')->submitForm(ProjectFavoriteForm::class, $form_state);
      self::assertSame([], $form_state->getErrors());
    }
    finally {
      $this->container->get('request_stack')->pop();
      $this->container->get('entity_type.manager')->getStorage('bb_profile')->resetCache();
    }
  }

  /**
   * Posts the toggle form with a forged form token.
   *
   * @return string[]
   *   The form errors.
   */
  private function submitForged(): array {
    $request = Request::create('/favorite', 'POST');
    $request->setSession($this->container->get('session'));
    $this->container->get('request_stack')->push($request);
    try {
      $form_state = (new FormState())
        ->addBuildInfo('args', [$this->project])
        ->setUserInput(['form_id' => 'bb_project_favorite_form', 'form_token' => 'forged']);
      $this->container->get('form_builder')->buildForm(ProjectFavoriteForm::class, $form_state);
      return array_map('strval', $form_state->getErrors());
    }
    finally {
      $this->container->get('request_stack')->pop();
    }
  }

  /**
   * The route parameters for the project.
   *
   * @return array<string, int|string>
   *   Workspace slug and project id.
   */
  private function parameters(): array {
    return ['bb_workspace' => 'acme', 'bb_project' => (int) $this->project->id()];
  }

}
