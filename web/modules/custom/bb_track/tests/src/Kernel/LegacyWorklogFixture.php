<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\bb_track\Entity\Worklog;

/**
 * Seeds approved or proposed state without adding a production write bypass.
 */
final class LegacyWorklogFixture {

  /**
   * Creates historical rows used by the existing read-only/access regressions.
   */
  public static function save(Worklog $entry): void {
    $state = $entry->get('state')->value;
    $entry->set('state', 'recorded')->save();
    if ($state !== 'recorded') {
      \Drupal::database()->update('bb_track_worklog')->fields([
        'state' => $state,
      ])->condition('id', $entry->id())->execute();
      $entry->set('state', $state);
      \Drupal::entityTypeManager()->getStorage('bb_track_worklog')->resetCache([
        $entry->id(),
      ]);
    }
  }

}
