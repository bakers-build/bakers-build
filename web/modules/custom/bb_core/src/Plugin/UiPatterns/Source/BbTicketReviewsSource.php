<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Form\BbReviewCommentForm;
use Drupal\bb_core\Form\ReviewStateTransitionForm;
use Drupal\bb_core\Time\BbDate;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The ticket sidebar's Reviews block: Write a review and one state widget each.
 *
 * Renders only when the viewer may write a review or see at least one.
 */
#[Source(
  id: 'bb_ticket_reviews',
  label: new TranslatableMarkup('[bakers.build] Ticket reviews'),
  description: new TranslatableMarkup('Write a review and every review the viewer may see, each with its state widget.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket', label: new TranslatableMarkup('Ticket'), required: TRUE),
  ],
)]
final class BbTicketReviewsSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * The current account.
   */
  private AccountInterface $currentUser;

  /**
   * Loads the viewer's own reviews.
   */
  private EntityStorageInterface $storage;

  /**
   * Builds each review's state widget.
   */
  private FormBuilderInterface $formBuilder;

  /**
   * Formats each review's time.
   */
  private BbDate $date;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->currentUser = $container->get('current_user');
    $instance->storage = $container->get('entity_type.manager')->getStorage('bb_comment');
    $instance->formBuilder = $container->get('form_builder');
    $instance->date = $container->get(BbDate::class);
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $ticket = $this->ticket();
    if ($ticket === NULL) {
      return [];
    }
    $cache = CacheableMetadata::createFromObject($ticket)
      ->addCacheContexts(['user'])
      ->addCacheTags(['bb_comment_list']);
    $write = Url::fromRoute('entity.bb_comment.review_add', $ticket->toUrl()->getRouteParameters());
    $write_access = $write->access($this->currentUser, TRUE);
    $cache->addCacheableDependency($write_access);
    $entries = [];
    foreach ($this->visibleReviews($ticket) as $id => $review) {
      $entries[$id] = $this->entry($ticket, $review);
    }
    $build = [];
    if ($entries !== [] || $write_access->isAllowed()) {
      $build = [
        '#type' => 'component',
        '#component' => 'bb_theme:zone',
        '#props' => ['inset' => 'none', 'gap' => 'sm', 'columns' => 1],
        '#slots' => [
          'heading' => ['#plain_text' => (string) $this->t('Reviews')],
          'content' => $entries,
        ],
      ];
      if ($write_access->isAllowed()) {
        $build['#slots']['actions']['write'] = BbReviewCommentForm::dialogTrigger((string) $this->t('Write a review'), $write);
      }
    }
    $cache->applyTo($build);
    return $build;
  }

  /**
   * Every review of the ticket the viewer may see, oldest first.
   *
   * The viewer's own unpublished reviews, the submitted and rejected ones of
   * the current assignee, and the accepted ones. Each is entity-checked: the
   * list scope is project-based, and a guest reviewer with no team has none.
   *
   * @return array<int|string, \Drupal\bb_core\Entity\BbCommentInterface>
   *   Reviews keyed by id.
   */
  private function visibleReviews(BbTicketInterface $ticket): array {
    $query = $this->storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('bundle', 'review')
      ->condition('ticket_id', $ticket->id());
    $visible = $query->orConditionGroup()
      ->condition('status', 1)
      ->condition($query->andConditionGroup()
        ->condition('author', $this->currentUser->id())
        ->condition('status', 0));
    if ((int) $ticket->get('assignee_user_id')->target_id === (int) $this->currentUser->id()) {
      $visible->condition($query->andConditionGroup()
        ->condition('status', 0)
        ->condition('review_state', ['submitted', 'rejected'], 'IN'));
    }
    $ids = $query->condition($visible)->execute();
    $reviews = [];
    foreach ($this->storage->loadMultiple($ids) as $id => $review) {
      if ($review instanceof BbCommentInterface && $review->access('view', $this->currentUser)) {
        $reviews[$id] = $review;
      }
    }
    $order = static fn(BbCommentInterface $review): array => [
      (int) $review->get('created')->value,
      (int) $review->id(),
    ];
    uasort($reviews, static fn(BbCommentInterface $a, BbCommentInterface $b): int => $order($a) <=> $order($b));
    return $reviews;
  }

  /**
   * One compact entry: who wrote it and when, then its state widget.
   *
   * The time is the one the current state was reached at: saved for a draft,
   * submitted, or decided. A draft adds Edit draft beside the widget.
   *
   * @return array<string, mixed>
   *   The entry render array.
   */
  private function entry(BbTicketInterface $ticket, BbCommentInterface $review): array {
    $state = (string) $review->get('review_state')->value;
    $author = $review->get('author')->entity;
    $known = $author !== NULL && $author->access('view label', $this->currentUser);
    $time = match ($state) {
      'draft' => $review->get('changed')->value,
      'submitted' => $review->get('submitted_at')->value,
      default => $review->get('decided_at')->value,
    } ?? $review->get('created')->value;
    $controls = ['widget' => $this->formBuilder->getForm(ReviewStateTransitionForm::forReview($review))];
    if ($state === 'draft' && $review->access('update', $this->currentUser)) {
      $controls['edit'] = BbReviewCommentForm::dialogTrigger(
        (string) $this->t('Edit draft'),
        $this->reviewFormUrl($ticket, (string) $review->id()),
      );
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => [
        'inset' => 'none',
        'gap' => 'sm',
        'columns' => 1,
        'attributes' => ['data-bakers-review' => $state],
      ],
      '#slots' => [
        'content' => [
          'author' => [
            '#type' => 'component',
            '#component' => 'bb_theme:person',
            '#props' => [
              'variant' => 'full',
              'size' => 'sm',
              'display_name' => $known ? (string) $author->label() : (string) $this->t('Unknown author'),
              'initials' => $known ? (string) $review->get('author_initials')->value : '?',
              'color' => $known ? (string) $review->get('author_color')->value : 'offline',
            ] + $this->subtitle((int) $time),
          ],
          'controls' => [
            '#type' => 'component',
            '#component' => 'bb_theme:zone',
            '#props' => ['inset' => 'none', 'gap' => 'sm', 'direction' => 'row'],
            '#slots' => ['content' => $controls],
          ],
        ],
      ],
    ];
  }

  /**
   * The person's subtitle props for the review's time.
   *
   * @return array{subtitle: string, subtitle_datetime: string, subtitle_title: string}
   *   The label and its exact instant.
   */
  private function subtitle(int $timestamp): array {
    $time = $this->date->cell($timestamp);
    return [
      'subtitle' => $time['label'],
      'subtitle_datetime' => $time['datetime'],
      'subtitle_title' => $time['title'],
    ];
  }

  /**
   * The review form of one review, in the ticket's workspace.
   */
  private function reviewFormUrl(BbTicketInterface $ticket, string $id): Url {
    return Url::fromRoute('entity.bb_comment.review_form', [
      'bb_workspace' => $ticket->toUrl()->getRouteParameters()['bb_workspace'] ?? NULL,
      'bb_comment' => $id,
    ]);
  }

  /**
   * Returns the ticket context, if present.
   */
  private function ticket(): ?BbTicketInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    return $entity instanceof BbTicketInterface ? $entity : NULL;
  }

}
