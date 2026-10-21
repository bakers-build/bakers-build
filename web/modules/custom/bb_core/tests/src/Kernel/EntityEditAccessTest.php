<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\consumers\Entity\Consumer;
use Drupal\Core\Config\FileStorage;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Onboarding\OnboardingDestination;
use Drupal\KernelTests\KernelTestBase;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\simple_oauth\Authentication\TokenAuthUser;
use Drupal\simple_oauth\Authentication\TokenAuthUserInterface;
use Drupal\simple_oauth\Entity\Oauth2Scope;
use Drupal\simple_oauth\Entity\Oauth2TokenInterface;
use Drupal\simple_oauth\Oauth2ScopeInterface;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\Entity\User;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Ordinary editors of the five types, and nobody else.
 *
 * Entity access is the shared decision for existing forms and JSON:API
 * PATCH. This class pins the editing matrix: workspace/group/project leads
 * and team leads, machine owners, conductor owners, plus the denials for
 * peers, foreign leads and rankless accounts. Saved-row field policy is the
 * same decision for widgets and PATCH. Create and delete grants are left
 * unchanged.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EntityEditAccessTest extends KernelTestBase {

  use UserCreationTrait;
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
      'user', 'og_membership',
      'bb_workspace', 'bb_group', 'bb_team', 'bb_project',
      'bb_machine', 'bb_conductor',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
    // Uid 1 is a superuser; consume it so every actor below is ordinary.
    $this->createUser();
  }

  /**
   * A machine owner with a workspace rank may update; a peer may not.
   */
  public function testMachineOwnerCanUpdatePeerCannot(): void {
    $home = $this->createWorkspaceChain('home');
    $foreign = $this->createWorkspaceChain('foreign');
    $owner = $this->createAccount('machine-owner');
    $peer = $this->createAccount('workspace-peer');
    $lead = $this->createAccount('ordinary-lead');
    $foreignLead = $this->createAccount('foreign-lead');
    $this->addMembership($home['workspace'], $owner, ['contributor']);
    $this->addMembership($home['workspace'], $peer, ['contributor']);
    $this->addMembership($home['workspace'], $lead, ['lead']);
    $this->addMembership($foreign['workspace'], $foreignLead, ['lead']);
    $machine = $this->createMachine($home['workspace'], (int) $owner->id());

    self::assertTrue($machine->access('update', $owner), 'the owner must update their own machine');
    self::assertFalse($machine->access('update', $peer), 'a peer must not update a machine they do not own');
    self::assertFalse($machine->access('update', $lead), 'an ordinary non-owning lead must not update another user\'s machine');
    self::assertFalse($machine->access('update', $foreignLead), 'a foreign lead must not update a machine in another workspace');
    self::assertFalse($machine->access('delete', $owner), 'create/delete grants on machines stay unchanged');
  }

  /**
   * Owner update requires `update own bb_machine`, including on a token.
   *
   * A user-bound session without that scope must 403 even when the account
   * owns the row. The same account with the scope may update.
   */
  public function testOwnerTokenNeedsUpdateOwnMachineScope(): void {
    $home = $this->createWorkspaceChain('token-machine');
    $owner = $this->createAccount('token-box-owner');
    $this->addMembership($home['workspace'], $owner, ['contributor']);
    $machine = $this->createMachine($home['workspace'], (int) $owner->id());

    $bare = $this->createAccount('bare-box-owner');
    $bareMachine = $this->createMachine($home['workspace'], (int) $bare->id());
    self::assertTrue($bareMachine->access('view', $bare), 'the owner may view without a rank');
    self::assertFalse($bareMachine->access('update', $bare), 'the owner may not update without the permission');

    $handler = $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_machine');
    $without = $this->delegatedSessionAccount($owner, []);
    self::assertFalse(
      $machine->access('update', $without),
      'an owner token without update own bb_machine must not PATCH',
    );
    $handler->resetCache();
    $with = $this->delegatedSessionAccount($owner, ['update own bb_machine']);
    self::assertTrue(
      $machine->access('update', $with),
      'an owner token with update own bb_machine may PATCH',
    );
  }

  /**
   * Workspace owner keeps workspace update; admin keeps machine update.
   *
   * No rank gains `update any bb_machine`. A workspace owner is not an
   * ordinary lead of someone else's host.
   */
  public function testWorkspaceOwnerAndAdminKeepMachineAuthority(): void {
    $workspaceOwner = $this->createAccount('workspace-owner');
    $workspace = $this->createEntity('bb_workspace', [
      'name' => 'owned-ws',
      'slug' => 'owned-ws',
      'owner_user_id' => $workspaceOwner->id(),
    ]);
    $owner = $this->createAccount('box-owner');
    $this->addMembership($workspace, $owner, ['contributor']);
    $machine = $this->createMachine($workspace, (int) $owner->id());
    $admin = $this->createAccount('instance-admin');
    $this->grantSiteWide($admin, ['administer bakers']);

    self::assertTrue($workspace->access('update', $workspaceOwner), 'the workspace owner keeps workspace update');
    self::assertFalse($machine->access('update', $workspaceOwner), 'the workspace owner does not update a machine they do not own');
    self::assertTrue($machine->access('update', $admin), 'instance admin keeps host authority');
  }

  /**
   * Workspace lead edits the workspace, its groups and its projects.
   */
  public function testWorkspaceLeadEditsWorkspaceGroupAndProject(): void {
    $home = $this->createWorkspaceChain('lead-home');
    $foreign = $this->createWorkspaceChain('lead-foreign');
    $lead = $this->createAccount('ws-lead');
    $this->addMembership($home['workspace'], $lead, ['lead']);

    self::assertTrue($home['workspace']->access('update', $lead));
    self::assertTrue($home['group']->access('update', $lead));
    self::assertTrue($home['project']->access('update', $lead));
    self::assertFalse($foreign['workspace']->access('update', $lead));
    self::assertFalse($foreign['group']->access('update', $lead));
    self::assertFalse($foreign['project']->access('update', $lead));
    self::assertFalse($home['workspace']->access('delete', $lead), 'workspace delete stays off the rank');
  }

  /**
   * A referenced team's lead or owner may edit the project.
   */
  public function testReferencedTeamLeadAndOwnerEditProject(): void {
    $home = $this->createWorkspaceChain('team-home');
    $secondTeam = $this->createEntity('bb_team', [
      'name' => 'second-team',
      'workspace_id' => $home['workspace']->id(),
    ]);
    $unrelatedTeam = $this->createEntity('bb_team', [
      'name' => 'unrelated-team',
      'workspace_id' => $home['workspace']->id(),
    ]);
    $project = $this->createEntity('bb_project', [
      'name' => 'multi-team-project',
      'group_id' => $home['group']->id(),
      'teams' => [$home['team']->id(), $secondTeam->id()],
    ]);
    self::assertInstanceOf(BbProjectInterface::class, $project);

    $secondLead = $this->createAccount('second-team-lead');
    $this->addMembership($home['workspace'], $secondLead, ['contributor']);
    $this->addMembership($secondTeam, $secondLead, ['lead']);

    $unrelatedLead = $this->createAccount('unrelated-team-lead');
    $this->addMembership($home['workspace'], $unrelatedLead, ['contributor']);
    $this->addMembership($unrelatedTeam, $unrelatedLead, ['lead']);

    $teamOwner = $this->createAccount('second-team-owner');
    $secondTeam->set('owner_user_id', $teamOwner->id())->save();
    $this->addMembership($home['workspace'], $teamOwner, ['contributor']);
    $this->addMembership($secondTeam, $teamOwner, ['owner']);

    self::assertTrue($project->access('update', $secondLead), 'lead of a referenced team must edit the project');
    self::assertTrue($project->access('update', $teamOwner), 'owner of a referenced team must edit the project');
    self::assertFalse($project->access('update', $unrelatedLead), 'lead of an unreferenced team must not edit the project');
    self::assertTrue($project->access('delete', $secondLead), 'team-lead delete of a referenced project stays granted');
    self::assertFalse($home['project']->access('update', $secondLead), 'a team lead does not edit an unreferenced project');
  }

  /**
   * Conductor owners keep update; peers and foreign leads do not.
   */
  public function testConductorOwnerMayUpdate(): void {
    $home = $this->createWorkspaceChain('cnd-home');
    $foreign = $this->createWorkspaceChain('cnd-foreign');
    $owner = $this->createAccount('conductor-owner');
    $peer = $this->createAccount('conductor-peer');
    $foreignLead = $this->createAccount('conductor-foreign-lead');
    $this->addMembership($home['workspace'], $owner, ['contributor']);
    $this->addMembership($home['workspace'], $peer, ['contributor']);
    $this->addMembership($foreign['workspace'], $foreignLead, ['lead']);
    $conductor = $this->createConductor($home['project'], (int) $owner->id());

    self::assertTrue($conductor->access('update', $owner), 'the owner must update their conductor');
    self::assertFalse($conductor->access('update', $peer), 'a peer must not update a conductor they do not own');
    self::assertFalse($conductor->access('update', $foreignLead), 'a foreign lead must not update a conductor in another workspace');
    self::assertFalse($conductor->access('delete', $owner), 'conductor delete stays off the rank');
  }

  /**
   * Rankless and foreign accounts cannot update any of the five types.
   */
  public function testRanklessAndForeignAccountsAreDenied(): void {
    $home = $this->createWorkspaceChain('deny-home');
    $owner = $this->createAccount('deny-owner');
    $this->addMembership($home['workspace'], $owner, ['contributor']);
    $machine = $this->createMachine($home['workspace'], (int) $owner->id());
    $conductor = $this->createConductor($home['project'], (int) $owner->id());
    $stranger = $this->createAccount('rankless');

    foreach ([$home['workspace'], $home['group'], $home['project'], $machine, $conductor] as $entity) {
      self::assertFalse(
        $entity->access('update', $stranger),
        $entity->getEntityTypeId() . ' must deny a rankless account',
      );
    }
  }

  /**
   * Saved rows expose only the spec's editable fields to a non-admin editor.
   */
  public function testSavedRowAllowlistMatchesTheEditingMatrix(): void {
    $home = $this->createWorkspaceChain('fields');
    $lead = $this->createAccount('field-lead');
    $this->addMembership($home['workspace'], $lead, ['lead']);
    $owner = $this->createAccount('field-owner');
    $this->addMembership($home['workspace'], $owner, ['contributor']);
    $machine = $this->createMachine($home['workspace'], (int) $owner->id());
    $conductor = $this->createConductor($home['project'], (int) $owner->id());

    $cases = [
      [
        $home['workspace'],
        $lead,
        ['name', 'description', 'image', 'billing_profile'],
        ['slug', 'owner_user_id', 'created', 'changed'],
      ],
      [
        $home['group'],
        $lead,
        ['name', 'description', 'image', 'billing_profile'],
        ['workspace_id', 'owner_user_id'],
      ],
      [
        $home['project'],
        $lead,
        ['name', 'description', 'image', 'key', 'repository', 'env_vars', 'coder_config', 'teams'],
        ['group_id', 'next_number', 'environments', 'owner_user_id'],
      ],
      [
        $machine,
        $owner,
        ['name', 'max_parallel'],
        ['current_load', 'host_key', 'owner_user_id'],
      ],
      [
        $conductor,
        $owner,
        ['label', 'active', 'states'],
        [
          'conductor_id', 'owner_user_id', 'project_id', 'machine', 'status',
          'reported_load', 'last_seen', 'lease_expires_at', 'workspace_root',
          'last_pid', 'conductor_name',
        ],
      ],
    ];
    foreach ($cases as [$entity, $actor, $allowed, $denied]) {
      $type = $entity->getEntityTypeId();
      foreach ($allowed as $field) {
        self::assertTrue(
          $entity->get($field)->access('edit', $actor),
          "$type.$field must stay editable for the ordinary editor",
        );
      }
      foreach ($denied as $field) {
        self::assertFalse(
          $entity->get($field)->access('edit', $actor),
          "$type.$field must be protected on a saved row",
        );
      }
    }

    self::assertFalse($machine->get('current_load')->access('edit', $owner));
    self::assertTrue($machine->get('max_parallel')->access('edit', $owner));
    self::assertFalse($home['project']->get('next_number')->access('edit', $lead));
  }

  /**
   * View, null items, unsaved rows and other types stay outside the allowlist.
   */
  public function testAllowlistDoesNotApplyOutsideSavedRowEdits(): void {
    $home = $this->createWorkspaceChain('unsaved');
    $lead = $this->createAccount('unsaved-lead');
    $this->addMembership($home['workspace'], $lead, ['lead']);
    $owner = $this->createAccount('unsaved-owner');
    $this->addMembership($home['workspace'], $owner, ['contributor']);
    $machine = $this->createMachine($home['workspace'], (int) $owner->id());
    $teamOwner = $this->createAccount('unsaved-team-owner');
    $this->addMembership($home['workspace'], $teamOwner, ['contributor']);
    $this->addMembership($home['team'], $teamOwner, ['owner']);

    self::assertTrue($machine->get('current_load')->access('view', $owner), 'reads stay open');

    $definition = $machine->getFieldDefinition('current_load');
    self::assertNotNull($definition);
    $without_items = $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_machine')
      ->fieldAccess('edit', $definition, $owner, NULL);
    self::assertTrue($without_items, 'null items is definition access, not a saved-row write');

    $unsaved_group = $this->container->get('entity_type.manager')
      ->getStorage('bb_group')
      ->create([
        'name' => 'new-group',
        'workspace_id' => $home['workspace']->id(),
      ]);
    self::assertInstanceOf(ContentEntityInterface::class, $unsaved_group);
    self::assertTrue(
      $unsaved_group->get('workspace_id')->access('edit', $lead),
      'an unsaved group still accepts its workspace anchor',
    );

    $unsaved_project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create([
        'name' => 'new-project',
        'group_id' => $home['group']->id(),
        'teams' => [$home['team']->id()],
      ]);
    self::assertInstanceOf(ContentEntityInterface::class, $unsaved_project);
    self::assertTrue(
      $unsaved_project->get('group_id')->access('edit', $lead),
      'an unsaved project still accepts its group anchor',
    );

    $unsaved_conductor = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')
      ->create([
        'conductor_id' => 'cnd-new',
        'label' => 'new conductor',
        'owner_user_id' => $owner->id(),
        'project_id' => $home['project']->id(),
        'states' => ['coding'],
      ]);
    self::assertInstanceOf(ContentEntityInterface::class, $unsaved_conductor);
    self::assertTrue(
      $unsaved_conductor->get('project_id')->access('edit', $owner),
      'an unsaved conductor still accepts its project anchor',
    );

    self::assertTrue(
      $home['team']->get('name')->access('edit', $teamOwner),
      'a type outside the five is not pulled into the allowlist',
    );
  }

  /**
   * Instance admin bypasses the allowlist; an OG owner does not.
   */
  public function testAdminBypassesAllowlistAndOgOwnerDoesNot(): void {
    $workspaceOwner = $this->createAccount('slug-owner');
    $workspace = $this->createEntity('bb_workspace', [
      'name' => 'slug-ws',
      'slug' => 'slug-ws',
      'owner_user_id' => $workspaceOwner->id(),
    ]);
    $owner = $this->createAccount('slug-box');
    $this->addMembership($workspace, $owner, ['contributor']);
    $machine = $this->createMachine($workspace, (int) $owner->id());
    $admin = $this->createAccount('slug-admin');
    $this->grantSiteWide($admin, ['administer bakers']);

    self::assertTrue($workspace->get('name')->access('edit', $workspaceOwner));
    self::assertFalse(
      $workspace->get('slug')->access('edit', $workspaceOwner),
      'an OG workspace owner is not an instance admin',
    );
    self::assertTrue($machine->get('current_load')->access('edit', $admin));
  }

  /**
   * An admin's bb:session token cannot write protected fields.
   *
   * TokenAuthUser::getRoles() is the intersection of token roles and user
   * roles. Every bb_session_* child has permission granularity, so that
   * intersection is only authenticated and hasSiteWidePermission() is
   * FALSE. This double is not uid 1; the real TokenAuthUser uid-1 case is
   * testUid1SessionTokenDoesNotBypassAllowlist().
   */
  public function testAdminSessionTokenDoesNotBypassAllowlist(): void {
    $workspaceOwner = $this->createAccount('token-slug-owner');
    $workspace = $this->createEntity('bb_workspace', [
      'name' => 'token-slug-ws',
      'slug' => 'token-slug-ws',
      'owner_user_id' => $workspaceOwner->id(),
    ]);
    $admin = $this->createAccount('token-admin');
    $this->grantSiteWide($admin, ['administer bakers']);
    $sessionAdmin = $this->delegatedSessionAccount($admin, [
      'update any bb_workspace',
    ]);

    self::assertTrue(
      $workspace->get('slug')->access('edit', $admin),
      'a cookie-session instance admin still bypasses the allowlist',
    );
    self::assertFalse(
      $workspace->get('slug')->access('edit', $sessionAdmin),
      'an admin bb:session token without administer bakers must not write slug',
    );
  }

  /**
   * Uid 1 keeps instance-admin field rights when super user is enabled.
   *
   * The site-wide role check reads roles only, so uid 1 with no admin role
   * would otherwise be held to the saved-row allowlist. That would hide
   * protected widgets on the Administrator persona's forms.
   */
  public function testUid1CanEditProtectedFieldsWhenSuperUserEnabled(): void {
    self::assertTrue(
      $this->container->getParameter('security.enable_super_user'),
      'this case requires Drupal super-user policy on',
    );
    $super = User::load(1);
    self::assertInstanceOf(UserInterface::class, $super);
    self::assertSame('1', (string) $super->id());
    $workspace = $this->createEntity('bb_workspace', [
      'name' => 'uid1-ws',
      'slug' => 'uid1-ws',
    ]);

    self::assertTrue(
      $workspace->get('slug')->access('edit', $super),
      'uid 1 must edit workspace slug when enable_super_user is on',
    );
  }

  /**
   * A uid-1 bb:session token cannot write protected fields.
   *
   * Builds a real TokenAuthUser: oauth2_token with auth_user_id = 1, a
   * permission-granularity session scope, permission_checker from the
   * container. SuperUserAccessPolicy marks uid 1 isAdmin; Oauth2AccessPolicy
   * keeps that flag, so hasPermission('administer bakers') is TRUE. The
   * allowlist must still forbid slug: isInstanceAdmin() reads narrowed roles.
   */
  public function testUid1SessionTokenDoesNotBypassAllowlist(): void {
    self::assertTrue(
      $this->container->getParameter('security.enable_super_user'),
      'this case requires Drupal super-user policy on',
    );
    $tokenUser = $this->uid1SessionTokenAccount();
    self::assertSame('1', (string) $tokenUser->id());
    self::assertTrue(
      $tokenUser->hasPermission('administer bakers'),
      'the real TokenAuthUser still reports administer bakers via isAdmin',
    );
    $workspace = $this->createEntity('bb_workspace', [
      'name' => 'uid1-token-ws',
      'slug' => 'uid1-token-ws',
    ]);

    self::assertFalse(
      $workspace->get('slug')->access('edit', $tokenUser),
      'a uid-1 bb:session token must not write workspace slug',
    );
  }

  /**
   * JSON:API field access uses current_user, which is an AccountProxy.
   *
   * EntityAccessControlHandler::prepareUser() replaces a NULL account with
   * \Drupal::currentUser(). That proxy wraps the TokenAuthUser and does not
   * implement TokenAuthUserInterface, so isInstanceAdmin() must unwrap it.
   */
  public function testUid1SessionTokenOnCurrentUserDoesNotBypassAllowlist(): void {
    self::assertTrue(
      $this->container->getParameter('security.enable_super_user'),
      'this case requires Drupal super-user policy on',
    );
    $tokenUser = $this->uid1SessionTokenAccount();
    $this->container->get('current_user')->setAccount($tokenUser);
    $current = $this->container->get('current_user');
    self::assertInstanceOf(AccountProxyInterface::class, $current);
    self::assertFalse($current instanceof TokenAuthUserInterface);
    $workspace = $this->createEntity('bb_workspace', [
      'name' => 'uid1-proxy-ws',
      'slug' => 'uid1-proxy-ws',
    ]);

    self::assertFalse(
      $workspace->get('slug')->access('edit'),
      'a uid-1 bb:session token on current_user must not write workspace slug',
    );
  }

  /**
   * A client_credentials session token cannot update a foreign workspace.
   *
   * The CLI and e2e mint bb:session with grant_type client_credentials, so
   * auth_user_id is empty and TokenAuthUser takes the consumer's user.
   * JSON:API then passes current_user (an AccountProxy). Unwrapping that
   * proxy in machineScopeAnswer() treats the token as a pure machine
   * identity and answers the session children site-wide. The consumer user
   * has no rank here, so the rank fence must deny.
   */
  public function testClientCredentialsSessionTokenOnCurrentUserCannotUpdateForeignRows(): void {
    $home = $this->createWorkspaceChain('cc-foreign');
    $stranger = $this->createAccount('cc-stranger');
    $tokenUser = $this->clientCredentialsSessionTokenAccount($stranger, [
      'update any bb_workspace',
      'update any bb_group',
    ]);
    self::assertTrue(
      $tokenUser->getToken()->get('auth_user_id')->isEmpty(),
      'a client_credentials token has no auth_user_id',
    );
    self::assertSame((string) $stranger->id(), (string) $tokenUser->id());
    $this->container->get('current_user')->setAccount($tokenUser);
    $current = $this->container->get('current_user');
    self::assertInstanceOf(AccountProxyInterface::class, $current);
    self::assertFalse($current instanceof TokenAuthUserInterface);

    self::assertFalse(
      $home['workspace']->access('update'),
      'a client_credentials bb:session token must not update a foreign workspace',
    );
    self::assertFalse(
      $home['group']->access('update'),
      'a client_credentials bb:session token must not update a foreign group',
    );
  }

  /**
   * Revoking membership denies a field the allowlist would otherwise expose.
   */
  public function testMembershipRevocationDeniesAllowedFields(): void {
    $home = $this->createWorkspaceChain('revoke');
    $owner = $this->createAccount('revoke-owner');
    $membership = $this->addMembership($home['workspace'], $owner, ['contributor']);
    $machine = $this->createMachine($home['workspace'], (int) $owner->id());
    $membership->delete();
    $this->container->get('cache.static')->deleteAll();
    $this->container->get('entity.memory_cache')->deleteAll();
    self::assertNull(
      Og::getMembership($home['workspace'], $owner, OgMembershipInterface::ALL_STATES),
      'the workspace membership is gone',
    );
    self::assertFalse(
      $machine->access('update', $owner),
      'a revoked membership cannot update the row',
    );
  }

  /**
   * The onboarding completion flag stays forbidden after the allowlist joins.
   */
  public function testOnboardingCompletionStaysForbidden(): void {
    $this->installCompletionField();
    $account = $this->createAccount('onboarding-editor');
    self::assertFalse(
      $account->get(OnboardingDestination::COMPLETION_FIELD)->access('edit', $account),
    );
  }

  /**
   * Creates two workspace/group/team/project chains without promoting actors.
   *
   * @return array<string, \Drupal\Core\Entity\ContentEntityInterface>
   *   The saved chain. The dummy uid-1 user remains the entity owner so
   *   ordinary actors do not inherit group-manager rights.
   */
  private function createWorkspaceChain(string $prefix): array {
    $workspace = $this->createEntity('bb_workspace', [
      'name' => $prefix . '-ws',
      'slug' => $prefix . '-ws',
    ]);
    $group = $this->createEntity('bb_group', [
      'name' => $prefix . '-group',
      'workspace_id' => $workspace->id(),
    ]);
    $team = $this->createEntity('bb_team', [
      'name' => $prefix . '-team',
      'workspace_id' => $workspace->id(),
    ]);
    $project = $this->createEntity('bb_project', [
      'name' => $prefix . '-project',
      'group_id' => $group->id(),
      'teams' => [$team->id()],
    ]);
    return [
      'workspace' => $workspace,
      'group' => $group,
      'team' => $team,
      'project' => $project,
    ];
  }

  /**
   * Creates and saves a content entity of the given type.
   *
   * @param string $type
   *   Entity type id.
   * @param array<string, mixed> $values
   *   Field values.
   */
  private function createEntity(string $type, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')
      ->getStorage($type)
      ->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    $entity->save();
    return $entity;
  }

  /**
   * Creates a saved machine owned by $owner_id in $workspace.
   */
  private function createMachine(ContentEntityInterface $workspace, int $owner_id): BbMachineInterface {
    $machine = $this->container->get('entity_type.manager')
      ->getStorage('bb_machine')
      ->create([
        'name' => 'owner box',
        'host_key' => 'owner-box-' . $workspace->id() . '-' . $owner_id,
        'max_parallel' => 5,
        'owner_user_id' => $owner_id,
      ]);
    self::assertInstanceOf(BbMachineInterface::class, $machine);
    $machine->save();
    return $machine;
  }

  /**
   * Creates a saved conductor owned by $owner_id on $project.
   */
  private function createConductor(ContentEntityInterface $project, int $owner_id): BbConductorInterface {
    $conductor = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')
      ->create([
        'conductor_id' => 'cnd-' . $project->id() . '-' . $owner_id,
        'label' => 'owner conductor',
        'owner_user_id' => $owner_id,
        'status' => 'online',
        'project_id' => $project->id(),
        'states' => ['coding'],
      ]);
    self::assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    return $conductor;
  }

  /**
   * Creates an ordinary account that is not the current user.
   */
  private function createAccount(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    self::assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Installs the shipped onboarding completion field on user.
   */
  private function installCompletionField(): void {
    $this->container->get('config.typed')->clearCachedDefinitions();
    $storage = new FileStorage(dirname($this->root) . '/config/sync');
    $storageData = $storage->read('field.storage.user.field_onboarding_completed');
    self::assertIsArray($storageData);
    FieldStorageConfig::create($storageData)->save();
    $fieldData = $storage->read('field.field.user.user.field_onboarding_completed');
    self::assertIsArray($fieldData);
    FieldConfig::create($fieldData)->save();
  }

  /**
   * Grants site-wide permissions through a dedicated role.
   *
   * @param \Drupal\user\UserInterface $account
   *   The user receiving the role.
   * @param array<string> $permissions
   *   Permission names.
   */
  private function grantSiteWide(UserInterface $account, array $permissions): void {
    $role_id = 'edit_access_' . $account->id();
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    user_role_grant_permissions($role_id, $permissions);
    $account->addRole($role_id);
    $account->save();
  }

  /**
   * A real TokenAuthUser for uid 1 with a permission-granularity session scope.
   *
   * @return \Drupal\simple_oauth\Authentication\TokenAuthUserInterface
   *   The decorated uid-1 session account.
   */
  private function uid1SessionTokenAccount(): TokenAuthUserInterface {
    $this->enableModules(['serialization', 'path_alias', 'consumers', 'simple_oauth']);
    $this->installEntitySchema('consumer');
    $this->installEntitySchema('oauth2_token');
    $this->installConfig(['consumers', 'simple_oauth']);

    $scope = Oauth2Scope::create([
      'id' => 'bb_session',
      'name' => 'bb:session',
      'description' => 'Session',
      'grant_types' => [
        'authorization_code' => [
          'status' => TRUE,
          'description' => 'Session',
        ],
      ],
      'umbrella' => FALSE,
      'granularity_id' => Oauth2ScopeInterface::GRANULARITY_PERMISSION,
      'granularity_configuration' => [
        'permission' => 'update any bb_workspace',
      ],
    ]);
    $scope->save();

    $consumer = Consumer::create([
      'client_id' => 'uid1-session',
      'label' => 'uid1 session',
      'confidential' => FALSE,
      'grant_types' => ['authorization_code'],
      'scopes' => [$scope->id()],
    ]);
    $consumer->save();

    $super = User::load(1);
    self::assertInstanceOf(UserInterface::class, $super);
    $token = $this->container->get('entity_type.manager')
      ->getStorage('oauth2_token')
      ->create([
        'bundle' => 'access_token',
        'auth_user_id' => $super->id(),
        'client' => $consumer->id(),
        'scopes' => [$scope->id()],
        'value' => 'uid1-session-token',
        'expire' => time() + 3600,
        'status' => TRUE,
      ]);
    $token->save();
    self::assertInstanceOf(Oauth2TokenInterface::class, $token);

    return new TokenAuthUser(
      $this->container->get('permission_checker'),
      $token,
      $this->container->get('psr7.http_message_factory'),
      $this->container->get('request_stack'),
    );
  }

  /**
   * A real client_credentials TokenAuthUser bound to $consumerUser.
   *
   * @param \Drupal\user\UserInterface $consumerUser
   *   The consumer owner, used as the token subject when auth_user_id is empty.
   * @param array<string> $permissions
   *   Permission-granularity session children attached to the token.
   *
   * @return \Drupal\simple_oauth\Authentication\TokenAuthUserInterface
   *   The decorated client_credentials session account.
   */
  private function clientCredentialsSessionTokenAccount(UserInterface $consumerUser, array $permissions): TokenAuthUserInterface {
    $this->enableModules(['serialization', 'path_alias', 'consumers', 'simple_oauth']);
    $this->installEntitySchema('consumer');
    $this->installEntitySchema('oauth2_token');
    $this->installConfig(['consumers', 'simple_oauth']);

    $scope_ids = [];
    foreach (array_values($permissions) as $i => $permission) {
      $scope = Oauth2Scope::create([
        'id' => 'cc_session_' . $i,
        'name' => 'cc:session:' . $i,
        'description' => $permission,
        'grant_types' => [
          'client_credentials' => [
            'status' => TRUE,
            'description' => $permission,
          ],
        ],
        'umbrella' => FALSE,
        'granularity_id' => Oauth2ScopeInterface::GRANULARITY_PERMISSION,
        'granularity_configuration' => [
          'permission' => $permission,
        ],
      ]);
      $scope->save();
      $scope_ids[] = $scope->id();
    }

    $consumer = Consumer::create([
      'client_id' => 'cc-session',
      'label' => 'cc session',
      'confidential' => FALSE,
      'grant_types' => ['client_credentials'],
      'scopes' => $scope_ids,
      'user_id' => $consumerUser->id(),
    ]);
    $consumer->save();

    $token = $this->container->get('entity_type.manager')
      ->getStorage('oauth2_token')
      ->create([
        'bundle' => 'access_token',
        'client' => $consumer->id(),
        'scopes' => $scope_ids,
        'value' => 'cc-session-token',
        'expire' => time() + 3600,
        'status' => TRUE,
      ]);
    self::assertInstanceOf(Oauth2TokenInterface::class, $token);
    // DefaultValueCallback fills auth_user_id with the current user. A
    // client_credentials mint leaves it empty.
    $token->set('auth_user_id', NULL);
    $token->save();

    return new TokenAuthUser(
      $this->container->get('permission_checker'),
      $token,
      $this->container->get('psr7.http_message_factory'),
      $this->container->get('request_stack'),
    );
  }

  /**
   * A user-bound OAuth account whose calculated permissions are the token.
   *
   * @param \Drupal\user\UserInterface $user
   *   The underlying account (roles, uid).
   * @param array<string> $tokenPermissions
   *   Permissions the token's scope grants.
   *
   * @return \Drupal\simple_oauth\Authentication\TokenAuthUserInterface
   *   The delegated session account.
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
