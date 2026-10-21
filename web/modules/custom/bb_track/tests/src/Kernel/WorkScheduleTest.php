<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Entity\EntityStorageException;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Personal templates remain distinct from actual work.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class WorkScheduleTest extends WorkTimeTestBase {

  /**
   * The user owns weekday values; proposals do not depend on them.
   */
  public function testPersonalSchedule(): void {
    $schedule = \Drupal::service('bb_track.settings')->saveSchedule([
      28800,
      28800,
      28800,
      28800,
      0,
      0,
      0,
    ], NULL);
    self::assertEquals(28800, $schedule->get('work_schedule')->getValue()[0]['day_0']);
    self::assertEquals(0, $schedule->get('work_schedule')->getValue()[0]['day_4']);
    self::assertTrue($schedule->get('work_schedule')->access('view', $this->employee));
    self::assertFalse($schedule->get('work_schedule')->access('view', $this->peer));
  }

  /**
   * JSON:API exposes the field so an owner can read their own schedule.
   */
  public function testScheduleIsReadableThroughJsonApi(): void {
    $repository = $this->container->get('jsonapi.resource_type.repository');
    $type = $repository->get('user', 'user');
    self::assertTrue($type->isFieldEnabled('work_schedule'));
  }

  /**
   * Sub-minute settings fail before persistence.
   */
  public function testInvalidSettings(): void {
    $this->expectException(\InvalidArgumentException::class);
    \Drupal::service('bb_track.settings')->saveSchedule([
      61,
      0,
      0,
      0,
      0,
      0,
      0,
    ], NULL);
  }

  /**
   * Direct user saves cannot overwrite the private schedule.
   */
  public function testDirectScheduleWriteIsDenied(): void {
    $this->employee->set('work_schedule', ['day_0' => 3600]);
    $this->expectException(EntityStorageException::class);
    $this->employee->save();
  }

  /**
   * A user save that never touches the schedule never trips the owner guard.
   *
   * A fresh install creates users this way.
   */
  public function testUserSaveWithoutScheduleChangeSucceeds(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('user');
    $user = $storage->create(['name' => 'install-user', 'mail' => 'install-user@example.com', 'status' => 1]);
    $user->save();
    self::assertTrue($user->get('work_schedule')->isEmpty());
    $user->set('name', 'install-user-renamed');
    $user->save();
    $storage->resetCache([$user->id()]);
    $reloaded = $storage->load($user->id());
    self::assertSame('install-user-renamed', $reloaded->getAccountName());
  }

}
