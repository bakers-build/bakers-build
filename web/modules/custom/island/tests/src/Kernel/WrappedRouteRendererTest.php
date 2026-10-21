<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\Core\Form\EnforcedResponseException;
use Drupal\Core\Form\FormState;
use Drupal\Core\Render\HtmlResponse;
use Drupal\Core\Routing\RouteMatch;
use Drupal\KernelTests\KernelTestBase;
use Drupal\island\Render\WrappedRouteRenderer;
use Drupal\island_test\Form\BypassFormatForm;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\Routing\Route;

/**
 * A wrapper format renders a route's main content into a named hull.
 *
 * THE FORMAT IS THE ALLOWLIST, and the first case is a positive assertion of
 * that rather than a comment: core's `MainContentViewSubscriber` resolves
 * `_wrapper_format` against the `main_content_renderers` container parameter
 * and falls back to `html` for anything it does not find, so the hulls a
 * request may ask for are the REGISTERED FORMATS and nothing else. The fixture
 * module registers one the way any consumer does — a service tag, with the hull
 * component as the last constructor argument — which also proves the hull is
 * configuration and not something the class knows.
 *
 * THE SECOND CASE IS THE DEFECT THIS CLASS EXISTS FOR.
 * `HtmxRenderer::renderResponse()` places `status_messages` as a SIBLING of the
 * main content, so a subclass that hulls only the content and delegates the
 * rest renders a refusal OUTSIDE the surface it is about — with a green 200.
 * The order is asserted on rendered bytes, because the failure renders the same
 * strings in the wrong place.
 */
#[Group('island')]
final class WrappedRouteRendererTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = ['system', 'user', 'island', 'island_test'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installConfig(['system']);
  }

  /**
   * A service tag is the whole registration.
   */
  public function testTheFormatIsRegisteredFromItsServiceTag(): void {
    $renderers = $this->container->getParameter('main_content_renderers');
    self::assertIsArray($renderers);

    self::assertArrayHasKey('island_test_hull', $renderers);
    self::assertSame('main_content_renderer.island_test_hull', $renderers['island_test_hull']);
  }

  /**
   * Main content that owns no hull gets the one the service named.
   */
  public function testMainContentRendersInDismissibleHullWithoutActions(): void {
    $html = $this->renderThroughFormat(['#markup' => '<p class="probe">Body</p>', '#title' => 'Wrapped']);

    self::assertStringContainsString('class="test-hull"', $html);
    self::assertStringContainsString('Wrapped', $html);
    self::assertStringContainsString('<p class="probe">Body</p>', $html);
    self::assertStringContainsString('class="test-hull__close"', $html);
    self::assertStringContainsString('data-dialog-close', $html);
    self::assertStringNotContainsString('test-hull__actions', $html);
  }

  /**
   * A queued message reaches the hull's message slot, ABOVE the body.
   */
  public function testQueuedMessageRendersInsideTheHullAboveTheBody(): void {
    $this->container->get('messenger')->addError('This value should not be null.');

    $html = $this->renderThroughFormat(['#markup' => '<p class="probe">Body</p>', '#title' => 'Wrapped']);

    $hull = strpos($html, 'class="test-hull"');
    $message_slot = strpos($html, 'test-hull__message');
    $body_slot = strpos($html, 'test-hull__body');
    $refusal = strpos($html, 'This value should not be null.');
    self::assertIsInt($hull);
    self::assertIsInt($message_slot);
    self::assertIsInt($body_slot);
    self::assertIsInt($refusal, 'The message never reached the response.');
    self::assertGreaterThan($hull, $refusal, 'The message rendered OUTSIDE the hull.');
    self::assertGreaterThan($message_slot, $refusal);
    self::assertLessThan($body_slot, $refusal, 'The message rendered below the body.');
  }

  /**
   * The message slot carries an ADDRESS, because it is swapped on its own.
   *
   * WHY A REGION AND NOT JUST A SLOT. The form side of this format replaces
   * only the `<form>` on a refusal — core's own htmx form shape, which is what
   * keeps the rebuilt `form_build_id` inside the main swap — and the generic
   * hull puts its `message` slot OUTSIDE that form. So the messages are not in
   * the main swap and have to be reachable by id, which is what
   * {@see \Drupal\island\Form\WrappedDialogFormTrait::attachDialogHtmx()}'s
   * `hx-select-oob` names.
   *
   * THE ID IS ON A WRAPPER AND NOT ON THE `status_messages` ELEMENT ITSELF, and
   * that is a placeholder fact rather than a style choice: a
   * `#type: status_messages` element is placeholdered, and
   * `Renderer::createPlaceholder()` keeps only `#lazy_builder`, `#cache` and
   * `#preserve` — every attribute, prefix and suffix on the element is dropped
   * on the way. A wrapper survives because the placeholdering happens on its
   * child.
   */
  public function testTheHullsMessageSlotIsAddressable(): void {
    $this->container->get('messenger')->addError('This value should not be null.');

    $html = $this->renderThroughFormat(['#markup' => '<p class="probe">Body</p>']);

    $region = strpos($html, 'id="' . WrappedRouteRenderer::MESSAGE_REGION_ID . '"');
    self::assertIsInt($region, 'The message slot carries no id for an out-of-band swap to aim at.');
    self::assertLessThan(
      strpos($html, 'This value should not be null.'),
      $region,
      'The message rendered outside the region that is supposed to hold it.',
    );
  }

  /**
   * A declared action row is rendered into the hull's own footer.
   *
   * WHY THE HULL AND NOT THE MAIN CONTENT. A wrapped route whose main content
   * is a FORM has its action row inside that form, and the form is all a
   * refusal's main swap replaces — so a row rendered there is re-swapped on
   * every round trip while the hull's own footer, the placement a dialog
   * design asks for, stays empty. The renderer therefore takes the row as a
   * declared property and puts it where the hull says a footer is.
   *
   * THE ROW LANDS BELOW THE BODY, which is the whole point of it being a
   * footer, so the order is asserted on byte offsets rather than presence: a
   * hull that rendered the row above the fields would pass a presence check
   * and be wrong.
   */
  public function testDeclaredActionRowIsRenderedIntoTheHullsFooter(): void {
    $html = $this->renderThroughFormat([
      '#markup' => '<p class="probe">Body</p>',
      '#title' => 'Wrapped',
      WrappedRouteRenderer::ACTIONS_SLOT_PROPERTY => [
        '#type' => 'html_tag',
        '#tag' => 'button',
        '#attributes' => ['class' => ['probe-submit']],
        '#value' => 'Save',
      ],
    ]);

    $body = strpos($html, 'test-hull__body');
    $footer = strpos($html, 'test-hull__actions');
    $submit = strpos($html, 'probe-submit');
    self::assertIsInt($body);
    self::assertIsInt($footer, 'The hull rendered no footer for the declared row.');
    self::assertIsInt($submit, 'The declared action row never reached the response.');
    self::assertGreaterThan($body, $footer, 'The footer rendered above the body.');
    self::assertGreaterThan($footer, $submit);
  }

  /**
   * Declared message attributes land INSIDE the region, never on its wrapper.
   *
   * AND THAT IS AN OUT-OF-BAND FACT RATHER THAN A STYLE CHOICE. The form side
   * of this format updates the region with `hx-select-oob` naming
   * `#<region>:innerHTML` — the region's CONTENT, because the region wrapper
   * itself is the anchor the swap aims at and must survive it. So an
   * attribute written on the wrapper is the one the OPENING GET rendered and
   * is never updated by a refusal: a surface that hangs a per-request hook
   * there (a consumer's "which field is this message about", for a live
   * retirement) would read a stale field name for the rest of the dialog's
   * life. Inside the region it arrives with each response.
   *
   * ASSERTED AS "the attribute is on an element the region CONTAINS", with a
   * pattern rather than two offsets, because ordering alone cannot tell the
   * wrapper's own attribute list from an inner element's.
   */
  public function testDeclaredMessageAttributesLandInsideTheRegion(): void {
    $this->container->get('messenger')->addError('This value should not be null.');

    $html = $this->renderThroughFormat([
      '#markup' => '<p class="probe">Body</p>',
      '#title' => 'Wrapped',
      WrappedRouteRenderer::MESSAGE_ATTRIBUTES_PROPERTY => ['data-probe-message-for' => 'title'],
    ]);

    self::assertMatchesRegularExpression(
      '#id="' . preg_quote(WrappedRouteRenderer::MESSAGE_REGION_ID, '#') . '"[^>]*>\s*<[a-z]+[^>]*data-probe-message-for="title"#',
      $html,
      'The declared attributes must sit on an element the region contains, not on the region itself.',
    );
    self::assertStringContainsString('This value should not be null.', $html);
  }

  /**
   * No declared attributes, no inner wrapper — the region is bare.
   *
   * Guards the case above against an unconditional wrapper: a surface with no
   * per-request hook to hang gets the region and its messages and nothing
   * between them.
   */
  public function testUndeclaredMessageHookLeavesTheRegionBare(): void {
    $this->container->get('messenger')->addError('This value should not be null.');

    $html = $this->renderThroughFormat(['#markup' => '<p class="probe">Body</p>']);

    // `data-drupal-messages` and not a class, measured against the render
    // rather than guessed: core's `status-messages.html.twig` wraps the lot in
    // `<div data-drupal-messages>` and the classes are on elements inside it.
    self::assertMatchesRegularExpression(
      '#id="' . preg_quote(WrappedRouteRenderer::MESSAGE_REGION_ID, '#') . '"[^>]*>\s*<div[^>]*data-drupal-messages#',
      $html,
      'With nothing declared the messages are the region\'s own first child.',
    );
  }

  /**
   * A surface that owns its hull is not wrapped in a second one.
   */
  public function testSurfaceThatOwnsItsHullIsNotWrappedAgain(): void {
    $html = $this->renderThroughFormat([
      '#markup' => '<div class="own-hull"></div>',
      '#title' => 'Wrapped',
      WrappedRouteRenderer::OWN_HULL_PROPERTY => FALSE,
    ]);

    self::assertStringContainsString('class="own-hull"', $html);
    self::assertStringNotContainsString('class="test-hull"', $html);
  }

  /**
   * …and core's queued copy of its message is drained rather than replayed.
   *
   * Such a surface has already put every registered error into its own hull.
   * `FormErrorHandler` pushed a copy at the messenger on the way through, and a
   * queued message outlives its response: left there it is shown on the next
   * full page load, describing a form that no longer exists.
   */
  public function testTheOwnedHullDrainsTheQueuedCopy(): void {
    $messenger = $this->container->get('messenger');
    $messenger->addError('This value should not be null.');

    $html = $this->renderThroughFormat([
      '#markup' => '<div class="own-hull"></div>',
      '#title' => 'Wrapped',
      WrappedRouteRenderer::OWN_HULL_PROPERTY => FALSE,
    ]);

    self::assertStringNotContainsString('This value should not be null.', $html);
    self::assertSame([], $messenger->all(), 'The queued copy survived the response.');
  }

  /**
   * An own-hull surface that renders its OWN `status_messages` still shows it.
   *
   * BB-420 Task 35 (fix). This is the defect
   * `testTheOwnedHullDrainsTheQueuedCopy` above did not catch, because its
   * fixture never renders a `status_messages` element of its own — it only
   * proves the STRAY copy is gone. `hull()`'s
   * own-hull branch used to call `Messenger::deleteAll()` eagerly, before this
   * main content was ever rendered, which always beat THIS element's own
   * `#lazy_builder` placeholder to the queue: the surface queued the very
   * error it exists to show, and lost the race to see it. This fixture nests a
   * real `status_messages` element inside main content — the same shape
   * `BbTicketCreateForm`'s `#dialog_errors` takes — the way the fixture
   * above deliberately does not.
   */
  public function testOwnHullSurfaceRendersItsOwnQueuedMessage(): void {
    $this->container->get('messenger')->addError('This value should not be null.');

    $html = $this->renderThroughFormat([
      '#type' => 'container',
      'errors' => ['#type' => 'status_messages'],
      '#title' => 'Wrapped',
      WrappedRouteRenderer::OWN_HULL_PROPERTY => FALSE,
    ]);

    self::assertStringContainsString('This value should not be null.', $html, 'The surface\'s own message never rendered.');
    self::assertSame([], $this->container->get('messenger')->all(), 'The message must not be replayed on the next page.');
  }

  /**
   * The module's own default hull is registered under its own format.
   *
   * BB-420 Task 32. Enabling `island` alone gives the mechanism a working
   * wrapper format — no theme, no consumer registration required — which is
   * what "the module works standalone" means. This is the same allowlist
   * assertion as the fixture case above, against the module's real service.
   */
  public function testTheModulesOwnDefaultFormatIsRegistered(): void {
    $renderers = $this->container->getParameter('main_content_renderers');
    self::assertIsArray($renderers);

    self::assertArrayHasKey('island_dialog', $renderers);
    self::assertSame('main_content_renderer.island_dialog', $renderers['island_dialog']);
  }

  /**
   * The module's own default hull renders, message ABOVE body, out of the box.
   *
   * BB-420 Task 32. Not a duplicate of the fixture-hull cases above: those
   * prove the MECHANISM against a component invented for the test, this one
   * proves the module's own SHIPPED component actually renders the shape its
   * own metadata promises, with no theme installed at all.
   */
  public function testTheModulesOwnDefaultHullRendersMessageAboveTheBody(): void {
    $this->container->get('messenger')->addError('This value should not be null.');

    $html = $this->renderThroughFormat(
      ['#markup' => '<p class="probe">Body</p>', '#title' => 'Wrapped'],
      'island_dialog',
      'main_content_renderer.island_dialog',
    );

    $hull = strpos($html, '<dialog');
    $message_slot = strpos($html, 'island-dialog__message');
    $body_slot = strpos($html, 'island-dialog__body');
    $refusal = strpos($html, 'This value should not be null.');
    self::assertIsInt($hull);
    self::assertIsInt($message_slot);
    self::assertIsInt($body_slot);
    self::assertIsInt($refusal, 'The message never reached the response.');
    self::assertGreaterThan($message_slot, $refusal);
    self::assertLessThan($body_slot, $refusal, 'The message rendered below the body.');
    self::assertStringContainsString('Wrapped', $html);
    self::assertStringContainsString('<p class="probe">Body</p>', $html);
  }

  /**
   * The module's own hull renders the close control it is asked for.
   *
   * THE OTHER HALF OF {@see testTheHullIsAskedForItsCloseControl()}, and it
   * changed direction on an operator ruling: dismissal is the HULL's concern,
   * so the script that performs it is this module's (`js/island.dialog.js`)
   * and this module's own hull therefore declares the prop and renders the
   * button. It used to withhold both, on the reasoning that island shipped no
   * dismissal script — which was true of this module and false of the project
   * around it, since a consumer's override hull shipped one.
   *
   * THE THREE ATTRIBUTES ARE THE CONTRACT that script reads: `data-dialog` on
   * the hull, `data-dialog-close` on the control, and — written by the form
   * inside, not by the hull — `data-dialog-cancel` on whatever carries the
   * close target's href.
   */
  public function testTheModulesOwnHullRendersItsCloseControl(): void {
    $html = $this->renderThroughFormat(
      ['#markup' => '<p class="probe">Body</p>', '#title' => 'Wrapped'],
      'island_dialog',
      'main_content_renderer.island_dialog',
    );

    self::assertStringContainsString('<dialog', $html, 'The hull rendered.');
    self::assertStringContainsString('data-dialog', $html, 'The hull must mark itself for the behaviour to find it.');
    self::assertStringContainsString('data-dialog-close', $html);
  }

  /**
   * The hull COMPONENT carries the behaviour that works its close control.
   *
   * ON THE COMPONENT AND NOT ON THE RENDERER, and the difference is reach
   * rather than taste. A library attached by `hull()` would cover the
   * wrapper-format path alone, and this hull is also reachable by an ordinary
   * `include()` — which is what a design system's own scenes do — where it
   * would then render the markup with none of the behaviour. Declared as the
   * component's own dependency it follows the component everywhere.
   *
   * ASSERTED ON THE DERIVED LIBRARY AND NOT ON RENDERED BYTES, measured
   * rather than chosen: core aggregates JavaScript, so the response carries
   * one hashed filename and the string `island.dialog.js` appears nowhere in
   * it. `ComponentPluginManager::libraryFromDefinition()` is what builds this
   * array, from the component's own directory plus `libraryOverrides`.
   *
   * `core/drupal` IS CORE'S OWN ADDITION, not ours — it appends it whenever
   * overrides are present (`ComponentPluginManager.php:219-220`) — and it is
   * asserted here because it is what guarantees `Drupal.behaviors` exists for
   * the behaviour to attach to.
   */
  public function testTheHullComponentDependsOnItsDismissalBehaviour(): void {
    $definition = $this->container->get('plugin.manager.sdc')->getDefinition('island:dialog');

    self::assertSame(
      ['island/dialog', 'core/drupal'],
      $definition['library']['dependencies'] ?? [],
      'The hull component must carry its own behaviour, or an include() renders dead markup.',
    );
  }

  /**
   * The module's own bare hull DOES carry a declared action row.
   *
   * Not symmetric with the close control above, and the asymmetry is the
   * point: a close control with no script is dead, but an action row is the
   * consumer's own markup and works wherever it is printed. A bare hull that
   * dropped it would answer a complete, valid form with no way to send it —
   * so this slot is the one thing island's default hull must not silently
   * discard.
   */
  public function testTheModulesOwnBareHullRendersItsDeclaredActionRow(): void {
    $html = $this->renderThroughFormat(
      [
        '#markup' => '<p class="probe">Body</p>',
        '#title' => 'Wrapped',
        WrappedRouteRenderer::ACTIONS_SLOT_PROPERTY => [
          '#type' => 'html_tag',
          '#tag' => 'button',
          '#attributes' => ['class' => ['probe-submit']],
          '#value' => 'Save',
        ],
      ],
      'island_dialog',
      'main_content_renderer.island_dialog',
    );

    $body = strpos($html, 'island-dialog__body');
    $submit = strpos($html, 'probe-submit');
    self::assertIsInt($body);
    self::assertIsInt($submit, 'The bare hull dropped the action row, leaving the form unsendable.');
    self::assertGreaterThan($body, $submit, 'The row is a footer, so it renders below the body.');
  }

  /**
   * A form's own enforced response is never reached by ANY wrapper format.
   *
   * BB-420 Task 32's own warning, pinned: introducing the module's default
   * hull is exactly the change that could start wrapping a response like this
   * one — an empty body a surface answers a successful save with, the same
   * shape `BbTicketCreateForm` uses to close its dialog (an emptied overlay
   * IS the close). It cannot, and this is why: `FormBuilder::processForm()`
   * throws `EnforcedResponseException` the moment a response is set on form
   * state, which unwinds through `kernel.exception` rather than
   * `kernel.view` — `MainContentViewSubscriber` is never asked, so no
   * `_wrapper_format`, registered or not, is ever consulted. The request
   * below carries the module's own new default format precisely to prove
   * that even THAT does not change the outcome.
   */
  public function testFormsEnforcedResponseIsNeverWrappedByTheDefaultHull(): void {
    $request = Request::create('/island-test', 'POST', [
      'form_id' => 'island_test_bypass_format_form',
      'op' => 'Go',
      '_wrapper_format' => 'island_dialog',
    ]);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);

    $form_state = new FormState();
    try {
      $this->container->get('form_builder')->buildForm(BypassFormatForm::class, $form_state);
      self::fail('Expected the enforced response to short-circuit the build.');
    }
    catch (EnforcedResponseException $e) {
      self::assertSame(
        '',
        (string) $e->getResponse()->getContent(),
        'The response reaches the kernel exactly as the form set it — unwrapped.',
      );
    }
  }

  /**
   * Renders one main content through a wrapper format.
   *
   * THE ATTACHMENTS PROCESSOR IS PART OF THE ANSWER, not test scaffolding.
   * `status_messages` is a placeholdered element and a main content renderer
   * deliberately calls `RendererInterface::render()` rather than
   * `renderRoot()`, so what it returns still carries the token; the real
   * pipeline replaces it in `HtmlResponseAttachmentsProcessor`, reached from
   * `HtmlResponseSubscriber`.
   *
   * @param array<string, mixed> $main_content
   *   The main content the format is asked to answer with.
   * @param string $format
   *   The `_wrapper_format` the request carries.
   * @param string $service_id
   *   The registered `main_content_renderer.*` service to render through.
   */
  private function renderThroughFormat(
    array $main_content,
    string $format = 'island_test_hull',
    string $service_id = 'main_content_renderer.island_test_hull',
  ): string {
    $request = Request::create('/probe', 'GET', ['_wrapper_format' => $format]);
    // The messenger stores its queue on the session.
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $response = $this->container->get($service_id)
      ->renderResponse($main_content, $request, new RouteMatch('island_test.probe', new Route('/probe')));
    $processed = $this->container->get('html_response.attachments_processor')
      ->processAttachments($response);
    // Narrowed: the processor is typed to `AttachmentsInterface`, which has no
    // `getContent()`. It answers with the response it was handed.
    self::assertInstanceOf(HtmlResponse::class, $processed);

    return (string) $processed->getContent();
  }

}
