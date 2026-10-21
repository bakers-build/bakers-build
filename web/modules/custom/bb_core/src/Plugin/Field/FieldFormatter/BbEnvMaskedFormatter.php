<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\EnvVars;

/**
 * Renders env vars as a masked key list through bb_theme:list.
 *
 * Parses the `.env`-style value, drops every value and emits `list` items of
 * three cells: a `mono` key, a `masked` value and a neutral `badge` saying
 * `own` (set in the ticket's own `env_vars`) or `inherited`. Values never
 * enter the render array. This is a display choice, not an access boundary:
 * the raw value is readable over JSON:API by anyone who can view the ticket.
 * The badge label, not colour, carries the provenance.
 */
#[FieldFormatter(
  id: 'bb_env_masked',
  label: new TranslatableMarkup('Masked environment variables'),
  field_types: ['string_long'],
)]
final class BbEnvMaskedFormatter extends FormatterBase {

  /**
   * {@inheritdoc}
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    if ($items->isEmpty()) {
      return [];
    }
    $effective = EnvVars::parse((string) $items->first()?->get('value')->getValue());
    if ($effective === []) {
      return [];
    }

    // The keys the ticket sets itself → 'own'; everything else is inherited.
    $entity = $items->getEntity();
    $own = $entity->hasField('env_vars')
      ? EnvVars::parse((string) $entity->get('env_vars')->value)
      : [];

    $items = [];
    foreach (array_keys($effective) as $key) {
      $items[] = [
        'cells' => [
          'name' => ['kind' => 'mono', 'value' => $key],
          // No `value` and no `revealed`: the cell renders the withheld-value
          // token, and there is nothing in the render array to reveal.
          'value' => ['kind' => 'masked'],
          'origin' => [
            'kind' => 'badge',
            'label' => array_key_exists($key, $own) ? 'own' : 'inherited',
            'tone' => 'neutral',
            'icon' => '',
            'suffix' => '',
          ],
        ],
      ];
    }

    return [
      0 => [
        '#type' => 'component',
        '#component' => 'bb_theme:list',
        '#props' => ['layout' => 'lines', 'items' => $items],
      ],
    ];
  }

}
