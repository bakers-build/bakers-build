<?php

declare(strict_types=1);

namespace Drupal\island_test\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Symfony\Component\HttpFoundation\Response;

/**
 * A plain form whose successful submit answers with its own empty response.
 *
 * The fixture for `WrappedRouteRendererTest`'s regression on BB-420 Task 32.
 * A response set on form state via `FormStateInterface::setResponse()` ends
 * the request directly: `FormBuilder::processForm()` throws
 * `EnforcedResponseException` the moment it sees one, which unwinds through
 * `kernel.exception` rather than `kernel.view` — so `MainContentViewSubscriber`
 * is never asked, and no registered wrapper format, this module's own default
 * hull included, is ever reached. This is the same shape
 * `BbTicketCreateForm` answers a successful ticket-create save with, and it
 * is why introducing `island:dialog` as the module's default hull cannot
 * start wrapping that response: the bypass happens one layer below where a
 * wrapper format is ever consulted.
 */
final class BypassFormatForm extends FormBase {

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'island_test_bypass_format_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $form['actions']['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Go'),
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $form_state->setResponse(new Response(''));
  }

}
