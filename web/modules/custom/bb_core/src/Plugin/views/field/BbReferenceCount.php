<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\field;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Template\Attribute;
use Drupal\bb_core\Reference\ReferenceCounter;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * How many entities reference the row, e.g. a project's tickets.
 *
 * The views data definition names the counted entity type
 * (`count_entity_type`), its reference field (`count_field`), extra
 * `conditions` (see ReferenceCounter::count()), and how the count shows: a
 * badge with an `icon`, a `tone` and the number, whose tooltip is the
 * singular/plural text. The counting itself is ReferenceCounter's: the first
 * row asks for the whole result set in one query, later rows read its cache.
 */
#[ViewsField('bb_reference_count')]
final class BbReferenceCount extends FieldPluginBase {

  /**
   * The request-cached reference counter.
   */
  private ReferenceCounter $counter;

  /**
   * Resolves the counted entity type's list cache tags.
   */
  private EntityTypeManagerInterface $entityTypeManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->counter = $container->get(ReferenceCounter::class);
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
   *   A count badge, or nothing without an entity.
   */
  public function render(ResultRow $values) {
    $entity = $this->getEntity($values);
    if ($entity === NULL) {
      return '';
    }
    $ids = [];
    foreach ($this->view->result as $row) {
      $ids[] = $this->getEntity($row)?->id();
    }
    $counts = $this->counter->count(
      $this->definition['count_entity_type'],
      $this->definition['count_field'],
      array_values(array_filter($ids, static fn ($id): bool => $id !== NULL)),
      $this->definition['conditions'] ?? [],
    );
    $count = $counts[$entity->id()] ?? 0;
    if ($count === 0 && !empty($this->definition['hide_zero'])) {
      return '';
    }
    // phpcs:ignore Drupal.Semantics.FunctionT.NotLiteralString
    $meaning = (string) $this->formatPlural($count, $this->definition['singular'], $this->definition['plural']);
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:badge',
      '#props' => [
        'label' => (string) $count,
        'icon' => $this->definition['icon'] ?? NULL,
        'tone' => $this->definition['tone'] ?? 'neutral',
        'attributes' => new Attribute(['title' => $meaning, 'role' => 'img', 'aria-label' => $meaning]),
      ],
      // Views caches the row by its own entity only: any counted entity
      // saved anywhere must recount, and the count is the reader's own.
      '#cache' => [
        'tags' => $this->entityTypeManager->getDefinition($this->definition['count_entity_type'])->getListCacheTags(),
        'contexts' => ['user'],
      ],
    ];
  }

}
