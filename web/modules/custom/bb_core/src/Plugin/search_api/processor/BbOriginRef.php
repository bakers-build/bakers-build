<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\search_api\processor;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Ticket\OriginReference;
use Drupal\search_api\Attribute\SearchApiProcessor;
use Drupal\search_api\Datasource\DatasourceInterface;
use Drupal\search_api\IndexInterface;
use Drupal\search_api\Item\ItemInterface;
use Drupal\search_api\Processor\ProcessorPluginBase;
use Drupal\search_api\Processor\ProcessorProperty;

/**
 * Indexes the ticket's origin as a comparable reference.
 *
 * The stored `origin` is a full URL nobody normalises on write, so an exact
 * lookup against it would depend on its spelling and a substring lookup would
 * confuse issue 19 with issue 190. This adds `<repository path>#<number>`,
 * which both problems disappear from.
 *
 * It is a processor-added property and not an entity field on purpose: both
 * surfaces query through this index, so no second storage, update hook or
 * backfill is owed.
 */
#[SearchApiProcessor(
  id: 'bb_origin_ref',
  label: new TranslatableMarkup('bakers.build origin reference'),
  description: new TranslatableMarkup('Adds the ticket origin as <repository path>#<issue number>.'),
  stages: ['add_properties' => 0],
  locked: FALSE,
  hidden: FALSE,
)]
final class BbOriginRef extends ProcessorPluginBase {

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
      'origin_ref' => new ProcessorProperty([
        'label' => $this->t('Origin reference'),
        'description' => $this->t('The origin issue as <repository path>#<number>.'),
        'type' => 'string',
        'processor_id' => $this->getPluginId(),
        'is_list' => FALSE,
      ]),
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function addFieldValues(ItemInterface $item): void {
    $fields = $this->getFieldsHelper()
      ->filterForPropertyPath($item->getFields(), NULL, 'origin_ref');
    if ($fields === []) {
      return;
    }
    $entity = $item->getOriginalObject()->getValue();
    if (!$entity instanceof BbTicketInterface) {
      return;
    }
    $origin = (string) $entity->get('origin')->value;
    $reference = OriginReference::fromUrl($origin);
    if ($reference === NULL) {
      // A real origin that names no issue — a job or a merge request URL —
      // contributes no value rather than a misleading one.
      return;
    }
    foreach ($fields as $field) {
      $field->addValue($reference->key());
    }
  }

}
