<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Form\ProjectFavoriteForm;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The project overview's favorite toggle, for the shell page header actions.
 *
 * The toggle form; its label and pressed state say whether the project is
 * the account's favorite. Empty off the overview and where the form's route
 * would refuse the account.
 */
#[Source(
  id: 'bb_project_favorite_action',
  label: new TranslatableMarkup('[bakers.build] Project favorite action'),
  description: new TranslatableMarkup('Marks or unmarks the current project as a favorite.'),
  prop_types: ['slot'],
)]
final class ProjectFavoriteActionSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * Builds the toggle form.
   */
  private FormBuilderInterface $formBuilder;

  /**
   * The account the toggle is for.
   */
  private AccountInterface $currentUser;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->formBuilder = $container->get('form_builder');
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
    $access = Url::fromRoute('bb_core.project.favorite', [
      'bb_workspace' => $workspace->getSlug(),
      'bb_project' => $project->id(),
    ])->access($this->currentUser, TRUE);
    CacheableMetadata::createFromRenderArray($build)->addCacheableDependency($access)->applyTo($build);
    if (!$access->isAllowed()) {
      return $build;
    }
    return ProjectFavoriteForm::wrapped($this->formBuilder->getForm(ProjectFavoriteForm::class, $project)) + $build;
  }

}
