<?php

declare(strict_types=1);

namespace Drupal\island\Attribute;

use Drupal\Component\Plugin\Attribute\AttributeBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Defines an island plugin.
 *
 * Islands are self-contained page fragments that can be partially re-rendered
 * over HTMX. The type is a plain string; hosts register their own types via
 * hook_island_types_alter().
 *
 * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
 */
#[\Attribute(\Attribute::TARGET_CLASS)]
final class Island extends AttributeBase {

  public function __construct(
    public readonly string $id,
    public readonly ?TranslatableMarkup $label = NULL,
    public readonly ?TranslatableMarkup $description = NULL,
    public readonly ?string $type = NULL,
    public readonly ?string $icon = NULL,
    public readonly ?string $default_region = NULL,
    public readonly bool $enabled_by_default = FALSE,
    public readonly ?string $deriver = NULL,
    public readonly array $modules = [],
  ) {}

}
