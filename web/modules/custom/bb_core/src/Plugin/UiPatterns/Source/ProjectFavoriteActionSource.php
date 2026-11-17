<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Render\BubbleableMetadata;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Profile\Profiles;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The project overview's favorite toggle, for the shell page header actions.
 *
 * A link to the CSRF-protected toggle route; its label and pressed state say
 * whether the project is the account's favorite. Empty off the overview and
 * where the route would refuse the account.
 */
#[Source(
  id: 'bb_project_favorite_action',
  label: new TranslatableMarkup('[bakers.build] Project favorite action'),
  description: new TranslatableMarkup('Marks or unmarks the current project as a favorite.'),
  prop_types: ['slot'],
)]
final class ProjectFavoriteActionSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * Finds the account's profile in the project's workspace.
   */
  private Profiles $profiles;

  /**
   * The account the toggle is for.
   */
  private AccountInterface $currentUser;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->profiles = $container->get(Profiles::class);
    $instance->currentUser = $container->get('current_user');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $build = ['#cache' => ['contexts' => ['route', 'user']]];
    $project = $this->routeMatch->getParameter('bb_project');
    $workspace = $this->routeMatch->getParameter('bb_workspace');
    if ($this->routeMatch->getRouteName() !== 'entity.bb_project.canonical' || !$project instanceof BbProjectInterface || !$workspace instanceof BbWorkspaceInterface) {
      return $build;
    }
    $url = Url::fromRoute('bb_core.project.favorite', ['bb_workspace' => $workspace->getSlug(), 'bb_project' => $project->id()]);
    $account = $this->currentUser;
    $access = $url->access($account, TRUE);
    CacheableMetadata::createFromRenderArray($build)->addCacheableDependency($access)->applyTo($build);
    if (!$access->isAllowed()) {
      return $build;
    }
    $profile = $this->profiles->forAccount((int) $account->id(), (int) $workspace->id());
    $favorite = in_array((int) $project->id(), $profile->favoriteProjectIds(), TRUE);
    // The token is a render placeholder; its attachments must travel along.
    $href = $url->toString(TRUE);
    $build += [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#props' => [
        'label' => (string) ($favorite ? $this->t('Remove from favorites') : $this->t('Add to favorites')),
        'href' => $href->getGeneratedUrl(),
        'variant' => 'ghost',
        'icon_only' => TRUE,
        'pressed' => $favorite,
      ],
      '#slots' => [
        'icon' => [
          '#type' => 'component',
          '#component' => 'bb_theme:icon',
          '#props' => ['name' => 'star', 'size' => 'sm'],
        ],
      ],
    ];
    $metadata = BubbleableMetadata::createFromRenderArray($build)
      ->merge(BubbleableMetadata::createFromObject($href))
      ->addCacheTags(['bb_profile_list']);
    if (!$profile->isNew()) {
      $metadata->addCacheableDependency($profile);
    }
    $metadata->applyTo($build);
    return $build;
  }

}
