<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\bb_activity\Activity\EntityDetailActivities;
use Drupal\bb_core\Entity\BbTerm;
use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The Activities zone of the project Overview, and the feed rows it lists.
 *
 * The Overview lists compact rows; team, group, machine and conductor pages
 * keep the full row, rendered here through the activity's `full` view mode.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class ProjectActivityFeedTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og', 'island',
    'search_api',
    'bb_core', 'bb_activity', 'views',
    'display_builder', 'display_builder_entity_view',
    'ui_patterns', 'ui_patterns_field', 'ui_patterns_field_formatters',
    'bb_property_access_test',
  ];

  /**
   * The project the Overview renders.
   */
  private BbProjectInterface $project;

  /**
   * {@inheritdoc}
   *
   * A failed run's error log is a private file; core registers the private
   * stream wrapper only when the path is set at container-build time.
   */
  public function register(ContainerBuilder $container): void {
    parent::register($container);
    $container->register('stream_wrapper.private', 'Drupal\Core\StreamWrapper\PrivateStream')
      ->addTag('stream_wrapper', ['scheme' => 'private']);
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_group',
      'bb_project', 'bb_environment', 'bb_conductor', 'bb_ticket',
      'bb_run', 'bb_comment', 'bb_activity', 'bb_notification_setting', 'file', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    $this->installConfig(['system', 'user', 'display_builder']);
    $this->installOverviewDisplay();
    $this->setUpCurrentUser(['uid' => 1], ['administer bakers']);
    $this->container->get('router.builder')->rebuild();

    $storage = $this->container->get('entity_type.manager');
    $workspace = $storage->getStorage('bb_workspace')
      ->create(['name' => 'Acme', 'slug' => 'acme']);
    $workspace->save();
    $group = $storage->getStorage('bb_group')
      ->create(['name' => 'Acme group', 'workspace_id' => $workspace->id()]);
    $group->save();
    $team = $storage->getStorage('bb_team')
      ->create(['name' => 'Platform Crew', 'workspace_id' => $workspace->id()]);
    $team->save();
    $project = $storage->getStorage('bb_project')->create([
      'name' => 'bakers.build Platform',
      'key' => 'BB',
      'group_id' => $group->id(),
      'teams' => [$team->id()],
      'description' => 'The settings note on Overview.',
      'repository' => ['url' => 'https://git.example/bakers.git', 'default_branch' => 'main'],
    ]);
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $project->save();
    $this->project = $project;

    $environment = $storage->getStorage('bb_environment')->create([
      'name' => 'production',
      'project_id' => $project->id(),
    ]);
    $environment->save();
    $reloaded = $storage->getStorage('bb_project')->load($project->id());
    self::assertInstanceOf(BbProjectInterface::class, $reloaded);
    $this->project = $reloaded;
  }

  /**
   * A project without tickets has no Activities zone; one with tickets does.
   */
  public function testNoActivitiesZoneForProjectWithoutTickets(): void {
    $html = $this->renderMode('full');
    self::assertStringNotContainsString('Activities', $html);
    self::assertStringNotContainsString('No activity yet.', $html);

    $ticket = $this->workTicket('Quiet ticket');
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_activity');
    $storage->delete($storage->loadByProperties(['ticket_id' => $ticket->id()]));
    $html = $this->renderMode('full');
    self::assertStringContainsString('Activities', $html);
    self::assertStringContainsString('No activity yet.', $html);
  }

  /**
   * The Overview lists compact rows: who, what, ticket, when; no tag or role.
   */
  public function testOverviewRowsAreCompact(): void {
    $ticket = $this->workTicket('Compact work');
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->save();

    $row = $this->row($this->renderMode('full'), 'qualification → plan');
    self::assertStringContainsString('href="' . $ticket->toUrl()->toString() . '"', $row);
    self::assertStringContainsString('>' . $ticket->getIdentifier() . '<', $row);
    self::assertStringContainsString('<time', $row);
    self::assertStringNotContainsString('data-tag=', $row);
    self::assertStringNotContainsString('>human<', $row);
    self::assertStringContainsString('data-tag="status"', $this->row($this->fullRows(), 'qualification → plan'));
  }

  /**
   * The Overview's compact rows sit edge to edge; full rows keep the gap.
   */
  public function testZoneGapFollowsTheRowKind(): void {
    $this->workTicket('Gap work');
    $team = $this->project->get('teams')->entity;
    self::assertInstanceOf(EntityInterface::class, $team);

    self::assertSame('none', $this->activitiesZone($this->project)['#props']['gap'] ?? NULL);
    self::assertSame('sm', $this->activitiesZone($team)['#props']['gap'] ?? NULL);
  }

  /**
   * The shipped Overview display places the Activities zone in the main slot.
   */
  public function testFullViewModePlacesActivitiesInTheMain(): void {
    $display = Yaml::decode((string) file_get_contents(
      dirname(DRUPAL_ROOT) . '/recipes/bakers/config/core.entity_view_display.bb_project.bb_project.full.yml',
    ));
    $canvas = $display['third_party_settings']['display_builder']['sources'][0];
    $main = $canvas['source']['component']['slots']['main']['sources'];
    $ids = array_column($main, 'node_id');
    self::assertSame('project_activities', $ids[3] ?? NULL, 'Activities follow metrics, Needs attention and Epics.');
    self::assertSame('bb_entity_detail_activities', $main[3]['source_id']);
  }

  /**
   * Activities lists one structured row per event and skips the empty copy.
   */
  public function testFullViewModeShowsActivityEvents(): void {
    $ticket = $this->workTicket('Shipped search');
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->save();
    $this->epicTicket('Hidden epic', 'done');

    $overview = $this->renderMode('full');
    self::assertStringContainsString('Activities', $overview);
    self::assertStringNotContainsString('No activity yet.', $overview);

    $html = $this->fullRows();
    $link = '<a href="' . $ticket->toUrl()->toString() . '" class="font-semibold">' . $ticket->getIdentifier() . '</a>';
    self::assertStringContainsString($link . ' qualification → plan', $html);
    self::assertStringContainsString($link . ' created (work, qualification)', $html);
    self::assertStringContainsString('data-tag="status"', $html);
    self::assertStringContainsString('>human<', $html);
    self::assertStringNotContainsString('Shipped search', $html);
  }

  /**
   * A state change that closed a run names the agent, its run and summary.
   */
  public function testAgentStatusRowShowsModelDurationAndLinks(): void {
    $ticket = $this->workTicket('Agent work');
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->save();
    $conductor = $this->conductor('overview-conductor');
    $run = $this->createRun($ticket, $conductor, 'plan', 'running', [
      'model' => 'claude-opus-5-5',
      'harness' => 'claude',
      'started_at' => (int) $this->container->get('datetime.time')->getCurrentTime() - 840,
    ]);
    $summary = $this->container->get('entity_type.manager')->getStorage('bb_comment')->create([
      'ticket_id' => $ticket->id(),
      'author' => 1,
      'body' => ['value' => 'Done.', 'format' => 'bb_rich'],
      'type' => 'summary',
      'created' => $this->container->get('datetime.time')->getCurrentTime(),
    ]);
    $summary->save();
    $ticket->getState()->applyTransitionById('to_working');
    $ticket->save();

    $html = $this->fullRows();
    self::assertStringContainsString('plan → working', $html);
    self::assertStringContainsString('claude-opus-5-5', $html);
    self::assertStringContainsString('>agent<', $html);
    self::assertStringContainsString('overview-conductor · 14 min', $html);
    self::assertStringContainsString('<a href="' . $summary->toUrl()->toString() . '">Summary</a>', $html);
    self::assertStringContainsString('<a href="' . $run->toUrl()->toString() . '">Run</a>', $html);
  }

  /**
   * An agent row stays an agent row when its run is hidden or deleted.
   */
  public function testAgentRoleSurvivesHiddenAndDeletedRun(): void {
    $ticket = $this->workTicket('Hidden run');
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->save();
    $run = $this->createRun($ticket, $this->conductor('hidden-conductor'), 'plan', 'running', [
      'model' => 'claude-opus-5-5',
      'harness' => 'claude',
    ]);
    $ticket->getState()->applyTransitionById('to_working');
    $ticket->save();
    // A workspace guest reads tickets but not runs.
    $this->installOgScopeFixture();
    $member = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $member);
    $entity_type_manager = $this->container->get('entity_type.manager');
    foreach (['bb_workspace' => ['guest'], 'bb_team' => []] as $type => $roles) {
      $groups = $entity_type_manager->getStorage($type)->loadMultiple();
      $group = reset($groups);
      self::assertInstanceOf(ContentEntityInterface::class, $group);
      $this->addMembership($group, $member, $roles);
    }
    $this->setCurrentUser($member);
    self::assertFalse($run->access('view'));

    $row = $this->row($this->fullRows(), 'plan → working');
    self::assertStringContainsString('>agent<', $row);
    self::assertStringNotContainsString('>human<', $row);
    self::assertStringNotContainsString('Run</a>', $row);
    self::assertStringNotContainsString('claude-opus-5-5', $row);

    $run->delete();
    $row = $this->row($this->fullRows(), 'plan → working');
    self::assertStringContainsString('>agent<', $row);
    self::assertStringNotContainsString('Run</a>', $row);
  }

  /**
   * An agent row names the harness besides the model.
   */
  public function testAgentRowNamesHarnessAndModel(): void {
    $ticket = $this->workTicket('Harness work');
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->save();
    $this->createRun($ticket, $this->conductor('harness-conductor'), 'plan', 'running', [
      'model' => 'claude-opus-5-5',
      'harness' => 'claude-code',
    ]);
    $ticket->getState()->applyTransitionById('to_working');
    $ticket->save();

    $row = $this->row($this->fullRows(), 'plan → working');
    self::assertStringContainsString('claude-opus-5-5', $row);
    self::assertStringContainsString('claude-code · harness-conductor', $row);
  }

  /**
   * A created row names the workflow and first state and carries no role.
   */
  public function testCreatedRowNamesWorkflowWithoutRole(): void {
    $this->workTicket('Fresh ticket');

    $row = $this->row($this->fullRows(), 'created');
    self::assertStringContainsString('created (work, qualification)', $row);
    self::assertStringNotContainsString('>agent<', $row);
    self::assertStringNotContainsString('>human<', $row);
  }

  /**
   * Expired and cancelled runs show their outcome as the tag.
   */
  public function testExpiredAndCancelledRunsShowTheirOutcome(): void {
    $ticket = $this->workTicket('Abandoned work');
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->save();
    $conductor = $this->conductor('abandon-conductor');
    $this->createRun($ticket, $conductor, 'plan', 'claimed', [])->setRunState('expired')->save();
    $this->createRun($ticket, $conductor, 'plan', 'claimed', [])->setRunState('cancelled')->save();

    $html = $this->fullRows();
    self::assertStringContainsString('data-tag="expired"', $this->row($html, 'run expired in plan'));
    self::assertStringContainsString('data-tag="cancelled"', $this->row($html, 'run cancelled in plan'));
  }

  /**
   * A failed run shows its outcome as the tag and its first error line.
   */
  public function testFailedRunRowShowsOutcomeAndFirstErrorLine(): void {
    $ticket = $this->workTicket('Failing work');
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->save();
    $run = $this->createRun($ticket, $this->conductor('failing-conductor'), 'plan', 'claimed', []);
    $run->set('error_log', "\nsetup: worktree missing\nstack line");
    $run->setRunState('failed')->save();

    $html = $this->fullRows();
    self::assertStringContainsString('data-tag="failed"', $html);
    self::assertStringContainsString('run failed in plan', $html);
    self::assertStringContainsString('<code>setup: worktree missing</code>', $html);
    self::assertStringNotContainsString('stack line', $html);
  }

  /**
   * A claim row written before rows referenced runs still renders, roleless.
   */
  public function testLegacyClaimRowRendersWithoutAgentDetails(): void {
    $ticket = $this->workTicket('Old claim');
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->save();
    $conductor = $this->conductor('legacy-conductor');
    $this->container->get('entity_type.manager')->getStorage('bb_activity')->create([
      'ticket_id' => $ticket->id(),
      'kind' => 'claimed',
      'step' => 'plan',
      'conductor_id' => $conductor->id(),
      'actor' => 1,
      'workflow' => 'bb_work',
    ])->save();

    $row = $this->row($this->fullRows(), 'started work in plan');
    self::assertStringContainsString('data-tag="started"', $row);
    self::assertStringContainsString('legacy-conductor', $row);
    self::assertStringNotContainsString('>agent<', $row);
    self::assertStringNotContainsString('>human<', $row);
  }

  /**
   * A denied actor field renders as System, not the account name.
   */
  public function testActivityActorFallsBackWhenTheFieldIsDenied(): void {
    $actor = $this->createUser([], 'Ada Overview');
    self::assertInstanceOf(UserInterface::class, $actor);
    $this->setCurrentUser($actor);
    $ticket = $this->workTicket('Named actor');
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->save();

    $this->container->get('state')->set('bb_property_access_test.denied', [
      'view' => ['actor'],
    ]);
    $admin = $this->container->get('entity_type.manager')->getStorage('user')->load(1);
    self::assertInstanceOf(UserInterface::class, $admin);
    $this->setCurrentUser($admin);
    $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_activity')
      ->resetCache();

    $html = $this->fullRows();
    self::assertStringContainsString('System', $html);
    self::assertStringNotContainsString('Ada Overview', $html);
  }

  /**
   * Renders a shipped project view mode.
   */
  private function renderMode(string $mode): string {
    $this->container->get('theme_installer')->install(['bb_theme']);
    $build = $this->container->get('entity_type.manager')
      ->getViewBuilder('bb_project')
      ->view($this->project, $mode);
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * The Activities zone the detail-page source builds for an entity.
   *
   * @return array<string, mixed>
   *   The `bb_theme:zone` render array.
   */
  private function activitiesZone(EntityInterface $entity): array {
    $schema = $this->container->get('plugin.manager.ui_patterns_prop_type')->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance('bb_entity_detail_activities', SourcePluginBase::buildConfiguration('content', $schema, ['source' => []], []));
    self::assertInstanceOf(SourcePluginBase::class, $source);
    $source->setContextValue('entity', $entity);
    $zone = $source->getPropValue();
    self::assertIsArray($zone);
    return $zone;
  }

  /**
   * The project's feed as full rows, as the other detail pages list them.
   */
  private function fullRows(): string {
    $this->container->get('theme_installer')->install(['bb_theme']);
    $builder = $this->container->get('entity_type.manager')->getViewBuilder('bb_activity');
    $html = '';
    foreach ($this->container->get(EntityDetailActivities::class)->activities($this->project) as $activity) {
      $build = $builder->view($activity, 'full');
      $html .= (string) $this->container->get('renderer')->renderInIsolation($build);
    }
    return $html;
  }

  /**
   * The one rendered event row that contains the needle.
   */
  private function row(string $html, string $needle): string {
    $rows = array_values(array_filter(
      explode('<article', $html),
      static fn (string $chunk): bool => str_contains($chunk, $needle),
    ));
    self::assertCount(1, $rows, 'Exactly one event row contains ' . $needle);
    return $rows[0];
  }

  /**
   * A work ticket on the fixture project.
   */
  private function workTicket(string $title): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'title' => $title,
        'workflow' => 'bb_work',
        'project_id' => $this->project->id(),
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * A conductor of the fixture project.
   */
  private function conductor(string $label): BbConductorInterface {
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => $label,
      'label' => $label,
      'owner_user_id' => 1,
      'status' => 'online',
      'project_id' => $this->project->id(),
      'states' => ['plan'],
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    return $conductor;
  }

  /**
   * A saved run of the ticket started in the given state.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor running it.
   * @param string $step
   *   The ticket state the run started in.
   * @param string $state
   *   The run state.
   * @param array<string, mixed> $values
   *   Extra run field values.
   */
  private function createRun(BbTicketInterface $ticket, BbConductorInterface $conductor, string $step, string $state, array $values): BbRunInterface {
    $run = $this->container->get('entity_type.manager')->getStorage('bb_run')->create($values + [
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'owner_user_id' => 1,
      'state' => $state,
      'state_at_start' => $step,
    ]);
    self::assertInstanceOf(BbRunInterface::class, $run);
    $run->save();
    return $run;
  }

  /**
   * An epic ticket on the fixture project.
   */
  private function epicTicket(string $title, string $state = 'working'): BbTicketInterface {
    if (!BbVocabulary::load('type')) {
      BbVocabulary::create(['id' => 'type', 'label' => 'type'])->save();
    }
    $epic = BbTerm::create(['vid' => 'type', 'name' => 'epic']);
    $epic->save();
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'title' => $title,
        'workflow' => 'bb_work',
        'ticket_type' => $epic->id(),
        'state' => $state,
        'project_id' => $this->project->id(),
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Writes the shipped config objects the Overview and Epics view modes need.
   */
  private function installOverviewDisplay(): void {
    $module = $this->container->get('extension.list.module')->getPath('bb_core');
    $activity = $this->container->get('extension.list.module')->getPath('bb_activity');
    $recipe = dirname(DRUPAL_ROOT) . '/recipes/bakers/config';
    $target = $this->container->get('config.storage');
    // Activity event bodies run through check_markup('bb_rich'). Without the
    // format, **ID** stays literal instead of <strong>.
    foreach ([
      'filter.format.bb_rich' => $module . '/config/install',
      'core.entity_view_mode.bb_project.full' => $module . '/config/optional',
      'core.entity_view_mode.bb_project.epics' => $module . '/config/optional',
      'core.entity_view_mode.bb_activity.full' => $activity . '/config/optional',
      'core.entity_view_display.bb_project.bb_project.full' => $recipe,
      'core.entity_view_display.bb_project.bb_project.epics' => $recipe,
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
