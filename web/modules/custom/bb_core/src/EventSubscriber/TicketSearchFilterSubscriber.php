<?php

declare(strict_types=1);

namespace Drupal\bb_core\EventSubscriber;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityRepositoryInterface;
use Drupal\Core\Http\Exception\CacheableBadRequestHttpException;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Ticket\TicketSearchResolver;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Rewrites filter[search] on bb_ticket JSON:API collections.
 *
 * The terminal sends what the person typed. The ticket index runs the same
 * search as the web list and this subscriber turns the matching ids into a
 * stock `drupal_internal__id IN` condition. Paging, includes and every other
 * filter stay stock. Origin references live only on the index.
 */
final class TicketSearchFilterSubscriber implements EventSubscriberInterface {

  /**
   * The one route this subscriber answers.
   */
  private const ROUTE = 'jsonapi.bb_ticket--bb_ticket.collection';

  /**
   * The filter key the client sends, reused as the rewritten condition's name.
   */
  private const KEY = 'search';

  public function __construct(
    private readonly TicketSearchResolver $resolver,
    private readonly EntityRepositoryInterface $entityRepository,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    // Below the router (32), so _route is set; above the controller.
    return [KernelEvents::REQUEST => ['onRequest', 31]];
  }

  /**
   * Rewrites the search param, or answers 400 with the resolver's message.
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
    $input = $filter[self::KEY] ?? NULL;
    // Only the string form is ours. Older terminals name their own OR group
    // `search` (`filter[search][group]…`); that array passes through as stock.
    if (!is_string($input)) {
      return;
    }
    unset($filter[self::KEY]);

    $resolved = $this->resolver->resolve($input, $this->projectInContext($filter));
    if ($resolved->failed()) {
      // "I could not understand you" must not read as "no such ticket".
      // The message depends on the typed line and on what the account reads.
      $cacheability = (new CacheableMetadata())->addCacheContexts(['url.query_args:filter', 'user']);
      throw new CacheableBadRequestHttpException($cacheability, (string) $resolved->error);
    }
    if (!$resolved->isEmpty()) {
      $ids = $this->resolver->ticketIds($resolved);
      $filter[self::KEY] = [
        'condition' => [
          'path' => 'drupal_internal__id',
          'operator' => 'IN',
          // No match: IN (0) is an honest empty page.
          'value' => $ids === [] ? [0] : $ids,
        ],
      ];
    }
    $request->query->set('filter', $filter);
  }

  /**
   * The readable project a `filter[project_id.id]=<uuid>` narrows to.
   *
   * @param array<string, mixed> $filter
   *   The request's filter parameter.
   */
  private function projectInContext(array $filter): ?BbProjectInterface {
    $uuid = $filter['project_id.id'] ?? NULL;
    if (is_array($uuid) && ($uuid['operator'] ?? '=') === '=') {
      $uuid = $uuid['value'] ?? NULL;
    }
    if (!is_string($uuid) || $uuid === '') {
      return NULL;
    }
    $project = $this->entityRepository->loadEntityByUuid('bb_project', $uuid);
    return $project instanceof BbProjectInterface && $project->access('view') ? $project : NULL;
  }

}
