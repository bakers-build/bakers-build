<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\RailRequestTrait;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The Notifications entry of the account menu follows the page's own access.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class AccountMenuLinkTest extends KernelTestBase {

  use UserCreationTrait;
  use RailRequestTrait;

  private const LINK_ID = 'bb_activity.account.notifications';

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'file', 'image', 'serialization', 'jsonapi',
    'bb_core', 'bb_activity', 'bb_activity_test',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('bb_notification_setting');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installConfig(['system', 'user']);
    $this->createUser([], 'root');
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * The entry sits between Schedule and Conductors in the account menu.
   */
  public function testTheEntryComesAfterTimeAndBeforeConductors(): void {
    $weights = [];
    foreach ($this->container->get('plugin.manager.menu.link')->getDefinitions() as $id => $definition) {
      if (($definition['menu_name'] ?? NULL) === 'bakers-account') {
        $weights[$id] = $definition['weight'];
      }
    }
    self::assertGreaterThan($weights['bb_core.account.profile'], $weights[self::LINK_ID]);
    self::assertLessThan($weights['bb_core.account.conductors'], $weights[self::LINK_ID]);
    self::assertLessThan($weights['bb_core.account.machines'], $weights['bb_core.account.conductors']);
  }

  /**
   * Present on one's own account and for an administrator; absent otherwise.
   */
  public function testTheEntryShowsOnlyWhereTheSettingsPageOpens(): void {
    $owner = $this->account('owner');
    $other = $this->account('other');
    $admin = $this->account('admin', ['administer bakers']);

    self::assertTrue($this->shownTo($owner, $owner), 'The owner sees the entry on their own account.');
    self::assertFalse($this->shownTo($other, $owner), 'Another member does not see it on the owner\'s account.');
    self::assertTrue($this->shownTo($admin, $owner), 'An administrator sees it on another account.');
  }

  /**
   * Whether the viewer may follow the entry while on the account's pages.
   */
  private function shownTo(UserInterface $viewer, UserInterface $viewed): bool {
    $this->setCurrentUser($viewer);
    $this->visit('entity.user.canonical', ['user' => $viewed->id()]);
    $link = $this->container->get('plugin.manager.menu.link')->createInstance(self::LINK_ID);
    return $this->container->get('access_manager')->checkNamedRoute(
      $link->getRouteName(),
      $link->getRouteParameters(),
      $viewer,
    );
  }

  /**
   * An account with the permissions.
   *
   * @param string $name
   *   The account name.
   * @param array<string> $permissions
   *   Permissions to grant.
   */
  private function account(string $name, array $permissions = []): UserInterface {
    $account = $this->createUser($permissions, $name);
    self::assertInstanceOf(UserInterface::class, $account);
    return $account;
  }

}
