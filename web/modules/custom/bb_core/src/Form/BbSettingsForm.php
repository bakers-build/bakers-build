<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;

/**
 * Configures bakers.build control-plane behaviour (lease + failed-run retry policy).
 *
 * One form, two vertical tabs backed by the bb_core.settings config object:
 * - bakers.build: the claim-lease bounds (default + max lease seconds).
 * - Run: the failed-run circuit breaker (retry cap + window) that stops a
 *   persistently-failing setup from hot-reclaim-looping.
 *
 * TicketClaimService reads these values with its class constants as fallback
 * defaults, so an unsaved / partial config never breaks claiming.
 */
final class BbSettingsForm extends ConfigFormBase {

  private const CONFIG = 'bb_core.settings';

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_core_settings';
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditableConfigNames(): array {
    return [self::CONFIG];
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $config = $this->config(self::CONFIG);

    $form['tabs'] = [
      '#type' => 'vertical_tabs',
      '#default_tab' => 'edit-bakers',
    ];

    $form['bakers'] = [
      '#type' => 'details',
      '#title' => $this->t('bakers.build'),
      '#group' => 'tabs',
    ];
    $form['bakers']['default_lease_seconds'] = [
      '#type' => 'number',
      '#title' => $this->t('Default claim lease (seconds)'),
      '#description' => $this->t('Lease granted to a claim when the caller requests none.'),
      '#min' => 1,
      '#default_value' => $config->get('default_lease_seconds') ?? 300,
      '#required' => TRUE,
    ];
    $form['bakers']['max_lease_seconds'] = [
      '#type' => 'number',
      '#title' => $this->t('Maximum claim lease (seconds)'),
      '#description' => $this->t('Upper bound a requested lease is clamped to.'),
      '#min' => 1,
      '#default_value' => $config->get('max_lease_seconds') ?? 3600,
      '#required' => TRUE,
    ];

    $form['run'] = [
      '#type' => 'details',
      '#title' => $this->t('Run'),
      '#group' => 'tabs',
    ];
    $form['run']['failed_retry_cap'] = [
      '#type' => 'number',
      '#title' => $this->t('Failed-run retry cap'),
      '#description' => $this->t('A ticket is parked (skipped) when its most recent runs — this many of them — are all failed and the newest changed within the retry window. Prevents a persistently-failing setup from hot-reclaim-looping.'),
      '#min' => 1,
      '#default_value' => $config->get('failed_retry_cap') ?? 3,
      '#required' => TRUE,
    ];
    $form['run']['failed_retry_window_seconds'] = [
      '#type' => 'number',
      '#title' => $this->t('Failed-run retry window (seconds)'),
      '#description' => $this->t('How long the cap parks a ticket. Once the newest failed run is older than this, the ticket becomes claimable again — self-healing, no permanent human gate.'),
      '#min' => 1,
      '#default_value' => $config->get('failed_retry_window_seconds') ?? 7200,
      '#required' => TRUE,
    ];

    return parent::buildForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $this->config(self::CONFIG)
      ->set('default_lease_seconds', (int) $form_state->getValue('default_lease_seconds'))
      ->set('max_lease_seconds', (int) $form_state->getValue('max_lease_seconds'))
      ->set('failed_retry_cap', (int) $form_state->getValue('failed_retry_cap'))
      ->set('failed_retry_window_seconds', (int) $form_state->getValue('failed_retry_window_seconds'))
      ->save();
    parent::submitForm($form, $form_state);
  }

}
