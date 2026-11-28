<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_webhook\Kernel;

use Drupal\bb_webhook\Entity\BbWebhookInterface;
use Drupal\consumers\Entity\Consumer;
use Drupal\Core\Config\FileStorage;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\simple_oauth\Authentication\TokenAuthUser;
use Drupal\simple_oauth\Entity\Oauth2Scope;
use Drupal\simple_oauth\Entity\Oauth2TokenInterface;
use Drupal\user\Entity\User;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * Webhooks through JSON:API follow the same access as the web UI.
 */
#[Group('bb_webhook')]
#[RunTestsInSeparateProcesses]
final class WebhookJsonApiTest extends WebhookKernelTestBase {

  private const PATH = '/jsonapi/bb_webhook/bb_webhook';

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'filter', 'field', 'og', 'views', 'serialization',
    'jsonapi', 'bb_core',
    'bb_activity', 'bb_webhook',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->enableModules(['path_alias', 'consumers', 'simple_oauth']);
    $this->installEntitySchema('path_alias');
    $this->installEntitySchema('consumer');
    $this->installEntitySchema('oauth2_token');
    $this->installConfig(['consumers', 'simple_oauth', 'jsonapi']);
    $this->config('jsonapi.settings')->set('read_only', FALSE)->save();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Uid 1's client_credentials token lists webhooks of its workspace.
   */
  public function testCollectionIsExposed(): void {
    $webhook = $this->newWebhook('a');
    $webhook->save();
    [$status, $document] = $this->jsonApi('GET', self::PATH, $this->uid1Token('a'));
    self::assertSame(200, $status, (string) json_encode($document['errors'] ?? []));
    self::assertSame('bb_webhook--bb_webhook', $document['data'][0]['type'] ?? NULL);
    self::assertSame([$webhook->uuid()], array_column($document['data'], 'id'));
  }

  /**
   * Uid 1 creates a group webhook and finds it by its group alone.
   */
  public function testCreateAndFilterByGroup(): void {
    $token = $this->uid1Token('a');
    $other_group = $this->createEntity('bb_group', [
      'name' => 'Other customer',
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
    ]);
    $this->newWebhook('a', ['group_id' => $other_group->id()])->save();
    $this->newWebhook('a')->save();

    [$status, $document] = $this->jsonApi('POST', self::PATH, $token, $this->createDocument('a', 'customer-hook'));
    self::assertSame(201, $status, (string) json_encode($document['errors'] ?? []));
    $uuid = $document['data']['id'];

    $group_uuid = $this->fixture('a', 'bb_group')->uuid();
    [$status, $document] = $this->jsonApi('GET', self::PATH, $token, NULL, ['filter' => ['group_id.id' => $group_uuid]]);
    self::assertSame(200, $status, (string) json_encode($document['errors'] ?? []));
    self::assertSame([$uuid], array_column($document['data'], 'id'), (string) json_encode($document));
  }

  /**
   * Name, URL, secret and enabled change; the scope does not.
   */
  public function testPatchEditableAndScopeImmutable(): void {
    $token = $this->uid1Token('a');
    $webhook = $this->newWebhook('a', ['group_id' => $this->fixture('a', 'bb_group')->id()]);
    $webhook->save();
    $path = self::PATH . '/' . $webhook->uuid();

    [$status, $document] = $this->jsonApi('PATCH', $path, $token, $this->patchDocument($webhook->uuid(), [
      'name' => 'renamed',
      'url' => 'https://hooks.example.com/renamed',
      'secret' => str_repeat('s', 64),
      'enabled' => FALSE,
    ]));
    self::assertSame(200, $status, (string) json_encode($document['errors'] ?? []));
    $stored = $this->reload($webhook->uuid());
    self::assertSame('renamed', $stored->label());
    self::assertSame('https://hooks.example.com/renamed', $stored->getUrl());
    self::assertSame(str_repeat('s', 64), $stored->getSecret());
    self::assertFalse($stored->isEnabled());

    $other_group = $this->createEntity('bb_group', [
      'name' => 'Other customer',
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
    ]);
    $scope_changes = [
      'group_id' => ['type' => 'bb_group--bb_group', 'id' => $other_group->uuid()],
      'workspace_id' => ['type' => 'bb_workspace--bb_workspace', 'id' => $this->fixture('b', 'bb_workspace')->uuid()],
      'project_id' => ['type' => 'bb_project--bb_project', 'id' => $this->fixture('a', 'bb_project')->uuid()],
    ];
    foreach ($scope_changes as $field => $target) {
      [$status] = $this->jsonApi('PATCH', $path, $token, $this->patchDocument($webhook->uuid(), [], [$field => ['data' => $target]]));
      self::assertSame(422, $status, "PATCH of $field is rejected");
    }
    self::assertSame((int) $this->fixture('a', 'bb_group')->id(), (int) $this->reload($webhook->uuid())->get('group_id')->target_id);
  }

  /**
   * The secret is written, generated or limited, and never returned.
   */
  public function testSecretIsWriteOnly(): void {
    $token = $this->uid1Token('a');
    $secret = str_repeat('k', 64);

    [$status, $document] = $this->jsonApi('POST', self::PATH, $token, $this->createDocument('a', 'with-secret', $secret));
    self::assertSame(201, $status, (string) json_encode($document['errors'] ?? []));
    self::assertArrayNotHasKey('secret', $document['data']['attributes']);
    $uuid = $document['data']['id'];
    self::assertSame($secret, $this->reload($uuid)->getSecret());

    [, $document] = $this->jsonApi('GET', self::PATH . '/' . $uuid, $token);
    self::assertArrayNotHasKey('secret', $document['data']['attributes']);
    [, $document] = $this->jsonApi('GET', self::PATH, $token);
    self::assertArrayNotHasKey('secret', $document['data'][0]['attributes']);
    [$status, $document] = $this->jsonApi('PATCH', self::PATH . '/' . $uuid, $token, $this->patchDocument($uuid, ['name' => 'still-hidden']));
    self::assertSame(200, $status);
    self::assertArrayNotHasKey('secret', $document['data']['attributes']);

    [$status] = $this->jsonApi('POST', self::PATH, $token, $this->createDocument('a', 'too-long', str_repeat('k', 65)));
    self::assertSame(422, $status);

    [$status, $document] = $this->jsonApi('POST', self::PATH, $token, $this->createDocument('a', 'generated'));
    self::assertSame(201, $status);
    self::assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $this->reload($document['data']['id'])->getSecret());
  }

  /**
   * JSON:API grants what the web UI grants, to the same people.
   */
  public function testPersonaMatrix(): void {
    $workspace = $this->fixture('a', 'bb_workspace');
    $contributor = $this->member('a');
    $this->addMembership($workspace, $contributor, ['contributor']);
    $guest = $this->createAccount('north-guest');
    $this->addMembership($workspace, $guest, ['guest']);
    $webhook = $this->newWebhook('a', ['group_id' => $this->fixture('a', 'bb_group')->id()]);
    $webhook->save();
    $path = self::PATH . '/' . $webhook->uuid();

    [$status, $document] = $this->jsonApi('POST', self::PATH, $this->leads['a'], $this->createDocument('a', 'lead-hook'));
    self::assertSame(201, $status, (string) json_encode($document['errors'] ?? []));
    [$status] = $this->jsonApi('PATCH', $path, $this->leads['a'], $this->patchDocument($webhook->uuid(), ['name' => 'lead-renamed']));
    self::assertSame(200, $status);
    [, $document] = $this->jsonApi('GET', self::PATH, $this->leads['a']);
    self::assertContains($webhook->uuid(), array_column($document['data'], 'id'));

    $before = count($this->queryIdsAs('bb_webhook', $this->leads['a']));
    // Who holds `create bb_webhook` elsewhere passes create access, which has
    // no row to fence; validation (tenancy, references) then refuses it: 422.
    $denied = [
      'south-lead' => [$this->leads['b'], 422],
      'north-contributor' => [$contributor, 403],
      'north-guest' => [$guest, 403],
      'no-bakery' => [$this->createAccount('no-bakery'), 403],
      'anonymous' => [new AnonymousUserSession(), 403],
      'south-lead client_credentials token' => [$this->sessionToken($this->leads['b']), 422],
    ];
    foreach ($denied as $persona => [$account, $create_status]) {
      [$status] = $this->jsonApi('POST', self::PATH, $account, $this->createDocument('a', "$persona-hook"));
      self::assertSame($create_status, $status, "$persona may not create a Northside webhook");
      [$status] = $this->jsonApi('PATCH', $path, $account, $this->patchDocument($webhook->uuid(), ['name' => $persona]));
      self::assertSame(403, $status, "$persona may not update a Northside webhook");
      [, $document] = $this->jsonApi('GET', self::PATH, $account);
      self::assertNotContains($webhook->uuid(), array_column($document['data'] ?? [], 'id'), "$persona does not list it");
    }
    self::assertSame('lead-renamed', $this->reload($webhook->uuid())->label());
    self::assertCount($before, $this->queryIdsAs('bb_webhook', $this->leads['a']), 'no denied persona stored a webhook');
  }

  /**
   * A POST document for a webhook of the side's group.
   *
   * @return array<string, mixed>
   *   The JSON:API document.
   */
  private function createDocument(string $side, string $name, ?string $secret = NULL): array {
    $attributes = ['name' => $name, 'url' => "https://hooks.example.com/$name", 'enabled' => TRUE];
    if ($secret !== NULL) {
      $attributes['secret'] = $secret;
    }
    return [
      'data' => [
        'type' => 'bb_webhook--bb_webhook',
        'attributes' => $attributes,
        'relationships' => [
          'workspace_id' => [
            'data' => ['type' => 'bb_workspace--bb_workspace', 'id' => $this->fixture($side, 'bb_workspace')->uuid()],
          ],
          'group_id' => [
            'data' => ['type' => 'bb_group--bb_group', 'id' => $this->fixture($side, 'bb_group')->uuid()],
          ],
        ],
      ],
    ];
  }

  /**
   * A PATCH document.
   *
   * @param string $uuid
   *   The webhook UUID.
   * @param array<string, mixed> $attributes
   *   The attributes to change.
   * @param array<string, mixed> $relationships
   *   The relationships to change.
   *
   * @return array<string, mixed>
   *   The JSON:API document.
   */
  private function patchDocument(string $uuid, array $attributes, array $relationships = []): array {
    $data = ['type' => 'bb_webhook--bb_webhook', 'id' => $uuid];
    if ($attributes !== []) {
      $data['attributes'] = $attributes;
    }
    if ($relationships !== []) {
      $data['relationships'] = $relationships;
    }
    return ['data' => $data];
  }

  /**
   * The stored webhook, bypassing the static cache.
   */
  private function reload(string $uuid): BbWebhookInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_webhook');
    $storage->resetCache();
    $webhooks = $storage->loadByProperties(['uuid' => $uuid]);
    $webhook = reset($webhooks);
    self::assertInstanceOf(BbWebhookInterface::class, $webhook);
    return $webhook;
  }

  /**
   * A client_credentials token of uid 1 holding the real bb:session scopes.
   *
   * Uid 1 is made a lead of the given side; production uid 1 holds a rank
   * where it created the workspace.
   */
  private function uid1Token(string $side): AccountInterface {
    $uid1 = User::load(1);
    self::assertNotNull($uid1);
    $this->addMembership($this->fixture($side, 'bb_workspace'), $uid1, ['lead']);
    $this->addMembership($this->fixture($side, 'bb_team'), $uid1, []);
    return $this->sessionToken($uid1);
  }

  /**
   * A client_credentials token of the user, holding the real bb:session scopes.
   */
  private function sessionToken(UserInterface $user): AccountInterface {
    $sync = new FileStorage(DRUPAL_ROOT . '/../config/sync');
    $storage = $this->container->get('entity_type.manager')->getStorage('oauth2_scope');
    foreach ($sync->listAll('simple_oauth.oauth2_scope.bb_session') as $name) {
      $data = $sync->read($name);
      self::assertIsArray($data);
      // Only the grant under test; the others' schema needs other modules.
      $data['grant_types'] = array_intersect_key($data['grant_types'], ['client_credentials' => TRUE]);
      if ($storage->load($data['id']) === NULL) {
        $storage->create($data)->save();
      }
    }
    $consumer = Consumer::create([
      'client_id' => 'krew-' . $user->id(),
      'label' => 'krew',
      'confidential' => FALSE,
      'grant_types' => ['client_credentials'],
      'scopes' => ['bb_session'],
      'user_id' => $user->id(),
    ]);
    $consumer->save();
    $token = $this->container->get('entity_type.manager')->getStorage('oauth2_token')->create([
      'bundle' => 'access_token',
      'client' => $consumer->id(),
      'scopes' => ['bb_session'],
      'value' => 'krew-token-' . $user->id(),
      'expire' => time() + 3600,
      'status' => TRUE,
    ]);
    self::assertInstanceOf(Oauth2TokenInterface::class, $token);
    // A client_credentials mint leaves auth_user_id empty.
    $token->set('auth_user_id', NULL);
    $token->save();
    self::assertInstanceOf(Oauth2Scope::class, $storage->load('bb_session'));
    return new TokenAuthUser(
      $this->container->get('permission_checker'),
      $token,
      $this->container->get('psr7.http_message_factory'),
      $this->container->get('request_stack'),
    );
  }

  /**
   * Sends one JSON:API request as the account.
   *
   * @param string $method
   *   The HTTP method.
   * @param string $path
   *   The path.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The acting account.
   * @param array<string, mixed>|null $payload
   *   The JSON:API document to send.
   * @param array<string, mixed> $query
   *   The query parameters.
   *
   * @return array{0: int, 1: array<string, mixed>}
   *   The status code and the decoded document.
   */
  private function jsonApi(string $method, string $path, AccountInterface $account, ?array $payload = NULL, array $query = []): array {
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

}
