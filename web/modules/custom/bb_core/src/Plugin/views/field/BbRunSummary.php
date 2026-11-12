<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\field;

use Drupal\bb_core\Run\TicketRunSummary;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * A ticket row's runs summary: count, newest state and time, as a badge.
 *
 * The page's summaries load in one query before the rows render. A ticket
 * without runs shows nothing.
 */
#[ViewsField('bb_run_summary')]
final class BbRunSummary extends FieldPluginBase {

  /**
   * Computes the summaries.
   */
  private TicketRunSummary $runSummary;

  /**
   * The page's summaries, keyed by ticket id.
   *
   * @var array<int, \Drupal\bb_core\Run\RunSummary>
   */
  private array $summaries = [];

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->runSummary = $container->get('bb_core.ticket_run_summary');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function query(): void {
  }

  /**
   * {@inheritdoc}
   */
  public function preRender(&$values): void {
    $ids = [];
    foreach ($values as $row) {
      $ids[] = $this->getEntity($row)?->id();
    }
    $this->summaries = $this->runSummary->forTickets(array_filter($ids, static fn ($id): bool => $id !== NULL));
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>|string
   *   The summary badge, or nothing without runs.
   */
  public function render(ResultRow $values) {
    $summary = $this->summaries[(int) $this->getEntity($values)?->id()] ?? NULL;
    return $summary !== NULL && $summary->count > 0 ? $summary->build() : '';
  }

}
