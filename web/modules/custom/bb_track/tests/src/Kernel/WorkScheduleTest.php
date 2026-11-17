<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\bb_track\Form\WorkScheduleForm;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_track\Form\WorklogFormLayout;
use Drupal\bb_track\WorkTimeRules;
use PHPUnit\Framework\Attributes\DataProvider;
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
   * The form says what the schedule is for and how to fill it in.
   */
  public function testFormExplainsSchedule(): void {
    $form = $this->container->get('form_builder')->getForm(WorkScheduleForm::class);
    $intro = (string) $form['intro']['#markup'];
    self::assertStringContainsString('hours you usually work', $intro);
    self::assertStringContainsString('planning total', $intro);
    self::assertStringContainsString('Nothing is booked, capped or enforced', $intro);
    self::assertStringContainsString('Only you can open this page', $intro);
    foreach (range(0, 6) as $index) {
      self::assertSame('Whole hours or H:MM, for example 8 or 7:30. 0:00 means a day off.', (string) $form['days'][$index]['#description']);
    }
    $cap = (string) $form['cap']['#description'];
    self::assertStringContainsString('most time your agent should propose for one day', $cap);
    self::assertStringContainsString('does not cap recorded time', $cap);
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

  /**
   * Schedule values: a bare whole hour or H:MM, explicit zero allowed.
   */
  #[DataProvider('scheduleDurations')]
  public function testScheduleDuration(string $typed, ?int $seconds): void {
    if ($seconds === NULL) {
      $this->expectException(\InvalidArgumentException::class);
    }
    self::assertSame($seconds, WorkScheduleForm::duration($typed));
  }

  /**
   * Typed schedule values and their seconds, NULL when rejected.
   */
  public static function scheduleDurations(): array {
    return [
      'bare hour' => ['8', 28800],
      'bare hour with spaces' => [' 8 ', 28800],
      'bare zero' => ['0', 0],
      'bare two digits' => ['12', 43200],
      'H:MM' => ['8:00', 28800],
      'zero H:MM with spaces' => [' 0:00 ', 0],
      'letters' => ['abc', NULL],
      'minutes out of range' => ['8:75', NULL],
      'decimal' => ['8.5', NULL],
    ];
  }

  /**
   * The shared parser takes a bare hour within the entry bounds.
   */
  public function testSharedParserAcceptsBareHourWithinBounds(): void {
    self::assertSame(28800, WorklogFormLayout::parseDuration('8'));
    self::assertSame(0, WorklogFormLayout::parseDuration('0', 0));
    self::assertNull(WorklogFormLayout::parseDuration('0'));
    self::assertNull(WorklogFormLayout::parseDuration('25'));
    self::assertNull(WorklogFormLayout::parseDuration('8:0'));
    $range = 'Duration must be between 0:01 and 24:00.';
    self::assertSame($range, (string) WorkTimeRules::durationError('0'));
    self::assertSame($range, (string) WorkTimeRules::durationError('25'));
    self::assertStringContainsString('whole hours', (string) WorkTimeRules::durationError('abc'));
  }

  /**
   * Each invalid schedule field gets its own error, and all are reported.
   */
  public function testScheduleFormReportsEachInvalidField(): void {
    $form_state = $this->submitSchedule(['8', 'abc', '8', '8', '8', '0', '0'], '8:75');
    self::assertSame(['days][1', 'cap'], array_keys($form_state->getErrors()));
  }

  /**
   * Bare hours save as whole hours.
   */
  public function testScheduleFormSavesBareHours(): void {
    $form_state = $this->submitSchedule(['8', ' 8 ', '12', '7:30', '0', '0', '0:00'], '6');
    self::assertSame([], $form_state->getErrors());
    $schedule = \Drupal::service('bb_track.settings')->schedule();
    self::assertEquals(28800, $schedule['day_0']);
    self::assertEquals(28800, $schedule['day_1']);
    self::assertEquals(43200, $schedule['day_2']);
    self::assertEquals(27000, $schedule['day_3']);
    self::assertEquals(0, $schedule['day_4']);
    self::assertEquals(21600, $schedule['cap']);
  }

  /**
   * Submits the schedule form for the current user.
   */
  private function submitSchedule(array $days, string $cap): FormStateInterface {
    $form_state = new FormState();
    $form_state->setValues(['days' => $days, 'cap' => $cap, 'op' => 'Save schedule']);
    $this->container->get('form_builder')->submitForm(WorkScheduleForm::class, $form_state);
    return $form_state;
  }

}
