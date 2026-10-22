<?php

declare(strict_types=1);

namespace Drupal\island\Form;

use Drupal\Component\Utility\UrlHelper;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Render\Element;
use Drupal\Core\Url;
use Drupal\island\Render\WrappedRouteRenderer;
use Drupal\island\IslandResponder;
use Drupal\island\IslandResponse;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Response;

/**
 * The form side of the wrapper-format round trip.
 *
 * A form reached through the dialog `_wrapper_format` posts itself back
 * through it, refuses a foreign landing url and answers a successful write
 * with a header instead of a redirect. A trait so entity forms can use it;
 * {@see WrappedDialogFormBase} covers other forms. Requires `getRequest()` and
 * `getFormId()`.
 *
 * @see \Drupal\island\Render\WrappedRouteRenderer
 */
trait WrappedDialogFormTrait {

  /**
   * Converts a completed dialog's island intents into a fragment response.
   */
  protected IslandResponder $islandResponder;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->islandResponder = $container->get('island.responder');
    return $form;
  }

  /**
   * Island intents after saving; NULL uses the normal return navigation.
   */
  protected function dialogResponse(): ?IslandResponse {
    return NULL;
  }

  /**
   * The query parameter core reads to pick a main-content renderer.
   *
   * A literal rather than `MainContentViewSubscriber::WRAPPER_FORMAT` to keep
   * the coupling count down; the value is part of core's public url contract.
   */
  protected const string WRAPPER_FORMAT_PARAMETER = '_wrapper_format';

  /**
   * The registered `_wrapper_format` that answers with the dialog hull.
   *
   * Registered in `island.services.yml` against `island:dialog`; a richer hull
   * is an SDC `replaces` override. A second placement overrides
   * {@see dialogFormat()}, because PHP cannot override a trait constant.
   */
  protected const string DIALOG_FORMAT = 'island_dialog';

  /**
   * The query parameter carrying the screen this dialog was opened over.
   *
   * Core's `destination`: a wrapped route has its own url, so the trigger
   * writes the originating screen here, and a no-JavaScript submit's
   * `RedirectResponse` already honours it.
   */
  protected const string RETURN_PARAMETER = 'destination';

  /**
   * The suffix core's htmx-form heuristic requires of a dialog form's id.
   *
   * Drupal's own convention, on which core keys behaviour; see
   * {@see attachDialogHtmx()} and {@see refuseForeignFormId()}.
   */
  private const string FORM_ID_SUFFIX = '_form';

  /**
   * The element types that need a form owner once they leave the form.
   *
   * Form API's submitting elements; links in the row belong to no form.
   *
   * @see \Drupal\island\Form\WrappedDialogFormTrait::liftActionsIntoHull()
   */
  private const array FORM_OWNING_TYPES = ['submit', 'button', 'image_button'];

  /**
   * The wrapper format this form answers through.
   *
   * The override point: PHP refuses a class that redeclares a constant of a
   * trait it uses, so {@see DIALOG_FORMAT} is only the default.
   *
   * @return string
   *   The registered `_wrapper_format` value.
   */
  protected function dialogFormat(): string {
    return static::DIALOG_FORMAT;
  }

  /**
   * Whether this request is being answered through the dialog wrapper format.
   *
   * Read off the query: the same route answers a plain page without
   * JavaScript.
   */
  protected function isDialogRequest(): bool {
    return $this->getRequest()->query->get(static::WRAPPER_FORMAT_PARAMETER) === $this->dialogFormat();
  }

  /**
   * Wires the form to post itself into the overlay, on a dialog request ONLY.
   *
   * Off the format (no JavaScript) the form submits the ordinary way. The
   * post url carries the format because `FormBuilder::buildFormAction()`
   * strips it. The form targets itself and its id ends in `-form`, so core
   * keeps the rebuilt build id in the main swap; `hx-select` needs `#id` and is
   * therefore set in an `#after_build`; the message region, outside the form,
   * is refreshed via `hx-select-oob`. The form must be the last element the
   * response settles.
   *
   * @param array $form
   *   The built form, mutated in place. Left ungenerified: `Htmx::applyTo()`
   *   takes an untyped array by reference, which phpstan widens.
   */
  protected function attachDialogHtmx(array &$form): void {
    if (!$this->isDialogRequest()) {
      return;
    }
    $this->refuseForeignFormId();
    (new Htmx())
      ->post($this->dialogPostUrl())
      // Stated: the overlay container's inherited `hx-target="this"` would
      // defeat core's whole-form heuristic.
      ->target('this')
      ->swap('outerHTML')
      ->sync('this:drop')
      ->selectOob('#' . WrappedRouteRenderer::MESSAGE_REGION_ID . ':innerHTML')
      ->applyTo($form);
    $form['#after_build'][] = '::selectThisForm';
    $form['#after_build'][] = '::liftActionsIntoHull';
    // Guards against `hx-select` matching nothing (e.g. an expired session).
    $form['#attached']['library'][] = 'island/dialog_form';
  }

  /**
   * Hands the form's action row to the hull, and tells it which form it is.
   *
   * The row belongs in the hull's footer and outside the form's swap. Moved
   * buttons get the HTML `form` attribute, which htmx honours; the row is
   * unset, not copied. Runs as the last `#after_build` so consumer callbacks
   * can still address `$form['actions']`.
   *
   * @param array $element
   *   The finished form; ungenerified, see {@see attachDialogHtmx()}.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state. Unused: which controls move is a property of the built
   *   form, not of any submitted value.
   *
   * @return array
   *   The same form, with its action row handed over to the hull.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function liftActionsIntoHull(array $element, FormStateInterface $form_state): array {
    if (!isset($element['actions'])) {
      return $element;
    }
    foreach (Element::children($element['actions']) as $key) {
      if (in_array($element['actions'][$key]['#type'] ?? '', self::FORM_OWNING_TYPES, TRUE)) {
        $element['actions'][$key]['#attributes']['form'] = $element['#id'];
      }
    }
    $element[WrappedRouteRenderer::ACTIONS_SLOT_PROPERTY] = $element['actions'];
    unset($element['actions']);

    return $element;
  }

  /**
   * Selects the form back out of the hull it is answered inside.
   *
   * An `#after_build` because `#id` exists only after `prepareForm()`. Read
   * off `#id`: recomputing `Html::getUniqueId()` would yield a `--2` suffix.
   *
   * @param array $element
   *   The finished form; ungenerified, see {@see attachDialogHtmx()}.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state. Unused: the selector is a property of what
   *   `prepareForm()` just built, not of any submitted value.
   *
   * @return array
   *   The same form, carrying its own selection.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function selectThisForm(array $element, FormStateInterface $form_state): array {
    (new Htmx())->select('form#' . $element['#id'])->applyTo($element);
    return $element;
  }

  /**
   * Refuses a form id whose rendered id core's heuristic will not recognise.
   *
   * Loud because the failure is silent otherwise: the dialog cannot be
   * submitted a second time. Checks the form id, not `#id`, which gains a
   * `--2` suffix on repeat renders.
   */
  private function refuseForeignFormId(): void {
    $form_id = $this->getFormId();
    if (!str_ends_with($form_id, self::FORM_ID_SUFFIX)) {
      throw new \LogicException(sprintf(
        'The dialog form "%s" must have an id ending in "%s": core keys its htmx-form handling on the "-form" suffix of the rendered id (FormBuilder.php:781-791), and a form breaking that convention cannot be submitted twice.',
        $form_id,
        self::FORM_ID_SUFFIX,
      ));
    }
  }

  /**
   * The url this form posts itself to, WITH the wrapper format on it.
   *
   * Without the format a refusal would come back as a whole page.
   */
  protected function dialogPostUrl(): Url {
    $request = $this->getRequest();
    $path = $request->getPathInfo();
    $query = $this->operatorQuery($request->query->all());
    $query[static::WRAPPER_FORMAT_PARAMETER] = $this->dialogFormat();
    return Url::fromUserInput($path === '' ? '/' : $path, ['query' => $query]);
  }

  /**
   * The screen this dialog was opened over.
   *
   * It is a ghost `Cancel`'s target and where a successful write lands.
   *
   * The `destination` the trigger wrote. Anything but a root-relative path
   * answers the front page (open redirect). The wrapper format and core's
   * `ajax_page_state` keys are stripped, or the landing page arrives without
   * its shell or its assets.
   */
  protected function returnUrl(): Url {
    $destination = (string) $this->getRequest()->query->get(static::RETURN_PARAMETER, '');
    if ($destination === '' || !str_starts_with($destination, '/') || str_starts_with($destination, '//')
      || UrlHelper::isExternal($destination)) {
      return Url::fromRoute('<front>');
    }
    $parsed = UrlHelper::parse($destination);
    $parsed['query'] = $this->operatorQuery($parsed['query']);
    unset($parsed['query'][static::WRAPPER_FORMAT_PARAMETER]);
    return Url::fromUserInput($parsed['path'], [
      'query' => $parsed['query'],
      'fragment' => $parsed['fragment'],
    ]);
  }

  /**
   * Finishes a successful write with island intents or return navigation.
   *
   * Plain forms redirect. Dialogs with intents update subscribed islands and
   * close their hull; other dialogs keep the existing HX-Location navigation.
   */
  protected function respondAtReturnUrl(FormStateInterface $form_state): void {
    $return = $this->returnUrl();
    if (!$this->isDialogRequest()) {
      $form_state->setRedirectUrl($return);
      return;
    }
    $intent = $this->dialogResponse();
    if ($intent !== NULL) {
      $form_state->setResponse($this->islandResponder->toDialogResponse($intent, $this->getRequest()));
      return;
    }
    $response = new Response('', 200, ['Content-Type' => 'text/html; charset=UTF-8']);
    foreach ((new Htmx())->locationHeader($return)->getHeaders()->all() as $name => $values) {
      foreach ((array) $values as $value) {
        $response->headers->set($name, $value);
      }
    }
    $form_state->setResponse($response);
  }

  /**
   * The request's query with core's own htmx transport keys taken out.
   *
   * `htmx-assets.js` adds `ajax_page_state[...]` to every GET; copied into
   * `hx-post` they would grow by a round trip each time.
   *
   * @param array<string, mixed> $query
   *   The request's query.
   *
   * @return array<string, mixed>
   *   The query the operator's own navigation is made of.
   */
  private function operatorQuery(array $query): array {
    unset($query['ajax_page_state'], $query['_triggering_element_name'], $query['_triggering_element_value']);
    return $query;
  }

}
