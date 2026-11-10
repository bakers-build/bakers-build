<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Time\BbDate;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * A conductor's credential report as a table of the checks that are not ok.
 *
 * One row per warning or error: name, status badge, expiry and reason. All
 * ok, or no report, renders nothing, so the zone around it disappears.
 */
#[FieldFormatter(
  id: 'bb_credential_health',
  label: new TranslatableMarkup('Credential problems table'),
  description: new TranslatableMarkup('The warning and error entries of a credential report as a bb_theme:table.'),
  field_types: ['string_long'],
)]
final class CredentialHealthFormatter extends FormatterBase {

  /**
   * Report status → badge tone, worst first.
   */
  public const TONES = [
    'error' => 'critical',
    'warning' => 'attention',
  ];

  /**
   * The product date formatter.
   */
  private BbDate $date;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->date = $container->get(BbDate::class);
    return $instance;
  }

  /**
   * The report entries whose status is warning or error, errors first.
   *
   * @param \Drupal\Core\Field\FieldItemListInterface $items
   *   The credential_health item list.
   *
   * @return array<int, array<string, string>>
   *   The entries as stored.
   */
  public static function problems(FieldItemListInterface $items): array {
    $report = json_decode((string) $items->value, TRUE);
    $problems = array_values(array_filter(
      is_array($report) ? $report : [],
      static fn (mixed $entry): bool => is_array($entry) && isset(self::TONES[$entry['status'] ?? '']),
    ));
    $rank = array_flip(array_keys(self::TONES));
    usort($problems, static fn (array $a, array $b): int => $rank[$a['status']] <=> $rank[$b['status']]);
    return $problems;
  }

  /**
   * The badge label of a problem status.
   */
  public static function label(string $status): TranslatableMarkup {
    return $status === 'error' ? new TranslatableMarkup('Error') : new TranslatableMarkup('Warning');
  }

  /**
   * {@inheritdoc}
   *
   * @return array<int, array<string, mixed>>
   *   One table, or nothing when every check is ok.
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $rows = [];
    foreach (self::problems($items) as $entry) {
      $rows[] = [
        'cells' => [
          'name' => ['kind' => 'mono', 'value' => (string) ($entry['name'] ?? '')],
          'status' => [
            'kind' => 'badge',
            'label' => (string) self::label($entry['status']),
            'tone' => self::TONES[$entry['status']],
          ],
          'expires' => isset($entry['expires_at'])
            ? $this->expiry((string) $entry['expires_at'])
            : ['kind' => 'text', 'value' => '—'],
          'reason' => ['kind' => 'text', 'value' => (string) ($entry['reason'] ?? '')],
        ],
      ];
    }
    if ($rows === []) {
      return [];
    }
    return [
      [
        '#type' => 'component',
        '#component' => 'bb_theme:table',
        '#props' => [
          'columns' => [
            ['key' => 'name', 'label' => (string) $this->t('Credential')],
            ['key' => 'status', 'label' => (string) $this->t('Status')],
            ['key' => 'expires', 'label' => (string) $this->t('Expires')],
            ['key' => 'reason', 'label' => (string) $this->t('Reason')],
          ],
          'rows' => $rows,
        ],
      ],
    ];
  }

  /**
   * The `time` cell of a calendar date.
   *
   * @param string $date
   *   The validated YYYY-MM-DD date.
   *
   * @return array<string, string>
   *   The cell.
   */
  private function expiry(string $date): array {
    // Noon UTC keeps the calendar day in every user timezone within ±11h.
    $timestamp = (int) strtotime($date . 'T12:00:00Z');
    return ['kind' => 'time'] + $this->date->dateElement($timestamp)['#props'];
  }

}
