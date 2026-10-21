<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\search_api\processor;

use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\search_api\Attribute\SearchApiProcessor;
use Drupal\search_api\IndexInterface;
use Drupal\search_api\Processor\ProcessorPluginBase;
use Drupal\search_api\Query\QueryInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Re-applies the entity query-access rule to a Search API query.
 *
 * `entity`'s ViewsQueryAlter only alters SQL views, so a Search API view would
 * bypass `WorkspaceReadScopeSubscriber`. This re-applies the same read-scope
 * service (never a second copy of the rule) and fails closed: an account with
 * no projects gets an impossible condition.
 */
#[SearchApiProcessor(
  id: 'bb_read_scope',
  label: new TranslatableMarkup('bakers.build workspace read scope'),
  description: new TranslatableMarkup('Narrows results to the projects the account may read.'),
  stages: ['preprocess_query' => 0],
)]
final class BbReadScope extends ProcessorPluginBase implements ContainerFactoryPluginInterface {

  /**
   * The account the query is run as.
   */
  private AccountProxyInterface $currentUser;

  /**
   * The one service that answers what the account may read.
   */
  private BbWorkspaceReadScopeInterface $readScope;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->currentUser = $container->get('current_user');
    $instance->readScope = $container->get('bb_core.workspace_read_scope');
    return $instance;
  }

  /**
   * {@inheritdoc}
   *
   * `isValidDatasource()`, not `getDatasource()`, which throws for an absent
   * id. Every index carrying this processor must answer TRUE here, or
   * `Index::preSave()` silently removes it.
   */
  public static function supportsIndex(IndexInterface $index): bool {
    return $index->isValidDatasource('entity:bb_ticket') || $index->isValidDatasource('entity:bb_run');
  }

  /**
   * {@inheritdoc}
   */
  public function preprocessSearchQuery(QueryInterface $query): void {
    $account = $this->currentUser->getAccount();
    // Both admitted datasources currently share the SAME admin permission
    // (`admin_permission: 'administer bakers'` on both `BbTicket` and
    // `BbRun`), so this bypass check answers identically either way; it is
    // still resolved from the query's own index rather than hard-coded to one
    // of the two, so a future entity type joining this processor is not
    // silently checked against the wrong bypass permission.
    $entity_type_id = $query->getIndex()->isValidDatasource('entity:bb_run') ? 'bb_run' : 'bb_ticket';
    if ($this->readScope->isBypassed($account, $entity_type_id)) {
      return;
    }

    $project_ids = $this->readScope->projectIds($account);
    if ($project_ids === []) {
      // Fail closed. `IN ()` is not expressible, so the impossible condition
      // is stated as an equality no id can satisfy.
      $query->addCondition('project_id', 0);
      return;
    }

    $query->addCondition('project_id', array_values($project_ids), 'IN');
  }

}
