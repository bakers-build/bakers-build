<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\better_exposed_filters\filter;

use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\better_exposed_filters\Attribute\FiltersWidget;
use Drupal\better_exposed_filters\Plugin\BetterExposedFiltersWidgetBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Renders one exposed filter as bb_theme:option_picker.
 *
 * A BEF widget rather than a theme override, so each facet configures its own
 * single/multiple, search and clear label. It renders only: a pick is the
 * exposed form's own GET. `#input` is required so the form builder reads
 * `state[]` into `exposed_data`; the picker stays unnamed so values are not
 * submitted twice. Labels come from the facets' build processors.
 *.
 */
#[FiltersWidget(
  id: 'bb_option_picker',
  title: new TranslatableMarkup('bakers.build option picker'),
)]
final class BbOptionPickerWidget extends BetterExposedFiltersWidgetBase {

  /**
   * The exposed-filter sentinel for "nothing is chosen".
   */
  private const ANY = 'All';

  /**
   * What a submitted value that states nothing looks like.
   *
   * `FacetsFilter::hasActiveExposedValue()` key for key — an inactive value is
   * exactly `''` or `All`. That method is `private` and is consulted only for
   * the exposed-filter dependency check, never for the path that builds the
   * query, so the predicate is restated where it is needed.
   */
  private const NOT_CHOSEN = ['', self::ANY];

  /**
   * The query keys that are never a filter value.
   *
   * The two `ViewExecutable::getExposedInput()` unsets, plus one listed on
   * evidence rather than on suspicion. `ajax_page_state` is written by
   * `core/misc/ajax.js` alone and this screen never loads that file — measured
   * on the live surface, the rendered document contains the string zero times,
   * the boost is htmx, and the boosted region declares no `hx-vals` or
   * `hx-params` that could add one. One list entry against it is cheaper than
   * the surprise of Views AJAX being turned on for this display later.
   */
  private const NOT_FILTERS = ['page', 'q', 'ajax_page_state'];

  /**
   * {@inheritdoc}
   *
   * @param \Symfony\Component\DependencyInjection\ContainerInterface $container
   *   The service container.
   * @param array<string, mixed> $configuration
   *   The plugin configuration.
   * @param string $plugin_id
   *   The plugin id.
   * @param mixed $plugin_definition
   *   The plugin definition.
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    return new static(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('request_stack')->getCurrentRequest(),
      $container->get('config.factory'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public static function isApplicable(mixed $filter = NULL, array $filter_options = []): bool {
    // A picker offers a LIST to choose from, so it fits a filter that HAS one:
    // the facets filter the seven facets of this screen are, and core's
    // InOperator, which is the same shape without Search API. Both are named
    // by string rather than by class, exactly as BEF names taxonomy and Search
    // API filters, so this module depends on neither.
    return is_a($filter, 'Drupal\facets_exposed_filters\Plugin\views\filter\FacetsFilter')
      || is_a($filter, 'Drupal\views\Plugin\views\filter\InOperator');
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   The default per-filter configuration.
   */
  public function defaultConfiguration(): array {
    return parent::defaultConfiguration() + [
      // Never a generic word: the sentence a reader picks is about this field.
      'clear_label' => '',
      'icon' => '',
      'searchable' => FALSE,
    ];
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The configuration form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The state of the settings form this one is a subform of.
   *
   * @return array<string, mixed>
   *   The configuration form.
   */
  public function buildConfigurationForm(array $form, FormStateInterface $form_state): array {
    $form['clear_label'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Clear row label'),
      '#default_value' => $this->configuration['clear_label'],
      '#description' => $this->t('What the first row of the panel says when nothing is chosen — "Any state", "No conductor". It names this field and is never a generic word.'),
    ];
    $form['icon'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Trigger icon'),
      '#default_value' => $this->configuration['icon'],
      '#description' => $this->t('Sprite name drawn before the label on the trigger. Leave empty for none.'),
    ];
    $form['searchable'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Searchable'),
      '#default_value' => $this->configuration['searchable'],
      '#description' => $this->t('Render a search box above the rows, for a field with more options than a reader can scan.'),
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   *
   * BEF's own submit copies every matching form value into the configuration
   * verbatim, so a checkbox arrives as the integer 0 or 1. The config schema
   * types `searchable` as a boolean — because that is what it is — and a
   * strict schema check rejects the integer, which aborts the save of any view
   * that uses this widget. Casting here rather than widening the schema keeps
   * the stored value the same shape `defaultConfiguration()` declares.
   *
   * @param array<string, mixed> $form
   *   The configuration form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The state of the settings form this one is a subform of.
   *
   * @param-out array $form
   */
  public function submitConfigurationForm(array &$form, FormStateInterface $form_state): void {
    parent::submitConfigurationForm($form, $form_state);
    $this->configuration['searchable'] = (bool) $this->configuration['searchable'];
    $this->configuration['clear_label'] = (string) $this->configuration['clear_label'];
    $this->configuration['icon'] = (string) $this->configuration['icon'];
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The exposed form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The exposed form state, which carries the request's own input.
   */
  public function exposedFormAlter(array &$form, FormStateInterface $form_state): void {
    $key = $this->exposedKey($form);
    if ($key === NULL) {
      return;
    }

    $element = $form[$key];
    $options = array_map(
      static fn (mixed $label): string => (string) $label,
      $element['#options'] ?? [],
    );
    // Views' `All => - Any -` row is not offered: inside a multi-value group
    // FacetsFilter queries `All` as a literal value and matches nothing.
    // Clearing is `clear_url` below, for all seven facets alike.
    unset($options[self::ANY]);
    // The field holds several values, which is one fact with two renderings:
    // `aria-multiselectable` on the listbox and a checkbox rather than a radio
    // in each row.
    $multiple = !empty($element['#multiple']) || ($element['#type'] ?? '') === 'checkboxes';
    $values = $this->pickedValues($element, $form_state, $key);
    $options = $this->withChosenRows($options, $values);

    $form[$key] = [
      '#type' => 'component',
      '#component' => 'bb_theme:option_picker',
      // See the class docblock: without this the picked value never reaches
      // `$view->exposed_data` and the facet filters nothing.
      '#input' => TRUE,
      '#default_value' => $element['#default_value'] ?? ($multiple ? [] : self::ANY),
      '#props' => [
        'variant' => 'facet',
        'label' => $this->exposedLabel($element, $key),
        'id' => 'filter-' . $key,
        'open' => FALSE,
        'multiple' => $multiple,
        'values' => $values,
        'value_labels' => array_values(array_intersect_key($options, array_flip($values))),
        'searchable' => (bool) $this->configuration['searchable'],
      ] + array_filter(['icon' => (string) $this->configuration['icon']]),
      '#slots' => [
        'options' => [
          '#type' => 'component',
          '#component' => 'bb_theme:option_list',
          '#props' => [
            'multiple' => $multiple,
            // A field a reader can set and never empty is a lost capability,
            // so the clear row is not optional here.
            'clearable' => TRUE,
            'clear_label' => (string) $this->configuration['clear_label'],
            // Clearing is a link, not a submitted empty value: FacetsFilter
            // treats `''` as an active item and would match nothing.
            'clear_url' => (string) $this->addressWithoutFacet($key),
            // The half that makes the facet operable: a real control per row,
            // named for this filter, so a pick is submitted by the exposed
            // form itself.
            'input_name' => $key,
            'input_type' => $multiple ? 'checkbox' : 'radio',
            'options' => array_map(
              static fn (string $value, string $label): array => [
                'value' => $value,
                'label' => $label,
                'selected' => in_array($value, $values, TRUE),
              ],
              array_map(strval(...), array_keys($options)),
              $options,
            ),
          ],
        ],
      ],
    ];
  }

  /**
   * What this facet is called, as a reader reads it.
   *
   * Read from the handler's expose options, not `#title`, which Views leaves
   * unset on exposed elements; `active-filters` reads the same label.
   *
   * @param array<string, mixed> $element
   *   The exposed form element.
   * @param string $key
   *   The exposed identifier, the last-resort fallback.
   */
  private function exposedLabel(array $element, string $key): string {
    $label = (string) ($this->handler->options['expose']['label'] ?? '');
    if ($label !== '') {
      return $label;
    }
    return (string) ($element['#title'] ?? $key);
  }

  /**
   * The exposed-form key this widget owns, or NULL when it is not in the form.
   *
   * @param array<string, mixed> $form
   *   The exposed form.
   */
  private function exposedKey(array $form): ?string {
    // The handler is a typed property BEF sets before it calls this widget;
    // reading it unset is a fatal, so the guard is on the property and not on
    // its value.
    if (!isset($this->handler)) {
      return NULL;
    }
    $identifier = (string) ($this->handler->options['expose']['identifier'] ?? '');
    return $identifier !== '' && isset($form[$identifier]) ? $identifier : NULL;
  }

  /**
   * The values currently chosen, as a list of real option keys.
   *
   * Read from the USER INPUT first, because a widget runs while the exposed
   * form is being built and the form builder has not set `#value` yet — the
   * request is the only place the current selection exists at that moment.
   * The `All` sentinel is dropped: "nothing is chosen" is not a value, and a
   * row marked selected for it would say the operator picked something.
   *
   * @param array<string, mixed> $element
   *   The exposed form element.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The exposed form state.
   * @param string $key
   *   The exposed identifier.
   *
   * @return array<int, string>
   *   The chosen values, in the order the request carries them.
   */
  private function pickedValues(array $element, FormStateInterface $form_state, string $key): array {
    $raw = $form_state->getUserInput()[$key]
      ?? $element['#value']
      ?? $element['#default_value']
      ?? [];

    $chosen = array_map(strval(...), is_array($raw) ? array_values($raw) : [$raw]);
    return array_values(array_unique(array_filter(
      $chosen,
      static fn (string $value): bool => !in_array($value, self::NOT_CHOSEN, TRUE),
    )));
  }

  /**
   * The address this list would be at with one facet cleared, or NULL.
   *
   * NULL when nothing is chosen, so a clear row never links to the current
   * address. Only the path comes from the request; the pager is dropped
   * because `NOT_FILTERS` excludes `page`. A list stays `id[]=value` per
   * value, matching the chip dismiss links in
   * `views-filters-summary.html.twig`; a scalar stays `id=value`, which is
   * the shape sort, search and closed actually submit.
   *
   * @param string $identifier
   *   The facet's exposed identifier, which is also its name in the URL.
   *
   * @return string|null
   *   The address, or NULL when there is nothing to clear.
   */
  private function addressWithoutFacet(string $identifier): ?string {
    $applied = [];
    foreach ($this->request->query->all() as $key => $value) {
      if (in_array((string) $key, self::NOT_FILTERS, TRUE)) {
        continue;
      }
      $values = $this->chosenValues($value);
      if ($values !== []) {
        // Keep the submitted shape: a checkbox facet arrives as a list
        // (`state[]=coding`), sort/search/closed as a scalar. Rewriting a
        // scalar as `key[]=value` makes Better Exposed Filters explode() it.
        $applied[(string) $key] = is_array($value) ? $values : $values[0];
      }
    }
    if (!isset($applied[$identifier])) {
      return NULL;
    }
    unset($applied[$identifier]);
    $path = $this->request->getBaseUrl() . $this->request->getPathInfo();
    return $applied === [] ? $path : $path . '?' . $this->query($applied);
  }

  /**
   * One query entry's values, with everything that states nothing dropped.
   *
   * @param mixed $raw
   *   Whatever the query string holds for one key.
   *
   * @return array<int, string>
   *   The values that state a constraint.
   */
  private function chosenValues(mixed $raw): array {
    $values = is_array($raw) ? array_values($raw) : [$raw];
    return array_values(array_map(strval(...), array_filter(
      $values,
      static fn (mixed $value): bool => is_scalar($value)
        && !in_array((string) $value, self::NOT_CHOSEN, TRUE),
    )));
  }

  /**
   * A filter set as the query string an exposed form would have submitted.
   *
   * A list is `state[]=coding`, NOT `state[0]=coding`, and the two are not
   * interchangeable to a reader even though `parse_str()` cannot tell them
   * apart. A scalar is `sort_bef_combine=changed_DESC`, never
   * `sort_bef_combine[]=…`: Better Exposed Filters explodes the sort value
   * and a clear request that rewrites it as an array returns 500. The address
   * is the product's shareable artefact, so a picked facet and a remaining
   * facet after a clear must read the same, and a remaining scalar must stay
   * a scalar. `UrlHelper::buildQuery()` writes the indexed form, which would
   * have given one screen two spellings of one state.
   *
   * @param array<string, string|array<int, string>> $applied
   *   Exposed identifier => the chosen value, or values when the request
   *   carried a list.
   *
   * @return string
   *   The query string, without a leading `?`.
   */
  private function query(array $applied): string {
    $pairs = [];
    foreach ($applied as $identifier => $value) {
      $values = is_array($value) ? $value : [$value];
      $suffix = is_array($value) ? '[]' : '';
      foreach ($values as $item) {
        $pairs[] = rawurlencode((string) $identifier) . $suffix . '=' . rawurlencode($item);
      }
    }
    return implode('&', $pairs);
  }

  /**
   * The option set, with a row for every chosen value it does not offer.
   *
   * With `min_count: 1`, contrib drops a chosen value when the facet's result
   * set is empty; an unrendered checkbox is not submitted, so the next pick
   * would silently widen the query. The row reads by its raw value because no
   * result exists to label it.
   *
   * @param array<array-key, string> $options
   *   The option set the filter offers, keyed by submitted value.
   * @param array<int, string> $values
   *   The chosen values.
   *
   * @return array<array-key, string>
   *   The option set, with the missing chosen rows appended.
   */
  private function withChosenRows(array $options, array $values): array {
    foreach ($values as $value) {
      if (!isset($options[$value])) {
        $options[$value] = $value;
      }
    }
    return $options;
  }

}
