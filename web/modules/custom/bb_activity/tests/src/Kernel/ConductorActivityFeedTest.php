<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\Tests\bb_core\Kernel\ProjectsViewTestTrait;
use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Conductor listings, canonical route, and occupancy Overview.
 *
 * BB-619. Two collections: the user-area rail item Conductors is
 * the URL account's conductors; the project tab is that project's
 * conductors. The detail is
 * core's `_entity_view` of `bb_conductor.full`. Live occupancy is the
 * `bb_conductor_occupancy` source plus the `conductor_tickets` embed.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class ConductorActivityFeedTest extends KernelTestBase {

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
    'better_exposed_filters', 'ui_patterns', 'ui_patterns_views',
    'ui_patterns_field', 'ui_patterns_field_formatters',
    'display_builder', 'display_builder_views', 'display_builder_entity_view',
    'bb_core', 'bb_activity',
  ];

  /**
   * The workspace the fixtures live in.
   */
  private ContentEntityInterface $home;

  /**
   * A second workspace used for the cross-workspace assertions.
   */
  private ContentEntityInterface $other;

  /**
   * A labelled conductor in the home workspace.
   */
  private BbConductorInterface $labelled;

  /**
   * The project the home-workspace conductors belong to.
   */
  private ContentEntityInterface $homeProject;

  /**
   * A second project in the home workspace, for project-tab isolation.
   */
  private ContentEntityInterface $extraProject;

  /**
   * The project the foreign conductor belongs to.
   */
  private ContentEntityInterface $otherProject;

  /**
   * A home-workspace conductor owned by the contributor.
   */
  private BbConductorInterface $colleague;

  /**
   * Ranked accounts in the home workspace.
   *
   * @var array<string, \Drupal\user\UserInterface>
   */
  private array $accounts = [];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_machine', 'bb_conductor', 'bb_ticket', 'bb_activity', 'bb_notification_setting', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'views']);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->installOgScopeFixture();
    // User 1 bypasses every access check; consume that uid so the accounts
    // below are ordinary users whose verdicts this test can actually measure.
    $this->createAccount('root', []);

    $this->home = $this->create('bb_workspace', ['name' => 'bakers.build', 'slug' => 'bakers']);
    $this->other = $this->create('bb_workspace', ['name' => 'Other', 'slug' => 'other']);
    $home_group = $this->create('bb_group', [
      'name' => 'bakers.build group',
      'workspace_id' => $this->home->id(),
    ]);
    $this->homeProject = $this->create('bb_project', [
      'name' => 'bakers.build',
      'key' => 'BB',
      'group_id' => $home_group->id(),
    ]);
    $this->extraProject = $this->create('bb_project', [
      'name' => 'Extra',
      'key' => 'XTRA',
      'group_id' => $home_group->id(),
    ]);
    $other_group = $this->create('bb_group', [
      'name' => 'Other group',
      'workspace_id' => $this->other->id(),
    ]);
    $this->otherProject = $this->create('bb_project', [
      'name' => 'Other',
      'key' => 'OTHR',
      'group_id' => $other_group->id(),
    ]);

    foreach (['lead', 'contributor', 'guest'] as $rank) {
      $account = $this->createAccount($rank, []);
      $this->addMembership($this->home, $account, [$rank]);
      $this->accounts[$rank] = $account;
    }
    $this->addMembership($this->other, $this->accounts['lead'], ['lead']);

    $host = $this->create('bb_machine', [
      'name' => 'Host',
      'host_key' => 'host-alpha',
      'owner_user_id' => $this->accounts['lead']->id(),
      'max_parallel' => 4,
    ]);
    $labelled = $this->create('bb_conductor', [
      'conductor_id' => 'reg-alpha',
      'label' => 'Alpha',
      'project_id' => $this->homeProject->id(),
      'owner_user_id' => $this->accounts['lead']->id(),
      'status' => 'online',
      'reported_load' => 2,
      'machine' => $host->id(),
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $labelled);
    $this->labelled = $labelled;

    $blank = $this->create('bb_conductor', [
      'conductor_id' => 'reg-blank',
      'label' => '',
      'project_id' => $this->homeProject->id(),
      'owner_user_id' => $this->accounts['lead']->id(),
      'status' => 'offline',
      'reported_load' => 0,
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $blank);

    $colleague = $this->create('bb_conductor', [
      'conductor_id' => 'reg-colleague',
      'label' => 'Colleague',
      'project_id' => $this->homeProject->id(),
      'owner_user_id' => $this->accounts['contributor']->id(),
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $colleague);
    $this->colleague = $colleague;

    $extra = $this->create('bb_conductor', [
      'conductor_id' => 'reg-extra',
      'label' => 'Extra',
      'project_id' => $this->extraProject->id(),
      'owner_user_id' => $this->accounts['lead']->id(),
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $extra);

    $foreign = $this->create('bb_conductor', [
      'conductor_id' => 'reg-foreign',
      'label' => 'Foreign',
      'project_id' => $this->otherProject->id(),
      'owner_user_id' => $this->accounts['lead']->id(),
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $foreign);

    $orphan = $this->create('bb_conductor', [
      'conductor_id' => 'reg-orphan',
      'label' => 'Orphan',
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $orphan);

    $this->container->get('router.builder')->rebuild();
  }

  /**
   * The full view mode paints the feed and the inspector cards.
   */
  public function testFullViewModeRendersTheActivitiesZone(): void {
    $this->installOverviewDisplay();
    $this->actAs($this->accounts['lead']);
    $html = $this->renderFull($this->labelled);

    self::assertStringContainsString('Project', $html);
    self::assertStringContainsString('bakers.build', $html);
    self::assertStringContainsString('Activities', $html);
    self::assertStringContainsString('No activity yet.', $html);
    // One card beside the feed; the lead owns this conductor. The page shows
    // no status, last seen, load or states.
    self::assertStringContainsString('bb_theme:inspector', $html);
    // The Activities feed and the Identity card.
    self::assertSame(2, substr_count($html, 'data-zone-heading'));
    self::assertStringContainsString('Identity', $html);
    $gone = [
      'Configuration', 'Last seen', 'Reported load', 'Live occupancy',
      'No running tickets.', '/card/configuration',
    ];
    foreach ($gone as $text) {
      self::assertStringNotContainsString($text, $html);
    }
    // Disable/Enable is the Identity card's footer, after its form.
    $form = strpos($html, '/conductor/' . $this->labelled->id() . '/card/identity');
    self::assertNotFalse($form);
    self::assertGreaterThan($form, strpos($html, 'Disable conductor'));
  }

  /**
   * The feed lists this conductor's readable run entries, newest first.
   *
   * An entry naming the conductor without a run of it is not this
   * conductor's work and stays out.
   */
  public function testActivityFeedListsReadableEntriesNewestFirst(): void {
    $this->installOverviewDisplay();
    $older = $this->ticketOn($this->homeProject, 'Feed older');
    $newer = $this->ticketOn($this->homeProject, 'Feed newer');
    $hidden = $this->ticketOn($this->otherProject, 'Feed hidden');
    $sibling = $this->ticketOn($this->homeProject, 'Feed sibling');
    $this->activityOn($this->labelled, $older, 1000);
    $this->activityOn($this->labelled, $newer, 2000);
    $this->activityOn($this->labelled, $hidden, 3000);
    $this->activityOn($this->colleague, $sibling, 4000);
    $unattributed = $this->ticketOn($this->homeProject, 'Feed without run');
    $this->create('bb_activity', [
      'ticket_id' => $unattributed->id(),
      'kind' => 'claimed',
      'step' => 'working',
      'conductor_id' => $this->labelled->id(),
      'created' => 5000,
    ]);

    // The lead also belongs to the other workspace and reads every ticket.
    $this->actAs($this->accounts['lead']);
    $html = $this->renderFull($this->labelled);
    self::assertStringContainsString('Activities', $html);
    self::assertStringNotContainsString('No activity yet.', $html);
    self::assertStringNotContainsString($this->row($sibling), $html, 'Another conductor\'s entry is not listed.');
    self::assertStringNotContainsString($this->row($unattributed), $html, 'An entry without a run of this conductor is not listed.');
    $hidden_at = strpos($html, $this->row($hidden));
    $newer_at = strpos($html, $this->row($newer));
    $older_at = strpos($html, $this->row($older));
    self::assertNotFalse($hidden_at);
    self::assertNotFalse($newer_at);
    self::assertNotFalse($older_at);
    self::assertTrue($hidden_at < $newer_at && $newer_at < $older_at, 'Newest first.');
    self::assertSame(3, substr_count($html, 'started work in working'), 'One row per readable entry.');

    // A lead of the home workspace only cannot read the other's ticket.
    $home_lead = $this->createAccount('home-lead', []);
    $this->addMembership($this->home, $home_lead, ['lead']);
    $this->actAs($home_lead);
    $html = $this->renderFull($this->labelled);
    self::assertStringContainsString($this->row($newer), $html);
    self::assertStringContainsString($this->row($older), $html);
    self::assertStringNotContainsString($this->row($hidden), $html);
    self::assertSame(2, substr_count($html, 'started work in working'), 'The unreadable entry has no row.');
  }

  /**
   * How an event row names its ticket.
   */
  private function row(BbTicketInterface $ticket): string {
    return '>' . $ticket->getIdentifier() . '</a> started work in working';
  }

  /**
   * Independent occupancy oracle: request time 2000000000.
   *
   * @return array<string, array{0: string, 1: int|null, 2: bool}>
   *   State, claim_expires_at, expected live.
   */
  public static function liveOccupancyCases(): array {
    return [
      'running with past lease' => ['running', 1999999999, TRUE],
      'running with null lease' => ['running', NULL, TRUE],
      'claimed zero sentinel' => ['claimed', 0, TRUE],
      'claimed equal to now' => ['claimed', 2000000000, TRUE],
      'claimed in the future' => ['claimed', 2000000001, TRUE],
      'claimed already expired' => ['claimed', 1999999999, FALSE],
      'claimed sql null' => ['claimed', NULL, FALSE],
      'done with future lease' => ['done', 2000000001, FALSE],
      'failed with future lease' => ['failed', 2000000001, FALSE],
      'expired terminal' => ['expired', 2000000001, FALSE],
      'cancelled terminal' => ['cancelled', 2000000001, FALSE],
    ];
  }

  /**
   * Makes an account the current user for the requests that follow.
   */
  private function actAs(UserInterface $account): void {
    $this->container->get('current_user')->setAccount($account);
  }

  /**
   * Creates a user holding exactly the given permissions.
   *
   * @param string $name
   *   Username and role id stem.
   * @param array<string> $permissions
   *   Site-wide permissions granted on a dedicated role.
   */
  private function createAccount(string $name, array $permissions): UserInterface {
    $role_id = 'r_' . str_replace('-', '_', $name);
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    if ($permissions !== []) {
      user_role_grant_permissions($role_id, $permissions);
    }
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    self::assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates and saves an entity of the given type.
   *
   * @param string $entity_type_id
   *   The entity type to create.
   * @param array<string, mixed> $values
   *   The field values.
   */
  private function create(string $entity_type_id, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')
      ->getStorage($entity_type_id)
      ->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    $entity->save();
    return $entity;
  }

  /**
   * Creates a ticket on a project with a unique title.
   */
  private function ticketOn(ContentEntityInterface $project, string $title): BbTicketInterface {
    $ticket = $this->create('bb_ticket', [
      'title' => $title,
      'state' => 'working',
      'workflow' => 'bb_work',
      'project_id' => $project->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Records a claim of a ticket by a conductor at a given time.
   */
  private function activityOn(BbConductorInterface $conductor, BbTicketInterface $ticket, int $created): void {
    $run = $this->create('bb_run', [
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'owner_user_id' => $conductor->get('owner_user_id')->target_id,
      'state' => 'done',
      'state_at_start' => 'working',
    ]);
    $this->create('bb_activity', [
      'ticket_id' => $ticket->id(),
      'kind' => 'claimed',
      'step' => 'working',
      'run_id' => $run->id(),
      'conductor_id' => $conductor->id(),
      'created' => $created,
    ]);
  }

  /**
   * Renders the product Overview the way the canonical route does.
   */
  private function renderFull(BbConductorInterface $conductor): string {
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->installShippedView('views.view.conductor_tickets');
    $build = $this->container->get('entity_type.manager')
      ->getViewBuilder('bb_conductor')
      ->view($conductor, 'full');
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Writes the shipped config objects the `full` view mode needs.
   */
  private function installOverviewDisplay(): void {
    $this->installConfig(['display_builder']);
    $module = $this->container->get('extension.list.module')->getPath('bb_core');
    $recipe = dirname(DRUPAL_ROOT) . '/recipes/bakers/config';
    $target = $this->container->get('config.storage');
    foreach ([
      'core.entity_view_mode.bb_conductor.full' => $module . '/config/optional',
      'core.entity_view_display.bb_conductor.bb_conductor.full' => $recipe,
      // The feed renders each activity in its `full` event row, whose body
      // runs through check_markup('bb_rich').
      'filter.format.bb_rich' => $module . '/config/install',
      'core.entity_view_mode.bb_activity.full' => $this->container->get('extension.list.module')->getPath('bb_activity') . '/config/optional',
      'core.entity_view_display.bb_activity.bb_activity.full' => $recipe,
    ] as $name => $directory) {
      $file = $directory . '/' . $name . '.yml';
      self::assertFileExists($file, sprintf('%s ships on the recipe path.', $name));
      $data = Yaml::decode((string) file_get_contents($file));
      $data['uuid'] = $this->container->get('uuid')->generate();
      $target->write($name, $data);
    }
  }

}
