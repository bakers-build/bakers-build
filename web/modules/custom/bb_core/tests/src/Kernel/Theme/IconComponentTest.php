<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Theme;

use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * The icon component renders through the Icon API.
 */
#[Group('bb_core')]
final class IconComponentTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = ['system', 'user', 'ui_patterns'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
  }

  /**
   * Renders the icon component with the given icon name.
   */
  private function renderIcon(string $name): string {
    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:icon',
      '#props' => ['name' => $name, 'size' => 'lg'],
      '#attributes' => ['class' => ['custom-icon'], 'data-test' => 'icon'],
    ];
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * A known icon carries its sprite, size, attributes and accessibility.
   */
  public function testKnownIconRendersItsSvg(): void {
    $html = $this->renderIcon('user');
    $expectations = [
      'sprite.svg#user',
      'width="20"',
      'height="20"',
      'custom-icon',
      'inline-block',
      'data-test="icon"',
      'aria-hidden="true"',
      'focusable="false"',
    ];
    foreach ($expectations as $expected) {
      self::assertStringContainsString($expected, $html);
    }
  }

  /**
   * The dedicated team icon is a sprite symbol, not a stand-in.
   */
  public function testTeamIconRendersItsSvg(): void {
    self::assertStringContainsString('sprite.svg#team', $this->renderIcon('team'));
  }

  /**
   * An unknown icon does not bypass the Icon API.
   */
  public function testUnknownIconRendersNoSvg(): void {
    self::assertStringNotContainsString('<svg', $this->renderIcon('nonexistent-icon-for-contract-test'));
  }

}
