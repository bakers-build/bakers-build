<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\BbCommentContextSource;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Previous/next comment selection: order, isolation, access, cache.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class CommentNavigationTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'filter', 'file', 'image',
    'markdown_easy', 'bb_core', 'bb_property_access_test',
    'display_builder', 'display_builder_entity_view',
    'ui_patterns', 'ui_patterns_field', 'ui_patterns_field_formatters',
  ];

  /**
   * Home ticket for the chain under test.
   */
  private BbTicketInterface $ticket;

  /**
   * A second ticket whose comments must never appear as neighbors.
   */
  private BbTicketInterface $foreign;

  /**
   * Comment author.
   */
  private UserInterface $author;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_workspace', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_comment', 'bb_run',
      'bb_conductor', 'bb_term', 'file',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->setUpCurrentUser(['uid' => 1], ['administer bakers']);

    $etm = $this->container->get('entity_type.manager');
    $workspace = $etm->getStorage('bb_workspace')->create([
      'name' => 'bakers.build',
      'slug' => 'bakers',
    ]);
    $workspace->save();
    $group = $etm->getStorage('bb_group')->create([
      'name' => 'bakers.build group',
      'workspace_id' => $workspace->id(),
    ]);
    $group->save();
    $project = $etm->getStorage('bb_project')->create([
      'name' => 'bakers.build',
      'key' => 'bakers.build',
      'group_id' => $group->id(),
    ]);
    $project->save();
    $this->ticket = $this->ticket('Home', $project->id(), 'BB-1');
    $this->foreign = $this->ticket('Foreign', $project->id(), 'BB-2');
    $author = $this->createUser([], 'Nav Author');
    self::assertInstanceOf(UserInterface::class, $author);
    $this->author = $author;
    $this->container->get('theme_installer')->install(['bb_theme']);
  }

  /**
   * First, middle, last and single comments expose the exact neighbor UUIDs.
   */
  public function testFirstMiddleLastAndSingleNeighborUuids(): void {
    $first = $this->comment($this->ticket, 'spec', 100);
    $middle = $this->comment($this->ticket, 'summary', 200);
    $last = $this->comment($this->ticket, 'handoff-v3', 300);
    $this->comment($this->foreign, 'spec', 250);

    self::assertSame([NULL, $middle->uuid()], $this->neighborUuids($first));
    self::assertSame([$first->uuid(), $last->uuid()], $this->neighborUuids($middle));
    self::assertSame([$middle->uuid(), NULL], $this->neighborUuids($last));

    $lonely = $this->comment(
      $this->ticket('Single', $this->ticket->get('project_id')->target_id, 'BB-3'),
      'comment',
      10,
    );
    self::assertSame([NULL, NULL], $this->neighborUuids($lonely));
  }

  /**
   * Equal timestamps order by numeric id ASC.
   */
  public function testEqualTimestampsOrderByNumericId(): void {
    $a = $this->comment($this->ticket, 'spec', 500);
    $b = $this->comment($this->ticket, 'summary', 500);
    $c = $this->comment($this->ticket, 'test', 500);
    self::assertLessThan((int) $b->id(), (int) $a->id());
    self::assertLessThan((int) $c->id(), (int) $b->id());
    self::assertSame([NULL, $b->uuid()], $this->neighborUuids($a));
    self::assertSame([$a->uuid(), $c->uuid()], $this->neighborUuids($b));
    self::assertSame([$b->uuid(), NULL], $this->neighborUuids($c));
  }

  /**
   * A comment the reader may not view is skipped, not named.
   */
  public function testDeniedTargetsAreSkipped(): void {
    $first = $this->comment($this->ticket, 'spec', 100);
    $hidden = $this->comment($this->ticket, 'summary', 200);
    $last = $this->comment($this->ticket, 'test', 300);
    $this->container->get('state')->set('bb_property_access_test.denied_comments', [(int) $hidden->id()]);

    self::assertSame([NULL, $last->uuid()], $this->neighborUuids($first));
    $html = $this->renderContext($first);
    self::assertStringNotContainsString($hidden->uuid(), $html);
    self::assertStringNotContainsString('summary', $html);
  }

  /**
   * Appending a comment after a terminal one invalidates the empty next link.
   */
  public function testAppendInvalidatesCachedTerminalLink(): void {
    $only = $this->comment($this->ticket, 'spec', 100);
    $build = $this->contextSource($only)->getPropValue();
    self::assertIsArray($build);
    self::assertContains('bb_ticket:' . $this->ticket->id(), $build['#cache']['tags'] ?? []);
    self::assertSame([NULL, NULL], $this->neighborUuids($only));

    $next = $this->comment($this->ticket, 'summary', 200);
    self::assertSame([NULL, $next->uuid()], $this->neighborUuids($only));
  }

  /**
   * A denied ticket discloses neither its metadata nor sibling links.
   */
  public function testDeniedTicketHidesMetadataAndSiblingLinks(): void {
    $this->comment($this->ticket, 'spec', 100);
    $target = $this->comment($this->ticket, 'summary', 200);
    $this->comment($this->ticket, 'test', 300);
    $this->container->get('state')->set('bb_property_access_test.denied_tickets', [(int) $this->ticket->id()]);

    $build = $this->contextSource($target)->getPropValue();
    self::assertIsArray($build);
    self::assertArrayNotHasKey('ticket', $build);
    self::assertArrayNotHasKey('comments', $build);
  }

  /**
   * Creates a ticket in the fixture project.
   */
  private function ticket(string $title, int|string $project_id, string $identifier): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create([
        'title' => $title,
        'project_id' => $project_id,
        'identifier' => $identifier,
        'workflow' => 'bb_feature',
        'state' => 'coding',
      ]);
    $ticket->save();
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Creates a comment on a ticket at a created timestamp.
   */
  private function comment(BbTicketInterface $ticket, string $type, int $created): BbCommentInterface {
    $comment = $this->container->get('entity_type.manager')
      ->getStorage('bb_comment')
      ->create([
        'ticket_id' => $ticket->id(),
        'author' => $this->author->id(),
        'body' => ['value' => $type . ' body', 'format' => 'bb_rich'],
        'type' => $type,
      ]);
    self::assertInstanceOf(BbCommentInterface::class, $comment);
    $comment->setCreatedTime($created);
    $comment->save();
    return $comment;
  }

  /**
   * Previous and next UUIDs for a comment, or NULL when that side is empty.
   *
   * @return array{0: ?string, 1: ?string}
   *   Previous UUID, next UUID.
   */
  private function neighborUuids(BbCommentInterface $comment): array {
    $links = $this->navLinks($comment);
    $prev = $next = NULL;
    foreach ($links as $link) {
      $title = (string) ($link['title'] ?? '');
      $url = (string) ($link['url'] ?? '');
      if (str_starts_with($title, 'Previous:')) {
        $prev = $this->uuidFromUrl($url);
      }
      if (str_starts_with($title, 'Next:')) {
        $next = $this->uuidFromUrl($url);
      }
    }
    return [$prev, $next];
  }

  /**
   * Link-group rows from the comments zone.
   *
   * @return list<array{url?: string, title?: string}>
   *   The previous/next links.
   */
  private function navLinks(BbCommentInterface $comment): array {
    $build = $this->contextSource($comment)->getPropValue();
    if (!is_array($build)) {
      return [];
    }
    $zone = $build['comments'] ?? [];
    $content = $zone['#slots']['content'] ?? [];
    return $content['#props']['links'] ?? [];
  }

  /**
   * The UUID segment of a comment canonical URL.
   */
  private function uuidFromUrl(string $url): string {
    if (preg_match('/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/', $url, $match) !== 1) {
      self::fail('Neighbor URL does not carry a UUID: ' . $url);
    }
    return $match[0];
  }

  /**
   * Renders the context source for a comment.
   */
  private function renderContext(BbCommentInterface $comment): string {
    $build = $this->contextSource($comment)->getPropValue();
    self::assertIsArray($build);
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Instantiates the comment context source bound to one comment.
   */
  private function contextSource(BbCommentInterface $comment): BbCommentContextSource {
    $definition = $this->container->get('plugin.manager.ui_patterns_prop_type')
      ->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance(
        'bb_comment_context',
        SourcePluginBase::buildConfiguration('content', $definition, ['source' => []], []),
      );
    self::assertInstanceOf(BbCommentContextSource::class, $source);
    $source->setContextValue('entity', $comment);
    return $source;
  }

}
