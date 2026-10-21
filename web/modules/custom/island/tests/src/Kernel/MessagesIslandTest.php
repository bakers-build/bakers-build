<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\island\IslandInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Ensures placed messages remain deferred and consume the queue at render time.
 */
#[Group('island')]
final class MessagesIslandTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['system', 'user', 'island'];

  /**
   * Messages added after a profile build are included and consumed once.
   */
  public function testDeferredMessages(): void {
    $this->container->get('theme_installer')->install(['stark']);
    $this->container->get('config.factory')->getEditable('system.theme')->set('default', 'stark')->save();
    $manager = $this->container->get('plugin.manager.island');
    $this->assertTrue($manager->hasDefinition('messages'), 'A profile can place the reusable messages island.');
    $island = $manager->createInstance('messages');
    $this->assertInstanceOf(IslandInterface::class, $island);
    $messenger = $this->container->get('messenger');
    $messenger->addError('Invalid credentials.');
    $build = $island->build();
    $this->assertCount(1, $messenger->all()['error']);
    $messenger->addStatus('Saved after the profile was built.');
    $html = (string) $this->container->get('renderer')->renderRoot($build);
    $this->assertStringContainsString('Invalid credentials.', $html);
    $this->assertStringContainsString('Saved after the profile was built.', $html);
    $this->assertSame([], $messenger->all());
    $next = $island->build();
    $next_html = (string) $this->container->get('renderer')->renderRoot($next);
    $this->assertStringNotContainsString('Invalid credentials.', $next_html);
    $this->assertStringNotContainsString('Saved after the profile was built.', $next_html);
  }

}
