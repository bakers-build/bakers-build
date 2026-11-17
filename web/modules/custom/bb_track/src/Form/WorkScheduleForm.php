<?php

declare(strict_types=1);

namespace Drupal\bb_track\Form;

use Symfony\Component\DependencyInjection\ContainerInterface;
use Drupal\bb_track\WorkTimeSettings;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;

/**
 * Personal weekday defaults, without an implicit working-time target.
 */
final class WorkScheduleForm extends FormBase {

  /**
   * Constructs the native form with serializable application services.
   */
  public function __construct(
    protected WorkTimeSettings $settings,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('bb_track.settings'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_track_schedule';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $schedule = $this->settings->schedule() ?? [];
    $form['#attributes']['data-hx-boost'] = 'false';
    $format_error = $this->t('Use whole hours or hours:minutes, for example 8, 7:30 or 0:00.');
    $hint = $this->t('Whole hours or H:MM, for example 8 or 7:30.');
    $form['messages'] = [
      '#type' => 'status_messages',
    ];
    foreach ([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ] as $index => $day) {
      $form['days'][$index] = [
        '#type' => 'bb_duration',
        '#minimum' => 0,
        '#format_error' => $format_error,
        '#title' => $this->t('@day (H:MM)', [
          '@day' => $day,
        ]),
        '#description' => $hint,
        '#required' => TRUE,
        '#size' => 8,
        '#default_value' => isset($schedule['day_' . $index]) ? WorklogFormLayout::formatDuration((int) $schedule['day_' . $index]) : '',
      ];
    }
    $form['days']['#tree'] = TRUE;
    $form['cap'] = [
      '#type' => 'bb_duration',
      '#minimum' => 0,
      '#format_error' => $format_error,
      '#title' => $this->t('Optional proposal-day cap (H:MM)'),
      '#description' => $this->t('@hint Optional planning guidance for your AI. bakers.build does not allocate or cap recorded time.', [
        '@hint' => $hint,
      ]),
      '#default_value' => isset($schedule['cap']) ? WorklogFormLayout::formatDuration((int) $schedule['cap']) : '',
    ];
    $form['actions']['#type'] = 'actions';
    $form['actions']['save'] = [
      '#type' => 'submit',
      '#value' => $this->t('Save schedule'),
    ];
    return $form;
  }

  /**
   * Parses whole hours or H:MM settings, including explicit zero.
   */
  public static function duration(mixed $value): int {
    $seconds = WorklogFormLayout::parseDuration($value, 0);
    if ($seconds === NULL) {
      throw new \InvalidArgumentException('Use whole hours or hours:minutes, for example 8, 7:30 or 0:00.');
    }
    return $seconds;
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    // The duration elements already set their own errors.
    if ($form_state->hasAnyErrors()) {
      return;
    }
    $form_state->set('days_seconds', array_map(self::duration(...), $form_state->getValue('days')));
    $cap = $form_state->getValue('cap');
    $form_state->set('cap_seconds', $cap === '' ? NULL : self::duration($cap));
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    try {
      $this->settings->saveSchedule($form_state->get('days_seconds'), $form_state->get('cap_seconds'));
      $this->messenger()->addStatus($this->t('Personal schedule saved.'));
      $form_state->setRedirect('bb_track.schedule', ['user' => $this->currentUser()->id()]);
    }
    catch (\Throwable $error) {
      $this->logger('bb_track')->error('Schedule save failed: @message', [
        '@message' => $error->getMessage(),
      ]);
      $this->messenger()->addError($error instanceof \InvalidArgumentException || $error instanceof \DomainException ? $error->getMessage() : $this->t('The schedule could not be saved. Refresh and retry.'));
      $form_state->setRebuild();
    }
  }

}
