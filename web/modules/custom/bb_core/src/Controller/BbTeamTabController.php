<?php

declare(strict_types=1);

namespace Drupal\bb_core\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Render\EntityFormSurface;
use Drupal\island\IslandPlacement;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The body behind the ONE team tab still built in PHP: Members.
 *
 * Overview is the `full` view mode via core's `_entity_view`, Stats is
 * `BbStatsController`, and Tickets and Runs are Views pages. Members staying
 * in PHP is a recorded debt, not a design.
 *.
 */
final class BbTeamTabController extends ControllerBase {

  public function __construct(
    private readonly IslandPlacement $placement,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('island.placement'),
    );
  }

  /**
   * The marker every tab body carries.
   *
   * One element, always present, whether or not it has content. A scenario that
   * counted rendered bodies without it could not tell an empty Load from a
   * broken route.
   */
  public const BODY_ATTRIBUTE = 'data-bakers-tab-body';

  /**
   * Renders the Members tab: the `members` island of the `team` host.
   *
   * An island, so a successful submit rebuilds only this fragment. The route
   * parameter only upcasts and access-checks `{bb_team}`; the body reaches
   * the team through the island's host.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function members(BbTeamInterface $bb_team): array {
    return EntityFormSurface::wrap($this->body('members', $this->placement->place('team', 'members')));
  }

  /**
   * The team's own label, for every tab route.
   */
  public function title(BbTeamInterface $bb_team): string {
    return (string) $bb_team->label();
  }

  /**
   * Wraps a tab's content in the marked body container.
   *
   * @param string $tab
   *   The tab's machine name, exposed as a data attribute so a failing
   *   scenario names the face it was looking at.
   * @param array $content
   *   The body's content.
   */
  private function body(string $tab, array $content = []): array {
    return [
      '#type' => 'container',
      '#attributes' => [
        self::BODY_ATTRIBUTE => $tab,
      ],
      'content' => $content,
    ];
  }

}
