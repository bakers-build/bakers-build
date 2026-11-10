<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\FileStorage;
use Drupal\Core\Form\FormState;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Form\BbOnboardingWizardForm;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The wizard's optional "create your first project" step.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class OnboardingFirstProjectStepTest extends KernelTestBase {

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
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'ui_patterns', 'bb_core',
  ];

  /**
   * A lead of workspace B who is on its team, onboarding not completed.
   */
  private UserInterface $lead;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
    $this->installSchema('user', ['users_data']);
    $this->container->get('router.builder')->rebuild();
    $this->installOnboardingFields();

    $this->lead = $this->createAccount('onboarding-lead');
    $role = OgRole::load('bb_workspace-bb_workspace-lead');
    self::assertNotNull($role);
    Og::createMembership($this->fixture('b', 'bb_workspace'), $this->lead)
      ->addRole($role)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
    Og::createMembership($this->fixture('b', 'bb_team'), $this->lead)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
    $this->setCurrentUser($this->lead);
  }

  /**
   * A permitted account sees the project step as step 3 of 4.
   */
  public function testStepIsShownAsThreeOfFour(): void {
    $form = $this->build(3);

    self::assertSame('Step 3 of 4', (string) $form['#bb_copy']['progress']);
    self::assertSame('3', $form['#attributes']['data-bakers-onboarding-step']);
    self::assertArrayHasKey('project_yes', $form['actions']);
    self::assertArrayHasKey('project_later', $form['actions']);
    self::assertArrayHasKey('back', $form['actions']);
    self::assertArrayNotHasKey('finish', $form['actions']);
    self::assertSame(
      [['Your name', 'done'], ['About you', 'done'], ['First project', 'current'], ['Get started', 'upcoming']],
      array_map(static fn (array $step): array => [$step['label'], $step['state']], $form['#bb_copy']['steps']),
    );
  }

  /**
   * Every step explains itself in the gate's left band.
   */
  public function testEveryStepCarriesAnExplanation(): void {
    foreach ([1, 2, 3, 4] as $step) {
      $form = $this->build($step);
      self::assertNotSame('', trim((string) ($form['#bb_copy']['explanation'] ?? '')), "Step $step has an explanation.");
    }
  }

  /**
   * An account that may not create sees the wizard exactly as before.
   */
  public function testStepIsHiddenWithoutCreateRights(): void {
    $this->setCurrentUser($this->createAccount('plain-member'));

    $form = $this->build(3);

    self::assertSame('Step 3 of 3', (string) $form['#bb_copy']['progress']);
    self::assertArrayHasKey('finish_create', $form['actions']);
    self::assertArrayNotHasKey('project_yes', $form['actions']);
    self::assertCount(3, $form['#bb_copy']['steps']);
  }

  /**
   * Later opens documentation as step 4 of 4; Back from it returns.
   */
  public function testLaterGoesToDocumentationAndBackReturns(): void {
    $form_state = $this->submit(3, 'project_later');

    self::assertSame(4, (int) $form_state->get('bb_onboarding_step'));
    self::assertSame([], $this->projects());
    $form = $this->build(4);
    self::assertSame('Step 4 of 4', (string) $form['#bb_copy']['progress']);
    self::assertArrayHasKey('finish', $form['actions']);

    $back = $this->submit(4, 'back');
    self::assertSame(3, (int) $back->get('bb_onboarding_step'));
  }

  /**
   * Yes swaps the choice for the fields, Back returns to the choice.
   */
  public function testYesShowsFieldsAndBackShowsChoice(): void {
    $form_state = $this->submit(3, 'project_yes');
    $form = $this->build(3, $form_state);

    foreach (['project_name', 'repository_url', 'group_name'] as $field) {
      self::assertArrayHasKey($field, $form['fields']);
    }
    self::assertArrayHasKey('project_create', $form['actions']);
    self::assertArrayHasKey('project_back', $form['actions']);
    self::assertArrayNotHasKey('project_yes', $form['actions']);

    $this->submitIn($form_state, 'project_back');
    $form = $this->build(3, $form_state);
    self::assertArrayHasKey('project_yes', $form['actions']);
  }

  /**
   * Create makes the project, completes onboarding and lands on the project.
   */
  public function testCreateLandsOnTheNewProject(): void {
    $form_state = $this->submit(3, 'project_yes');
    $form_state->setValues([
      'project_name' => 'Bakery App',
      'repository_url' => 'https://example.com/acme/bakery.git',
      'group_name' => 'Platform',
    ]);
    // A new request starts without the previous submit's rebuild flag.
    $form_state->setRebuild(FALSE);
    $this->submitIn($form_state, 'project_create');

    $projects = $this->projects();
    self::assertCount(1, $projects);
    $redirect = $form_state->getRedirect();
    self::assertInstanceOf(Url::class, $redirect);
    self::assertSame(reset($projects)->toUrl()->toString(), $redirect->toString());
    self::assertTrue($this->container->get('bb_core.onboarding_destination')->isComplete($this->reload()));
    self::assertNull($this->container->get('user.data')->get('bb_core', (int) $this->lead->id(), 'onboarding_step'));
  }

  /**
   * An invalid repository keeps the step, shows the error, creates nothing.
   */
  public function testInvalidRepositoryStaysOnTheStep(): void {
    $form_state = $this->submit(3, 'project_yes');
    $form_state->setValues([
      'project_name' => 'Bakery App',
      'repository_url' => 'not a url',
      'group_name' => 'Platform',
    ]);
    $this->submitIn($form_state, 'project_create');

    self::assertSame([], $this->projects());
    self::assertTrue($form_state->isRebuilding());
    self::assertNotEmpty($this->container->get('messenger')->messagesByType('error'));
    self::assertFalse($this->container->get('bb_core.onboarding_destination')->isComplete($this->reload()));
    $form = $this->build(3, $form_state);
    self::assertArrayHasKey('project_create', $form['actions']);
  }

  /**
   * Builds the wizard at a saved step.
   *
   * @return array<string, mixed>
   *   The built form.
   */
  private function build(int $step, ?FormState $form_state = NULL): array {
    $form_state ??= (new FormState())->set('bb_onboarding_step', $step);
    return BbOnboardingWizardForm::create($this->container)->buildForm([], $form_state);
  }

  /**
   * Submits one action on a step and returns the resulting form state.
   */
  private function submit(int $step, string $action): FormState {
    $form_state = (new FormState())->set('bb_onboarding_step', $step);
    $this->submitIn($form_state, $action);
    return $form_state;
  }

  /**
   * Submits one action against an existing form state.
   */
  private function submitIn(FormState $form_state, string $action): void {
    $form_state->setTriggeringElement(['#name' => $action]);
    $form = [];
    BbOnboardingWizardForm::create($this->container)->submitForm($form, $form_state);
  }

  /**
   * All projects.
   *
   * @return array<int|string, \Drupal\Core\Entity\EntityInterface>
   *   Projects of the world fixture are excluded.
   */
  private function projects(): array {
    $fixture = [(string) $this->fixture('a', 'bb_project')->id(), (string) $this->fixture('b', 'bb_project')->id()];
    return array_filter(
      $this->container->get('entity_type.manager')->getStorage('bb_project')->loadMultiple(),
      static fn ($project): bool => !in_array((string) $project->id(), $fixture, TRUE),
    );
  }

  /**
   * Reloads the lead.
   */
  private function reload(): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')->load($this->lead->id());
    self::assertInstanceOf(UserInterface::class, $user);
    return $user;
  }

  /**
   * Installs onboarding fields from config/sync.
   */
  private function installOnboardingFields(): void {
    $this->container->get('config.typed')->clearCachedDefinitions();
    $storage = new FileStorage(dirname($this->root) . '/config/sync');
    foreach (['field_full_name', 'field_developer_title', 'field_bb_background', 'field_onboarding_completed'] as $name) {
      $storageData = $storage->read("field.storage.user.$name");
      $fieldData = $storage->read("field.field.user.user.$name");
      self::assertIsArray($storageData);
      self::assertIsArray($fieldData);
      FieldStorageConfig::create($storageData)->save();
      FieldConfig::create($fieldData)->save();
    }
  }

}
