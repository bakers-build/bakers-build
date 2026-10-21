<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;

/**
 * The URL-only active-workspace chain.
 *
 * Deliberately unmemoised: it only reads the route object and its already
 * upcast parameters, so there is nothing to amortise.
 *
 * @see \Drupal\bb_core\Access\BbActiveWorkspaceInterface
 */
final class BbActiveWorkspace implements BbActiveWorkspaceInterface {

  /**
   * Constructs a BbActiveWorkspace.
   *
   * @param \Drupal\Core\Routing\RouteMatchInterface $routeMatch
   *   The current route match: the only input this class has.
   */
  public function __construct(
    private readonly RouteMatchInterface $routeMatch,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public function resolve(): ?BbWorkspaceInterface {
    if (!$this->isCreationForm()) {
      return NULL;
    }
    foreach ($this->routeMatch->getParameters() as $parameter) {
      if ($parameter instanceof BbWorkspaceInterface) {
        return $parameter;
      }
    }
    return NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function source(): string {
    return $this->resolve() === NULL
      ? self::SOURCE_NONE
      : self::SOURCE_ROUTE;
  }

  /**
   * Whether this route supplies trusted context for creating an entity.
   *
   * Standard add forms and the name-only group/team dialogs carry a workspace.
   * Other create dialogs retain their existing context rules.
   *
   * @return bool
   *   TRUE for add operations and the two workspace-bound create operations.
   */
  private function isCreationForm(): bool {
    $route = $this->routeMatch->getRouteObject();
    if ($route === NULL) {
      return FALSE;
    }
    $entity_form = $route->getDefault('_entity_form');
    if (!is_string($entity_form)) {
      return FALSE;
    }
    [, $operation] = array_pad(explode('.', $entity_form, 2), 2, '');
    return $operation === 'add' || in_array($entity_form, ['bb_group.create', 'bb_team.create'], TRUE);
  }

}
