<?php

declare(strict_types=1);

namespace Drupal\bb_track;

use Drupal\user\UserInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;

/**
 * Personal weekday template for AI planning.
 */
final class WorkTimeSettings {

  use WorkTimePersistence;

  /**
   * Constructs the application service.
   */
  public function __construct(
    private EntityTypeManagerInterface $entities,
    private WorkTimeMutation $mutation,
    private WorkTimeRecords $records,
  ) {}

  /**
   * Returns the current owner's schedule, or NULL before the first save.
   */
  public function schedule(): ?array {
    $user = $this->entities->getStorage('user')->loadUnchanged($this->records->owner());
    assert($user instanceof UserInterface);
    return $user->get('work_schedule')->getValue()[0] ?? NULL;
  }

  /**
   * Replaces the current owner's single weekday schedule.
   */
  public function saveSchedule(array $days, ?int $cap): UserInterface {
    $owner = $this->records->owner();
    if (count($days) !== 7 || !array_is_list($days)) {
      throw new \InvalidArgumentException('Supply all seven weekday durations.');
    }
    foreach ($days as $seconds) {
      WorkTimeRules::seconds($seconds, 0);
    }
    if ($cap !== NULL) {
      WorkTimeRules::seconds($cap, 0);
    }
    return $this->mutation->run('owner:' . $owner, function () use ($owner, $days, $cap): UserInterface {
      $user = $this->entities->getStorage('user')->loadUnchanged($owner);
      assert($user instanceof UserInterface);
      $item = ['cap' => $cap];
      foreach ($days as $index => $seconds) {
        $item['day_' . $index] = $seconds;
      }
      $user->set('work_schedule', [$item]);
      $this->persist($user);
      return $user;
    });
  }

}
