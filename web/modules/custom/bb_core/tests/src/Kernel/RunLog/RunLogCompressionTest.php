<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\RunLog;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\EventSubscriber\RunLogCompressionSubscriber;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\Tests\bb_core\Kernel\WorkspaceFixtureTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\EventListener\RouterListener;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Gzip JSON:API run writes decode into the normal JSON:API chain.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RunLogCompressionTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use WorkspaceFixtureTrait;

  /**
   * Expanded JSON ceiling the subscriber passes to gzdecode().
   */
  private const MAX_DECODE_BYTES = 64 * 1024 * 1024;

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine', 'field', 'og',
    'serialization', 'file', 'image', 'jsonapi', 'link', 'text', 'filter',
    'bb_core',
  ];

  /**
   * An ordinary account that may update runs.
   */
  private UserInterface $writer;

  /**
   * {@inheritdoc}
   */
  public function register(ContainerBuilder $container): void {
    parent::register($container);
    $container->register('stream_wrapper.private', 'Drupal\Core\StreamWrapper\PrivateStream')
      ->addTag('stream_wrapper', ['scheme' => 'private']);
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->allowRunLogStorage();
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_project',
      'bb_ticket', 'bb_run', 'file',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
    $this->installConfig(['user', 'jsonapi', 'filter']);
    $this->config('jsonapi.settings')->set('read_only', FALSE)->save();
    $this->installOgScopeFixture();
    $this->container->get('router.builder')->rebuild();
    // Uid 1 bypasses access; consume it so later accounts are ordinary.
    $this->createAccount('root', []);
    $this->writer = $this->createAccount('writer', ['administer bakers']);
  }

  /**
   * The subscriber runs after routing (32) and before the controller, at 20.
   */
  public function testSubscriberRunsAfterRouterAndBeforeController(): void {
    $events = RunLogCompressionSubscriber::getSubscribedEvents();
    self::assertSame(20, $events[KernelEvents::REQUEST][1]);
    $router_events = RouterListener::getSubscribedEvents();
    $request = $router_events[KernelEvents::REQUEST] ?? NULL;
    $router_priority = 0;
    if (is_array($request)) {
      $first = $request[0] ?? NULL;
      if (is_array($first) && isset($first[1]) && is_int($first[1])) {
        $router_priority = $first[1];
      }
      elseif (isset($request[1]) && is_int($request[1])) {
        $router_priority = $request[1];
      }
    }
    self::assertGreaterThan(20, $router_priority);

    $listeners = $this->container->get('event_dispatcher')->getListeners(KernelEvents::REQUEST);
    $names = [];
    foreach ($listeners as $listener) {
      if (is_array($listener) && is_object($listener[0] ?? NULL) && is_string($listener[1] ?? NULL)) {
        $names[] = $listener[0]::class . '::' . $listener[1];
      }
      else {
        $names[] = 'callable';
      }
    }
    $ours = array_search(RunLogCompressionSubscriber::class . '::onRequest', $names, TRUE);
    $router = NULL;
    foreach ($names as $index => $name) {
      if (str_contains($name, 'RouterListener')) {
        $router = $index;
        break;
      }
    }
    self::assertNotFalse($ours, implode("\n", $names));
    self::assertNotNull($router);
    self::assertLessThan($ours, $router);
  }

  /**
   * A gzip log PATCH is decoded and stored through the JSON:API write path.
   */
  public function testGzipLogPatchReachesJsonApiAndStoresTheTranscript(): void {
    $run = $this->createRunInWorkspace();
    $payload = "gzipped transcript\n";
    $response = $this->requestGzip(
      'PATCH',
      $this->runUrl($run),
      $this->runDocument($run, ['log' => $payload]),
      $this->writer,
    );
    self::assertSame(200, $response->getStatusCode(), (string) $response->getContent());
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $storage->resetCache([$run->id()]);
    $reloaded = $storage->load($run->id());
    self::assertInstanceOf(BbRunInterface::class, $reloaded);
    self::assertSame($payload, $reloaded->readLog());
  }

  /**
   * Content-Encoding tokens are case-insensitive (RFC 9110).
   */
  public function testGzipContentEncodingIsCaseInsensitive(): void {
    $run = $this->createRunInWorkspace();
    $payload = "uppercase encoding\n";
    $gzipped = gzencode($this->runDocument($run, ['log' => $payload]), 6);
    self::assertNotFalse($gzipped);
    $response = $this->requestAs(
      $this->writer,
      'PATCH',
      $this->runUrl($run),
      $gzipped,
      ['Content-Encoding' => 'GZIP'],
    );
    self::assertSame(200, $response->getStatusCode(), (string) $response->getContent());
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $storage->resetCache([$run->id()]);
    $reloaded = $storage->load($run->id());
    self::assertInstanceOf(BbRunInterface::class, $reloaded);
    self::assertSame($payload, $reloaded->readLog());
  }

  /**
   * A gzip error_log PATCH takes the same write-through path.
   */
  public function testGzipErrorLogPatchStoresThePayload(): void {
    $run = $this->createRunInWorkspace();
    $response = $this->requestGzip(
      'PATCH',
      $this->runUrl($run),
      $this->runDocument($run, ['error_log' => 'dispatch failed']),
      $this->writer,
    );
    self::assertSame(200, $response->getStatusCode(), (string) $response->getContent());
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $storage->resetCache([$run->id()]);
    $reloaded = $storage->load($run->id());
    self::assertInstanceOf(BbRunInterface::class, $reloaded);
    self::assertSame('dispatch failed', $reloaded->readErrorLog());
  }

  /**
   * A gzip POST of an incomplete run document reaches JSON:API validation.
   */
  public function testGzipPostReachesJsonApiValidation(): void {
    $json = json_encode([
      'data' => [
        'type' => 'bb_run--bb_run',
        'attributes' => ['log' => 'from create'],
      ],
    ], JSON_THROW_ON_ERROR);
    $response = $this->requestGzip('POST', '/jsonapi/bb_run/bb_run', $json, $this->writer);
    self::assertSame(422, $response->getStatusCode(), (string) $response->getContent());
  }

  /**
   * Corrupt gzip is a generic 400, is not stored, and carries no payload.
   */
  public function testCorruptGzipIsGeneric400AndDoesNotSave(): void {
    $run = $this->createRunInWorkspace();
    $response = $this->requestAs(
      $this->writer,
      'PATCH',
      $this->runUrl($run),
      "not-gzip\x1f",
      ['Content-Encoding' => 'gzip'],
    );
    self::assertSame(400, $response->getStatusCode());
    $this->assertPrivateNoStoreEmpty($response, "not-gzip\x1f");
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $storage->resetCache([$run->id()]);
    $reloaded = $storage->load($run->id());
    self::assertInstanceOf(BbRunInterface::class, $reloaded);
    self::assertNull($reloaded->readLog());
  }

  /**
   * Stacked or unsupported Content-Encoding is 415 with no save.
   */
  public function testUnsupportedEncodingIs415AndDoesNotSave(): void {
    $run = $this->createRunInWorkspace();
    $json = $this->runDocument($run, ['log' => 'stacked']);
    $gzipped = gzencode($json, 6);
    self::assertNotFalse($gzipped);
    $response = $this->requestAs(
      $this->writer,
      'PATCH',
      $this->runUrl($run),
      $gzipped,
      ['Content-Encoding' => 'gzip, deflate'],
    );
    self::assertSame(415, $response->getStatusCode());
    $this->assertPrivateNoStoreEmpty($response, 'stacked');
    $br = $this->requestAs(
      $this->writer,
      'PATCH',
      $this->runUrl($run),
      $gzipped,
      ['Content-Encoding' => 'br'],
    );
    self::assertSame(415, $br->getStatusCode());
    $this->assertPrivateNoStoreEmpty($br, 'stacked');
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $storage->resetCache([$run->id()]);
    $reloaded = $storage->load($run->id());
    self::assertInstanceOf(BbRunInterface::class, $reloaded);
    self::assertNull($reloaded->readLog());
  }

  /**
   * An unauthorized gzip write is denied before decompression.
   */
  public function testUnauthorizedGzipWriteDoesNotDecompress(): void {
    $run = $this->createRunInWorkspace();
    $outsider = $this->createAccount('outsider', []);
    $response = $this->requestAs(
      $outsider,
      'PATCH',
      $this->runUrl($run),
      "not-gzip\x1f",
      ['Content-Encoding' => 'gzip'],
    );
    self::assertSame(403, $response->getStatusCode(), (string) $response->getContent());
    $anonymous = $this->requestAs(
      NULL,
      'PATCH',
      $this->runUrl($run),
      "not-gzip\x1f",
      ['Content-Encoding' => 'gzip'],
    );
    self::assertSame(403, $anonymous->getStatusCode(), (string) $anonymous->getContent());
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $storage->resetCache([$run->id()]);
    $reloaded = $storage->load($run->id());
    self::assertInstanceOf(BbRunInterface::class, $reloaded);
    self::assertNull($reloaded->readLog());
  }

  /**
   * Ordinary identity writes without Content-Encoding stay uncompressed.
   */
  public function testIdentityWriteWithoutGzipStillSaves(): void {
    $run = $this->createRunInWorkspace();
    $response = $this->requestAs(
      $this->writer,
      'PATCH',
      $this->runUrl($run),
      $this->runDocument($run, ['closed' => TRUE]),
    );
    self::assertSame(200, $response->getStatusCode(), (string) $response->getContent());
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $storage->resetCache([$run->id()]);
    $reloaded = $storage->load($run->id());
    self::assertInstanceOf(BbRunInterface::class, $reloaded);
    self::assertTrue((bool) $reloaded->get('closed')->value);
    self::assertNull($reloaded->readLog());
  }

  /**
   * Gzip on an unrelated entity is not decoded by the run subscriber.
   */
  public function testGzipOnUnrelatedEntityIsNotDecoded(): void {
    $run = $this->createRunInWorkspace();
    $ticket = $run->get('ticket_id')->entity;
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $title = $ticket->get('title')->value;
    $json = json_encode([
      'data' => [
        'type' => 'bb_ticket--bb_ticket',
        'id' => $ticket->uuid(),
        'attributes' => ['title' => 'gzip should not apply'],
      ],
    ], JSON_THROW_ON_ERROR);
    $gzipped = gzencode($json, 6);
    self::assertNotFalse($gzipped);
    $response = $this->requestAs(
      $this->writer,
      'PATCH',
      '/jsonapi/bb_ticket/bb_ticket/' . $ticket->uuid(),
      $gzipped,
      ['Content-Encoding' => 'gzip'],
    );
    self::assertSame(400, $response->getStatusCode(), (string) $response->getContent());
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $storage->resetCache([$ticket->id()]);
    $reloaded = $storage->load($ticket->id());
    self::assertInstanceOf(BbTicketInterface::class, $reloaded);
    self::assertSame($title, $reloaded->get('title')->value);
  }

  /**
   * Over-limit inflation is a generic 400 and does not save.
   */
  public function testOverLimitInflationIsGeneric400AndDoesNotSave(): void {
    $run = $this->createRunInWorkspace();
    $bomb = gzencode(str_repeat('a', self::MAX_DECODE_BYTES + 1), 6);
    self::assertNotFalse($bomb);
    $response = $this->requestAs(
      $this->writer,
      'PATCH',
      $this->runUrl($run),
      $bomb,
      ['Content-Encoding' => 'gzip'],
    );
    self::assertSame(400, $response->getStatusCode());
    $this->assertPrivateNoStoreEmpty($response, str_repeat('a', 32));
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $storage->resetCache([$run->id()]);
    $reloaded = $storage->load($run->id());
    self::assertInstanceOf(BbRunInterface::class, $reloaded);
    self::assertNull($reloaded->readLog());
  }

  /**
   * JSON:API rejects an omission flag combined with a new log payload.
   */
  public function testJsonApiRejectsOmissionFlagWithLogPayload(): void {
    $run = $this->createRunInWorkspace();
    $run->set('error_log', "dispatch failed\n")->save();
    $response = $this->requestAs(
      $this->writer,
      'PATCH',
      $this->runUrl($run),
      $this->runDocument($run, [
        'closed' => TRUE,
        'log_upload_omitted' => TRUE,
        'log' => 'should not land',
      ]),
    );
    self::assertSame(422, $response->getStatusCode(), (string) $response->getContent());
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $storage->resetCache([$run->id()]);
    $reloaded = $storage->load($run->id());
    self::assertInstanceOf(BbRunInterface::class, $reloaded);
    self::assertFalse((bool) $reloaded->get('closed')->value);
    self::assertNull($reloaded->readLog());
    self::assertSame("dispatch failed\n", $reloaded->readErrorLog());
  }

  /**
   * JSON:API rejects an omission flag that is not a closing write.
   */
  public function testJsonApiRejectsOmissionFlagWithoutClosing(): void {
    $run = $this->createRunInWorkspace();
    $run->set('error_log', "dispatch failed\n")->save();
    $response = $this->requestAs(
      $this->writer,
      'PATCH',
      $this->runUrl($run),
      $this->runDocument($run, ['log_upload_omitted' => TRUE]),
    );
    self::assertSame(422, $response->getStatusCode(), (string) $response->getContent());
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $storage->resetCache([$run->id()]);
    $reloaded = $storage->load($run->id());
    self::assertInstanceOf(BbRunInterface::class, $reloaded);
    self::assertFalse((bool) $reloaded->get('closed')->value);
    self::assertSame("dispatch failed\n", $reloaded->readErrorLog());
  }

  /**
   * JSON:API accepts a closing omission write and appends the fixed warning.
   */
  public function testJsonApiOmissionCloseAppendsTheWarning(): void {
    $run = $this->createRunInWorkspace();
    $run->set('error_log', "dispatch failed\n")->save();
    $response = $this->requestAs(
      $this->writer,
      'PATCH',
      $this->runUrl($run),
      $this->runDocument($run, [
        'closed' => TRUE,
        'log_upload_omitted' => TRUE,
      ]),
    );
    self::assertSame(200, $response->getStatusCode(), (string) $response->getContent());
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $storage->resetCache([$run->id()]);
    $reloaded = $storage->load($run->id());
    self::assertInstanceOf(BbRunInterface::class, $reloaded);
    self::assertTrue((bool) $reloaded->get('closed')->value);
    self::assertFalse((bool) $reloaded->get('log_upload_omitted')->value);
    self::assertSame(
      "dispatch failed\nTranscript upload omitted because the run-log upload exceeded a size limit.",
      $reloaded->readErrorLog(),
    );
  }

  /**
   * Issues a gzip JSON:API request as the given account.
   *
   * @param string $method
   *   HTTP method.
   * @param string $url
   *   Request path.
   * @param string $json
   *   Uncompressed JSON:API document.
   * @param \Drupal\user\UserInterface $account
   *   Account to act as.
   */
  private function requestGzip(
    string $method,
    string $url,
    string $json,
    UserInterface $account,
  ): Response {
    $gzipped = gzencode($json, 6);
    self::assertNotFalse($gzipped);
    return $this->requestAs(
      $account,
      $method,
      $url,
      $gzipped,
      ['Content-Encoding' => 'gzip'],
    );
  }

  /**
   * Runs a JSON:API write through the real HTTP kernel.
   *
   * @param \Drupal\user\UserInterface|null $account
   *   Account to act as, or NULL for anonymous.
   * @param string $method
   *   HTTP method.
   * @param string $url
   *   Request path.
   * @param string $body
   *   Raw request body.
   * @param array<string, string> $extra_headers
   *   Extra request headers, keyed as they appear on the wire.
   */
  private function requestAs(
    ?UserInterface $account,
    string $method,
    string $url,
    string $body,
    array $extra_headers = [],
  ): Response {
    if ($account === NULL) {
      $this->container->get('current_user')->setAccount(new AnonymousUserSession());
    }
    else {
      $this->container->get('current_user')->setAccount($account);
    }
    $server = [
      'CONTENT_TYPE' => 'application/vnd.api+json',
      'HTTP_ACCEPT' => 'application/vnd.api+json',
      'CONTENT_LENGTH' => (string) strlen($body),
      // The oven writes run logs; like the real CLI it identifies itself.
      'HTTP_X_BAKERS_CLIENT' => 'bakers/0.0.1',
    ];
    foreach ($extra_headers as $name => $value) {
      $server['HTTP_' . strtoupper(str_replace('-', '_', $name))] = $value;
    }
    $request = Request::create($url, $method, [], [], [], $server, $body);
    $response = $this->container->get('http_kernel')->handle($request);
    $this->container->get('request_stack')->pop();
    return $response;
  }

  /**
   * JSON:API document for a run PATCH.
   *
   * @param \Drupal\bb_core\Entity\BbRunInterface $run
   *   Run being patched.
   * @param array<string, mixed> $attributes
   *   Attributes to send.
   */
  private function runDocument(BbRunInterface $run, array $attributes): string {
    return json_encode([
      'data' => [
        'type' => 'bb_run--bb_run',
        'id' => $run->uuid(),
        'attributes' => $attributes,
      ],
    ], JSON_THROW_ON_ERROR);
  }

  /**
   * Individual JSON:API path for a run.
   *
   * @param \Drupal\bb_core\Entity\BbRunInterface $run
   *   Run whose uuid is placed in the path.
   */
  private function runUrl(BbRunInterface $run): string {
    return '/jsonapi/bb_run/bb_run/' . $run->uuid();
  }

  /**
   * Rejection bodies stay private/no-store and never echo the payload.
   *
   * @param \Symfony\Component\HttpFoundation\Response $response
   *   Kernel response under assertion.
   * @param string $payload
   *   Bytes that must not appear in the body.
   */
  private function assertPrivateNoStoreEmpty(
    Response $response,
    string $payload,
  ): void {
    $header = (string) $response->headers->get('Cache-Control');
    self::assertStringContainsString('private', $header);
    self::assertStringContainsString('no-store', $header);
    $content = (string) $response->getContent();
    self::assertSame('', $content);
    self::assertStringNotContainsString($payload, $content);
  }

  /**
   * Creates a user holding exactly the given permissions.
   *
   * @param string $name
   *   Stem used for the role id and account name.
   * @param array<string> $permissions
   *   Permissions granted on a dedicated role.
   */
  private function createAccount(string $name, array $permissions): UserInterface {
    $role_id = 'r_' . $name . '_' . bin2hex(random_bytes(3));
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    if ($permissions !== []) {
      user_role_grant_permissions($role_id, $permissions);
    }
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name . bin2hex(random_bytes(3)), 'status' => 1, 'roles' => [$role_id]]);
    self::assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

}
