<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\filter;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\ParamConverter\ParamConverterInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\views\Attribute\ViewsFilter;
use Drupal\views\Plugin\views\filter\InOperator;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Filters by project, offering only the viewable projects of one workspace.
 *
 * The workspace is the View's first argument (its slug), so a select never
 * lists another workspace's projects, and InOperator refuses any other id.
 */
#[ViewsFilter('bb_workspace_project')]
final class BbWorkspaceProject extends InOperator {

  /**
   * The entity type manager.
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * The workspace slug converter.
   */
  protected ParamConverterInterface $workspaceConverter;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->entityTypeManager = $container->get('entity_type.manager');
    $instance->workspaceConverter = $container->get('bb_core.paramconverter.workspace_slug');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getValueOptions(): array {
    $this->valueOptions = [];
    $slug = $this->view->args[0] ?? NULL;
    $workspace = is_scalar($slug) && (string) $slug !== ''
      ? $this->workspaceConverter->convert((string) $slug, ['type' => 'bb_workspace_slug'], 'bb_workspace', [])
      : NULL;
    if (!$workspace instanceof BbWorkspaceInterface) {
      return $this->valueOptions;
    }
    $storage = $this->entityTypeManager->getStorage('bb_project');
    $ids = $storage->getQuery()
      ->accessCheck(TRUE)
      ->condition('group_id.entity:bb_group.workspace_id', $workspace->id())
      ->sort('name')
      ->execute();
    foreach ($storage->loadMultiple($ids) as $id => $project) {
      $this->valueOptions[$id] = (string) $project->label();
    }
    return $this->valueOptions;
  }

}
