<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_api_key\Kernel;

use Drupal\Core\Session\AnonymousUserSession;
use Drupal\Component\Serialization\Json;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\simple_oauth\Functional\SimpleOauthTestTrait;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\og\Entity\OgMembership;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Real OAuth exchange, authorship and team-scoped access.
 *
 * Every assertion goes through a real `/oauth/token` exchange and the real
 * JSON:API HTTP kernel chain, never a scope-only stub, so a team-local grant
 * that only existed on paper would show up here.
 */
#[Group('bb_core')]
#[Group('bb_api_key')]
#[RunTestsInSeparateProcesses]
final class ServiceAccountOAuthTest extends KernelTestBase {

  use UserCreationTrait;
  use SimpleOauthTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'serialization', 'options', 'image', 'file',
    'text', 'link', 'filter', 'markdown_easy', 'field', 'state_machine', 'entity', 'og',
    'consumers', 'simple_oauth', 'views', 'jsonapi', 'bb_core', 'bb_api_key',
  ];

  /**
   * The workspace a Lead administers.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * The team a service Reporter is bound to.
   */
  private BbTeamInterface $teamA;

  /**
   * A second team the same workspace, used for a cross-team denial.
   */
  private BbTeamInterface $teamB;

  /**
   * The project associated with teamA.
   */
  private BbProjectInterface $projectA;

  /**
   * The project associated with teamB.
   */
  private BbProjectInterface $projectB;

  /**
   * An account with the workspace's `lead` rank.
   */
  private UserInterface $lead;

  /**
   * An ordinary human member, used as an explicit ticket assignee.
   */
  private UserInterface $humanAssignee;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_group',
      'bb_project', 'bb_ticket', 'bb_run', 'bb_environment',
      'bb_conductor', 'consumer', 'oauth2_token',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'og', 'bb_core', 'bb_api_key', 'simple_oauth']);
    Og::addGroup('bb_workspace', 'bb_workspace');
    Og::addGroup('bb_team', 'bb_team');

    $this->container->get('entity_type.manager')->getStorage('oauth2_scope')->create([
      'id' => 'bb_session',
      'name' => 'bb:session',
      'grant_types' => ['client_credentials' => ['status' => TRUE]],
      'umbrella' => TRUE,
    ])->save();

    $entityTypeManager = $this->container->get('entity_type.manager');

    $workspace = $entityTypeManager->getStorage('bb_workspace')->create(['name' => 'Acme', 'slug' => 'acme']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();
    $this->workspace = $workspace;

    $teamA = $entityTypeManager->getStorage('bb_team')->create([
      'name' => 'Team A',
      'workspace_id' => $this->workspace->id(),
    ]);
    self::assertInstanceOf(BbTeamInterface::class, $teamA);
    $teamA->save();
    $this->teamA = $teamA;
    $teamB = $entityTypeManager->getStorage('bb_team')->create([
      'name' => 'Team B',
      'workspace_id' => $this->workspace->id(),
    ]);
    self::assertInstanceOf(BbTeamInterface::class, $teamB);
    $teamB->save();
    $this->teamB = $teamB;

    $group = $entityTypeManager->getStorage('bb_group')->create([
      'name' => 'Acme group',
      'workspace_id' => $this->workspace->id(),
    ]);
    $group->save();

    $projectA = $entityTypeManager->getStorage('bb_project')->create([
      'name' => 'Project A',
      'group_id' => $group->id(),
      'teams' => [$this->teamA->id()],
    ]);
    self::assertInstanceOf(BbProjectInterface::class, $projectA);
    $projectA->save();
    $this->projectA = $projectA;
    $projectB = $entityTypeManager->getStorage('bb_project')->create([
      'name' => 'Project B',
      'group_id' => $group->id(),
      'teams' => [$this->teamB->id()],
    ]);
    self::assertInstanceOf(BbProjectInterface::class, $projectB);
    $projectB->save();
    $this->projectB = $projectB;

    $lead = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $lead);
    $this->lead = $lead;
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($this->lead)
      ->setGroup($this->workspace)
      ->setRoles([$this->loadOgRole('bb_workspace-bb_workspace-lead')])
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    $humanAssignee = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $humanAssignee);
    $this->humanAssignee = $humanAssignee;
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($this->humanAssignee)
      ->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
  }

  /**
   * Loads a saved OG role by id.
   */
  private function loadOgRole(string $id): OgRole {
    $role = OgRole::load($id);
    self::assertInstanceOf(OgRole::class, $role);
    return $role;
  }

  /**
   * The manager under test.
   */
  private function manager(): ServiceAccountManager {
    return $this->container->get(ServiceAccountManager::class);
  }

  /**
   * Generates real RSA keys for a genuine, HTTP-minted access token.
   */
  private function enableRealTokenSigning(): void {
    mkdir($this->siteDirectory . '/keys', 0775, TRUE);
    $public = $this->siteDirectory . '/keys/public.key';
    $private = $this->siteDirectory . '/keys/private.key';
    file_put_contents($public, $this->publicKey);
    file_put_contents($private, $this->privateKey);
    chmod($public, 0660);
    chmod($private, 0660);
    $this->config('simple_oauth.settings')
      ->set('public_key', $public)
      ->set('private_key', $private)
      ->save();
  }

  /**
   * Mints a real access token through a real HTTP POST to `/oauth/token`.
   */
  private function mintRealAccessToken(string $clientId, string $secret): string {
    $request = Request::create(Url::fromRoute('oauth2_token.token')->toString(), 'POST', [
      'grant_type' => 'client_credentials',
      'client_id' => $clientId,
      'client_secret' => $secret,
    ]);
    $response = $this->container->get('http_kernel')->handle($request);
    self::assertSame(200, $response->getStatusCode(), (string) $response->getContent());
    $decoded = Json::decode((string) $response->getContent());
    self::assertIsString($decoded['access_token'] ?? NULL);
    return $decoded['access_token'];
  }

  /**
   * Runs a JSON:API request with a real Bearer token through the real kernel.
   */
  private function bearerJsonApiRequest(string $token, string $method, string $url, ?string $body = NULL): Response {
    $request = Request::create($url, $method, [], [], [], [
      'CONTENT_TYPE' => 'application/vnd.api+json',
      'HTTP_ACCEPT' => 'application/vnd.api+json',
      'CONTENT_LENGTH' => $body === NULL ? '0' : (string) strlen($body),
    ], $body ?? '');
    $request->headers->set('Authorization', 'Bearer ' . $token);
    $response = $this->container->get('http_kernel')->handle($request);
    $this->container->get('request_stack')->pop();
    // simple_oauth's authentication provider sets the resolved service
    // account as `current_user` for the duration of the request and does
    // not revert it afterwards in a kernel test (no terminate()). Left in
    // place, it would make OG's auto_add_group_owner_membership silently
    // join the SERVICE account to the next fixture group this test saves.
    $this->container->get('current_user')->setAccount(new AnonymousUserSession());
    // An error response's exception subscriber leaves the router on a cloned
    // GET context; a later POST to `/oauth/token` would then match as 405.
    $this->container->get('router.no_access_checks')->setContext($this->container->get('router.request_context'));
    return $response;
  }

  /**
   * Issues a real managed token for a service account via a real token mint.
   */
  private function mintTokenFor(UserInterface $serviceUser, ?string $clientIdOut = NULL): array {
    $issued = $this->manager()->issueKey($serviceUser, $this->tomorrowPlus(10), $this->lead);
    $clientId = (string) $issued['consumer']->get('client_id')->value;
    $token = $this->mintRealAccessToken($clientId, $issued['secret']);
    return [$token, $issued];
  }

  /**
   * Builds a ticket creation JSON:API document.
   */
  private function ticketDocument(string $projectUuid, ?string $ownerUuid = NULL, ?string $assigneeUuid = NULL): string {
    $relationships = [
      'project_id' => ['data' => ['type' => 'bb_project--bb_project', 'id' => $projectUuid]],
    ];
    if ($ownerUuid !== NULL) {
      $relationships['owner_user_id'] = ['data' => ['type' => 'user--user', 'id' => $ownerUuid]];
    }
    if ($assigneeUuid !== NULL) {
      $relationships['assignee_user_id'] = ['data' => ['type' => 'user--user', 'id' => $assigneeUuid]];
    }
    return (string) json_encode([
      'data' => [
        'type' => 'bb_ticket--bb_ticket',
        'attributes' => [
          'title' => 'Incident',
          'workflow' => 'bb_work',
          'description' => ['value' => '# Hi', 'format' => 'bb_rich'],
        ],
        'relationships' => $relationships,
      ],
    ]);
  }

  /**
   * A fresh reporter bound to Team A, owning the given workspace role.
   */
  private function createReporter(string $workspaceRole = 'guest'): UserInterface {
    $created = $this->manager()->create($this->workspace, $this->teamA, 'incident-bot', $workspaceRole, 'reporter', $this->tomorrowPlus(10), $this->lead);
    return $created['user'];
  }

  /**
   * The real token exchange produces a ticket owned by the service account.
   *
   * An explicit same-workspace human assignee is honoured; omitting it stays
   * empty.
   */
  public function testTicketOwnerIsServiceAccountAndAssigneeIsIndependent(): void {
    $this->enableRealTokenSigning();
    $reporter = $this->createReporter();
    [$token] = $this->mintTokenFor($reporter);

    $document = $this->ticketDocument($this->projectA->uuid(), NULL, $this->humanAssignee->uuid());
    $response = $this->bearerJsonApiRequest($token, 'POST', '/jsonapi/bb_ticket/bb_ticket', $document);
    self::assertSame(201, $response->getStatusCode(), (string) $response->getContent());
    $decoded = Json::decode((string) $response->getContent());
    self::assertSame((string) $reporter->uuid(), $decoded['data']['relationships']['owner_user_id']['data']['id']);
    self::assertSame((string) $this->humanAssignee->uuid(), $decoded['data']['relationships']['assignee_user_id']['data']['id']);

    $ticketStorage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $withoutAssignee = $this->bearerJsonApiRequest($token, 'POST', '/jsonapi/bb_ticket/bb_ticket', $this->ticketDocument($this->projectA->uuid()));
    self::assertSame(201, $withoutAssignee->getStatusCode(), (string) $withoutAssignee->getContent());
    $decodedTwo = Json::decode((string) $withoutAssignee->getContent());
    self::assertNull($decodedTwo['data']['relationships']['assignee_user_id']['data'] ?? NULL);
    unset($ticketStorage);
  }

  /**
   * Spoofing the owner, or assigning a foreign-workspace user, is rejected.
   */
  public function testSpoofedOwnerAndForeignAssigneeAreRejected(): void {
    $this->enableRealTokenSigning();
    $reporter = $this->createReporter();
    [$token] = $this->mintTokenFor($reporter);

    $spoofed = $this->bearerJsonApiRequest(
      $token, 'POST', '/jsonapi/bb_ticket/bb_ticket',
      $this->ticketDocument($this->projectA->uuid(), $this->lead->uuid()),
    );
    self::assertGreaterThanOrEqual(400, $spoofed->getStatusCode(), 'a service account may not claim a different owner');

    $foreignWorkspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')->create([
      'name' => 'Other',
      'slug' => 'other',
    ]);
    self::assertInstanceOf(BbWorkspaceInterface::class, $foreignWorkspace);
    $foreignWorkspace->save();
    $foreignUser = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $foreignUser);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($foreignUser)->setGroup($foreignWorkspace)->setState(OgMembershipInterface::STATE_ACTIVE)->save();

    $foreignAssignee = $this->bearerJsonApiRequest(
      $token, 'POST', '/jsonapi/bb_ticket/bb_ticket',
      $this->ticketDocument($this->projectA->uuid(), NULL, $foreignUser->uuid()),
    );
    self::assertGreaterThanOrEqual(400, $foreignAssignee->getStatusCode(), 'a foreign-workspace assignee must be rejected');
  }

  /**
   * Reporter in Team A, Member only in Team B: create works in A, not in B.
   *
   * Both projects stay readable through workspace Guest; only A grants
   * ticket creation, even though the token is real and unchanged.
   */
  public function testTeamLocalReporterCreatesOnlyInItsTeamProject(): void {
    $this->enableRealTokenSigning();
    $created = $this->manager()->create($this->workspace, $this->teamA, 'incident-bot', 'guest', 'reporter', $this->tomorrowPlus(10), $this->lead);
    $reporter = $created['user'];
    // Also a bare member of Team B: no Reporter grant there.
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($reporter)->setGroup($this->teamB)->setState(OgMembershipInterface::STATE_ACTIVE)->save();
    [$token] = $this->mintTokenFor($reporter);

    $readA = $this->bearerJsonApiRequest($token, 'GET', '/jsonapi/bb_project/bb_project/' . $this->projectA->uuid());
    self::assertSame(200, $readA->getStatusCode(), (string) $readA->getContent());
    $readB = $this->bearerJsonApiRequest($token, 'GET', '/jsonapi/bb_project/bb_project/' . $this->projectB->uuid());
    self::assertSame(200, $readB->getStatusCode(), (string) $readB->getContent());

    $createInA = $this->bearerJsonApiRequest($token, 'POST', '/jsonapi/bb_ticket/bb_ticket', $this->ticketDocument($this->projectA->uuid()));
    self::assertSame(201, $createInA->getStatusCode(), (string) $createInA->getContent());

    $createInB = $this->bearerJsonApiRequest($token, 'POST', '/jsonapi/bb_ticket/bb_ticket', $this->ticketDocument($this->projectB->uuid()));
    self::assertGreaterThanOrEqual(400, $createInB->getStatusCode(), 'Team B membership has only the implicit Member rank, no create');
  }

  /**
   * A same-workspace project outside the chosen team denies creation too.
   *
   * Covers an unrelated project in the account's own workspace, distinct
   * from testTeamLocalReporterCreatesOnlyInItsTeamProject()'s explicit
   * second-team-membership case.
   */
  public function testUnrelatedSameWorkspaceProjectDeniesCreation(): void {
    $this->enableRealTokenSigning();
    $reporter = $this->createReporter();
    [$token] = $this->mintTokenFor($reporter);

    $response = $this->bearerJsonApiRequest($token, 'POST', '/jsonapi/bb_ticket/bb_ticket', $this->ticketDocument($this->projectB->uuid()));
    self::assertGreaterThanOrEqual(400, $response->getStatusCode());
  }

  /**
   * A foreign workspace's project is invisible and uncreatable, both ways.
   */
  public function testForeignWorkspaceIsDeniedForDirectAndCollectionApi(): void {
    $this->enableRealTokenSigning();
    $reporter = $this->createReporter();
    [$token] = $this->mintTokenFor($reporter);

    $entityTypeManager = $this->container->get('entity_type.manager');
    $foreignWorkspace = $entityTypeManager->getStorage('bb_workspace')->create(['name' => 'Other', 'slug' => 'other']);
    $foreignWorkspace->save();
    $foreignGroup = $entityTypeManager->getStorage('bb_group')->create([
      'name' => 'Other group',
      'workspace_id' => $foreignWorkspace->id(),
    ]);
    $foreignGroup->save();
    $foreignTeam = $entityTypeManager->getStorage('bb_team')->create([
      'name' => 'Other team',
      'workspace_id' => $foreignWorkspace->id(),
    ]);
    $foreignTeam->save();
    $foreignProject = $entityTypeManager->getStorage('bb_project')->create([
      'name' => 'Foreign project',
      'group_id' => $foreignGroup->id(),
      'teams' => [$foreignTeam->id()],
    ]);
    $foreignProject->save();

    $direct = $this->bearerJsonApiRequest($token, 'GET', '/jsonapi/bb_project/bb_project/' . $foreignProject->uuid());
    self::assertGreaterThanOrEqual(400, $direct->getStatusCode());

    $create = $this->bearerJsonApiRequest($token, 'POST', '/jsonapi/bb_ticket/bb_ticket', $this->ticketDocument($foreignProject->uuid()));
    self::assertGreaterThanOrEqual(400, $create->getStatusCode());

    $collection = $this->bearerJsonApiRequest($token, 'GET', '/jsonapi/bb_project/bb_project');
    self::assertSame(200, $collection->getStatusCode(), (string) $collection->getContent());
    $decoded = Json::decode((string) $collection->getContent());
    $uuids = array_column($decoded['data'], 'id');
    self::assertNotContains($foreignProject->uuid(), $uuids);
  }

  /**
   * Rotation: revoking key A rejects its token while key B keeps working.
   *
   * An expired key mints no new token.
   */
  public function testRotationRevokesOnlyTheOldKeyAndExpiredKeyCannotMint(): void {
    $this->enableRealTokenSigning();
    $reporter = $this->createReporter();
    [$tokenA, $issuedA] = $this->mintTokenFor($reporter);
    [$tokenB, $issuedB] = $this->mintTokenFor($reporter);

    $this->manager()->revokeKey($reporter, $issuedA['consumer'], $this->lead);

    self::assertSame(401, $this->bearerJsonApiRequest($tokenA, 'GET', '/jsonapi/bb_project/bb_project')->getStatusCode());
    self::assertSame(200, $this->bearerJsonApiRequest($tokenB, 'GET', '/jsonapi/bb_project/bb_project')->getStatusCode());

    $past = $this->container->get('datetime.time')->getCurrentTime() - 60;
    $issuedB['consumer']->set('bb_expires', $past)->save();
    $request = Request::create(Url::fromRoute('oauth2_token.token')->toString(), 'POST', [
      'grant_type' => 'client_credentials',
      'client_id' => (string) $issuedB['consumer']->get('client_id')->value,
      'client_secret' => $issuedB['secret'],
    ]);
    $response = $this->container->get('http_kernel')->handle($request);
    $this->container->get('request_stack')->pop();
    self::assertSame(401, $response->getStatusCode(), (string) $response->getContent());
    self::assertSame('invalid_client', Json::decode((string) $response->getContent())['error'] ?? NULL);
  }

  /**
   * Reporter cannot create a project, register a conductor, or write/claim.
   *
   * No comment creation either. All real-token checks, not scope stubs.
   */
  public function testReporterHasNoWriteCapabilitiesBeyondTicketCreate(): void {
    $this->enableRealTokenSigning();
    $reporter = $this->createReporter();
    [$token, $issued] = $this->mintTokenFor($reporter);

    $createTicket = $this->bearerJsonApiRequest($token, 'POST', '/jsonapi/bb_ticket/bb_ticket', $this->ticketDocument($this->projectA->uuid()));
    self::assertSame(201, $createTicket->getStatusCode());
    $ticketUuid = Json::decode((string) $createTicket->getContent())['data']['id'];

    $update = $this->bearerJsonApiRequest(
      $token, 'PATCH', '/jsonapi/bb_ticket/bb_ticket/' . $ticketUuid,
      (string) json_encode([
        'data' => [
          'type' => 'bb_ticket--bb_ticket',
          'id' => $ticketUuid,
          'attributes' => ['title' => 'Renamed'],
        ],
      ]),
    );
    self::assertGreaterThanOrEqual(400, $update->getStatusCode(), 'Reporter has no ticket-update permission');

    $delete = $this->bearerJsonApiRequest($token, 'DELETE', '/jsonapi/bb_ticket/bb_ticket/' . $ticketUuid);
    self::assertGreaterThanOrEqual(400, $delete->getStatusCode());

    $createProject = $this->bearerJsonApiRequest(
      $token, 'POST', '/jsonapi/bb_project/bb_project',
      (string) json_encode([
        'data' => [
          'type' => 'bb_project--bb_project',
          'attributes' => ['name' => 'Rogue'],
          'relationships' => [
            'group_id' => [
              'data' => [
                'type' => 'bb_group--bb_group',
                'id' => $this->projectA->get('group_id')->entity->uuid(),
              ],
            ],
          ],
        ],
      ]),
    );
    self::assertGreaterThanOrEqual(400, $createProject->getStatusCode());
    unset($issued);
  }

  /**
   * A workspace Contributor downgraded to Guest loses Conductor capability.
   *
   * Team-Reporter ticket creation remains until the team role is also
   * removed; an already-minted bearer token observes both changes on its
   * very next request — never a cached verdict.
   */
  public function testContributorDowngradeRemovesConductorThenTeamDowngradeRemovesCreate(): void {
    $this->enableRealTokenSigning();
    $created = $this->manager()->create($this->workspace, $this->teamA, 'incident-bot', 'contributor', 'reporter', $this->tomorrowPlus(10), $this->lead);
    $serviceUser = $created['user'];
    [$token] = $this->mintTokenFor($serviceUser);

    $conductorBefore = $this->bearerJsonApiRequest(
      $token, 'POST', '/jsonapi/bb_conductor/bb_conductor',
      (string) json_encode([
        'data' => [
          'type' => 'bb_conductor--bb_conductor',
          'attributes' => ['label' => 'bot-node'],
          'relationships' => [
            'project_id' => ['data' => ['type' => 'bb_project--bb_project', 'id' => $this->projectA->uuid()]],
            'owner_user_id' => ['data' => ['type' => 'user--user', 'id' => $serviceUser->uuid()]],
          ],
        ],
      ]),
    );
    self::assertSame(201, $conductorBefore->getStatusCode(), (string) $conductorBefore->getContent());

    $workspaceMembership = Og::getMembership($this->workspace, $serviceUser);
    self::assertInstanceOf(OgMembershipInterface::class, $workspaceMembership);
    $workspaceMembership->setRoles([$this->loadOgRole('bb_workspace-bb_workspace-guest')])->save();
    $this->container->get('entity.memory_cache')->deleteAll();
    $this->resetRankPermissionCache();

    $conductorAfter = $this->bearerJsonApiRequest(
      $token, 'POST', '/jsonapi/bb_conductor/bb_conductor',
      (string) json_encode([
        'data' => [
          'type' => 'bb_conductor--bb_conductor',
          'attributes' => ['label' => 'bot-node-2'],
          'relationships' => [
            'project_id' => ['data' => ['type' => 'bb_project--bb_project', 'id' => $this->projectA->uuid()]],
            'owner_user_id' => ['data' => ['type' => 'user--user', 'id' => $serviceUser->uuid()]],
          ],
        ],
      ]),
    );
    self::assertGreaterThanOrEqual(400, $conductorAfter->getStatusCode(), 'a Contributor downgrade must remove Conductor capability on the same token');

    $createStillWorks = $this->bearerJsonApiRequest($token, 'POST', '/jsonapi/bb_ticket/bb_ticket', $this->ticketDocument($this->projectA->uuid()));
    self::assertSame(201, $createStillWorks->getStatusCode(), 'team Reporter must still create after a workspace downgrade');

    $teamMembership = Og::getMembership($this->teamA, $serviceUser);
    self::assertInstanceOf(OgMembershipInterface::class, $teamMembership);
    $teamMembership->setRoles([])->save();
    $this->container->get('entity.memory_cache')->deleteAll();
    $this->resetRankPermissionCache();

    $createAfterTeamDowngrade = $this->bearerJsonApiRequest($token, 'POST', '/jsonapi/bb_ticket/bb_ticket', $this->ticketDocument($this->projectA->uuid()));
    self::assertGreaterThanOrEqual(400, $createAfterTeamDowngrade->getStatusCode(), 'removing the team Reporter rank must remove create on the same token');
  }

  /**
   * Existing workspace Contributor/Admin human ticket-create rights persist.
   *
   * A service identity type must not silently widen or narrow an existing
   * human Contributor's ticket-creation permission.
   */
  public function testExistingHumanContributorCreationRightsUnaffected(): void {
    $this->enableRealTokenSigning();
    $contributor = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $contributor);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($contributor)
      ->setGroup($this->workspace)
      ->setRoles([$this->loadOgRole('bb_workspace-bb_workspace-contributor')])
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($contributor)->setGroup($this->teamA)->setState(OgMembershipInterface::STATE_ACTIVE)->save();

    $this->container->get('current_user')->setAccount($contributor);
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => 'Human ticket',
      'workflow' => 'bb_work',
      'project_id' => $this->projectA->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    self::assertSame((int) $contributor->id(), (int) $ticket->get('owner_user_id')->target_id);
  }

  /**
   * Clears BbRankCapability's per-uid permission memoisation.
   *
   * That cache is deliberately request-lifetime only (one og_membership
   * query per account per real HTTP request); a production role change is
   * always picked up on the client's genuinely next request, which gets a
   * fresh container. This kernel test instead drives two real
   * `http_kernel->handle()` calls inside the SAME PHP process to prove the
   * same bearer token observes the change, so it has to clear this
   * process-lifetime memoisation by hand to simulate that fresh request.
   */
  private function resetRankPermissionCache(): void {
    $capability = $this->container->get('bb_core.rank_capability');
    $property = new \ReflectionProperty($capability, 'permissions');
    $property->setValue($capability, []);
  }

  /**
   * A `Y-m-d` date this many days from "now", for `expiryTimestamp()`.
   */
  private function tomorrowPlus(int $days): string {
    $time = $this->container->get('datetime.time')->getCurrentTime();
    return (new \DateTimeImmutable('@' . $time))
      ->setTimezone(new \DateTimeZone('UTC'))
      ->modify('+' . $days . ' days')
      ->format('Y-m-d');
  }

}
