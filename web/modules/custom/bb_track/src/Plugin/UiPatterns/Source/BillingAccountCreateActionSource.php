<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_track\Form\AccountEditForm;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The page header's New billing account action on a project's Billing tab.
 *
 * Not a CreateActionSourceBase: that base resolves its dialog route without
 * parameters, and the dialog belongs to the route's project.
 */
#[Source(
  id: 'bb_track_billing_account_create_action',
  label: new TranslatableMarkup('[bakers.build] New billing account action'),
  description: new TranslatableMarkup('Opens the New billing account dialog on a project Billing tab.'),
  prop_types: ['slot'],
)]
final class BillingAccountCreateActionSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * The current route.
   */
  protected RouteMatchInterface $currentRoute;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->currentRoute = $container->get('current_route_match');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $build = ['#cache' => ['contexts' => ['route', 'user']]];
    $project = $this->currentRoute->getParameter('bb_project');
    if ($this->currentRoute->getRouteName() !== 'bb_track.account' || !$project instanceof BbProjectInterface) {
      return $build;
    }
    $access = $project->access('update', NULL, TRUE);
    CacheableMetadata::createFromRenderArray($build)->addCacheableDependency($access)->applyTo($build);
    if (!$access->isAllowed()) {
      return $build;
    }
    return AccountEditForm::trigger($project, NULL, (string) $this->t('New billing account'), 'primary', TRUE) + $build;
  }

}
