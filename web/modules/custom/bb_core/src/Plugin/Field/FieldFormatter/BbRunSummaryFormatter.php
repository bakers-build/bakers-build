<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Run\TicketRunSummary;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * A ticket's runs: how many, and the state and time of the newest.
 */
#[FieldFormatter(
  id: 'bb_run_summary',
  label: new TranslatableMarkup('Run summary'),
  field_types: ['integer'],
)]
final class BbRunSummaryFormatter extends FormatterBase {

  /**
   * Computes the summary.
   */
  protected TicketRunSummary $runSummary;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->runSummary = $container->get('bb_core.ticket_run_summary');
    return $instance;
  }

  /**
   * {@inheritdoc}
   *
   * @return array<int, array<string, mixed>>
   *   The summary badge, or nothing without runs.
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    if ($items->isEmpty()) {
      return [];
    }
    $summary = $this->runSummary->forTicket($items->getEntity()->id());
    return $summary !== NULL && $summary->count > 0 ? [0 => $summary->build()] : [];
  }

}
