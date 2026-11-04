<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Component\Render\MarkupInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * Each ticket column renders ITSELF, through the table component's own macro.
 *
 * WHY THE ASSERTIONS ARE ON RENDERED MARKUP AND NOT ON A CELL ARRAY. Spec R9 is
 * the risk this test exists for: the reversal onto core's `table` style buys
 * back editability and pays for it by moving nine column faces into config,
 * where nothing types them. A test asserting that a formatter
 * returns `['kind' => 'badge', …]` would pass with the wrong formatter
 * configured on the column, and the presence of nine fields is what config
 * already guarantees. So every assertion here is on the string a reader sees.
 *
 * WHY THE FACES ARE ONE CODE PATH AND NOT TWO THAT AGREE. `cell()` is a macro
 * inside a component and a component id is the one portable address in this
 * theme, so a formatter imports the very macro a table cell renders (spec F14).
 * That is asserted rather than assumed: the badge markup below is the badge
 * component's own, reached through `cell()`, so a face changed in `table.twig`
 * changes here too.
 *
 * `ui_patterns` IS IN THE MODULE LIST DELIBERATELY. It injects
 * `_ui_patterns_normalize_props` into every SDC component template whatever
 * built the render array (spec F3, re-measured in F12 probe `1f`), so a list
 * without it would render in a configuration the site never runs in.
 */
#[Group('bb_core')]
final class TicketCellFormattersTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views', 'ui_patterns', 'bb_core',
  ];

  /**
   * The project every seeded ticket belongs to.
   */
  private ContentEntityInterface $project;

  /**
   * The reader every render below is performed for.
   *
   * An ADMINISTRATOR, deliberately. Two of the three reference cells resolve
   * their label through `view label` access (spec D12), which is a real gate
   * with its own coverage — `TicketFacetLabelsTest` and
   * `TicketIndexReadScopeTest` own it. This test's subject is the nine FACES,
   * so an account that can be told what everything is called is what keeps a
   * failure here meaning "the face is wrong" rather than "the grant is".
   */
  private AccountInterface $reader;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_project',
      'bb_ticket', 'bb_run', 'bb_conductor',
    ] as $entity_type_id) {
      $this->installEntitySchema($entity_type_id);
    }
    $this->installConfig(['user']);
    $this->reader = $this->setUpCurrentUser([], [], TRUE);
    // The identifier cell is the ticket's route link, so the route has to
    // exist before toUrl() is asked for it.
    $this->container->get('router.builder')->rebuild();
    // Without the theme `bb_theme:table` does not resolve and the macro the
    // formatters import cannot be reached at all.
    $this->container->get('theme_installer')->install(['bb_theme']);

    $workspace = $this->create('bb_workspace', ['name' => 'bakers.build', 'slug' => 'bakers']);
    $group = $this->create('bb_group', [
      'name' => 'Group',
      'workspace_id' => $workspace->id(),
    ]);
    $this->project = $this->create('bb_project', [
      'name' => 'bakers.build Platform',
      'key' => 'wire',
      'group_id' => $group->id(),
    ]);
  }

  /**
   * The identifier is the route link, in the machine face.
   */
  public function testTheIdentifierIsTheMonospacedRouteLink(): void {
    $ticket = $this->ticket();
    $html = $this->cell($ticket, 'identifier', 'bb_ticket_identifier_cell');

    self::assertStringContainsString('<a ', $html);
    self::assertStringContainsString('font-mono', $html);
    self::assertStringContainsString((string) $ticket->get('identifier')->value, $html);
    self::assertStringContainsString(
      'href="' . $ticket->toUrl()->toString() . '"',
      $html,
      'The identifier cell is the row\'s visible affordance and must reach the ticket.',
    );
  }

  /**
   * The state glyph is named by the workflow's label.
   *
   * The running phase is the filled disc; every other open state is the
   * empty ring.
   *
   * `working` is the running phase of bb_work.
   */
  public function testTheStateIconIsFilledOnlyWhileWorking(): void {
    $cases = [
      ['bb_work', 'working', TRUE],
      ['bb_work', 'review', FALSE],
      ['bb_work', 'plan', FALSE],
    ];
    foreach ($cases as [$workflow, $state, $working]) {
      $ticket = $this->ticket(['workflow' => $workflow, 'state' => $state]);
      $item = $ticket->get('state')->first();
      self::assertInstanceOf(StateItemInterface::class, $item);
      $label = (string) $item->getLabel();
      $html = $this->cell($ticket, 'state', 'bb_ticket_state_icon_cell');
      $case = sprintf('%s %s', $workflow, $state);

      self::assertStringContainsString('role="img"', $html);
      self::assertStringContainsString('title="' . $label . '"', $html);
      self::assertStringContainsString('aria-label="' . $label . '"', $html);
      if ($working) {
        self::assertStringContainsString('#status-running', $html, $case);
        self::assertStringContainsString('text-text', $html, $case);
        self::assertStringNotContainsString('text-text-faint', $html, $case);
      }
      else {
        self::assertStringContainsString('#status-prepare', $html, $case);
        self::assertStringContainsString('text-text-faint', $html, $case);
      }
    }
  }

  /**
   * The assignee mark hides the name in a tooltip, the placeholder included.
   */
  public function testTheAssigneeMarkNamesThePersonInItsTooltip(): void {
    $assigned = $this->cell($this->ticket(['assignee_user_id' => $this->reader->id()]), 'assignee_user_id', 'bb_ticket_assignee_avatar_cell');
    $name = (string) $this->reader->getDisplayName();
    self::assertStringContainsString('title="' . $name . '"', $assigned);
    self::assertStringContainsString('role="img"', $assigned);
    self::assertDoesNotMatchRegularExpression('/>\s*' . preg_quote($name, '/') . '\s*</', $assigned, 'The name is not printed.');

    $unassigned = $this->cell($this->ticket(), 'assignee_user_id', 'bb_ticket_assignee_avatar_cell');
    self::assertStringContainsString('title="Unassigned"', $unassigned);
  }

  /**
   * A creator renders as a person; a vanished creator renders nothing.
   */
  public function testTheCreatorRendersAndItsAbsenceRendersNothing(): void {
    $owned = $this->cell($this->ticket(['owner_user_id' => $this->reader->id()]), 'owner_user_id', 'bb_ticket_owner_cell');
    self::assertStringContainsString((string) $this->reader->getDisplayName(), $owned);
    self::assertStringContainsString('data-component-id="bb_theme:person"', $owned);

    $view = fn (int $uid): array => $this->flatten(
      $this->ticket(['owner_user_id' => $uid])->get('owner_user_id')->view([
        'type' => 'bb_ticket_owner_cell',
        'label' => 'hidden',
      ]),
    );
    // The field is required, so the absence is an account deleted since.
    self::assertSame([], $view(987654), 'No creator is no cell, not "Unassigned".');
    self::assertSame([], $view(0), 'The anonymous account is nobody, not "Anonymous".');
  }

  /**
   * The state badge reads the workflow's own label, not the raw state id.
   *
   * Asserted against `StateItemInterface::getLabel()` rather than against a
   * hand-typed 'Working': that method is the mapping `bb_state_label` reads,
   * and a second state vocabulary in this formatter is exactly the defect
   * spec D12 argues against for the facets.
   */
  public function testTheStateBadgeReadsTheWorkflowsOwnLabel(): void {
    $ticket = $this->ticket(['state' => 'working']);
    $html = $this->cell($ticket, 'state', 'bb_ticket_state_cell');

    $item = $ticket->get('state')->first();
    self::assertInstanceOf(StateItemInterface::class, $item);
    $label = (string) $item->getLabel();

    self::assertSame('Working', $label, 'The workflow definition is the source of the label.');
    self::assertStringContainsString('data-badge-label', $html);
    self::assertStringContainsString($label, $html);
    self::assertStringNotContainsString('>working<', $html);
  }

  /**
   * Priority reads the field's own allowed value, in one vocabulary only.
   *
   * `P1` was a second vocabulary invented in PHP by the deleted presenter,
   * while the facet read `High` from `options_allowed_values()`. A reader
   * filtered by `High` and then read `P1` in the row they had filtered.
   */
  public function testThePriorityReadsTheFieldsOwnAllowedValueAndNeverP1(): void {
    foreach ([1 => 'High', 2 => 'Medium', 3 => 'Low'] as $value => $expected) {
      $ticket = $this->ticket(['priority' => $value]);
      $html = $this->cell($ticket, 'priority', 'bb_ticket_priority_cell');

      self::assertStringContainsString($expected, $html);
      self::assertStringNotContainsString('P' . $value, $html);
    }
  }

  /**
   * The highest priority is the one tone that says "this one is first".
   */
  public function testTheHighestPriorityCarriesTheCriticalTone(): void {
    $critical = $this->cell($this->ticket(['priority' => 1]), 'priority', 'bb_ticket_priority_cell');
    $ordinary = $this->cell($this->ticket(['priority' => 3]), 'priority', 'bb_ticket_priority_cell');

    self::assertStringContainsString('state-unassigned-tint', $critical);
    self::assertStringNotContainsString('state-unassigned-tint', $ordinary);
  }

  /**
   * An assigned ticket names its person.
   */
  public function testAnAssignedTicketRendersItsPersonCell(): void {
    $user = $this->createUser([], 'Ada Lovelace');
    self::assertInstanceOf(AccountInterface::class, $user);
    $ticket = $this->ticket(['assignee_user_id' => $user->id()]);
    $html = $this->cell($ticket, 'assignee_user_id', 'bb_ticket_assignee_cell');

    self::assertStringContainsString('person', $html);
    self::assertStringContainsString('Ada Lovelace', $html);
    self::assertStringContainsString('AL', $html, 'The compact identity is initials plus a name.');
  }

  /**
   * An unclaimed ticket is NAMED rather than dashed.
   *
   * The em-dash is for a column with no data path; an unassigned ticket is a
   * state somebody acts on, so it says so. This is also the one column whose
   * formatter has to render for an EMPTY item list, which
   * `EntityViewDisplay::buildMultiple()` does call.
   */
  public function testAnUnassignedTicketReadsUnassignedAndNotAnEmptyCell(): void {
    $html = $this->cell($this->ticket(), 'assignee_user_id', 'bb_ticket_assignee_cell');

    // Named, and drawn as a neutral placeholder mark beside the people
    // around it rather than as bare text.
    self::assertStringContainsString('Unassigned', $html);
    self::assertStringContainsString('data-component-id="bb_theme:person"', $html);
    self::assertMatchesRegularExpression('/data-person-mark[^>]*>\?</', $html);
    self::assertStringContainsString('bg-avatar-stone', $html);
  }

  /**
   * A conductor's hold on a ticket is a lease, in the machine face.
   */
  public function testTheConductorRendersAsTheLeaseBadgeWithLock(): void {
    $ticket = $this->ticket(['conductor_id' => $this->conductor()->id()]);
    $html = $this->cell($ticket, 'conductor_id', 'bb_ticket_conductor_cell');

    self::assertStringContainsString('cw-framework', $html);
    self::assertStringContainsString('state-lease-tint', $html);
    self::assertStringContainsString('font-mono', $html);
    self::assertStringContainsString('#lock', $html);
  }

  /**
   * The lease is `mine` by the ASSIGNEE, and is set rather than defaulted away.
   *
   * The component declares `mine` for a lease belonging to the reader rather
   * than to somebody else, and the deleted presenter never populated it — so
   * the delivered screen never made the distinction. The reader's own stake in
   * a ticket is being assigned it; the conductor's owner is a different
   * question and would answer it about the machine rather than about the
   * reader.
   */
  public function testTheLeaseIsMineWhenTheReaderIsTheTicketsAssignee(): void {
    $other = $this->createUser([], 'Somebody Else');
    self::assertInstanceOf(AccountInterface::class, $other);
    $conductor = $this->conductor();

    $mine = $this->cell(
      $this->ticket(['conductor_id' => $conductor->id(), 'assignee_user_id' => $this->reader->id()]),
      'conductor_id',
      'bb_ticket_conductor_cell',
    );
    $theirs = $this->cell(
      $this->ticket(['conductor_id' => $conductor->id(), 'assignee_user_id' => $other->id()]),
      'conductor_id',
      'bb_ticket_conductor_cell',
    );

    self::assertStringContainsString('outline-state-lease', $mine);
    self::assertStringNotContainsString('outline-state-lease', $theirs);
  }

  /**
   * Every cell face is reached through `cell()` and returns real markup.
   *
   * The guard against a formatter growing markup of its own: the render array
   * every one of them returns is an `inline_template` that imports
   * `bb_theme:table`, so a face added here without the macro would not carry
   * the import.
   */
  public function testEveryFormatterRendersThroughTheComponentsOwnMacro(): void {
    foreach ([
      'identifier' => 'bb_ticket_identifier_cell',
      'state' => 'bb_ticket_state_cell',
      'priority' => 'bb_ticket_priority_cell',
      'assignee_user_id' => 'bb_ticket_assignee_cell',
      'conductor_id' => 'bb_ticket_conductor_cell',
    ] as $field => $formatter_id) {
      $build = $this->ticket([
        'priority' => 2,
        'conductor_id' => $this->conductor()->id(),
        'assignee_user_id' => $this->reader->id(),
      ])->get($field)->view([
        'type' => $formatter_id,
        'label' => 'hidden',
      ]);
      $flat = $this->flatten($build);
      self::assertNotEmpty($flat, sprintf('%s produced no element.', $formatter_id));
      foreach ($flat as $element) {
        self::assertSame('inline_template', $element['#type'] ?? NULL);
        self::assertStringContainsString(
          "import 'bb_theme:table'",
          (string) $element['#template'],
          sprintf('%s must reach the faces through the component macro.', $formatter_id),
        );
      }
    }
  }

  /**
   * Every formatter's output renders to a MarkupInterface, never an array.
   *
   * Load-bearing rather than tidy: the `rendered` cell prop is declared
   * `string` and core's validator REJECTS a render array there (spec F12,
   * probe 1d), which is what forces a field handler's output to be rendered
   * before it is mapped into a cell.
   */
  public function testTheRenderedOutputIsMarkupAndNotRenderArray(): void {
    $build = $this->ticket()->get('identifier')->view([
      'type' => 'bb_ticket_identifier_cell',
      'label' => 'hidden',
    ]);
    $rendered = $this->container->get('renderer')->renderInIsolation($build);

    self::assertInstanceOf(MarkupInterface::class, $rendered);
  }

  /**
   * Renders one field of one ticket with one formatter.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param string $field
   *   The field name.
   * @param string $formatter_id
   *   The formatter plugin id.
   *
   * @return string
   *   The rendered markup.
   */
  private function cell(BbTicketInterface $ticket, string $field, string $formatter_id): string {
    $build = $ticket->get($field)->view([
      'type' => $formatter_id,
      'label' => 'hidden',
    ]);
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * The formatter elements of a field build, without the field wrapper.
   *
   * @param array<string|int, mixed> $build
   *   The field's render array.
   *
   * @return array<int, array<string, mixed>>
   *   The per-delta elements.
   */
  private function flatten(array $build): array {
    $elements = [];
    foreach ($build as $key => $value) {
      if (is_int($key) && is_array($value)) {
        $elements[] = $value;
      }
    }
    return $elements;
  }

  /**
   * A saved conductor in the seeded workspace.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The conductor.
   */
  private function conductor(): ContentEntityInterface {
    return $this->create('bb_conductor', [
      'label' => 'cw-framework',
      'workspace_id' => $this->workspaceId(),
    ]);
  }

  /**
   * The workspace the seeded project's group belongs to.
   *
   * @return string
   *   The workspace id.
   */
  private function workspaceId(): string {
    $group = $this->project->get('group_id')->entity;
    self::assertInstanceOf(ContentEntityInterface::class, $group);
    return (string) $group->get('workspace_id')->target_id;
  }

  /**
   * A saved ticket in the seeded project.
   *
   * @param array<string, mixed> $values
   *   Field values, applied over the defaults.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   The ticket.
   */
  private function ticket(array $values = []): BbTicketInterface {
    $ticket = $this->create('bb_ticket', $values + [
      'title' => 'Wire the ticket list',
      'workflow' => 'bb_work',
      'state' => 'working',
      'project_id' => $this->project->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Creates and saves an entity.
   *
   * @param string $entity_type_id
   *   The entity type id.
   * @param array<string, mixed> $values
   *   The field values.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved entity.
   */
  private function create(string $entity_type_id, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')
      ->getStorage($entity_type_id)
      ->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    $entity->save();
    return $entity;
  }

}
