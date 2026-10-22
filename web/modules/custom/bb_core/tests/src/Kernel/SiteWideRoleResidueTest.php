<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Where site-wide capability lives once the machine roles are gone (BB-391).
 *
 * BB-359 D6 moved a human's product capability onto an `og_membership` rank.
 * BB-391 finishes the move for the MACHINE actors, and it does NOT do it by
 * deleting the scope. Every site-wide machine ROLE goes — `bb_agent`,
 * `bb_session`, and the e2e world's `bb_e2e` — while exactly ONE OAuth2
 * scope survives, `bb:session`, as an UMBRELLA over one child scope per
 * permission.
 *
 * That shape was measured against a live control plane rather than reasoned
 * about, and the measurement overturned the ticket's own first design:
 *
 * - `simple_oauth`'s `Oauth2AccessPolicy::alterPermissions()` rewrites a token
 *   account's calculated permissions with `overwrite: TRUE`. For a token whose
 *   `auth_user_id` is empty — every `client_credentials` token, and therefore
 *   every bakers.build machine identity — the set becomes EXACTLY the scope's
 *   permissions. Neither `user_role` nor OG-rank permissions survive it.
 * - So a SCOPELESS config is not "unrestricted": against a consumer holding no
 *   default scopes the token does not mint at all (`invalid_request`, hint
 *   `Check the scope parameter`), and against one that does, that default
 *   silently decides capability while no committed artifact records it.
 * - And the scope must not name a ROLE.
 *   `BbGroupScopedAccount::hasPermission()` honours any permission a role the
 *   ACCOUNT holds grants, WITHOUT bounding it to a group, so a role is a
 *   rank-fence bypass waiting to be assigned — with `authenticated` the worst
 *   case of all, because every account holds it. An umbrella over
 *   per-permission children grants no role, so the account's own role set stays
 *   `authenticated`, and `BbRankEntityFence` keeps bounding every row to the
 *   groups its ranks name.
 *
 * The division of labour is therefore explicit: the SCOPE decides which
 * operations exist at all, the RANK decides which rows they reach. Nothing is
 * forced onto `authenticated`, so this ticket widens nothing for human
 * accounts.
 *
 * Asserted against the FILES rather than the container: the project has two
 * install paths (`config/sync` via CIM on the server, the recipe on a fresh
 * install) and CLAUDE.md requires the change on both, so the failure this
 * guards against is the two drifting apart — which a container-only assertion
 * could not see.
 */
#[Group('bb_core')]
final class SiteWideRoleResidueTest extends KernelTestBase {

  /**
   * The COMPLETE ceiling: exactly these permissions, no more and no fewer.
   *
   * Pinned in full rather than as a "must contain" subset, and the difference
   * is not stylistic. The scope IS the permission set of every machine identity
   * (`Oauth2AccessPolicy::alterPermissions()` overwrites the calculated
   * permissions of a `client_credentials` token), so a child scope silently
   * DELETED is a hard 403 on a shipped surface, and a child silently ADDED is a
   * widening of what every machine identity may do. Neither has a reader. With
   * a subset assertion, 19 of the 22 children this branch first shipped could
   * have been removed from both install paths with the whole suite still green.
   *
   * `sort()` order, so the constant reads as a diff and a new child lands next
   * to its neighbours instead of at the end.
   *
   * @var array<string>
   */
  private const SCOPE_CEILING = [
    'claim bakers tickets',
    'create bb_comment',
    // `prepare-deployment` tells the agent in so many words to "create the
    // environment"; without this the POST is a 403 and the skill cannot finish.
    'create bb_environment',
    // `scripts/setup-test-project.sh` documents `bakers dropsh create
    // bb_group`, and `.bakers/bakers.config.js` fills a workspace_id into that
    // create payload.
    'create bb_group',
    // The whole purpose of the `create-project` skill.
    'create bb_project',
    // The `workspace_id` filler documented in `.bakers/bakers.config.js` fills
    // a bb_group/bb_team CREATE payload, not only a read filter.
    'create bb_team',
    'create bb_term',
    'create bb_ticket',
    'edit bb_project',
    'register bakers conductor',
    'update any bb_group',
    'update any bb_term',
    'update any bb_ticket',
    'update any bb_workspace',
    'update own bb_machine',
    'use text format bb_rich',
    // Membership is the model's central relation and the source of every rank,
    // and OG reserves reading it to site-wide `administer organic groups` or an
    // in-group `administer group` / `manage members` grant — none of which this
    // umbrella may name, because the first is tenant-blind and the other two
    // are `lead` write capabilities. Without this child the `bakers ui` Teams
    // tab reports MEMBERS 0 for a crew of three and the team Users tab has
    // nothing to list, both at HTTP 200 with the rows in `meta.omitted`. The
    // rows stay bounded by bakers.build's own read scope, not by the permission
    // (BB-391).
    'view bakers memberships',
    'view bb_comment',
    'view bb_conductor',
    'view bb_environment',
    'view bb_group',
    'view bb_machine',
    'view bb_project',
    'view bb_run',
    'view bb_team',
    'view bb_term',
    'view bb_ticket',
    'view bb_workspace',
    'write bakers via session scope',
  ];

  /**
   * Permissions whose ABSENCE has a failure mode that names no permission.
   *
   * A subset of the ceiling, kept as its own list because the assertion message
   * differs: these three fail in a way nobody can read off the symptom.
   *
   * - `register bakers conductor`: without it a conductor cannot bootstrap at
   *   all. The FIRST registration is a create, and no rank can authorise it —
   *   a conductor's `app` placement is written BY that create, so the scope is
   *   the only thing standing behind it. (The rank carries this permission too,
   *   since BB-391 measured that BbRankEntityFence drops a scope-only grant
   *   on the fenced UPDATE path; the two are not redundant, they cover the two
   *   halves of a sequential bootstrap. See the `app` rank's config file.)
   * - `use text format bb_rich`: a write carrying `format: bb_rich` is
   *   rejected 422 on `<field>.0.format` before any rank is consulted
   *   (CLAUDE.md › Text-format permission gotcha).
   * - `view bb_ticket`: without it every collection read returns HTTP 200
   *   with an empty `data`, naming no permission and logging nothing.
   *
   * @var array<string>
   */
  private const REQUIRED_SCOPE_PERMISSIONS = [
    'register bakers conductor',
    'use text format bb_rich',
    'view bb_ticket',
  ];

  /**
   * The retired names no shipped config may still reference (AC1).
   *
   * Each needle is the form a SURVIVING REFERENCE actually takes, which is why
   * two of them look redundant and are not:
   *
   * - `bakers:project_manager` is the retired scope's `name`;
   *   `bb_project_manager` is its ID, and also the ID of the user role
   *   BB-359 D6 deleted. A reference — a consumer's `scope_id`, a
   *   `dependencies.config` entry, a `granularity_configuration.role` — is
   *   written with the ID, so the colon form alone could not see any of them.
   * - The deleted ROLE `bb_session` shares its ID with the SURVIVING SCOPE,
   *   so the bare id cannot be a needle: it appears legitimately in 29 files.
   *   Only the config-name form `user.role.bb_session` distinguishes them,
   *   and it is also what a leftover
   *   `system.action.user_*_role_action.bb_session` carries in
   *   `dependencies.config`.
   *
   * @var array<string>
   */
  private const RETIRED_NAMES = [
    'bakers:project_manager',
    'bb_project_manager',
    'bb_agent',
    'bb_e2e',
    'user.role.bb_session',
  ];

  /**
   * The complete role inventory in config/sync after BB-391 D2.
   *
   * @var array<string>
   */
  private const SURVIVING_ROLES = [
    'anonymous',
    'authenticated',
  ];

  /**
   * Every config object BB-391 D2 deletes, on both install paths.
   *
   * Seven objects, not three: deleting a role while leaving the two
   * `system.action.user_*_role_action.*` configs that name it behind would
   * leave config carrying a dependency on a role that does not exist, and CIM
   * aborts on a missing dependency rather than degrading. Each action declares
   * `dependencies.config: [user.role.<id>]` explicitly, so the direction is
   * measured, not assumed.
   *
   * `simple_oauth.oauth2_scope.bb_session` is deliberately NOT in this list.
   * The scope survives; only the ROLE of the same name goes.
   *
   * @var array<string>
   */
  private const DELETED_CONFIG = [
    'simple_oauth.oauth2_scope.bb_project_manager',
    'system.action.user_add_role_action.bb_agent',
    'system.action.user_add_role_action.bb_session',
    'system.action.user_remove_role_action.bb_agent',
    'system.action.user_remove_role_action.bb_session',
    'user.role.bb_agent',
    'user.role.bb_session',
  ];

  /**
   * The one scope is an umbrella over per-permission children — both paths.
   *
   * `Oauth2ScopeProvider::getPermissions()` returns the union of an umbrella's
   * children, so the children ARE the ceiling. Asserted per install path,
   * because a ceiling present on one path and absent on the other is a machine
   * identity that works locally and reads empty on the server.
   */
  public function testTheOneScopeIsAnUmbrellaOverPermissions(): void {
    foreach (['/config/sync', '/recipes/bakers/config'] as $dir) {
      $base = $this->repositoryRoot() . $dir;
      $umbrella = $this->decode($base . '/simple_oauth.oauth2_scope.bb_session.yml');

      self::assertTrue(
        $umbrella['umbrella'] ?? FALSE,
        "$dir: bb:session must be an umbrella, so its children carry the ceiling",
      );
      self::assertNull(
        $umbrella['granularity_id'] ?? NULL,
        "$dir: an umbrella resolves through its children and must name no granularity",
      );
      self::assertSame('bb:session', $umbrella['name'] ?? NULL);

      $granted = [];
      foreach ((array) glob($base . '/simple_oauth.oauth2_scope.bb_session_*.yml') as $file) {
        $name = basename((string) $file);
        $child = $this->decode((string) $file);
        self::assertSame(
          'bb_session',
          $child['parent'] ?? NULL,
          "$name must hang off the umbrella",
        );
        self::assertSame(
          'permission',
          $child['granularity_id'] ?? NULL,
          "$name must grant a PERMISSION, never a role: a role "
          . 'the account holds bypasses BbRankEntityFence entirely',
        );
        // A SHAPE guard, not a capability gate, and the difference was measured
        // rather than assumed. `Oauth2ScopeProvider::getPermissions()` unions
        // an umbrella's children WITHOUT consulting either flag below: with one
        // child at `status: false` and the caches flushed, the umbrella still
        // returned all 29 permissions and still carried the disabled child's.
        // Withdrawing a capability therefore means DELETING the child — an
        // operator who disables one instead is relying on nothing. Both flags
        // are still pinned, because the two install paths must ship the same
        // shape and `simple_oauth` may begin honouring them.
        self::assertTrue($child['status'] ?? FALSE, "$name must be enabled");
        self::assertTrue(
          $child['grant_types']['client_credentials']['status'] ?? FALSE,
          "$name must be enabled for client_credentials, the only grant type a "
          . 'bakers.build machine identity uses',
        );
        $permission = $child['granularity_configuration']['permission'] ?? NULL;
        self::assertIsString($permission, "$name names a permission");
        // The slug is derived, not free: a file whose id and permission
        // disagree is a child nobody can find from either side.
        $slug = 'bb_session_' . str_replace(' ', '_', $permission);
        self::assertSame($slug, $child['id'] ?? NULL, "$name must be named after its permission");
        self::assertSame('bb:session:' . str_replace(' ', '_', $permission), $child['name'] ?? NULL);
        $granted[] = $permission;
      }

      sort($granted);
      self::assertSame(
        self::SCOPE_CEILING,
        $granted,
        "$dir: the umbrella's children ARE the ceiling of every machine identity, "
        . 'so the set is pinned exactly — a missing child is a hard 403 on a '
        . 'shipped surface and an extra one widens what every machine may do',
      );
      foreach (self::REQUIRED_SCOPE_PERMISSIONS as $permission) {
        self::assertContains($permission, $granted, "$dir: the scope must grant $permission");
      }
    }
  }

  /**
   * The two install paths grant the identical ceiling (CLAUDE.md, AC6).
   */
  public function testBothInstallPathsGrantTheSameCeiling(): void {
    $ceiling = [];
    foreach (['/config/sync', '/recipes/bakers/config'] as $dir) {
      $found = [];
      foreach ((array) glob($this->repositoryRoot() . $dir . '/simple_oauth.oauth2_scope.bb_session_*.yml') as $file) {
        $found[] = $this->decode((string) $file)['granularity_configuration']['permission'] ?? NULL;
      }
      sort($found);
      $ceiling[$dir] = $found;
    }
    self::assertSame(
      $ceiling['/config/sync'],
      $ceiling['/recipes/bakers/config'],
      'the CIM path and the recipe path must grant the same ceiling, or a machine '
      . 'identity behaves differently depending on how the site was installed',
    );
  }

  /**
   * NO bakers.build permission is granted on `authenticated`, on either path.
   *
   * This is the assertion that keeps the CEILING — the bakers.build
   * entity-access permissions the `bb_session` scope's children name — out of
   * the one role every account holds. `hasSiteWidePermission()` reads the
   * ACCOUNT's roles, and `BbGroupScopedAccount::hasPermission()` returns TRUE
   * on that branch without bounding to a group — so a bakers.build permission
   * on `authenticated` makes every logged-in user tenant-blind, in the web UI
   * too. Verified live while diagnosing BB-391: three `view` permissions
   * granted there returned every ticket of every project to an account whose
   * ranks named one.
   *
   * `grant simple_oauth codes` (BB-494) is deliberately the ONE exception, and
   * the property it is checked against is narrower than "contains `bakers`": it
   * is core `simple_oauth`'s OWN gate on its `/oauth/authorize` consent screen,
   * reaches no bakers.build entity, and grants no row access at all —
   * `hasSiteWidePermission()`/`BbGroupScopedAccount` never consult it. Every
   * signed-in human is a legitimate CLI-sign-in candidate, which is exactly
   * what `authenticated` already means, so this permission belongs there rather
   * than on a narrower role invented only to hold it.
   *
   * `change own username` is the second, for the same kind of
   * reason: it is core `user`'s own gate on the `name` element of an account's
   * own edit form, reaches no bakers.build entity and grants no row access. The
   * onboarding wizard asks every account for a nickname, so every account
   * must be able to change it again.
   *
   * `access content` is the third: core `file`'s own gate on viewing a public
   * file, which an image field checks for a newly uploaded picture on Save —
   * without it no account can set a profile picture on the recipe path. It
   * reaches no bakers.build entity, no bakers.build access code reads it, and
   * `config/sync` already grants it, so the recipe merely stops differing from
   * CIM. The assertion pins the ceiling to EXACTLY these three non-bakers.build
   * permissions rather than dropping the check — a fourth, unnoticed addition
   * here is still the failure this test exists to catch.
   */
  public function testNothingIsGrantedOnAuthenticated(): void {
    $role = $this->decode($this->syncPath('user.role.authenticated.yml'));
    foreach ($role['permissions'] ?? [] as $permission) {
      self::assertStringNotContainsString(
        'bakers',
        $permission,
        "authenticated must not carry `$permission`: every account holds this role, "
        . 'so a bakers.build permission here bypasses the rank fence for everyone',
      );
    }

    self::assertFileDoesNotExist(
      $this->repositoryRoot() . '/recipes/bakers/config/user.role.authenticated.yml',
      'a full recipe copy would collide with the user module config/install default',
    );
    $recipe = $this->decode($this->repositoryRoot() . '/recipes/bakers/recipe.yml');
    self::assertSame(
      ['grantPermissions' => ['grant simple_oauth codes', 'change own username', 'access content']],
      $recipe['config']['actions']['user.role.authenticated'] ?? NULL,
      'the recipe must grant authenticated nothing beyond the CLI-sign-in, own-username and public-file permissions',
    );
  }

  /**
   * Both machine roles, both scopes and their actions are gone — both paths.
   */
  public function testTheDeletedConfigIsAbsentFromBothInstallPaths(): void {
    foreach (self::DELETED_CONFIG as $name) {
      self::assertFileDoesNotExist(
        $this->syncPath("$name.yml"),
        "$name must be gone from config/sync",
      );
      self::assertFileDoesNotExist(
        $this->repositoryRoot() . "/recipes/bakers/config/$name.yml",
        "$name must be gone from the recipe copy too",
      );
    }
  }

  /**
   * No shipped config anywhere still names a deleted scope (AC1).
   *
   * Enumerated over the whole of both directories rather than over the list
   * above, because the failure AC1 describes is a SURVIVING reference — a
   * consumer, a scope, a role action pointing at something deleted — and a
   * file-absence check by name cannot see one.
   */
  public function testNoShippedConfigStillNamesTheDeletedScopes(): void {
    $offenders = [];
    foreach (['/config/sync', '/recipes/bakers/config'] as $dir) {
      $files = glob($this->repositoryRoot() . $dir . '/*.yml');
      self::assertIsArray($files);
      self::assertNotEmpty($files);
      foreach ($files as $file) {
        foreach ($this->retiredNamesIn((string) file_get_contents($file)) as $needle) {
          $offenders[] = basename($file) . " names $needle";
        }
      }
    }
    self::assertSame([], $offenders);
  }

  /**
   * The matcher above really does catch each shape a leftover takes.
   *
   * Without this the sweep is unfalsifiable: it enumerates the whole of both
   * directories, finds nothing, and passes — which is also exactly what it does
   * when its needles cannot match the form a reference is written in. Two of
   * them could not: `bakers:project_manager` never appears in a reference (an
   * ID does, with an underscore), and the deleted ROLE `bb_session` shares its
   * id with the surviving SCOPE, so it was left out of the needle list entirely
   * and a re-added `user.role.bb_session` would have sailed through.
   *
   * The synthetic bodies below are the real config shapes: a consumer's
   * `scope_id`, a scope's `granularity_configuration.role`, an account's
   * `roles` field, and an action's `dependencies.config`.
   */
  public function testTheLeftoverMatcherCatchesEachRetiredName(): void {
    $cases = [
      'bakers:project_manager' => "name: 'bakers:project_manager'",
      'bb_project_manager' => "scopes:\n  - scope_id: bb_project_manager",
      'bb_agent' => "roles:\n  - target_id: bb_agent",
      'bb_e2e' => "scopes:\n  - scope_id: bb_e2e",
      'user.role.bb_session' => "dependencies:\n  config:\n    - user.role.bb_session",
    ];
    foreach ($cases as $needle => $body) {
      self::assertContains(
        $needle,
        $this->retiredNamesIn($body),
        "the sweep must catch a leftover written as: $body",
      );
    }

    // And the surviving scope, whose id IS `bb_session`, must not be caught
    // by any of them — otherwise the sweep would fail on all 29 shipped files.
    self::assertSame(
      [],
      $this->retiredNamesIn("id: bb_session\nparent: bb_session\nname: 'bb:session'"),
      'the surviving umbrella and its children must not read as leftovers',
    );
  }

  /**
   * The retired names a config body still references.
   *
   * Comments are stripped first: this looks for a surviving REFERENCE — a
   * consumer `scope_id`, a granularity role, a dependency — and the config
   * files carry prose that legitimately names what was retired and why.
   *
   * @param string $body
   *   The raw file contents.
   *
   * @return array<string>
   *   The matched needles, in RETIRED_NAMES order.
   */
  private function retiredNamesIn(string $body): array {
    $code = implode("\n", array_filter(
      explode("\n", $body),
      static fn (string $line): bool => !str_starts_with(ltrim($line), '#'),
    ));

    return array_values(array_filter(
      self::RETIRED_NAMES,
      static fn (string $needle): bool => str_contains($code, $needle),
    ));
  }

  /**
   * The e2e world has no identity of its own any more.
   *
   * One scope means one, including here. `recipes/bb_e2e` used to ship a scope
   * and a role of its own, and its seeded agent therefore ran on a
   * two-permission ceiling — which is exactly why a hand-driven conductor run
   * could read nothing. Its consumer now requests the same `bb_session`
   * umbrella as every other bakers.build identity, and its account holds no
   * machine role at all.
   */
  public function testTheE2eWorldRunsOnTheOneScope(): void {
    $e2e = $this->repositoryRoot() . '/recipes/bb_e2e';
    self::assertFileDoesNotExist($e2e . '/config/user.role.bb_e2e.yml');
    self::assertFileDoesNotExist($e2e . '/config/simple_oauth.oauth2_scope.bb_e2e.yml');

    $consumers = (array) glob($e2e . '/content/consumer/*.yml');
    self::assertNotEmpty($consumers);
    foreach ($consumers as $file) {
      $body = (string) file_get_contents((string) $file);
      self::assertStringContainsString('scope_id: bb_session', $body);
      self::assertStringNotContainsString('bb_e2e', $body);
    }

    foreach ((array) glob($e2e . '/content/user/*.yml') as $file) {
      self::assertStringNotContainsString(
        'bb_e2e',
        (string) file_get_contents((string) $file),
        basename((string) $file) . ' must hold no machine role',
      );
    }
  }

  /**
   * The project-manager role stays gone from both install paths (BB-359 D6).
   */
  public function testTheProjectManagerRoleIsGone(): void {
    self::assertFileDoesNotExist($this->syncPath('user.role.bb_project_manager.yml'));
    self::assertFileDoesNotExist(
      $this->repositoryRoot() . '/recipes/bakers/config/user.role.bb_project_manager.yml',
    );
    // The two actions core generates per role declare it as a config
    // dependency, so leaving them would abort CIM on a missing dependency.
    foreach (['user_add_role_action', 'user_remove_role_action'] as $action) {
      self::assertFileDoesNotExist(
        $this->syncPath("system.action.$action.bb_project_manager.yml"),
      );
    }
  }

  /**
   * The role inventory is closed, and none of them is an administrator.
   *
   * Enumerated from the directory rather than from a list this test carries, so
   * a role added later fails here instead of quietly joining the inventory.
   */
  public function testTheRoleInventoryIsClosedAndNoneIsAnAdministrator(): void {
    $files = glob($this->syncPath('user.role.*.yml'));
    self::assertIsArray($files);
    $ids = array_map(
      static fn (string $file): string => (string) preg_replace(
        '/^user\.role\.(.*)\.yml$/',
        '$1',
        basename($file),
      ),
      $files,
    );
    sort($ids);
    self::assertSame(self::SURVIVING_ROLES, $ids);

    foreach ($ids as $id) {
      $role = $this->decode($this->syncPath("user.role.$id.yml"));
      // Uid 1 is the only bypass and stays the only one. A role with is_admin,
      // or one holding `administer bakers`, would silently un-fence Layer B for
      // everyone who holds it — and nothing else in the tree would report it.
      self::assertFalse($role['is_admin'] ?? FALSE, "$id must not be an administrator role");
      self::assertNotContains(
        'administer bakers',
        $role['permissions'] ?? [],
        "$id must not hold administer bakers",
      );
    }
  }

  /**
   * Decodes a config file.
   *
   * @param string $path
   *   The absolute path.
   *
   * @return array<string, mixed>
   *   The decoded config.
   */
  private function decode(string $path): array {
    self::assertFileExists($path);
    $decoded = Yaml::decode((string) file_get_contents($path));
    self::assertIsArray($decoded);

    return $decoded;
  }

  /**
   * The absolute path of a config/sync file.
   *
   * @param string $name
   *   The file name.
   *
   * @return string
   *   The absolute path.
   */
  private function syncPath(string $name): string {
    return $this->repositoryRoot() . '/config/sync/' . $name;
  }

  /**
   * The repository root, resolved from this file's own location.
   */
  private function repositoryRoot(): string {
    return dirname(__DIR__, 7);
  }

}
