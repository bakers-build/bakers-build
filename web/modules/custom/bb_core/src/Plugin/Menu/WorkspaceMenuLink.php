<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Menu;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Menu\MenuLinkDefault;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Navigation\AccountWorkspaceContext;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * A menu link whose `bb_workspace` route parameter is the ambient workspace.
 *
 * The workspace is request context, never stored on the link. Further route
 * parameters can be read from the current route by listing their names under
 * `metadata: { route_parameters_from_route: [...] }`, e.g. `bb_project` for
 * the project Tickets child. Without the workspace or one of those parameters
 * the link is inaccessible and its URL is `<nolink>`.
 */
final class WorkspaceMenuLink extends MenuLinkDefault implements AmbientScopedMenuLinkInterface {

  /**
   * Resolves the route workspace or the validated profile origin.
   */
  private AccountWorkspaceContext $workspaceContext;

  /**
   * The current route, read for `route_parameters_from_route`.
   */
  private RouteMatchInterface $routeMatch;

  /**
   * Cacheability recorded while resolving the workspace; NULL until resolved.
   */
  private ?CacheableMetadata $workspaceCache = NULL;

  /**
   * The resolved ambient workspace.
   */
  private ?BbWorkspaceInterface $workspace = NULL;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->workspaceContext = $container->get(AccountWorkspaceContext::class);
    $instance->routeMatch = $container->get('current_route_match');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getRouteParameters() {
    $workspace = $this->ambientWorkspace();
    $parameters = $this->parametersFromRoute() + parent::getRouteParameters();
    return $workspace ? ['bb_workspace' => $workspace->getSlug()] + $parameters : $parameters;
  }

  /**
   * {@inheritdoc}
   *
   * The menu admin form builds every link's URL without an ambient workspace.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  public function getUrlObject($title_attribute = TRUE) {
    if ($this->ambientAccess() !== NULL) {
      return Url::fromRoute('<nolink>');
    }
    return parent::getUrlObject($title_attribute);
  }

  /**
   * {@inheritdoc}
   */
  public function ambientAccess(): ?AccessResultInterface {
    $workspace = $this->ambientWorkspace();
    $required = $this->getMetaData()['route_parameters_from_route'] ?? [];
    if ($workspace !== NULL && count($this->parametersFromRoute()) === count($required)) {
      return NULL;
    }
    return AccessResult::neutral('No ambient context for this menu link.')
      ->addCacheableDependency($this->workspaceCache)
      ->addCacheContexts(['route']);
  }

  /**
   * The ambient workspace, resolved once per instance.
   */
  protected function ambientWorkspace(): ?BbWorkspaceInterface {
    if ($this->workspaceCache === NULL) {
      $this->workspaceCache = new CacheableMetadata();
      $this->workspace = $this->workspaceContext->resolve($this->workspaceCache);
    }
    return $this->workspace;
  }

  /**
   * The raw values of `route_parameters_from_route` present on the route.
   *
   * @return array<string, string>
   *   Route parameters keyed by name; missing ones are left out.
   */
  private function parametersFromRoute(): array {
    $parameters = [];
    foreach ($this->getMetaData()['route_parameters_from_route'] ?? [] as $name) {
      $value = $this->routeMatch->getRawParameter($name);
      if ($value !== NULL && $value !== '') {
        $parameters[$name] = (string) $value;
      }
    }
    return $parameters;
  }

}
