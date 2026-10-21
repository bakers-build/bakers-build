<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Url;

/**
 * Refreshes a template target-state picker when the workflow changes.
 *
 * For forms using WrappedDialogFormTrait: the template form and the
 * create-ticket dialog of a template.
 */
trait TargetStateRefreshTrait {

  /**
   * Refreshes the target-state picker when the workflow changes.
   *
   * The picker reads its options from the submitted workflow. Without
   * JavaScript the workflow picker keeps its opening value, and an
   * unreachable state is rejected on save.
   *
   * @param array $form
   *   The form, mutated in place; ungenerified for `Htmx::applyTo()`.
   */
  private function attachTargetStateRefresh(array &$form): void {
    if (!isset($form['target_state'], $form['workflow'])) {
      return;
    }
    $form['target_state']['#attributes']['data-template-target-state'] = TRUE;

    // The picker fires `change` from its root inside the field wrapper. The
    // wrapper carries no name, so the trigger name is posted explicitly: a
    // non-button trigger runs no submit handlers and reports no errors.
    $htmx = (new Htmx())
      ->post($this->isDialogRequest() ? $this->dialogPostUrl() : Url::fromUserInput($this->getRequest()->getPathInfo()))
      ->trigger('change')
      ->vals(['_triggering_element_name' => 'workflow'])
      ->select('[data-template-target-state]')
      ->target('[data-template-target-state]')
      ->swap('outerHTML');
    if (!$this->isDialogRequest()) {
      $htmx->onlyMainContent();
    }
    $htmx->applyTo($form['workflow']);
  }

}
