<?php

declare(strict_types=1);

namespace Drupal\bb_board\Plugin\views\display;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_board\BoardPreferences;
use Drupal\views\Attribute\ViewsDisplay;
use Drupal\views\Plugin\views\display\Attachment;
use Drupal\views\ViewExecutable;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * A board column: an attachment that has its own pager.
 *
 * Core attachments set `$usesPager = FALSE`, so four columns would share one
 * pager or have none. Each column display pages independently and still
 * inherits the page's arguments and exposed Conductor input.
 *
 * View::preSave() ksorts display ids, so getAttachedDisplays() would paint
 * Backlog, Done, Intake, Working. attachTo() reorders to the lifecycle.
 *
 * Details on replaces Working with its state sub-columns; Done always
 * attaches and, while closed, shows its count only.
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
   * Lifecycle order of the column displays.
   */
  public const COLUMN_ORDER = [
    'backlog',
    'intake',
    'working',
    'working_plan',
    'working_working',
    'working_review',
    'done',
  ];

  /**
   * Whether a display attaches with Details on; the rest always attach.
   */
  public const DETAILS = [
    'working' => FALSE,
    'working_plan' => TRUE,
    'working_working' => TRUE,
    'working_review' => TRUE,
  ];

  /**
   * {@inheritdoc}
   */
  protected $usesPager = TRUE;

  /**
   * The Details and Done preferences of this request.
   */
  private BoardPreferences $preferences;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->preferences = $container->get(BoardPreferences::class);
    return $instance;
  }

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
    if (!self::attaches((string) $this->display['id'], $this->preferences->details())) {
      return;
    }
    parent::attachTo($view, $display_id, $build);
    $this->view->attachment_before = self::sortAttachments($this->view->attachment_before);
    $this->view->attachment_after = self::sortAttachments($this->view->attachment_after);
  }

  /**
   * Whether a column display attaches with Details on or off.
   */
  public static function attaches(string $displayId, bool $details): bool {
    return (self::DETAILS[$displayId] ?? $details) === $details;
  }

  /**
   * {@inheritdoc}
   *
   * A closed Done column shows its count only, so it builds no cards.
   */
  public function render(): array {
    if ($this->display['id'] === 'done' && !$this->preferences->doneOpen()) {
      $this->view->result = [];
    }
    return parent::render();
  }

  /**
   * Orders column attachments in lifecycle order.
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
