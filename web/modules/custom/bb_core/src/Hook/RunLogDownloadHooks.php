<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Hook\Attribute\Hook;
use Drupal\bb_core\RunLog\RunLogStore;

/**
 * Keeps run-log files out of core's private-file pipeline.
 *
 * The retrieval route is the only door. Serving the raw path would bypass the
 * route's entity-access requirement entirely, so anything under the run-log
 * directory is refused here unconditionally. Other private files are untouched:
 * abstaining (NULL) rather than denying is what leaves them their own handling.
 */
final class RunLogDownloadHooks {

  /**
   * Denies core's private-file pipeline for any run-log URI.
   */
  #[Hook('file_download')]
  public function fileDownload(string $uri): int|null {
    return RunLogStore::workspaceUuidFromUri($uri) === '' ? NULL : -1;
  }

}
