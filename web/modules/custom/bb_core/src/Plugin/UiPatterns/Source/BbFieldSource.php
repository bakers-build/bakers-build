<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableDependencyInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\Render\Element;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * A field of the entity, shaped by the prop it fills.
 *
 * A slot gets the whole field through a formatter, so an empty field still
 * reaches it (UI Patterns' `field_formatter` source renders item by item and
 * drops a formatter's empty state). A list prop gets every item's main value,
 * any other prop the first one. Computed fields work too: UI Patterns derives
 * `field_property` sources from storage definitions, which core gives computed
 * base fields none of.
 */
#[Source(
  id: 'bb_field',
  label: new TranslatableMarkup('[bakers.build] Field'),
  description: new TranslatableMarkup('A field: rendered for a slot, its values for a prop. Computed fields included.'),
  prop_types: ['slot', 'string', 'enum', 'number', 'boolean', 'list'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity', label: new TranslatableMarkup('Entity'), required: TRUE),
  ],
)]
final class BbFieldSource extends SourcePluginBase {

  /**
   * {@inheritdoc}
   */
  public function defaultSettings(): array {
    return ['field' => '', 'type' => '', 'settings' => []];
  }

  /**
   * {@inheritdoc}
   */
  public function settingsForm(array $form, FormStateInterface $form_state): array {
    $form['field'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Field name'),
      '#default_value' => $this->getSetting('field'),
      '#required' => TRUE,
    ];
    if ($this->propType() === 'slot') {
      $form['type'] = [
        '#type' => 'textfield',
        '#title' => $this->t('Formatter'),
        '#default_value' => $this->getSetting('type'),
        '#required' => TRUE,
      ];
    }
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $slot = $this->propType() === 'slot';
    $items = $this->items();
    if ($items === NULL) {
      return $slot ? [] : NULL;
    }
    if ($slot) {
      return $this->render($items);
    }
    $this->addCacheableDependency($items->getEntity());
    if ($items instanceof CacheableDependencyInterface) {
      $this->addCacheableDependency($items);
    }
    $values = [];
    foreach ($items as $item) {
      $values[] = $item->get($item->mainPropertyName())->getValue();
    }
    return $this->propType() === 'list' ? $values : ($values[0] ?? NULL);
  }

  /**
   * The configured field of the context entity, if the reader may view it.
   */
  private function items(): ?FieldItemListInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    $field = (string) $this->getSetting('field');
    if (!$entity instanceof FieldableEntityInterface || !$entity->hasField($field)) {
      return NULL;
    }
    $items = $entity->get($field);
    return $items->access('view') ? $items : NULL;
  }

  /**
   * The formatter's elements, without the field wrapper.
   *
   * @return array<string|int, mixed>
   *   The render array.
   */
  private function render(FieldItemListInterface $items): array {
    $build = $items->view([
      'type' => (string) $this->getSetting('type'),
      'settings' => (array) ($this->getSetting('settings') ?? []),
      'label' => 'hidden',
    ]);
    $elements = array_intersect_key($build, array_flip(Element::children($build)));
    CacheableMetadata::createFromRenderArray($build)->applyTo($elements);
    return $elements;
  }

  /**
   * The prop type plugin ID of the prop this source fills.
   */
  private function propType(): string {
    $type = $this->propDefinition['ui_patterns']['type_definition'] ?? NULL;
    return $type ? (string) $type->getPluginId() : '';
  }

}
