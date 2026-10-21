<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Url;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Sends a finished form submission to a page, with or without htmx.
 *
 * Core disables form redirects on htmx requests, so those navigate by the
 * HX-Location header instead.
 */
final class TicketNavigation {

  /**
   * Finishes the submission at the given page.
   */
  public static function finishAt(Url $url, FormStateInterface $form_state, Request $request): void {
    if (!$request->headers->has('HX-Request')) {
      // A rebuild would suppress the redirect.
      $form_state->setRebuild(FALSE);
      $form_state->setRedirectUrl($url);
      return;
    }
    $response = new Response('', 200, ['Content-Type' => 'text/html; charset=UTF-8']);
    foreach ((new Htmx())->locationHeader($url)->getHeaders()->all() as $name => $values) {
      foreach ((array) $values as $value) {
        $response->headers->set($name, $value);
      }
    }
    $form_state->setResponse($response);
  }

}
