<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Hook\Order\Order;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\QueryAccess\QueryAccessHandlerInterface;
use Drupal\facets_exposed_filters\Plugin\views\filter\FacetsFilter;
use Drupal\bb_core\EventSubscriber\WorkspaceReadScopeSubscriber;
use Drupal\bb_core\Plugin\facets\processor\TicketParentLabelProcessor;
use Drupal\bb_core\Plugin\views\filter\BbClosedRows;
use Drupal\bb_core\Plugin\views\filter\BbHasChildren;
use Drupal\jsonapi\JsonApiFilter;
use Drupal\views\Plugin\views\filter\FilterPluginBase;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * The remaining small surface hooks.
 *
 * JSON:API filter access, the Views filter-chip summary, and one local-task
 * removal. Grouped together for lack of a shared subject rather than a
 * shared one: each is a single, self-contained alter with no state and no
 * other hook it belongs beside.
 */
final class JsonapiViewsFilterMenuHooks {

  public function __construct(
    #[Autowire(service: 'entity_type.manager')]
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {
  }

  /**
   * Implements hook_jsonapi_entity_filter_access().
   *
   * Keeps a workspace-scoped filtered collection read from silently returning
   * zero rows. AMONG_ALL decides only WHETHER the account may filter; the rows
   * stay bounded by `query_access`. The types come from the subscriber plus
   * every type that sets `bb_jsonapi_filter_scope` on its definition, whose
   * query handler is not a dotted child rule. A falsified group returns `[]`.
   *.
   *
   * @phpstan-return array<string, \Drupal\Core\Access\AccessResultInterface>
   */
  #[Hook('jsonapi_entity_filter_access')]
  public function jsonapiEntityFilterAccess(EntityTypeInterface $entity_type, AccountInterface $account): array {
    $entity_type_id = $entity_type->id();
    $in_scope = $entity_type->get('bb_jsonapi_filter_scope') === TRUE
      || in_array($entity_type_id, WorkspaceReadScopeSubscriber::inScopeEntityTypeIds(), TRUE);
    if (!$in_scope) {
      return [];
    }
    $handler = $this->entityTypeManager->getHandler($entity_type_id, 'query_access');
    assert($handler instanceof QueryAccessHandlerInterface);
    $conditions = $handler->getConditions('view', $account);
    if ($conditions->isAlwaysFalse()) {
      return [];
    }

    return [
      JsonApiFilter::AMONG_ALL => AccessResult::allowed()
        ->addCacheableDependency($conditions),
    ];
  }

  /**
   * Implements hook_views_filters_summary_info_alter().
   *
   * `bb_closed_rows` is exposed, but it renders
   * its own segmented control in place of the default widget and must never
   * show as a removable chip beside the other facets — the control is its own
   * object, not one of the chips it stands beside. Blanking the value keeps
   * `views_filters_summary` from building a chip for it at all. The
   * "Has sub-tickets" checkbox states itself the same way, and as a chip it
   * would read "Has sub-tickets is 1".
   *
   * @param array<string, mixed> $info
   *   The summary info to alter.
   * @param \Drupal\views\Plugin\views\filter\FilterPluginBase $filter
   *   The filter handler the summary info belongs to.
   */
  #[Hook('views_filters_summary_info_alter', order: Order::Last)]
  public function viewsFiltersSummaryInfoAlter(array &$info, FilterPluginBase $filter): void {
    $is_closed_rows = $filter->getPluginId() === 'bb_closed_rows'
      || $filter instanceof BbClosedRows;
    if ($is_closed_rows || $filter instanceof BbHasChildren) {
      $info['value'] = [];
    }
    if ($filter instanceof FacetsFilter && isset($filter->options['facet']['processor_configs']['bb_ticket_parent_label'])) {
      $this->nameChosenParents($info, $filter);
    }
  }

  /**
   * Names every chosen parent the parent facet has no result for.
   *
   * Contrib states a chip only from the facet's results, and a facet with
   * `min_count: 1` has none when no listed ticket has a parent; a chosen
   * parent is still named, by key and title, or by key alone when unknown or
   * unreadable. Runs after facets_exposed_filters' own alter.
   *
   * @param array<string, mixed> $info
   *   The summary info to alter.
   * @param \Drupal\facets_exposed_filters\Plugin\views\filter\FacetsFilter $filter
   *   The parent facet.
   */
  private function nameChosenParents(array &$info, FacetsFilter $filter): void {
    $info['value'] = is_array($info['value'] ?? NULL) ? $info['value'] : [];
    $named = array_map(strval(...), array_column($info['value'], 'raw'));
    $missing = array_values(array_diff(array_map(strval(...), (array) $filter->value), $named));
    $labels = TicketParentLabelProcessor::labels($this->entityTypeManager, $missing);
    foreach ($missing as $key) {
      $info['value'][] = ['id' => $key, 'raw' => $key, 'value' => $labels[$key] ?? $key];
    }
  }

  /**
   * Implements hook_local_tasks_alter().
   *
   * The user area is not a tabbed surface; drops social_auth's task at
   * discovery instead of on every request.
   *
   * @phpstan-param array<string, mixed> $local_tasks
   */
  #[Hook('local_tasks_alter')]
  public function localTasksAlter(array &$local_tasks): void {
    unset($local_tasks['social_auth.user.social_auth_profiles_task']);
  }

}
