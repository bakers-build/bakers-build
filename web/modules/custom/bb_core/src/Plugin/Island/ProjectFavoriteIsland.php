<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Island;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Template\Attribute;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Profile\Profiles;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;
use Drupal\island\IslandResponse;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Marks or unmarks the open project as the current account's favorite.
 *
 * Embedded in the shell page header on the project overview. The toggle
 * swaps itself and announces the change; the rail subscribes to it.
 */
#[Island(
  id: 'bb_project_favorite',
  label: new TranslatableMarkup('Project favorite toggle'),
  type: 'view',
)]
final class ProjectFavoriteIsland extends IslandPluginBase {

  /**
   * The island event a toggle dispatches.
   */
  public const CHANGED_EVENT = 'bakers.favorites.changed';

  /**
   * Reads and stores the account's per-workspace profile.
   */
  private Profiles $profiles;

  /**
   * Resolves the project's workspace.
   */
  private WorkspaceResolverInterface $workspaceResolver;

  /**
   * The page the toggle is on.
   */
  private RouteMatchInterface $routeMatch;

  /**
   * The account the toggle is for.
   */
  private AccountInterface $currentUser;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $island = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $island->profiles = $container->get(Profiles::class);
    $island->workspaceResolver = $container->get('bb_core.workspace_resolver');
    $island->routeMatch = $container->get('current_route_match');
    $island->currentUser = $container->get('current_user');
    return $island;
  }

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    $build = ['#cache' => ['contexts' => ['route', 'user'], 'tags' => ['bb_profile_list']]];
    $access = $this->accessAction('toggle', [], $this->currentUser);
    CacheableMetadata::createFromRenderArray($build)->addCacheableDependency($access)->applyTo($build);
    $project = $this->project();
    if (!$access->isAllowed() || $project === NULL) {
      return $build;
    }
    $favorite = $this->isFavorite($project);
    $label = $favorite ? $this->t('Remove from favorites') : $this->t('Add to favorites');
    $link = $this->action('toggle', [], $label);
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#attached' => $link['#attached'] ?? [],
      '#props' => [
        'label' => $label,
        'variant' => 'ghost',
        'icon_only' => TRUE,
        'pressed' => $favorite,
        'attributes' => new Attribute($link['#attributes'] ?? []),
      ],
      '#slots' => [
        'icon' => [
          '#type' => 'component',
          '#component' => 'bb_theme:icon',
          '#props' => ['name' => 'star', 'size' => 'sm'],
        ],
      ],
    ] + $build;
  }

  /**
   * {@inheritdoc}
   */
  public function accessAction(string $action, array $parameters, AccountInterface $account): AccessResultInterface {
    $project = $this->project();
    if ($action !== 'toggle' || $project === NULL) {
      return AccessResult::forbidden()->addCacheContexts(['route']);
    }
    return AccessResult::allowedIf($account->isAuthenticated())
      ->addCacheContexts(['user.roles:authenticated', 'route'])
      ->andIf($project->access('view', $account, TRUE));
  }

  /**
   * {@inheritdoc}
   */
  public function applyAction(string $action, array $parameters): IslandResponse {
    $project = $this->project();
    if ($project !== NULL) {
      $workspace_id = (int) $this->workspaceResolver->resolve($project)?->id();
      $this->profiles->forEditing((int) $this->currentUser->id(), $workspace_id)
        ->toggleFavorite((int) $project->id())
        ->save();
    }
    return IslandResponse::make()->rebuildSelf()->dispatch(self::CHANGED_EVENT);
  }

  /**
   * The project whose overview is open, if any.
   */
  private function project(): ?BbProjectInterface {
    $project = $this->routeMatch->getParameter('bb_project');
    return $this->routeMatch->getRouteName() === 'entity.bb_project.canonical' && $project instanceof BbProjectInterface ? $project : NULL;
  }

  /**
   * Whether the project is the current account's favorite.
   */
  private function isFavorite(BbProjectInterface $project): bool {
    $workspace_id = (int) $this->workspaceResolver->resolve($project)?->id();
    return in_array((int) $project->id(), $this->profiles->forAccount((int) $this->currentUser->id(), $workspace_id)->favoriteProjectIds(), TRUE);
  }

}
