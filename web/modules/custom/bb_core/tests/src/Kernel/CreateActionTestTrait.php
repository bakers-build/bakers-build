<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Plugin\UiPatterns\Source\CreateActionSource;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\Yaml\Yaml;

/**
 * Builds a create action from the settings the shipped shell profile gives it.
 */
trait CreateActionTestTrait {

  /**
   * The shipped page-header settings of the create action on one screen.
   *
   * @param string $route
   *   The dialog route.
   * @param string|null $screen
   *   The screen route, for a dialog route several entries share.
   * @param string $profile
   *   The island profile.
   *
   * @return array<string, mixed>
   *   The entry's settings.
   */
  protected function shippedCreateActionSettings(string $route, ?string $screen = NULL, string $profile = 'bb_shell'): array {
    $config = Yaml::parseFile(dirname(__DIR__, 7) . '/config/sync/island.profile.' . $profile . '.yml');
    foreach ($config['placements']['shell_page_header']['configuration']['component']['slots']['actions']['sources'] as $entry) {
      $settings = $entry['source'] ?? [];
      if (($settings['route'] ?? NULL) === $route && ($screen === NULL || in_array($screen, $settings['screens'] ?? [], TRUE))) {
        return $settings;
      }
    }
    self::fail("The $profile page header has no create action for $route.");
  }

  /**
   * A fresh create action with the shipped settings for its dialog route.
   *
   * @param string $route
   *   The dialog route.
   * @param string|null $screen
   *   The screen route, for a dialog route several entries share.
   * @param string $source_id
   *   The source plugin id.
   * @param string $profile
   *   The island profile the settings are read from.
   */
  protected function shippedCreateAction(string $route, ?string $screen = NULL, string $source_id = 'bb_create_action', string $profile = 'bb_shell'): CreateActionSource {
    $definition = $this->container->get('plugin.manager.ui_patterns_prop_type')->getDefinition('slot')['schema'];
    $settings = $this->shippedCreateActionSettings($route, $screen, $profile);
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance($source_id, SourcePluginBase::buildConfiguration('actions', $definition, ['source' => $settings], []));
    self::assertInstanceOf(CreateActionSource::class, $source);
    return $source;
  }

}
