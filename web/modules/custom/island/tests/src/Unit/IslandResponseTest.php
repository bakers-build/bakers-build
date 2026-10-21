<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Unit;

use Drupal\island\IslandResponse;
use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Tests the IslandResponse value object.
 */
#[Group('island')]
final class IslandResponseTest extends TestCase {

  /**
   * {@inheritdoc}
   */
  public function testIntentsAccumulate(): void {
    $response = IslandResponse::make()
      ->rebuildSelf()
      ->rebuild(['task_count'])
      ->dispatch('tasks.changed', ['id' => 5])
      ->triggerClientEvent('drawer:close');
    $this->assertTrue($response->shouldRebuildSelf());
    $this->assertSame(['task_count'], $response->getRebuilds());
    $this->assertSame(['tasks.changed' => ['id' => 5]], $response->getEvents());
    $this->assertSame(['drawer:close' => []], $response->getClientEvents());
    $this->assertNull($response->getLocation());
  }

  /**
   * {@inheritdoc}
   */
  public function testDefaults(): void {
    $response = IslandResponse::make();
    $this->assertFalse($response->shouldRebuildSelf());
    $this->assertSame([], $response->getRebuilds());
    $this->assertSame([], $response->getEvents());
  }

}
