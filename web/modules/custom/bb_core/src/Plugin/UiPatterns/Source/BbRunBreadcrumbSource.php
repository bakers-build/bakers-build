<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Routing\BbRunRouteProvider;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * Workspace → Ticket → Run trail on the canonical run page only.
 *
 * Empty on every other route so the shared page_header stays one title row.
 */
#[Source(
  id: 'bb_run_breadcrumb',
  label: new TranslatableMarkup('[bakers.build] Run breadcrumb'),
  description: new TranslatableMarkup('Workspace, ticket and current run crumbs on the run page.'),
  prop_types: ['slot'],
)]
final class BbRunBreadcrumbSource extends SourcePluginBase {

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    if ((string) $this->routeMatch->getRouteName() !== 'entity.bb_run.canonical') {
      return [
        '#cache' => [
          'contexts' => ['url.path', 'route'],
        ],
      ];
    }
    $run = $this->routeMatch->getParameter('bb_run');
    $ticket = $this->routeMatch->getParameter('bb_ticket');
    $workspace = $this->routeMatch->getParameter('bb_workspace');
    if (!$run instanceof BbRunInterface || !$ticket instanceof BbTicketInterface) {
      return [
        '#cache' => [
          'contexts' => ['url.path', 'route'],
        ],
      ];
    }
    $items = [];
    if ($workspace instanceof BbWorkspaceInterface) {
      $items[] = [
        'label' => (string) $workspace->label(),
        'url' => Url::fromRoute('view.tickets.my_work', [
          'bb_workspace' => $workspace->getSlug(),
        ])->toString(),
      ];
    }
    $ticket_label = $ticket->getIdentifier() !== '' ? $ticket->getIdentifier() : (string) $ticket->label();
    $items[] = [
      'label' => $ticket_label,
      'url' => $ticket->toUrl()->toString(),
    ];
    $items[] = ['label' => BbRunRouteProvider::title($run)];
    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:breadcrumb',
      '#props' => ['items' => $items],
    ];
    $cache = CacheableMetadata::createFromRenderArray($build)
      ->addCacheableDependency($run)
      ->addCacheableDependency($ticket)
      ->addCacheContexts(['url.path']);
    if ($workspace instanceof BbWorkspaceInterface) {
      $cache->addCacheableDependency($workspace);
    }
    $cache->applyTo($build);
    return $build;
  }

}
