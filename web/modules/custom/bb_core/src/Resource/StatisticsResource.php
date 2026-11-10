<?php

declare(strict_types=1);

namespace Drupal\bb_core\Resource;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Cache\CacheableResponseInterface;
use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Access\FigureDisclosure;
use Drupal\bb_core\BbFigureInterface;
use Drupal\bb_core\Statistics\Context\FigureRequestContextResolver;
use Drupal\bb_core\Statistics\Figure\FigureEvaluator;
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
 * Returns one complete atomic figure for named contexts.
 */
final class StatisticsResource extends ResourceBase implements ContainerInjectionInterface {

  public function __construct(
    private readonly FigureRequestContextResolver $contextResolver,
    private readonly FigureEvaluator $evaluator,
    private readonly TimeInterface $time,
    private readonly FigureDisclosure $disclosure,
    private readonly AccountInterface $currentUser,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('bb_core.figure_request_context_resolver'),
      $container->get('bb_core.figure_evaluator'),
      $container->get('datetime.time'),
      $container->get('bb_core.figure_disclosure'),
      $container->get('current_user'),
    );
  }

  /**
   * Handles one direct figure request.
   */
  public function process(Request $request, BbFigureInterface $bb_figure, array $resource_types): ResourceResponse {
    $contexts = $this->contextResolver->fromRequest($request);
    try {
      $attributes = $this->evaluator->evaluate(
        $bb_figure,
        $contexts,
        $this->contextResolver->filtersFromRequest($request),
        $this->time->getRequestTime(),
        $this->disclosure->projectBound($this->currentUser, $bb_figure, $contexts),
      )->toArray();
      // JSON:API reserves `id` at resource-object level. The grouped contract
      // retains it inside each nested figure; the direct document carries the
      // same value as data.id.
      unset($attributes['id']);
    }
    catch (\InvalidArgumentException $exception) {
      throw new BadRequestHttpException($exception->getMessage(), $exception);
    }
    $cacheability = (new CacheableMetadata())
      ->setCacheMaxAge(0)
      ->addCacheContexts(['user', 'url.query_args'])
      ->addCacheTags(['og_membership_list'])
      ->addCacheableDependency($bb_figure);
    foreach ($contexts as $context) {
      $cacheability->addCacheableDependency($context);
    }
    $resourceType = reset($resource_types);
    assert($resourceType instanceof ResourceType);
    $object = new ResourceObject(
      $cacheability,
      $resourceType,
      (string) $bb_figure->id(),
      NULL,
      $attributes,
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
    $fields = [];
    $names = [
      'label',
      'description',
      'widget',
      'generated',
      'filters',
      'period',
      'categories',
      'measurements',
      'ratio',
      'empty',
      'cache',
    ];
    foreach ($names as $field) {
      $fields[$field] = new ResourceTypeAttribute($field);
    }
    $type = new ResourceType('bb_figure_value', 'bb_figure_value', '', FALSE, FALSE, FALSE, FALSE, $fields, 'bakers-figure');
    $type->setRelatableResourceTypes([]);
    return [$type];
  }

}
