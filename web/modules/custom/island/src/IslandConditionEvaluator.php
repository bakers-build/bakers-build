<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Component\Plugin\PluginManagerInterface;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Condition\ConditionAccessResolverTrait;
use Drupal\Core\Condition\ConditionPluginCollection;
use Drupal\Core\Plugin\Context\ContextHandlerInterface;
use Drupal\Core\Plugin\Context\ContextRepositoryInterface;
use Drupal\Core\Plugin\ContextAwarePluginInterface;
use Psr\Log\LoggerInterface;

/**
 * Evaluates one stored condition collection through core's Condition API.
 *
 * The single evaluation path for profile selection and placement visibility.
 * Every decision carries the cacheability of every configured condition, also
 * when core short-circuits the combination. A configuration that cannot be
 * evaluated denies uncacheably instead of manufacturing a result.
 */
final class IslandConditionEvaluator {

  use ConditionAccessResolverTrait;

  public function __construct(
    private readonly PluginManagerInterface $conditionManager,
    private readonly ContextRepositoryInterface $contextRepository,
    private readonly ContextHandlerInterface $contextHandler,
    private readonly LoggerInterface $logger,
  ) {
  }

  /**
   * Evaluates condition plugin configurations combined by an operator.
   *
   * @param array<string, array<string, mixed>> $conditions
   *   Condition plugin configurations keyed by instance id.
   * @param string $operator
   *   'and' or 'or'. An empty 'and' matches, an empty 'or' does not.
   *
   * @return \Drupal\Core\Access\AccessResultInterface
   *   Allowed when the collection matches, neutral when it does not, and
   *   forbidden with max-age 0 when it cannot be evaluated.
   */
  public function evaluate(array $conditions, string $operator = 'and'): AccessResultInterface {
    if (!in_array($operator, ['and', 'or'], TRUE)) {
      return $this->fail('Unknown condition operator @operator.', ['@operator' => $operator]);
    }
    $cache = new CacheableMetadata();
    $instances = [];
    try {
      foreach (new ConditionPluginCollection($this->conditionManager, $conditions) as $id => $condition) {
        if ($condition instanceof ContextAwarePluginInterface) {
          $mapping = array_filter($condition->getContextMapping());
          $contexts = $mapping === [] ? [] : $this->contextRepository->getRuntimeContexts(array_values($mapping));
          // Core ignores a mapping to an unknown optional context; a mapping
          // that names nothing is a configuration error, not an absent value.
          $missing = array_diff($mapping, array_keys($contexts));
          if ($missing !== []) {
            return $this->fail('Condition @id maps unavailable contexts: @contexts.', [
              '@id' => $id,
              '@contexts' => implode(', ', $missing),
            ]);
          }
          $this->contextHandler->applyContextMapping($condition, $contexts);
        }
        $cache->addCacheableDependency($condition);
        $instances[$id] = $condition;
      }
      $matched = $instances === [] ? $operator === 'and' : $this->resolveConditions($instances, $operator);
    }
    catch (\Exception $exception) {
      return $this->fail('Conditions cannot be evaluated: @message', ['@message' => $exception->getMessage()]);
    }
    return AccessResult::allowedIf($matched)->addCacheableDependency($cache);
  }

  /**
   * Denies an unevaluable collection without caching the decision.
   */
  private function fail(string $message, array $arguments): AccessResultInterface {
    $this->logger->warning($message, $arguments);
    return AccessResult::forbidden()->setCacheMaxAge(0);
  }

}
