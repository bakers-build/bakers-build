<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\search_api\processor;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\search_api\Attribute\SearchApiProcessor;
use Drupal\search_api\Datasource\DatasourceInterface;
use Drupal\search_api\IndexInterface;
use Drupal\search_api\Item\ItemInterface;
use Drupal\search_api\Processor\ProcessorPluginBase;
use Drupal\search_api\Processor\ProcessorProperty;

/**
 * Indexes the ticket priority as a sort rank: 1–3, and 4 when unset.
 *
 * Sorting the raw `priority` puts an unset priority first on ascending order,
 * because the backend sorts NULL before every value. The rank keeps High
 * first and unset last on any backend, for every list that sorts by urgency.
 */
#[SearchApiProcessor(
  id: 'bb_ticket_priority_rank',
  label: new TranslatableMarkup('bakers.build priority rank'),
  description: new TranslatableMarkup('Adds the ticket priority as a sort rank, unset priority last.'),
  stages: ['add_properties' => 0],
  locked: FALSE,
  hidden: FALSE,
)]
final class BbTicketPriorityRank extends ProcessorPluginBase {

  /**
   * {@inheritdoc}
   *
   * `isValidDatasource()`, not `getDatasource()`: an index that answers FALSE
   * here has the processor silently stripped in `Index::preSave()`.
   */
  public static function supportsIndex(IndexInterface $index): bool {
    return $index->isValidDatasource('entity:bb_ticket');
  }

  /**
   * {@inheritdoc}
   */
  public function getPropertyDefinitions(?DatasourceInterface $datasource = NULL): array {
    if ($datasource !== NULL) {
      return [];
    }
    return [
      'priority_rank' => new ProcessorProperty([
        'label' => $this->t('Priority rank'),
        'description' => $this->t('Priority 1–3, or 4 when unset, for sorting by urgency.'),
        'type' => 'integer',
        'processor_id' => $this->getPluginId(),
        'is_list' => FALSE,
      ]),
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function addFieldValues(ItemInterface $item): void {
    $entity = $item->getOriginalObject()->getValue();
    if (!$entity instanceof BbTicketInterface) {
      return;
    }
    $priority = $entity->getPriority();
    foreach ($this->getFieldsHelper()->filterForPropertyPath($item->getFields(), NULL, 'priority_rank') as $field) {
      $field->addValue(in_array($priority, [1, 2, 3], TRUE) ? $priority : 4);
    }
  }

}
