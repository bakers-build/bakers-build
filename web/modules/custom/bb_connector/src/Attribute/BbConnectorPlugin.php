<?php

declare(strict_types=1);

namespace Drupal\bb_connector\Attribute;

use Drupal\Component\Plugin\Attribute\AttributeBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Defines a bakers.build connector plugin attribute.
 */
#[\Attribute(\Attribute::TARGET_CLASS)]
final class BbConnectorPlugin extends AttributeBase {

  /**
   * Constructs a BbConnectorPlugin attribute.
   *
   * @param string $id
   *   The plugin ID (matches bb_connector.plugin config values).
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup $label
   *   The human-readable plugin label.
   */
  public function __construct(
    public readonly string $id,
    public readonly TranslatableMarkup $label,
  ) {}

}
