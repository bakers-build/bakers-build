<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Plugin\BbTicketTriggerType;

use Drupal\Core\Datetime\TimeZoneFormHelper;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_ticket_trigger\Attribute\BbTicketTriggerType;
use Drupal\bb_ticket_trigger\TicketTrigger\TicketTriggerTypeBase;

/**
 * Fires daily, weekly or monthly at a local time in an IANA zone.
 *
 * Month end: day 29–31 falls on a shorter month's last day. DST: a local time
 * in the spring gap runs at the first valid time after it (PHP's
 * normalisation); one that exists twice in autumn runs once, at its first
 * (summer-time) instance.
 */
#[BbTicketTriggerType(
  id: 'schedule',
  label: new TranslatableMarkup('Time schedule'),
)]
final class Schedule extends TicketTriggerTypeBase {

  /**
   * The configuration keys each frequency keeps.
   */
  private const KEYS = [
    'daily' => ['frequency', 'time', 'timezone'],
    'weekly' => ['frequency', 'weekday', 'time', 'timezone'],
    'monthly' => ['frequency', 'day', 'time', 'timezone'],
  ];

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   The defaults: monthly on day 1 at 09:00, Europe/Berlin.
   */
  public function defaultConfiguration(): array {
    return [
      'frequency' => 'monthly',
      'day' => '1',
      'time' => '09:00',
      'timezone' => 'Europe/Berlin',
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function summary(): string {
    $config = $this->configuration;
    $args = ['@time' => $config['time'], '@zone' => $config['timezone']];
    return (string) match ($config['frequency']) {
      'daily' => $this->t('Daily at @time (@zone)', $args),
      'weekly' => $this->t('Weekly on @weekday at @time (@zone)', $args + ['@weekday' => $this->weekdays()[(int) ($config['weekday'] ?? 0)] ?? '?']),
      default => (string) $config['day'] === 'last'
        ? $this->t('Monthly on the last day at @time (@zone)', $args)
        : $this->t('Monthly on day @day at @time (@zone)', $args + ['@day' => $config['day']]),
    };
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string>
   *   The error messages.
   */
  public function configurationErrors(): array {
    $config = $this->configuration;
    $errors = [];
    $frequency = $config['frequency'] ?? NULL;
    if (!is_string($frequency) || !isset(self::KEYS[$frequency])) {
      $errors[] = (string) $this->t('Choose daily, weekly or monthly.');
    }
    if (preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string) ($config['time'] ?? '')) !== 1) {
      $errors[] = (string) $this->t('Enter the time as HH:MM (24 hours).');
    }
    if (!in_array($config['timezone'] ?? NULL, \DateTimeZone::listIdentifiers(), TRUE)) {
      $errors[] = (string) $this->t('Choose a valid time zone.');
    }
    if ($frequency === 'weekly' && !isset($this->weekdays()[(int) ($config['weekday'] ?? 0)])) {
      $errors[] = (string) $this->t('Choose a weekday.');
    }
    if ($frequency === 'monthly' && !isset($this->days()[(string) ($config['day'] ?? '')])) {
      $errors[] = (string) $this->t('Choose a day of the month between 1 and 31, or the last day.');
    }
    return $errors;
  }

  /**
   * {@inheritdoc}
   */
  public function nextOccurrence(\DateTimeImmutable $after): ?\DateTimeImmutable {
    if ($this->configurationErrors() !== []) {
      return NULL;
    }
    $zone = new \DateTimeZone($this->configuration['timezone']);
    $local = $after->setTimezone($zone);
    if ($this->configuration['frequency'] === 'monthly') {
      $month = $local->modify('first day of this month');
      // The candidate in $after's month may already be past; the next
      // month's never is.
      for ($i = 0; $i < 2; $i++) {
        $candidate = $this->monthlyCandidate($month->modify("+$i month"), $zone);
        if ($candidate > $after) {
          return $candidate;
        }
      }
      return NULL;
    }
    // Starts a day early: a late local time can still be ahead of $after on
    // the previous local date across a zone boundary.
    $day = $local->modify('-1 day');
    for ($i = 0; $i < 9; $i++) {
      $date = $day->modify("+$i day");
      if ($this->configuration['frequency'] === 'weekly' && (int) $date->format('N') !== (int) $this->configuration['weekday']) {
        continue;
      }
      $candidate = $this->localTime((int) $date->format('Y'), (int) $date->format('n'), (int) $date->format('j'), $zone);
      if ($candidate > $after) {
        return $candidate;
      }
    }
    return NULL;
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The plugin form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   *
   * @return array<string, mixed>
   *   The plugin form.
   */
  public function buildConfigurationForm(array $form, FormStateInterface $form_state): array {
    $config = $this->configuration;
    // The trigger form refreshes this section over htmx when the frequency
    // changes; afterBuild() offers only that frequency's fields.
    $form['#after_build'][] = [self::class, 'afterBuild'];
    $form['frequency'] = [
      '#type' => 'select',
      '#title' => $this->t('Frequency'),
      '#options' => [
        'daily' => $this->t('Daily'),
        'weekly' => $this->t('Weekly'),
        'monthly' => $this->t('Monthly'),
      ],
      '#default_value' => $config['frequency'],
      '#required' => TRUE,
      '#attributes' => ['data-trigger-frequency' => TRUE],
    ];
    $form['weekday'] = [
      '#type' => 'select',
      '#title' => $this->t('Weekday'),
      '#options' => $this->weekdays(),
      '#default_value' => $config['weekday'] ?? 1,
    ];
    $form['day'] = [
      '#type' => 'select',
      '#title' => $this->t('Day of month'),
      '#options' => $this->days(),
      '#default_value' => $config['day'] ?? '1',
      '#description' => $this->t('Days 29–31 fall on the last day of shorter months.'),
    ];
    // The browser's own time picker (`HH:MM`) in a plain form element, so
    // label and description render like the other fields; core's datetime
    // element would bring its own wrapper. The zone that matters is the one
    // chosen below, not the viewer's.
    $form['time'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Time'),
      '#description' => $this->t('In the time zone below.'),
      '#default_value' => (string) $config['time'],
      '#attributes' => ['type' => 'time', 'step' => 60],
      '#size' => 5,
      '#required' => TRUE,
    ];
    $form['timezone'] = [
      '#type' => 'select',
      '#title' => $this->t('Time zone'),
      '#options' => TimeZoneFormHelper::getOptionsListByRegion(),
      '#default_value' => $config['timezone'],
      '#required' => TRUE,
    ];
    return $form;
  }

  /**
   * Offers only the fields of the submitted, else the stored, frequency.
   *
   * Without JavaScript a changed frequency saves at once with its newly
   * needed field at the default (Monday or day 1); the user edits it after.
   *
   * @param array<string, mixed> $element
   *   The schedule form.
   *
   * @return array<string, mixed>
   *   The schedule form.
   */
  public static function afterBuild(array $element): array {
    // Set here: the plugin selector's own container attributes win over the
    // configuration form's.
    $element['#attributes']['data-trigger-schedule'] = TRUE;
    $keys = self::KEYS[(string) ($element['frequency']['#value'] ?? '')] ?? self::KEYS['monthly'];
    foreach (['weekday', 'day'] as $field) {
      $element[$field]['#access'] = in_array($field, $keys, TRUE);
    }
    return $element;
  }

  /**
   * {@inheritdoc}
   *
   * Keeps only the chosen frequency's keys, so a stale day or weekday from an
   * earlier frequency never reaches storage.
   *
   * @param array<string, mixed> $form
   *   The plugin form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  public function submitConfigurationForm(array &$form, FormStateInterface $form_state): void {
    $values = $this->submittedValues($form, $form_state);
    $keys = self::KEYS[$values['frequency'] ?? ''] ?? self::KEYS['monthly'];
    $this->configuration = array_intersect_key($values, array_flip($keys));
  }

  /**
   * The occurrence in the month of $month, clamped to its last day.
   */
  private function monthlyCandidate(\DateTimeImmutable $month, \DateTimeZone $zone): \DateTimeImmutable {
    $last = (int) $month->format('t');
    $day = (string) $this->configuration['day'] === 'last' ? $last : min((int) $this->configuration['day'], $last);
    return $this->localTime((int) $month->format('Y'), (int) $month->format('n'), $day, $zone);
  }

  /**
   * The configured local time on one date.
   */
  private function localTime(int $year, int $month, int $day, \DateTimeZone $zone): \DateTimeImmutable {
    [$hour, $minute] = array_map('intval', explode(':', (string) $this->configuration['time']));
    $candidate = new \DateTimeImmutable(sprintf('%04d-%02d-%02d %02d:%02d:00', $year, $month, $day, $hour, $minute), $zone);
    // PHP resolves a wall time that exists twice to its second (winter)
    // instance; the first is one real hour earlier. modify() would do
    // wall-clock arithmetic, so subtract on the timestamp.
    $earlier = (new \DateTimeImmutable('@' . ($candidate->getTimestamp() - 3600)))->setTimezone($zone);
    if ($earlier->format('H:i') === $candidate->format('H:i')) {
      return $earlier;
    }
    return $candidate;
  }

  /**
   * ISO weekday options, Monday first.
   *
   * @return array<int, \Drupal\Core\StringTranslation\TranslatableMarkup>
   *   1–7 => name.
   */
  private function weekdays(): array {
    return [
      1 => $this->t('Monday'),
      2 => $this->t('Tuesday'),
      3 => $this->t('Wednesday'),
      4 => $this->t('Thursday'),
      5 => $this->t('Friday'),
      6 => $this->t('Saturday'),
      7 => $this->t('Sunday'),
    ];
  }

  /**
   * Day-of-month options.
   *
   * @return array<int|string, string|\Drupal\Core\StringTranslation\TranslatableMarkup>
   *   1–31 (PHP makes the numeric keys integers) and 'last'.
   */
  private function days(): array {
    $days = [];
    foreach (range(1, 31) as $day) {
      $days[(string) $day] = (string) $day;
    }
    $days['last'] = $this->t('Last day');
    return $days;
  }

}
