<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\bb_track\Entity\Account;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * Project-update access governs bb_track_account JSON:API writes.
 *
 * `employee` has `edit bb_project` (an update-access editor of the fixture
 * project); `peer` does not (a reader with the same OAuth/session ceiling in
 * practice). Both are real deserialized requests, not direct handler calls.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class AccountJsonApiTest extends WorkTimeTestBase {

  /**
   * The billing-term attributes.
   */
  private const array TERMS = [
    'billing_type',
    'budget_kind',
    'budget_value',
    'budget_resets_monthly',
    'fixed_fee',
    'hourly_rate',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->config('jsonapi.settings')->set('read_only', FALSE)->save();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * An editor creates without, then with, an external ID; both persist.
   */
  public function testEditorCreatesWithAndWithoutExternalId(): void {
    $payload = [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'attributes' => ['name' => 'API created'],
        'relationships' => [
          'project_id' => ['data' => ['type' => 'bb_project--bb_project', 'id' => $this->project->uuid()]],
        ],
      ],
    ];
    $create_path = '/jsonapi/bb_track_account/bb_track_account';
    [$status, $document] = $this->jsonApi('POST', $create_path, $this->employee, $payload);
    self::assertSame(201, $status, (string) json_encode($document));
    // JSON:API normalizes an empty single-value field to NULL.
    self::assertNull($document['data']['attributes']['external_id']);

    $payload['data']['attributes']['name'] = 'API created with ID';
    $payload['data']['attributes']['external_id'] = '00123';
    [$status, $document] = $this->jsonApi('POST', $create_path, $this->employee, $payload);
    self::assertSame(201, $status, (string) json_encode($document));
    self::assertSame('00123', $document['data']['attributes']['external_id']);
  }

  /**
   * An editor edits, clears and deactivates; omitted PATCH preserves.
   */
  public function testEditorUpdatesClearsAndDeactivates(): void {
    $account = $this->createAccount('To edit', 'HARV-1');
    $uuid = $account->uuid();
    $path = '/jsonapi/bb_track_account/bb_track_account/' . $uuid;

    // Omitted external_id on a partial PATCH preserves the stored value.
    [$status, $document] = $this->jsonApi('PATCH', $path, $this->employee, [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'id' => $uuid,
        'attributes' => ['name' => 'Renamed'],
      ],
    ]);
    self::assertSame(200, $status, (string) json_encode($document));
    self::assertSame('HARV-1', $document['data']['attributes']['external_id']);

    // An explicit empty value clears it.
    [$status, $document] = $this->jsonApi('PATCH', $path, $this->employee, [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'id' => $uuid,
        'attributes' => ['external_id' => ''],
      ],
    ]);
    self::assertSame(200, $status, (string) json_encode($document));
    self::assertNull($document['data']['attributes']['external_id']);
    self::assertSame('', (string) $this->reload($account)->get('external_id')->value);

    // Deactivation is PATCH active=false, not DELETE.
    [$status, $document] = $this->jsonApi('PATCH', $path, $this->employee, [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'id' => $uuid,
        'attributes' => ['active' => FALSE],
      ],
    ]);
    self::assertSame(200, $status, (string) json_encode($document));
    self::assertFalse($document['data']['attributes']['active']);
  }

  /**
   * A reader with no project-update right is denied create/update/delete.
   */
  public function testReaderDeniedWrites(): void {
    $account = $this->createAccount('Guarded', 'HARV-2');
    $uuid = $account->uuid();
    $path = '/jsonapi/bb_track_account/bb_track_account/' . $uuid;

    $create_payload = [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'attributes' => ['name' => 'Forged'],
        'relationships' => [
          'project_id' => ['data' => ['type' => 'bb_project--bb_project', 'id' => $this->project->uuid()]],
        ],
      ],
    ];
    [$status] = $this->jsonApi('POST', '/jsonapi/bb_track_account/bb_track_account', $this->peer, $create_payload);
    self::assertContains($status, [403, 422]);
    self::assertSame([], $this->loadByName('Forged'));

    [$status] = $this->jsonApi('PATCH', $path, $this->peer, [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'id' => $uuid,
        'attributes' => ['external_id' => 'Hijacked'],
      ],
    ]);
    self::assertContains($status, [403, 422]);
    self::assertSame('HARV-2', $this->reload($account)->get('external_id')->value);

    [$status] = $this->jsonApi('PATCH', $path, $this->peer, [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'id' => $uuid,
        'attributes' => ['hourly_rate' => '1'],
      ],
    ]);
    self::assertContains($status, [403, 422]);
    self::assertNull($this->reload($account)->get('hourly_rate')->value);

    [$status] = $this->jsonApi('DELETE', $path, $this->peer);
    self::assertContains($status, [403, 404]);
    // reload() asserts the row still loads; nothing was deleted.
    $this->reload($account);
  }

  /**
   * DELETE is rejected for every actor; accounts are archived, not removed.
   */
  public function testDeleteAlwaysRejected(): void {
    $account = $this->createAccount('Never deleted', '');
    $uuid = $account->uuid();
    [$status] = $this->jsonApi('DELETE', '/jsonapi/bb_track_account/bb_track_account/' . $uuid, $this->employee);
    self::assertContains($status, [403, 405]);
    // reload() asserts the row still loads; nothing was deleted.
    $this->reload($account);
  }

  /**
   * Protected relationships and project relocation are not API-writable.
   */
  public function testProtectedFieldsAndRelocationRejected(): void {
    $other = $this->container->get('entity_type.manager')->getStorage('bb_project')->create([
      'name' => 'Other project',
      'key' => 'OTHP',
      'group_id' => $this->project->get('group_id')->target_id,
      'owner_user_id' => $this->project->get('owner_user_id')->target_id,
    ]);
    $other->save();
    $account = $this->createAccount('Fenced', '');
    $uuid = $account->uuid();
    $path = '/jsonapi/bb_track_account/bb_track_account/' . $uuid;

    $relocation = [
      'data' => ['type' => 'bb_project--bb_project', 'id' => $other->uuid()],
    ];
    [$status] = $this->jsonApi('PATCH', $path, $this->employee, [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'id' => $uuid,
        'relationships' => ['project_id' => $relocation],
      ],
    ]);
    self::assertContains($status, [403, 422]);
    self::assertSame((int) $this->project->id(), (int) $this->reload($account)->get('project_id')->target_id);

    [$status] = $this->jsonApi('PATCH', $path, $this->employee, [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'id' => $uuid,
        'attributes' => ['is_default' => TRUE],
      ],
    ]);
    self::assertContains($status, [403, 422]);
    self::assertFalse((bool) $this->reload($account)->get('is_default')->value);
  }

  /**
   * Creating against a missing project is rejected before persistence.
   */
  public function testMissingProjectRejected(): void {
    $payload = [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'attributes' => ['name' => 'No project'],
        'relationships' => [
          'project_id' => [
            'data' => ['type' => 'bb_project--bb_project', 'id' => '00000000-0000-0000-0000-000000000000'],
          ],
        ],
      ],
    ];
    [$status] = $this->jsonApi('POST', '/jsonapi/bb_track_account/bb_track_account', $this->employee, $payload);
    self::assertContains($status, [403, 404, 422]);
    self::assertSame([], $this->loadByName('No project'));
  }

  /**
   * An editor of another workspace's project cannot write into this one.
   *
   * `outsider` carries no site-wide permission; its capability is the
   * `lead` rank of another workspace. The rank fence keeps that rank there,
   * so create and update here are denied while its own project works.
   */
  public function testCrossProjectEditorDenied(): void {
    $types = $this->container->get('entity_type.manager');
    $outsider = $this->createUser([], 'outsider');
    assert($outsider instanceof UserInterface);
    $workspace = $types->getStorage('bb_workspace')->create([
      'name' => 'Foreign workspace',
      'slug' => 'foreign',
      'owner_user_id' => $outsider->id(),
    ]);
    $workspace->save();
    assert($workspace instanceof ContentEntityInterface);
    $this->addMembership($workspace, $outsider, ['lead']);
    $group = $types->getStorage('bb_group')->create([
      'name' => 'Foreign customer',
      'workspace_id' => $workspace->id(),
      'owner_user_id' => $outsider->id(),
    ]);
    $group->save();
    $foreign = $types->getStorage('bb_project')->create([
      'name' => 'Foreign',
      'key' => 'FRGN',
      'group_id' => $group->id(),
      'owner_user_id' => $outsider->id(),
    ]);
    $foreign->save();

    // Positive control: the outsider edits accounts of its own project.
    $own = $this->createAccount('Outsider own', '', (int) $foreign->id());
    [$status, $document] = $this->jsonApi('PATCH', '/jsonapi/bb_track_account/bb_track_account/' . $own->uuid(), $outsider, [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'id' => $own->uuid(),
        'attributes' => ['external_id' => 'OWN-1'],
      ],
    ]);
    self::assertSame(200, $status, (string) json_encode($document));

    [$status, $document] = $this->jsonApi('POST', '/jsonapi/bb_track_account/bb_track_account', $outsider, [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'attributes' => ['name' => 'Planted'],
        'relationships' => [
          'project_id' => ['data' => ['type' => 'bb_project--bb_project', 'id' => $this->project->uuid()]],
        ],
      ],
    ]);
    self::assertSame(403, $status, (string) json_encode($document));
    self::assertSame([], $this->loadByName('Planted'));

    $account = $this->createAccount('Foreign target', 'HARV-3');
    $uuid = $account->uuid();
    [$status] = $this->jsonApi('PATCH', '/jsonapi/bb_track_account/bb_track_account/' . $uuid, $outsider, [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'id' => $uuid,
        'attributes' => ['name' => 'Taken over', 'external_id' => 'Hijacked'],
      ],
    ]);
    self::assertSame(403, $status);
    $stored = $this->reload($account);
    self::assertSame('Foreign target', (string) $stored->label());
    self::assertSame('HARV-3', $stored->get('external_id')->value);
  }

  /**
   * An administrator creates and edits accounts in any project.
   */
  public function testAdministratorAllowed(): void {
    $admin = $this->createUser(['administer bakers'], 'bakers-admin');
    assert($admin instanceof UserInterface);
    [$status, $document] = $this->jsonApi('POST', '/jsonapi/bb_track_account/bb_track_account', $admin, [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'attributes' => ['name' => 'Admin created', 'external_id' => 'ADM-1'],
        'relationships' => [
          'project_id' => ['data' => ['type' => 'bb_project--bb_project', 'id' => $this->project->uuid()]],
        ],
      ],
    ]);
    self::assertSame(201, $status, (string) json_encode($document));
    $uuid = $document['data']['id'];
    [$status, $document] = $this->jsonApi('PATCH', '/jsonapi/bb_track_account/bb_track_account/' . $uuid, $admin, [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'id' => $uuid,
        'attributes' => ['external_id' => 'ADM-2', 'active' => FALSE],
      ],
    ]);
    self::assertSame(200, $status, (string) json_encode($document));
    self::assertSame('ADM-2', $document['data']['attributes']['external_id']);
    self::assertFalse($document['data']['attributes']['active']);
  }

  /**
   * An external ID over 255 characters is rejected without a write.
   */
  public function testOverlongExternalIdRejected(): void {
    $overlong = str_repeat('x', 256);
    [$status] = $this->jsonApi('POST', '/jsonapi/bb_track_account/bb_track_account', $this->employee, [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'attributes' => ['name' => 'Overlong', 'external_id' => $overlong],
        'relationships' => [
          'project_id' => ['data' => ['type' => 'bb_project--bb_project', 'id' => $this->project->uuid()]],
        ],
      ],
    ]);
    self::assertSame(422, $status);
    self::assertSame([], $this->loadByName('Overlong'));

    $account = $this->createAccount('Bounded', 'HARV-4');
    $uuid = $account->uuid();
    [$status] = $this->jsonApi('PATCH', '/jsonapi/bb_track_account/bb_track_account/' . $uuid, $this->employee, [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'id' => $uuid,
        'attributes' => ['external_id' => $overlong],
      ],
    ]);
    self::assertSame(422, $status);
    self::assertSame('HARV-4', $this->reload($account)->get('external_id')->value);
  }

  /**
   * Guard violations are validation errors (422), not server errors.
   */
  public function testGuardViolationsAreUnprocessableNotServerErrors(): void {
    $default = $this->container->get('bb_track.assignments')->defaultAccount((int) $this->project->id());
    self::assertNotNull($default);
    $path = '/jsonapi/bb_track_account/bb_track_account/';
    [$status] = $this->jsonApi('PATCH', $path . $default->uuid(), $this->employee, [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'id' => $default->uuid(),
        'attributes' => ['active' => FALSE],
      ],
    ]);
    self::assertSame(422, $status);
    self::assertTrue((bool) $this->reload($default)->get('active')->value);

    $account = $this->createAccount('Named', '');
    [$status] = $this->jsonApi('PATCH', $path . $account->uuid(), $this->employee, [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'id' => $account->uuid(),
        'attributes' => ['name' => '   '],
      ],
    ]);
    self::assertSame(422, $status);
    self::assertSame('Named', $this->reload($account)->label());
  }

  /**
   * An archived account cannot be edited or reactivated through the API.
   */
  public function testArchivedAccountIsNotEditable(): void {
    $account = $this->createAccount('Archived', 'HARV-5');
    $account->set('active', FALSE)->save();
    $uuid = $account->uuid();
    foreach ([['active' => TRUE], ['external_id' => 'Changed']] as $attributes) {
      [$status] = $this->jsonApi('PATCH', '/jsonapi/bb_track_account/bb_track_account/' . $uuid, $this->employee, [
        'data' => [
          'type' => 'bb_track_account--bb_track_account',
          'id' => $uuid,
          'attributes' => $attributes,
        ],
      ]);
      self::assertSame(403, $status);
    }
    $stored = $this->reload($account);
    self::assertFalse((bool) $stored->get('active')->value);
    self::assertSame('HARV-5', $stored->get('external_id')->value);
  }

  /**
   * Reads expose external_id and the billing terms.
   */
  public function testReadExposesExternalIdAndTerms(): void {
    $account = $this->createAccount('Readable', 'HARV-9');
    $path = '/jsonapi/bb_track_account/bb_track_account/' . $account->uuid();
    [$status, $document] = $this->jsonApi('GET', $path, $this->employee);
    self::assertSame(200, $status, (string) json_encode($document));
    self::assertSame('HARV-9', $document['data']['attributes']['external_id']);
    self::assertSame(['time_material', 'none', NULL, FALSE, NULL, NULL], array_values(array_intersect_key(
      array_replace(array_flip(self::TERMS), $document['data']['attributes']),
      array_flip(self::TERMS),
    )));
  }

  /**
   * A reader without project edit sees the account, not its billing terms.
   *
   * The editor still reads the terms of an archived account.
   */
  public function testReaderSeesNoExternalIdOrTerms(): void {
    $account = $this->createAccount('Priced', 'HARV-7');
    $path = '/jsonapi/bb_track_account/bb_track_account/' . $account->uuid();
    [$status, $document] = $this->jsonApi('GET', $path, $this->peer);
    self::assertSame(200, $status, (string) json_encode($document));
    self::assertSame('Priced', $document['data']['attributes']['name']);
    self::assertSame([], array_values(array_intersect(
      ['external_id', ...self::TERMS],
      array_keys($document['data']['attributes']),
    )));

    $account->set('active', FALSE)->save();
    [$status, $document] = $this->jsonApi('GET', $path, $this->employee);
    self::assertSame(200, $status, (string) json_encode($document));
    self::assertSame('HARV-7', $document['data']['attributes']['external_id']);
    self::assertArrayHasKey('hourly_rate', $document['data']['attributes']);
  }

  /**
   * A reader cannot infer the terms by filtering or sorting on them.
   */
  public function testReaderCannotFilterOrSortOnTerms(): void {
    $this->createAccount('Priced', 'HARV-7');
    $collection = '/jsonapi/bb_track_account/bb_track_account';
    foreach (['?filter[external_id]=HARV-7', '?filter[hourly_rate]=0', '?sort=hourly_rate'] as $query) {
      [$status, $document] = $this->jsonApi('GET', $collection . $query, $this->peer);
      self::assertContains($status, [400, 403], $query . ' ' . json_encode($document));
    }
    [$status, $document] = $this->jsonApi('GET', $collection . '?filter[name]=Priced', $this->peer);
    self::assertSame(200, $status, 'other fields stay filterable');
    [$status, $document] = $this->jsonApi('GET', $collection, $this->peer);
    self::assertSame(200, $status);
    self::assertContains('Priced', array_column(array_column($document['data'], 'attributes'), 'name'), 'the reader lists the account itself');
  }

  /**
   * Terms are written with the per-type rules; a violation is 422, unstored.
   */
  public function testTermsReadableAndWritableWithValidation(): void {
    $create_path = '/jsonapi/bb_track_account/bb_track_account';
    $create = fn (string $name, array $attributes): array => $this->jsonApi('POST', $create_path, $this->employee, [
      'data' => [
        'type' => 'bb_track_account--bb_track_account',
        'attributes' => ['name' => $name] + $attributes,
        'relationships' => [
          'project_id' => ['data' => ['type' => 'bb_project--bb_project', 'id' => $this->project->uuid()]],
        ],
      ],
    ]);
    [$status, $document] = $create('Untyped', []);
    self::assertSame(201, $status, (string) json_encode($document));
    $attributes = $document['data']['attributes'];
    self::assertSame(['time_material', 'none'], [$attributes['billing_type'], $attributes['budget_kind']]);

    [$status, $document] = $create('Fee missing', ['billing_type' => 'fixed_fee']);
    self::assertSame(422, $status, (string) json_encode($document));
    self::assertStringEndsWith('/fixed_fee', $document['errors'][0]['source']['pointer'] ?? '');
    self::assertSame([], $this->loadByName('Fee missing'));

    // Beyond decimal(12,2): a field error, never a database overflow.
    [$status] = $create('Too large', ['hourly_rate' => '10000000000']);
    self::assertSame(422, $status);
    self::assertSame([], $this->loadByName('Too large'));

    $terms = [
      'billing_type' => 'fixed_fee',
      'fixed_fee' => '1200.00',
      'budget_kind' => 'hours',
      'budget_value' => '20.00',
      'budget_resets_monthly' => TRUE,
    ];
    [$status, $document] = $create('Fixed', $terms);
    self::assertSame(201, $status, (string) json_encode($document));
    $uuid = $document['data']['id'];
    $attributes = $document['data']['attributes'];
    self::assertSame(['fixed_fee', 'hours', TRUE], [
      $attributes['billing_type'],
      $attributes['budget_kind'],
      $attributes['budget_resets_monthly'],
    ]);
    self::assertSame([1200.0, 20.0], [(float) $attributes['fixed_fee'], (float) $attributes['budget_value']]);

    $patch = fn (string $uuid, array $attributes): array => $this->jsonApi('PATCH', $create_path . '/' . $uuid, $this->employee, [
      'data' => ['type' => 'bb_track_account--bb_track_account', 'id' => $uuid, 'attributes' => $attributes],
    ]);
    [$status] = $patch($uuid, ['billing_type' => 'non_billable']);
    self::assertSame(422, $status);
    $fixed = current($this->loadByName('Fixed'));
    assert($fixed instanceof Account);
    self::assertSame('fixed_fee', $this->reload($fixed)->get('billing_type')->value);

    $internal = $this->createAccount('Internal', '');
    $internal->set('billing_type', 'non_billable')->save();
    [$status] = $patch($internal->uuid(), ['hourly_rate' => '90']);
    self::assertSame(422, $status);
    self::assertNull($this->reload($internal)->get('hourly_rate')->value);
  }

  /**
   * Creates an account through the storage directly, unauthorized.
   */
  private function createAccount(string $name, string $external_id, ?int $project_id = NULL): Account {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_account');
    $account = $storage->create([
      'name' => $name,
      'external_id' => $external_id,
      'project_id' => $project_id ?? $this->project->id(),
    ]);
    $account->save();
    assert($account instanceof Account);
    return $account;
  }

  /**
   * The account as stored now.
   */
  private function reload(Account $account): Account {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_account');
    $storage->resetCache([$account->id()]);
    $reloaded = $storage->load($account->id());
    assert($reloaded instanceof Account);
    return $reloaded;
  }

  /**
   * Unauthorized lookup by name, to assert nothing was persisted.
   *
   * @return array<int, \Drupal\Core\Entity\EntityInterface>
   *   Matching accounts.
   */
  private function loadByName(string $name): array {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_account');
    return $storage->loadByProperties(['name' => $name]);
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
   *
   * @return array{int, array<string, mixed>}
   *   Status and decoded document.
   */
  private function jsonApi(string $method, string $path, UserInterface $account, ?array $payload = NULL): array {
    $this->container->get('current_user')->setAccount($account);
    $body = $payload === NULL ? NULL : json_encode($payload, JSON_THROW_ON_ERROR);
    $request = Request::create($path, $method, [], [], [], [], $body);
    $request->headers->set('Accept', 'application/vnd.api+json');
    if ($payload !== NULL) {
      $request->headers->set('Content-Type', 'application/vnd.api+json');
    }
    $response = $this->container->get('http_kernel')->handle($request);
    $this->container->get('request_stack')->pop();
    return [$response->getStatusCode(), json_decode((string) $response->getContent(), TRUE) ?? []];
  }

}
