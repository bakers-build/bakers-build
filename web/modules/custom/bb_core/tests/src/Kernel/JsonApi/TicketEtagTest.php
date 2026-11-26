<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\JsonApi;

use Drupal\Core\Session\AccountInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Ticket reads carry an ETag and answer a matching If-None-Match with 304.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketEtagTest extends KernelTestBase {

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
  }

  /**
   * The single ticket and the list answer an unchanged repeat with 304.
   */
  public function testUnchangedRepeatAnswers304AndWriteGivesNewEtag(): void {
    $reader = $this->memberOf('a');
    foreach ([$this->ticketPath() => [], '/jsonapi/bb_ticket/bb_ticket' => $this->listQuery()] as $path => $query) {
      $first = $this->get($reader, $path, $query);
      self::assertSame(200, $first->getStatusCode());
      $etag = (string) $first->headers->get('ETag');
      self::assertMatchesRegularExpression('/^"[^"]+"$/', $etag, $path);

      $repeat = $this->get($reader, $path, $query, $etag);
      self::assertSame(304, $repeat->getStatusCode(), $path);
      self::assertSame('', (string) $repeat->getContent(), $path);

      $this->fixture('a', 'bb_ticket')->set('state', 'plan')->save();
      $changed = $this->get($reader, $path, $query, $etag);
      self::assertSame(200, $changed->getStatusCode(), $path);
      self::assertNotSame($etag, $changed->headers->get('ETag'), $path);
      $this->fixture('a', 'bb_ticket')->set('state', 'qualification')->save();
    }
  }

  /**
   * An ETag never earns a 304 for an account that cannot read the ticket.
   */
  public function testAnEtagGrantsNothingToAnAccountWithoutAccess(): void {
    $reader = $this->memberOf('a');
    $etag = (string) $this->get($reader, $this->ticketPath())->headers->get('ETag');
    self::assertNotSame('', $etag);
    $listEtag = (string) $this->get($reader, '/jsonapi/bb_ticket/bb_ticket', $this->listQuery())->headers->get('ETag');

    foreach (['other workspace' => $this->memberOf('b'), 'no membership' => $this->createAccount('no-bakery')] as $who => $account) {
      $single = $this->get($account, $this->ticketPath(), [], $etag);
      self::assertSame(403, $single->getStatusCode(), $who);

      $list = $this->get($account, '/jsonapi/bb_ticket/bb_ticket', $this->listQuery(), $listEtag);
      self::assertSame(200, $list->getStatusCode(), $who);
      self::assertSame([], json_decode((string) $list->getContent(), TRUE)['data'], $who);
    }
  }

  /**
   * A member of one side's workspace and team, reading through that rank only.
   */
  private function memberOf(string $side): AccountInterface {
    $account = $this->createAccount("reader-$side");
    $this->addMembership($this->fixture($side, 'bb_workspace'), $account, ['contributor']);
    $this->addMembership($this->fixture($side, 'bb_team'), $account, []);
    return $account;
  }

  /**
   * The individual path of workspace A's ticket.
   */
  private function ticketPath(): string {
    return '/jsonapi/bb_ticket/bb_ticket/' . $this->fixture('a', 'bb_ticket')->uuid();
  }

  /**
   * The list query a client sends for workspace A's project.
   *
   * @return array<string, mixed>
   *   The query parameters.
   */
  private function listQuery(): array {
    return [
      'filter' => ['project_id.id' => $this->fixture('a', 'bb_project')->uuid()],
      'include' => 'labels,ticket_type',
    ];
  }

  /**
   * A complete GET cycle as the given account.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account.
   * @param string $path
   *   The JSON:API path.
   * @param array<string, mixed> $query
   *   The query parameters.
   * @param string|null $etag
   *   The If-None-Match value, if any.
   */
  private function get(AccountInterface $account, string $path, array $query = [], ?string $etag = NULL): Response {
    $this->container->get('current_user')->setAccount($account);
    $this->container->get('bb_core.workspace_read_scope')->reset();
    $request = Request::create($path, 'GET', $query);
    $request->headers->set('Accept', 'application/vnd.api+json');
    if ($etag !== NULL) {
      $request->headers->set('If-None-Match', $etag);
    }
    $kernel = $this->container->get('http_kernel');
    $response = $kernel->handle($request);
    $kernel->terminate($request, $response);
    return $response;
  }

}
