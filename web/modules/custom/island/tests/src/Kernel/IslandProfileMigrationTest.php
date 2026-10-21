<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\user\Entity\User;
use Drupal\Core\Config\MemoryStorage;
use Drupal\Core\Config\StorageTransformEvent;
use Drupal\island\Entity\App;
use Drupal\island\IslandInterface;
use Drupal\island\Entity\IslandProfile;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Protects existing page-layout data at the real config storage boundary.
 */
#[Group('island')]
final class IslandProfileMigrationTest extends KernelTestBase {

  use ProfileRequestTrait;

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'system', 'path_alias', 'user', 'sdc', 'sdc_test', 'ui_patterns', 'island_ui_patterns',
    'island', 'island_test',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('path_alias');
  }

  /**
   * Legacy-only config retains settings, selectors and grouped placement IDs.
   */
  public function testLegacyOnlyMigrationIsLosslessAndRepeatable(): void {
    $legacy = $this->legacy();
    $this->container->get('config.storage')->write('display_builder_page_layout.page_layout.dashboard', $legacy);
    $migrator = $this->container->get('island.profile_migrator');
    self::assertSame(1, $migrator->migrate());
    $profile = IslandProfile::load('dashboard');
    self::assertNotNull($profile);
    self::assertSame('bakers', $profile->getAppId());
    self::assertSame(['heading' => 'Custom dashboard'], $profile->getLayoutSettings());
    self::assertSame(self::pages("/dashboard/*\n/reports"), $profile->getConditions());
    self::assertSame('and', $profile->getConditionOperator());
    self::assertSame(-17, $profile->get('weight'));
    self::assertFalse($profile->status());
    $placement = $profile->getPlacement('dashboard_content');
    self::assertSame('page_content', $placement['plugin_id']);
    self::assertSame([
      'tabs' => [
        'plugin_id' => 'system_powered_by_block',
        'configuration' => ['label' => 'Custom tabs', 'label_display' => 'visible'],
      ],
    ], $placement['configuration']['prefix_blocks']);
    self::assertSame('controller', $placement['configuration']['content_source_id']);
    $stored = $profile->toArray();
    self::assertSame(0, $migrator->migrate());
    self::assertSame($stored, IslandProfile::load('dashboard')->toArray());
    self::assertSame($legacy, $this->container->get('config.storage')->read('display_builder_page_layout.page_layout.dashboard'));
    self::assertSame([], $this->container->get('island.migration_uninstall_validator')->validate('display_builder_page_layout'));
    $plugin = $this->container->get('plugin.manager.island')->createInstance('page_content', $placement['configuration']);
    self::assertInstanceOf(IslandInterface::class, $plugin);
    $build = $plugin->build(['content' => ['#markup' => 'Live controller result']]);
    $html = (string) $this->container->get('renderer')->renderInIsolation($build);
    self::assertStringContainsString('Live controller result', $html);
    self::assertStringContainsString('Drupal', $html);
    $ordered = $plugin->build([
      'title' => 'Account',
      'content' => ['#markup' => 'pills'],
    ]);
    self::assertSame(
      ['tabs', 'content'],
      array_keys($ordered),
      'Tabs still prefix the body; the heading is a sibling island.',
    );
    self::assertArrayNotHasKey('title', $ordered);
  }

  /**
   * Unsupported sources stop the whole batch and block provider cleanup.
   */
  public function testUnsupportedSourceRetainsOriginalAndBlocksCleanup(): void {
    $legacy = $this->legacy();
    $legacy['sources'][0]['source']['component']['slots']['banner_body']['sources'][0]['source_id'] = 'unavailable_source';
    $storage = $this->container->get('config.storage');
    $storage->write('display_builder_page_layout.page_layout.dashboard', $legacy);
    try {
      $this->container->get('island.profile_migrator')->migrate();
      self::fail('Unsupported source must prevent successful migration.');
    }
    catch (\UnexpectedValueException $exception) {
      self::assertStringContainsString('dashboard', $exception->getMessage());
      self::assertStringContainsString('unavailable_source', $exception->getMessage());
    }
    self::assertNull(IslandProfile::load('dashboard'));
    self::assertSame($legacy, $storage->read('display_builder_page_layout.page_layout.dashboard'));
    self::assertNotEmpty($this->container->get('island.migration_uninstall_validator')->validate('display_builder_page_layout'));
  }

  /**
   * Render-key collisions and unsupported boost adapters retain their sources.
   */
  public function testUnsupportedGroupedIdentityAndBlockBoostAreRejected(): void {
    $legacy = $this->legacy();
    $source = &$legacy['sources'][0]['source']['component']['slots']['banner_body']['sources'][0];
    $source['source']['content'][0]['node_id'] = 'content';
    $storage = $this->container->get('config.storage');
    $storage->write('display_builder_page_layout.page_layout.dashboard', $legacy);
    try {
      $this->container->get('island.profile_migrator')->migrate();
      self::fail('Reserved prefix identities require explicit mapping.');
    }
    catch (\UnexpectedValueException $exception) {
      self::assertStringContainsString('Reserved grouped block source ID', $exception->getMessage());
    }
    $source['source']['content'] = [$source['source']['content'][0]];
    $source['source']['content'][0]['node_id'] = 'tabs';
    $source['source']['swap_target'] = '#other';
    $storage->write('display_builder_page_layout.page_layout.dashboard', $legacy);
    try {
      $this->container->get('island.profile_migrator')->migrate();
      self::fail('Block boost targets require explicit mapping.');
    }
    catch (\UnexpectedValueException $exception) {
      self::assertStringContainsString('Swap target requires a component island', $exception->getMessage());
    }
    self::assertSame($legacy, $storage->read('display_builder_page_layout.page_layout.dashboard'));
    self::assertNull(IslandProfile::load('dashboard'));
  }

  /**
   * A negated legacy path keeps its meaning; a same-ID profile is refused.
   */
  public function testNegatedConditionIsKeptAndConflictingProfileRejected(): void {
    $legacy = $this->legacy();
    $legacy['conditions']['request_path']['negate'] = TRUE;
    $storage = $this->container->get('config.storage');
    $storage->write('display_builder_page_layout.page_layout.dashboard', $legacy);
    $this->container->get('island.profile_migrator')->migrate();
    self::assertSame(self::pages("/dashboard/*\n/reports", TRUE), IslandProfile::load('dashboard')->getConditions());
    IslandProfile::load('dashboard')->delete();
    $storage->write('display_builder_page_layout.page_layout.dashboard', $this->legacy());
    App::create(['id' => 'other', 'label' => 'Other'])->save();
    IslandProfile::create(['id' => 'dashboard', 'label' => 'Unrelated', 'app' => 'other'])->save();
    $this->expectException(\UnexpectedValueException::class);
    $this->expectExceptionMessage('dashboard');
    $this->container->get('island.profile_migrator')->migrate();
  }

  /**
   * A legacy wrapper target resolves to the preserved placement in each host.
   */
  public function testWrapperTargetMapsToStablePlacement(): void {
    $legacy = $this->legacy();
    $legacy['sources'][0]['source']['component']['slots']['banner_body']['sources'][] = [
      'source_id' => 'island',
      'node_id' => 'dashboard_navigation',
      'source' => [
        'island_id' => 'island-navigation',
        'swap_target' => '#island-content',
        'content' => [[
          'source_id' => 'component',
          'node_id' => 'navigation_component',
          'source' => ['component' => ['component_id' => 'sdc_test:my-banner', 'props' => [], 'slots' => []]],
        ],
        ],
      ],
    ];
    $this->container->get('config.storage')->write('display_builder_page_layout.page_layout.dashboard', $legacy);
    $this->container->get('island.profile_migrator')->migrate();
    $profile = IslandProfile::load('dashboard');
    self::assertSame('dashboard_content', $profile->getPlacement('dashboard_navigation')['configuration']['target_placement']);
    self::assertArrayNotHasKey('swap_target', $profile->getPlacement('dashboard_navigation')['configuration']);
  }

  /**
   * Deployment import keeps migrated custom profiles instead of stock defaults.
   */
  public function testDeploymentImportPreservesMigratedSettings(): void {
    $this->container->get('config.storage')->write('display_builder_page_layout.page_layout.dashboard', $this->legacy());
    $this->container->get('island.profile_migrator')->migrate();
    $incoming = new MemoryStorage();
    $incoming->write('island.profile.dashboard', ['id' => 'dashboard', 'label' => 'Stock profile']);
    $this->container->get('event_dispatcher')->dispatch(new StorageTransformEvent($incoming), 'config.transform.import');
    $imported = $incoming->read('island.profile.dashboard');
    self::assertIsArray($imported);
    self::assertSame('Custom dashboard', $imported['label']);
    self::assertSame(['heading' => 'Custom dashboard'], $imported['layout_settings']);
    self::assertTrue($incoming->exists('island.app.bakers'));
  }

  /**
   * Migrated blocks still enforce their current permission and cache metadata.
   */
  public function testMigratedBlockRechecksAccess(): void {
    $plugin = $this->container->get('plugin.manager.island')->createInstance('block', [
      'plugin_id' => 'island_test_migration_access',
      'configuration' => ['marker' => 'Protected custom settings'],
    ]);
    self::assertInstanceOf(IslandInterface::class, $plugin);
    $build = $plugin->build();
    self::assertArrayNotHasKey('#plain_text', $build);
    self::assertContains('user.permissions', $build['#cache']['contexts']);
    $this->container->get('current_user')->setAccount(User::create(['uid' => 1]));
    $build = $plugin->build();
    self::assertSame('Protected custom settings', $build['#plain_text']);
  }

  /**
   * Missing dependencies stop migration before a broken profile is saved.
   */
  public function testUnavailableComponentPreventsMigration(): void {
    $legacy = $this->legacy();
    $legacy['sources'][0]['source']['component']['slots']['banner_body']['sources'] = [[
      'source_id' => 'component',
      'node_id' => 'missing_component',
      'source' => ['component' => ['component_id' => 'missing:component', 'props' => [], 'slots' => []]],
    ],
    ];
    $this->container->get('config.storage')->write('display_builder_page_layout.page_layout.dashboard', $legacy);
    $this->expectException(\UnexpectedValueException::class);
    $this->expectExceptionMessage('missing:component');
    $this->container->get('island.profile_migrator')->migrate();
  }

  /**
   * Unknown nested mapping sources must not survive as broken runtime output.
   */
  public function testUnavailableNestedMappingPreventsMigration(): void {
    $legacy = $this->legacy();
    $legacy['sources'][0]['source']['component']['slots']['banner_body']['sources'] = [[
      'source_id' => 'component',
      'node_id' => 'mapped_component',
      'source' => [
        'component' => [
          'component_id' => 'sdc_test:my-banner',
          'props' => ['heading' => ['source_id' => 'missing_source', 'source' => []]],
          'slots' => [],
        ],
      ],
    ],
    ];
    $this->container->get('config.storage')->write('display_builder_page_layout.page_layout.dashboard', $legacy);
    $this->expectException(\UnexpectedValueException::class);
    $this->expectExceptionMessage('missing_source');
    $this->container->get('island.profile_migrator')->migrate();
  }

  /**
   * An unconstrained legacy layout remains the app's enabled fallback profile.
   */
  public function testUnconstrainedLegacyLayoutRemainsFallback(): void {
    $legacy = $this->legacy();
    $legacy['status'] = TRUE;
    $legacy['conditions']['request_path']['pages'] = '';
    $this->container->get('config.storage')->write('display_builder_page_layout.page_layout.dashboard', $legacy);
    $this->container->get('island.profile_migrator')->migrate();
    $app = App::load('bakers');
    self::assertSame('dashboard', $app->getDefaultProfileId());
    self::assertSame([], IslandProfile::load('dashboard')->getConditions());
    $this->enterPath('/other');
    self::assertSame('dashboard', $this->container->get('island.profile_selector')->select($app)->id());
  }

  /**
   * A missing block provider cannot be marked migrated and then removed.
   */
  public function testUnavailableBlockPreventsMigration(): void {
    $legacy = $this->legacy();
    $legacy['sources'][0]['source']['component']['slots']['banner_body']['sources'][0]['source']['content'][0]['source']['plugin_id'] = 'missing_block';
    $this->container->get('config.storage')->write('display_builder_page_layout.page_layout.dashboard', $legacy);
    $this->expectException(\UnexpectedValueException::class);
    $this->expectExceptionMessage('missing_block');
    $this->container->get('island.profile_migrator')->migrate();
  }

  /**
   * Supplies legacy-only config with non-default selectors and block settings.
   */
  private function legacy(): array {
    return [
      'id' => 'dashboard',
      'label' => 'Custom dashboard',
      'status' => FALSE,
      'weight' => -17,
      'conditions' => [
        'request_path' => ['id' => 'request_path', 'negate' => FALSE, 'pages' => "/dashboard/*\n/reports"],
      ],
      'sources' => [[
        'source_id' => 'component',
        'node_id' => 'dashboard_root',
        'source' => [
          'component' => [
            'component_id' => 'sdc_test:my-banner',
            'props' => ['heading' => ['source_id' => 'textfield', 'source' => ['value' => 'Custom dashboard']]],
            'slots' => [
              'banner_body' => [
                'sources' => [[
                  'source_id' => 'island',
                  'node_id' => 'dashboard_content',
                  'source' => [
                    'island_id' => 'island-content',
                    'swap_target' => '',
                    'content' => [
                      [
                        'source_id' => 'block',
                        'node_id' => 'tabs',
                        'source' => [
                          'plugin_id' => 'system_powered_by_block',
                          'system_powered_by_block' => ['label' => 'Custom tabs', 'label_display' => 'visible'],
                        ],
                      ],
                      ['source_id' => 'main_page_content', 'node_id' => 'controller', 'source' => []],
                    ],
                  ],
                ],
                ],
              ],
            ],
          ],
        ],
      ],
      ],
    ];
  }

}
