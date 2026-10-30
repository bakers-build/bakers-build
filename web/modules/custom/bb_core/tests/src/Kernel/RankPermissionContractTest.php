<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The shipped OG ranks are the contract Layer A projects (BB-359 D3, D12).
 *
 * Four assertions no reviewer can make by reading, because OG validates none
 * of them: `og_role.permissions` is an unvalidated string sequence and
 * `OgAccess::userAccess()` does a plain in_array(), so a typo produces a rank
 * that quietly grants less than the spec claims — no error, no log line, no
 * failing save (spec R3, Fact 18).
 *
 * The permission registry this checks against is the container's registry
 * UNION every custom module's own `*.permissions.yml`. The union is needed
 * because one name in the map comes from a module a kernel test cannot
 * cheaply enable — `access bakers dashboard` (bb_dashboard, which pulls the
 * whole display_builder stack). Reading its YAML is weaker than booting it,
 * and it is still enough for what this test exists to catch: a typo appears
 * in neither source.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RankPermissionContractTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'bb_core',
    // The lead rank names `* bb_ticket_trigger`, which the Entity module's
    // permission provider generates only while the submodule is enabled.
    'views', 'plugin', 'bb_ticket_trigger',
    // The contributor and lead ranks name `access mcp server`.
    'mcp_server',
  ];

  /**
   * OG's own group permissions, which no Drupal permission registry knows.
   *
   * They are legitimate values in an `og_role.permissions` list — OgAccess
   * compares the same strings — so they are skipped rather than renamed.
   *
   * @var array<string>
   */
  private const OG_GROUP_PERMISSIONS = [
    'update group', 'delete group', 'manage members', 'administer group',
  ];

  /**
   * The complete rank vocabulary after D12, sorted.
   *
   * @var array<string>
   */
  private const RANK_IDS = [
    'bb_team-bb_team-lead',
    'bb_team-bb_team-member',
    'bb_team-bb_team-non-member',
    'bb_team-bb_team-owner',
    'bb_workspace-bb_workspace-contributor',
    'bb_workspace-bb_workspace-guest',
    'bb_workspace-bb_workspace-lead',
    'bb_workspace-bb_workspace-member',
    'bb_workspace-bb_workspace-non-member',
  ];

  /**
   * The ranks that must stay empty (BB-462 D1, D3; amended by BB-479).
   *
   * The three `non-member` ranks because OgAccess::userAccess() evaluates
   * `non-member` for every account WITHOUT a membership (spec Fact 17), so a
   * permission there is granted to the whole authenticated world inside that
   * group type. `bb_workspace-bb_workspace-member` is emptied by
   * BB-462 D1: OG ranks are additive and cannot be narrowed, so any right
   * left here would be inherited by every membership including guests —
   * every tier now sits on an explicitly stored role instead (`guest`,
   * `contributor`, `lead`/admin). `bb_team-bb_team-member` is no longer
   * on this list: BB-479 gives it the three general statistic reads — a
   * team carries visibility, and disclosure of a team's own aggregate
   * figures to its own members is visibility, not a right.
   *
   * @var array<string>
   */
  private const EMPTY_BY_DECISION = [
    'bb_team-bb_team-non-member',
    'bb_workspace-bb_workspace-member',
    'bb_workspace-bb_workspace-non-member',
  ];

  /**
   * Every permission named on a shipped rank exists (spec R3).
   */
  public function testEveryShippedRankPermissionExists(): void {
    $known = $this->knownPermissionNames();
    foreach ($this->shippedRanks() as $id => $rank) {
      foreach ($rank['permissions'] ?? [] as $permission) {
        if (in_array($permission, self::OG_GROUP_PERMISSIONS, TRUE)) {
          continue;
        }
        self::assertContains(
          $permission,
          $known,
          sprintf('%s names an unknown permission "%s"', $id, $permission),
        );
      }
    }
  }

  /**
   * The canonical copy and the CIM copy of every rank are identical (AC 4).
   */
  public function testInstallAndSyncCopiesDoNotDrift(): void {
    $files = glob($this->installDir() . '/og.og_role.*.yml');
    self::assertIsArray($files);
    self::assertNotEmpty($files, 'bb_core ships og_role config.');
    foreach ($files as $file) {
      $sync_file = $this->syncDir() . '/' . basename($file);
      self::assertFileExists($sync_file, basename($file) . ' is missing from config/sync');
      $install = $this->decode($file);
      $sync = $this->decode($sync_file);
      unset($install['uuid'], $install['_core'], $sync['uuid'], $sync['_core']);
      ksort($install);
      ksort($sync);
      self::assertSame(
        $install,
        $sync,
        basename($file) . ' drifts between config/install and config/sync',
      );
    }
    // bb_api_key ships the team Reporter rank; it is checked for drift in
    // the same way, but kept out of shippedRanks(), the bb_core vocabulary.
    $submodule_files = glob($this->container->get('extension.list.module')->getPath('bb_api_key') . '/config/install/og.og_role.*.yml') ?: [];
    foreach ($submodule_files as $file) {
      $install = $this->decode($file);
      $sync = $this->decode($this->syncDir() . '/' . basename($file));
      unset($install['uuid'], $install['_core'], $sync['uuid'], $sync['_core']);
      ksort($install);
      ksort($sync);
      self::assertSame($install, $sync, basename($file) . ' drifts between config/install and config/sync');
    }
    self::assertCount(
      count($files) + count($submodule_files),
      glob($this->syncDir() . '/og.og_role.*.yml') ?: [],
      'config/sync holds no rank the module does not ship',
    );
  }

  /**
   * The vocabulary is exactly `member` + `lead` per group type (D12).
   */
  public function testTheRankVocabularyIsExactlyMemberAndLead(): void {
    $ids = array_keys($this->shippedRanks());
    sort($ids);
    self::assertSame(
      self::RANK_IDS,
      $ids,
      'admin, owner and administrator are gone and lead has replaced them (D12)',
    );
  }

  /**
   * Every capability rank grants something, and no rank is an admin rank.
   */
  public function testCapabilityGrantingRanksAreNotEmptyAndNoneIsAdmin(): void {
    foreach ($this->shippedRanks() as $id => $rank) {
      // No bakers.build rank declares is_admin: OgRole::getPermissions()
      // returns [] for one, so Layer A would project nothing from it, and
      // OgAccess short-circuits on it so Layer B has nothing to compare (D2,
      // Fact 18).
      self::assertFalse((bool) ($rank['is_admin'] ?? FALSE), $id . ' must not declare is_admin');
      $permissions = $rank['permissions'] ?? [];
      if (in_array($id, self::EMPTY_BY_DECISION, TRUE)) {
        self::assertSame([], $permissions, $id . ' must stay empty');
        continue;
      }
      self::assertNotSame([], $permissions, $id . ' must grant capability (AC 2)');
      $sorted = $permissions;
      sort($sorted);
      // OgRole::preSave() sorts the list, so an unsorted file drifts from the
      // saved form and aborts the recipe's config.import.
      self::assertSame($sorted, $permissions, $id . ' must list its permissions sorted');
    }
  }

  /**
   * Workspace contributor and lead grant own-machine update; nobody gets any.
   */
  public function testWorkspaceRanksGrantOwnMachineUpdate(): void {
    $ranks = $this->shippedRanks();
    $own_machine_ranks = [
      'bb_workspace-bb_workspace-contributor',
      'bb_workspace-bb_workspace-lead',
    ];
    foreach ($own_machine_ranks as $id) {
      self::assertContains(
        'update own bb_machine',
        $ranks[$id]['permissions'] ?? [],
        $id . ' must grant update own bb_machine',
      );
      self::assertNotContains(
        'update any bb_machine',
        $ranks[$id]['permissions'] ?? [],
        $id . ' must not grant update any bb_machine',
      );
    }
    foreach ($ranks as $id => $rank) {
      if (in_array($id, $own_machine_ranks, TRUE)) {
        continue;
      }
      self::assertNotContains(
        'update own bb_machine',
        $rank['permissions'] ?? [],
        $id . ' must not grant update own bb_machine',
      );
    }
  }

  /**
   * The retired import permission is granted by no shipped rank.
   */
  public function testImportPermissionIsNotGranted(): void {
    foreach ($this->shippedRanks() as $id => $rank) {
      self::assertNotContains(
        'import bakers tickets',
        $rank['permissions'] ?? [],
        $id . ' still grants the retired import permission',
      );
    }
  }

  /**
   * The shipped rank config, keyed by id.
   *
   * @return array<string, array<string, mixed>>
   *   The decoded config/install rank files.
   */
  private function shippedRanks(): array {
    $ranks = [];
    $files = glob($this->installDir() . '/og.og_role.*.yml');
    self::assertIsArray($files);
    foreach ($files as $file) {
      $data = $this->decode($file);
      self::assertArrayHasKey('id', $data, basename($file) . ' declares an id');
      $ranks[(string) $data['id']] = $data;
    }
    return $ranks;
  }

  /**
   * Every permission name this site could possibly know.
   *
   * @return array<string>
   *   The registry names plus every name declared in a custom module's YAML.
   */
  private function knownPermissionNames(): array {
    $names = array_keys($this->container->get('user.permissions')->getPermissions());
    foreach ($this->customPermissionFiles() as $file) {
      $declared = Yaml::decode((string) file_get_contents($file));
      if (is_array($declared)) {
        $names = array_merge($names, array_keys($declared));
      }
    }
    // `use text format <id>` is generated per FORMAT by filter's permission
    // callback rather than declared anywhere, and instantiating bb_rich here
    // would pull its filter plugins into a kernel test that has no use for
    // them. The shipped format files are the same source the callback reads.
    foreach ($this->shippedFilterFormatIds() as $format_id) {
      $names[] = 'use text format ' . $format_id;
    }
    // `view bakers figure <id>` is generated per FIGURE by
    // FigurePermissions::permissions() rather than
    // declared anywhere, the same reason as the filter-format case above: this
    // test installs no `bb_figure` config, so the callback itself would
    // report none. The shipped figure files are the same source it reads.
    foreach ($this->shippedFigureIds() as $figure_id) {
      $names[] = 'view bakers figure ' . $figure_id;
    }

    return array_values(array_unique($names));
  }

  /**
   * The ids of every filter format the tree ships.
   *
   * @return array<string>
   *   The format ids.
   */
  private function shippedFilterFormatIds(): array {
    $ids = [];
    foreach ([$this->installDir(), $this->syncDir()] as $directory) {
      foreach (glob($directory . '/filter.format.*.yml') ?: [] as $file) {
        $data = $this->decode($file);
        if (isset($data['format'])) {
          $ids[] = (string) $data['format'];
        }
      }
    }
    return $ids;
  }

  /**
   * The ids of every configured composite figure the tree ships.
   *
   * @return array<string>
   *   The figure ids.
   */
  private function shippedFigureIds(): array {
    // A `bb_figure` is a config ENTITY, so — unlike a rank or a filter
    // format — it ships from `config/sync` and the recipe's own `config/**`
    // only, never from the module's `config/install` (CLAUDE.md).
    $ids = [];
    foreach ([dirname($this->root) . '/recipes/bakers/config', $this->syncDir()] as $directory) {
      foreach (glob($directory . '/bb_core.bb_figure.*.yml') ?: [] as $file) {
        $data = $this->decode($file);
        if (isset($data['id'])) {
          $ids[] = (string) $data['id'];
        }
      }
    }
    return $ids;
  }

  /**
   * Every `*.permissions.yml` under web/modules/custom, at any depth.
   *
   * @return array<string>
   *   Absolute file paths.
   */
  private function customPermissionFiles(): array {
    $files = [];
    $directory = new \RecursiveDirectoryIterator($this->root . '/modules/custom');
    foreach (new \RecursiveIteratorIterator($directory) as $file) {
      if ($file instanceof \SplFileInfo && str_ends_with($file->getFilename(), '.permissions.yml')) {
        $files[] = $file->getPathname();
      }
    }
    return $files;
  }

  /**
   * Decodes a YAML file into an array.
   *
   * @param string $file
   *   The absolute path.
   *
   * @return array<string, mixed>
   *   The decoded data.
   */
  private function decode(string $file): array {
    $data = Yaml::decode((string) file_get_contents($file));
    self::assertIsArray($data, $file . ' decodes to an array');
    return $data;
  }

  /**
   * The canonical rank config directory.
   */
  private function installDir(): string {
    return $this->container->get('extension.list.module')->getPath('bb_core') . '/config/install';
  }

  /**
   * The CIM config directory.
   */
  private function syncDir(): string {
    return dirname($this->root) . '/config/sync';
  }

}
