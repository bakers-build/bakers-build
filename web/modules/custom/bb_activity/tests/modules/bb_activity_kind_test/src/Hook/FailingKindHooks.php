<?php

declare(strict_types=1);

namespace Drupal\bb_activity_kind_test\Hook;

use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\State\StateInterface;
use Drupal\bb_activity_kind_test\FailingKind;

/**
 * Swaps the kinds listed in state for one that fails while recording.
 */
final class FailingKindHooks {

  /**
   * The state key listing the kind IDs to fail.
   */
  public const STATE = 'bb_activity_kind_test.failing';

  public function __construct(
    private readonly StateInterface $state,
  ) {}

  /**
   * Implements hook_bb_activity_kind_info_alter().
   *
   * @param array<array<string, mixed>> $definitions
   *   The kind definitions, keyed by kind ID.
   */
  #[Hook('bb_activity_kind_info_alter')]
  public function kindInfoAlter(array &$definitions): void {
    foreach ((array) $this->state->get(self::STATE, []) as $id) {
      if (isset($definitions[$id])) {
        $definitions[$id]['class'] = FailingKind::class;
      }
    }
  }

}
