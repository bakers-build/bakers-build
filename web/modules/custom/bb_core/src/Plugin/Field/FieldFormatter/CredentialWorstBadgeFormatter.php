<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * The worst status of a conductor's credential report as one badge.
 *
 * Error beats warning; an all-ok or missing report renders nothing.
 */
#[FieldFormatter(
  id: 'bb_credential_worst_badge',
  label: new TranslatableMarkup('Credential worst status badge'),
  description: new TranslatableMarkup('Error or warning when any credential check reports one, as a tinted badge.'),
  field_types: ['string_long'],
)]
final class CredentialWorstBadgeFormatter extends FormatterBase {

  /**
   * {@inheritdoc}
   *
   * @return array<int, array<string, mixed>>
   *   One badge, or nothing.
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $worst = CredentialHealthFormatter::problems($items)[0] ?? NULL;
    if ($worst === NULL) {
      return [];
    }
    return [
      [
        '#type' => 'component',
        '#component' => 'bb_theme:badge',
        '#props' => [
          'label' => (string) $this->t('Credentials: @status', ['@status' => CredentialHealthFormatter::label($worst['status'])]),
          'tone' => CredentialHealthFormatter::TONES[$worst['status']],
          'dot' => TRUE,
        ],
      ],
    ];
  }

}
