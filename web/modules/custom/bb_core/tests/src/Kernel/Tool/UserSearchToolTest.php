<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Finds visible users by part of their full name or username.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class UserSearchToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;
  use FullNameFieldTrait;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_profile');
    $this->installFullNameField();

    $team = $this->project->get('teams')->entity;
    assert($team instanceof ContentEntityInterface);
    $team->set('workspace_id', $this->workspace->id())->save();
    $this->member('christian.w', 'Christian Wiedemann');
    $this->member('chris.b', 'Christian Bauer');
    $this->member('anna', NULL);
    $this->member('christian.x', 'Christian Blocked')->block()->save();
    $this->container->get('bb_core.workspace_read_scope')->reset();
  }

  /**
   * Last name, and first plus last name in any case, find the one user.
   */
  public function testMatchesPartsOfTheFullNameInAnyCase(): void {
    foreach (['wiedemann', 'CHRISTIAN WIEDEMANN', ' Christian Wiedemann '] as $query) {
      self::assertSame(['christian.w'], $this->names($query), $query);
    }
  }

  /**
   * A shared first name lists every visible match with its rows.
   */
  public function testAmbiguousNameListsEveryVisibleMatch(): void {
    $stranger = $this->stranger();
    $this->container->get('current_user')->setAccount($this->actor);

    $out = $this->outputs($this->runTool('bakers_user_search', ['query' => 'Christian']));
    self::assertSame(['chris.b', 'christian.w'], array_column($out['users'], 'name'));
    self::assertNull($out['next_offset']);
    $row = $out['users'][1];
    self::assertSame(['uuid', 'name', 'full_name', 'mail', 'teams'], array_keys($row));
    self::assertSame('Christian Wiedemann', $row['full_name']);
    self::assertNull($row['mail'], 'mail stays hidden without mail view access');
    $read = $this->outputs($this->runTool('bakers_user_read', ['user' => 'christian.w']));
    self::assertSame($read['uuid'], $row['uuid']);
    self::assertSame($read['teams'], $row['teams']);
    self::assertNotContains($stranger->uuid(), array_column($out['users'], 'uuid'));
  }

  /**
   * A user without a full name is still found by username.
   */
  public function testMatchesUsernameWithoutFullName(): void {
    $out = $this->outputs($this->runTool('bakers_user_search', ['query' => 'anna']));
    self::assertSame(['anna'], array_column($out['users'], 'name'));
    self::assertNull($out['users'][0]['full_name']);
  }

  /**
   * No match, also for a LIKE wildcard, is an empty list, not an error.
   */
  public function testNoMatchIsAnEmptyList(): void {
    foreach (['nobody', '_', '%'] as $query) {
      self::assertSame(['users' => [], 'next_offset' => NULL], $this->outputs($this->runTool('bakers_user_search', ['query' => $query])), $query);
    }
  }

  /**
   * Pages count visible matches only, so no page ends early.
   */
  public function testPagesAcrossVisibleMatches(): void {
    $first = $this->outputs($this->runTool('bakers_user_search', ['query' => 'christian', 'limit' => 1]));
    self::assertSame(['chris.b'], array_column($first['users'], 'name'));
    self::assertSame(1, $first['next_offset']);
    $second = $this->outputs($this->runTool('bakers_user_search', ['query' => 'christian', 'limit' => 1, 'offset' => 1]));
    self::assertSame(['christian.w'], array_column($second['users'], 'name'));
    self::assertNull($second['next_offset']);
  }

  /**
   * A caller in another workspace finds only the people it shares one with.
   */
  public function testStrangerSeesOnlyOwnWorkspace(): void {
    $this->stranger();
    $out = $this->outputs($this->runTool('bakers_user_search', ['query' => 'christian']));
    self::assertSame(['stranger'], array_column($out['users'], 'name'));
    self::assertSame([], $this->outputs($this->runTool('bakers_user_search', ['query' => 'wiedemann']))['users']);
  }

  /**
   * The inputs are an allowlist, the query is required and the hint is given.
   */
  public function testInputs(): void {
    $manager = $this->container->get('plugin.manager.tool');
    $definition = $manager->getDefinition('bakers_user_search');
    self::assertSame(['query', 'limit', 'offset'], array_keys($definition->getInputDefinitions()));
    self::assertStringContainsString('before assigning, mentioning or adding reviewers', (string) $definition->getDescription());
    self::assertStringContainsString('bakers_user_search', (string) $manager->getDefinition('bakers_user_read')->getDescription());
    self::assertFalse($this->runTool('bakers_user_search', ['query' => ''])->isSuccess());
  }

  /**
   * The usernames the actor's search returns, in order.
   *
   * @return array<string>
   *   Usernames.
   */
  private function names(string $query): array {
    return array_column($this->outputs($this->runTool('bakers_user_search', ['query' => $query]))['users'], 'name');
  }

  /**
   * A contributor of the actor's workspace on its team.
   */
  private function member(string $name, ?string $full_name): UserInterface {
    $account = $this->account($name, ['skill_user']);
    $account->set('field_full_name', $full_name)->save();
    $this->addMembership($this->workspace, $account, ['contributor']);
    return $account;
  }

  /**
   * A stranger "Christian Fremd" in a foreign workspace, now the current user.
   */
  private function stranger(): UserInterface {
    [, $stranger] = $this->foreignWorkspace();
    $stranger->set('field_full_name', 'Christian Fremd')->save();
    return $stranger;
  }

}
