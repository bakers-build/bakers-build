<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\FileStorage;
use Drupal\Core\Entity\EntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers run attribution and conductor registration robustness (V3).
 *
 * BB-462 D9. BB-316 D8 gives a conductor no new field: its principal is
 * the account it already authenticates as. It used to place that account
 * in the derived
 * workspace with the role `app`; BB-462 D9 removes that placement (and the
 * role) entirely, because a conductor's OAuth identity already sees what its
 * owning user sees through the user's own product rank — there is no separate
 * machine rank to place it into. What must NOT change, and did not, is where
 * a run's owner comes from — it is denormalised from the conductor, never
 * from whoever holds the session.
 *
 * The conductor's owner deliberately differs from the acting account. Fact 11
 * says they are the same on the seeded e2e world, so a same-account setup would
 * pass this test without proving anything.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RunAttributionTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'bb_core',
  ];

  /**
   * The workspace the conductor's project resolves to.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * The project the conductor and the ticket share.
   */
  private int $projectId;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'bb_workspace', 'bb_group', 'bb_project',
      'bb_conductor', 'bb_ticket', 'bb_comment', 'bb_run', 'bb_term',
      'og_membership',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user', 'og']);
    $this->registerWorkspaceAsOgGroup();
    $this->installShippedRoles();
    // UID 1 dummy so ownership checks never land on UID 0.
    $this->createAccount('uid1-dummy');

    $workspace = $this->create('bb_workspace', ['name' => 'Workspace']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;
    $group = $this->create('bb_group', [
      'name' => 'customer',
      'workspace_id' => $this->workspace->id(),
    ]);
    self::assertInstanceOf(BbGroupInterface::class, $group);
    $project = $this->create('bb_project', [
      'name' => 'attribution-project',
      'group_id' => $group->id(),
    ]);
    $this->projectId = (int) $project->id();
  }

  /**
   * A conductor without a project registers anyway, without a membership.
   *
   * Registering a conductor must never fail because the tenancy chain is
   * incomplete — no membership is ever written for it any more (BB-462 D9
   * retires that mechanism entirely), and there is nothing for
   * `_bb_core_log_conductor_owner_visibility_mismatch()` to compare until
   * the conductor names a project. That silence is the hook's own property
   * and is asserted in `ConductorOwnerVisibilityLoudnessTest`, not here.
   */
  public function testConductorWithoutProjectStillRegisters(): void {
    $owner = $this->createAccount('projectless-owner');
    $conductor = $this->createConductor($owner, projectId: NULL);

    self::assertNotNull($conductor->id());
    self::assertNull(Og::getMembership($this->workspace, $owner));
  }

  /**
   * A run is attributed to the conductor's owner, not to the acting account.
   */
  public function testRunIsAttributedToTheConductorOwner(): void {
    $owner = $this->createAccount('conductor-owner');
    // BB-462 D9: registering a conductor whose project the owner cannot see
    // is not refused — it is LOGGED loudly, a hard exception having been
    // measured and reverted. This test is about run attribution, not
    // visibility, so it keeps the assignment correct to stay off that path;
    // so the owner is placed as the workspace's admin — the tier that reaches
    // every project regardless of team membership.
    $this->grantLeadRank($owner);
    $acting = $this->createAccount('acting-session');
    self::assertNotSame($owner->id(), $acting->id());
    $conductor = $this->createConductor($owner);

    // The session that claims is deliberately somebody else.
    $this->container->get('current_user')->setAccount($acting);
    $ticket = $this->create('bb_ticket', [
      'title' => 'attribution',
      'type' => 'bb_work',
      'project_id' => $this->projectId,
      'state' => 'working',
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);

    $run = $this->container->get('entity_type.manager')->getStorage('bb_run')
      ->create([
        'ticket_id' => $ticket->id(),
        'conductor_id' => $conductor->id(),
        'owner_user_id' => $conductor->get('owner_user_id')->target_id,
        'state' => 'claimed',
      ]);
    self::assertInstanceOf(BbRunInterface::class, $run);
    $run->save();

    self::assertSame(
      (string) $owner->id(),
      (string) $run->get('owner_user_id')->target_id,
      'The run follows the conductor owner, not the session.',
    );
  }

  /**
   * Creates and saves an entity of the given type.
   *
   * @param string $entity_type_id
   *   The entity type to create.
   * @param array<string, mixed> $values
   *   The field values to create it with.
   *
   * @return \Drupal\Core\Entity\EntityInterface
   *   The saved entity.
   */
  private function create(string $entity_type_id, array $values): EntityInterface {
    $entity = $this->container->get('entity_type.manager')
      ->getStorage($entity_type_id)
      ->create($values);
    $entity->save();
    return $entity;
  }

  /**
   * Creates and saves a plain user account.
   */
  private function createAccount(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    self::assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Places an account as the workspace's `lead`/admin rank (BB-462 D9).
   *
   * The tier that reaches every project of its workspace regardless of team
   * membership — the fixture shortcut for tests whose subject is not
   * visibility itself.
   */
  private function grantLeadRank(UserInterface $account): void {
    $role = $this->container->get('entity_type.manager')
      ->getStorage('og_role')
      ->load('bb_workspace-bb_workspace-lead');
    self::assertInstanceOf(OgRole::class, $role, 'the workspace lead rank is shipped');
    $membership = Og::getMembership($this->workspace, $account, OgMembershipInterface::ALL_STATES)
      ?? Og::createMembership($this->workspace, $account);
    $membership->addRole($role)->save();
  }

  /**
   * Creates and saves a conductor owned by the given account.
   */
  private function createConductor(UserInterface $owner, ?int $projectId = -1): BbConductorInterface {
    $values = [
      'conductor_id' => 'node-' . $owner->getAccountName(),
      'owner_user_id' => $owner->id(),
      'states' => ['coding'],
    ];
    if ($projectId !== NULL) {
      $values['project_id'] = $projectId === -1 ? $this->projectId : $projectId;
    }
    $conductor = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')
      ->create($values);
    self::assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    return $conductor;
  }

  /**
   * Registers bb_workspace as an OG group, as the shipped config does.
   */
  private function registerWorkspaceAsOgGroup(): void {
    $this->config('og.settings')
      ->set('groups', ['bb_workspace' => ['bb_workspace']])
      ->save();
    $this->container->get('og.group_type_manager')->reset();
  }

  /**
   * Creates the shipped workspace roles from the module's config/install.
   */
  private function installShippedRoles(): void {
    $path = $this->container->get('extension.list.module')->getPath('bb_core');
    $source = new FileStorage($path . '/config/install');
    $storage = $this->container->get('entity_type.manager')->getStorage('og_role');
    foreach (['non-member', 'member', 'contributor', 'lead', 'guest'] as $name) {
      $data = $source->read('og.og_role.bb_workspace-bb_workspace-' . $name);
      self::assertIsArray($data);
      $storage->create($data)->save();
    }
  }

}
