<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_scope_identity_test\FakeScope;
use Drupal\bb_scope_identity_test\Oauth2ScopeProviderStub;
use Drupal\simple_oauth\Authentication\TokenAuthUserInterface;
use Drupal\simple_oauth\Entity\Oauth2TokenInterface;
use Drupal\simple_oauth\Plugin\Field\FieldType\Oauth2ScopeReferenceItemListInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The machine ceiling is SUFFICIENT for the writes the CLI issues (BB-391).
 *
 * SiteWideRoleResidueTest pins what the ceiling IS — an exact `assertSame` over
 * all 28 permissions. That says nothing about whether the ceiling covers what
 * its callers actually ISSUE, and that gap has now produced the same defect
 * twice: the round-2 widening from 22 to 27 children for five `create`
 * operations four shipped surfaces already promised, and the round-4 conductor
 * regression. Both were found by a red pipeline rather than by a test.
 *
 * This suite closes the gap from the other end. It does not restate the
 * ceiling; it DISCOVERS the writes the TypeScript actually issues, and then
 * asks the real Drupal access stack whether a real machine principal may issue
 * each one. A new write whose permission nothing grants fails here, by
 * construction, without anybody remembering to add it to a list.
 *
 * THE PRINCIPAL IS A REAL `TokenAuthUserInterface` DOUBLE, NOT A ROLE
 * (BB-462 D9). It used to hold the workspace `app` rank — the mechanism the
 * round-4 regression this suite guards against was ABOUT, and the reason this
 * suite existed at all: `register bakers conductor` sat in the shipped ceiling
 * the whole time, a role-shaped test account answered TRUE to
 * `hasPermission()` for it, and the write was still forbidden, because
 * `BbGroupScopedAccount` re-runs the handler against an account whose
 * ceiling arrives through neither a role nor an OG rank. BB-462 D9 removes
 * `app` entirely — a conductor's OAuth identity is bound to its owning user's
 * account and sees what that user sees — which means the mechanism this test
 * used to prove insufficient (a bare role/rank) has to be replaced with the
 * mechanism `BbRankCapability::hasSiteWidePermission()` now reads instead: a
 * `TokenAuthUserInterface` account whose token's `auth_user_id` is empty,
 * answered through the injected `Oauth2ScopeProviderInterface`
 * (`bb_scope_identity_test.Oauth2ScopeProviderStub`, state-driven exactly
 * like the retired `ScopeCeilingAccessPolicy` it replaces here). A test that
 * modelled the principal as a role or an OG rank again would prove nothing —
 * the whole point of BbGroupScopedAccount is that neither reaches a token.
 *
 * @see \Drupal\Tests\bb_core\Kernel\SiteWideRoleResidueTest
 * @see \Drupal\bb_scope_identity_test\Oauth2ScopeProviderStub
 * @see \Drupal\bb_core\Access\BbRankCapability
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class MachineIdentityWriteSufficiencyTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'bb_core',
    'bb_scope_identity_test',
  ];

  /**
   * The writes the scan must find, or the scan itself is broken.
   *
   * A LOWER BOUND on discovery, and nothing else — the sufficiency assertions
   * below loop over what was DISCOVERED, not over this list, so a newly added
   * write is covered without being named here. Its only job is to make a
   * regex that has silently stopped matching fail loudly instead of reporting
   * an empty set of writes as "all sufficient", which is the one way a
   * source-scanning test can rot into a tautology.
   *
   * Each entry is "<entity_type>:<operation>".
   *
   * @var array<string>
   */
  private const DISCOVERY_FLOOR = [
    // DrupalBbRemote.markRunning() / finalizeRun() / the lease refreshes.
    'bb_run:update',
    // DrupalBbRemote.closeTicket() / markTicketCleanedUp(), and the bakers-ui
    // ticket edit popup.
    'bb_ticket:update',
  ];

  /**
   * The machine principal under test — a mocked TokenAuthUserInterface.
   */
  private TokenAuthUserInterface $machine;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
    $this->machine = $this->buildMachinePrincipal();
  }

  /**
   * Every write the CLI issues is permitted for a machine principal.
   *
   * The assertion that would have caught the round-4 regression: it asks the
   * real access stack — handler, `hook_entity_access`, and therefore
   * BbRankEntityFence — rather than asking whether a permission appears in a
   * list.
   */
  public function testEveryCliWriteIsPermittedForTheMachinePrincipal(): void {
    $writes = $this->discoverCliWrites();

    foreach ($writes as $key => $sites) {
      [$entity_type_id, $operation] = explode(':', $key);
      self::assertTrue(
        $this->machineMay($entity_type_id, $operation),
        sprintf(
          "A machine identity may not `%s` a %s, but the CLI issues that write at:\n  %s\n"
          . 'Either the permission its access handler consults is missing from the '
          . '`bb:session` ceiling (add a child scope on BOTH install paths), or the '
          . 'ceiling has it and BbRankEntityFence drops it because no OG rank in the '
          . "entity's chain grants it (add it to the workspace `app` rank on both paths).",
          $operation,
          $entity_type_id,
          implode("\n  ", $sites),
        ),
      );
    }
  }

  /**
   * The machine principal passes the offline POST gate.
   *
   * Registration and shutdown no longer generic-upsert the conductor, so
   * those lifecycle writes are invisible to the TypeScript `.create` /
   * `.update` / `.upsert` scan. The modelled principal must still update
   * its own conductor and own it — the two checks
   * ConductorOfflineResource runs before mutating.
   */
  public function testMachinePrincipalPassesTheOfflineOperationGate(): void {
    $conductor = $this->fixture('a', 'bb_conductor');
    self::assertInstanceOf(BbConductorInterface::class, $conductor);
    self::assertTrue(
      $conductor->access('update', $this->machine),
      'the machine principal must update its own conductor',
    );
    self::assertTrue(
      $conductor->isOwnedBy($this->machine),
      'the machine principal must own its conductor',
    );
  }

  /**
   * The scan really did find the writes, so an empty result cannot pass.
   */
  public function testTheScanFindsTheWritesItIsSupposedTo(): void {
    $writes = $this->discoverCliWrites();
    foreach (self::DISCOVERY_FLOOR as $expected) {
      self::assertArrayHasKey(
        $expected,
        $writes,
        "the CLI write scan no longer finds `$expected`; the regex or the "
        . 'source layout changed and this suite has stopped guarding anything',
      );
    }
  }

  /**
   * The ceiling this suite grants really is the shipped one.
   *
   * Without this the principal could be handed a hand-written permission list
   * that happens to cover every write, and the suite would report sufficiency
   * for a ceiling nobody ships.
   */
  public function testThePrincipalHoldsTheShippedCeiling(): void {
    $ceiling = $this->shippedCeiling();
    self::assertContains('register bakers conductor', $ceiling);
    self::assertSame(
      $ceiling,
      $this->container->get('state')->get(Oauth2ScopeProviderStub::STATE_PERMISSIONS),
    );
    self::assertSame(
      ['authenticated'],
      $this->machine->getRoles(),
      'the principal must hold no role but authenticated, or hasSiteWidePermission()\'s '
      . 'ordinary role branch could rescue an answer the scope check should decide alone',
    );
    self::assertTrue(
      $this->machine->getToken()->get('auth_user_id')->isEmpty(),
      'the principal must be a PURE machine identity (client_credentials, no '
      . 'delegated user), or BbRankCapability falls through to the role check '
      . 'instead of asking the scope',
    );
  }

  /**
   * Asks the real access stack whether the machine may perform an operation.
   *
   * `create` and the rest are genuinely different questions in core: create is
   * routed through createAccess()/hook_entity_create_access(), which is handed
   * a bundle and no entity, while every other operation is asked of a row and
   * therefore passes through the fence.
   *
   * @param string $entity_type_id
   *   The entity type the CLI writes.
   * @param string $operation
   *   The operation it issues.
   *
   * @return bool
   *   TRUE when the machine principal is allowed.
   */
  private function machineMay(string $entity_type_id, string $operation): bool {
    $entity = $this->fixture('a', $entity_type_id);
    if ($operation === 'create') {
      return $this->container->get('entity_type.manager')
        ->getAccessControlHandler($entity_type_id)
        ->createAccess($entity->bundle(), $this->machine);
    }
    return $entity->access($operation, $this->machine);
  }

  /**
   * Builds the account a conductor authenticates as (BB-462 D9).
   *
   * Three things make it a machine rather than a person, and each is load
   * bearing: it is a `TokenAuthUserInterface` double whose token's
   * `auth_user_id` is empty, which is the ONE thing `BbRankCapability`
   * distinguishes a machine identity by since `app` was removed; its
   * `hasPermission()` and `getToken()->get('scopes')` both answer from the
   * SAME shipped ceiling, because a real `client_credentials` token's
   * calculated permissions and its scope's permissions are the same set by
   * construction (`Oauth2AccessPolicy::alterPermissions()`); and the
   * underlying real account it wraps OWNS workspace A's conductor and run,
   * because both access handlers grant their `update` only to the owner.
   *
   * @return \Drupal\simple_oauth\Authentication\TokenAuthUserInterface
   *   The machine principal.
   */
  private function buildMachinePrincipal(): TokenAuthUserInterface {
    $real_user = $this->createAccount('machine-identity');
    // createAccount() gives every account its own empty role so a test can
    // grant onto it. This principal must hold NOTHING there: the mock below
    // answers getRoles() explicitly, but the underlying account is what owns
    // the conductor/run rows, and it must carry no role a stray code path
    // could read as a grant.
    $real_user->set('roles', [])->save();
    // BB-462 D9: a conductor's owner is expected to SEE its project (via a
    // team, or the workspace admin tier). The write below is not refused when
    // they cannot — _bb_core_log_conductor_owner_visibility_mismatch()
    // logs an ERROR instead, a hard exception having been tried and reverted
    // for blocking fixture construction across this very subsystem. The rank
    // is granted here so this test stays off that path and its output stays
    // clean; `lead` reaches every project of its workspace regardless of team
    // membership.
    $this->addMembership($this->fixture('a', 'bb_workspace'), $real_user, ['lead']);

    foreach (['bb_conductor', 'bb_run'] as $entity_type_id) {
      $this->fixture('a', $entity_type_id)
        ->set('owner_user_id', $real_user->id())
        ->save();
    }

    $ceiling = $this->shippedCeiling();
    $this->container->get('state')->set(Oauth2ScopeProviderStub::STATE_PERMISSIONS, $ceiling);

    $auth_user_id = $this->createMock(FieldItemListInterface::class);
    $auth_user_id->method('isEmpty')->willReturn(TRUE);
    $scopes = $this->createMock(Oauth2ScopeReferenceItemListInterface::class);
    $scopes->method('getScopes')->willReturn([new FakeScope()]);
    $token = $this->createMock(Oauth2TokenInterface::class);
    $token->method('get')->willReturnMap([
      ['auth_user_id', $auth_user_id],
      ['scopes', $scopes],
    ]);

    $machine = $this->createMock(TokenAuthUserInterface::class);
    $machine->method('id')->willReturn((int) $real_user->id());
    $machine->method('getRoles')->willReturn(['authenticated']);
    $machine->method('isAuthenticated')->willReturn(TRUE);
    $machine->method('isAnonymous')->willReturn(FALSE);
    $machine->method('getToken')->willReturn($token);
    // Layer A: the real Oauth2AccessPolicy overwrites the calculated set with
    // exactly the scope's permissions, so the mock's own hasPermission() is
    // wired to the same ceiling rather than to the underlying real account.
    $machine->method('hasPermission')->willReturnCallback(
      static fn (string $permission): bool => in_array($permission, $ceiling, TRUE),
    );

    return $machine;
  }

  /**
   * The permissions the shipped `bb:session` umbrella grants.
   *
   * Read from the FILES rather than from the container, for the same reason
   * SiteWideRoleResidueTest does: a kernel test installs no simple_oauth, and
   * the files are what the two install paths actually ship.
   *
   * @return array<string>
   *   The ceiling, sorted.
   */
  private function shippedCeiling(): array {
    $dir = $this->repositoryRoot() . '/config/sync';
    $permissions = [];
    foreach ((array) glob($dir . '/simple_oauth.oauth2_scope.bb_session_*.yml') as $file) {
      $decoded = Yaml::decode((string) file_get_contents((string) $file));
      $permission = $decoded['granularity_configuration']['permission'] ?? NULL;
      if (is_string($permission)) {
        $permissions[] = $permission;
      }
    }
    sort($permissions);
    self::assertNotEmpty($permissions, 'the shipped ceiling must be readable');
    return $permissions;
  }

  /**
   * Discovers the entity writes the bakers-CLI sources issue.
   *
   * A source scan and deliberately not a hand-kept list: a hand-kept list is
   * the very thing that went missing twice. `upsert` counts as BOTH halves,
   * because that is what it does — a collection lookup followed by an update,
   * or a create when nothing matched.
   *
   * `dist/`, `node_modules/` and the test trees are excluded: a write issued
   * only by a test is not a shipped surface, and `dist/` would double-count
   * every source file.
   *
   * @return array<string, array<string>>
   *   Call sites, keyed "<entity_type>:<operation>".
   */
  private function discoverCliWrites(): array {
    $sources = $this->cliSourceFiles();
    // Two passes, because the entity type is not always a literal at the call
    // site: bakers-ui writes through `client.update(TICKET_TYPE, …)`, and a
    // scan that only understood literals would report the ticket edit popup
    // as issuing no write at all.
    $constants = $this->collectTypeConstants($sources);
    $found = [];
    foreach ($sources as $path) {
      $this->collectWrites($path, $constants, $found);
    }
    ksort($found);
    return $found;
  }

  /**
   * Every shipped TypeScript source file under bakers-cli.
   *
   * @return array<string>
   *   Absolute file paths.
   */
  private function cliSourceFiles(): array {
    $iterator = new \RecursiveIteratorIterator(
      new \RecursiveDirectoryIterator(
        $this->repositoryRoot() . '/bakers-cli',
        \FilesystemIterator::SKIP_DOTS,
      ),
    );
    $paths = [];
    foreach ($iterator as $file) {
      $path = (string) $file;
      if (str_ends_with($path, '.ts') && !$this->isExcluded($path)) {
        $paths[] = $path;
      }
    }
    sort($paths);
    return $paths;
  }

  /**
   * Maps `const FOO_TYPE = 'bb_x--bb_x'` names onto their entity type.
   *
   * Collected across the whole tree rather than per file, because the constant
   * and the call site are routinely in different modules — `TICKET_TYPE` is
   * declared in `Entity/ticket/Data/write.ts` and imported where it is used.
   *
   * @param array<string> $sources
   *   The files to read.
   *
   * @return array<string, string>
   *   Entity type id, keyed by constant name.
   */
  private function collectTypeConstants(array $sources): array {
    $constants = [];
    foreach ($sources as $path) {
      $matched = preg_match_all(
        '/\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+?)?=\s*[\'"](bb_[a-z_]+)(?:--[a-z_]+)?[\'"]/',
        (string) file_get_contents($path),
        $matches,
        PREG_SET_ORDER,
      );
      if ($matched === FALSE || $matched === 0) {
        continue;
      }
      foreach ($matches as $match) {
        $constants[$match[1]] = $match[2];
      }
    }
    return $constants;
  }

  /**
   * Records every entity write call site in one TypeScript file.
   *
   * @param string $path
   *   The absolute file path.
   * @param array<string, string> $constants
   *   Entity type id, keyed by the constant name that holds it.
   * @param array<string, array<string>> $found
   *   The accumulator, keyed "<entity_type>:<operation>".
   */
  private function collectWrites(string $path, array $constants, array &$found): void {
    // Matched against the WHOLE file, not line by line: biome wraps a long
    // call, and a client upsert that puts its entity type on the line after
    // the `(` would otherwise be missed. DISCOVERY_FLOOR exists to make a
    // silent miss loud.
    $text = (string) file_get_contents($path);
    $relative = str_replace($this->repositoryRoot() . '/', '', $path);
    $matched = preg_match_all(
      // Either form of the first argument: a literal — where
      // `.create('bb_ticket'` and `.update('bb_ticket--bb_ticket'` are
      // the same write, the JSON:API resource form being normalised away — or
      // a SHOUTING_CASE constant resolved through the map.
      '/\.(create|update|upsert|delete)\(\s*(?:[\'"](bb_[a-z_]+)(?:--[a-z_]+)?[\'"]|([A-Z][A-Z0-9_]*))\s*[,)]/',
      $text,
      $matches,
      PREG_SET_ORDER | PREG_OFFSET_CAPTURE,
    );
    if ($matched === FALSE || $matched === 0) {
      return;
    }
    foreach ($matches as $match) {
      $entity_type_id = ($match[2][0] ?? '') !== ''
        ? (string) $match[2][0]
        : ($constants[(string) ($match[3][0] ?? '')] ?? '');
      if ($entity_type_id === '') {
        // A constant this scan cannot resolve to a bakers.build entity type — a
        // `Map.delete(KEY)` and the like. Not a write.
        continue;
      }
      $line = substr_count($text, "\n", 0, (int) $match[0][1]) + 1;
      foreach ($this->operationsOf((string) $match[1][0]) as $operation) {
        $found[$entity_type_id . ':' . $operation][] = $relative . ':' . $line;
      }
    }
  }

  /**
   * The entity operations one JSON:API client verb performs.
   *
   * @param string $verb
   *   The client method name.
   *
   * @return array<string>
   *   One operation, or both halves of an upsert.
   */
  private function operationsOf(string $verb): array {
    return $verb === 'upsert' ? ['create', 'update'] : [$verb];
  }

  /**
   * Whether a path is build output, a dependency or a test.
   *
   * @param string $path
   *   The absolute file path.
   *
   * @return bool
   *   TRUE when the file is not a shipped source file.
   */
  private function isExcluded(string $path): bool {
    foreach (['/node_modules/', '/dist/', '/tests/', '/.pnpm-store/'] as $needle) {
      if (str_contains($path, $needle)) {
        return TRUE;
      }
    }
    return FALSE;
  }

  /**
   * The repository root, derived from this file's own location.
   *
   * @return string
   *   The absolute path, with no trailing slash.
   */
  private function repositoryRoot(): string {
    return dirname(__DIR__, 7);
  }

}
