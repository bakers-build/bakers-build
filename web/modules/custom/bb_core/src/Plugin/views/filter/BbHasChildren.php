<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\filter;

use Drupal\Core\Database\Connection;
use Drupal\bb_core\EventSubscriber\HasChildrenFilterSubscriber;
use Drupal\search_api\Plugin\views\SearchApiHandlerTrait;
use Drupal\views\Attribute\ViewsFilter;
use Drupal\views\Plugin\views\filter\BooleanOperator;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Narrows a ticket list to the tickets with at least one sub-ticket.
 *
 * Switched on, it adds `ticket_id IN (<every parent id>)` to the Search API
 * query, by the rule JSON:API's `filter[has_children]` applies. Indexing a
 * flag instead would need a parent re-indexed whenever a child moves. Off, it
 * narrows nothing: there is no "has no sub-tickets" position.
 */
#[ViewsFilter('bb_has_children')]
final class BbHasChildren extends BooleanOperator {

  use SearchApiHandlerTrait;

  /**
   * The database the parent ids are read from.
   */
  private Connection $database;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->database = $container->get('database');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function query(): void {
    $query = $this->getQuery();
    if ($query === NULL || empty($this->value)) {
      return;
    }
    $query->addCondition($this->realField, HasChildrenFilterSubscriber::parentIds($this->database), 'IN', $this->options['group']);
  }

}
