<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Render\HtmlResponse;
use Drupal\Core\Routing\RouteMatch;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\Routing\Route;

/**
 * The `island_dialog` placement, asserted against the REAL, THEMED hull.
 *
 * BB-420 Task 24 replaced the create dialog's island hosting with a
 * registered wrapper format. The MECHANISM is generic and lives in the `island`
 * module — `WrappedRouteRendererTest` covers it there against a fixture hull.
 * What this file covers is the PRODUCT half, and it is not a duplicate of
 * that:
 *
 * - THE REGISTRATION. Core's `MainContentViewSubscriber` resolves
 *   `_wrapper_format` against the `main_content_renderers` container parameter
 *   and falls back to `html` for anything it does not find, so naming the hull
 *   AS the format is what keeps an untrusted request from choosing an arbitrary
 *   component. A typo in the tag degrades silently to a full HTML page; the
 *   first case is what makes that a red test instead. THE REGISTRATION ITSELF
 *   IS `island`'s OWN (`main_content_renderer.island_dialog`,
 *   `island.services.yml`) — BB-420 Task 36 deleted bb_core's
 *   `main_content_renderer.bb_dialog`, the second registration of the same
 *   class the review objected to, once `bb_theme:dialog` started declaring
 *   `replaces: island:dialog` instead.
 * - THE HULL'S REAL SHAPE. SDC silently DROPS props and slots a component does
 *   not declare — HTTP 200, correct chrome, empty body, no warning anywhere —
 *   so "the renderer passes `title` and `body`" proves nothing about
 *   `bb_theme:dialog` specifically. These cases render that component —
 *   THROUGH `island`'s format, never bb_core's own, which is exactly what
 *   proves the `replaces` override actually negotiates: `island:dialog` is
 *   the hull `island.services.yml` names, and what these assertions see
 *   rendered is `bb_theme:dialog`.
 * - THE DESIGN RULE. `dialog.component.yml` puts `message` above `body` so a
 *   refusal appears where the writer is looking, and the third case asserts the
 *   ORDER on rendered bytes — the failure it guards against (core's
 *   `status_messages` as a SIBLING of the hull, measured on the feasibility
 *   spike at byte 69 with the `<dialog>` opening at 875) renders the same
 *   strings in the wrong place and would pass a mere presence assertion.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbDialogWrapperFormatTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'island', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installConfig(['system', 'filter']);
    // The hull is one of the THEME's components, so the theme has to be
    // installed and active for any of this to render at all — the same setup
    // `TicketCreateDialogRenderTest` states for the same reason.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
  }

  /**
   * The format is registered, which is what makes it an allowlist entry.
   *
   * `MainContentRenderersPass` collects every service tagged
   * `render.main_content_renderer` into this parameter, keyed by the tag's
   * `format`. A format that is not in here degrades to a full HTML page rather
   * than fataling, so this assertion is what tells "the dialog format works"
   * apart from "the request silently fell back to `html`".
   */
  public function testTheDialogFormatIsRegisteredAsMainContentRenderer(): void {
    $renderers = $this->container->getParameter('main_content_renderers');
    self::assertIsArray($renderers);

    self::assertArrayHasKey('island_dialog', $renderers);
    self::assertSame('main_content_renderer.island_dialog', $renderers['island_dialog']);
  }

  /**
   * Main content that owns no hull gets one, with its own title.
   */
  public function testMainContentIsRenderedIntoTheDialogHull(): void {
    $html = $this->renderThroughFormat(['#markup' => '<p class="probe">Body</p>', '#title' => 'New ticket']);

    self::assertStringContainsString('data-component-id="bb_theme:dialog"', $html);
    self::assertStringContainsString('New ticket', $html);
    self::assertStringContainsString('<p class="probe">Body</p>', $html);
    // The shell chrome is what the format exists to leave out: the response is
    // swapped into ONE target inside a page that already has its shell.
    self::assertStringNotContainsString('shell__', $html);
  }

  /**
   * A refusal reaches the hull's `message` slot, ABOVE the body.
   *
   * The design rule is `dialog.component.yml`'s own: `message` renders above
   * `body` "so a refusal appears where the writer is looking". Asserted on
   * byte offsets, because the failure this guards against — core's
   * `status_messages` placed as a SIBLING of the hull — renders the same
   * strings in the wrong place and would pass a mere `assertStringContains`.
   */
  public function testRefusalRendersInsideTheHullAboveTheBody(): void {
    $this->container->get('messenger')->addError('This value should not be null.');

    $html = $this->renderThroughFormat(['#markup' => '<p class="probe">Body</p>', '#title' => 'New ticket']);

    $message_slot = strpos($html, 'dialog__message');
    $body_slot = strpos($html, 'dialog__body');
    $refusal = strpos($html, 'This value should not be null.');
    $hull = strpos($html, '<dialog');
    self::assertIsInt($message_slot, 'The hull rendered no message slot.');
    self::assertIsInt($body_slot);
    self::assertIsInt($refusal);
    self::assertIsInt($hull);
    self::assertGreaterThan($hull, $refusal, 'The refusal rendered OUTSIDE the hull.');
    self::assertGreaterThan($message_slot, $refusal);
    self::assertLessThan($body_slot, $refusal, 'The refusal rendered below the body.');
  }

  /**
   * Renders one main content through the dialog wrapper format.
   *
   * THE ATTACHMENTS PROCESSOR IS PART OF THE ANSWER, not test scaffolding.
   * `status_messages` is a placeholdered element — `StatusMessages::getInfo()`
   * turns it into a `#lazy_builder` with `#create_placeholder` — and a main
   * content renderer deliberately calls `RendererInterface::render()` rather
   * than `renderRoot()`, so what it returns still carries the token. The real
   * pipeline replaces it in `HtmlResponseAttachmentsProcessor`, reached from
   * `HtmlResponseSubscriber`; a test that read the raw content instead would
   * report an empty message slot for a response that renders correctly over
   * HTTP.
   *
   * @param array<string, mixed> $main_content
   *   The main content the format is asked to answer with.
   */
  private function renderThroughFormat(array $main_content): string {
    $request = Request::create('/probe', 'GET', ['_wrapper_format' => 'island_dialog']);
    // The messenger stores its queue on the session, so a request without one
    // cannot be the vehicle for the two cases that read it.
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $route_match = new RouteMatch('bb_core.probe', new Route('/probe'));
    $response = $this->container->get('main_content_renderer.island_dialog')
      ->renderResponse($main_content, $request, $route_match);
    $processed = $this->container->get('html_response.attachments_processor')
      ->processAttachments($response);
    // Narrowed: the processor is typed to `AttachmentsInterface`, which has no
    // `getContent()`. It answers with the response it was handed.
    self::assertInstanceOf(HtmlResponse::class, $processed);

    return (string) $processed->getContent();
  }

}
