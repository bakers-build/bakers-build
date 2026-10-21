<?php

declare(strict_types=1);

namespace Drupal\bb_core\EventSubscriber;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Database\Connection;
use Drupal\Core\Http\Exception\CacheableBadRequestHttpException;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Rewrites filter[has_children] on bb_ticket JSON:API collections.
 *
 * "Has at least one child" is not expressible in stock JSON:API: sub_tickets
 * is computed, and core offers no filter hook point. So the distinct parent
 * ids are read from the parent_id column and the param is replaced by a stock
 * drupal_internal__id IN/NOT IN filter, keeping paging honest downstream.
 *
 * No access check on the id read is needed: it only CONSTRAINS the outer
 * query, which applies entity access itself, so nothing extra is disclosed.
 */
final class HasChildrenFilterSubscriber implements EventSubscriberInterface {

  /**
   * The one route this subscriber answers.
   */
  private const ROUTE = 'jsonapi.bb_ticket--bb_ticket.collection';

  public function __construct(
    private readonly Connection $database,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    // Below the router (32), so _route is set; above the controller.
    return [KernelEvents::REQUEST => ['onRequest', 31]];
  }

  /**
   * Rewrites the custom param, or throws as stock validation would.
   */
  public function onRequest(RequestEvent $event): void {
    if (!$event->isMainRequest()) {
      return;
    }
    $request = $event->getRequest();
    if ($request->attributes->get('_route') !== self::ROUTE) {
      return;
    }
    $filter = $request->query->all('filter');
    if (!array_key_exists('has_children', $filter)) {
      return;
    }
    $value = $filter['has_children'];
    unset($filter['has_children']);
    if ($value !== '1' && $value !== '0') {
      // Mimic stock validation's answer to an unspeakable filter.
      throw new CacheableBadRequestHttpException(new CacheableMetadata(), 'has_children must be 0 or 1.');
    }
    if (array_key_exists('drupal_internal__id', $filter)) {
      // Two writers for one key cannot both be honoured; fail loudly rather
      // than silently dropping one.
      throw new CacheableBadRequestHttpException(new CacheableMetadata(), 'has_children cannot be combined with a drupal_internal__id filter.');
    }
    // parent_id is single-cardinality, so it lives as a same-named column on
    // the base table (one-column fields get no __target_id suffix there), not
    // in a dedicated field table; NULL is "no parent" and must not land in
    // the IN list.
    $ids = $this->database
      ->select('bb_ticket', 'p')
      ->fields('p', ['parent_id'])
      ->isNotNull('p.parent_id')
      ->distinct()
      ->execute()
      ->fetchCol();
    $filter['drupal_internal__id'] = [
      'operator' => $value === '1' ? 'IN' : 'NOT IN',
      // No parents: IN (0) matches nothing — an honest empty page. NOT IN (0)
      // matches everything, which is the correct childless answer too.
      'value' => $ids === [] ? [0] : array_map('intval', $ids),
    ];
    $request->query->set('filter', $filter);
  }

}
