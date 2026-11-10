<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Form\FormState;
use Drupal\island_test\ProfileAppProvider;
use Drupal\Core\Plugin\Context\EntityContext;
use Drupal\user\Entity\User;
use Drupal\island\IslandInterface;
use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;
use Drupal\island\IslandResponse;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Exercises stored UI Patterns source mappings through profile event refresh.
 */
#[Group('island')]
final class IslandUiPatternsProfileTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'system', 'path_alias', 'user', 'sdc', 'sdc_test', 'ui_patterns',
    'island', 'island_test', 'island_ui_patterns',
  ];

  /**
   * Profile administration offers field sources from the owning app context.
   */
  public function testEditorOffersTypedAppContextSources(): void {
    $this->installEntitySchema('user');
    $this->container->get('island.app_provider_manager')->addProvider(new ProfileAppProvider());
    App::create(['id' => 'editor_app', 'label' => 'Editor', 'provider' => 'profile_test'])->save();
    $profile = IslandProfile::create([
      'id' => 'editor_profile',
      'label' => 'Editor',
      'app' => 'editor_app',
      'layout' => 'sdc_test:my-banner',
      'placements' => [
        'mapped' => [
          'plugin_id' => 'ui_patterns_component',
          'slot' => 'banner_body',
          'configuration' => [
            'component' => [
              'component_id' => 'sdc_test:my-button',
              'props' => ['text' => ['source_id' => 'entity_field', 'source' => []]],
            ],
          ],
        ],
      ],
    ]);
    $form_object = $this->container->get('entity_type.manager')->getFormObject('island_profile', 'edit');
    $form_object->setEntity($profile);
    $state = new FormState();
    $form = $this->container->get('form_builder')->buildForm($form_object, $state);
    $component = $form['placements']['banner_body']['placements']['mapped']['configuration']['component'];
    // ui_patterns 2.0.23 shows a closed row; its source resolves only among
    // the offered candidates.
    self::assertSame('entity_field', $component['props']['text']['source_id']['#value'] ?? NULL);
    $field_options = $component['props']['text']['source']['derivable_context']['#options'] ?? [];
    self::assertArrayHasKey('field:user:user:name', $field_options);
    $edited = $form_object->getEntity();
    self::assertInstanceOf(IslandProfile::class, $edited);
    self::assertArrayNotHasKey('contexts', $edited->get('placements')['mapped']['configuration']);
  }

  /**
   * Installed field sources consume typed app data independently per placement.
   */
  public function testMappingUsesCurrentTypedAppContext(): void {
    $this->installEntitySchema('user');
    $configuration = [
      'component' => [
        'component_id' => 'sdc_test:my-button',
        'props' => [
          'text' => [
            'source_id' => 'field_property:user:name:value',
            'source' => ['context_mapping' => ['entity' => 'entity']],
          ],
        ],
        'slots' => [],
      ],
    ];
    $component = $this->container->get('plugin.manager.island')->createInstance('ui_patterns_component', $configuration);
    self::assertInstanceOf(IslandInterface::class, $component);
    foreach (['Alpha context', 'Beta context'] as $label) {
      $user = User::create(['name' => $label]);
      $build = $component->build(['contexts' => ['entity' => EntityContext::fromEntity($user)]]);
      $build = $this->container->get('ui_patterns.component_element_builder')->build($build);
      self::assertSame($label, $build['#props']['text'] ?? NULL);
    }
  }

  /**
   * A custom mapping source remains an explicit configuration dependency.
   */
  public function testCustomSourceProviderBecomesProfileDependency(): void {
    $this->installEntitySchema('user');
    App::create(['id' => 'source_app', 'label' => 'Sources'])->save();
    $profile = IslandProfile::create([
      'id' => 'source_profile',
      'label' => 'Sources',
      'app' => 'source_app',
      'layout' => 'sdc_test:my-banner',
      'placements' => [
        'source' => [
          'plugin_id' => 'ui_patterns_component',
          'slot' => 'banner_body',
          'configuration' => [
            'component' => [
              'component_id' => 'sdc_test:my-button',
              'props' => ['text' => ['source_id' => 'profile_marker', 'source' => []]],
            ],
          ],
        ],
      ],
    ]);
    $profile->save();
    self::assertContains('island_test', $profile->getDependencies()['module'] ?? []);
  }

  /**
   * Unknown source mappings cannot be saved as apparently valid profiles.
   */
  public function testUnavailableSourceMappingIsRejected(): void {
    $this->installEntitySchema('user');
    App::create(['id' => 'invalid_mapping', 'label' => 'Invalid mapping'])->save();
    $profile = IslandProfile::create([
      'id' => 'invalid_mapping',
      'label' => 'Invalid mapping',
      'app' => 'invalid_mapping',
      'layout' => 'sdc_test:my-banner',
      'placements' => [
        'mapped' => [
          'plugin_id' => 'ui_patterns_component',
          'slot' => 'banner_body',
          'configuration' => [
            'component' => [
              'component_id' => 'sdc_test:my-button',
              'props' => ['text' => ['source_id' => 'missing_source', 'source' => []]],
            ],
          ],
        ],
      ],
    ]);
    $form_object = $this->container->get('entity_type.manager')->getFormObject('island_profile', 'edit');
    $form_object->setEntity($profile);
    $state = (new FormState())->setValues(['layout' => 'sdc_test:my-banner']);
    $form = [];
    $form_object->validateForm($form, $state);
    self::assertNotEmpty($state->getErrors());
    self::assertStringContainsString('missing_source', implode(' ', array_map('strval', $state->getErrors())));
  }

  /**
   * A configured component refreshes only for its placement subscription.
   */
  public function testMappedComponentRefreshesOnConfiguredEvent(): void {
    $this->installEntitySchema('user');
    App::create(['id' => 'mapping', 'label' => 'Mapping'])->save();
    $component = [
      'component_id' => 'sdc_test:my-button',
      'props' => [
        'text' => ['source_id' => 'textfield', 'source' => ['value' => 'Mapped heading']],
      ],
      'slots' => [],
    ];
    $profile = IslandProfile::create([
      'id' => 'mapped',
      'label' => 'Mapped',
      'app' => 'mapping',
      'layout' => 'sdc_test:my-banner',
      'placements' => [
        'trigger' => ['plugin_id' => 'test_island', 'slot' => 'banner_body'],
        'mapped' => [
          'plugin_id' => 'ui_patterns_component',
          'slot' => 'banner_body',
          'configuration' => ['component' => $component],
          'events' => ['data.changed'],
        ],
      ],
    ]);
    $profile->save();
    $profile = IslandProfile::load('mapped');
    self::assertInstanceOf(IslandProfile::class, $profile);
    $host = $this->container->get('island.profile_renderer')->registerHost($profile, 'one');
    $placement = $this->container->get('island.placement');
    $mapped = $placement->createIsland('mapped', $host);
    $build = $mapped->build();
    $html = (string) $this->container->get('renderer')->renderInIsolation($build);
    self::assertStringContainsString('Mapped heading', $html);
    $trigger = $placement->createIsland('trigger', $host);
    $http = $this->container->get('island.responder')->toResponse(
      IslandResponse::make()->dispatch('data.changed'), $trigger, $host,
    );
    self::assertStringContainsString('Mapped heading', (string) $http->getContent());
    preg_match_all('/id="(island-[^"]+)"/', (string) $http->getContent(), $matches);
    self::assertSame(['island-profile_5b226d617070696e67222c226d6170706564222c226f6e65225d-mapped'], $matches[1]);
    $http = $this->container->get('island.responder')->toResponse(
      IslandResponse::make()->dispatch('other.changed'), $trigger, $host,
    );
    self::assertSame('', (string) $http->getContent());
    // A routed dialog can notify the host without being a placed island.
    $http = $this->container->get('island.responder')->toResponse(
      IslandResponse::make()->dispatch('data.changed'), NULL, $host,
    );
    self::assertStringContainsString('Mapped heading', (string) $http->getContent());
    self::assertStringContainsString('hx-swap-oob="outerHTML"', (string) $http->getContent());
  }

  /**
   * A subscribed placement names its events on every container it gets.
   *
   * The client re-renders such an island when a response announces one of
   * them (HX-Trigger), so the page build, a placed island and every fragment
   * carry the same subscription; an unsubscribed placement carries none.
   */
  public function testSubscribedPlacementNamesItsEventsOnEveryContainer(): void {
    $this->installEntitySchema('user');
    App::create(['id' => 'mapping', 'label' => 'Mapping'])->save();
    $component = [
      'component_id' => 'sdc_test:my-button',
      'props' => ['text' => ['source_id' => 'textfield', 'source' => ['value' => 'Subscribed']]],
      'slots' => [],
    ];
    IslandProfile::create([
      'id' => 'subscribed',
      'label' => 'Subscribed',
      'app' => 'mapping',
      'layout' => 'sdc_test:my-banner',
      'placements' => [
        'quiet' => [
          'plugin_id' => 'ui_patterns_component',
          'slot' => 'banner_body',
          'configuration' => ['component' => $component],
        ],
        'mapped' => [
          'plugin_id' => 'ui_patterns_component',
          'slot' => 'banner_body',
          'configuration' => ['component' => $component],
          'events' => ['data.changed', 'label.changed'],
        ],
      ],
    ])->save();
    $profile = IslandProfile::load('subscribed');
    self::assertInstanceOf(IslandProfile::class, $profile);
    $renderer = $this->container->get('renderer');
    $host = $this->container->get('island.profile_renderer')->registerHost($profile, 'one');
    $marker = 'data-island-events="data.changed label.changed"';

    $page = $this->container->get('island.profile_renderer')->render($profile, 'one');
    $containers = $page['#slots']['banner_body'];
    self::assertSame('data.changed label.changed', $containers['mapped']['#attributes']['data-island-events'] ?? NULL);
    self::assertArrayNotHasKey('data-island-events', $containers['quiet']['#attributes']);

    $placed = $this->container->get('island.placement')->place($host->hostId(), 'mapped');
    self::assertStringContainsString($marker, (string) $renderer->renderInIsolation($placed));

    $http = $this->container->get('island.responder')->toResponse(
      IslandResponse::make()->dispatch('data.changed'), NULL, $host,
    );
    self::assertStringContainsString($marker, (string) $http->getContent());

    $mapped_id = $this->container->get('island.placement')->createIsland('mapped', $host)->getHtmlId($host->hostId());
    $fragment = $this->container->get('island.fragment_resolver')->fragment($mapped_id, FALSE, new CacheableMetadata());
    self::assertNotNull($fragment);
    $response = $this->container->get('island.responder')->toFragmentResponse(['main' => $fragment]);
    self::assertStringContainsString($marker, (string) $response->getContent());
  }

}
