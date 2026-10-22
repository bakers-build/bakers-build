<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Ticket;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Ticket\TicketSearchQuery;
use Drupal\bb_core\Ticket\TicketSearchResolver;
use Drupal\search_api\Entity\Index;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers how one typed line becomes a ticket search condition.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketSearchResolverTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'search_api', 'search_api_db', 'file', 'image', 'bb_core',
  ];

  /**
   * A member who may read workspace A's project only.
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
    $this->setRepository('a', 'ssh://git@git.key-tec.de/bakers-build/bakers-build.git');
    $this->setRepository('b', 'git@git.key-tec.de:keytec/symbiont.git');

    $reader = $this->createAccount('search-reader', ['view bb_ticket', 'view bb_project', 'view bb_team']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $reader, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $reader, []);
    $this->reader = $reader;
  }

  /**
   * An identifier resolves to an exact identifier condition.
   */
  public function testIdentifier(): void {
    $query = $this->resolveAs('bb-295');
    self::assertSame('identifier', $query->field);
    self::assertSame('BB-295', $query->value);
  }

  /**
   * A bare number with a project is that project's exact identifier.
   */
  public function testBareNumberWithProjectIsExactIdentifier(): void {
    $query = $this->resolveAs('7', $this->project('a'));
    self::assertSame('identifier', $query->field);
    self::assertSame($this->project('a')->getKey() . '-7', $query->value);
    self::assertNull($query->fulltext);
  }

  /**
   * A bare number without a project names only readable projects' identifiers.
   */
  public function testBareNumberWithoutProjectUsesReadableProjectKeys(): void {
    $query = $this->resolveAs('7');
    self::assertSame('identifier', $query->field);
    self::assertSame([$this->project('a')->getKey() . '-7'], $query->value);
    self::assertNotContains($this->project('b')->getKey() . '-7', (array) $query->value);

    $this->grantWorkspaceB();
    $across = $this->resolveAs('7');
    $expected = [
      $this->project('a')->getKey() . '-7',
      $this->project('b')->getKey() . '-7',
    ];
    sort($expected);
    self::assertSame($expected, $across->value);
  }

  /**
   * A bare short reference uses the repository of the project in context.
   */
  public function testBareShortReferenceUsesProjectRepository(): void {
    $query = $this->resolveAs('#19', $this->project('a'));
    self::assertSame('origin_ref', $query->field);
    // An exact key: `#19` can never compare equal to
    // `bakers-build/bakers-build#190`.
    self::assertSame('bakers-build/bakers-build#19', $query->value);
  }

  /**
   * A bare short reference resolves when the account reads one repository.
   */
  public function testBareShortReferenceWithOneReadableRepository(): void {
    self::assertSame('bakers-build/bakers-build#19', $this->resolveAs('#19')->value);
  }

  /**
   * A bare short reference over several repositories is ambiguous.
   */
  public function testBareShortReferenceOverSeveralRepositoriesIsAmbiguous(): void {
    $this->grantWorkspaceB();
    $query = $this->resolveAs('#19');
    self::assertTrue($query->failed());
    self::assertStringContainsString('ambiguous', (string) $query->error);
    self::assertSame(['bakers-build', 'symbiont'], $query->candidates);
  }

  /**
   * An exact alias wins without a project context.
   */
  public function testExactAlias(): void {
    self::assertSame('bakers-build/bakers-build#19', $this->resolveAs('bakers-build#19')->value);
  }

  /**
   * A unique prefix resolves.
   */
  public function testUniquePrefixAlias(): void {
    $this->grantWorkspaceB();
    self::assertSame('keytec/symbiont#1234', $this->resolveAs('sym#1234')->value);
  }

  /**
   * An ambiguous prefix names its candidates instead of returning nothing.
   */
  public function testAmbiguousPrefixNamesCandidates(): void {
    $this->grantWorkspaceB();
    $this->setRepository('a', 'https://git.key-tec.de/keytec/symfony-tools.git');
    $query = $this->resolveAs('sym#1234');
    self::assertNull($query->value);
    self::assertStringContainsString('ambiguous', (string) $query->error);
    self::assertSame(['symbiont', 'symfony-tools'], $query->candidates);
  }

  /**
   * Two readable repositories sharing a last path segment make it ambiguous.
   */
  public function testAliasSharedByTwoRepositoriesIsAmbiguous(): void {
    $this->grantWorkspaceB();
    $this->setRepository('a', 'https://git.key-tec.de/leando/symbiont.git');
    $query = $this->resolveAs('symbiont#1');
    self::assertNull($query->value);
    self::assertStringContainsString('keytec/symbiont', (string) $query->error);
    self::assertStringContainsString('leando/symbiont', (string) $query->error);
    self::assertSame(['keytec/symbiont', 'leando/symbiont'], $query->candidates);
    self::assertTrue($this->resolveAs('#1')->failed());
  }

  /**
   * An unknown alias lists what is known.
   */
  public function testUnknownAliasListsKnownRepositories(): void {
    $query = $this->resolveAs('foo#1');
    self::assertNull($query->value);
    self::assertStringContainsString('No repository matches "foo"', (string) $query->error);
    self::assertSame(['bakers-build'], $query->candidates);
  }

  /**
   * An alias never resolves to, or names, a repository the account cannot read.
   */
  public function testUnreadableRepositoryIsNeitherResolvedNorNamed(): void {
    $query = $this->resolveAs('sym#1');
    self::assertTrue($query->failed());
    self::assertSame(['bakers-build'], $query->candidates);
    self::assertStringNotContainsString('symbiont', (string) $query->error);
  }

  /**
   * Every spelling of one URL resolves to the same key as the short form.
   */
  #[DataProvider('urlSpellings')]
  public function testUrlResolvesLikeTheShortForm(string $url): void {
    $query = $this->resolveAs($url);
    self::assertSame('origin_ref', $query->field);
    self::assertSame('bakers-build/bakers-build#19', $query->value);
  }

  /**
   * The spellings a person can plausibly paste.
   *
   * @return array<string, array{string}>
   *   One URL per case.
   */
  public static function urlSpellings(): array {
    return [
      'canonical' => ['https://git.key-tec.de/bakers-build/bakers-build/-/issues/19'],
      'without dash segment' => ['https://git.key-tec.de/bakers-build/bakers-build/issues/19'],
      'trailing slash' => ['https://git.key-tec.de/bakers-build/bakers-build/-/issues/19/'],
      'http' => ['http://git.key-tec.de/bakers-build/bakers-build/-/issues/19'],
    ];
  }

  /**
   * Anything else is free text, and an empty line constrains nothing.
   */
  public function testFreeTextAndEmptyInput(): void {
    $query = $this->resolveAs('theme tokens');
    self::assertNull($query->field);
    self::assertSame('theme tokens', $query->fulltext);
    self::assertTrue($this->resolveAs('   ')->isEmpty());
  }

  /**
   * The origin lookup returns every readable ticket on that exact origin.
   */
  public function testTicketIdsForOriginAreExactAndReadScoped(): void {
    $first = $this->fixture('a', 'bb_ticket');
    $first->set('origin', 'https://git.key-tec.de/bakers-build/bakers-build/-/issues/20')->save();
    $second = $this->createEntity('bb_ticket', [
      'title' => 'second on issue 20',
      'workflow' => 'bb_feature',
      'project_id' => $this->project('a')->id(),
      'origin' => 'https://git.key-tec.de/bakers-build/bakers-build/issues/20/',
    ]);
    $this->createEntity('bb_ticket', [
      'title' => 'on issue 200',
      'workflow' => 'bb_feature',
      'project_id' => $this->project('a')->id(),
      'origin' => 'https://git.key-tec.de/bakers-build/bakers-build/-/issues/200',
    ]);
    // Same key on a project the reader cannot read.
    $this->fixture('b', 'bb_ticket')
      ->set('origin', 'https://git.key-tec.de/bakers-build/bakers-build/-/issues/20')->save();
    Index::load('bb_tickets')->indexItems();

    $ids = $this->asReader(fn (TicketSearchResolver $resolver): array => $resolver->ticketIdsForOrigin('bakers-build/bakers-build#20'));
    sort($ids);
    self::assertSame([(int) $first->id(), (int) $second->id()], $ids);
  }

  /**
   * Identifier and title lookups also run on the ticket index.
   */
  public function testTicketIdsMatchIdentifierAndTitleOnTheIndex(): void {
    $ticket = $this->createEntity('bb_ticket', [
      'title' => 'Theme tokens for the rail',
      'workflow' => 'bb_feature',
      'project_id' => $this->project('a')->id(),
    ]);
    $ticket->set('identifier', 'BB-544')->save();
    Index::load('bb_tickets')->indexItems();

    $by_id = $this->asReader(fn (TicketSearchResolver $resolver): array => $resolver->ticketIds($resolver->resolve('BB-544')));
    $by_title = $this->asReader(fn (TicketSearchResolver $resolver): array => $resolver->ticketIds($resolver->resolve('rail')));
    self::assertSame([(int) $ticket->id()], $by_id);
    self::assertSame([(int) $ticket->id()], $by_title);
  }

  /**
   * Resolves the input as the reader.
   */
  private function resolveAs(string $input, ?BbProjectInterface $project = NULL): TicketSearchQuery {
    return $this->asReader(fn (TicketSearchResolver $resolver): TicketSearchQuery => $resolver->resolve($input, $project));
  }

  /**
   * Runs the callback with the resolver, switched to the reader.
   */
  private function asReader(callable $callback): mixed {
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($this->reader);
    $this->container->get('bb_core.workspace_read_scope')->reset();
    try {
      return $callback($this->container->get('bb_core.ticket_search_resolver'));
    }
    finally {
      $switcher->switchBack();
    }
  }

  /**
   * Lets the reader read workspace B's project too.
   */
  private function grantWorkspaceB(): void {
    $this->addMembership($this->fixture('b', 'bb_workspace'), $this->reader, ['member']);
    $this->addMembership($this->fixture('b', 'bb_team'), $this->reader, []);
  }

  /**
   * Sets the repository of one side's project.
   */
  private function setRepository(string $side, string $url): void {
    $this->project($side)->set('repository', ['url' => $url])->save();
  }

  /**
   * One side's project.
   */
  private function project(string $side): BbProjectInterface {
    $project = $this->fixture($side, 'bb_project');
    self::assertInstanceOf(BbProjectInterface::class, $project);
    return $project;
  }

}
