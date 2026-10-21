<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\JsonApi;

use Drupal\Core\Cache\CacheableResponseInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\search_api\Entity\Index;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Covers filter[search] on the ticket JSON:API collection.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketSearchFilterTest extends KernelTestBase {

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
   * The response of the last collection request.
   */
  private ?Response $lastResponse = NULL;

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
    $this->fixture('a', 'bb_project')
      ->set('repository', ['url' => 'ssh://git@git.key-tec.de/bakers-build/bakers-build.git'])->save();
    $reader = $this->createAccount('search-reader', ['view bb_ticket', 'view bb_project', 'view bb_team']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $reader, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $reader, []);
    $this->reader = $reader;
  }

  /**
   * A short reference lists every ticket on that exact origin.
   */
  public function testShortReferenceListsEveryTicketOnTheOrigin(): void {
    $first = $this->ticket('first on 20', 'https://git.key-tec.de/bakers-build/bakers-build/-/issues/20');
    $second = $this->ticket('second on 20', 'https://git.key-tec.de/bakers-build/bakers-build/issues/20/');
    $this->ticket('on 200', 'https://git.key-tec.de/bakers-build/bakers-build/-/issues/200');
    Index::load('bb_tickets')->indexItems();

    $expected = [$first->uuid(), $second->uuid()];
    sort($expected);
    self::assertSame($expected, $this->uuids(['search' => 'bakers#20']));
    self::assertSame($expected, $this->uuids(['search' => 'https://git.key-tec.de/bakers-build/bakers-build/-/issues/20']));
    // A bare `#20` resolves through the project the list is narrowed to.
    self::assertSame($expected, $this->uuids([
      'search' => '#20',
      'project_id.id' => $this->fixture('a', 'bb_project')->uuid(),
    ]));
    // An origin no ticket carries is an empty page, not every ticket.
    self::assertSame([], $this->uuids(['search' => 'bakers#999']));
  }

  /**
   * Identifier and title matches come from the ticket index.
   */
  public function testSearchReadsTheIndex(): void {
    $ticket = $this->ticket('Theme tokens for the rail', '');
    $ticket->set('identifier', 'BB-544')->save();
    $this->ticket('unrelated', '');

    // Unindexed rows are invisible to search: the collection does not fall
    // through to an entity CONTAINS on identifier or title.
    self::assertSame([], $this->uuids(['search' => 'BB-544']));
    self::assertSame([], $this->uuids(['search' => 'rail']));

    Index::load('bb_tickets')->indexItems();
    self::assertSame([$ticket->uuid()], $this->uuids(['search' => 'BB-544']));
    self::assertSame([$ticket->uuid()], $this->uuids(['search' => 'bb-544']));
    self::assertSame([$ticket->uuid()], $this->uuids(['search' => 'rail']));
    // A bare number is identifier KEY-n, the same as the web list — not a
    // substring of a longer identifier.
    self::assertSame([], $this->uuids(['search' => '54']));
  }

  /**
   * A bare number returns the ticket whose identifier carries that number.
   */
  public function testBareNumberReturnsTheTicketWithThatNumber(): void {
    $ticket = $this->ticket('Theme tokens for the rail', '');
    $this->ticket('unrelated', '');
    Index::load('bb_tickets')->indexItems();
    $number = (string) $ticket->get('number')->value;
    self::assertNotSame('', $number);
    self::assertSame([$ticket->uuid()], $this->uuids(['search' => $number]));
  }

  /**
   * An older terminal's own OR group named `search` still works unchanged.
   */
  public function testLegacySearchGroupPassesThrough(): void {
    $ticket = $this->ticket('Theme tokens for the rail', '');
    $this->ticket('unrelated', '');

    self::assertSame([$ticket->uuid()], $this->uuids([
      'search' => ['group' => ['conjunction' => 'OR']],
      'identifier' => [
        'condition' => ['path' => 'identifier', 'operator' => 'CONTAINS', 'value' => 'rail', 'memberOf' => 'search'],
      ],
      'title' => [
        'condition' => ['path' => 'title', 'operator' => 'CONTAINS', 'value' => 'rail', 'memberOf' => 'search'],
      ],
    ]));
  }

  /**
   * Other filters still apply alongside the search.
   */
  public function testOtherFiltersStillApply(): void {
    $open = $this->ticket('open on 20', 'https://git.key-tec.de/bakers-build/bakers-build/-/issues/20');
    $closed = $this->ticket('closed on 20', 'https://git.key-tec.de/bakers-build/bakers-build/-/issues/20');
    $closed->set('closed', TRUE)->save();
    Index::load('bb_tickets')->indexItems();

    self::assertSame([$open->uuid()], $this->uuids(['search' => 'bakers#20', 'closed' => '0']));
    self::assertSame([$closed->uuid()], $this->uuids(['search' => 'bakers#20', 'closed' => '1']));
  }

  /**
   * An unresolvable reference answers 400 with the resolver's message.
   */
  public function testUnknownAliasAnswersWithItsMessage(): void {
    [$status, $document] = $this->get(['search' => 'nosuchrepo#1']);
    self::assertSame(400, $status);
    self::assertSame(
      'No repository matches "nosuchrepo". Known in your projects: bakers.',
      $document['errors'][0]['detail'] ?? NULL,
    );
    // The answer depends on the query string and on who asks.
    self::assertInstanceOf(CacheableResponseInterface::class, $this->lastResponse);
    $contexts = $this->lastResponse->getCacheableMetadata()->getCacheContexts();
    self::assertContains('url.query_args:filter', $contexts);
    self::assertContains('user', $contexts);
  }

  /**
   * Creates a ticket on workspace A's project.
   */
  private function ticket(string $title, string $origin): BbTicketInterface {
    $ticket = $this->createEntity('bb_ticket', [
      'title' => $title,
      'workflow' => 'bb_feature',
      'project_id' => $this->fixture('a', 'bb_project')->id(),
      'origin' => $origin,
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * The sorted uuids the collection returns for the given filters.
   *
   * @param array<string, mixed> $filter
   *   The filter parameter.
   *
   * @return string[]
   *   Sorted ticket uuids.
   */
  private function uuids(array $filter): array {
    [$status, $document] = $this->get($filter);
    self::assertSame(200, $status, (string) json_encode($document['errors'] ?? []));
    $uuids = array_column($document['data'], 'id');
    sort($uuids);
    return $uuids;
  }

  /**
   * Issues the collection request as the reader.
   *
   * @param array<string, mixed> $filter
   *   The filter parameter.
   *
   * @return array{int, array<string, mixed>}
   *   The status code and the decoded document.
   */
  private function get(array $filter): array {
    $this->container->get('current_user')->setAccount($this->reader);
    $this->container->get('bb_core.workspace_read_scope')->reset();
    $request = Request::create('/jsonapi/bb_ticket/bb_ticket', 'GET', ['filter' => $filter]);
    $request->headers->set('Accept', 'application/vnd.api+json');
    $response = $this->lastResponse = $this->container->get('http_kernel')->handle($request);
    return [$response->getStatusCode(), json_decode((string) $response->getContent(), TRUE) ?? []];
  }

}
