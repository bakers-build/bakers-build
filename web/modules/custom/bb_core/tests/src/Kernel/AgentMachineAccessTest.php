<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * An agent can view host capacity (bb_machine) by its UUID.
 *
 * Claim dispatch reads machineCapacity(machine UUID) as the agent OAuth client
 * (BB-353 AC4). Without `view bb_machine` the JSON:API filter returns
 * empty/403, capacity is null, and the shared host budget falls back to the
 * local activeRunCount only.
 *
 * A conductor's read visibility is no machine-specific grant: a
 * conductor's OAuth identity is bound to its OWNING USER's
 * account, and `view bb_machine` was already on that user's own product
 * rank (`contributor` inherits it from the former `member` set, `lead`/admin
 * carries it too). So the row-visibility half of this file's subject
 * disappears: there is no separate machine rank to fence rows to any more,
 * only the ordinary workspace membership every human product rank already
 * carries.
 *
 * BB-391 D2's move is unaffected by either rename: `bb_agent` stayed
 * DELETED, and nothing replaces it on a site-wide role. A machine identity's
 * WRITE-side site-wide permission set still comes from its OAuth SCOPE —
 * `Oauth2AccessPolicy::alterPermissions()` rewrites a `client_credentials`
 * token account's calculated permissions with `overwrite: TRUE` — but
 * `view bb_machine` was never one of the scope's children (it is a read
 * grant a human product rank carries, not a machine-only write permission),
 * so this file's ceiling assertion is retired along with the rank it used to
 * measure: SiteWideRoleResidueTest already pins the scope's full child set,
 * and `view bb_machine` was never a member of it to begin with.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class AgentMachineAccessTest extends KernelTestBase {

  use UserCreationTrait;
  use OgScopeFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'filter', 'bb_core',
  ];

  /**
   * The only site-wide role a machine actor holds after BB-391 D2.
   *
   * NOT its permission set: for a `client_credentials` token that is the OAuth
   * scope's children, verbatim, whatever the account's roles say. What this
   * file is, is everything a site-wide ROLE contributes — which is why the
   * contrast account below replays it: it makes the workspace rank the only
   * difference between the two accounts.
   */
  private const CONFIG_SYNC = DRUPAL_ROOT . '/../config/sync/user.role.authenticated.yml';

  /**
   * The workspace rank that carries view capability today (BB-462 D1/D2).
   *
   * Any tier the implicit member rank used to imply implicitly — `contributor`
   * chosen here because it is the tier a conductor's owning user ordinarily
   * holds, not `lead`/admin, which would also pass but would prove less.
   */
  private const VIEWER_RANK = 'contributor';

  private const VIEW_MACHINE = 'view bb_machine';

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    // bb_group/bb_project are needed even though this test never creates
    // one: the contributor rank sees every project of its own workspace via
    // its team memberships, and BB-318's read scope still resolves that set
    // on every access-checked query here.
    foreach ([
      'user', 'og_membership',
      'bb_workspace', 'bb_group', 'bb_project', 'bb_machine',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
  }

  /**
   * The shipped contributor rank grants view on bb_machine (BB-462 D9).
   *
   * Read out of the shipped config rather than out of the container, so a rank
   * that lost the permission fails here instead of on a claim loop that
   * silently falls back to the local run count.
   */
  public function testShippedContributorRankGrantsViewMachine(): void {
    $rank_id = 'bb_workspace-bb_workspace-' . self::VIEWER_RANK;
    foreach ([
      DRUPAL_ROOT . '/../web/modules/custom/bb_core/config/install/og.og_role.' . $rank_id . '.yml',
      DRUPAL_ROOT . '/../config/sync/og.og_role.' . $rank_id . '.yml',
    ] as $file) {
      $this->assertFileExists($file);
      $rank = Yaml::decode((string) file_get_contents($file));
      $this->assertContains(
        self::VIEW_MACHINE,
        $rank['permissions'] ?? [],
        basename($file) . ' must grant view bb_machine (BB-353 AC4)',
      );
    }
  }

  /**
   * Entity access: the owner views; a ranked colleague and a stranger do not.
   */
  public function testAgentEntityAccessOnMachine(): void {
    // Uid 1 is a superuser; consume it so the agent is a normal account.
    $this->createUser();

    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'ws-agent-access']);
    $this->assertInstanceOf(ContentEntityInterface::class, $workspace);
    $workspace->save();

    $owner = $this->createAgentInWorkspace('agent-owner', $workspace);
    $colleague = $this->createAgentInWorkspace('agent-colleague', $workspace);
    $stranger = $this->createUserFromShippedAgentRole('agent-no-rank');

    $machine = $this->container->get('entity_type.manager')
      ->getStorage('bb_machine')
      ->create([
        'name' => 'dev box',
        'max_parallel' => 4,
        'owner_user_id' => $owner->id(),
      ]);
    $machine->save();

    $handler = $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_machine');

    $this->assertTrue(
      $handler->access($machine, 'view', $owner),
      'the owning account must view its machine',
    );
    $this->assertFalse(
      $handler->access($machine, 'view', $colleague),
      'a ranked colleague must not view another account\'s machine',
    );
    $this->assertFalse(
      $handler->access($machine, 'view', $stranger),
      'without ownership the agent must not view the machine',
    );
  }

  /**
   * A machine UUID query returns the row only when view is granted.
   *
   * Mirrors the machineCapacity JSON:API filter the claim loop issues.
   */
  public function testAgentMachineUuidQuerySeesOwnedMachine(): void {
    $this->createUser();

    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'ws-host-key']);
    $this->assertInstanceOf(ContentEntityInterface::class, $workspace);
    $workspace->save();

    $agent = $this->createAgentInWorkspace('agent-query', $workspace);
    $stranger = $this->createUserFromShippedAgentRole('agent-query-denied');

    $machine = $this->container->get('entity_type.manager')
      ->getStorage('bb_machine')
      ->create([
        'name' => 'query host',
        'max_parallel' => 3,
        'owner_user_id' => $agent->id(),
      ]);
    $machine->save();

    $this->assertSame(
      [(int) $machine->id()],
      $this->uuidQueryIds($agent, (string) $machine->uuid()),
      'the owning agent must see the machine by UUID',
    );
    $this->assertSame(
      [],
      $this->uuidQueryIds($stranger, (string) $machine->uuid()),
      'without ownership the UUID query must return no rows',
    );
  }

  /**
   * Creates an agent account holding the `contributor` rank in the workspace.
   *
   * The shipped site-wide grants are replayed too, so the ONLY difference
   * between this account and the contrast account is the rank. They are not the
   * conductor principal's real WRITE-side permission set — that is the OAuth
   * scope's children (BB-391 D2) — but they are everything a site-wide role
   * can contribute, which is what has to be held constant here. Reading is
   * different from writing here (BB-462 D9): a conductor's owning user
   * genuinely holds this rank in production, so this fixture is no longer a
   * stand-in for a machine-only grant — it is the real mechanism.
   *
   * @param string $name
   *   The account name.
   * @param \Drupal\Core\Entity\ContentEntityInterface $workspace
   *   The workspace to place the account in.
   *
   * @return \Drupal\user\UserInterface
   *   The saved account.
   */
  private function createAgentInWorkspace(string $name, ContentEntityInterface $workspace): UserInterface {
    $account = $this->createUserFromShippedAgentRole($name);
    $this->addMembership($workspace, $account, [self::VIEWER_RANK]);

    return $account;
  }

  /**
   * Creates an account holding exactly the shipped SITE-WIDE role grants.
   *
   * Read from `config/sync/user.role.authenticated.yml` rather than restated,
   * so this cannot replay a role grant the product does not ship — the whole
   * point of contrasting it with the ranked account. `installConfig(['user'])`
   * gives the test the `user` module's default authenticated role, not the
   * project's export, so the shipped grants have to be replayed onto it
   * explicitly.
   */
  private function createUserFromShippedAgentRole(string $name): UserInterface {
    $config = Yaml::decode((string) file_get_contents(self::CONFIG_SYNC));
    $this->assertIsArray($config);
    $role_storage = $this->container->get('entity_type.manager')->getStorage('user_role');
    $authenticated = $role_storage->load('authenticated');
    $this->assertNotNull($authenticated, 'installConfig([user]) ships the authenticated role');
    foreach ($config['permissions'] ?? [] as $permission) {
      $authenticated->grantPermission($permission);
    }
    $authenticated->save();

    $user = $this->container->get('entity_type.manager')->getStorage('user')->create([
      'name' => $name,
      'status' => 1,
    ]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Access-checked entity query for bb_machine by UUID, as $account.
   *
   * @return list<int>
   *   Matching machine ids.
   */
  private function uuidQueryIds(AccountInterface $account, string $uuid): array {
    // Entity query access uses the current user.
    $this->container->get('account_switcher')->switchTo($account);
    try {
      $ids = $this->container->get('entity_type.manager')
        ->getStorage('bb_machine')
        ->getQuery()
        ->accessCheck(TRUE)
        ->condition('uuid', $uuid)
        ->execute();
    }
    finally {
      $this->container->get('account_switcher')->switchBack();
    }
    return array_map('intval', array_values($ids));
  }

}
