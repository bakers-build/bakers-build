<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\DomCrawler\Crawler;

/**
 * The "Active conductors" table below the project Board.
 *
 * BAKERS-55 AC-19: `view.conductors.board` lists the project's active
 * conductors with their open tickets and load, ignoring the Board's filters;
 * the shared Load field reads "Unknown capacity" without a linked machine.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BoardConductorsDisplayTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use ProjectsViewTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'island', 'link', 'text', 'filter', 'markdown_easy', 'views',
    'block', 'path_alias',
    'better_exposed_filters', 'ui_patterns', 'ui_patterns_views',
    'ui_patterns_field', 'ui_patterns_field_formatters',
    'display_builder', 'display_builder_views', 'display_builder_entity_view',
    'bb_core',
  ];

  /**
   * The project under test.
   */
  private ContentEntityInterface $project;

  /**
   * Another project in the same workspace.
   */
  private ContentEntityInterface $elsewhere;

  /**
   * The workspace member who views the table.
   */
  private UserInterface $member;

  /**
   * The table carries the section title and the filter note.
   */
  public function testNamesTheSectionAndItsNote(): void {
    $this->conductor('Alpha', $this->project);
    $view = Views::getView('conductors');
    $view->setDisplay('board');

    self::assertSame('Active conductors', (string) $view->getTitle());
    self::assertSame('not affected by ticket filters', trim($this->table()->filter('header')->text()));
  }

  /**
   * A viewer outside the workspace.
   */
  private UserInterface $outsider;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_machine', 'bb_conductor', 'bb_ticket', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installEntitySchema('path_alias');
    $this->installConfig(['system', 'user', 'views']);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->installOgScopeFixture();
    // User 1 bypasses every access check; consume that uid.
    $this->account('root');

    $workspace = $this->create('bb_workspace', ['name' => 'bakers.build', 'slug' => 'bakers']);
    $group = $this->create('bb_group', ['name' => 'Group', 'workspace_id' => $workspace->id()]);
    $this->project = $this->create('bb_project', ['name' => 'Main', 'key' => 'BB', 'group_id' => $group->id()]);
    $this->elsewhere = $this->create('bb_project', ['name' => 'Else', 'key' => 'ELSE', 'group_id' => $group->id()]);

    $this->member = $this->account('member');
    $this->addMembership($workspace, $this->member, ['lead']);
    $this->outsider = $this->account('outsider');

    $this->installShippedView('views.view.conductors');
    $this->container->get('router.builder')->rebuild();
    $this->container->get('account_switcher')->switchTo($this->member);
  }

  /**
   * Active conductors of the project only: no inactive, no other project.
   */
  public function testListsActiveConductorsOfTheProject(): void {
    $this->conductor('Alpha', $this->project);
    $this->conductor('Beta', $this->project);
    $this->conductor('Dormant', $this->project, ['active' => FALSE]);
    $this->conductor('Elsewhere', $this->elsewhere);

    $names = $this->names();

    self::assertEqualsCanonicalizing(['Alpha', 'Beta'], $names);
  }

  /**
   * The Board's ticket filters leave the list unchanged.
   */
  public function testIgnoresBoardFilters(): void {
    $this->conductor('Alpha', $this->project);
    $this->conductor('Beta', $this->project);

    $this->container->get('request_stack')->getCurrentRequest()?->query->set('priority', [1]);
    $view = Views::getView('conductors');
    $view->setDisplay('board');
    $view->setExposedInput(['priority' => [1], 'state' => ['working']]);
    $view->setArguments([(string) $this->project->id()]);
    $view->preExecute();
    $view->execute();

    self::assertCount(2, $view->result);
    self::assertFalse($view->display_handler->usesExposed(), 'The display exposes no filter.');
  }

  /**
   * Without a linked machine, Load is "Unknown capacity", never a number.
   */
  public function testLoadReadsUnknownCapacityWithoutMachine(): void {
    $this->conductor('Alpha', $this->project, ['reported_load' => 2]);

    $load = $this->cell('Alpha', 'Load');

    self::assertSame('Unknown capacity', trim($load->text()));
    self::assertCount(0, $load->filter('meter'), 'No meter without a capacity.');
    self::assertDoesNotMatchRegularExpression('/\d|%/', $load->text());
  }

  /**
   * With a machine, Load shows current / max parallel runs and a meter.
   */
  public function testLoadShowsParallelRunsWithMachine(): void {
    $machine = $this->create('bb_machine', [
      'name' => 'Host',
      'host_key' => 'host-alpha',
      'owner_user_id' => $this->member->id(),
      'max_parallel' => 3,
      'current_load' => 2,
    ]);
    $this->conductor('Alpha', $this->project, ['machine' => $machine->id()]);

    $load = $this->cell('Alpha', 'Load');

    self::assertStringContainsString('2 / 3 parallel runs', preg_replace('/\s+/', ' ', $load->text()));
    $meter = $load->filter('meter');
    self::assertCount(1, $meter);
    self::assertSame('2', $meter->attr('value'));
    self::assertSame('3', $meter->attr('max'));
  }

  /**
   * Active tickets count the conductor's open tickets only.
   */
  public function testActiveTicketsCountOpenTicketsOfTheConductor(): void {
    $alpha = $this->conductor('Alpha', $this->project);
    $this->conductor('Beta', $this->project);
    $this->ticket($alpha, FALSE);
    $this->ticket($alpha, FALSE);
    $this->ticket($alpha, TRUE);

    self::assertSame('2', trim($this->cell('Alpha', 'Active tickets')->text()));
    self::assertSame('0', trim($this->cell('Beta', 'Active tickets')->text()));
  }

  /**
   * A viewer outside the project's workspace gets no rows.
   */
  public function testShowsNothingToViewerWithoutAccess(): void {
    $this->conductor('Alpha', $this->project);
    $this->container->get('account_switcher')->switchTo($this->outsider);

    self::assertSame([], $this->names());
  }

  /**
   * Renders the board display for the project; the table is its only content.
   */
  private function table(): Crawler {
    $build = Views::getView('conductors')->executeDisplay('board', [(string) $this->project->id()]);
    $html = $build === NULL ? '' : (string) $this->container->get('renderer')->renderInIsolation($build);
    return new Crawler($html);
  }

  /**
   * The conductor names of the rows, from the first column.
   *
   * @return list<string>
   *   One name per row.
   */
  private function names(): array {
    return $this->table()->filter('tbody tr')->each(static fn (Crawler $row): string => trim($row->filter('td')->first()->text()));
  }

  /**
   * One cell of the named conductor's row, by its column header.
   */
  private function cell(string $name, string $column): Crawler {
    $table = $this->table();
    $headers = $table->filter('thead th')->each(static fn (Crawler $th): string => trim($th->text()));
    $index = array_search($column, $headers, TRUE);
    self::assertIsInt($index, "No $column column in " . implode(', ', $headers));
    $row = $table->filter('tbody tr')->reduce(static fn (Crawler $row): bool => trim($row->filter('td')->first()->text()) === $name);
    self::assertCount(1, $row, "No single row is named $name.");
    return $row->filter('td')->eq($index);
  }

  /**
   * Creates a conductor on a project.
   *
   * @param string $label
   *   The conductor's label.
   * @param \Drupal\Core\Entity\ContentEntityInterface $project
   *   The project it belongs to.
   * @param array<string, mixed> $values
   *   Extra field values.
   */
  private function conductor(string $label, ContentEntityInterface $project, array $values = []): ContentEntityInterface {
    return $this->create('bb_conductor', $values + [
      'conductor_id' => 'reg-' . strtolower($label),
      'label' => $label,
      'project_id' => $project->id(),
      'owner_user_id' => $this->member->id(),
      'status' => 'online',
    ]);
  }

  /**
   * Creates a ticket assigned to a conductor, open or closed.
   */
  private function ticket(ContentEntityInterface $conductor, bool $closed): ContentEntityInterface {
    return $this->create('bb_ticket', [
      'title' => 'Ticket ' . $this->randomMachineName(),
      'state' => 'working',
      'workflow' => 'bb_work',
      'project_id' => $this->project->id(),
      'conductor_id' => $conductor->id(),
      'closed' => $closed,
    ]);
  }

  /**
   * Creates and saves an entity.
   *
   * @param string $entity_type_id
   *   The entity type to create.
   * @param array<string, mixed> $values
   *   The field values.
   */
  private function create(string $entity_type_id, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')->getStorage($entity_type_id)->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    $entity->save();
    return $entity;
  }

  /**
   * Creates a user with a role of its own and no site-wide permission.
   */
  private function account(string $name): UserInterface {
    $role_id = 'r_' . $name;
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    self::assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

}
