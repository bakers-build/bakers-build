<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Render\PageDisplayVariantSelectionEvent;
use Drupal\Core\Config\Schema\Mapping;
use Drupal\Core\Config\Schema\Sequence;
use Drupal\island\IslandRuntimeId;
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\Routing\Route;
use Symfony\Component\HttpFoundation\Request;
use Drupal\island\Form\IslandProfileForm;
use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Core\Form\FormState;
use Drupal\system\Entity\Menu;
use Drupal\user\Entity\User;
use Drupal\user\UserInterface;
use Drupal\island\IslandInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * Verifies the first persisted App/Profile rendering tracer bullet.
 */
#[Group('island')]
final class AppProfilePlacementTest extends KernelTestBase {

  use ProfileRequestTrait;

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'system',
    'path_alias',
    'user',
    'sdc',
    'sdc_test',
    'island',
    'island_test',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('path_alias');
    $this->installEntitySchema('user');
  }

  /**
   * A persisted profile renders its configured placement through an SDC slot.
   */
  public function testPersistedProfileRendersPlacementThroughItsLayoutSlot(): void {
    $app = App::create([
      'id' => 'test_app',
      'label' => 'Test app',
    ]);
    $app->save();

    $profile = IslandProfile::create([
      'id' => 'test_profile',
      'label' => 'Test profile',
      'app' => 'test_app',
      'layout' => 'sdc_test:my-banner',
      'layout_settings' => [
        'heading' => 'Profile',
        'ctaText' => 'Home',
        'ctaHref' => 'https://example.com',
        'ctaTarget' => '',
      ],
      'placements' => [
        'placement_a' => [
          'plugin_id' => 'test_island',
          'slot' => 'banner_body',
          'weight' => 0,
          'enabled' => TRUE,
          'configuration' => ['marker' => 'configured'],
          'data' => ['marker' => 'configured'],
        ],
      ],
    ]);
    $profile->save();

    $stored = IslandProfile::load('test_profile');
    self::assertNotNull($stored);
    self::assertSame('test_app', $stored->getAppId());
    self::assertSame('test_island', $stored->getPlacement('placement_a')['plugin_id']);

    $build = $this->container->get('island.profile_renderer')->render($stored, 'instance_a');
    $html = (string) $this->container->get('renderer')->renderInIsolation($build);

    self::assertStringContainsString('test-island:configured', $html);
    self::assertStringContainsString('island-profile_5b22746573745f617070222c22746573745f70726f66696c65222c22696e7374616e63655f61225d-placement_a', $html);
    self::assertStringNotContainsString('island-test_profile-instance_a-test_island', $html);
  }

  /**
   * A layout switch keeps a placement whose old slot no longer exists.
   */
  public function testLayoutSwitchKeepsUnassignedPlacementConfiguration(): void {
    self::assertTrue($this->container->has('island.layout_manager'), 'The island layout manager is available.');

    $app = App::create(['id' => 'switch_app', 'label' => 'Switch app']);
    $app->save();
    $profile = IslandProfile::create([
      'id' => 'switch_profile',
      'label' => 'Switch profile',
      'app' => 'switch_app',
      'layout' => 'sdc_test:my-banner',
      'placements' => [
        'placement_a' => [
          'plugin_id' => 'test_island',
          'slot' => 'old_slot',
          'configuration' => ['marker' => 'kept'],
        ],
      ],
    ]);
    $profile->save();

    $slots = $this->container->get('island.layout_manager')->getSlots('sdc_test:my-banner');
    self::assertArrayHasKey('banner_body', $slots);
    self::assertSame(['kept'], [
      $profile->getUnassignedPlacements($slots)['placement_a']['configuration']['marker'],
    ]);

    $form_object = $this->container->get('entity_type.manager')->getFormObject('island_profile', 'edit');
    $form_object->setEntity($profile);
    $form_state = new FormState();
    $form = $this->container->get('form_builder')->buildForm($form_object, $form_state);
    self::assertArrayHasKey('_unassigned', $form['placements']);
    self::assertArrayHasKey('placement_a', $form['placements']['_unassigned']['placements']);
    self::assertArrayHasKey('slot', $form['placements']['_unassigned']['placements']['placement_a']);

    $unresolved_state = new FormState();
    $unresolved_state->setValue('layout', 'sdc_test:my-banner');
    $unresolved_state->setValue('placements', [
      '_unassigned' => ['placements' => ['placement_a' => ['slot' => '', 'remove' => FALSE]]],
    ]);
    $form_object->validateForm($form, $unresolved_state);
    self::assertNotEmpty($unresolved_state->getErrors());

    $resolved_state = new FormState();
    $resolved_state->setValue('layout', 'sdc_test:my-banner');
    $resolved_state->setValue('placements', [
      '_unassigned' => ['placements' => ['placement_a' => ['slot' => 'banner_body', 'remove' => FALSE]]],
    ]);
    $form_object->validateForm($form, $resolved_state);
    self::assertEmpty($resolved_state->getErrors());
    $form_object->submitForm($form, $resolved_state);
    $updated = $form_object->getEntity();
    self::assertInstanceOf(IslandProfile::class, $updated);
    self::assertSame('banner_body', $updated->getPlacement('placement_a')['slot']);
    self::assertSame('kept', $updated->getPlacement('placement_a')['configuration']['marker']);
  }

  /**
   * Adding a placement must preserve unsaved configuration already entered.
   */
  public function testAddingPlacementPreservesSubmittedValues(): void {
    App::create(['id' => 'form_app', 'label' => 'Form app'])->save();
    $profile = IslandProfile::create([
      'id' => 'form_profile',
      'label' => 'Original',
      'app' => 'form_app',
      'layout' => 'sdc_test:my-banner',
      'placements' => [
        'first' => [
          'plugin_id' => 'menu',
          'slot' => 'banner_body',
          'configuration' => ['menu_name' => 'main', 'depth' => 1],
        ],
      ],
    ]);
    $profile->save();
    $form_object = $this->container->get('entity_type.manager')->getFormObject('island_profile', 'edit');
    $form_object->setEntity($profile);
    $state = new FormState();
    $form = $this->container->get('form_builder')->buildForm($form_object, $state);
    $state->setValues([
      'label' => 'Edited',
      'id' => 'form_profile',
      'app' => 'form_app',
      'layout' => 'sdc_test:my-banner',
      'weight' => 3,
      'new_placement_plugin' => 'page_content',
      'placements' => [
        'banner_body' => [
          'placements' => [
            'first' => [
              'plugin_id' => 'menu',
              'slot' => 'banner_body',
              'weight' => 8,
              'enabled' => TRUE,
              'configuration' => ['menu_name' => 'footer', 'depth' => 4],
            ],
          ],
        ],
      ],
    ]);
    self::assertInstanceOf(IslandProfileForm::class, $form_object);
    $form_object->addPlacementSubmit($form, $state);
    $updated = $form_object->getEntity();
    self::assertInstanceOf(IslandProfile::class, $updated);
    self::assertSame('Edited', $updated->label());
    self::assertSame(['menu_name' => 'footer', 'depth' => 4], $updated->getPlacement('first')['configuration']);
    self::assertCount(2, $updated->get('placements'));
    self::assertTrue($state->isRebuilding());
  }

  /**
   * Existing placements expose moving and explicit removal through the form.
   */
  public function testAssignedPlacementCanBeMovedAndRemoved(): void {
    App::create(['id' => 'move_app', 'label' => 'Move app'])->save();
    $profile = IslandProfile::create([
      'id' => 'move_profile',
      'label' => 'Move',
      'app' => 'move_app',
      'layout' => 'sdc_test:my-banner',
      'placements' => ['first' => ['plugin_id' => 'page_content', 'slot' => 'banner_body']],
    ]);
    $profile->save();
    $form_object = $this->container->get('entity_type.manager')->getFormObject('island_profile', 'edit');
    $form_object->setEntity($profile);
    $state = new FormState();
    $form = $this->container->get('form_builder')->buildForm($form_object, $state);
    $placement = $form['placements']['banner_body']['placements']['first'];
    self::assertSame('select', $placement['slot']['#type']);
    self::assertArrayHasKey('remove', $placement);
    $state->setValue('placements', ['banner_body' => ['placements' => ['first' => ['remove' => TRUE]]]]);
    $form_object->submitForm($form, $state);
    $updated = $form_object->getEntity();
    self::assertInstanceOf(IslandProfile::class, $updated);
    self::assertSame([], $updated->get('placements'));
  }

  /**
   * Rejects a submitted slot that is not declared by the selected layout.
   */
  public function testAssignedPlacementRejectsInvalidSubmittedSlot(): void {
    App::create(['id' => 'invalid_slot_app', 'label' => 'Invalid slot app'])->save();
    $profile = IslandProfile::create([
      'id' => 'invalid_slot_profile',
      'label' => 'Invalid slot',
      'app' => 'invalid_slot_app',
      'layout' => 'sdc_test:my-banner',
      'placements' => [
        'first' => ['plugin_id' => 'page_content', 'slot' => 'banner_body'],
      ],
    ]);
    $profile->save();

    $form_object = $this->container->get('entity_type.manager')->getFormObject('island_profile', 'edit');
    $form_object->setEntity($profile);
    $form_state = new FormState();
    $form = $this->container->get('form_builder')->buildForm($form_object, $form_state);
    $form_state->setValue('layout', 'sdc_test:my-banner');
    $form_state->setValue('placements', [
      'banner_body' => [
        'placements' => [
          'first' => ['slot' => 'not-a-layout-slot', 'remove' => FALSE],
        ],
      ],
    ]);

    $form_object->validateForm($form, $form_state);

    self::assertNotEmpty($form_state->getErrors());
  }

  /**
   * Repeated plugin placements and profile instances have isolated targets.
   */
  public function testRepeatedPlacementsAndProfileInstancesKeepIndependentIds(): void {
    $app = App::create(['id' => 'repeat_app', 'label' => 'Repeat app']);
    $app->save();
    $profile = IslandProfile::create([
      'id' => 'repeat_profile',
      'label' => 'Repeat profile',
      'app' => 'repeat_app',
      'layout' => 'sdc_test:my-banner',
      'layout_settings' => [
        'heading' => 'Profile',
        'ctaText' => 'Home',
        'ctaHref' => 'https://example.com',
        'ctaTarget' => '',
      ],
      'placements' => [
        'first' => [
          'plugin_id' => 'test_island',
          'slot' => 'banner_body',
          'configuration' => ['marker' => 'first'],
          'data' => ['marker' => 'first'],
        ],
        'second' => [
          'plugin_id' => 'test_island',
          'slot' => 'banner_body',
          'configuration' => ['marker' => 'second'],
          'data' => ['marker' => 'second'],
        ],
      ],
    ]);
    $profile->save();

    $renderer = $this->container->get('island.profile_renderer');
    $first_build = $renderer->render($profile, 'one');
    $second_build = $renderer->render($profile, 'two');
    $first = (string) $this->container->get('renderer')->renderInIsolation($first_build);
    $second = (string) $this->container->get('renderer')->renderInIsolation($second_build);

    self::assertStringContainsString('test-island:first', $first);
    self::assertStringContainsString('test-island:second', $first);
    self::assertStringContainsString('island-profile_5b227265706561745f617070222c227265706561745f70726f66696c65222c226f6e65225d-first', $first);
    self::assertStringContainsString('island-profile_5b227265706561745f617070222c227265706561745f70726f66696c65222c226f6e65225d-second', $first);
    self::assertStringNotContainsString('island-profile_5b227265706561745f617070222c227265706561745f70726f66696c65222c2274776f225d-', $first);
    self::assertStringContainsString('island-profile_5b227265706561745f617070222c227265706561745f70726f66696c65222c2274776f225d-first', $second);
    self::assertStringContainsString('island-profile_5b227265706561745f617070222c227265706561745f70726f66696c65222c2274776f225d-second', $second);
    self::assertStringNotContainsString('island-profile_5b227265706561745f617070222c227265706561745f70726f66696c65222c226f6e65225d-', $second);

    $resolved = $this->container->get('island.host_resolver')->resolveHtmlId('island-profile_5b227265706561745f617070222c227265706561745f70726f66696c65222c2274776f225d-second');
    self::assertNotNull($resolved);
    self::assertIsArray($resolved);
    self::assertArrayHasKey('island_id', $resolved);
    self::assertArrayHasKey('island', $resolved);
    self::assertSame('second', $resolved['island_id']);
    self::assertSame('test_island', $resolved['island']->getPluginId());
  }

  /**
   * An applicable profile wins by priority and the app default is the fallback.
   */
  public function testProfileSelectionUsesConditionsPriorityAndDefault(): void {
    self::assertTrue($this->container->has('island.profile_selector'));

    $app = App::create([
      'id' => 'selection_app',
      'label' => 'Selection app',
      'default_profile' => 'selection_default',
    ]);
    $app->save();
    IslandProfile::create([
      'id' => 'selection_default',
      'label' => 'Default',
      'app' => 'selection_app',
      'weight' => 20,
    ])->save();
    IslandProfile::create([
      'id' => 'selection_detail',
      'label' => 'Detail',
      'app' => 'selection_app',
      'weight' => 10,
      'conditions' => self::pages('/detail/*'),
    ])->save();
    IslandProfile::create([
      'id' => 'selection_lower_priority',
      'label' => 'Lower priority',
      'app' => 'selection_app',
      'weight' => 30,
      'conditions' => self::pages('/detail/*'),
    ])->save();
    IslandProfile::create([
      'id' => 'selection_any',
      'label' => 'Any',
      'app' => 'selection_app',
      'weight' => 40,
      'condition_operator' => 'or',
      'conditions' => self::pages('/never') + [
        'user_role' => self::role('authenticated'),
      ],
    ])->save();

    $this->enterPath('/detail/7');
    $selector = $this->container->get('island.profile_selector');
    $cache = new CacheableMetadata();
    self::assertSame('selection_detail', $selector->select($app, $cache)->id());
    self::assertContains('url.path', $cache->getCacheContexts());
    self::assertContains('config:island.profile.selection_detail', $cache->getCacheTags());
    self::assertContains('config:island_profile_list', $cache->getCacheTags());

    $this->enterPath('/other');
    $selector = $this->container->get('island.profile_selector');
    $this->container->get('current_user')->setAccount($this->createUserWithRole());
    $cache = new CacheableMetadata();
    self::assertSame('selection_any', $selector->select($app, $cache)->id(), 'Any passing condition selects an OR profile.');
    self::assertContains('user.roles', $cache->getCacheContexts());
    self::assertContains('config:island.profile.selection_lower_priority', $cache->getCacheTags(), 'Rejected candidates vary the decision too.');

    $this->container->get('current_user')->setAccount(User::getAnonymousUser());
    $this->enterPath('/other');
    $selector = $this->container->get('island.profile_selector');
    $cache = new CacheableMetadata();
    self::assertSame('selection_default', $selector->select($app, $cache)->id());
    foreach (['selection_detail', 'selection_lower_priority', 'selection_any', 'selection_default'] as $id) {
      self::assertContains("config:island.profile.$id", $cache->getCacheTags());
    }
  }

  /**
   * A page without a matching profile still varies by the rejected conditions.
   */
  public function testOrdinaryContentFallbackKeepsSelectionCacheability(): void {
    $this->conditionalProfile();
    $app = App::load('conditional_app');
    $this->enterPath('/_workspace/alpha/tickets');
    $cache = new CacheableMetadata();
    self::assertNull($this->container->get('island.profile_selector')->select($app, $cache));
    self::assertContains('url.path', $cache->getCacheContexts());
    self::assertContains('config:island.profile.conditional', $cache->getCacheTags(), 'The rejected profile varies the decision.');
    self::assertContains('config:island_profile_list', $cache->getCacheTags());

    $this->config('island.settings')->set('page_app', 'conditional_app')->save();
    $event = new PageDisplayVariantSelectionEvent('simple_page', $this->container->get('current_route_match'));
    $this->container->get('island.profile_page_variant_subscriber')->onSelectPageDisplayVariant($event);
    self::assertSame('simple_page', $event->getPluginId(), 'No profile matched, so the ordinary page variant stays.');
    $fallback = CacheableMetadata::createFromObject($event);
    self::assertContains('url.path', $fallback->getCacheContexts(), 'The ordinary page carries the selection contexts.');
    self::assertContains('config:island.profile.conditional', $fallback->getCacheTags());
  }

  /**
   * Evaluation is one core path: negation, empty collections, failures.
   */
  public function testConditionEvaluatorUsesCoreAndFailsClosed(): void {
    $this->enterPath('/a');
    $evaluator = $this->container->get('island.condition_evaluator');
    $this->container->get('current_user')->setAccount($this->createUserWithRole());
    self::assertTrue($evaluator->evaluate(self::pages('/a'))->isAllowed());
    self::assertFalse($evaluator->evaluate(self::pages('/a', TRUE))->isAllowed(), 'Core negates.');
    self::assertTrue($evaluator->evaluate([])->isAllowed(), 'Empty AND passes.');
    self::assertFalse($evaluator->evaluate([], 'or')->isAllowed(), 'Empty OR does not.');

    $both = self::pages('/a') + ['user_role' => self::role('anonymous')];
    $and = $evaluator->evaluate($both);
    self::assertFalse($and->isAllowed());
    self::assertTrue($evaluator->evaluate($both, 'or')->isAllowed());
    $cache = CacheableMetadata::createFromObject($and);
    self::assertContains('url.path', $cache->getCacheContexts());
    self::assertContains('user.roles', $cache->getCacheContexts(), 'A short-circuited condition still varies the result.');

    foreach ([
      [['missing_plugin' => ['id' => 'missing_plugin']], 'and'],
      [['missing_plugin' => ['id' => 'missing_plugin', 'negate' => TRUE]], 'and'],
      [self::pages('/a'), 'xor'],
    ] as [$conditions, $operator]) {
      $result = $evaluator->evaluate($conditions, $operator);
      self::assertTrue($result->isForbidden(), 'An unevaluable collection denies, also negated.');
      self::assertSame(0, CacheableMetadata::createFromObject($result)->getCacheMaxAge());
    }
  }

  /**
   * A core user_role condition mapped to the current user.
   *
   * @return array<string, mixed>
   *   The condition configuration.
   */
  private static function role(string $role): array {
    return [
      'id' => 'user_role',
      'negate' => FALSE,
      'roles' => [$role => $role],
      'context_mapping' => ['user' => '@user.current_user_context:current_user'],
    ];
  }

  /**
   * Creates an authenticated account with one site role.
   */
  private function createUserWithRole(): UserInterface {
    $account = User::create(['name' => 'member', 'status' => 1]);
    $account->save();
    return $account;
  }

  /**
   * Configuration tracks the app and current plugin providers for safe imports.
   */
  public function testProfileDependenciesFollowUsedProviders(): void {
    App::create(['id' => 'dependency_app', 'label' => 'Dependencies'])->save();
    $profile = IslandProfile::create([
      'id' => 'dependencies',
      'label' => 'Dependencies',
      'app' => 'dependency_app',
      'layout' => 'sdc_test:my-banner',
      'placements' => ['first' => ['plugin_id' => 'test_island', 'slot' => 'banner_body']],
    ]);
    $profile->save();
    $dependencies = $profile->getDependencies();
    self::assertContains('island.app.dependency_app', $dependencies['config'] ?? []);
    self::assertContains('island_test', $dependencies['module'] ?? []);
    self::assertContains('sdc_test', $dependencies['module'] ?? []);
    $profile->set('placements', ['first' => ['plugin_id' => 'page_content', 'slot' => 'banner_body']]);
    $profile->save();
    self::assertNotContains('island_test', $profile->getDependencies()['module'] ?? []);
  }

  /**
   * Menu configuration validates its numeric depth through typed config.
   */
  public function testMenuDepthHasTypedConfigurationValidation(): void {
    $typed = $this->container->get('config.typed')->createFromNameAndData('island.profile.typed', [
      'placements' => [
        'menu' => [
          'plugin_id' => 'menu',
          'configuration' => ['menu_name' => 'main', 'depth' => 'invalid', 'expanded' => FALSE],
        ],
      ],
    ]);
    self::assertInstanceOf(Mapping::class, $typed);
    $placements = $typed->get('placements');
    self::assertInstanceOf(Sequence::class, $placements);
    $menu = $placements->get('menu');
    self::assertInstanceOf(Mapping::class, $menu);
    $configuration = $menu->get('configuration');
    self::assertInstanceOf(Mapping::class, $configuration);
    $depth = $configuration->get('depth');
    self::assertGreaterThan(0, $depth->validate()->count());
  }

  /**
   * Invalid selections and malformed conditions are rejected without a save.
   */
  public function testProfileValidationRejectsUnavailableInputs(): void {
    App::create(['id' => 'validation_app', 'label' => 'Validation'])->save();
    $profile = IslandProfile::create([
      'id' => 'validation',
      'label' => 'Validation',
      'app' => 'validation_app',
      'layout' => 'sdc_test:my-banner',
      'placements' => ['kept' => ['plugin_id' => 'page_content', 'slot' => 'banner_body']],
    ]);
    $profile->save();
    $form_object = $this->container->get('entity_type.manager')->getFormObject('island_profile', 'edit');
    $form_object->setEntity($profile);
    $initial_state = new FormState();
    $form = $this->container->get('form_builder')->buildForm($form_object, $initial_state);
    foreach ([
      ['layout' => 'missing:component'],
      ['visibility' => ['condition_operator' => 'xor']],
      [
        'placements' => [
          'banner_body' => [
            'placements' => [
              'kept' => ['plugin_id' => 'missing_plugin', 'slot' => 'banner_body'],
            ],
          ],
        ],
      ],
    ] as $invalid) {
      $state = (new FormState())->setValues($invalid + ['layout' => 'sdc_test:my-banner']);
      $form_object->validateForm($form, $state);
      self::assertNotEmpty($state->getErrors());
    }
    self::assertSame('page_content', IslandProfile::load('validation')->getPlacement('kept')['plugin_id']);
  }

  /**
   * App administration selects the page application without provider coupling.
   */
  public function testAppFormCanSelectPageApplication(): void {
    $app = App::create(['id' => 'page_owner', 'label' => 'Page owner']);
    $app->save();
    $form_object = $this->container->get('entity_type.manager')->getFormObject('island_app', 'edit');
    $form_object->setEntity($app);
    $state = new FormState();
    $form = $this->container->get('form_builder')->buildForm($form_object, $state);
    self::assertArrayHasKey('page_application', $form);
    $state->setValue('page_application', TRUE);
    $form_object->save($form, $state);
    self::assertSame('page_owner', $this->config('island.settings')->get('page_app'));
    $state->setValue('page_application', FALSE);
    $form_object->save($form, $state);
    self::assertSame('', $this->config('island.settings')->get('page_app'));
  }

  /**
   * A default whose conditions fail does not replace normal Drupal rendering.
   */
  public function testDefaultProfileMustBeApplicable(): void {
    $app = App::create(['id' => 'fallback_app', 'label' => 'Fallback', 'default_profile' => 'restricted']);
    $app->save();
    IslandProfile::create([
      'id' => 'restricted',
      'label' => 'Restricted',
      'app' => 'fallback_app',
      'conditions' => self::pages('/allowed'),
    ])->save();
    $this->enterPath('/elsewhere');
    $selector = $this->container->get('island.profile_selector');
    self::assertNull($selector->select($app));
    $app->set('default_profile', '');
    IslandProfile::create(['id' => 'unselected', 'label' => 'Unselected', 'app' => 'fallback_app'])->save();
    self::assertNull($selector->select($app));
  }

  /**
   * Front-page aliases select profiles using Drupal's internal current path.
   */
  public function testFrontPageSelectionUsesInternalPath(): void {
    $this->config('island.settings')->set('page_app', 'page_test')->save();
    App::create(['id' => 'page_test', 'label' => 'Page app'])->save();
    IslandProfile::create([
      'id' => 'gate',
      'label' => 'Gate',
      'app' => 'page_test',
      'conditions' => self::pages('/home'),
    ])->save();
    $request = Request::create('/');
    $request->attributes->set('_route_object', new Route('/home'));
    $request->attributes->set('_route', 'island_test.page');
    $this->container->get('path.current')->setPath('/home', $request);
    $request->setSession($this->container->get('request_stack')->getCurrentRequest()->getSession());
    $this->container->get('request_stack')->push($request);
    $event = new RequestEvent(
      $this->container->get('http_kernel'), $request, HttpKernelInterface::MAIN_REQUEST,
    );
    $this->container->get('island.profile_page_variant_subscriber')->onRequest($event);
    self::assertNotNull($this->container->get('island.host_resolver')->resolve(
      IslandRuntimeId::forHost('page_test', 'gate', 'page'),
    ));
  }

  /**
   * Standard Menu and Page Content islands are available to every app.
   */
  public function testStandardMenuAndPageContentIslandsAreDiscoverable(): void {
    $manager = $this->container->get('plugin.manager.island');
    self::assertArrayHasKey('menu', $manager->getDefinitions());
    self::assertArrayHasKey('page_content', $manager->getDefinitions());

    Menu::create(['id' => 'main', 'label' => 'Main navigation'])->save();
    $menu = $manager->createInstance('menu', ['menu_name' => 'main', 'depth' => 1]);
    self::assertInstanceOf(IslandInterface::class, $menu);
    self::assertNotEmpty($menu->build());

    $page_content = $manager->createInstance('page_content');
    self::assertInstanceOf(IslandInterface::class, $page_content);
    self::assertSame(['#markup' => 'Current controller output'], $page_content->build([
      'content' => ['#markup' => 'Current controller output'],
    ]));
    $build = $page_content->build([
      'title' => ['#markup' => 'Project tickets'],
      'content' => ['#markup' => 'Current controller output'],
    ]);
    $html = (string) $this->container->get('renderer')->renderInIsolation($build);
    self::assertStringContainsString('Current controller output', $html);
    self::assertStringNotContainsString('<h1', $html, 'The heading is a sibling island, not page_content.');
    self::assertStringNotContainsString('>Array</h1>', $html);
  }

  /**
   * A placement renders only where its conditions pass and always varies.
   */
  public function testPlacementConditionsHideOutputAndKeepCacheability(): void {
    $profile = $this->conditionalProfile();
    $renderer = $this->container->get('island.profile_renderer');

    $this->enterPath('/user/7');
    $build = $renderer->render($profile, 'page');
    self::assertArrayHasKey('account', $build['#slots']['banner_body']);
    self::assertArrayHasKey('always', $build['#slots']['banner_body']);

    $this->enterPath('/_workspace/alpha/tickets');
    $build = $renderer->render($profile, 'page');
    self::assertArrayNotHasKey('account', $build['#slots']['banner_body'], 'A hidden placement renders nothing.');
    self::assertArrayHasKey('always', $build['#slots']['banner_body']);
    self::assertContains('url.path', CacheableMetadata::createFromRenderArray($build)->getCacheContexts(), 'The hidden placement leaves its cacheability.');
  }

  /**
   * A profile rendered for one request is never served for another.
   */
  public function testCachedProfileNeverCrossesConditionContexts(): void {
    $profile = $this->conditionalProfile();
    $markup = function (string $path) use ($profile): string {
      $this->enterPath($path);
      $build = $this->container->get('island.profile_renderer')->render($profile, 'page');
      $build['#cache']['keys'] = ['island_profile_isolation'];
      return (string) $this->container->get('renderer')->renderInIsolation($build);
    };
    $account = 'test-island:account';
    self::assertStringContainsString($account, $markup('/user/7'));
    self::assertStringNotContainsString($account, $markup('/_workspace/alpha/tickets'), 'B never receives the output cached for A.');
    self::assertStringContainsString($account, $markup('/user/7'), 'A is served its own output again.');
    self::assertStringNotContainsString($account, $markup('/_workspace/alpha/tickets'));
  }

  /**
   * Profile and placement forms embed core condition forms and round-trip.
   */
  public function testConditionFormsRoundTrip(): void {
    $profile = $this->conditionalProfile();
    $form = $this->buildProfileForm($profile);
    self::assertArrayNotHasKey('conditions', $form, 'No YAML editor remains.');
    self::assertSame('textarea', $form['visibility']['conditions']['request_path']['pages']['#type']);
    self::assertArrayHasKey('negate', $form['visibility']['conditions']['request_path']);
    $placement_form = $form['placements']['banner_body']['placements']['account']['visibility'];
    self::assertSame('/user/*', $placement_form['conditions']['request_path']['pages']['#default_value']);
    self::assertArrayHasKey('user_role', $placement_form['conditions']);

    $state = new FormState();
    $state->setValues([
      'op' => 'Save',
      'label' => 'Conditional',
      'app' => 'conditional_app',
      'layout' => 'sdc_test:my-banner',
      'visibility' => [
        'condition_operator' => 'or',
        'conditions' => ['request_path' => ['pages' => "/user/*\n/_workspace/*", 'negate' => 0]],
      ],
      'placements' => [
        'banner_body' => [
          'placements' => [
            'account' => [
              'plugin_id' => 'test_island',
              'slot' => 'banner_body',
              'visibility' => [
                'condition_operator' => 'and',
                'conditions' => ['request_path' => ['pages' => '/_workspace/*', 'negate' => 1]],
              ],
            ],
          ],
        ],
      ],
    ]);
    $form_object = $this->container->get('entity_type.manager')->getFormObject('island_profile', 'edit');
    $form_object->setEntity($profile);
    $this->container->get('form_builder')->submitForm($form_object, $state);
    self::assertSame([], $state->getErrors());

    $this->container->get('entity_type.manager')->getStorage('island_profile')->resetCache();
    $saved = IslandProfile::load('conditional');
    self::assertSame('or', $saved->getConditionOperator());
    self::assertSame(['request_path'], array_keys($saved->getConditions()), 'Unconfigured conditions are not stored.');
    self::assertSame("/user/*\n/_workspace/*", $saved->getConditions()['request_path']['pages']);
    $account = $saved->getPlacement('account');
    self::assertSame(['request_path'], array_keys($account['conditions']));
    self::assertTrue($account['conditions']['request_path']['negate']);
    self::assertSame('/_workspace/*', $account['conditions']['request_path']['pages']);
    self::assertSame([], $saved->getPlacement('always')['conditions'], 'Each placement keeps its own collection.');
    self::assertSame('test-island:account', $account['configuration']['marker'], 'Source settings survive.');

    $reopened = $this->buildProfileForm($saved);
    self::assertSame("/user/*\n/_workspace/*", $reopened['visibility']['conditions']['request_path']['pages']['#default_value']);
    self::assertSame('or', $reopened['visibility']['condition_operator']['#default_value']);
    self::assertTrue((bool) $reopened['placements']['banner_body']['placements']['account']['visibility']['conditions']['request_path']['negate']['#default_value']);
  }

  /**
   * Condition providers become profile dependencies at both levels.
   */
  public function testConditionProvidersBecomeDependencies(): void {
    $profile = $this->conditionalProfile();
    self::assertContains('system', $profile->getDependencies()['module'] ?? []);
    $profile->set('conditions', ['missing_plugin' => ['id' => 'missing_plugin']])->calculateDependencies();
    self::assertSame(['missing_plugin'], array_keys($profile->getConditions()), 'An unavailable condition is kept for repair.');
    self::assertContains('system', $profile->getDependencies()['module'] ?? [], 'The placement condition is a dependency too.');
  }

  /**
   * A profile with an account-only placement next to an unconditional one.
   */
  private function conditionalProfile(): IslandProfile {
    App::create(['id' => 'conditional_app', 'label' => 'Conditional'])->save();
    $profile = IslandProfile::create([
      'id' => 'conditional',
      'label' => 'Conditional',
      'app' => 'conditional_app',
      'layout' => 'sdc_test:my-banner',
      'layout_settings' => [
        'heading' => 'Profile',
        'ctaText' => 'Home',
        'ctaHref' => 'https://example.com',
        'ctaTarget' => '',
      ],
      'conditions' => self::pages('/user/*'),
      'placements' => [
        'account' => [
          'plugin_id' => 'test_island',
          'slot' => 'banner_body',
          'weight' => 0,
          'configuration' => ['marker' => 'test-island:account'],
          'data' => ['marker' => 'account'],
          'conditions' => self::pages('/user/*'),
        ],
        'always' => [
          'plugin_id' => 'test_island',
          'slot' => 'banner_body',
          'weight' => 1,
          'data' => ['marker' => 'always'],
        ],
      ],
    ]);
    $profile->save();
    return $profile;
  }

  /**
   * Builds the profile edit form.
   *
   * @return array<string, mixed>
   *   The built form.
   */
  private function buildProfileForm(IslandProfile $profile): array {
    $form_object = $this->container->get('entity_type.manager')->getFormObject('island_profile', 'edit');
    $form_object->setEntity($profile);
    $state = new FormState();
    return $this->container->get('form_builder')->buildForm($form_object, $state);
  }

}
