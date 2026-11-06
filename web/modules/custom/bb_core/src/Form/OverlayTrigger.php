<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Component\Utility\UrlHelper;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Url;
use Drupal\bb_core\Plugin\UiPatterns\Source\CreateActionSourceBase;
use Symfony\Component\HttpFoundation\Request;

/**
 * Opens a wrapped route as the dialog in the shell's overlay.
 *
 * The trigger keeps its plain `href` for a browser without JavaScript; these
 * htmx attributes fetch the same route through the dialog format instead.
 */
final class OverlayTrigger {

  /**
   * The DOM id of the shell region a dialog is swapped into.
   */
  public const string TARGET_ID = CreateActionSourceBase::TARGET_ID;

  /**
   * Only the outermost dialog of the answer: a form may nest its own.
   */
  public const string SELECT = 'dialog:not(dialog dialog)';

  /**
   * The htmx attributes that open a route's dialog over the current screen.
   *
   * @param \Drupal\Core\Url $url
   *   The route the dialog lives at.
   * @param \Symfony\Component\HttpFoundation\Request|null $request
   *   The request being answered; the current one when NULL.
   *
   * @return array<string, mixed>
   *   The attributes for the trigger element.
   */
  public static function attributes(Url $url, ?Request $request = NULL): array {
    $request ??= \Drupal::request();
    $dialog = clone $url;
    $dialog->setOption('attributes', []);
    $dialog->setOption('query', [
      'destination' => self::underneath($request),
      '_wrapper_format' => 'island_dialog',
    ] + ($url->getOption('query') ?: []));
    return (new Htmx())
      ->get($dialog)
      ->target('#' . self::TARGET_ID)
      ->select(self::SELECT)
      ->swap('innerHTML')
      ->getAttributes()
      ->toArray();
  }

  /**
   * The screen a dialog opened from this request shows over.
   *
   * Inside a dialog that is the screen the dialog itself was opened over, so
   * a dialog replacing it closes to the same page.
   */
  public static function underneath(Request $request): string {
    $destination = $request->query->get('destination');
    if ($request->query->get('_wrapper_format') === 'island_dialog' && is_string($destination)
      && str_starts_with($destination, '/') && !str_starts_with($destination, '//')) {
      return $destination;
    }
    $query = $request->query->all();
    unset($query['destination'], $query['_wrapper_format'], $query['ajax_page_state'], $query['_triggering_element_name'], $query['_triggering_element_value']);
    $path = $request->getPathInfo() === '' ? '/' : $request->getPathInfo();
    return $query === [] ? $path : $path . '?' . UrlHelper::buildQuery($query);
  }

}
