<?php

declare(strict_types=1);

namespace Drupal\island\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;

/**
 * Places Drupal's deferred status messages in an island profile.
 */
#[Island(
  id: 'messages',
  label: new TranslatableMarkup('Messages'),
  description: new TranslatableMarkup('Displays Drupal status, warning and error messages.'),
  type: 'messages',
)]
final class Messages extends IslandPluginBase {

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    return ['#type' => 'status_messages'];
  }

}
