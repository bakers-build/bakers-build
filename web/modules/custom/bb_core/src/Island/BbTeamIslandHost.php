<?php

declare(strict_types=1);

namespace Drupal\bb_core\Island;

use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\island\IslandContextProviderInterface;

/**
 * Host seam for the team screen's islands.
 *
 * A host makes an island addressable (`island-<host>-<plugin>`), which is
 * what lets it be re-rendered after a submit. `MembersIslandPlacementTrait`
 * supplies the placement; the data is derived per request from the route, so
 * a rebuild uses the request it serves. Off a team route the data is empty:
 * listing every team's membership would be a tenancy leak.
 */
final class BbTeamIslandHost implements IslandContextProviderInterface {

  use MembersIslandPlacementTrait;

  public function __construct(
    private readonly RouteMatchInterface $routeMatch,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function hostId(): string {
    return 'team';
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandData(string $island_id): array {
    $team = $this->routeMatch->getParameter('bb_team');
    if (!$team instanceof BbTeamInterface) {
      return [];
    }
    // The key is `group`, not `team`: the shared island and form stay
    // type-blind so the workspace member surface can reuse them.
    return ['group' => $team];
  }

}
