<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\island\Form\WrappedDialogFormTrait;
use Symfony\Component\HttpFoundation\Response;

/**
 * A delete confirm form answered as the dialog over the current page.
 *
 * On the dialog format the form posts back into the overlay, Cancel closes
 * to the screen underneath (`destination`) and a confirmed delete lands where
 * the form redirects anyway, never on `destination`: the screen underneath is
 * often the deleted entity's own page. Off the format it is the ordinary page.
 */
trait DeleteDialogFormTrait {

  use WrappedDialogFormTrait;

  /**
   * Wires a built confirm form into the dialog, on a dialog request only.
   *
   * @param array $form
   *   The built form with its `actions`; ungenerified like
   *   {@see WrappedDialogFormTrait::attachDialogHtmx()}.
   */
  protected function attachDeleteDialog(array &$form): void {
    if (!$this->isDialogRequest()) {
      return;
    }
    // The page path's native round trip; the dialog posts through htmx.
    unset($form['#attributes']['data-hx-boost']);
    $confirmable = ($form['actions']['submit']['#access'] ?? TRUE) !== FALSE;
    $form['actions']['cancel'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#props' => [
        'variant' => 'ghost',
        'label' => (string) ($confirmable ? new TranslatableMarkup('Cancel') : new TranslatableMarkup('Close')),
        'href' => $this->returnUrl()->toString(),
        'attributes' => new Attribute(['data-dialog-cancel' => 'data-dialog-cancel']),
      ],
      '#weight' => -10,
    ];
    if (isset($form['actions']['submit'])) {
      $handlers = $form['actions']['submit']['#submit'] ?? ['::submitForm'];
      $form['actions']['submit']['#submit'] = [...$handlers, '::landAfterDelete'];
      $form['actions']['submit']['#theme_wrappers'] = ['input__submit__bb_button'];
    }
    $this->attachDialogHtmx($form);
    if (!$confirmable && $this->getRequest()->isMethod('POST')) {
      // Blocked since it opened: the whole dialog swaps, footer included.
      (new Htmx())
        ->retargetHeader('#' . OverlayTrigger::TARGET_ID)
        ->reselectHeader(OverlayTrigger::SELECT)
        ->reswapHeader('innerHTML')
        ->applyTo($form);
    }
  }

  /**
   * Answers a confirmed dialog with the form's own redirect, via HX-Location.
   *
   * @param array $form
   *   The form; unused.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state carrying the redirect the submit handler set.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function landAfterDelete(array &$form, FormStateInterface $form_state): void {
    $redirect = $form_state->getRedirect();
    if (!$this->isDialogRequest() || !$redirect instanceof Url || $form_state->isRebuilding()) {
      return;
    }
    $response = new Response('', 200, ['Content-Type' => 'text/html; charset=UTF-8']);
    $response->headers->add((new Htmx())->locationHeader($redirect)->getHeaders()->all());
    $form_state->setResponse($response);
  }

}
