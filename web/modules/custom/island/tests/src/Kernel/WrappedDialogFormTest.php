<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\Core\Form\EnforcedResponseException;
use Drupal\Core\Form\FormState;
use Drupal\KernelTests\KernelTestBase;
use Drupal\island\Render\WrappedRouteRenderer;
use Drupal\island_test\Form\WrappedDialogMisnamedProbeForm;
use Drupal\island_test\Form\WrappedDialogProbeForm;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * The form side of the wrapper-format round trip, on island's own fixtures.
 *
 * WHAT THIS CLASS PINS IS AN ASYMMETRY, and every case below is one half of it.
 * A dialog's GET and its POST both carry `_wrapper_format`, because a refusal
 * that dropped it would be answered by core's HTML renderer and come back as a
 * whole page instead of as the hull whose `message` slot has to carry it. The
 * url the operator LANDS on must not carry it, or the landing answers with a
 * bare main-content document — the screen without its shell.
 *
 * THE FIXTURE IS `island_test`'s AND NOT A PRODUCT FORM, deliberately: these
 * are properties of the format this module registers, so they must be
 * observable with `island` and `island_test` alone. Driving a consumer's form
 * would measure that form's composition and would keep passing if the trait
 * were bypassed.
 */
#[Group('island')]
final class WrappedDialogFormTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = ['system', 'user', 'island', 'island_test'];

  /**
   * The fixture form, reading whichever request is current at call time.
   *
   * One instance for the whole case: `FormBase::getRequest()` resolves the
   * current request from the stack on EVERY call rather than caching one, so
   * re-pushing a request is enough to change what the form sees.
   */
  private WrappedDialogProbeForm $form;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installConfig(['system']);
    $this->form = WrappedDialogProbeForm::create($this->container);
  }

  /**
   * A destination that is not a root-relative path answers the front page.
   *
   * The value reaches an `href` and an `HX-Location`, so an absolute url there
   * is an open redirect; so is the protocol-relative `//host` form, which
   * merely looks local. A bare word is neither and is refused for being
   * unresolvable rather than for being dangerous.
   */
  public function testForeignDestinationIsRefused(): void {
    foreach (['https://evil.example/x', '//evil.example/x', 'evil'] as $destination) {
      $this->setRequestQuery(['destination' => $destination]);
      self::assertSame(
        '/',
        $this->form->publicReturnUrl()->toString(),
        sprintf('The destination "%s" was not refused.', $destination),
      );
    }
  }

  /**
   * The landing url drops the wrapper format and keeps the operator's query.
   *
   * Carried through, the format answers the landing navigation with a bare
   * main-content document. It bites twice — once on `HX-Location` after a
   * write, once on a ghost `Cancel`'s href — and the operator's own query
   * parameters have to survive both.
   */
  public function testTheReturnUrlDropsTheWrapperFormat(): void {
    $this->setRequestQuery(['destination' => '/x/projects?_wrapper_format=island_dialog&q=1']);

    self::assertSame('/x/projects?q=1', $this->form->publicReturnUrl()->toString());
  }

  /**
   * The landing url drops core's htmx transport keys, and keeps the rest.
   *
   * THE SYMPTOM IS WORSE THAN THE WRAPPER FORMAT'S, which is why this is its
   * own case rather than another destination in the one above. A dialog opened
   * from a BOOSTED screen inherits that screen's url as its `destination`, and
   * `htmx-assets.js` has already written `ajax_page_state` into it. Landing
   * there is a full document navigation, and `ajax_page_state[libraries]` tells
   * Drupal's asset resolver the client already holds every library it names —
   * so the document arrives with NO stylesheet and NO script at all, an
   * unstyled wall of links rather than the bare main-content document the
   * wrapper format produces.
   *
   * The operator's own `q` rides along in the same assertion deliberately: a
   * repair that answered this by dropping the whole query would satisfy a test
   * that only looked for the absence.
   */
  public function testTheReturnUrlDropsCoreTransportKeys(): void {
    $this->setRequestQuery([
      'destination' => '/x/projects?ajax_page_state%5Blibraries%5D=island%2Fbase&ajax_page_state%5Btheme%5D=bb_theme&q=1',
    ]);

    $url = $this->form->publicReturnUrl()->toString();
    self::assertStringNotContainsString('ajax_page_state', $url);
    self::assertSame('/x/projects?q=1', $url);
  }

  /**
   * The post url keeps the format and drops core's htmx transport keys.
   *
   * `FormBuilder::buildFormAction()` strips `_wrapper_format` out of the action
   * it builds, so the post url is stated rather than inherited from `#action`.
   * `htmx-assets.js`'s `configRequest` handler adds `ajax_page_state` to every
   * request and for a GET those land in the query string — copied into the
   * form's own `hx-post` they are sent again, and the `libraries` blob grows by
   * a round trip each time.
   */
  public function testThePostUrlKeepsTheFormatAndDropsCoreTransportKeys(): void {
    $this->setRequestQuery([
      'ajax_page_state' => ['libraries' => 'a'],
      'destination' => '/x',
    ]);

    $url = $this->form->publicDialogPostUrl()->toString();
    self::assertStringContainsString('_wrapper_format=island_dialog', $url);
    self::assertStringNotContainsString('ajax_page_state', $url);
    self::assertStringContainsString('destination', $url);
  }

  /**
   * The htmx wiring is conditional on the format.
   *
   * That condition is the whole of the no-JavaScript story.
   * Reached as an ordinary page — where a trigger's plain `href` lands a
   * browser with scripts off — the form must submit the ordinary way, because
   * a form carrying `hx-post` on a standalone page would, with scripts back
   * ON, post itself into an overlay the operator is not looking at.
   */
  public function testHtmxIsAttachedOnlyOnDialogRequests(): void {
    self::assertStringNotContainsString('hx-post', $this->renderPlainPage());
    self::assertStringContainsString('hx-post', $this->renderDialogRequest());
  }

  /**
   * A dialog write answers with an empty body plus `HX-Location`.
   *
   * `FormBuilder::processForm()` calls `disableRedirect()` for every htmx
   * request, so a form that only set a redirect would come back as a 200
   * re-render of itself with no signal at all. The empty body is half the
   * answer: swapped into the overlay it empties it, and an emptied overlay is
   * how the dialog closes. `HX-Location` is the other half.
   */
  public function testDialogWriteAnswersWithEmptyBodyAndLocationHeader(): void {
    $this->setRequestQuery([
      '_wrapper_format' => 'island_dialog',
      'destination' => '/x/projects',
    ]);

    $form = [];
    $form_state = new FormState();
    $this->form->submitForm($form, $form_state);

    $response = $form_state->getResponse();
    self::assertNotNull($response, 'No response was set, so the dialog would never close.');
    self::assertSame('', (string) $response->getContent());
    self::assertSame('/x/projects', $response->headers->get('HX-Location'));
    // NULL and not FALSE: `FormState::getRedirect()` answers NULL while
    // nothing has been set, and FALSE only once something has explicitly
    // disabled redirection. Never having set one is the property here.
    self::assertNull($form_state->getRedirect(), 'A redirect would fight the location header.');
  }

  /**
   * The dialog form posts into ITSELF, which is core's own htmx form shape.
   *
   * THE THREE ATTRIBUTES ARE ONE DECISION AND NOT THREE.
   * `FormBuilder::prepareForm()` decides whether to hang `data-hx-swap-oob` on
   * the rebuilt `form_build_id` purely from two request headers
   * (`FormBuilder.php:781-791`): it attaches the swap unless `HX-Target` ends
   * in the literal `-form` AND equals `HX-Trigger`. Core's own comment states
   * the precondition it is guessing at — "the target to replace is not a whole
   * form, the build_id will not be part of the main swap" — and the heuristic
   * for it is Drupal's `*_form` id convention, because `#id` is
   * `Html::getUniqueId($form_id)` (`FormBuilder.php:857-858`).
   *
   * So a wrapper-format dialog satisfies the precondition by TARGETING THE
   * FORM: `hx-target="this"` makes `HX-Target` and `HX-Trigger` the same
   * element — the `<form>` itself, since `hx-post` on a form makes the form the
   * triggering element — `outerHTML` replaces exactly that element, and
   * `hx-select` picks the form back out of a response that also carries the
   * hull. Then the rebuilt `form_build_id` really IS part of the main swap,
   * core attaches nothing, and this format takes nothing back off.
   *
   * `hx-select` IS WRITTEN IN AN `#after_build` and read off `#id` rather than
   * computed here: `FormBuilder::buildForm()` runs `retrieveForm()` — which is
   * what calls the form object's own `buildForm()` — and only THEN
   * `prepareForm()`, which is what assigns `#id` at all. From inside
   * `attachDialogHtmx()` the id does not exist yet.
   */
  public function testTheDialogFormPostsIntoItselfWithCoresOwnSwapShape(): void {
    $form = $this->buildDialogForm();
    $attributes = $form['#attributes'] ?? [];

    self::assertSame('this', (string) ($attributes['data-hx-target'] ?? ''));
    self::assertStringStartsWith('outerHTML', (string) ($attributes['data-hx-swap'] ?? ''));
    self::assertSame(
      'form#' . $form['#id'],
      (string) ($attributes['data-hx-select'] ?? ''),
      'The response carries the hull too, so the form has to be selected out of it by its own id.',
    );
  }

  /**
   * The dialog form's DOM id ends in `-form`, which is what core keys on.
   *
   * NOT COSMETIC, and not a claim about naming taste. Core's heuristic above
   * tests `str_ends_with($hx_target, '-form')` and nothing else — it never
   * checks that the target IS a form — so a dialog whose form id did not end
   * in `_form` would be handed the out-of-band swap while its build id was
   * already in the main swap, which is the defect this format used to strip the
   * attribute for.
   */
  public function testTheDialogFormDomIdEndsInFormSoCoreKeepsTheBuildId(): void {
    self::assertStringEndsWith('-form', (string) $this->buildDialogForm()['#id']);
  }

  /**
   * A form id the format cannot serve is refused loudly, at build time.
   *
   * THE GUARD ON THE CASE ABOVE. The suffix is not this module's preference,
   * it is core's precondition, and a consumer that broke it would get a dialog
   * that looks healthy and cannot be submitted twice — a silent wrong answer
   * rather than an error. Asserted on the FORM ID and not on the DOM id
   * deliberately: `Html::getUniqueId()` appends `--2` to the second instance of
   * the same id within one request, so the rendered id is not a stable thing to
   * refuse on, while the form id is.
   */
  public function testTheFormatRefusesAnIdItCannotServe(): void {
    $this->setRequestQuery(['_wrapper_format' => 'island_dialog']);

    $this->expectException(\LogicException::class);
    $this->expectExceptionMessage('island_test_wrapped_dialog_misnamed');
    $this->container->get('form_builder')->getForm(WrappedDialogMisnamedProbeForm::class);
  }

  /**
   * On the form's own target, core attaches no out-of-band build-id swap.
   *
   * THE MEASUREMENT THE SHAPE ABOVE EXISTS FOR, taken through core's own
   * builder rather than argued from the shape: with `HX-Target` and
   * `HX-Trigger` both naming the form, `prepareForm()`'s branch does not fire
   * and the rebuilt `form_build_id` reaches the document as part of the main
   * swap. Nothing of this module's is involved in that; the point is that
   * nothing has to be.
   */
  public function testCoreAttachesNoBuildIdOobSwapOnTheFormsOwnTarget(): void {
    $form = $this->buildFromHtmxPost(TRUE, 'island-test-wrapped-dialog-probe-form');

    self::assertArrayHasKey('form_build_id', $form, 'Core built a form_build_id at all.');
    self::assertArrayNotHasKey(
      'data-hx-swap-oob',
      $form['form_build_id']['#attributes'] ?? [],
      'Core hung its out-of-band swap on a build id that is already in the main swap.',
    );
  }

  /**
   * A target that is not this form keeps core's own out-of-band update.
   *
   * THE OTHER HALF, and it is what keeps the shape above a property of the
   * FORMAT rather than a global opinion about core. A fragment swap that really
   * does replace something smaller than the form still needs the out-of-band
   * update, which is the situation core wrote the branch for — so the same POST
   * aimed at a container still carries it.
   */
  public function testForeignTargetKeepsCoreBuildIdOobSwap(): void {
    $form = $this->buildFromHtmxPost(TRUE, 'island-overlay');

    self::assertArrayHasKey(
      'data-hx-swap-oob',
      $form['form_build_id']['#attributes'] ?? [],
      'Core still owns the out-of-band update wherever its own precondition holds.',
    );
  }

  /**
   * The hull's message region is updated OUT OF BAND, deliberately.
   *
   * THE CONSEQUENCE OF REPLACING ONLY THE FORM. The generic hull
   * ({@see \Drupal\island\Render\WrappedRouteRenderer::hull()}) puts its
   * `message` slot OUTSIDE the form, so a main swap that replaces the form
   * alone would leave a refusal's message region exactly as it was — stale
   * after a second refusal, absent after the first. `hx-select-oob` is htmx's
   * own mechanism for the case: it picks that region out of the SAME response
   * and swaps it where it already sits.
   *
   * MEASURED IN htmx's OWN SOURCE, because the ordering is the whole question:
   * `swap()` handles `swapOptions.selectOOB` and then
   * `findAndSwapOobElements()` BEFORE it applies `swapOptions.select`
   * (`core/assets/vendor/htmx/htmx.js:1920-1951`, htmx 2.0.8). So `hx-select`
   * narrowing the response to the form does not hide the region from the
   * out-of-band pass.
   *
   * IT IS STATED BY THE CALLER RATHER THAN MARKED ON THE RESPONSE, and that is
   * the difference from an `hx-swap-oob` attribute the server would write. A
   * marked element is lifted out of EVERY response carrying it, including the
   * opening GET — where the region has no counterpart in the document yet, so
   * htmx removes it from the fragment and the dialog would arrive with no
   * message region at all. `hx-select-oob` fires only on the request that
   * declares it, and htmx skips it silently when the response holds no such id,
   * which is exactly what a surface owning its own hull needs.
   */
  public function testTheHullsMessageRegionIsSelectedOutOfBand(): void {
    $attributes = $this->buildDialogForm()['#attributes'] ?? [];

    self::assertSame(
      '#' . WrappedRouteRenderer::MESSAGE_REGION_ID . ':innerHTML',
      (string) ($attributes['data-hx-select-oob'] ?? ''),
    );
  }

  /**
   * A dialog request attaches the guard against a response without this form.
   *
   * WHY IT IS THE FORM'S AND NOT THE HULL's. The hazard is created by the
   * form's own `hx-select`: a selection that matches nothing makes htmx
   * remove the target and put nothing back, so a 2xx that does not contain
   * this form empties the surface silently. A hull with no form in it
   * declares no selection and has nothing to guard.
   *
   * CONDITIONAL ON THE FORMAT for the reason all of this wiring is: off the
   * format there is no `hx-select`, no swap, and nothing to cancel.
   */
  public function testTheDialogRequestAttachesTheEmptySwapGuard(): void {
    self::assertContains(
      'island/dialog_form',
      $this->buildDialogForm()['#attached']['library'] ?? [],
      'Without the guard a 2xx that does not hold this form empties the dialog.',
    );

    $this->setRequestQuery([]);
    self::assertNotContains(
      'island/dialog_form',
      $this->container->get('form_builder')->getForm(WrappedDialogProbeForm::class)['#attached']['library'] ?? [],
    );
  }

  /**
   * On a dialog request the action row is lifted into the hull's footer.
   *
   * WHERE A DIALOG'S SUBMIT BELONGS, and the reason the format has to move it
   * rather than a consumer placing it there. The hull is the form's ANCESTOR
   * under this format, so nothing the form renders can reach the hull's own
   * footer slot; and the form is all a refusal's main swap replaces, so a row
   * left inside it is rebuilt on every round trip. The row is handed over as
   * {@see \Drupal\island\Render\WrappedRouteRenderer::ACTIONS_SLOT_PROPERTY}
   * and taken OUT of the form's children, because a control printed twice is
   * worse than one printed in the wrong place.
   */
  public function testTheActionRowIsLiftedIntoTheHullOnDialogRequests(): void {
    $form = $this->buildDialogForm();

    self::assertArrayNotHasKey('actions', $form, 'The row must leave the form, or it renders twice.');
    self::assertArrayHasKey(
      'submit',
      $form[WrappedRouteRenderer::ACTIONS_SLOT_PROPERTY] ?? [],
      'The row never reached the hull, so the dialog has no way to be sent.',
    );
  }

  /**
   * The lifted submit names its form owner, because it has left the form.
   *
   * THE ONE THING THAT MAKES THE PLACEMENT WORK AT ALL, and it is HTML's own
   * answer rather than a trick: a submit that is not its form's descendant
   * submits nothing, and the `form` attribute is how an element states which
   * form it belongs to. Without it the dialog is complete, valid, and
   * unsendable — a failure with no error in it.
   *
   * htmx HONOURS IT, MEASURED IN ITS OWN SOURCE rather than assumed:
   * `maybeSetLastButtonClicked()` resolves the clicked control's form through
   * `getRelatedForm()`, which reads `elt.form` — the form-owner property the
   * `form` attribute sets — and records the control on THAT form's internal
   * data. `getInputValues()` then adds its name and value to the request's
   * `priorityFormData`, so Drupal's `buttonWasClicked()` still finds `op` and
   * the submit handlers still run. The attribute is not merely tolerated by
   * the transport, it is the thing the transport keys on.
   *
   * READ OFF `#id` FOR {@see selectThisForm()}'s OWN REASON:
   * `Html::getUniqueId()` keeps a register and would answer `--2` for a second
   * call, so what core actually assigned is the only correct answer — which is
   * also why this is an `#after_build` and not part of `attachDialogHtmx()`.
   */
  public function testTheLiftedSubmitNamesItsFormOwner(): void {
    $form = $this->buildDialogForm();

    self::assertSame(
      $form['#id'],
      $form[WrappedRouteRenderer::ACTIONS_SLOT_PROPERTY]['submit']['#attributes']['form'] ?? NULL,
      'A submit outside its form submits nothing unless it names the form.',
    );
  }

  /**
   * Off the format the row stays in the form, which is the scriptless page.
   *
   * There is no hull on that path — the wrapper format never runs — so a row
   * lifted into a slot nothing renders would be a page with no submit at all.
   * The lift is conditional for exactly the reason the htmx wiring is.
   */
  public function testTheActionRowIsNotLiftedOnPlainRequests(): void {
    $this->setRequestQuery([]);
    $form = $this->container->get('form_builder')->getForm(WrappedDialogProbeForm::class);

    self::assertArrayHasKey('actions', $form);
    self::assertArrayNotHasKey(WrappedRouteRenderer::ACTIONS_SLOT_PROPERTY, $form);
  }

  /**
   * A consumer's own `#after_build` runs BEFORE the lift takes the row away.
   *
   * NOT A DETAIL OF ORDERING, a contract. A consumer that finishes its submit
   * control in its own `#after_build` — with a disabled state, or an attribute
   * naming the field that gates it, both of which need values only the built
   * form has — addresses `$form['actions']`, and it can only do that while the
   * row is still there. `EntityForm`-shaped consumers append theirs while
   * building the form and this trait appends the lift afterwards, so the order
   * holds by construction; asserted here because "by construction" is exactly
   * what a later edit breaks silently.
   */
  public function testConsumerAfterBuildRunsBeforeTheLift(): void {
    $this->setRequestQuery(['_wrapper_format' => 'island_dialog']);
    $form = $this->container->get('form_builder')->getForm(WrappedDialogProbeForm::class);

    self::assertSame(
      'seen-by-the-consumer',
      $form[WrappedRouteRenderer::ACTIONS_SLOT_PROPERTY]['submit']['#attributes']['data-probe-finished'] ?? NULL,
      'The lift ran before the consumer could finish its own submit control.',
    );
  }

  /**
   * A plain-page write is an ordinary redirect, which is the scriptless path.
   */
  public function testPlainPageWriteRedirectsTheOrdinaryWay(): void {
    $this->setRequestQuery(['destination' => '/x/projects']);

    $form = [];
    $form_state = new FormState();
    $this->form->submitForm($form, $form_state);

    self::assertNull($form_state->getResponse());
    self::assertSame('/x/projects', $form_state->getRedirect()->toString());
  }

  /**
   * Makes one request current, so the form reads the query under test.
   *
   * @param array<string, mixed> $query
   *   The query the request carries.
   */
  private function setRequestQuery(array $query): void {
    $request = Request::create('/probe', 'GET', $query);
    // The messenger and the form cache both reach for the session.
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
  }

  /**
   * Drives one htmx POST through the whole builder and hands back the form.
   *
   * A REAL REQUEST AND NOT A HAND-BUILT ARRAY, because the element under test
   * is core's own and only core builds it: `FormBuilder::prepareForm()` adds
   * `form_build_id` — and decides about its out-of-band swap — AFTER
   * `retrieveForm()` has run the form object's `buildForm()`, which is exactly
   * why the removal cannot live in `attachDialogHtmx()`.
   *
   * THE FOUR THINGS CORE'S BRANCH INSISTS ON are the `HX-Request` header, an
   * `HX-Target`, an `HX-Trigger`, and a submitted `form_id` plus
   * `form_build_id` — without the last two there is no "old" build id to swap
   * over and the branch never fires. The trigger is always this form, because
   * `hx-post` on a `<form>` makes the form the triggering element; what varies
   * between the cases is the TARGET, which is the only thing core's heuristic
   * looks at besides that equality.
   *
   * READ OFF `getCompleteForm()` AND NOT OFF A RETURN VALUE.
   * `FormState::setCompleteForm()` keeps the form BY REFERENCE, so the state
   * holds the finished array even when the round trip ends in a response —
   * which this one does on both paths: the fixture's submit answers a dialog
   * request with `HX-Location` and a plain request with a redirect, and
   * `FormBuilder` turns either into an `EnforcedResponseException`.
   *
   * @param bool $dialog
   *   Whether the request carries the wrapper format.
   * @param string $target
   *   The `HX-Target` header. `island-overlay` is a neutral stand-in for
   *   whatever container a consumer's shell aims a trigger at.
   *
   * @return array<string, mixed>
   *   The finished form.
   */
  private function buildFromHtmxPost(bool $dialog, string $target): array {
    $query = ['destination' => '/x/projects'];
    if ($dialog) {
      $query['_wrapper_format'] = 'island_dialog';
    }
    $request = Request::create(
      '/probe?' . http_build_query($query),
      'POST',
      [
        'form_id' => 'island_test_wrapped_dialog_probe_form',
        'form_build_id' => 'form-a-previous-build',
      ],
      [],
      [],
      [
        'HTTP_HX_REQUEST' => 'true',
        'HTTP_HX_TARGET' => $target,
        'HTTP_HX_TRIGGER' => 'island-test-wrapped-dialog-probe-form',
      ],
    );
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);

    $form_state = new FormState();
    try {
      $this->container->get('form_builder')->buildForm(WrappedDialogProbeForm::class, $form_state);
    }
    catch (EnforcedResponseException) {
      // The answer itself is the empty-body-plus-header case's subject; here
      // it is only the reason the builder does not return a form.
    }

    return $form_state->getCompleteForm();
  }

  /**
   * The fixture form built through core's builder on a dialog request.
   *
   * THROUGH THE BUILDER AND NOT THROUGH THE FORM OBJECT, because half of what
   * is asserted about it is core's: `#id` and `form_build_id` are
   * `prepareForm()`'s, and `hx-select` is written by an `#after_build`, which
   * only `doBuildForm()` runs.
   *
   * @return array<string, mixed>
   *   The finished form.
   */
  private function buildDialogForm(): array {
    $this->setRequestQuery(['_wrapper_format' => 'island_dialog']);

    return $this->container->get('form_builder')->getForm(WrappedDialogProbeForm::class);
  }

  /**
   * The fixture form as an ordinary page, rendered.
   */
  private function renderPlainPage(): string {
    $this->setRequestQuery([]);
    return $this->renderFixtureForm();
  }

  /**
   * The fixture form reached through the dialog wrapper format, rendered.
   */
  private function renderDialogRequest(): string {
    $this->setRequestQuery(['_wrapper_format' => 'island_dialog']);
    return $this->renderFixtureForm();
  }

  /**
   * Builds and renders the fixture form against the current request.
   *
   * RENDERED RATHER THAN INSPECTED AS AN ARRAY, because the property under
   * test is whether the attribute reaches the markup a browser gets. Core's
   * `Htmx` helper writes `data-hx-post`, which is the standard-markup form of
   * `hx-post` and contains it.
   */
  private function renderFixtureForm(): string {
    $form = $this->container->get('form_builder')
      ->getForm(WrappedDialogProbeForm::class);

    return (string) $this->container->get('renderer')->renderRoot($form);
  }

}
