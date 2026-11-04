<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Cache\RefinableCacheableDependencyInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Url;
use Drupal\bb_core\Navigation\AccountWorkspaceContext;

/**
 * Preserves the validated origin between the account's own tabs.
 */
final class AccountNavigationHooks {

  public function __construct(
    private readonly AccountWorkspaceContext $workspaceContext,
  ) {}

  /**
   * Implements hook_menu_local_tasks_alter().
   *
   * @param array<string, mixed> $data
   *   The local tasks.
   * @param string $route_name
   *   The current route name.
   * @param \Drupal\Core\Cache\RefinableCacheableDependencyInterface $cacheability
   *   Cache metadata for the local tasks.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  #[Hook('menu_local_tasks_alter')]
  public function alterLocalTasks(array &$data, string $route_name, RefinableCacheableDependencyInterface &$cacheability): void {
    $cache = new CacheableMetadata();
    $workspace = $this->workspaceContext->resolve($cache);
    $cacheability->addCacheableDependency($cache);
    if (!$this->workspaceContext->isOwnProfile()) {
      return;
    }
    if (!isset($data['tabs'])) {
      return;
    }
    foreach ($data['tabs'] as &$tabs) {
      foreach ($tabs as &$tab) {
        $url = $tab['#link']['url'] ?? NULL;
        if (!$url instanceof Url || !$url->isRouted()
          || !in_array($url->getRouteName(), AccountWorkspaceContext::ROUTES, TRUE)) {
          continue;
        }
        $query = $url->getOption('query') ?? [];
        unset($query['workspace']);
        if ($workspace !== NULL) {
          $query['workspace'] = $workspace->uuid();
        }
        $tab['#link']['url'] = (clone $url)->setOption('query', $query);
      }
    }
  }

}
