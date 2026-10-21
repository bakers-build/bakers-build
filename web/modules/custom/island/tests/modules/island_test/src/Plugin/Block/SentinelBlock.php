<?php

declare(strict_types=1);

namespace Drupal\island_test\Plugin\Block;

use Drupal\Core\Block\Attribute\Block;
use Drupal\Core\Block\BlockBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * A block whose markup is a sentinel, for the "adds nothing" assertion.
 *
 * The point of a sentinel rather than a real block is that acceptance criterion
 * 2 is about what the ISLAND contributes, and any core block would bring its
 * own wrapper, its own title and its own theme hook into the comparison. One
 * unmistakable element makes "the container plus the content, and nothing else"
 * an assertion about the island instead of an assertion about block theming.
 */
#[Block(
  id: 'island_test_sentinel',
  admin_label: new TranslatableMarkup('Island test sentinel'),
)]
final class SentinelBlock extends BlockBase {

  /**
   * The exact markup the wrapped content contributes.
   */
  public const MARKUP = '<p class="sentinel">wrapped</p>';

  /**
   * {@inheritdoc}
   */
  public function build(): array {
    return ['#markup' => self::MARKUP];
  }

}
