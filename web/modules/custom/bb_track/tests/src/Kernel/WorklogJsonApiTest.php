<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\Entity\Submission;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * JSON:API reads of Worklog are owner-scoped and write methods are gone.
 *
 * @SuppressWarnings("PHPMD.TooManyPublicMethods")
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class WorklogJsonApiTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use TeamWorldTrait;
  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file',
    'image',
    'system',
    'user',
    'field',
    'options',
    'text',
    'link',
    'filter',
    'datetime',
    'entity',
    'state_machine',
    'og',
    'serialization',
    'jsonapi',
    'bb_core',
    'bb_track',
  ];

  /**
   * Account that owns fixture groups so actors are not auto-membered.
   */
  private UserInterface $worldOwner;

  /**
   * Employee A.
   */
  private UserInterface $employee;

  /**
   * Employee B.
   */
  private UserInterface $peer;

  /**
   * Workspace A.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * Permitted project.
   */
  private BbProjectInterface $projectP;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user',
      'file',
      'og_membership',
      'bb_workspace',
      'bb_group',
      'bb_team',
      'bb_project',
      'bb_ticket',
      'bb_track_submission', 'bb_track_account', 'bb_track_worklog',
    ] as $entity_type_id) {
      $this->installEntitySchema($entity_type_id);
    }
    $this->installSchema('file', ['file_usage']);
    $this->installOgScopeFixture();

    $permissions = [
      'record own worklog',
      'view bb_project',
      'view bb_ticket',
      'view bb_group',
    ];
    $this->createUser([], 'uid1-dummy');
    $world_owner = $this->createUser([], 'world-owner');
    $employee = $this->createUser($permissions, 'employee-a');
    $peer = $this->createUser($permissions, 'employee-b');
    self::assertInstanceOf(UserInterface::class, $world_owner);
    self::assertInstanceOf(UserInterface::class, $employee);
    self::assertInstanceOf(UserInterface::class, $peer);
    $this->worldOwner = $world_owner;
    $this->employee = $employee;
    $this->peer = $peer;

    $storage = $this->container->get('entity_type.manager');
    $workspace = $storage->getStorage('bb_workspace')->create([
      'name' => 'Workspace A',
      'slug' => 'workspace-a',
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;

    $group = $storage->getStorage('bb_group')->create([
      'name' => 'Customer G1',
      'workspace_id' => $this->workspace->id(),
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $group->save();
    self::assertInstanceOf(BbGroupInterface::class, $group);

    $project = $storage->getStorage('bb_project')->create([
      'name' => 'PRJP',
      'key' => 'PRJP',
      'owner_user_id' => $this->worldOwner->id(),
      'group_id' => $group->id(),
    ]);
    $project->save();
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $this->attachBillingAccount($project);
    $this->projectP = $project;

    $this->addMembership($this->workspace, $this->employee, ['lead']);
    $this->addMembership($this->workspace, $this->peer, ['lead']);
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * The owner collection contains the owner's row and not the peer's.
   */
  public function testOwnerCollectionHidesPeerRows(): void {
    $own = $this->createEntry($this->employee, 'Own work');
    $peer = $this->createEntry($this->peer, 'Peer work');

    [$status, $document] = $this->jsonApi('GET', '/jsonapi/bb_track_worklog/bb_track_worklog', $this->employee);
    self::assertSame(200, $status, (string) json_encode($document['errors'] ?? []));
    $ids = array_column($document['data'] ?? [], 'id');
    self::assertContains($own->uuid(), $ids);
    self::assertNotContains($peer->uuid(), $ids);
  }

  /**
   * A peer GET of the owner's item is forbidden.
   */
  public function testPeerCannotReadOwnerItem(): void {
    $own = $this->createEntry($this->employee, 'Own work');
    [$owner_status] = $this->jsonApi(
      'GET',
      '/jsonapi/bb_track_worklog/bb_track_worklog/' . $own->uuid(),
      $this->employee,
    );
    self::assertSame(200, $owner_status);
    [$peer_status] = $this->jsonApi(
      'GET',
      '/jsonapi/bb_track_worklog/bb_track_worklog/' . $own->uuid(),
      $this->peer,
    );
    self::assertContains($peer_status, [403, 404]);
  }

  /**
   * Filtered collection reads are owner-scoped.
   */
  public function testFilteredCollectionIsOwnerScoped(): void {
    $own = $this->createEntry($this->employee, 'Own work');
    $this->createEntry($this->peer, 'Peer work');

    $filter_description = [
      'filter' => ['description' => 'Own work'],
    ];
    [$owner_status, $owner_document] = $this->jsonApi(
      'GET',
      '/jsonapi/bb_track_worklog/bb_track_worklog',
      $this->employee,
      NULL,
      $filter_description,
    );
    self::assertSame(200, $owner_status, (string) json_encode($owner_document['errors'] ?? []));
    $owner_ids = array_column($owner_document['data'] ?? [], 'id');
    self::assertSame([$own->uuid()], $owner_ids);
    self::assertCount(1, $owner_ids);

    [$owner_status_warmed, $owner_warmed] = $this->jsonApi(
      'GET',
      '/jsonapi/bb_track_worklog/bb_track_worklog',
      $this->employee,
      NULL,
      $filter_description,
    );
    self::assertSame(200, $owner_status_warmed);
    self::assertSame([$own->uuid()], array_column($owner_warmed['data'] ?? [], 'id'));

    [$peer_status, $peer_document] = $this->jsonApi(
      'GET',
      '/jsonapi/bb_track_worklog/bb_track_worklog',
      $this->peer,
      NULL,
      $filter_description,
    );
    self::assertSame(200, $peer_status, (string) json_encode($peer_document['errors'] ?? []));
    self::assertNotContains($own->uuid(), array_column($peer_document['data'] ?? [], 'id'));
    self::assertCount(0, $peer_document['data'] ?? []);

    [$project_status, $project_document] = $this->jsonApi(
      'GET',
      '/jsonapi/bb_track_worklog/bb_track_worklog',
      $this->employee,
      NULL,
      ['filter' => ['project_id.id' => $this->projectP->uuid()]],
    );
    self::assertSame(200, $project_status, (string) json_encode($project_document['errors'] ?? []));
    self::assertContains($own->uuid(), array_column($project_document['data'] ?? [], 'id'));

    [$include_status, $include_document] = $this->jsonApi(
      'GET',
      '/jsonapi/bb_track_worklog/bb_track_worklog',
      $this->employee,
      NULL,
      ['include' => 'owner_user_id'],
    );
    self::assertContains($include_status, [200, 400]);
    $included = $include_document['included'] ?? [];
    self::assertSame([], $included);
  }

  /**
   * A lead's collection holds team rows of the team workspace only.
   */
  public function testLeadCollectionContainsTeamRowsOnly(): void {
    $w = $this->createTeamWorld();
    $l_p1 = $this->teamEntry('L', 'P1');
    $m_p1 = $this->teamEntry('M', 'P1');
    $m_p2 = $this->teamEntry('M', 'P2');
    $m2_p2 = $this->teamEntry('M2', 'P2');
    $path = '/jsonapi/bb_track_worklog/bb_track_worklog';

    [$status, $document] = $this->jsonApi('GET', $path, $w['L']);
    self::assertSame(200, $status, (string) json_encode($document['errors'] ?? []));
    $ids = array_column($document['data'] ?? [], 'id');
    sort($ids);
    $expected = [$l_p1->uuid(), $m_p1->uuid()];
    sort($expected);
    self::assertSame($expected, $ids);
    self::assertNotContains($m_p2->uuid(), $ids);

    // owner_user_id is not exposed, so forged filters target what is.
    [$forged_status, $forged] = $this->jsonApi('GET', $path, $w['L'], NULL, [
      'filter' => ['project_id.id' => $w['P2']->uuid()],
    ]);
    self::assertSame(200, $forged_status, (string) json_encode($forged['errors'] ?? []));
    self::assertSame([], $forged['data'] ?? []);

    [$peer_status, $peer] = $this->jsonApi('GET', $path, $w['M'], NULL, [
      'filter' => ['description' => 'L on P1'],
    ]);
    self::assertSame(200, $peer_status, (string) json_encode($peer['errors'] ?? []));
    self::assertSame([], $peer['data'] ?? []);

    [$item_status] = $this->jsonApi('GET', $path . '/' . $m2_p2->uuid(), $w['L']);
    self::assertContains($item_status, [403, 404]);
  }

  /**
   * POST, PATCH and DELETE do not write Worklog.
   */
  public function testWritesAreRejected(): void {
    $own = $this->createEntry($this->employee, 'Own work');
    $before = $this->countRows();
    $payload = [
      'data' => [
        'type' => 'bb_track_worklog--bb_track_worklog',
        'attributes' => [
          'description' => 'Forged',
          'duration_seconds' => 60,
        ],
      ],
    ];
    [$post_status] = $this->jsonApi(
      'POST',
      '/jsonapi/bb_track_worklog/bb_track_worklog',
      $this->employee,
      $payload,
    );
    self::assertContains($post_status, [403, 404, 405]);
    [$patch_status] = $this->jsonApi(
      'PATCH',
      '/jsonapi/bb_track_worklog/bb_track_worklog/' . $own->uuid(),
      $this->employee,
      $payload,
    );
    self::assertContains($patch_status, [403, 404, 405]);
    [$delete_status] = $this->jsonApi(
      'DELETE',
      '/jsonapi/bb_track_worklog/bb_track_worklog/' . $own->uuid(),
      $this->employee,
    );
    self::assertContains($delete_status, [403, 404, 405]);
    self::assertSame($before, $this->countRows());
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_worklog');
    $storage->resetCache([$own->id()]);
    $reloaded = $storage->load($own->id());
    self::assertInstanceOf(Worklog::class, $reloaded);
    self::assertSame('Own work', $reloaded->get('description')->value);
  }

  /**
   * The AI creates and confirms a submission without rewriting its worklog.
   */
  public function testSubmissionCreateConfirmAndEdit(): void {
    $this->config('jsonapi.settings')->set('read_only', FALSE)->save();
    $path = '/jsonapi/bb_track_submission/bb_track_submission';
    $payload = ['data' => ['type' => 'bb_track_submission--bb_track_submission']];
    [$status, $document] = $this->jsonApi('POST', $path, $this->employee, $payload);
    self::assertSame(201, $status, (string) json_encode($document));
    $uuid = $document['data']['id'];
    self::assertSame('draft', $document['data']['attributes']['state']);
    self::assertArrayNotHasKey('owner_user_id', $document['data']['relationships'] ?? []);
    $submission = current($this->container->get('entity_type.manager')->getStorage('bb_track_submission')->loadByProperties(['uuid' => $uuid]));
    self::assertInstanceOf(Submission::class, $submission);
    $entry = $this->container->get('bb_track.activity_input')->input([
      'source_system' => 'test',
      'source_key' => 'submission',
      'source_version' => '1',
      'work_date' => '2026-10-06',
      'description' => 'Submission work',
      'project_id' => (int) $this->projectP->id(),
      'duration_seconds' => 5460,
      'submission_id' => (int) $submission->id(),
    ]);
    $before = $entry->toArray();
    $payload['data']['id'] = $uuid;
    $payload['data']['attributes']['state'] = 'submitted';
    [$status] = $this->jsonApi('PATCH', $path . '/' . $uuid, $this->employee, $payload);
    self::assertSame(200, $status);
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_worklog');
    $entry = $storage->loadUnchanged($entry->id());
    self::assertInstanceOf(Worklog::class, $entry);
    self::assertEquals($before, $entry->toArray());
    self::assertTrue($entry->access('update', $this->employee));
    $entry->set('description', 'Edited after submission')->save();
    $corrected = $storage->loadUnchanged($entry->id());
    self::assertInstanceOf(Worklog::class, $corrected);
    self::assertSame('Edited after submission', $corrected->get('description')->value);
    [$status, $document] = $this->jsonApi('GET', '/jsonapi/bb_track_worklog/bb_track_worklog', $this->employee, NULL, ['filter' => ['submission_id.id' => $uuid]]);
    self::assertSame(200, $status);
    self::assertSame([$entry->uuid()], array_column($document['data'], 'id'));
  }

  /**
   * Submissions enforce private access, valid states and retention.
   */
  public function testSubmissionApiBoundaries(): void {
    $this->config('jsonapi.settings')->set('read_only', FALSE)->save();
    $path = '/jsonapi/bb_track_submission/bb_track_submission';
    $payload = ['data' => ['type' => 'bb_track_submission--bb_track_submission']];
    [$status, $document] = $this->jsonApi('POST', $path, $this->employee, $payload);
    self::assertSame(201, $status, (string) json_encode($document));
    $uuid = $document['data']['id'];
    [$status, $document] = $this->jsonApi('GET', $path, $this->employee, NULL, ['filter' => ['state' => 'draft']]);
    self::assertSame(200, $status);
    self::assertSame([$uuid], array_column($document['data'], 'id'));
    [$status, $document] = $this->jsonApi('GET', $path, $this->peer);
    self::assertSame(200, $status);
    self::assertSame([], $document['data']);
    [$status] = $this->jsonApi('GET', $path . '/' . $uuid, $this->peer);
    self::assertContains($status, [403, 404]);
    $payload['data']['id'] = $uuid;
    $payload['data']['attributes']['state'] = 'submitted';
    [$status] = $this->jsonApi('PATCH', $path . '/' . $uuid, $this->peer, $payload);
    self::assertContains($status, [403, 404]);
    $payload['data']['attributes']['state'] = 'discarded';
    [$status] = $this->jsonApi('PATCH', $path . '/' . $uuid, $this->employee, $payload);
    self::assertSame(422, $status);
    [$status] = $this->jsonApi('DELETE', $path . '/' . $uuid, $this->employee);
    self::assertSame(403, $status);
    $payload = [
      'data' => [
        'type' => 'bb_track_submission--bb_track_submission',
        'relationships' => ['owner_user_id' => ['data' => ['type' => 'user--user', 'id' => $this->peer->uuid()]]],
      ],
    ];
    [$status, $document] = $this->jsonApi('POST', $path, $this->employee, $payload);
    self::assertSame(201, $status);
    $submission = current($this->container->get('entity_type.manager')->getStorage('bb_track_submission')->loadByProperties(['uuid' => $document['data']['id']]));
    self::assertInstanceOf(Submission::class, $submission);
    self::assertEquals($this->employee->id(), $submission->getOwnerId());
    self::assertFalse($submission->access('view', $this->peer));
  }

  /**
   * A proposal is created once under its client id and only services move it.
   */
  public function testProposalHandoffThroughJsonApi(): void {
    $this->config('jsonapi.settings')->set('read_only', FALSE)->save();
    $path = '/jsonapi/bb_track_submission/bb_track_submission';
    $uuid = '6b0f6a52-5e6d-4b9e-8f43-0c6a1f9d2a11';
    $payload = [
      'data' => [
        'type' => 'bb_track_submission--bb_track_submission',
        'id' => $uuid,
        'attributes' => ['state' => 'proposed'],
      ],
    ];
    [$status, $document] = $this->jsonApi('POST', $path, $this->employee, $payload);
    self::assertSame(201, $status, (string) json_encode($document));
    self::assertSame('proposed', $document['data']['attributes']['state']);
    [$retry] = $this->jsonApi('POST', $path, $this->employee, $payload);
    self::assertContains($retry, [409, 422]);
    self::assertCount(1, $this->container->get('entity_type.manager')->getStorage('bb_track_submission')->loadByProperties(['uuid' => $uuid]));
    foreach (['draft', 'discarded', 'submitted'] as $state) {
      $payload['data']['attributes']['state'] = $state;
      [$status] = $this->jsonApi('PATCH', $path . '/' . $uuid, $this->employee, $payload);
      self::assertSame(422, $status, "proposed -> $state");
    }
    [$status, $document] = $this->jsonApi('GET', $path . '/' . $uuid, $this->employee);
    self::assertSame('proposed', $document['data']['attributes']['state']);
  }

  /**
   * A lead's collection never contains a member's proposed time.
   */
  public function testLeadCollectionHidesProposedRows(): void {
    $w = $this->createTeamWorld();
    $recorded = $this->teamEntry('M', 'P1');
    $proposed = $this->teamEntry('M', 'P1');
    \Drupal::database()->update('bb_track_worklog')->fields(['state' => 'proposed'])
      ->condition('id', $proposed->id())->execute();
    $path = '/jsonapi/bb_track_worklog/bb_track_worklog';
    [, $lead] = $this->jsonApi('GET', $path, $w['L']);
    self::assertSame([$recorded->uuid()], array_column($lead['data'], 'id'));
    [$item] = $this->jsonApi('GET', $path . '/' . $proposed->uuid(), $w['L']);
    self::assertContains($item, [403, 404]);
    [, $own] = $this->jsonApi('GET', $path, $w['M']);
    self::assertContains($proposed->uuid(), array_column($own['data'], 'id'));
  }

  /**
   * Issues a JSON:API request as the given account.
   *
   * @param string $method
   *   HTTP method.
   * @param string $path
   *   Request path.
   * @param \Drupal\user\UserInterface $account
   *   Acting account.
   * @param array<string, mixed>|null $payload
   *   Optional document.
   * @param array<string, mixed> $query
   *   Query parameters.
   *
   * @return array{int, array<string, mixed>}
   *   Status and decoded document.
   */
  private function jsonApi(string $method, string $path, UserInterface $account, ?array $payload = NULL, array $query = []): array {
    $this->container->get('current_user')->setAccount($account);
    $body = $payload === NULL ? NULL : json_encode($payload, JSON_THROW_ON_ERROR);
    $request = Request::create($path, $method, $query, [], [], [], $body);
    $request->headers->set('Accept', 'application/vnd.api+json');
    if ($payload !== NULL) {
      $request->headers->set('Content-Type', 'application/vnd.api+json');
    }
    $response = $this->container->get('http_kernel')->handle($request);
    $this->container->get('request_stack')->pop();
    return [$response->getStatusCode(), json_decode((string) $response->getContent(), TRUE) ?? []];
  }

  /**
   * Creates a stored worklog row.
   */
  private function createEntry(UserInterface $employee, string $description): Worklog {
    $entry = Worklog::create([
      'owner_user_id' => $employee->id(),
      'work_date' => '2026-10-06',
      'timezone' => 'UTC',
      'duration_seconds' => 3600,
      'description' => $description,
      'derivation' => 'manual',
      'state' => 'recorded',
      'project_id' => $this->projectP->id(),
    ]);
    LegacyWorklogFixture::save($entry);
    self::assertInstanceOf(Worklog::class, $entry);
    return $entry;
  }

  /**
   * Counts stored rows without access checks.
   */
  private function countRows(): int {
    return (int) $this->container->get('entity_type.manager')
      ->getStorage('bb_track_worklog')
      ->getQuery()
      ->accessCheck(FALSE)
      ->count()
      ->execute();
  }

}
