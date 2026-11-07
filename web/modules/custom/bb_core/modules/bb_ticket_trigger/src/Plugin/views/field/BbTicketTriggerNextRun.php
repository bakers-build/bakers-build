<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Plugin\views\field;

use Drupal\bb_core\Time\BbDate;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The next due occurrence as the product time, or "—".
 */
#[ViewsField('bb_ticket_trigger_next_run')]
final class BbTicketTriggerNextRun extends FieldPluginBase {

  /**
   * Formats the next run.
   */
  private BbDate $date;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->date = $container->get(BbDate::class);
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
  public function render(ResultRow $values): string|array {
    $trigger = $this->getEntity($values);
    $next = $trigger instanceof BbTicketTriggerInterface ? $trigger->getNextRun() : NULL;
    if ($next === NULL) {
      return '—';
    }
    return $this->date->time($next);
  }

}
