<?php

declare(strict_types=1);

namespace Drupal\bb_core\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\DependencyInjection\AutowireTrait;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Profile\Profiles;
use Symfony\Component\HttpFoundation\RedirectResponse;

/**
 * Marks or unmarks a project as the current account's favorite.
 */
final class ProjectFavoriteController extends ControllerBase {

  use AutowireTrait;

  public function __construct(
    private readonly Profiles $profiles,
    private readonly WorkspaceResolverInterface $workspaceResolver,
  ) {}

  /**
   * Toggles the project in the profile of its workspace, then shows it.
   *
   * The route checks the CSRF token and the project's view access.
   */
  public function toggle(BbProjectInterface $bb_project): RedirectResponse {
    $workspace = $this->workspaceResolver->resolve($bb_project);
    if ($workspace !== NULL) {
      $profile = $this->profiles->forAccount((int) $this->currentUser()->id(), (int) $workspace->id());
      $profile->toggleFavorite((int) $bb_project->id())->save();
      $this->messenger()->addStatus(in_array((int) $bb_project->id(), $profile->favoriteProjectIds(), TRUE)
        ? $this->t('Added to favorites.')
        : $this->t('Removed from favorites.'));
    }
    return new RedirectResponse($bb_project->toUrl()->setAbsolute()->toString());
  }

}
