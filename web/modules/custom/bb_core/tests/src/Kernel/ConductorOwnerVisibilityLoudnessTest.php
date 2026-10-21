<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Logger\RfcLogLevel;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The conductor-outside-its-owner's-visibility mismatch is LOUD (F16).
 *
 * BB-462 D9 makes a conductor see exactly what its owning user sees. The
 * acceptance criterion has two halves and only the first was covered: that
 * the machine acts with its owner's visibility (the read scope's own suites),
 * and that a misassignment "fails loudly rather than reads an empty list".
 *
 * The second half is the one that cannot be inferred from the first, and the
 * confirmed test plan said so in as many words: "the silent version also
 * passes any test that merely checks the list is empty". It is also the half
 * that has already MOVED — coding pass 1 tried a hard `UpdateException`,
 * measured that it blocked ~25 fixture-construction paths across the claim
 * subsystem, and reverted to an ERROR-level log. A log line is precisely the
 * kind of behaviour that can be deleted, downgraded or rendered unreachable
 * without a single test going red, and two test docblocks in this very suite
 * were still describing the abandoned exception when a review found this gap.
 *
 * So this class asserts on the RAISED CONDITION rather than on any list:
 * that the ERROR fires and names the three things an operator needs to act
 * (conductor, project, owner), and — equally, because an unconditional log is
 * as useless as none — that it stays silent for every assignment the model
 * considers correct.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConductorOwnerVisibilityLoudnessTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'filter', 'markdown_easy', 'bb_core',
  ];

  /**
   * The recorder collecting every bb_core log record of the test.
   */
  private RecordingLogger $recorder;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_group',
      'bb_project', 'bb_conductor', 'bb_ticket', 'bb_comment',
      'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'og']);
    // A recipe registers these in `actions:`; a kernel test carries no recipe,
    // so the groups are registered directly — without it OgMembership::save()
    // throws "not an OG group". `bb_project` is deliberately NOT registered:
    // D7 deregistered it, and this suite would be testing a world the product
    // no longer ships if it were.
    Og::addGroup('bb_workspace', 'bb_workspace');
    Og::addGroup('bb_team', 'bb_team');

    // uid1 bypasses every access check, so it must not be an actor here; the
    // acting account needs only enough to let reference validation run its
    // access-checked selection query (see ConductorProjectMatchTest).
    $this->createRawUser('uid1-dummy');
    $this->setUpCurrentUser([], [
      'view bb_conductor', 'view bb_project', 'administer bakers',
    ]);

    $this->captureBbCoreLog();
  }

  /**
   * A conductor whose owner cannot see its project raises the ERROR.
   *
   * The present half. The owner holds no membership at all, so the read
   * scope resolves an empty project set for them — the exact state that,
   * left silent, reads as "nothing to do" at every later call site.
   */
  public function testMismatchLogsAnErrorNamingConductorProjectAndOwner(): void {
    $project = $this->createProject('unreachable');
    $owner = $this->createRawUser('stranger');

    $conductor = $this->createConductor('mid-blind', $project, $owner);

    $record = $this->firstError();
    self::assertNotNull(
      $record,
      'A conductor assigned outside its owner\'s visibility must not be saved silently.',
    );
    // Asserted on the CONTEXT, not on the rendered sentence: the wording is
    // free to be rewritten, the three facts an operator needs are not.
    self::assertSame($conductor->id(), $record['context']['@conductor']);
    self::assertSame($project->id(), $record['context']['@project']);
    self::assertSame('stranger', $record['context']['@name']);
    self::assertSame($owner->id(), $record['context']['@uid']);
  }

  /**
   * An owner who belongs to one of the project's teams triggers nothing.
   *
   * The absent half, and not a formality: an unconditional ERROR would pass
   * the case above while telling an operator nothing at all. This is also
   * the assertion that ties the loudness to `bb_project.teams` — the one
   * visibility source D4 leaves standing.
   */
  public function testOwnerInOneOfTheProjectsTeamsIsSilent(): void {
    $team = $this->createTeam('Platform Crew');
    $project = $this->createProject('reachable', [$team]);
    $owner = $this->createRawUser('crew-member');
    Og::createMembership($team, $owner)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    $this->createConductor('mid-seeing', $project, $owner);

    self::assertNull(
      $this->firstError(),
      'Team membership is what makes the project visible, so the assignment is correct and silent.',
    );
  }

  /**
   * A half-built conductor is silent until both ends are set.
   *
   * Both are ordinary states of a record written over several saves, and the
   * mismatch is undecidable until the pair exists. Pinned because the cheap
   * way to make the first case pass is to log whenever the project is not in
   * the set — which would fire on every conductor created without an owner.
   */
  public function testConductorWithoutOwnerOrWithoutProjectIsSilent(): void {
    $project = $this->createProject('orphan-owner');
    $conductor = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')
      ->create([
        'conductor_id' => 'mid-ownerless',
        'label' => 'mid-ownerless',
        'status' => 'online',
        'project_id' => $project->id(),
        'states' => ['coding'],
        'last_seen' => $this->container->get('datetime.time')->getRequestTime(),
      ]);
    $conductor->save();
    self::assertNull($this->firstError(), 'No owner yet: nothing to compare.');

    $owner = $this->createRawUser('projectless');
    $second = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')
      ->create([
        'conductor_id' => 'mid-projectless',
        'label' => 'mid-projectless',
        'owner_user_id' => $owner->id(),
        'status' => 'online',
        'states' => ['coding'],
        'last_seen' => $this->container->get('datetime.time')->getRequestTime(),
      ]);
    $second->save();
    self::assertNull($this->firstError(), 'No project yet: nothing to compare.');
  }

  /**
   * Re-pointing a conductor at an unreachable project logs on UPDATE too.
   *
   * The insert hook alone would leave the whole re-assignment path silent,
   * which is the commoner mistake: the conductor was correct when it was
   * created and became wrong later.
   */
  public function testRepointingAnExistingConductorAlsoLogs(): void {
    $team = $this->createTeam('Platform Crew');
    $reachable = $this->createProject('reachable', [$team]);
    $owner = $this->createRawUser('crew-member');
    Og::createMembership($team, $owner)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    $conductor = $this->createConductor('mid-repointed', $reachable, $owner);
    $this->assertNoErrorLogged('Sanity: the first assignment was correct.');
    // Cleared so the assertion below can only be reading the UPDATE's own
    // record: with the insert's history still in the buffer, a hook that
    // fired on insert ALONE would look indistinguishable from one that fires
    // on both — the single thing this case exists to tell apart.
    $this->recorder->records = [];

    $elsewhere = $this->createProject('elsewhere');
    $conductor->set('project_id', $elsewhere->id())->save();

    $record = $this->firstError();
    self::assertNotNull($record, 'The re-assignment must be as loud as the original would have been.');
    self::assertSame($elsewhere->id(), $record['context']['@project']);
  }

  /**
   * Returns the first ERROR the bb_core channel emitted, or NULL.
   *
   * @return array{level: mixed, message: string, context: array<string, mixed>}|null
   *   The record, or NULL when the channel stayed silent.
   */
  private function firstError(): ?array {
    return $this->recorder->first(RfcLogLevel::ERROR);
  }

  /**
   * Asserts the bb_core channel emitted no ERROR.
   *
   * Only the ERROR level is asserted on, never an empty buffer: the channel
   * legitimately carries a WARNING about the retired `lead` placement role
   * and one INFO per entity write, so "silent" here means silent about THIS,
   * not silent altogether.
   *
   * @param string $message
   *   The assertion message.
   */
  private function assertNoErrorLogged(string $message): void {
    self::assertNull($this->firstError(), $message);
  }

  /**
   * Registers a recorder for the bb_core channel on the logger factory.
   */
  private function captureBbCoreLog(): void {
    $this->recorder = new RecordingLogger('bb_core');
    $this->container->get('logger.factory')->addLogger($this->recorder);
  }

  /**
   * Creates a plain Drupal user holding no permission and no membership.
   */
  private function createRawUser(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    self::assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates a team in its own workspace.
   */
  private function createTeam(string $name): BbTeamInterface {
    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'Acme', 'slug' => 'acme-' . strtolower(str_replace(' ', '-', $name))]);
    $workspace->save();

    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => $name, 'workspace_id' => $workspace->id()]);
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $team->save();
    return $team;
  }

  /**
   * Creates a project, optionally assigned to teams.
   *
   * @param string $name
   *   The project name.
   * @param array<int, \Drupal\bb_core\Entity\BbTeamInterface> $teams
   *   The teams the project is visible to.
   */
  private function createProject(string $name, array $teams = []): BbProjectInterface {
    $values = ['name' => $name];
    if ($teams !== []) {
      $values['teams'] = array_map(static fn (BbTeamInterface $team): string => (string) $team->id(), $teams);
    }
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create($values);
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $project->save();
    return $project;
  }

  /**
   * Creates and saves a conductor bound to a project and an owner.
   */
  private function createConductor(string $machine_id, BbProjectInterface $project, UserInterface $owner): BbConductorInterface {
    $conductor = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')
      ->create([
        'conductor_id' => $machine_id,
        'label' => $machine_id,
        'owner_user_id' => $owner->id(),
        'status' => 'online',
        'project_id' => $project->id(),
        'states' => ['coding'],
        'last_seen' => $this->container->get('datetime.time')->getRequestTime(),
      ]);
    self::assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    return $conductor;
  }

}
