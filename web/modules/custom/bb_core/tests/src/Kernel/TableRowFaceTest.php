<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbContentEntityInterface;
use Drupal\bb_core\Entity\BbTicket;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\user\Entity\User;
use PHPUnit\Framework\Attributes\Group;

/**
 * A row's accent is the WORKFLOW PHASE of its subject, and nothing else.
 *
 * THE HUMAN'S INSTRUCTION OF 2026-09-04: `BbTableRowInterface` *"must be
 * generalised, and what is needed is a general state across all workflows —
 * prepare / running / review / done — which has nothing to do with the table
 * and needs no extra interface."* So this test asserts three deletions and one
 * derivation:
 *
 * - **The interface is gone**, and `BbContentEntityInterface` no longer extends
 *   it. A bakers.build entity is not defined by being able to be a table row.
 * - **`getBbRowUrl()` is gone**, and with it `data-row-url`. Measured before
 *   the deletion: no JavaScript and no CSS in this theme read that attribute;
 *   its only readers were the tests that asserted it and two Playwright steps
 *   that used `[data-row-url]` as a row COUNTER, which now count `.table__row`.
 *   The visible affordance was always the identifier cell's link, which stays.
 * - **The ticket's private `state → accent` map is gone**, and so is the
 *   `phase → accent` map that briefly replaced it in PHP. The ticket reports
 *   its `getBbPhase()` — fed by a `phase:` every state of every workflow
 *   declares — and `views-view-table.html.twig` decides what a phase looks
 *   like. An entity does not get to state a presentation decision.
 *
 * WHY THERE IS STILL PHP HERE, RESTATED HONESTLY, because the reason changed.
 * The old interface justified itself with the Twig sandbox: `TwigSandboxPolicy`
 * allows only `id`, `label`, `bundle`, `get`, `toString`, `__toString` and the
 * `get`/`has`/`is` prefixes, so `toUrl()` was unreachable from a template. With
 * the row URL deleted that argument no longer justifies anything — nothing
 * needs `toUrl()`. The PHASE needs PHP for a DIFFERENT reason: it is declared
 * per state in `bb_core.workflows.yml` and reachable only through the
 * workflow plugin manager, which a template cannot reach at all, and restating
 * the state→phase table in Twig would be the ticket-specific literal in a
 * global template that the 2026-09-03 deletion removed. What does NOT need PHP
 * is what a phase LOOKS LIKE: five phases onto two accents is a rendering
 * decision and it is a `{% if %}` in the style template. The sandbox still
 * decides the method's NAME (`get`-prefixed, `Bb`-qualified because the
 * template calls it on whatever object a `ResultRow` holds) — it no longer
 * decides that the method exists.
 *
 * AN ENTITY THAT CANNOT ANSWER CONTRIBUTES NOTHING, and it needs no interface
 * to be allowed not to. The template's `|default('')` is what makes a missing
 * method a missing accent rather than an error — measured with
 * `strict_variables` both on and off, because a missing method throws under
 * strict Twig unless the access is guarded by `default`.
 */
#[Group('bb_core')]
final class TableRowFaceTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->container->get('router.builder')->rebuild();
    $this->buildTwoWorkspaceWorld();
  }

  /**
   * The table-row interface is deleted and nothing extends it.
   *
   * ASSERTED RATHER THAN OBSERVED. The human has ruled twice that no interface
   * of this kind is wanted, so the class's absence is the deliverable and a
   * reintroduction under the same name has to fail here. `class_exists` is
   * asked with autoloading ON, which is what makes a re-added file visible.
   */
  public function testTheTableRowInterfaceIsGone(): void {
    self::assertFalse(
      interface_exists('Drupal\bb_core\Entity\BbTableRowInterface', TRUE),
      'BbTableRowInterface is back.',
    );

    $parents = class_implements(BbContentEntityInterface::class) ?: [];
    foreach (array_keys($parents) as $parent) {
      self::assertStringNotContainsString(
        'TableRow',
        (string) $parent,
        'BbContentEntityInterface extends a table-row contract again.',
      );
    }
  }

  /**
   * NO bakers.build ENTITY CLASS answers a row URL any more.
   *
   * ENUMERATED FROM THE ENTITY TYPE MANAGER rather than asserted about two
   * classes by hand, for the same reason the phase test enumerates workflows:
   * `getBbRowUrl()` lived on `BbContentEntityBase`, so EVERY bakers.build
   * entity had it, and a deletion that left one override behind would be
   * invisible to a two-case check. The method's absence is the deliverable, so
   * every class that could carry it is asked.
   *
   * The `_TEST_` suffix guard is not needed here — the loop is scoped by the
   * class's own namespace, which is what makes it list bakers's entities and
   * not core's fifty.
   */
  public function testNoBbEntityClassAnswersTheRowUrl(): void {
    $classes = [];
    foreach ($this->container->get('entity_type.manager')->getDefinitions() as $id => $definition) {
      $class = (string) $definition->getClass();
      if (str_starts_with($class, 'Drupal\\bb_core\\Entity\\')) {
        $classes[(string) $id] = $class;
      }
    }

    self::assertNotEmpty($classes, 'No bb_core entity types were found to check.');
    foreach ($classes as $id => $class) {
      self::assertFalse(
        method_exists($class, 'getBbRowUrl'),
        sprintf('%s (%s) still answers a row URL.', $id, $class),
      );
    }
  }

  /**
   * The ticket reports its PHASE, so one reading serves every workflow.
   *
   * RENAMED FROM `getBbRowAccent()` ON 2026-09-04, and the rename is the
   * assertion. That name was wrong twice: it said "Row" although the table-row
   * interface is gone and a row is no longer its subject, and it returned an
   * ACCENT — a presentation decision — out of an entity. The entity now says
   * WHAT IT IS and the mapping from phase to accent lives in
   * `views-view-table.html.twig`, where presentation belongs.
   *
   * Every `bb_work` state is listed, the only ticket workflow; a further
   * workflow adds its states here.
   */
  public function testTheTicketReportsItsPhaseAcrossEveryWorkflow(): void {
    foreach ([
      ['bb_work', 'working', 'running'],
      ['bb_work', 'review', 'review'],
      ['bb_work', 'qualification', 'prepare'],
      ['bb_work', 'plan', 'prepare'],
      ['bb_work', 'done', 'done'],
      ['bb_work', 'cancelled', 'cancelled'],
    ] as [$workflow, $state, $phase]) {
      $ticket = $this->ticket(['workflow' => $workflow, 'state' => $state]);
      self::assertSame($phase, $ticket->getBbPhase(), sprintf('%s.%s', $workflow, $state));
    }
  }

  /**
   * NO entity answers an accent, and no map from phase to accent survives.
   *
   * THE DELETION IS THE DELIVERABLE, so it is asserted rather than assumed. An
   * entity that returned a `bb_theme:table` accent was stating a
   * presentation decision, and `TypeWorkflows::accentForPhase()` was the table
   * it stated it from. Both are gone; the five-phases-onto-two-accents mapping
   * is a `{% if %}` in the style template that renders the rail.
   */
  public function testNoAccentIsReportedFromPhpAtAll(): void {
    // ASKED THROUGH REFLECTION rather than `method_exists()`, because the
    // method is provably absent and static analysis then reports the call as
    // always-false — which would make the deletion unassertable at all.
    self::assertFalse(
      (new \ReflectionClass(BbTicket::class))->hasMethod('getBbRowAccent'),
      'The ticket answers a presentation accent again.',
    );
    self::assertFalse(
      (new \ReflectionClass(TypeWorkflows::class))->hasMethod('accentForPhase'),
      'The phase-to-accent map is back in PHP.',
    );
  }

  /**
   * A stored state its workflow does not define answers no phase.
   *
   * `TypeWorkflows::phase()` THROWS for such a state, on purpose — a missing
   * phase is a defect in the workflow definition. But a state that drifted out
   * of its workflow is a DATA condition, and a listing must not return a 500
   * over one row, so the guard is on the caller. `human_input` is the honest
   * probe for it: the deleted `ACCENTS` map mapped it to `wait`, and
   * `designbook/data-model.yml` states outright that *"`human_input` is not a
   * state"* — so the one entry that used the `wait` accent had been dead the
   * whole time, which is why no phase mapping to `wait` loses anything.
   */
  public function testStoredStateOutsideItsWorkflowAnswersNoPhase(): void {
    $ticket = $this->ticket(['workflow' => 'bb_work', 'state' => 'human_input']);

    self::assertNull($ticket->getBbPhase());
  }

  /**
   * An entity with no workflow answers no phase and needs no override.
   *
   * The base class no longer answers one at all: with no interface to satisfy,
   * a method returning NULL for every entity but one was a default restated in
   * a second place. The template asks and the method is simply absent, which
   * its `|default('')` already handles.
   */
  public function testAnotherBbEntityAnswersNoPhaseAtAll(): void {
    $project = $this->fixture('a', 'bb_project');

    self::assertFalse(method_exists($project, 'getBbPhase'));
  }

  /**
   * An entity from outside bakers.build answers nothing, and that is legal.
   *
   * The team members view's rows are `og_membership` and `user` entities. They
   * answer neither, so that table gets no accent — the right answer rather
   * than a gap, and now one that costs no interface to express.
   */
  public function testAnEntityFromOutsideBbAnswersNothing(): void {
    $account = User::create(['name' => 'outsider']);

    self::assertFalse(method_exists($account, 'getBbPhase'));
    self::assertFalse(method_exists($account, 'getBbRowUrl'));
  }

  /**
   * Nothing in this codebase preprocesses `views_view_table` any more.
   *
   * THE HOOK'S ABSENCE IS THE DELIVERABLE, so it is asserted rather than
   * assumed. The theme registry is asked instead of the file system, because
   * that is where a preprocess actually takes effect — an OOP `#[Hook]` class,
   * a `.theme` function and a `.module` function all arrive in the same list,
   * so one check covers every way the hook could come back.
   */
  public function testNothingPreprocessesTheTableStyleAnyMore(): void {
    $registry = $this->container->get('theme.registry')->get();

    foreach (['views_view_table', 'views_view_table__tickets'] as $hook) {
      $functions = $registry[$hook]['preprocess functions'] ?? [];
      $ours = array_values(array_filter(
        array_map(static fn (mixed $callable): string => is_array($callable)
          ? (is_object($callable[0]) ? $callable[0]::class : (string) $callable[0]) . '::' . $callable[1]
          : (string) $callable,
        $functions),
        static fn (string $name): bool => str_contains($name, 'bakers'),
      ));
      self::assertSame([], $ours, sprintf('%s is preprocessed by %s.', $hook, implode(', ', $ours)));
    }
  }

  /**
   * A saved ticket in the in-scope project.
   *
   * @param array<string, mixed> $values
   *   Field values over the defaults.
   *
   *   TYPED AS THE CONCRETE CLASS, which is the honest consequence of deleting
   *   the interface: `getBbPhase()` is declared by `BbTicket` and by no
   *   contract, so static analysis can only see it there. The template does not
   *   care — it calls the method on whatever object a result row holds and
   *   guards the ask — but a test must name the class it is asserting about.
   *
   * @return \Drupal\bb_core\Entity\BbTicket
   *   The ticket.
   */
  private function ticket(array $values = []): BbTicket {
    $ticket = $this->createEntity('bb_ticket', $values + [
      'title' => 'A row with a face',
      'workflow' => 'bb_work',
      'project_id' => $this->fixture('a', 'bb_project')->id(),
    ]);
    self::assertInstanceOf(BbTicket::class, $ticket);
    return $ticket;
  }

}
