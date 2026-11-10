<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_inbox\Kernel;

use Drupal\Core\Session\AccountInterface;
use Drupal\bb_inbox\Entity\BbInboxMessageInterface;
use Drupal\bb_inbox\Resource\InboxPendingResource;
use Drupal\bb_inbox\Resource\InboxResultResource;
use Drupal\bb_inbox\Resource\InboxSendResource;
use Drupal\jsonapi\JsonApiResource\ResourceObject;
use Drupal\jsonapi\ResourceResponse;
use Drupal\jsonapi_resources\Resource\EntityResourceBase;
use Drupal\jsonapi_resources\Resource\ResourceBase;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * The send, pending and result resources.
 */
#[Group('bb_inbox')]
#[RunTestsInSeparateProcesses]
final class InboxResourceTest extends KernelTestBase {

  use InboxWorldTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'file', 'image',
    'serialization', 'jsonapi', 'jsonapi_resources',
    'bb_core', 'bb_inbox', 'bb_inbox_test',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installConfig(['jsonapi']);
    $this->buildInboxWorld();
  }

  /**
   * Send answers 201, 403 on denial and 422 on veto or no handler.
   */
  public function testSendStatusCodes(): void {
    $response = $this->sendRequest($this->guest, 'test.echo', ['text' => 'hi']);
    self::assertSame(201, $response->getStatusCode());
    self::assertSame(403, $this->sendFailure($this->guest, 'test.echo', ['deny' => TRUE]));
    self::assertSame(422, $this->sendFailure($this->guest, 'test.echo', ['bad' => TRUE]));
    self::assertSame(422, $this->sendFailure($this->guest, 'nobody.x', []));
    self::assertSame(404, $this->sendFailure($this->outsider, 'test.echo', []));
  }

  /**
   * Pending lists only the own conductor's pending messages with worktree.
   */
  public function testPendingListsOwnPendingMessagesWithWorktree(): void {
    $this->createEntity('bb_run', [
      'ticket_id' => $this->ticket->id(),
      'conductor_id' => $this->conductor->id(),
      'owner_user_id' => $this->conductorOwner->id(),
      'state' => 'claimed',
      'claim_expires_at' => 2147483000,
      'worktree_path' => '/work/T-A',
    ]);
    $pending = $this->send($this->guest, 'test.echo', ['text' => 'a']);
    $done = $this->send($this->guest, 'test.echo', ['text' => 'b']);
    self::assertSame([], $this->writeResult($done, 'done', ['markdown' => 'ok']));

    $data = $this->pendingData($this->conductorOwner, (string) $this->conductor->get('conductor_id')->value);
    self::assertCount(1, $data['messages']);
    self::assertSame($pending->uuid(), $data['messages'][0]['id']);
    self::assertSame('test.echo', $data['messages'][0]['message_id']);
    self::assertSame('0.0.1', $data['messages'][0]['version']);
    self::assertSame($this->ticket->uuid(), $data['messages'][0]['ticket']);
    self::assertSame(['text' => 'a'], $data['messages'][0]['payload']);
    self::assertSame('/work/T-A', $data['messages'][0]['worktree_path']);

    $foreignOwner = $this->createAccount('pending-foreign', ['register bakers conductor']);
    $this->container->get('current_user')->setAccount($foreignOwner);
    try {
      $this->resource(InboxPendingResource::class)
        ->process(Request::create('/', 'GET'), (string) $this->conductor->get('conductor_id')->value);
      self::fail('A foreign account must not read another conductor inbox.');
    }
    catch (AccessDeniedHttpException) {
    }
  }

  /**
   * A message left running past the answer window is failed by the inbox.
   */
  public function testStaleRunningMessageIsFailed(): void {
    $stale = $this->send($this->guest, 'test.echo');
    self::assertSame([], $this->writeResult($stale, 'running', NULL));
    $fresh = $this->send($this->guest, 'test.echo');
    self::assertSame([], $this->writeResult($fresh, 'running', NULL));
    $this->container->get('database')->update('bb_inbox_message')
      ->fields(['changed' => \Drupal::time()->getRequestTime() - 600])
      ->condition('id', $stale->id())
      ->execute();
    $this->pendingData($this->conductorOwner, (string) $this->conductor->get('conductor_id')->value);
    $stale = $this->reloadMessage($stale);
    self::assertSame('failed', $stale->status());
    self::assertSame('The conductor did not answer in time.', $stale->result()['markdown'] ?? NULL);
    self::assertSame('running', $this->reloadMessage($fresh)->status());
  }

  /**
   * Result answers 200, 422 for a second result and 403 for strangers.
   */
  public function testResultStatusCodes(): void {
    $message = $this->send($this->guest, 'test.echo');
    self::assertSame(200, $this->resultRequest($this->conductorOwner, $message->uuid(), 'done', ['markdown' => 'ok']));
    self::assertSame(422, $this->resultRequest($this->conductorOwner, $message->uuid(), 'done', ['markdown' => 'again']));
    $other = $this->send($this->guest, 'test.echo');
    $foreignOwner = $this->createAccount('result-foreign', ['register bakers conductor']);
    self::assertSame(403, $this->resultRequest($foreignOwner, $other->uuid(), 'done', ['markdown' => 'x']));
  }

  /**
   * Posts to the send resource as the given account.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The sender.
   * @param string $message_id
   *   The message id.
   * @param array<string, mixed> $payload
   *   The payload.
   */
  private function sendRequest(AccountInterface $account, string $message_id, array $payload): ResourceResponse {
    $this->container->get('current_user')->setAccount($account);
    return $this->resource(InboxSendResource::class)->process($this->jsonRequest([
      'ticket' => $this->ticket->uuid(),
      'message_id' => $message_id,
      'payload' => $payload,
    ]));
  }

  /**
   * Posts to the send resource and returns the HTTP error status.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The sender.
   * @param string $message_id
   *   The message id.
   * @param array<string, mixed> $payload
   *   The payload.
   */
  private function sendFailure(AccountInterface $account, string $message_id, array $payload): int {
    try {
      $this->sendRequest($account, $message_id, $payload);
    }
    catch (HttpException $e) {
      return $e->getStatusCode();
    }
    self::fail('The send was expected to fail.');
  }

  /**
   * Posts a result and returns the HTTP status.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The writer.
   * @param string $uuid
   *   The message UUID.
   * @param string $status
   *   The status.
   * @param array<string, mixed> $result
   *   The result.
   */
  private function resultRequest(AccountInterface $account, string $uuid, string $status, array $result): int {
    $this->container->get('current_user')->setAccount($account);
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_inbox_message');
    $storage->resetCache();
    $entities = $storage->loadByProperties(['uuid' => $uuid]);
    $message = reset($entities);
    self::assertInstanceOf(BbInboxMessageInterface::class, $message);
    try {
      return $this->resource(InboxResultResource::class)
        ->process($this->jsonRequest(['status' => $status, 'result' => $result]), $message)
        ->getStatusCode();
    }
    catch (HttpException $e) {
      return $e->getStatusCode();
    }
  }

  /**
   * An owner removed from the conductor's workspace reads no inbox there.
   *
   * A seat in another workspace keeps the route permission, not the inbox.
   */
  public function testRemovedOwnerReadsNoInbox(): void {
    $this->send($this->guest, 'test.echo', ['text' => 'before removal']);
    $this->workspaceMember('b', $this->conductorOwner, 'contributor');
    $this->container->get('bb_core.membership_writer')
      ->remove($this->fixture('a', 'bb_workspace'), (int) $this->conductorOwner->id());

    $this->container->get('current_user')->setAccount($this->conductorOwner);
    $this->expectException(AccessDeniedHttpException::class);
    $this->resource(InboxPendingResource::class)
      ->process(Request::create('/', 'GET'), (string) $this->conductor->get('conductor_id')->value);
  }

  /**
   * Reads the pending resource as the given account.
   *
   * @return array<string, mixed>
   *   The decoded data object.
   */
  private function pendingData(AccountInterface $account, string $conductor_id): array {
    $this->container->get('current_user')->setAccount($account);
    $response = $this->resource(InboxPendingResource::class)
      ->process(Request::create('/', 'GET'), $conductor_id);
    self::assertSame(200, $response->getStatusCode());
    $object = $response->getResponseData()->getData()->getIterator()->current();
    self::assertInstanceOf(ResourceObject::class, $object);
    return [
      'messages' => $object->getField('messages'),
    ];
  }

  /**
   * Builds a JSON:API style request carrying data.attributes.
   *
   * @param array<string, mixed> $attributes
   *   The attributes.
   */
  private function jsonRequest(array $attributes): Request {
    return Request::create('/', 'POST', [], [], [], ['CONTENT_TYPE' => 'application/vnd.api+json'], (string) json_encode(['data' => ['attributes' => $attributes]]));
  }

  /**
   * Instantiates a resource with the setters the router would call.
   *
   * @param class-string<T> $class
   *   The resource class.
   *
   * @return T
   *   The resource.
   *
   * @template T of \Drupal\jsonapi_resources\Resource\ResourceBase&\Drupal\Core\DependencyInjection\ContainerInjectionInterface
   */
  private function resource(string $class): ResourceBase {
    $resource = $class::create($this->container);
    $resource->setResourceResponseFactory($this->container->get('jsonapi_resources.resource_response_factory'));
    $resource->setDocumentExtractor($this->container->get('jsonapi_resources.document_extractor'));
    if ($resource instanceof EntityResourceBase) {
      $resource->setResourceTypeRepository($this->container->get('jsonapi.resource_type.repository'));
      $resource->setEntityTypeManager($this->container->get('entity_type.manager'));
      $resource->setEntityAccessChecker($this->container->get('jsonapi_resources.entity_access_checker'));
    }
    return $resource;
  }

}
