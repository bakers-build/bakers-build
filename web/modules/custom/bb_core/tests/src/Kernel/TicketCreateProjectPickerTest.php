<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\FileStorage;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The create dialog's Project picker offers exactly the creatable projects.
 *
 * Workspace a holds project A (team a) and project S (its own team);
 * workspace b holds project B. No account here holds a site-wide
 * `create bb_ticket`, so only ranks decide.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketCreateProjectPickerTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  private const HANDLER = 'bb_project_ticket_creatable';

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'island', 'bb_core',
  ];

  /**
   * Project ids keyed A, S (workspace a) and B (workspace b).
   *
   * @var array<string, string>
   */
  private array $projects = [];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->installConfig(['system', 'filter', 'bb_core']);
    $this->buildTwoWorkspaceWorld();
    $owner = $this->fixture('a', 'bb_project')->get('owner_user_id')->target_id;
    $team = $this->createEntity('bb_team', [
      'name' => 'team-s',
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
      'owner_user_id' => $owner,
    ]);
    $sibling = $this->createEntity('bb_project', [
      'name' => 'project-s',
      'group_id' => $this->fixture('a', 'bb_project')->get('group_id')->target_id,
      'teams' => [$team->id()],
      'owner_user_id' => $owner,
    ]);
    $this->projects = [
      'A' => (string) $this->fixture('a', 'bb_project')->id(),
      'S' => (string) $sibling->id(),
      'B' => (string) $this->fixture('b', 'bb_project')->id(),
    ];
    $data = (new FileStorage(dirname($this->root) . '/config/sync'))->read('og.og_role.bb_team-bb_team-reporter');
    self::assertIsArray($data);
    $this->container->get('entity_type.manager')->getStorage('og_role')->create($data)->save();
  }

  /**
   * AC3: the picker lists exactly the workspace projects one may create in.
   */
  public function testPickerListsExactlyCreatableProjects(): void {
    self::assertSame(['A', 'S'], $this->candidatesFor($this->reader('contributor', ['contributor'])));
    self::assertSame([], $this->candidatesFor($this->reader('member', ['member'])));
    self::assertSame(['A'], $this->candidatesFor($this->reader('reporter', ['member'], ['reporter'])));
  }

  /**
   * Creates a reader of workspace a, a member of team a, and acts as it.
   *
   * @param string $name
   *   The account name.
   * @param array<string> $workspace_roles
   *   Its workspace a roles.
   * @param array<string> $team_roles
   *   Its team a roles.
   */
  private function reader(string $name, array $workspace_roles, array $team_roles = []): UserInterface {
    $account = $this->createAccount($name, ['view bb_workspace', 'view bb_project', 'view bb_ticket']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, $workspace_roles);
    $this->addMembership($this->fixture('a', 'bb_team'), $account, $team_roles);
    $this->container->get('current_user')->setAccount($account);
    return $account;
  }

  /**
   * The picker's candidates as project keys, sorted.
   *
   * @return list<string>
   *   Keys of $this->projects.
   */
  private function candidatesFor(UserInterface $reader): array {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create(['workflow' => 'bb_work']);
    self::assertInstanceOf(ContentEntityInterface::class, $ticket);
    $ids = array_keys($this->container->get('bb_core.reference_options')->for($ticket, 'project_id', NULL, 0, self::HANDLER));
    $keys = array_keys(array_intersect($this->projects, array_map('strval', $ids)));
    self::assertCount(count($ids), $keys, 'Only known projects are offered.');
    sort($keys);
    return $keys;
  }

}
