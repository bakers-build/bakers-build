<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\ui_patterns\SourcePluginBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * How the activity feed words one row of each kind.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class ActivityFeedLineTest extends KernelTestBase {

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
    'field', 'og', 'link', 'text', 'filter', 'island',
    'ui_patterns',
    'bb_core', 'bb_activity',
  ];

  /**
   * The ticket every row belongs to.
   */
  private BbTicketInterface $ticket;

  /**
   * A run of the ticket that took 125 seconds.
   */
  private BbRunInterface $run;

  /**
   * The run's conductor.
   */
  private ContentEntityInterface $conductor;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_machine', 'bb_conductor', 'bb_ticket',
      'bb_activity', 'bb_notification_setting', 'bb_comment', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->installOgScopeFixture();
    // Uid 1 reads every row, run and conductor.
    $this->setUpCurrentUser(['uid' => 1], ['administer bakers']);
    $this->container->get('router.builder')->rebuild();
    $workspace = $this->entity('bb_workspace', ['name' => 'Feed', 'slug' => 'feed']);
    $group = $this->entity('bb_group', ['name' => 'Group', 'workspace_id' => $workspace->id()]);
    $project = $this->entity('bb_project', ['name' => 'Project', 'key' => 'FEED', 'group_id' => $group->id()]);
    $ticket = $this->entity('bb_ticket', [
      'title' => 'Feed lines',
      'workflow' => 'bb_feature',
      'project_id' => $project->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $this->ticket = $ticket;
    $machine = $this->entity('bb_machine', ['name' => 'Machine', 'host_key' => 'host-feed']);
    $this->conductor = $this->entity('bb_conductor', [
      'conductor_id' => 'feed-node',
      'label' => 'feed-node',
      'owner_user_id' => 1,
      'status' => 'online',
      'machine' => $machine->id(),
      'states' => ['coding'],
    ]);
    $run = $this->entity('bb_run', [
      'ticket_id' => $ticket->id(),
      'conductor_id' => $this->conductor->id(),
      'owner_user_id' => 1,
      'state' => 'claimed',
      'state_at_start' => 'coding',
      'duration_s' => 125,
    ]);
    self::assertInstanceOf(BbRunInterface::class, $run);
    $this->run = $run;
  }

  /**
   * A created row names the workflow and the first state.
   */
  public function testCreatedRowNamesWorkflowAndFirstState(): void {
    $props = $this->line(['kind' => 'created', 'new_state' => 'qualification']);
    self::assertSame('created', $props['tag']);
    self::assertSame('created (feature, qualification)', $props['statement']);
    self::assertArrayNotHasKey('role', $props);
  }

  /**
   * A status row with its run is the agent's, with conductor and duration.
   */
  public function testStatusRowWithRunShowsAgentRoleDurationAndRunLink(): void {
    $props = $this->line([
      'kind' => 'status_changed',
      'previous_state' => 'coding',
      'new_state' => 'review',
      'run_id' => $this->run->id(),
      'conductor_id' => $this->conductor->id(),
    ]);
    self::assertSame('status', $props['tag']);
    self::assertSame('coding → review', $props['statement']);
    self::assertSame('agent', $props['role']);
    self::assertContains('feed-node', $props['facts']);
    self::assertContains($this->interval(125), $props['facts']);
    self::assertSame(['Run'], array_column($props['links'], 'title'));
  }

  /**
   * A status row without a run is a person's change, without facts.
   */
  public function testStatusRowWithoutRunIsHuman(): void {
    $props = $this->line(['kind' => 'status_changed', 'previous_state' => 'qualification', 'new_state' => 'spec']);
    self::assertSame('human', $props['role']);
    self::assertSame('qualification → spec', $props['statement']);
    self::assertArrayNotHasKey('facts', $props);
  }

  /**
   * A claim row says work started in the step and shows no duration.
   */
  public function testClaimRowStartsWorkWithoutDuration(): void {
    $props = $this->line([
      'kind' => 'claimed',
      'step' => 'coding',
      'run_id' => $this->run->id(),
      'conductor_id' => $this->conductor->id(),
    ]);
    self::assertSame('started', $props['tag']);
    self::assertSame('started work in coding', $props['statement']);
    self::assertSame('agent', $props['role']);
    self::assertSame(['feed-node'], $props['facts']);
  }

  /**
   * An ended-run row names the run's outcome and its duration.
   */
  public function testEndedRunRowNamesItsOutcome(): void {
    $this->run->setRunState('cancelled')->save();
    $props = $this->line([
      'kind' => 'run_ended',
      'step' => 'coding',
      'run_id' => $this->run->id(),
      'conductor_id' => $this->conductor->id(),
    ]);
    self::assertSame('cancelled', $props['tag']);
    self::assertSame('run cancelled in coding', $props['statement']);
    self::assertContains($this->interval(125), $props['facts']);
  }

  /**
   * A row whose kind plugin is gone still shows, as its stored kind.
   */
  public function testRowWhosePluginIsGoneShowsItsStoredKind(): void {
    $props = $this->line(['kind' => 'retired_kind']);
    self::assertSame('retired_kind', $props['tag']);
    self::assertSame('retired_kind', $props['statement']);
  }

  /**
   * Saves one row of the ticket and renders it as the feed does.
   *
   * @param array<string, mixed> $values
   *   Kind-specific values.
   *
   * @return array<string, mixed>
   *   The event component's props.
   */
  private function line(array $values): array {
    $activity = $this->entity('bb_activity', $values + [
      'ticket_id' => $this->ticket->id(),
      'workflow' => 'bb_feature',
      'actor' => 1,
      'created' => $this->container->get('datetime.time')->getCurrentTime(),
    ]);
    $schema = $this->container->get('plugin.manager.ui_patterns_prop_type')->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance('bb_activity_event', SourcePluginBase::buildConfiguration('slot', $schema, ['source' => []], []));
    self::assertInstanceOf(SourcePluginBase::class, $source);
    $source->setContextValue('entity', $activity);
    $build = $source->getPropValue();
    self::assertIsArray($build);
    self::assertArrayHasKey('#props', $build);
    return $build['#props'];
  }

  /**
   * The duration fact as the feed formats it.
   */
  private function interval(int $seconds): string {
    return (string) $this->container->get('date.formatter')->formatInterval($seconds, 1);
  }

  /**
   * Creates and saves an entity.
   *
   * @param string $type
   *   Entity type ID.
   * @param array<string, mixed> $values
   *   Field values.
   */
  private function entity(string $type, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')->getStorage($type)->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    $entity->save();
    return $entity;
  }

}
