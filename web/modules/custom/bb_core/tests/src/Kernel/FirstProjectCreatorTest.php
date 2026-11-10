<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Route;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Form\BbFirstProjectForm;
use Drupal\bb_core\Onboarding\FirstProjectCreator;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The wizard's first-project act: group and project, or nothing.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class FirstProjectCreatorTest extends KernelTestBase {

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
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og', 'bb_core',
  ];

  /**
   * The new account: lead of workspace B and member of its team.
   */
  private UserInterface $owner;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
    $this->owner = $this->createAccount('first-project-owner', ['create bb_project']);
    $lead = OgRole::load('bb_workspace-bb_workspace-lead');
    self::assertNotNull($lead);
    Og::createMembership($this->workspace(), $this->owner)
      ->addRole($lead)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
    $this->setCurrentUser($this->owner);
  }

  /**
   * A group and a project on the owner's team are created and linked.
   */
  public function testCreatesGroupAndProjectOnTheOwnersTeam(): void {
    $this->joinTeam();

    $project = $this->creator()->create($this->workspace(), $this->owner, 'Bakery App', 'https://example.com/acme/bakery.git', 'Platform');

    self::assertSame('Bakery App', $project->label());
    self::assertSame('https://example.com/acme/bakery.git', $project->get('repository')->url);
    self::assertNotEmpty($project->get('key')->value, 'The key is derived.');
    $group = $project->get('group_id')->entity;
    self::assertInstanceOf(ContentEntityInterface::class, $group);
    self::assertSame('Platform', $group->label());
    self::assertSame((string) $this->workspace()->id(), (string) $group->get('workspace_id')->target_id);
    self::assertSame(
      [(string) $this->fixture('b', 'bb_team')->id()],
      array_map('strval', array_column($project->get('teams')->getValue(), 'target_id')),
    );
  }

  /**
   * An invalid repository leaves neither group nor project behind.
   */
  public function testInvalidRepositoryRollsEverythingBack(): void {
    $this->joinTeam();
    $before = $this->counts();

    try {
      $this->creator()->create($this->workspace(), $this->owner, 'Bakery App', 'not a url', 'Platform');
      self::fail('An invalid repository must not create a project.');
    }
    catch (\InvalidArgumentException) {
      // Expected: the form turns this into an error message.
    }

    self::assertSame($before, $this->counts());
  }

  /**
   * An owner who is on no team of the workspace cannot get a project.
   */
  public function testRefusesWithoutMemberTeam(): void {
    $before = $this->counts();

    try {
      $this->creator()->create($this->workspace(), $this->owner, 'Bakery App', 'https://example.com/a/b.git', 'Platform');
      self::fail('A project needs a team of the owner.');
    }
    catch (\InvalidArgumentException) {
      // Expected.
    }

    self::assertSame($before, $this->counts());
  }

  /**
   * The page's Create makes group and project on the owner's team.
   */
  public function testFirstProjectFormCreatesTheProject(): void {
    $this->joinTeam();
    $this->enterTheFirstProjectPage();
    $form_state = (new FormState())->setValues([
      'project_name' => 'Bakery App',
      'repository_url' => 'https://example.com/acme/bakery.git',
      'group_name' => 'Platform',
      'create_project' => 'Create project',
    ]);
    $this->container->get('form_builder')->submitForm(BbFirstProjectForm::class, $form_state);

    self::assertSame([], array_map('strval', $form_state->getErrors()));
    $projects = $this->container->get('entity_type.manager')->getStorage('bb_project')->loadByProperties(['name' => 'Bakery App']);
    self::assertCount(1, $projects);
  }

  /**
   * An invalid repository shows the error on the page and creates nothing.
   */
  public function testFirstProjectFormKeepsTheInputOnAnError(): void {
    $this->joinTeam();
    $this->enterTheFirstProjectPage();
    $before = $this->counts();
    $form_state = (new FormState())->setValues([
      'project_name' => 'Bakery App',
      'repository_url' => 'not a url',
      'group_name' => 'Platform',
      'create_project' => 'Create project',
    ]);
    $this->container->get('form_builder')->submitForm(BbFirstProjectForm::class, $form_state);

    self::assertSame($before, $this->counts());
    self::assertNotEmpty($this->container->get('messenger')->messagesByType('error'));
  }

  /**
   * Skip asks for nothing and creates nothing.
   */
  public function testSkipCreatesNothingAndAsksForNothing(): void {
    $this->joinTeam();
    $this->enterTheFirstProjectPage();
    $before = $this->counts();
    $form_state = (new FormState())->setValues(['skip_project' => 'Skip']);
    $this->container->get('form_builder')->submitForm(BbFirstProjectForm::class, $form_state);

    self::assertSame([], array_map('strval', $form_state->getErrors()));
    self::assertSame($before, $this->counts());
  }

  /**
   * Makes the request stand on the first-project page of workspace B.
   */
  private function enterTheFirstProjectPage(): void {
    $request = $this->container->get('request_stack')->getCurrentRequest();
    self::assertInstanceOf(Request::class, $request);
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, 'bb_core.first_project');
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, new Route('/home/first-project/{bb_workspace}'));
    $request->attributes->set('bb_workspace', $this->workspace());
  }

  /**
   * Puts the owner on the world's team of workspace B.
   */
  private function joinTeam(): void {
    Og::createMembership($this->fixture('b', 'bb_team'), $this->owner)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
  }

  /**
   * The workspace the owner stands in.
   */
  private function workspace(): BbWorkspaceInterface {
    $workspace = $this->fixture('b', 'bb_workspace');
    assert($workspace instanceof BbWorkspaceInterface);
    return $workspace;
  }

  /**
   * How many groups and projects exist.
   *
   * @return array<string, int>
   *   Counts by entity type id.
   */
  private function counts(): array {
    $counts = [];
    foreach (['bb_group', 'bb_project'] as $type) {
      $counts[$type] = (int) $this->container->get('entity_type.manager')
        ->getStorage($type)->getQuery()->accessCheck(FALSE)->count()->execute();
    }
    return $counts;
  }

  /**
   * The service under test.
   */
  private function creator(): FirstProjectCreator {
    return $this->container->get('bb_core.onboarding_first_project');
  }

}
