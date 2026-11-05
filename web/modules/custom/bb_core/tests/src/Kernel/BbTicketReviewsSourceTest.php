<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The sidebar Reviews block: Write a review and one state widget per review.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbTicketReviewsSourceTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use ReviewStateTrait;
  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'filter', 'island',
    'ui_patterns',
    'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_comment', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->installOgScopeFixture();
    $this->createUser();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * An assigned reviewer gets the block with Write a review and no entries.
   */
  public function testAssignedReviewerGetsWriteReviewOnly(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $block = $this->build($actors['ticket']);
    self::assertSame('bb_theme:zone', $block['#component'] ?? NULL);
    self::assertSame('Reviews', $block['#slots']['heading']['#plain_text'] ?? NULL);
    $write = $block['#slots']['actions']['write'] ?? [];
    self::assertSame('Write a review', $write['#props']['label'] ?? NULL);
    self::assertStringContainsString('/review/add', (string) ($write['#props']['href'] ?? ''));
    self::assertSame([], $this->entries($block));
  }

  /**
   * A reader without a visible review gets no block at all.
   */
  public function testNoBlockWithoutContentForTheViewer(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $this->createReview($actors['ticket'], $actors['reviewer']);
    foreach (['assignee', 'other'] as $name) {
      $this->setCurrentUser($actors[$name]);
      self::assertSame([], array_filter($this->build($actors['ticket']), static fn($key): bool => !str_starts_with((string) $key, '#'), ARRAY_FILTER_USE_KEY), $name);
    }
  }

  /**
   * The draft's author sees author, state widget with Submit, and Edit draft.
   */
  public function testDraftAuthorGetsSubmitAndEdit(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $draft = $this->createReview($actors['ticket'], $actors['reviewer']);
    $entry = $this->entries($this->build($actors['ticket']))[(string) $draft->id()] ?? [];
    self::assertSame('draft', (string) ($entry['#props']['attributes']['data-bakers-review'] ?? ''));
    self::assertSame('reviewer', $entry['#slots']['content']['author']['#props']['display_name'] ?? NULL);
    self::assertSame($this->formatted((int) $draft->get('changed')->value), $entry['#slots']['content']['author']['#props']['subtitle'] ?? NULL);
    self::assertSame(['submit'], $this->transitions($entry));
    self::assertSame('Draft', $this->widget($entry)['actions']['state']['#props']['label'] ?? NULL);
    self::assertStringContainsString('/comment/' . $draft->id() . '/review', (string) ($entry['#slots']['content']['controls']['#slots']['content']['edit']['#props']['href'] ?? ''));
  }

  /**
   * A submitted review: the assignee may Accept or Reject, the author nothing.
   */
  public function testAssigneeDecidesSubmittedReviewFromTheWidget(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $this->applyReviewTransition($review, 'submit');
    $review->save();

    $author = $this->entries($this->build($actors['ticket']))[(string) $review->id()] ?? [];
    self::assertSame([], $this->transitions($author));
    self::assertSame('Submitted', $this->widget($author)['actions']['state']['#props']['label'] ?? NULL);
    self::assertArrayNotHasKey('edit', $author['#slots']['content']['controls']['#slots']['content']);
    self::assertSame($this->formatted((int) $this->reloadReview($review)->get('submitted_at')->value), $author['#slots']['content']['author']['#props']['subtitle'] ?? NULL);

    $this->setCurrentUser($actors['assignee']);
    $assignee = $this->entries($this->build($actors['ticket']))[(string) $review->id()] ?? [];
    self::assertSame(['accept', 'reject'], $this->transitions($assignee));
    self::assertStringContainsString(
      '/comment/' . $review->id() . '/review/transition',
      (string) ($this->widget($assignee)['#action'] ?? ''),
    );

    $this->setCurrentUser($actors['other']);
    self::assertArrayNotHasKey((string) $review->id(), $this->entries($this->build($actors['ticket'])));
  }

  /**
   * A rejected review stays listed for its author and the assignee only.
   */
  public function testRejectedReviewStaysWithAuthorAndAssignee(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $this->setCurrentUser($actors['assignee']);
    $this->applyReviewTransition($review, 'reject');
    $review->save();

    foreach (['assignee', 'reviewer'] as $name) {
      $this->setCurrentUser($actors[$name]);
      $entry = $this->entries($this->build($actors['ticket']))[(string) $review->id()] ?? [];
      self::assertSame('Rejected', $this->widget($entry)['actions']['state']['#props']['label'] ?? NULL, $name);
      self::assertSame([], $this->transitions($entry));
    }
    $this->setCurrentUser($actors['other']);
    self::assertArrayNotHasKey((string) $review->id(), $this->entries($this->build($actors['ticket'])));
  }

  /**
   * An accepted review is listed for every reader, without actions.
   */
  public function testAcceptedReviewIsListedForReaders(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $this->setCurrentUser($actors['assignee']);
    $this->applyReviewTransition($review, 'accept');
    $review->save();

    $this->setCurrentUser($actors['other']);
    $entry = $this->entries($this->build($actors['ticket']))[(string) $review->id()] ?? [];
    self::assertSame('accepted', (string) ($entry['#props']['attributes']['data-bakers-review'] ?? ''));
    self::assertSame('Accepted', $this->widget($entry)['actions']['state']['#props']['label'] ?? NULL);
    self::assertSame('running', $this->widget($entry)['actions']['state']['#props']['tone'] ?? NULL, 'Accepted reads green.');
    self::assertSame([], $this->transitions($entry));
  }

  /**
   * An author who is also the assignee sees their submitted review once.
   */
  public function testAuthorAssigneeSeesTheReviewOnce(): void {
    $actors = $this->actors();
    $actors['ticket']->set('reviewers', [$actors['reviewer']->id(), $actors['assignee']->id()])->save();
    $this->setCurrentUser($actors['assignee']);
    $review = $this->createReview($actors['ticket'], $actors['assignee']);
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $entries = $this->entries($this->build($actors['ticket']));
    self::assertSame([(string) $review->id()], array_map('strval', array_keys($entries)));
    self::assertSame(['accept', 'reject'], $this->transitions($entries[(string) $review->id()]));
  }

  /**
   * A guest without a team still finds their own review on the ticket.
   */
  public function testTeamlessGuestAuthorSeesOwnReview(): void {
    $actors = $this->actors();
    $guest = $this->createUser(['view bb_comment', 'view bb_ticket'], 'teamless-guest');
    self::assertInstanceOf(UserInterface::class, $guest);
    $workspace = current($this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->loadByProperties(['slug' => 'ws-reviews']));
    self::assertInstanceOf(EntityInterface::class, $workspace);
    $this->addMembership($workspace, $guest, ['guest']);
    $actors['ticket']->set('reviewers', [$actors['reviewer']->id(), $guest->id()])->save();
    $this->setCurrentUser($guest);
    self::assertTrue($actors['ticket']->access('view', $guest));
    $draft = $this->createReview($actors['ticket'], $guest);
    self::assertArrayHasKey((string) $draft->id(), $this->entries($this->build($actors['ticket'])));
  }

  /**
   * The block's entries keyed by review id.
   *
   * @param array<string, mixed> $block
   *   The block render array.
   *
   * @return array<int|string, array<string, mixed>>
   *   The entries.
   */
  private function entries(array $block): array {
    return array_filter(
      $block['#slots']['content'] ?? [],
      static fn($key): bool => !str_starts_with((string) $key, '#'),
      ARRAY_FILTER_USE_KEY,
    );
  }

  /**
   * An entry's state widget.
   *
   * @param array<string, mixed> $entry
   *   One entry.
   *
   * @return array<string, mixed>
   *   The widget form.
   */
  private function widget(array $entry): array {
    return $entry['#slots']['content']['controls']['#slots']['content']['widget'] ?? [];
  }

  /**
   * A timestamp the way an entry shows it.
   */
  private function formatted(int $timestamp): string {
    return $this->container->get('bb_core.date')->label($timestamp);
  }

  /**
   * Reloads a review from storage.
   */
  private function reloadReview(BbCommentInterface $review): BbCommentInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_comment');
    $storage->resetCache([(string) $review->id()]);
    $reloaded = $storage->load($review->id());
    self::assertInstanceOf(BbCommentInterface::class, $reloaded);
    return $reloaded;
  }

  /**
   * The transition ids an entry's state widget offers.
   *
   * @param array<string, mixed> $entry
   *   One entry.
   *
   * @return list<string>
   *   The transition ids.
   */
  private function transitions(array $entry): array {
    $actions = $this->widget($entry)['actions'] ?? [];
    return array_values(array_map('strval', array_keys(array_filter($actions, static fn($button): bool => is_array($button) && isset($button['#transition'])))));
  }

  /**
   * Builds a workspace ticket with owner, assignee, reviewer and spare.
   *
   * @return array<string, mixed>
   *   Named accounts and the ticket.
   */
  private function actors(): array {
    $owner = $this->account('owner', ['update any bb_ticket']);
    $assignee = $this->account('assignee', ['update own bb_comment']);
    $reviewer = $this->account('reviewer', [
      'create bb_comment',
      'update own bb_comment',
      'delete own bb_comment',
    ]);
    $other = $this->account('other');
    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'ws', 'slug' => 'ws-reviews']);
    $workspace->save();
    $group = $this->container->get('entity_type.manager')
      ->getStorage('bb_group')
      ->create(['name' => 'g', 'workspace_id' => $workspace->id()]);
    $group->save();
    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => 't', 'workspace_id' => $workspace->id()]);
    $team->save();
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create([
        'name' => 'p',
        'group_id' => $group->id(),
        'teams' => [$team->id()],
      ]);
    $project->save();
    foreach ([$owner, $assignee, $other] as $account) {
      $this->addMembership($workspace, $account, ['contributor']);
      $this->addMembership($team, $account, ['member']);
    }
    $this->addMembership($workspace, $reviewer, ['guest']);
    $this->addMembership($team, $reviewer, ['member']);
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create([
        'title' => 'review-source',
        'workflow' => 'bb_work',
        'state' => 'todo',
        'project_id' => $project->id(),
        'owner_user_id' => $owner->id(),
        'assignee_user_id' => $assignee->id(),
        'reviewers' => [$reviewer->id()],
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return [
      'owner' => $owner,
      'assignee' => $assignee,
      'reviewer' => $reviewer,
      'other' => $other,
      'ticket' => $ticket,
    ];
  }

  /**
   * Creates a saved user with ticket and comment view.
   *
   * @param string $name
   *   Account name.
   * @param list<string> $extra
   *   Additional permissions.
   */
  private function account(string $name, array $extra = []): UserInterface {
    $account = $this->createUser([
      'view bb_ticket',
      'view bb_comment',
      ...$extra,
    ], $name);
    self::assertInstanceOf(UserInterface::class, $account);
    return $account;
  }

  /**
   * Creates a saved review draft.
   */
  private function createReview(BbTicketInterface $ticket, UserInterface $author): BbCommentInterface {
    $comment = $this->container->get('entity_type.manager')
      ->getStorage('bb_comment')
      ->create([
        'bundle' => 'review',
        'ticket_id' => $ticket->id(),
        'author' => $author->id(),
        'body' => ['value' => 'draft body', 'format' => 'plain_text'],
        'type' => 'comment',
      ]);
    self::assertInstanceOf(BbCommentInterface::class, $comment);
    $comment->save();
    return $comment;
  }

  /**
   * Renders the ticket reviews source for the current user.
   *
   * @return array<string, mixed>
   *   The slot payload.
   */
  private function build(BbTicketInterface $ticket): array {
    $schema = $this->container->get('plugin.manager.ui_patterns_prop_type')
      ->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance('bb_ticket_reviews', SourcePluginBase::buildConfiguration('slot', $schema, ['source' => []], []));
    self::assertInstanceOf(SourcePluginBase::class, $source);
    $source->setContextValue('entity', $ticket);
    $value = $source->getPropValue();
    self::assertIsArray($value);
    return $value;
  }

}
