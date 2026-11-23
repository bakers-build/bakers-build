<?php

declare(strict_types=1);

namespace Drupal\bb_core\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Members\MembershipWriter;
use Drupal\bb_core\Render\EntityFormSurface;
use Drupal\island\IslandPlacement;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Renders the workspace's Members surface.
 *
 * The same `members` island the team screen renders, so workspace roles and
 * team membership share one implementation.
 *
 * The route parameter is what makes `{bb_workspace}` upcast and
 * access-checked before this method runs; the body itself reaches the
 * workspace through the island's host (`BbWorkspaceIslandHost`) instead.
 */
final class BbWorkspaceMembersController extends ControllerBase {

  public function __construct(
    private readonly IslandPlacement $placement,
    private readonly MembershipWriter $membershipWriter,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('island.placement'),
      $container->get('bb_core.membership_writer'),
    );
  }

  /**
   * Renders the Members island for the current workspace.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function members(BbWorkspaceInterface $bb_workspace): array {
    return EntityFormSurface::wrap([
      '#type' => 'container',
      '#attributes' => [
        'data-bakers-tab-body' => 'members',
      ],
      'content' => $this->placement->place('workspace', 'members'),
    ]);
  }

  /**
   * Renders one member's page: the same island, showing that member alone.
   *
   * The island reads the member off the route through its host.
   */
  public function member(BbWorkspaceInterface $bb_workspace, UserInterface $user): array {
    if ($this->membershipWriter->membershipOf($bb_workspace, (int) $user->id()) === NULL) {
      throw new NotFoundHttpException();
    }
    return EntityFormSurface::wrap([
      '#type' => 'container',
      '#attributes' => ['data-bakers-tab-body' => 'member'],
      'content' => $this->placement->place('workspace', 'members'),
    ]);
  }

  /**
   * The member's name, for a member page's title.
   */
  public function memberTitle(UserInterface $user): string {
    return (string) $user->getDisplayName();
  }

  /**
   * The workspace's own label, for the route title.
   */
  public function title(BbWorkspaceInterface $bb_workspace): string {
    return (string) $bb_workspace->label();
  }

}
