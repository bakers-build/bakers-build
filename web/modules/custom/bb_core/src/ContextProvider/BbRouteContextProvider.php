<?php

declare(strict_types=1);

namespace Drupal\bb_core\ContextProvider;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Plugin\Context\Context;
use Drupal\Core\Plugin\Context\ContextProviderInterface;
use Drupal\Core\Plugin\Context\EntityContext;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\bb_core\Navigation\AccountWorkspaceContext;

/**
 * Exposes the route workspace, route user and ambient workspace as contexts.
 *
 * Each context is always present so a mapping never fails on a page without
 * the value; an absent value carries the cacheability of its absence.
 */
final class BbRouteContextProvider implements ContextProviderInterface {

  use StringTranslationTrait;

  /**
   * The qualified id of the ambient workspace context.
   */
  public const AMBIENT_WORKSPACE = '@bb_core.route_context:ambient_workspace';

  public function __construct(
    private readonly RouteMatchInterface $routeMatch,
    private readonly AccountWorkspaceContext $workspaceContext,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function getRuntimeContexts(array $unqualified_context_ids): array {
    $contexts = [];
    $route = (new CacheableMetadata())->addCacheContexts(['route']);
    foreach (['workspace' => 'bb_workspace', 'user' => 'user'] as $id => $parameter) {
      if (in_array($id, $unqualified_context_ids, TRUE) || $unqualified_context_ids === []) {
        $value = $this->routeMatch->getParameter($parameter);
        $contexts[$id] = $this->context($id, $value instanceof EntityInterface ? $value : NULL, $route);
      }
    }
    if (in_array('ambient_workspace', $unqualified_context_ids, TRUE) || $unqualified_context_ids === []) {
      $cache = new CacheableMetadata();
      $workspace = $this->workspaceContext->resolve($cache);
      $contexts['ambient_workspace'] = $this->context('ambient_workspace', $workspace, $cache->addCacheContexts(['bb_workspace']));
    }
    return $contexts;
  }

  /**
   * {@inheritdoc}
   */
  public function getAvailableContexts(): array {
    return [
      'workspace' => $this->context('workspace', NULL),
      'user' => $this->context('user', NULL),
      'ambient_workspace' => $this->context('ambient_workspace', NULL),
    ];
  }

  /**
   * Builds one typed context with its cacheability.
   */
  private function context(string $id, ?EntityInterface $value, ?CacheableMetadata $cache = NULL): Context {
    $definition = match ($id) {
      'workspace' => EntityContextDefinition::fromEntityTypeId('bb_workspace')->setLabel($this->t('Route workspace')),
      'user' => EntityContextDefinition::fromEntityTypeId('user')->setLabel($this->t('Route user')),
      default => EntityContextDefinition::fromEntityTypeId('bb_workspace')->setLabel($this->t('Ambient workspace')),
    };
    $context = $value === NULL ? new Context($definition->setRequired(FALSE)) : new EntityContext($definition, $value);
    if ($cache !== NULL) {
      $context->addCacheableDependency($cache);
    }
    return $context;
  }

}
