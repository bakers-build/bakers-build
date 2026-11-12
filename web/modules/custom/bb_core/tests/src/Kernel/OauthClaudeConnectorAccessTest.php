<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\KernelTests\KernelTestBase;
use Drupal\simple_oauth\Authentication\TokenAuthUserInterface;
use Drupal\simple_oauth\Entity\Oauth2TokenInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * BB-658 review F7/F10: the real workspace `contributor` rank, via a token.
 *
 * Supersedes `McpConnectorScopeEnforcementTest`, which proved a now-reverted
 * dedicated `bb_mcp_connector` scope. There is no dedicated connector
 * scope: an MCP client's consumer authenticates exactly like any other
 * `bb:session` client, with a permission-granularity scope. As
 * `EntityEditAccessTest::delegatedSessionAccount()` documents, such a token's
 * `TokenAuthUser::getRoles()` collapses to `authenticated` only, so the
 * actual access boundary for ticket/comment/project/label operations is the
 * OG workspace rank chain (`BbRankEntityFence`), not a global Drupal role —
 * this test exercises exactly that chain with the shipped `contributor` role,
 * which the BB-658 policy table matches permission-for-permission.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class OauthClaudeConnectorAccessTest extends KernelTestBase {

  use OgScopeFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'serialization',
    'link', 'text', 'filter', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_conductor', 'bb_ticket',
      'bb_run', 'bb_comment', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
    BbVocabulary::create(['id' => 'label', 'label' => 'bakers.build labels'])->save();
    // Uid 1 is a superuser; consume it so the account below is ordinary.
    $this->createAccount('uid1-dummy');
  }

  /**
   * A connector token for a workspace `contributor`: allowed and forbidden.
   *
   * `contributor` carries every permission the BB-658 nine-pair policy
   * needs (confirmed against `config/sync/og.og_role.bb_workspace-
   * bb_workspace-contributor.yml`), granted through OG rank, not a global
   * role — exactly how a real connector user reaches it.
   */
  public function testConnectorTokenReachesMatrixThroughWorkspaceRank(): void {
    $etm = $this->container->get('entity_type.manager');
    $workspace = $this->createEntity('bb_workspace', ['name' => 'mcp-ws']);
    $group = $this->createEntity('bb_group', ['name' => 'mcp-group', 'workspace_id' => $workspace->id()]);
    $project = $this->createEntity('bb_project', ['name' => 'mcp-project', 'group_id' => $group->id()]);

    $account = $this->createAccount('mcp-connector-member');
    $this->addMembership($workspace, $account, ['contributor']);
    $this->seatOnProjectTeam($project, $account);

    $ticket = $this->createEntity('bb_ticket', [
      'identifier' => 'MCP-1',
      'workflow' => 'bb_work',
      'title' => 'MCP-1',
      'project_id' => $project->id(),
    ]);
    $comment = $this->createEntity('bb_comment', [
      'ticket_id' => $ticket->id(),
      'author' => $account->id(),
      'body' => ['value' => 'hi', 'format' => 'plain_text'],
      'type' => 'comment',
    ]);
    $label_term = $this->createEntity('bb_term', ['vid' => 'label', 'name' => 'customer-visible']);

    $token_account = $this->delegatedSessionAccount($account, [
      'view bb_ticket', 'create bb_ticket', 'update any bb_ticket',
      'view bb_comment', 'create bb_comment',
      'view bb_project', 'view bb_term',
      'use text format bb_rich',
    ]);

    // Permitted, through the real rank chain.
    self::assertTrue($ticket->access('view', $token_account), 'ticket read/search allowed');
    self::assertTrue(
      $etm->getAccessControlHandler('bb_ticket')->createAccess(NULL, $token_account),
      'ticket create allowed',
    );
    self::assertTrue($ticket->access('update', $token_account), 'ticket update allowed');
    self::assertTrue($comment->access('view', $token_account), 'comment read/search allowed');
    self::assertTrue(
      $etm->getAccessControlHandler('bb_comment')->createAccess(NULL, $token_account),
      'comment create allowed',
    );
    self::assertTrue($project->access('view', $token_account), 'project read/search allowed');
    self::assertTrue($label_term->access('view', $token_account), 'label term search allowed');

    // Forbidden: `contributor` itself never granted these.
    self::assertFalse($ticket->access('delete', $token_account), 'ticket delete must be forbidden');
    self::assertFalse(
      $etm->getAccessControlHandler('bb_project')->createAccess(NULL, $token_account),
      'project create must be forbidden — contributor only reads projects',
    );
  }

  /**
   * A token whose scope omits a needed permission is denied, even on rank.
   *
   * Mirrors `EntityEditAccessTest::testOwnerTokenNeedsUpdateOwnMachineScope`:
   * the rank fence only narrows, it never substitutes for the token's own
   * scope-granted permissions.
   */
  public function testTokenWithoutPermissionIsDeniedDespiteRank(): void {
    $workspace = $this->createEntity('bb_workspace', ['name' => 'mcp-ws-2']);
    $group = $this->createEntity('bb_group', ['name' => 'mcp-group-2', 'workspace_id' => $workspace->id()]);
    $project = $this->createEntity('bb_project', ['name' => 'mcp-project-2', 'group_id' => $group->id()]);
    $account = $this->createAccount('mcp-connector-member-2');
    $this->addMembership($workspace, $account, ['contributor']);
    $this->seatOnProjectTeam($project, $account);
    $ticket = $this->createEntity('bb_ticket', [
      'identifier' => 'MCP-2',
      'workflow' => 'bb_work',
      'title' => 'MCP-2',
      'project_id' => $project->id(),
    ]);

    $token_account = $this->delegatedSessionAccount($account, []);

    self::assertFalse(
      $ticket->access('view', $token_account),
      'a token without the scoped permission is denied even though the rank would allow it',
    );
  }

  /**
   * Same shape as `EntityEditAccessTest::createEntity()`.
   */
  private function createEntity(string $type, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')->getStorage($type)->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    $entity->save();
    return $entity;
  }

  /**
   * Same shape as `EntityEditAccessTest::createAccount()`.
   */
  private function createAccount(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    self::assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Same shape as `EntityEditAccessTest::delegatedSessionAccount()`.
   */
  private function delegatedSessionAccount(UserInterface $user, array $tokenPermissions): TokenAuthUserInterface {
    $auth_user_id = $this->createMock(FieldItemListInterface::class);
    $auth_user_id->method('isEmpty')->willReturn(FALSE);
    $token = $this->createMock(Oauth2TokenInterface::class);
    $token->method('get')->willReturn($auth_user_id);
    $account = $this->createMock(TokenAuthUserInterface::class);
    $account->method('id')->willReturn((int) $user->id());
    // Real TokenAuthUser::getRoles() intersects token roles with the user's.
    // Permission-granularity scopes leave only authenticated.
    $account->method('getRoles')->willReturn(['authenticated']);
    $account->method('isAuthenticated')->willReturn(TRUE);
    $account->method('isAnonymous')->willReturn(FALSE);
    $account->method('getToken')->willReturn($token);
    $account->method('hasPermission')->willReturnCallback(
      static fn (string $permission): bool => in_array($permission, $tokenPermissions, TRUE),
    );
    return $account;
  }

}
