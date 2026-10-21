<?php

declare(strict_types=1);

namespace Drupal\bb_core\Island;

use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\island\IslandContextProviderInterface;

/**
 * Host seam for the workspace settings screen's Members island.
 *
 * Workspace roles (`admin`, `contributor`, `guest`) are assigned here.
 * `MembersIslandPlacementTrait` supplies the same placement the team host
 * uses; only `getIslandData()` differs.
 *
 * Off a workspace route there is no ambient workspace to key the list on, so
 * the island renders nothing rather than every workspace's membership.
 */
final class BbWorkspaceIslandHost implements IslandContextProviderInterface {

  use MembersIslandPlacementTrait;

  public function __construct(
    private readonly RouteMatchInterface $routeMatch,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function hostId(): string {
    return 'workspace';
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandData(string $island_id): array {
    $workspace = $this->routeMatch->getParameter('bb_workspace');
    if (!$workspace instanceof BbWorkspaceInterface) {
      return [];
    }
    // The key is `group`, not `workspace` — BbTeamIslandHost keys the same
    // way for the same reason: the shared form and island stay type-blind, and
    // this class's whole job is saying WHICH entity the route is about.
    return ['group' => $workspace];
  }

}
