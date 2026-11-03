<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Theme;

use Drupal\entity_test\Entity\EntityTest;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * The `bb_time` formatter renders a timestamp field as `<time>`.
 */
#[Group('bb_core')]
final class BbTimeFormatterTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'field', 'user', 'options', 'entity', 'state_machine',
    'og', 'ui_patterns',
    'link', 'text', 'entity_test', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('entity_test');
    $this->installEntitySchema('user');
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->config('system.date')->set('timezone.default', 'UTC')->save();
  }

  /**
   * A stamp from another year renders its date with ISO `datetime` and title.
   */
  public function testFormatterRendersTimeElement(): void {
    $stamp = (int) strtotime('2020-06-15T13:30:00Z');
    $entity = EntityTest::create(['created' => $stamp]);
    $build = $entity->get('created')->view(['type' => 'bb_time', 'label' => 'hidden']);
    $html = (string) $this->container->get('renderer')->renderInIsolation($build[0]);
    self::assertStringContainsString('<time', $html);
    self::assertStringContainsString('datetime="2020-06-15T13:30:00+00:00"', $html);
    self::assertStringContainsString('title="Mon, 15 Jun 2020, 13:30 UTC"', $html);
    self::assertStringContainsString('>15 Jun 2020</time>', $html);
  }

}
