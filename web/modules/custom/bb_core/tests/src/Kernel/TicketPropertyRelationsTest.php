<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Entity\Entity\EntityFormDisplay;
use Drupal\Core\Form\FormState;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Form\BbTicketPropertyForm;
use Drupal\bb_core\Ticket\TicketInspectorRows;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The detail view edits Parent and Blocked by within the ticket's project.
 *
 * The editor is a non-admin team member of workspace a: projects A and B
 * (workspace a) are readable, project C (workspace b) is not.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketPropertyRelationsTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  private const PARENT_ERROR = "Choose an open parent ticket from this ticket's project.";

  private const BLOCKER_ERROR = "Choose open blocking tickets from this ticket's project.";

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'island', 'bb_core',
  ];

  /**
   * Ticket ids keyed by name: host, a2, closed (project A), b1 (B), c1 (C).
   *
   * @var array<string, string>
   */
  private array $tickets = [];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->installConfig(['system', 'filter', 'bb_core']);
    $this->installPropertyDisplay();
    $this->buildTwoWorkspaceWorld();
    $this->container->get('theme_installer')->install(['bb_theme']);

    $project_a = $this->fixture('a', 'bb_project');
    $project_b = $this->createEntity('bb_project', [
      'name' => 'project-a-sibling',
      'group_id' => $project_a->get('group_id')->target_id,
      'teams' => [$this->fixture('a', 'bb_team')->id()],
      'owner_user_id' => $project_a->get('owner_user_id')->target_id,
    ]);
    $this->tickets = [
      'host' => (string) $this->fixture('a', 'bb_ticket')->id(),
      'a2' => $this->ticket('Second alpha', (string) $project_a->id()),
      'closed' => $this->ticket('Closed alpha', (string) $project_a->id(), TRUE),
      'b1' => $this->ticket('Beta ticket', (string) $project_b->id()),
      'c1' => (string) $this->fixture('b', 'bb_ticket')->id(),
    ];

    $editor = $this->createAccount('editor', [
      'view bb_workspace', 'view bb_project', 'view bb_ticket', 'update any bb_ticket',
    ]);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $editor, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $editor, []);
    $this->container->get('current_user')->setAccount($editor);
  }

  /**
   * Parent and Blocked by are pickers in Properties, offering open A tickets.
   */
  public function testPropertiesOfferOnlyOpenProjectTickets(): void {
    $cells = $this->propertyCells($this->load('host'));

    foreach (['Parent', 'Blocked by'] as $label) {
      self::assertSame('picker', $cells[$label]['kind'] ?? NULL, "$label is an editable picker.");
      $values = array_map('strval', array_column($cells[$label]['options'], 'value'));
      self::assertSame([$this->tickets['a2']], array_values(array_filter($values, static fn (string $v): bool => $v !== '')));
    }
  }

  /**
   * Parent and Blocked by no longer fill the Relations block.
   */
  public function testRelationsBlockNoLongerCarriesParentOrBlockedBy(): void {
    $host = $this->load('host');
    $host->set('parent_id', $this->tickets['a2'])->set('blocked_by', [$this->tickets['a2']])->save();
    $rows = $this->container->get('bb_core.ticket_inspector_rows');
    assert($rows instanceof TicketInspectorRows);

    self::assertSame([], $rows->groupBlock('relations', $rows->build($this->load('host'))));
  }

  /**
   * A closed ticket shows its relations without a picker.
   */
  public function testClosedTicketShowsRelationsReadOnly(): void {
    $cells = $this->propertyCells($this->load('closed'));

    self::assertNotSame('picker', $cells['Parent']['kind'] ?? NULL);
    self::assertNotSame('picker', $cells['Blocked by']['kind'] ?? NULL);
  }

  /**
   * New values from the project pass; foreign, closed or unreadable fail.
   */
  public function testNewValuesAreChecked(): void {
    $valid = ['parent_id' => $this->tickets['a2'], 'blocked_by' => [$this->tickets['a2']]];
    self::assertSame([], $this->errorsFor($valid));
    self::assertSame(['parent_id' => self::PARENT_ERROR], $this->errorsFor(['parent_id' => $this->tickets['closed']]));
    $mixed = ['blocked_by' => [$this->tickets['a2'], $this->tickets['b1']]];
    self::assertSame(['blocked_by' => self::BLOCKER_ERROR], $this->errorsFor($mixed));
    self::assertSame(['blocked_by' => self::BLOCKER_ERROR], $this->errorsFor(['blocked_by' => [$this->tickets['c1']]]));
  }

  /**
   * Relations already stored are kept when another property is saved.
   */
  public function testStoredForeignRelationsAreKept(): void {
    $host = $this->load('host');
    $host->set('parent_id', $this->tickets['b1'])->set('blocked_by', [$this->tickets['closed']])->save();

    self::assertSame([], $this->errorsFor(['priority' => 2]));
    self::assertSame([], $this->errorsFor(['blocked_by' => [$this->tickets['closed'], $this->tickets['a2']]]));
  }

  /**
   * Stored relations the editor can view show their titles, others stay hidden.
   */
  public function testStoredRelationsShowViewableTitles(): void {
    $host = $this->load('host');
    $host->set('parent_id', $this->tickets['b1'])->set('blocked_by', [$this->tickets['closed'], $this->tickets['c1']])->save();
    $cells = $this->propertyCells($this->load('host'));

    self::assertSame(['Beta ticket'], $cells['Parent']['value_labels']);
    self::assertSame(['Closed alpha', 'Unavailable selection (' . $this->tickets['c1'] . ')'], $cells['Blocked by']['value_labels']);
  }

  /**
   * The field errors the property form's relation rule reports.
   *
   * @param array<string, mixed> $values
   *   The changed field values.
   *
   * @return array<string, string>
   *   Messages keyed by field.
   */
  private function errorsFor(array $values): array {
    $stored = $this->load('host');
    $edited = clone $stored;
    foreach ($values as $field => $value) {
      $edited->set($field, $value);
    }
    $form_object = $this->container->get('entity_type.manager')->getFormObject('bb_ticket', 'property');
    self::assertInstanceOf(BbTicketPropertyForm::class, $form_object);
    $state = new FormState();
    $method = new \ReflectionMethod($form_object, 'rejectProjectScopedRelations');
    $method->invoke($form_object, EntityFormDisplay::collectRenderDisplay($edited, 'property'), $edited, $state, $stored);
    return array_map('strval', $state->getErrors());
  }

  /**
   * The property surface's value cells keyed by row label.
   *
   * @return array<string, array<string, mixed>>
   *   The cells.
   */
  private function propertyCells(BbTicketInterface $ticket): array {
    $form = $this->container->get('entity.form_builder')->getForm($ticket, 'property');
    $cells = [];
    foreach ($form['inspector']['#slots']['content']['#props']['items'] as $item) {
      $cells[(string) ($item['cells']['label']['value'] ?? '')] = $item['cells']['value'];
    }
    return $cells;
  }

  /**
   * Loads a fixture ticket fresh from storage.
   */
  private function load(string $name): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->loadUnchanged($this->tickets[$name]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Creates a saved ticket in a project and returns its id.
   */
  private function ticket(string $title, string $project, bool $closed = FALSE): string {
    return (string) $this->createEntity('bb_ticket', [
      'title' => $title,
      'workflow' => 'bb_feature',
      'project_id' => $project,
      'closed' => $closed,
    ])->id();
  }

  /**
   * Installs the shipped property form mode and display.
   */
  private function installPropertyDisplay(): void {
    $recipe = dirname(DRUPAL_ROOT) . '/recipes/bakers/config';
    $target = $this->container->get('config.storage');
    foreach ([
      'core.entity_form_mode.bb_ticket.property',
      'core.entity_form_display.bb_ticket.bb_ticket.property',
    ] as $name) {
      $data = Yaml::decode((string) file_get_contents($recipe . '/' . $name . '.yml'));
      $data['uuid'] = $this->container->get('uuid')->generate();
      $target->write($name, $data);
    }
  }

}
