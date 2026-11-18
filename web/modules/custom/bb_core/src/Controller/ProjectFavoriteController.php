<?php

declare(strict_types=1);

namespace Drupal\bb_core\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\DependencyInjection\AutowireTrait;
use Drupal\Core\Htmx\Htmx;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Profile\Profiles;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Marks or unmarks a project as the current account's favorite.
 */
final class ProjectFavoriteController extends ControllerBase {

  use AutowireTrait;

  /**
   * The island event a toggle announces; the rail subscribes to it.
   */
  public const CHANGED_EVENT = 'bakers.favorites.changed';

  public function __construct(
    private readonly Profiles $profiles,
    private readonly WorkspaceResolverInterface $workspaceResolver,
  ) {}

  /**
   * Toggles the project in the profile of its workspace, then shows it.
   *
   * The route checks the CSRF token and the project's view access. An htmx
   * request lands by HX-Location and announces the change to the islands.
   */
  public function toggle(BbProjectInterface $bb_project, Request $request): Response {
    $workspace = $this->workspaceResolver->resolve($bb_project);
    if ($workspace !== NULL) {
      $profile = $this->profiles->forEditing((int) $this->currentUser()->id(), (int) $workspace->id());
      $profile->toggleFavorite((int) $bb_project->id())->save();
      $this->messenger()->addStatus(in_array((int) $bb_project->id(), $profile->favoriteProjectIds(), TRUE)
        ? $this->t('Added to favorites.')
        : $this->t('Removed from favorites.'));
    }
    if (!$request->headers->has('HX-Request')) {
      return new RedirectResponse($bb_project->toUrl()->setAbsolute()->toString());
    }
    $response = new Response('', 200, ['Content-Type' => 'text/html; charset=UTF-8']);
    $response->headers->add((new Htmx())->locationHeader($bb_project->toUrl())->triggerHeader(self::CHANGED_EVENT)->getHeaders()->all());
    return $response;
  }

}
