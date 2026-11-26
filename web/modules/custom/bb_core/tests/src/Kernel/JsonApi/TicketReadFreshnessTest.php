<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\JsonApi;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * A JSON:API ticket read after a write shows the write.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketReadFreshnessTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'search_api', 'search_api_db', 'file', 'image',
    'serialization', 'jsonapi', 'bb_core',
  ];

  /**
   * A member who may read workspace A's project.
   */
  private UserInterface $reader;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('search_api_task');
    $this->installSchema('search_api', ['search_api_item']);
    $this->installReadScopeEnvironment();
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    $this->buildTwoWorkspaceWorld();
    $reader = $this->createAccount('fresh-reader', [
      'view bb_ticket', 'view bb_project', 'view bb_team', 'view bb_run', 'view bb_comment', 'view bb_term',
    ]);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $reader, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $reader, []);
    $this->reader = $reader;
    // Ending an active run writes a run log; this world has no private stream.
    $this->fixture('a', 'bb_run')->set('state', 'done')->save();
  }

  /**
   * A write landing while a read is in flight is not hidden by that read.
   *
   * The read normalizes the old ticket and caches it at terminate; the write
   * in between must not leave that old normalization behind.
   */
  public function testConcurrentWriteShowsInNextRead(): void {
    $request = $this->request($this->ticketPath());
    $kernel = $this->container->get('http_kernel');
    $response = $kernel->handle($request);
    self::assertSame('qualification', $this->document($response)['data']['attributes']['state']);

    $this->freshTicket()->set('state', 'plan')->save();
    $kernel->terminate($request, $response);

    self::assertSame('plan', $this->read($this->ticketPath())['data']['attributes']['state']);
  }

  /**
   * A transition shows in the next read of the ticket and of the list.
   */
  public function testTransitionShowsInNextRead(): void {
    $this->warm();
    $this->freshTicket()->set('state', 'plan')->save();
    self::assertSame('plan', $this->read($this->ticketPath())['data']['attributes']['state']);
    self::assertSame(['plan'], array_column(array_column($this->read($this->listPath(), $this->listQuery())['data'], 'attributes'), 'state'));
  }

  /**
   * A label change shows in the next read.
   */
  public function testLabelChangeShowsInNextRead(): void {
    $this->warm();
    $this->freshTicket()->set('labels', [$this->fixture('a', 'bb_term')->id()])->save();
    $labels = $this->read($this->ticketPath(), ['include' => 'labels'])['data']['relationships']['labels']['data'];
    self::assertSame([$this->fixture('a', 'bb_term')->uuid()], array_column($labels, 'id'));
  }

  /**
   * A freeze shows in the next read.
   */
  public function testFreezeShowsInNextRead(): void {
    $this->warm();
    $this->freshTicket()->setFrozen(TRUE)->save();
    self::assertTrue($this->read($this->ticketPath())['data']['attributes']['frozen']);
  }

  /**
   * A new comment shows in the next read.
   */
  public function testNewCommentShowsInNextRead(): void {
    $this->warm();
    $comment = $this->createEntity('bb_comment', [
      'ticket_id' => $this->fixture('a', 'bb_ticket')->id(),
      'author' => $this->worldOwner->id(),
      'body' => ['value' => 'second'],
      'type' => 'comment',
    ]);
    $comments = $this->read($this->ticketPath())['data']['relationships']['comments']['data'];
    self::assertContains($comment->uuid(), array_column($comments, 'id'));
  }

  /**
   * A run start and its end show in the next read.
   */
  public function testRunStartAndEndShowInNextRead(): void {
    $this->warm(['include' => 'runs']);
    $run = $this->createEntity('bb_run', [
      'conductor_id' => $this->fixture('a', 'bb_conductor')->id(),
      'ticket_id' => $this->fixture('a', 'bb_ticket')->id(),
      'owner_user_id' => $this->worldOwner->id(),
      'state' => 'claimed',
      'claim_expires_at' => self::FAR_FUTURE_TIMESTAMP,
    ]);
    self::assertSame('claimed', $this->includedRunState($run->uuid()));

    $run->set('state', 'running')->save();
    self::assertSame('running', $this->includedRunState($run->uuid()));

    $run->set('state', 'failed')->save();
    self::assertSame('failed', $this->includedRunState($run->uuid()));
  }

  /**
   * The state of one run included in the next ticket read, NULL when absent.
   */
  private function includedRunState(string $uuid): ?string {
    $document = $this->read($this->ticketPath(), ['include' => 'runs']);
    self::assertContains($uuid, array_column($document['data']['relationships']['runs']['data'], 'id'));
    foreach ($document['included'] ?? [] as $resource) {
      if ($resource['id'] === $uuid) {
        return $resource['attributes']['state'];
      }
    }
    return NULL;
  }

  /**
   * Reads the ticket and the list twice, so both normalizations are cached.
   *
   * @param array<string, mixed> $query
   *   Extra query parameters for the ticket read.
   */
  private function warm(array $query = []): void {
    foreach ([1, 2] as $pass) {
      self::assertSame('qualification', $this->read($this->ticketPath(), $query)['data']['attributes']['state'], "pass $pass");
      $this->read($this->listPath(), $this->listQuery());
    }
  }

  /**
   * The ticket collection path.
   */
  private function listPath(): string {
    return '/jsonapi/bb_ticket/bb_ticket';
  }

  /**
   * The list query a client sends for workspace A's project.
   *
   * @return array<string, mixed>
   *   The query parameters.
   */
  private function listQuery(): array {
    return [
      'filter' => ['project_id.id' => $this->fixture('a', 'bb_project')->uuid(), 'closed' => '0'],
      'sort' => '-changed',
      'include' => 'labels,ticket_type',
    ];
  }

  /**
   * Workspace A's ticket.
   */
  private function freshTicket(): BbTicketInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $storage->resetCache();
    $ticket = $storage->load($this->fixture('a', 'bb_ticket')->id());
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * The individual path of workspace A's ticket.
   */
  private function ticketPath(): string {
    return '/jsonapi/bb_ticket/bb_ticket/' . $this->fixture('a', 'bb_ticket')->uuid();
  }

  /**
   * A complete request cycle as the reader: handle, then terminate.
   *
   * @param string $path
   *   The JSON:API path.
   * @param array<string, mixed> $query
   *   The query parameters.
   *
   * @return array<string, mixed>
   *   The decoded document.
   */
  private function read(string $path, array $query = []): array {
    $request = $this->request($path, $query);
    $kernel = $this->container->get('http_kernel');
    $response = $kernel->handle($request);
    $kernel->terminate($request, $response);
    self::assertSame(200, $response->getStatusCode(), (string) $response->getContent());
    return $this->document($response);
  }

  /**
   * A GET request as the reader, with fresh request-scoped state.
   *
   * @param string $path
   *   The JSON:API path.
   * @param array<string, mixed> $query
   *   The query parameters.
   */
  private function request(string $path, array $query = []): Request {
    $this->container->get('current_user')->setAccount($this->reader);
    $this->container->get('bb_core.workspace_read_scope')->reset();
    foreach (['bb_ticket', 'bb_run', 'bb_comment', 'bb_term'] as $type) {
      $this->container->get('entity_type.manager')->getStorage($type)->resetCache();
    }
    $request = Request::create($path, 'GET', $query);
    $request->headers->set('Accept', 'application/vnd.api+json');
    return $request;
  }

  /**
   * The decoded JSON:API document of a response.
   *
   * @return array<string, mixed>
   *   The document.
   */
  private function document(Response $response): array {
    return json_decode((string) $response->getContent(), TRUE) ?? [];
  }

}
