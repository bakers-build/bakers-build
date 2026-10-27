<?php

declare(strict_types=1);

namespace Drupal\bb_core\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Statistics\FigureRenderer;
use Drupal\bb_core\Statistics\InsightsPage;
use Drupal\bb_core\Statistics\MyWorkStatsPage;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Renders statistics for the named contexts supplied by a route.
 */
final class BbStatsController extends ControllerBase {

  public const BODY_ATTRIBUTE = 'data-bakers-tab-body';

  public function __construct(
    private readonly FigureRenderer $renderer,
    private readonly InsightsPage $insightsPage,
    private readonly MyWorkStatsPage $myWorkPage,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('bb_core.figure_renderer'),
      $container->get('bb_core.insights_page'),
      $container->get('bb_core.my_work_stats_page'),
    );
  }

  /**
   * Builds the statistics tab body.
   */
  public function stats(RouteMatchInterface $route_match, Request $request): array {
    $filters = $request->query->all('filter');
    if (array_filter($filters, static fn($value): bool => !is_scalar($value)) !== []) {
      throw new BadRequestHttpException('Statistics filters must have scalar values.');
    }
    return [
      '#type' => 'container',
      '#attributes' => [self::BODY_ATTRIBUTE => 'stats'],
      'content' => $this->renderer->build($this->contextsOf($route_match), $this->currentUser(), array_map('strval', $filters)),
    ];
  }

  /**
   * Builds the workspace Insights › Overview page.
   */
  public function insights(RouteMatchInterface $route_match, Request $request): array {
    $workspace = $this->contextsOf($route_match)['workspace'] ?? NULL;
    if (!$workspace instanceof BbWorkspaceInterface) {
      throw new NotFoundHttpException('No workspace in the current route.');
    }
    return $this->insightsPage->build($workspace, $this->currentUser(), $request);
  }

  /**
   * Builds a project's Stats tab: the Insights page for one project.
   */
  public function projectStats(RouteMatchInterface $route_match, Request $request): array {
    $project = $route_match->getParameter('bb_project');
    if (!$project instanceof BbProjectInterface) {
      throw new NotFoundHttpException('No project in the current route.');
    }
    return $this->insightsPage->build($project, $this->currentUser(), $request);
  }

  /**
   * Builds the My work › Stats page: the signed-in account's own figures.
   */
  public function myWork(RouteMatchInterface $route_match, Request $request): array {
    $workspace = $route_match->getParameter('bb_workspace');
    if (!$workspace instanceof BbWorkspaceInterface) {
      throw new NotFoundHttpException('No workspace in the current route.');
    }
    return $this->myWorkPage->build($workspace, $this->currentUser(), $request);
  }

  /**
   * Resolves the route's explicitly named statistics contexts.
   *
   * @return array<string, EntityInterface>
   *   Route context entities keyed by their public context name.
   */
  private function contextsOf(RouteMatchInterface $routeMatch): array {
    $mapping = $routeMatch->getRouteObject()?->getDefault('_bb_stats_contexts');
    if (is_array($mapping)) {
      $contexts = [];
      foreach ($mapping as $key => $parameter) {
        $entity = $routeMatch->getParameter($parameter);
        if (!$entity instanceof EntityInterface) {
          throw new NotFoundHttpException(sprintf('No %s in the current route.', $parameter));
        }
        $contexts[(string) $key] = $entity;
      }
      return $contexts;
    }

    $parameter = $routeMatch->getRouteObject()?->getDefault('_bb_stats_scope');
    if (is_string($parameter)) {
      $entity = $routeMatch->getParameter($parameter);
      if (!$entity instanceof EntityInterface) {
        throw new NotFoundHttpException(sprintf('No %s in the current route.', $parameter));
      }
      $key = match ($entity->getEntityTypeId()) {
        'bb_workspace' => 'workspace',
        'bb_project' => 'project',
        'bb_team' => 'team',
        'user' => 'user',
        default => throw new NotFoundHttpException('Unsupported statistics route context.'),
      };
      return [$key => $entity];
    }

    $user = $this->entityTypeManager()->getStorage('user')->load($this->currentUser()->id());
    if (!$user instanceof EntityInterface) {
      throw new NotFoundHttpException('No account to read figures for.');
    }
    return ['user' => $user];
  }

}
