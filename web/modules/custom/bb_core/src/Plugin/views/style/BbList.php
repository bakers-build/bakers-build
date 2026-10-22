<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\style;

use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\TypedData\ComplexDataInterface;
use Drupal\views\Attribute\ViewsStyle;
use Drupal\views\Plugin\views\style\StylePluginBase;

/**
 * Hands Views-rendered fields to `bb_theme:list` as one patterned row each.
 *
 * The pattern names, per region, the ordered field IDs that fill the row's
 * leading avatar, headline, meta line, description, right-hand column and the
 * caption line beneath it (`right_meta`); every region but `headline` is
 * optional and may be absent from a pattern.
 * The plugin carries rendered field output only — access, formatters and
 * cacheability stay with Views — and the theme's
 * `views-view-bb-list.html.twig` turns it into list props.
 */
#[ViewsStyle(
  id: 'bb_list',
  title: new TranslatableMarkup('bakers.build list'),
  help: new TranslatableMarkup('Renders each row as a headline, a meta line and a right-hand column.'),
  theme: 'views_view_bb_list',
  display_types: ['normal'],
)]
final class BbList extends StylePluginBase {

  /**
   * The regions of a patterned row, in render order.
   */
  public const REGIONS = ['avatar', 'headline', 'meta', 'description', 'right', 'right_meta'];

  /**
   * {@inheritdoc}
   */
  protected $usesRowPlugin = FALSE;

  /**
   * {@inheritdoc}
   */
  protected $usesFields = TRUE;

  /**
   * {@inheritdoc}
   */
  protected $usesGrouping = FALSE;

  /**
   * {@inheritdoc}
   */
  protected $usesRowClass = FALSE;

  /**
   * {@inheritdoc}
   */
  protected function defineOptions() {
    $options = parent::defineOptions();
    $options['pattern'] = ['default' => array_fill_keys(self::REGIONS, [])];
    return $options;
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The options form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  public function buildOptionsForm(&$form, FormStateInterface $form_state): void {
    parent::buildOptionsForm($form, $form_state);
    $available = implode(', ', array_keys($this->displayHandler->getFieldLabels()));
    foreach (self::REGIONS as $region) {
      $form['pattern'][$region] = [
        '#type' => 'textfield',
        '#title' => $this->t('@region field IDs', ['@region' => ucfirst($region)]),
        '#description' => $this->t('Comma-separated, in display order. Available: @fields', ['@fields' => $available]),
        '#default_value' => implode(', ', $this->options['pattern'][$region] ?? []),
      ];
    }
  }

  /**
   * {@inheritdoc}
   *
   * @param array<mixed> $form
   *   The options form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  public function submitOptionsForm(&$form, FormStateInterface $form_state): void {
    $pattern = [];
    foreach (self::REGIONS as $region) {
      $value = (string) $form_state->getValue(['style_options', 'pattern', $region]);
      $pattern[$region] = array_values(array_filter(array_map('trim', explode(',', $value))));
    }
    $form_state->setValue(['style_options', 'pattern'], $pattern);
    parent::submitOptionsForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function validate() {
    $errors = parent::validate();
    $fields = $this->displayHandler->getHandlers('field');
    $seen = [];
    foreach (self::REGIONS as $region) {
      foreach ($this->options['pattern'][$region] ?? [] as $key) {
        if (!isset($fields[$key])) {
          $errors[] = $this->t('The @region region names the unknown field @field.', [
            '@region' => $region,
            '@field' => $key,
          ]);
        }
        elseif (!empty($fields[$key]->options['exclude'])) {
          $errors[] = $this->t('The @region region names the excluded field @field.', [
            '@region' => $region,
            '@field' => $key,
          ]);
        }
        if (isset($seen[$key])) {
          $errors[] = $this->t('The field @field is assigned to more than one region.', ['@field' => $key]);
        }
        $seen[$key] = TRUE;
      }
    }
    return $errors;
  }

  /**
   * {@inheritdoc}
   *
   * Each row carries the rendered output of the pattern's fields and the
   * entity behind it. A field Views removed for access, or one the display
   * excludes, contributes nothing, so its value is absent rather than raw.
   */
  public function render(): array {
    $this->renderFields($this->view->result);
    $pattern = [];
    $labels = [];
    foreach (self::REGIONS as $region) {
      $pattern[$region] = [];
      foreach ($this->options['pattern'][$region] ?? [] as $key) {
        $field = $this->view->field[$key] ?? NULL;
        if ($field === NULL || !empty($field->options['exclude'])) {
          continue;
        }
        $pattern[$region][] = $key;
        $label = (string) $field->label();
        if ($label !== '') {
          $labels[$key] = $label;
        }
      }
    }

    $rows = [];
    foreach ($this->view->result as $index => $row) {
      $fields = [];
      foreach (array_merge(...array_values($pattern)) as $key) {
        $fields[$key] = $this->getField($index, $key) ?? '';
      }
      // `_entity` is what SQL and Search API rows carry; `_object` is the
      // Search API fallback when the original entity could not be loaded.
      $values = get_object_vars($row);
      $entity = $values['_entity'] ?? NULL;
      $object = $values['_object'] ?? NULL;
      if ($entity === NULL && $object instanceof ComplexDataInterface) {
        $entity = $object->getValue();
      }
      $rows[] = ['fields' => $fields, 'entity' => $entity];
    }

    return [
      [
        '#theme' => $this->themeFunctions(),
        '#view' => $this->view,
        '#options' => ['pattern' => $pattern, 'labels' => $labels] + $this->options,
        '#rows' => $rows,
      ],
    ];
  }

}
