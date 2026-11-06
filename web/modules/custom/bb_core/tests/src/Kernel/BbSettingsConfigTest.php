<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Verifies the bb_core.settings config object (BB-149).
 *
 * Installing bb_core's config/install must load the settings with their
 * defaults and validate cleanly against config/schema (KernelTestBase runs with
 * strict config-schema checking on), covering AC-4/AC-5's config half.
 */
#[Group('bb_core')]
final class BbSettingsConfigTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'bb_core',
  ];

  /**
   * The shipped install defaults are correct and valid against the schema.
   *
   * Loads bb_core's config/install/bb_core.settings.yml directly (rather
   * than installConfig(['bb_core']), which would also try to install the
   * bb_rich filter format and its plugin deps) and saves it — the save runs
   * KernelTestBase's strict config-schema checker, so a schema/value mismatch
   * fails here.
   */
  public function testSettingsDefaultsAreValid(): void {
    $path = $this->container->get('extension.list.module')->getPath('bb_core')
      . '/config/install/bb_core.settings.yml';
    $defaults = Yaml::decode((string) file_get_contents($path));
    $this->config('bb_core.settings')->setData($defaults)->save();

    $config = $this->config('bb_core.settings');
    $this->assertSame('https://github.com/bakers-build/', $config->get('plugin_source_base'));
  }

}
