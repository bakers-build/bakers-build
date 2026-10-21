<?php

declare(strict_types=1);

namespace Drupal\bb_board\Plugin\views\display;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\views\Attribute\ViewsDisplay;
use Drupal\views\Plugin\views\display\Attachment;
use Drupal\views\ViewExecutable;

/**
 * A board column: an attachment that has its own pager.
 *
 * Core attachments set `$usesPager = FALSE`, so four columns would share one
 * pager or have none. Each column display pages independently and still
 * inherits the page's arguments and exposed Conductor input.
 *
 * View::preSave() ksorts display ids, so getAttachedDisplays() would paint
 * Backlog, Done, Intake, Working. attachTo() reorders to the lifecycle.
 */
#[ViewsDisplay(
  id: 'bb_board_column',
  title: new TranslatableMarkup('Board column'),
  help: new TranslatableMarkup('A paged column attached to the project board page.'),
  theme: 'views_view',
  register_theme: FALSE,
  contextual_links_locations: [''],
)]
final class BbBoardColumn extends Attachment {

  /**
   * Lifecycle order of the four column displays.
   */
  public const COLUMN_ORDER = ['backlog', 'intake', 'working', 'done'];

  /**
   * {@inheritdoc}
   */
  protected $usesPager = TRUE;

  /**
   * {@inheritdoc}
   */
  protected function defineOptions(): array {
    $options = parent::defineOptions();
    $options['render_pager']['default'] = TRUE;
    $options['inherit_exposed_filters']['default'] = TRUE;
    $options['inherit_pager']['default'] = FALSE;
    return $options;
  }

  /**
   * {@inheritdoc}
   *
   * Mini pagers skip the count query. Search API then leaves `total_rows`
   * unset, and the column header would read 0. Ask for the count so the
   * header matches the indexed column.
   */
  public function preExecute(): void {
    $this->view->get_total_rows = TRUE;
    parent::preExecute();
  }

  /**
   * {@inheritdoc}
   */
  public function attachTo(ViewExecutable $view, $display_id, array &$build): void {
    if (($this->display['id'] ?? '') === 'done' && !self::showsDone($this->rawWorkState())) {
      return;
    }
    parent::attachTo($view, $display_id, $build);
    $this->view->attachment_before = self::sortAttachments($this->view->attachment_before);
    $this->view->attachment_after = self::sortAttachments($this->view->attachment_after);
  }

  /**
   * Whether the raw work_state query includes Done.
   *
   * Absent work_state is the three open columns, so Done stays detached.
   */
  public static function showsDone(mixed $raw): bool {
    if (!is_array($raw)) {
      $raw = is_scalar($raw) && (string) $raw !== '' ? [(string) $raw] : [];
    }
    foreach ($raw as $value) {
      if (is_scalar($value) && (string) $value === 'done') {
        return TRUE;
      }
    }
    return FALSE;
  }

  /**
   * The request's raw work_state value, or NULL when absent.
   */
  private function rawWorkState(): mixed {
    $request = $this->view->getRequest();
    if ($request === NULL) {
      return NULL;
    }
    return $request->query->all()['work_state'] ?? NULL;
  }

  /**
   * Orders column attachments Backlog, Intake, Working, Done.
   *
   * @param array<int, array<string, mixed>> $attachments
   *   Views attachment render arrays, each carrying `#display_id`.
   *
   * @return array<int, array<string, mixed>>
   *   The same items in lifecycle order.
   */
  public static function sortAttachments(array $attachments): array {
    if ($attachments === []) {
      return $attachments;
    }
    $order = array_flip(self::COLUMN_ORDER);
    usort($attachments, static function (array $a, array $b) use ($order): int {
      $left = $order[$a['#display_id'] ?? ''] ?? PHP_INT_MAX;
      $right = $order[$b['#display_id'] ?? ''] ?? PHP_INT_MAX;
      return $left <=> $right;
    });
    return $attachments;
  }

}
