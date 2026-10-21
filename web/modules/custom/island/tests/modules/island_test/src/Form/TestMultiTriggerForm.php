<?php

declare(strict_types=1);

namespace Drupal\island_test\Form;

use Drupal\Core\Form\FormStateInterface;
use Drupal\island\Form\IslandFormBase;
use Drupal\island\IslandInterface;
use Drupal\island\IslandResponse;
use Drupal\island_test\FormHostProvider;

/**
 * Kernel test form reproducing BB-435's non-primary-trigger defect class.
 *
 * ONE required `entity_autocomplete` (the "primary" control, matching
 * `GroupMembersForm`'s account field) plus one per-item "mark" trigger,
 * rendered as raw markup rather than a Form API element — a template renders
 * it once, the way a component's own markup does, so `getTriggeringElement()`
 * cannot see it and `pressedPrefixed()` has to read the raw request instead.
 *
 * `entity_autocomplete` attaches its own `#element_validate` unconditionally,
 * so submitting the "mark" trigger while `account` holds unresolved text
 * refuses the whole form UNLESS something strips that validator first — which
 * is exactly what `suppressElementValidation()` is for. This form calls it
 * only when a "mark" trigger fired, so a test can submit BOTH ways and see
 * both outcomes.
 */
final class TestMultiTriggerForm extends IslandFormBase {

  /**
   * The per-item trigger name prefix: `mark_<id>`.
   */
  public const MARK_PREFIX = 'mark_';

  /**
   * {@inheritdoc}
   */
  protected function buildIslandForm(array $form, FormStateInterface $form_state, IslandInterface $island): array {
    $form['account'] = [
      '#type' => 'entity_autocomplete',
      '#target_type' => 'user',
      '#title' => $this->t('Account'),
      '#required' => TRUE,
    ];
    if ($this->pressedPrefixed($form_state, [self::MARK_PREFIX]) !== NULL) {
      $this->suppressElementValidation($form['account']);
    }
    // The per-item control: raw markup, not a Form API element — the shape
    // BB-435's rendered picker/remove cells share, and the reason
    // `pressedPrefixed()` reads raw input instead of `getTriggeringElement()`.
    $form['mark_1'] = [
      '#markup' => '<button type="submit" name="mark_1" value="1">Mark 1</button>',
    ];
    $form['actions']['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Add'),
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  protected function submitIslandForm(array $form, FormStateInterface $form_state, IslandInterface $island): IslandResponse {
    $pressed = $this->pressedPrefixed($form_state, [self::MARK_PREFIX]);
    $host = $this->hostResolver->resolve('forms');
    if ($host instanceof FormHostProvider) {
      $host->record($pressed !== NULL ? 'marked:' . $pressed[1] : 'added:' . (string) $form_state->getValue('account'));
    }
    return IslandResponse::make()->rebuildSelf();
  }

}
