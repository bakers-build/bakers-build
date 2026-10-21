<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Render\BubbleableMetadata;
use Drupal\Core\StringTranslation\StringTranslationTrait;

/**
 * Token integration for bb_ticket entities.
 */
final class TicketTokenHooks {

  use StringTranslationTrait;

  /**
   * Implements hook_token_info().
   *
   * @return array<string, mixed>
   *   The token type and token definitions.
   */
  #[Hook('token_info')]
  public function tokenInfo(): array {
    return [
      'types' => [
        'bb_ticket' => [
          'name' => $this->t('bakers.build ticket'),
          'needs-data' => 'bb_ticket',
        ],
      ],
      'tokens' => [
        'bb_ticket' => [
          'identifier' => [
            'name' => $this->t('Identifier'),
            'description' => $this->t('The ticket identifier, e.g. BB-44.'),
          ],
          'title' => ['name' => $this->t('Title'), 'description' => $this->t('The ticket title.')],
        ],
      ],
    ];
  }

  /**
   * Implements hook_tokens().
   *
   * @param string $type
   *   The token type.
   * @param array<string, string> $tokens
   *   The tokens to replace, keyed by name.
   * @param array<string, mixed> $data
   *   The token data.
   * @param array<string, mixed> $options
   *   The replacement options.
   * @param \Drupal\Core\Render\BubbleableMetadata $bubbleable_metadata
   *   The bubbleable metadata.
   *
   * @return array<string, string>
   *   The replacements, keyed by original token.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  #[Hook('tokens')]
  public function tokens(string $type, array $tokens, array $data, array $options, BubbleableMetadata $bubbleable_metadata): array {
    $replacements = [];
    if ($type !== 'bb_ticket' || empty($data['bb_ticket'])) {
      return $replacements;
    }
    $ticket = $data['bb_ticket'];
    foreach ($tokens as $name => $original) {
      if ($name === 'identifier' || $name === 'title') {
        $replacements[$original] = (string) $ticket->get($name)->value;
      }
    }
    return $replacements;
  }

}
