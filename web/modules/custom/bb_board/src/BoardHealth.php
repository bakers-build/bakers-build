<?php

declare(strict_types=1);

namespace Drupal\bb_board;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\views\ViewExecutable;

/**
 * The Board's Unhealthy filter: one stored health condition.
 *
 * The query alter that narrows every display and the summary that shows its
 * chip both ask here, so they can never disagree.
 */
final class BoardHealth {

  /**
   * The query parameter of the filter.
   */
  public const PARAMETER = 'health';

  /**
   * Its one value; any other value, or a list, is no filter.
   */
  public const VALUE = 'unhealthy';

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * Whether the board's input asks for the Unhealthy filter.
   */
  public function requested(ViewExecutable $view): bool {
    return ($view->getExposedInput()[self::PARAMETER] ?? NULL) === self::VALUE;
  }

  /**
   * The board's project, from the validated argument.
   *
   * The validated argument is an id; the raw view argument may be a key.
   */
  public function project(ViewExecutable $view): ?BbProjectInterface {
    $project = $this->entityTypeManager->getStorage('bb_project')->load($view->argument['project_id']->argument ?? 0);
    return $project instanceof BbProjectInterface ? $project : NULL;
  }

}
