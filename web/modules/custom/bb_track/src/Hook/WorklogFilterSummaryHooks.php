<?php

declare(strict_types=1);

namespace Drupal\bb_track\Hook;

use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\bb_track\Plugin\views\filter\WorklogPeriod;
use Drupal\bb_track\WorklogSelection;
use Drupal\views\Plugin\views\filter\FilterPluginBase;

/**
 * Turns the period filter into views_filters_summary chips.
 */
final class WorklogFilterSummaryHooks {

  use StringTranslationTrait;

  /**
   * Implements hook_views_filters_summary_info_alter().
   *
   * @param array<string, mixed> $info
   *   The summary info to alter.
   * @param \Drupal\views\Plugin\views\filter\FilterPluginBase $filter
   *   The filter handler the summary info belongs to.
   */
  #[Hook('views_filters_summary_info_alter')]
  public function viewsFiltersSummaryInfoAlter(array &$info, FilterPluginBase $filter): void {
    if (!$filter instanceof WorklogPeriod) {
      return;
    }
    $selection = $filter->selection();
    if (!$selection->valid) {
      $info['label'] = (string) $this->t('Period');
      $info['value'] = [
        [
          'id' => 0,
          'raw' => 'invalid',
          'value' => (string) $this->t('not valid'),
        ],
      ];
      return;
    }
    $info['label'] = $selection->mode === 'day'
      ? (string) $this->t('Day')
      : (string) $this->t('Week');
    $info['value'] = [
      [
        'id' => 0,
        'raw' => $selection->mode,
        'value' => $this->chipValue($filter, $selection),
      ],
    ];
  }

  /**
   * One chip sentence for the period and its present filters.
   */
  private function chipValue(WorklogPeriod $filter, WorklogSelection $selection): string {
    $parts = [
      $selection->mode === 'day'
        ? $selection->date
        : (string) $this->t('@start through @end', [
          '@start' => $selection->start,
          '@end' => (new \DateTimeImmutable($selection->end))->modify('-1 day')->format('Y-m-d'),
        ]),
    ];
    if ($filter->context() !== 'project') {
      $parts[] = $selection->label('project');
    }
    $parts[] = $selection->label('ticket');
    $parts[] = $selection->label('person');
    return implode(' · ', array_filter($parts));
  }

}
