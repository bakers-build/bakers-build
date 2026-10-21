<?php

declare(strict_types=1);

namespace Drupal\bb_core\Resource;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Cache\CacheableResponseInterface;
use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Statistics\Context\FigureRequestContextResolver;
use Drupal\bb_core\Statistics\Figure\FigureCollection;
use Drupal\jsonapi\JsonApiResource\LinkCollection;
use Drupal\jsonapi\JsonApiResource\ResourceObject;
use Drupal\jsonapi\JsonApiResource\ResourceObjectData;
use Drupal\jsonapi\ResourceResponse;
use Drupal\jsonapi\ResourceType\ResourceType;
use Drupal\jsonapi\ResourceType\ResourceTypeAttribute;
use Drupal\jsonapi_resources\Resource\ResourceBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\Routing\Route;

/**
 * Returns ordered figure groups with complete atomic figure payloads.
 */
final class StatisticsIndexResource extends ResourceBase implements ContainerInjectionInterface {

  public function __construct(
    private readonly FigureRequestContextResolver $contextResolver,
    private readonly FigureCollection $collection,
    private readonly AccountInterface $currentUser,
    private readonly TimeInterface $time,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('bb_core.figure_request_context_resolver'),
      $container->get('bb_core.figure_collection'),
      $container->get('current_user'),
      $container->get('datetime.time'),
    );
  }

  /**
   * Handles a grouped statistics request.
   */
  public function process(Request $request, array $resource_types): ResourceResponse {
    $contexts = $this->contextResolver->fromRequest($request);
    try {
      $groups = $this->collection->groups(
        $contexts,
        $this->currentUser,
        $this->contextResolver->filtersFromRequest($request),
        $this->time->getRequestTime(),
      );
    }
    catch (\InvalidArgumentException $exception) {
      throw new BadRequestHttpException($exception->getMessage(), $exception);
    }
    $cacheability = (new CacheableMetadata())
      ->setCacheMaxAge(0)
      ->addCacheContexts(['user.permissions', 'url.query_args'])
      ->addCacheTags(['og_membership_list']);
    foreach ($contexts as $context) {
      $cacheability->addCacheableDependency($context);
    }
    $resourceType = reset($resource_types);
    assert($resourceType instanceof ResourceType);
    $object = new ResourceObject(
      $cacheability,
      $resourceType,
      'statistics',
      NULL,
      ['groups' => $groups],
      new LinkCollection([]),
    );
    $response = $this->createJsonapiResponse(new ResourceObjectData([$object], 1), $request);
    if ($response instanceof CacheableResponseInterface) {
      $response->addCacheableDependency($cacheability);
    }
    return $response;
  }

  /**
   * {@inheritdoc}
   */
  public function getRouteResourceTypes(Route $route, string $route_name): array {
    $type = new ResourceType(
      'bb_statistics_index',
      'bb_statistics_index',
      '',
      FALSE,
      FALSE,
      FALSE,
      FALSE,
      ['groups' => new ResourceTypeAttribute('groups')],
      'bakers-statistics',
    );
    $type->setRelatableResourceTypes([]);
    return [$type];
  }

}
