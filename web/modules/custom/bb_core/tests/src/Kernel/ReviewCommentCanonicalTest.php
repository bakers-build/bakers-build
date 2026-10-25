<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Datetime\Entity\DateFormat;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Reviews on the comment canonical page, its teaser and the UUID routes.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ReviewCommentCanonicalTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use ReviewStateTrait;
  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine', 'views',
    'field', 'og', 'link', 'text', 'filter', 'file', 'image',
    'markdown_easy', 'bb_core', 'island',
    'display_builder', 'display_builder_entity_view',
    'ui_patterns', 'ui_patterns_field', 'ui_patterns_field_formatters',
  ];

  /**
   * The workspace the ticket belongs to.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * The ticket under review.
   */
  private BbTicketInterface $ticket;

  /**
   * Named accounts: assignee, reviewer, reader.
   *
   * @var array<string, \Drupal\user\UserInterface>
   */
  private array $actors = [];

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
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_workspace', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_comment', 'bb_run',
      'bb_conductor', 'bb_term', 'file',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    $this->installConfig(['system', 'user', 'display_builder']);
    DateFormat::create([
      'id' => 'normal',
      'label' => 'Normal',
      'pattern' => 'j M Y, H:i',
      'status' => TRUE,
    ])->save();
    $this->installCommentDisplays();
    $this->installOgScopeFixture();
    $this->createUser();
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);

    $etm = $this->container->get('entity_type.manager');
    $assignee = $this->account('assignee', ['update own bb_comment']);
    $reviewer = $this->account('reviewer', ['create bb_comment', 'update own bb_comment']);
    $reader = $this->account('reader');
    $workspace = $etm->getStorage('bb_workspace')->create(['name' => 'ws', 'slug' => 'ws-reviews']);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $group = $etm->getStorage('bb_group')->create(['name' => 'g', 'workspace_id' => $workspace->id()]);
    $group->save();
    $team = $etm->getStorage('bb_team')->create(['name' => 't', 'workspace_id' => $workspace->id()]);
    $team->save();
    $project = $etm->getStorage('bb_project')->create([
      'name' => 'p',
      'key' => 'REV',
      'group_id' => $group->id(),
      'teams' => [$team->id()],
    ]);
    $project->save();
    foreach ([$assignee, $reader] as $account) {
      $this->addMembership($workspace, $account, ['contributor']);
      $this->addMembership($team, $account, ['member']);
    }
    $this->addMembership($workspace, $reviewer, ['guest']);
    $this->addMembership($team, $reviewer, ['member']);
    $ticket = $etm->getStorage('bb_ticket')->create([
      'title' => 'review-canonical',
      'workflow' => 'bb_work',
      'state' => 'review',
      'project_id' => $project->id(),
      'number' => 7,
      'identifier' => 'REV-7',
      'assignee_user_id' => $assignee->id(),
      'reviewers' => [$reviewer->id()],
    ]);
    $ticket->save();
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $this->workspace = $workspace;
    $this->ticket = $ticket;
    $this->actors = ['assignee' => $assignee, 'reviewer' => $reviewer, 'reader' => $reader];
  }

  /**
   * Edit draft and the state widget resolve a review by UUID and by id.
   */
  public function testReviewRoutesResolveUuidAndId(): void {
    $this->setCurrentUser($this->actors['reviewer']);
    $review = $this->createReview();
    $router = $this->container->get('router.no_access_checks');
    foreach (['/review', '/review/transition'] as $suffix) {
      foreach ([$review->uuid(), (string) $review->id()] as $key) {
        $match = $router->match('/ws-reviews/comment/' . $key . $suffix);
        $resolved = $match['bb_comment'] ?? NULL;
        self::assertInstanceOf(BbCommentInterface::class, $resolved, $suffix . ' ' . $key);
        self::assertSame((string) $review->id(), (string) $resolved->id());
      }
    }
  }

  /**
   * A reader is denied the canonical page until the review is accepted.
   */
  public function testReaderGetsCanonicalOnlyOnceAccepted(): void {
    $this->setCurrentUser($this->actors['reviewer']);
    $review = $this->createReview();
    self::assertFalse($this->canonicalAccess($review, 'reader'), 'draft');
    self::assertTrue($this->canonicalAccess($review, 'reviewer'), 'own draft');
    self::assertFalse($this->canonicalAccess($review, 'assignee'), 'draft, assignee');

    $this->applyReviewTransition($review, 'submit');
    $review->save();
    self::assertFalse($this->canonicalAccess($review, 'reader'), 'submitted');
    self::assertTrue($this->canonicalAccess($review, 'assignee'), 'submitted, assignee');

    $this->setCurrentUser($this->actors['assignee']);
    $this->applyReviewTransition($review, 'accept');
    $review->save();
    self::assertTrue($this->canonicalAccess($review, 'reader'), 'accepted');
  }

  /**
   * A rejected review stays closed to the reader.
   */
  public function testReaderStaysDeniedOnceRejected(): void {
    $this->setCurrentUser($this->actors['reviewer']);
    $review = $this->createReview();
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $this->setCurrentUser($this->actors['assignee']);
    $this->applyReviewTransition($review, 'reject');
    $review->save();
    self::assertFalse($this->canonicalAccess($review, 'reader'), 'rejected');
    self::assertTrue($this->canonicalAccess($review, 'assignee'), 'rejected, assignee');
  }

  /**
   * A comment's previous/next links skip a review the reader may not see.
   */
  public function testNeighborLinksSkipPrivateReviews(): void {
    $etm = $this->container->get('entity_type.manager');
    $first = $etm->getStorage('bb_comment')->create([
      'ticket_id' => $this->ticket->id(),
      'author' => $this->actors['assignee']->id(),
      'body' => ['value' => 'first', 'format' => 'bb_rich'],
      'type' => 'spec',
    ]);
    self::assertInstanceOf(BbCommentInterface::class, $first);
    $first->setCreatedTime(1782834600);
    $first->save();
    $this->setCurrentUser($this->actors['reviewer']);
    $review = $this->createReview();
    $review->setCreatedTime(1782834700);
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $this->setCurrentUser($this->actors['assignee']);
    $last = $etm->getStorage('bb_comment')->create([
      'ticket_id' => $this->ticket->id(),
      'author' => $this->actors['assignee']->id(),
      'body' => ['value' => 'last', 'format' => 'bb_rich'],
      'type' => 'test',
    ]);
    self::assertInstanceOf(BbCommentInterface::class, $last);
    $last->setCreatedTime(1782834800);
    $last->save();

    $this->setCurrentUser($this->actors['reader']);
    $html = $this->renderMode($first, 'full');
    self::assertStringNotContainsString($review->uuid(), $html);
    self::assertStringContainsString($last->uuid(), $html);
  }

  /**
   * An accepted review renders as a Handoffs teaser and a framed full page.
   */
  public function testAcceptedReviewRendersTeaserAndFramedFull(): void {
    $this->setCurrentUser($this->actors['reviewer']);
    $review = $this->createReview();
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $this->setCurrentUser($this->actors['assignee']);
    $this->applyReviewTransition($review, 'accept');
    $review->save();
    $this->setCurrentUser($this->actors['reader']);

    $teaser = $this->renderMode($review, 'teaser');
    self::assertStringContainsString('REVIEW-BODY-MARKER', $teaser);
    self::assertStringContainsString('data-component-id="bb_theme:link-group"', $teaser);
    self::assertStringContainsString($review->toUrl()->toString(), $teaser);

    $full = $this->renderMode($review, 'full');
    self::assertStringContainsString('REVIEW-BODY-MARKER', $full);
    self::assertStringContainsString('data-component-id="bb_theme:canvas"', $full);
    self::assertStringContainsString('data-component-id="bb_theme:inspector"', $full);
    self::assertStringContainsString('REV-7', $full);
  }

  /**
   * Whether an actor may open the review's canonical page.
   */
  private function canonicalAccess(BbCommentInterface $review, string $actor): bool {
    $this->container->get('entity_type.manager')->getAccessControlHandler('bb_comment')->resetCache();
    return $this->container->get('access_manager')->checkNamedRoute(
      'entity.bb_comment.canonical',
      ['bb_workspace' => $this->workspace->getSlug(), 'bb_comment' => $review->uuid()],
      $this->actors[$actor],
    );
  }

  /**
   * Creates a saved review draft by the reviewer.
   */
  private function createReview(): BbCommentInterface {
    $comment = $this->container->get('entity_type.manager')->getStorage('bb_comment')->create([
      'bundle' => 'review',
      'ticket_id' => $this->ticket->id(),
      'author' => $this->actors['reviewer']->id(),
      'body' => ['value' => 'REVIEW-BODY-MARKER', 'format' => 'bb_rich'],
      'type' => 'comment',
    ]);
    self::assertInstanceOf(BbCommentInterface::class, $comment);
    $comment->save();
    return $comment;
  }

  /**
   * Renders a comment in a shipped view mode.
   */
  private function renderMode(BbCommentInterface $comment, string $mode): string {
    $build = $this->container->get('entity_type.manager')->getViewBuilder('bb_comment')->view($comment, $mode);
    return (string) $this->container->get('renderer')->renderInIsolation($build);
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
    $account = $this->createUser(['view bb_ticket', 'view bb_comment', ...$extra], $name);
    self::assertInstanceOf(UserInterface::class, $account);
    return $account;
  }

  /**
   * Installs the comment view modes and the displays of both bundles.
   */
  private function installCommentDisplays(): void {
    $module = $this->container->get('extension.list.module')->getPath('bb_core');
    $recipe = dirname(DRUPAL_ROOT) . '/recipes/bakers/config';
    $target = $this->container->get('config.storage');
    foreach ([
      'filter.format.bb_rich' => $module . '/config/install',
      'core.entity_view_mode.bb_comment.full' => $module . '/config/optional',
      'core.entity_view_mode.bb_comment.teaser' => $module . '/config/optional',
      'core.entity_view_display.bb_comment.bb_comment.full' => $recipe,
      'core.entity_view_display.bb_comment.bb_comment.teaser' => $recipe,
      'core.entity_view_display.bb_comment.review.full' => $recipe,
      'core.entity_view_display.bb_comment.review.teaser' => $recipe,
    ] as $name => $directory) {
      $file = $directory . '/' . $name . '.yml';
      self::assertFileExists($file, sprintf('%s ships.', $name));
      $data = Yaml::decode((string) file_get_contents($file));
      $data['uuid'] = $this->container->get('uuid')->generate();
      $target->write($name, $data);
    }
  }

}
