<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Access\FigureDisclosure;
use Drupal\bb_core\BbFigureInterface;

/**
 * Discovers applicable and permitted figures for named route contexts.
 */
final class FigureDiscovery {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly FigureDisclosure $disclosure,
  ) {}

  /**
   * Finds figures that apply to the supplied context and account.
   *
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
   *   The named route entities.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account requesting the figures.
   *
   * @return array<BbFigureInterface>
   *   The applicable permitted figures in display order.
   */
  public function discover(array $contexts, AccountInterface $account): array {
    $figures = [];
    foreach ($this->entityTypeManager->getStorage('bb_figure')->loadMultiple() as $figure) {
      if ($figure instanceof BbFigureInterface && $this->disclosure->mayView($account, $figure, $contexts)) {
        $figures[] = $figure;
      }
    }
    usort($figures, static function (BbFigureInterface $left, BbFigureInterface $right): int {
      return [$left->getWeight(), $left->id()] <=> [$right->getWeight(), $right->id()];
    });
    return $figures;
  }

}
