<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Ticket state/link and previous/next comments for the canonical inspector.
 *
 * Returns SDC render arrays only. Neighbours are the nearest accessible
 * comments on the same ticket, ordered by created then numeric id ascending.
 */
#[Source(
  id: 'bb_comment_context',
  label: new TranslatableMarkup('[bakers.build] Comment context'),
  description: new TranslatableMarkup('Owning ticket and previous/next comments for the canonical inspector.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_comment', label: new TranslatableMarkup('Comment'), required: TRUE),
  ],
)]
final class BbCommentContextSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * Loads sibling comments on the same ticket.
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->entityTypeManager = $container->get('entity_type.manager');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $comment = $this->comment();
    if ($comment === NULL) {
      return [];
    }
    $ticket = $comment->getTicket();
    $cache = CacheableMetadata::createFromRenderArray([])
      ->addCacheableDependency($comment)
      ->addCacheContexts(['user']);
    $build = [];
    if (!$ticket instanceof BbTicketInterface) {
      $cache->applyTo($build);
      return $build;
    }
    $ticket_access = $ticket->access('view', NULL, TRUE);
    $cache->addCacheableDependency($ticket)->addCacheableDependency($ticket_access);
    if ($ticket_access->isAllowed()) {
      $build = array_filter([
        'ticket' => $this->ticketZone($ticket),
        'comments' => $this->commentsZone($comment),
      ]);
    }
    $cache->applyTo($build);
    return $build;
  }

  /**
   * Ticket badge and canonical link.
   *
   * @return array<string, mixed>
   *   The ticket zone, or empty.
   */
  private function ticketZone(BbTicketInterface $ticket): array {
    $access = $ticket->access('view', NULL, TRUE);
    if (!$access->isAllowed()) {
      return [];
    }
    $state = (string) ($ticket->get('state')->value ?? '');
    $label = $ticket->getIdentifier() !== '' ? $ticket->getIdentifier() : (string) $ticket->label();
    $content = [
      'badge' => [
        '#type' => 'component',
        '#component' => 'bb_theme:badge',
        '#props' => [
          'label' => $state !== '' ? $state : $label,
          'tone' => $this->ticketTone($ticket, $state),
          'dot' => TRUE,
        ],
      ],
      'link' => [
        '#type' => 'component',
        '#component' => 'bb_theme:link-group',
        '#props' => [
          'label' => (string) $this->t('Ticket'),
          'links' => [
            [
              'url' => $ticket->toUrl()->toString(),
              'title' => $label,
              'target' => '_self',
            ],
          ],
        ],
      ],
    ];
    $build = $this->zone((string) $this->t('Ticket'), $content);
    CacheableMetadata::createFromRenderArray($build)
      ->addCacheableDependency($ticket)
      ->addCacheableDependency($access)
      ->applyTo($build);
    return $build;
  }

  /**
   * Previous and next comments on the same ticket, when any exist.
   *
   * @return array<string, mixed>
   *   The comments zone, or empty when no neighbour is visible.
   */
  private function commentsZone(BbCommentInterface $comment): array {
    [$previous, $next] = $this->neighbors($comment);
    $links = [];
    if ($previous instanceof BbCommentInterface) {
      $links[] = [
        'url' => $previous->toUrl()->toString(),
        'title' => (string) $this->t('Previous: @type', [
          '@type' => (string) $previous->get('type')->value,
        ]),
        'target' => '_self',
      ];
    }
    if ($next instanceof BbCommentInterface) {
      $links[] = [
        'url' => $next->toUrl()->toString(),
        'title' => (string) $this->t('Next: @type', [
          '@type' => (string) $next->get('type')->value,
        ]),
        'target' => '_self',
      ];
    }
    if ($links === []) {
      return [];
    }
    return $this->zone((string) $this->t('Comments'), [
      '#type' => 'component',
      '#component' => 'bb_theme:link-group',
      '#props' => [
        'label' => (string) $this->t('On this ticket'),
        'links' => $links,
      ],
    ]);
  }

  /**
   * Nearest accessible previous and next comments on the same ticket.
   *
   * @return array{0: ?BbCommentInterface, 1: ?BbCommentInterface}
   *   Previous then next; either may be NULL.
   */
  private function neighbors(BbCommentInterface $comment): array {
    $ticket_id = $comment->getTicketId();
    if ($ticket_id === NULL) {
      return [NULL, NULL];
    }
    // ponytail: loads and access-checks every comment on the ticket on each
    // cold render; switch to two ranged previous/next queries if large
    // tickets make this measurably slow.
    $ids = $this->entityTypeManager->getStorage('bb_comment')->getQuery()
      ->accessCheck(TRUE)
      ->condition('ticket_id', $ticket_id)
      ->sort('created', 'ASC')
      ->sort('id', 'ASC')
      ->execute();
    $visible = [];
    foreach ($this->entityTypeManager->getStorage('bb_comment')->loadMultiple($ids) as $candidate) {
      if ($candidate instanceof BbCommentInterface && $candidate->access('view')) {
        $visible[] = $candidate;
      }
    }
    foreach ($visible as $index => $candidate) {
      if ((int) $candidate->id() === (int) $comment->id()) {
        return [$visible[$index - 1] ?? NULL, $visible[$index + 1] ?? NULL];
      }
    }
    return [NULL, NULL];
  }

  /**
   * Badge tone from the ticket workflow phase.
   */
  private function ticketTone(BbTicketInterface $ticket, string $state): string {
    $workflow = $ticket->getWorkflow();
    if ($workflow === '' || $state === '') {
      return 'neutral';
    }
    try {
      return match (TypeWorkflows::phase($workflow, $state)) {
        'running' => 'running',
        'prepare' => 'lease',
        default => 'neutral',
      };
    }
    catch (\LogicException) {
      return 'neutral';
    }
  }

  /**
   * A zone whose content is the given render array.
   *
   * @param string $heading
   *   The zone heading.
   * @param array<string, mixed> $content
   *   The body.
   *
   * @return array<string, mixed>
   *   The zone.
   */
  private function zone(string $heading, array $content): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => ['inset' => 'none', 'gap' => 'sm', 'columns' => 1],
      '#slots' => [
        'heading' => ['#plain_text' => $heading],
        'content' => $content,
      ],
    ];
  }

  /**
   * The comment this display is rendering, or NULL off a comment.
   */
  private function comment(): ?BbCommentInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    return $entity instanceof BbCommentInterface ? $entity : NULL;
  }

}
