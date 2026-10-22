<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Plugin\UiPatterns\Source\TicketCreateActionSource;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The shell's own template paints the overlay swap target now (Task 26).
 *
 * WHAT REPLACED WHAT. Until this task the empty `#bakers-overlay` container
 * came from `BbOverlaySource`, a ui_patterns Source addressed from the
 * `overlay` slot of both copies of the shell page layout. That indirection
 * existed only because `shell.twig`'s overlay region was guarded by
 * `{% if overlay %}`, so an empty slot painted no wrapper at all. This task
 * drops the guard and puts the id directly on the wrapper the component already
 * renders — the source, its class and the page layout's `bb_overlay` entry are
 * gone.
 *
 * THE ONE REAL COST, PAID HERE. `TicketCreateActionSource::TARGET_ID` (BB-420
 * Task 36 moved it there when `BbDialogPlacement` was deleted — the action is
 * the only place in PHP that may name the target) is now spelled twice with
 * nothing between the two spellings — once in this class, once as a literal in
 * `shell.twig` — where before three source files and one `ui_patterns` Source
 * all read the same constant. A rename of the constant cannot renumber the
 * literal in the template, so this test reads the CONSTANT, never a literal,
 * and renders the REAL component through the REAL SDC pipeline rather than
 * asserting the template's source text: a rename on either side is what turns
 * this red.
 *
 * WHY THIS MUST HOLD WITH NO OVERLAY CONTENT AT ALL — the case
 * `BbOverlaySource` existed for. A dialog reaches the target by a route (an
 * htmx swap into `#bakers-overlay`), not by the shell filling its own `overlay`
 * slot, so the screen that opens no dialog is the ordinary case this asserts:
 * the target must still be there for the swap to find, with nothing inside it.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ShellOverlayTargetTest extends KernelTestBase {

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
    // The shell is one of the THEME's components, so the theme has to be
    // installed and active for any of this to render at all — the same setup
    // `BbDialogWrapperFormatTest` states for the same reason.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
  }

  /**
   * The target exists even though no screen in this test opens a dialog.
   *
   * This is the case `BbOverlaySource` used to cover and shell.twig's
   * `{% if overlay %}` guard defeated: an unfilled `overlay` slot must still
   * paint a wrapper carrying the id, or an htmx swap into it lands on nothing
   * — HTTP 200, correct response, nothing appears.
   */
  public function testTheShellPaintsTheOverlayTargetWithNoDialogOpen(): void {
    $html = $this->renderShell();

    self::assertStringContainsString(
      'id="' . TicketCreateActionSource::TARGET_ID . '"',
      $html,
      'shell.twig must paint the swap target unconditionally — BbOverlaySource is gone, so the template is now the only thing that can.',
    );
  }

  /**
   * The target's wrapper is empty when nothing has filled the slot.
   *
   * Everything the dialog is arrives by request; the container itself carries
   * no content of its own on a request that does not open one.
   */
  public function testTheOverlayTargetIsEmptyWithNoDialogOpen(): void {
    $html = $this->renderShell();

    self::assertStringContainsString(
      '<div id="' . TicketCreateActionSource::TARGET_ID . '" hx-target="this"></div>',
      $html,
    );
  }

  /**
   * The wrapper carries `hx-target="this"` (BB-420 Task 30).
   *
   * The other half of the pairing `BbTicketCreateForm::buildForm()`'s own
   * docblock describes: a form swapped into this wrapper states no target of
   * its own and relies on htmx inheriting one from an ancestor — which only
   * resolves to somewhere real because THIS attribute is here. Asserted
   * separately from the emptiness case above so a reader sees which fact this
   * class is actually pinning against the two-file drift
   * `TicketCreateActionSource::TARGET_ID`'s own docblock warns about.
   */
  public function testTheOverlayTargetCarriesHxTargetThis(): void {
    $html = $this->renderShell();

    self::assertStringContainsString(
      'id="' . TicketCreateActionSource::TARGET_ID . '" hx-target="this"',
      $html,
      'A form swapped in with no target of its own must inherit one here, or it nests inside itself.',
    );
  }

  /**
   * The overlay's markup comes after the content's, matching the docblock.
   *
   * `shell.twig`'s own docblock states the rail, the top bar and the status
   * bar exist once each "with the overlay layer last so a dialog stacks above
   * everything". That is a claim about the DOM, and the claim is what a stray
   * reorder of the template would break silently — a dialog would still open,
   * only underneath the rest of the shell.
   */
  public function testTheOverlayTargetRendersAfterTheContent(): void {
    $html = $this->renderShell();

    $content_pos = strpos($html, '<main');
    $overlay_pos = strpos($html, TicketCreateActionSource::TARGET_ID);
    self::assertIsInt($content_pos, 'The shell must render its content region.');
    self::assertIsInt($overlay_pos, 'The shell must render its overlay target.');
    self::assertGreaterThan(
      $content_pos,
      $overlay_pos,
      'The overlay target must come after the content in the shell markup, so it stacks above it.',
    );
  }

  /**
   * Renders the shell component with an ordinary screen's content only.
   *
   * No `overlay` slot is filled — this is every screen that has not opened a
   * dialog, which is most of them.
   */
  private function renderShell(): string {
    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:shell',
      '#props' => [],
      '#slots' => [
        'content' => ['#markup' => '<p class="probe">Screen body</p>'],
      ],
    ];

    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

}
