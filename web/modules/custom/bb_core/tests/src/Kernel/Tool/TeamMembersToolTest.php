<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Lists the active members of one visible team with their team roles.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TeamMembersToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;
  use FullNameFieldTrait;

  /**
   * The team under test, in the actor's workspace.
   */
  private ContentEntityInterface $alpha;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installFullNameField();
    $this->alpha = $this->entity('bb_team', ['name' => 'alpha', 'workspace_id' => $this->workspace->id()]);
    $this->addMembership($this->alpha, $this->actor, ['lead']);
    // Created out of name order, so only the username sort lists bea first.
    $this->member('cem');
    $this->member('bea', 'Bea Berg');
    $this->member('dan')->block()->save();
    $this->addMembership($this->alpha, $this->member('eve'))->setState(OgMembershipInterface::STATE_BLOCKED)->save();
    $this->container->get('bb_core.workspace_read_scope')->reset();
  }

  /**
   * Active members of active accounts, by username, with sorted roles.
   */
  public function testListsActiveMembersWithRoles(): void {
    $bea = user_load_by_name('bea');
    $cem = user_load_by_name('cem');
    assert($bea instanceof UserInterface && $cem instanceof UserInterface);
    self::assertSame([
      'members' => [
        ['uuid' => $this->actor->uuid(), 'name' => 'actor', 'full_name' => NULL, 'roles' => ['lead', 'member']],
        ['uuid' => $bea->uuid(), 'name' => 'bea', 'full_name' => 'Bea Berg', 'roles' => ['member']],
        ['uuid' => $cem->uuid(), 'name' => 'cem', 'full_name' => NULL, 'roles' => ['member']],
      ],
      'next_offset' => NULL,
    ], $this->outputs($this->runTool('bakers_team_members', ['team' => $this->alpha->uuid()])));
  }

  /**
   * A team larger than one page is complete across pages.
   */
  public function testPagesAcrossMembers(): void {
    $team = $this->alpha->uuid();
    $first = $this->outputs($this->runTool('bakers_team_members', ['team' => $team, 'limit' => 2]));
    self::assertSame(['actor', 'bea'], array_column($first['members'], 'name'));
    self::assertSame(2, $first['next_offset']);
    $second = $this->outputs($this->runTool('bakers_team_members', ['team' => $team, 'limit' => 2, 'offset' => 2]));
    self::assertSame(['cem'], array_column($second['members'], 'name'));
    self::assertNull($second['next_offset']);
  }

  /**
   * A team in a workspace the caller is not in is refused like an unknown one.
   */
  public function testInvisibleTeamIsRefusedLikeUnknown(): void {
    $this->foreignWorkspace();
    $random = $this->container->get('uuid')->generate();
    foreach ([$this->alpha->uuid(), $random] as $uuid) {
      $result = $this->runTool('bakers_team_members', ['team' => $uuid]);
      self::assertFalse($result->isSuccess(), $uuid);
      self::assertSame("Invalid input: Team $uuid does not exist or is not readable.", (string) $result->getMessage());
    }
  }

  /**
   * The inputs are an allowlist and the descriptions point to the tool.
   */
  public function testInputs(): void {
    $manager = $this->container->get('plugin.manager.tool');
    $definition = $manager->getDefinition('bakers_team_members');
    self::assertSame(['team', 'limit', 'offset'], array_keys($definition->getInputDefinitions()));
    self::assertStringContainsString('pick an assignee or reviewer', (string) $definition->getDescription());
    $roles = $definition->getOutputDefinitions()['members']->getItemDefinition()->getPropertyDefinitions()['roles'];
    self::assertSame('The team roles, alphabetically: lead, member, owner, reporter.', (string) $roles->getDescription());
    self::assertStringContainsString('bakers_team_members', (string) $manager->getDefinition('bakers_team_list')->getDescription());
  }

  /**
   * A workspace contributor with an active alpha membership.
   */
  private function member(string $name, ?string $full_name = NULL): UserInterface {
    $account = $this->account($name, ['skill_user']);
    $account->set('field_full_name', $full_name)->save();
    $this->addMembership($this->workspace, $account, ['contributor']);
    $this->addMembership($this->alpha, $account);
    return $account;
  }

}
