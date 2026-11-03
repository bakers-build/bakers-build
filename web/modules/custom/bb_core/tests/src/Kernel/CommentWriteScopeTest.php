<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies session-scope create + parent-ticket scope for bb_comment.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class CommentWriteScopeTest extends KernelTestBase {

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
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_team', 'bb_project',
      'bb_conductor', 'bb_ticket', 'bb_run', 'bb_comment',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
  }

  /**
   * A session-scope agent may create a comment on an in-scope ticket only.
   */
  public function testCommentCreateScopedToParentTicket(): void {
    $this->createUser('uid1-dummy');
    $role_storage = $this->container->get('entity_type.manager')->getStorage('user_role');
    $role_storage->create(['id' => 'test_session_writer', 'label' => 'Test session writer'])->save();
    // `view bb_ticket` mirrors the workspace `app` rank, which is where this
    // permission lives now: BB-359 D6 reduced the machine roles to two
    // permissions and BB-391 D2 deleted the roles outright. The role built
    // here is a stand-in for the ACTOR, not for shipped config, so the grant
    // stays explicit. It is load-bearing
    // since BB-305: validating parent_id/ticket_id runs an access-checked
    // query through the selection handler, so an account that cannot view the
    // target reads it as "cannot be referenced" — a different violation from
    // the scope one under test.
    user_role_grant_permissions('test_session_writer', [
      'write bakers via session scope', 'view bb_ticket',
      // BB-318: reference validation is access-checked, and the read scope
      // narrows it to the account's OG memberships. `administer bakers` is NOT
      // the fix here — it would also bypass the write-scope constraint this
      // test exists to assert — so the agent is given a real project
      // membership below instead.
    ]);

    $agent = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => 'scoped-agent', 'status' => 1, 'roles' => ['test_session_writer']]);
    $agent->save();
    $this->container->get('current_user')->setAccount($agent);

    // Both tickets belong to a project the agent is a member of, so the read
    // scope lets it reference them and the only thing that can still reject
    // the foreign one is the write-scope constraint under test.
    $project = $this->createScopedProject($agent);
    $claimed = $this->createTicket('GL-60', $project);
    $foreign = $this->createTicket('GL-61', $project);
    $conductor = $this->createConductor($agent, 'comment-node');
    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $claimed->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'running',
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() + 600,
    ])->save();

    // Create access is granted by the session-scope permission alone.
    $access = $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_comment')->createAccess(NULL, $agent);
    $this->assertTrue($access);

    $storage = $this->container->get('entity_type.manager')->getStorage('bb_comment');
    $in_scope = $storage->create([
      'ticket_id' => $claimed->id(),
      'author' => $agent->id(),
      'body' => ['value' => 'in scope', 'format' => 'plain_text'],
      'type' => 'comment',
    ]);
    $this->assertInstanceOf(BbCommentInterface::class, $in_scope);
    $this->assertCount(0, $in_scope->validate()->getByField('ticket_id'));

    $out_of_scope = $storage->create([
      'ticket_id' => $foreign->id(),
      'author' => $agent->id(),
      'body' => ['value' => 'foreign', 'format' => 'plain_text'],
      'type' => 'comment',
    ]);
    $this->assertInstanceOf(BbCommentInterface::class, $out_of_scope);
    $this->assertGreaterThan(0, count($out_of_scope->validate()->getByField('ticket_id')));
  }

  /**
   * Creates a project the given account is an active member of.
   *
   * @param \Drupal\user\UserInterface $account
   *   The account to make a member.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved project.
   */
  private function createScopedProject(UserInterface $account): ContentEntityInterface {
    // BB-462 D4/D7: project visibility now follows team membership, not
    // direct project OG membership, which no longer exists once BB-462
    // Phase 3 deregisters bb_project as an OG group.
    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')->create(['name' => 'scope-team']);
    $this->assertInstanceOf(ContentEntityInterface::class, $team);
    $team->save();
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')->create([
        'name' => 'scope-project',
        'teams' => [$team->id()],
      ]);
    $this->assertInstanceOf(ContentEntityInterface::class, $project);
    $project->save();
    $this->addMembership($team, $account, []);
    return $project;
  }

  /**
   * Creates and saves a BbTicket entity with the given identifier.
   *
   * @param string $identifier
   *   The ticket identifier, also used as its title.
   * @param \Drupal\Core\Entity\ContentEntityInterface $project
   *   The project the ticket belongs to.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   The saved ticket.
   */
  private function createTicket(string $identifier, ContentEntityInterface $project): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'identifier' => $identifier,
        'workflow' => 'bb_work',
        'title' => $identifier,
        'project_id' => $project->id(),
      ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Creates a plain Drupal user.
   */
  private function createUser(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates and saves a conductor owned by the given account.
   */
  private function createConductor(UserInterface $owner, string $machine_id): BbConductorInterface {
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'label' => $machine_id,
      'owner_user_id' => $owner->id(),
      'status' => 'online',
    ]);
    $this->assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    return $conductor;
  }

}
