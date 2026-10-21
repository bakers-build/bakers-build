<?php

declare(strict_types=1);

namespace Drupal\island\Render;

use Drupal\Component\Utility\Crypt;
use Drupal\Core\Cache\Cache;
use Drupal\Core\Controller\TitleResolverInterface;
use Drupal\Core\Messenger\MessengerInterface;
use Drupal\Core\Render\Element\StatusMessages;
use Drupal\Core\Render\HtmlResponse;
use Drupal\Core\Render\MainContent\HtmxRenderer;
use Drupal\Core\Render\RenderCacheInterface;
use Drupal\Core\Render\RenderContext;
use Drupal\Core\Render\RendererInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Symfony\Component\HttpFoundation\Request;

/**
 * Renders a route's own main content into a named hull, as a wrapper format.
 *
 * A wrapped route is an ordinary route (own path, access, form) whose main
 * content is answered inside one hull component without the page chrome.
 * Only registered formats are reachable, so the format is the allowlist. A
 * consumer registers one `render.main_content_renderer` service per placement
 * (see `island.services.yml`).
 *
 * It owns `renderResponse()` because core renders messages as a sibling of
 * the main content, outside the hull. The hull must provide the dialog
 * component's `title`/`dismissible`/`open` props and `message`/`body`/
 * `actions` slots.
 *
 * @see \Drupal\Core\EventSubscriber\MainContentViewSubscriber
 * @see \Drupal\Core\Render\MainContent\HtmxRenderer
 */
class WrappedRouteRenderer extends HtmxRenderer {

  /**
   * The render-array property a surface declares its own hull with.
   */
  public const string OWN_HULL_PROPERTY = '#island_own_hull';

  /**
   * The render-array property a surface hands its action row over in.
   *
   * Rendered in the hull footer, outside the `<form>`: a submit placed here
   * needs the HTML `form` attribute, which
   * {@see \Drupal\island\Form\WrappedDialogFormTrait::liftActionsIntoHull()}
   * stamps. A consumer filling it by hand must stamp it itself.
   */
  public const string ACTIONS_SLOT_PROPERTY = '#island_hull_actions';

  /**
   * The render-array property carrying attributes for the message region.
   *
   * Rendered on an inner element, never on the region itself; see
   * {@see messageRegion()}.
   */
  public const string MESSAGE_ATTRIBUTES_PROPERTY = '#island_hull_message_attributes';

  /**
   * The DOM id of the generic hull's message region.
   *
   * The region sits outside the form, so a refusal refreshes it through the
   * `hx-select-oob` in
   * {@see \Drupal\island\Form\WrappedDialogFormTrait::attachDialogHtmx()}.
   * An own-hull surface has no such region; htmx then skips the selection.
   */
  public const string MESSAGE_REGION_ID = 'island-dialog-message';

  /**
   * Constructs a wrapper-format renderer for one hull component.
   *
   * @param \Drupal\Core\Controller\TitleResolverInterface $titleResolver
   *   Resolves the route's title when the main content states none.
   * @param \Drupal\Core\Render\RendererInterface $renderer
   *   The renderer.
   * @param \Drupal\Core\Render\RenderCacheInterface $renderCache
   *   The render cache.
   * @param array $rendererConfig
   *   The renderer configuration, for the required cache contexts.
   * @param \Drupal\Core\Messenger\MessengerInterface $messenger
   *   The messenger, read only where a surface owns its own message slot.
   * @param string $hullComponent
   *   The SDC id of the component main content is rendered into. Stated in the
   *   service definition, never taken from the request — see the class
   *   docblock on why the format IS the allowlist.
   */
  public function __construct(
    TitleResolverInterface $titleResolver,
    RendererInterface $renderer,
    RenderCacheInterface $renderCache,
    array $rendererConfig,
    protected readonly MessengerInterface $messenger,
    protected readonly string $hullComponent,
  ) {
    parent::__construct($titleResolver, $renderer, $renderCache, $rendererConfig);
  }

  /**
   * {@inheritdoc}
   *
   * @return \Drupal\Core\Render\HtmlResponse
   *   The hulled main content as a bare htmx document.
   */
  public function renderResponse(array $main_content, Request $request, RouteMatchInterface $route_match) {
    $token = Crypt::randomBytesBase64(55);
    $title = $main_content['#title'] ?? $this->titleResolver->getTitle($request, $route_match->getRouteObject());
    $owns_hull = ($main_content[self::OWN_HULL_PROPERTY] ?? TRUE) === FALSE;
    $html = [
      '#type' => 'inline_template',
      // The document is core's, verbatim, INCLUDING the noindex meta tag: a
      // fragment answered to htmx is not a page and must not be indexed.
      '#template' => <<<HTMX_RESPONSE
<!doctype html>
<html>
<head>
<meta name="robots" content="noindex">
<title>{{ title }}</title>
<css-placeholder token="{{ placeholder_token }}">
<js-placeholder token="{{ placeholder_token }}">
<js-bottom-placeholder token="{{ placeholder_token }}">
</head>
<body>{{ content }}</body>
</html>
HTMX_RESPONSE,
      '#context' => [
        'title' => $title,
        // Unlike core: no `messages` sibling; hull() places the messages.
        'content' => $this->hull($main_content, $title),
        'placeholder_token' => $token,
      ],
    ];
    foreach (['styles' => 'css', 'scripts' => 'js', 'scripts_bottom' => 'js-bottom'] as $type => $name) {
      $html['#attached']['html_response_attachment_placeholders'][$type] = '<' . $name . '-placeholder token="' . $token . '">';
    }

    return new HtmlResponse($this->renderWithoutReplacingPlaceholders($html, $owns_hull), 200, [
      'Content-Type' => 'text/html; charset=UTF-8',
      'X-Robots-Tag' => 'noindex',
    ]);
  }

  /**
   * The main content in its hull, with the messages where the design puts them.
   *
   * A surface that declares {@see OWN_HULL_PROPERTY} FALSE has composed its
   * own hull and is returned untouched. No messenger side effect here: see
   * {@see drainStrayMessengerQueue()}.
   *
   * @param array<string, mixed> $main_content
   *   The route's own main content.
   * @param mixed $title
   *   The title the hull announces itself with.
   *
   * @return array<string, mixed>
   *   The response body's render array.
   */
  protected function hull(array $main_content, mixed $title): array {
    if (($main_content[self::OWN_HULL_PROPERTY] ?? TRUE) === FALSE) {
      return $main_content;
    }

    $slots = [
      'message' => $this->messageRegion($main_content[self::MESSAGE_ATTRIBUTES_PROPERTY] ?? []),
      'body' => $main_content,
    ];
    // CONDITIONAL, so a wrapped route that is not a form gets no footer strip
    // under nothing. An empty slot and an absent one render the same content
    // and different markup, and the markup is the part a border is drawn on.
    if (isset($main_content[self::ACTIONS_SLOT_PROPERTY])) {
      $slots['actions'] = $main_content[self::ACTIONS_SLOT_PROPERTY];
    }

    return [
      '#type' => 'component',
      '#component' => $this->hullComponent,
      '#props' => $this->hullProps($title),
      '#slots' => $slots,
    ];
  }

  /**
   * The message slot, as a region an out-of-band swap can aim at.
   *
   * The id sits on a container wrapper: a placeholdered `status_messages`
   * element loses its `#attributes`. Consumer attributes go on an inner
   * element because the swap replaces only the region's inner HTML.
   *
   * @param array<string, mixed> $attributes
   *   Attributes for an inner wrapper, or an empty array for none — in which
   *   case the messages are the region's own first child and no wrapper is
   *   rendered at all.
   *
   * @return array<string, mixed>
   *   The message region.
   */
  protected function messageRegion(array $attributes): array {
    $messages = ['#type' => 'status_messages'];
    if ($attributes !== []) {
      $messages = [
        '#type' => 'container',
        '#attributes' => $attributes,
        'messages' => $messages,
      ];
    }

    return [
      '#type' => 'container',
      '#attributes' => ['id' => self::MESSAGE_REGION_ID],
      'messages' => $messages,
    ];
  }

  /**
   * The props the hull is rendered with.
   *
   * Split out so a subclass can add one its own component declares without
   * restating the slots. `open` is stated because a hull that arrived in an
   * overlay IS the open state — the element's own attribute, never a class,
   * which is what keeps the state readable with scripts disabled — and a
   * component that does not declare it simply ignores it.
   *
   * @param mixed $title
   *   The route's title.
   *
   * @return array<string, mixed>
   *   The props.
   */
  protected function hullProps(mixed $title): array {
    return [
      // A `<dialog>` without `open` is not rendered.
      'open' => TRUE,
      // Cast rather than passed through: a component declares `title` as a
      // string prop, and a route's `_title` reaches this method as a
      // `TranslatableMarkup` object.
      'title' => (string) $title,
      // Every wrapped surface needs a way back; the dismissal behaviour is
      // this module's (`js/island.dialog.js`). A hull opts out by not
      // declaring the prop.
      'dismissible' => TRUE,
    ];
  }

  /**
   * Renders the document, leaving the attachment placeholders in place.
   *
   * Core's own dance, extracted only so `renderResponse()` above reads as the
   * one decision it actually takes. `RendererInterface::render()` rather than
   * `renderRoot()`, because `HtmlResponseAttachmentsProcessor` replaces the
   * css/js placeholders — AND resolves any `#lazy_builder` placeholder such as
   * `status_messages`'s own, via its own later `renderRoot()` call — later in
   * the pipeline; rendering the root here would close that door.
   *
   * {@see drainStrayMessengerQueue()} runs right after this render, because
   * only then are the placeholders bubbled onto `$html`.
   *
   * @param array<string, mixed> $html
   *   The document render array.
   * @param bool $ownsHull
   *   Whether the main content composed its own hull, per
   *   {@see WrappedRouteRenderer::OWN_HULL_PROPERTY} — the only case
   *   {@see drainStrayMessengerQueue()} needs to referee, because the generic
   *   hull's own `message` slot is a real `status_messages` element that
   *   drains itself the ordinary way.
   *
   * @return array<string, mixed>
   *   The cacheable render array `HtmlResponse` takes as its content.
   */
  private function renderWithoutReplacingPlaceholders(array $html, bool $ownsHull): array {
    $render_context = new RenderContext();
    $this->renderer->executeInRenderContext($render_context, function () use (&$html): void {
      $this->renderer->render($html);
    });
    $render_context->pop()->applyTo($html);
    if ($ownsHull) {
      $this->drainStrayMessengerQueue($html);
    }
    $content = $this->renderCache->getCacheableRenderArray($html);
    // Because ::render() was used and not ::renderRoot(), the response must be
    // made to vary by the required contexts by hand.
    $content['#cache']['contexts'] = Cache::mergeContexts(
      $content['#cache']['contexts'],
      $this->rendererConfig['required_cache_contexts'],
    );
    $content['#cache']['tags'][] = 'rendered';

    return $content;
  }

  /**
   * Drains a queued message an own-hull surface's own tree never claimed.
   *
   * Runs after rendering: a surface's own `status_messages` element is a
   * placeholder that drains the queue itself later, so finding one means step
   * aside. Otherwise the queue is cleared, because a form's errors are also
   * queued and would replay on the next page load. Currently only exercised
   * by a test fixture.
   *
   * @param array<string, mixed> $html
   *   The rendered document, with `#attached['placeholders']` already bubbled
   *   onto it.
   */
  private function drainStrayMessengerQueue(array $html): void {
    foreach ($html['#attached']['placeholders'] ?? [] as $placeholder) {
      $lazy_builder = $placeholder['#lazy_builder'][0] ?? NULL;
      if ($lazy_builder === StatusMessages::class . '::renderMessages') {
        return;
      }
    }
    $this->messenger->deleteAll();
  }

}
