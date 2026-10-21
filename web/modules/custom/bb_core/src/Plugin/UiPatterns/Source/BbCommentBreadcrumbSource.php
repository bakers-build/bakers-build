<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * Workspace → Ticket → Comment trail on the canonical comment page only.
 *
 * Empty on every other route so the shared page_header stays one title row.
 * The ticket crumb is omitted when the reader cannot view that ticket.
 */
#[Source(
  id: 'bb_comment_breadcrumb',
  label: new TranslatableMarkup('[bakers.build] Comment breadcrumb'),
  description: new TranslatableMarkup('Workspace, ticket and current comment crumbs on the comment page.'),
  prop_types: ['slot'],
)]
final class BbCommentBreadcrumbSource extends SourcePluginBase {

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    if ((string) $this->routeMatch->getRouteName() !== 'entity.bb_comment.canonical') {
      return $this->empty();
    }
    $comment = $this->routeMatch->getParameter('bb_comment');
    if (!$comment instanceof BbCommentInterface) {
      return $this->empty();
    }
    $workspace = $this->routeMatch->getParameter('bb_workspace');
    $items = [];
    $cache = new CacheableMetadata();
    $cache->addCacheableDependency($comment)->addCacheContexts(['url.path']);
    if ($workspace instanceof BbWorkspaceInterface) {
      $items[] = [
        'label' => (string) $workspace->label(),
        'url' => Url::fromRoute('view.tickets.my_work', [
          'bb_workspace' => $workspace->getSlug(),
        ])->toString(),
      ];
      $cache->addCacheableDependency($workspace);
    }
    $ticket = $comment->getTicket();
    if ($ticket instanceof BbTicketInterface) {
      $access = $ticket->access('view', NULL, TRUE);
      $cache->addCacheableDependency($access)->addCacheableDependency($ticket);
      if ($access->isAllowed()) {
        $label = $ticket->getIdentifier() !== '' ? $ticket->getIdentifier() : (string) $ticket->label();
        $items[] = [
          'label' => $label,
          'url' => $ticket->toUrl()->toString(),
        ];
      }
    }
    $items[] = ['label' => (string) new TranslatableMarkup('Comment')];
    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:breadcrumb',
      '#props' => ['items' => $items],
    ];
    $cache->applyTo($build);
    return $build;
  }

  /**
   * Cacheable empty result off the canonical comment route.
   *
   * @return array<string, mixed>
   *   A render array with no crumbs.
   */
  private function empty(): array {
    return [
      '#cache' => [
        'contexts' => ['url.path', 'route'],
      ],
    ];
  }

}
