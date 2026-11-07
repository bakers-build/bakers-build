<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\field;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Time\BbDate;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The latest timestamp on related entities, e.g. last conductor heartbeat.
 *
 * The views data definition names the related entity type
 * (`related_entity_type`), its reference field (`related_field`) and the
 * timestamp column (`timestamp_field`). The first row asks for the whole
 * result set in one aggregate query; later rows read that map.
 */
#[ViewsField('bb_related_max_timestamp')]
final class BbRelatedMaxTimestamp extends FieldPluginBase {

  /**
   * Formats the latest timestamp as a relative interval.
   */
  private BbDate $date;

  /**
   * Loads the related entity type.
   */
  private EntityTypeManagerInterface $entityTypeManager;

  /**
   * Latest timestamps keyed by the row entity id, filled on the first row.
   *
   * @var array<int|string, int>|null
   */
  private ?array $latest = NULL;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->date = $container->get(BbDate::class);
    $instance->entityTypeManager = $container->get('entity_type.manager');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function query(): void {
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>|string
   *   The latest related time, or nothing when no related row has one.
   */
  public function render(ResultRow $values) {
    $entity = $this->getEntity($values);
    if ($entity === NULL) {
      return '';
    }
    $timestamp = $this->latest()[$entity->id()] ?? 0;
    if ($timestamp <= 0) {
      return '';
    }
    $element = $this->date->time($timestamp);
    $element['#cache'] = [
      'tags' => $this->entityTypeManager
        ->getDefinition($this->definition['related_entity_type'])
        ->getListCacheTags(),
      'max-age' => 0,
    ];
    return $element;
  }

  /**
   * Latest related timestamps for every entity in this result set.
   *
   * @return array<int|string, int>
   *   Timestamp per row entity id.
   */
  private function latest(): array {
    if ($this->latest !== NULL) {
      return $this->latest;
    }
    $ids = [];
    foreach ($this->view->result as $row) {
      $id = $this->getEntity($row)?->id();
      if ($id !== NULL) {
        $ids[] = $id;
      }
    }
    $this->latest = array_fill_keys($ids, 0);
    if ($ids === []) {
      return $this->latest;
    }
    $type = $this->definition['related_entity_type'];
    if (!$this->entityTypeManager->hasDefinition($type)) {
      return $this->latest;
    }
    $results = $this->entityTypeManager->getStorage($type)
      ->getAggregateQuery()
      ->accessCheck(FALSE)
      ->condition($this->definition['related_field'], $ids, 'IN')
      ->condition($this->definition['timestamp_field'], 0, '>')
      ->groupBy($this->definition['related_field'])
      ->aggregate($this->definition['timestamp_field'], 'MAX')
      ->execute();
    foreach ($results as $result) {
      if (!is_array($result)) {
        continue;
      }
      $related = $result[$this->definition['related_field']] ?? NULL;
      if ($related === NULL) {
        continue;
      }
      $this->latest[$related] = (int) ($result[$this->definition['timestamp_field'] . '_max'] ?? 0);
    }
    return $this->latest;
  }

}
