<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\FileStorage;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\og\OgRoleInterface;
use Drupal\user\UserInterface;

/**
 * The OG registration and membership every read-scope-aware test needs.
 *
 * Since BB-318 a bakers.build collection query returns the rows of the
 * account's OG scope, so a kernel test whose actor expects rows must either
 * hold the type's admin permission or hold a membership. This trait is the
 * second option: the shipped role config, the shipped group registration and
 * one membership writer, so no test has to restate any of them.
 *
 * Both are read out of what the repository ships rather than restated, so a
 * wrong shape in the shipped config fails in a test instead of on the server.
 */
trait OgScopeFixtureTrait {

  /**
   * The workspace roles bakers.build ships.
   *
   * `app`, the machine principal, is GONE (BB-462 D9): a conductor's OAuth
   * identity is bound to its owning user's account and sees what that user
   * sees through the user's own rank.
   *
   * @var array<string>
   */
  private const OG_WORKSPACE_ROLE_NAMES = [
    'non-member', 'member', 'contributor', 'lead', 'guest',
  ];

  /**
   * The team roles bakers.build ships.
   *
   * BB-321 shipped 'member'/'non-member'; BB-456 D9 added 'lead';
   * BB-462 D3 added 'owner'.
   *
   * @var array<string>
   */
  private const OG_TEAM_ROLE_NAMES = [
    'non-member', 'member', 'lead', 'owner',
  ];

  /**
   * Installs og config, refreshes the caches it invalidates, and registers.
   */
  protected function installOgScopeFixture(): void {
    $this->installConfig(['og']);
    // The bundle-keyed typed-data derivatives are cached, and og_membership's
    // `default` bundle only comes into existence with the config just
    // installed. Without the refresh, validating a membership asks for the
    // typed-data plugin `entity:og_membership:default` and gets a
    // PluginNotFoundException.
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    $this->container->get('typed_data_manager')->clearCachedDefinitions();
    $this->installShippedOgRoles();
    $this->registerShippedOgGroups();
  }

  /**
   * Installs the OG role config bb_core ships for both group types.
   */
  protected function installShippedOgRoles(): void {
    $path = $this->container->get('extension.list.module')->getPath('bb_core');
    $source = new FileStorage($path . '/config/install');
    $storage = $this->container->get('entity_type.manager')
      ->getStorage('og_role');
    $names = [];
    foreach (self::OG_WORKSPACE_ROLE_NAMES as $name) {
      $names[] = 'og.og_role.bb_workspace-bb_workspace-' . $name;
    }
    // No bb_project roles: BB-462 D7 deregisters it as an OG group
    // entirely and deletes its three shipped roles.
    foreach (self::OG_TEAM_ROLE_NAMES as $name) {
      $names[] = 'og.og_role.bb_team-bb_team-' . $name;
    }
    foreach ($names as $config_name) {
      $data = $source->read($config_name);
      self::assertIsArray($data, "Shipped config $config_name exists.");
      $storage->create($data)->save();
    }
  }

  /**
   * Registers workspace and team as OG groups from the shipped og.settings.
   */
  protected function registerShippedOgGroups(): void {
    $storage = new FileStorage(dirname($this->root) . '/config/sync');
    $data = $storage->read('og.settings');
    self::assertIsArray($data, 'config/sync/og.settings.yml exists.');
    $this->config('og.settings')->set('groups', $data['groups'])->save();
    // The group map is a per-request in-memory property; drop the stale one.
    $this->container->get('og.group_type_manager')->reset();
    self::assertTrue(Og::isGroup('bb_workspace', 'bb_workspace'));
    self::assertTrue(Og::isGroup('bb_team', 'bb_team'));
    // bb_project is deliberately NOT a group any more (BB-462 D7).
    self::assertFalse(Og::isGroup('bb_project', 'bb_project'));
  }

  /**
   * Grants an account an active membership in a group, with optional roles.
   *
   * @param \Drupal\Core\Entity\EntityInterface $group
   *   The group entity — a bb_workspace or a bb_team.
   * @param \Drupal\user\UserInterface $account
   *   The account to make a member.
   * @param array<string> $role_names
   *   Role names (not ids) to attach, e.g. ['lead'].
   *
   * @return \Drupal\og\OgMembershipInterface
   *   The saved membership.
   */
  protected function addMembership(EntityInterface $group, UserInterface $account, array $role_names = []): OgMembershipInterface {
    self::assertInstanceOf(ContentEntityInterface::class, $group);
    // Upsert, because OG may already have created one: saving a group while an
    // account is the current user makes that account the group's owner, and
    // `og.settings.auto_add_group_owner_membership` gives every owner a
    // membership on insert (spec Fact 15). A second create() would abort with
    // "An OG membership already exists for user ID …".
    $membership = Og::getMembership(
      $group,
      $account,
      OgMembershipInterface::ALL_STATES,
    ) ?? Og::createMembership($group, $account);
    $membership->setState(OgMembershipInterface::STATE_ACTIVE);
    if ($role_names !== []) {
      $storage = $this->container->get('entity_type.manager')
        ->getStorage('og_role');
      $group_type = $group->getEntityTypeId();
      $ids = [];
      foreach ($role_names as $role_name) {
        $ids[] = "$group_type-$group_type-$role_name";
      }
      $roles = [];
      foreach ($storage->loadMultiple($ids) as $role) {
        self::assertInstanceOf(OgRoleInterface::class, $role);
        $roles[] = $role;
      }
      self::assertCount(count($ids), $roles, 'Every named role exists.');
      $membership->setRoles($roles);
    }
    $membership->save();
    // MembershipManager memoises per (uid, states) in cache.static, so a
    // membership written after a resolution would otherwise be invisible.
    $this->container->get('cache.static')->deleteAll();
    return $membership;
  }

}
