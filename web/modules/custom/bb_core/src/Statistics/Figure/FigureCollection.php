<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Figure;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Access\FigureDisclosure;
use Drupal\bb_core\BbFigureGroupInterface;
use Drupal\bb_core\Statistics\FigureDiscovery;
use Drupal\bb_core\Statistics\Period\PeriodResolver;

/**
 * Builds ordered, titled groups of complete figure payloads.
 */
final class FigureCollection {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly FigureDiscovery $discovery,
    private readonly FigureEvaluator $evaluator,
    private readonly FigureDisclosure $disclosure,
  ) {}

  /**
   * Builds the disclosed groups for one request.
   *
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
   *   Named entity contexts.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The requesting account.
   * @param array<string, string|list<string>> $filters
   *   Selected filter values.
   * @param int $now
   *   The request timestamp.
   *
   * @return array<int, array{id: string, label: string, figures: array<int, array<string, mixed>>}>
   *   Ordered, non-empty figure groups.
   */
  public function groups(array $contexts, AccountInterface $account, array $filters, int $now): array {
    $disclosed = [];
    foreach ($this->discovery->discover($contexts, $account) as $figure) {
      $disclosed[$figure->id()] = $figure;
    }
    $knownFilters = [];
    foreach ($disclosed as $figure) {
      $knownFilters += $this->acceptedFilters($figure->getFilters());
    }
    $unknownFilters = array_diff_key($filters, $knownFilters);
    if ($unknownFilters !== []) {
      throw new \InvalidArgumentException(sprintf(
        'Unknown filter "%s".',
        (string) array_key_first($unknownFilters),
      ));
    }
    $groups = array_values(array_filter(
      $this->entityTypeManager->getStorage('bb_figure_group')->loadMultiple(),
      static fn($group): bool => $group instanceof BbFigureGroupInterface,
    ));
    usort(
      $groups,
      static fn(BbFigureGroupInterface $left, BbFigureGroupInterface $right): int =>
        [$left->getWeight(), $left->id()] <=> [$right->getWeight(), $right->id()],
    );

    $result = [];
    foreach ($groups as $group) {
      $figures = [];
      foreach ($group->getFigures() as $figureId) {
        if (isset($disclosed[$figureId])) {
          $selected = array_intersect_key($filters, $this->acceptedFilters($disclosed[$figureId]->getFilters()));
          $figures[] = $this->evaluator
            ->evaluate($disclosed[$figureId], $contexts, $selected, $now, $this->disclosure->projectBound($account, $disclosed[$figureId], $contexts))
            ->toArray();
        }
      }
      if ($figures !== []) {
        $result[] = [
          'id' => (string) $group->id(),
          'label' => (string) $group->label(),
          'figures' => $figures,
        ];
      }
    }
    return $result;
  }

  /**
   * The request keys a figure accepts: its filters and the period companions.
   *
   * @param array<string, array<string, mixed>> $filters
   *   The figure filter configuration.
   *
   * @return array<string, true>
   *   The accepted keys.
   */
  private function acceptedFilters(array $filters): array {
    $accepted = array_fill_keys(array_keys($filters), TRUE);
    if (isset($filters['period'])) {
      $accepted += array_fill_keys(PeriodResolver::COMPANIONS, TRUE);
    }
    return $accepted;
  }

}
