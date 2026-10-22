<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldWidget;

use Drupal\Component\Serialization\Json;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Field\Attribute\FieldWidget;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\WidgetBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Security\TrustedCallbackInterface;
use Drupal\bb_core\Reference\ReferenceOptions;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Renders a property picker as a Drupal field widget.
 *
 * Drupal owns input extraction, required checks and field errors.
 *
 * @SuppressWarnings("PHPMD.TooManyPublicMethods")
 */
#[FieldWidget(
  id: 'bb_picker',
  label: new TranslatableMarkup('bakers.build picker'),
  description: new TranslatableMarkup('A property pill of an add or edit surface, composed into bb_theme:form.'),
  field_types: ['entity_reference', 'list_string', 'list_integer'],
  multiple_values: TRUE,
)]
final class PickerWidget extends WidgetBase implements PickerWidgetInterface, ContainerFactoryPluginInterface, TrustedCallbackInterface {

  /**
   * The submitted field's entity context supplied by Drupal's extraction pass.
   */
  private ?FieldItemListInterface $submittedItems = NULL;

  /**
   * Reads the access-checked candidates of an entity-reference field.
   *
   * Protected, as is the request stack: the widget is its own `#pre_render`
   * callback, so a cached form serializes it, and DependencySerializationTrait
   * restores only the services it can see from the base class.
   */
  protected ReferenceOptions $referenceOptions;

  /**
   * The request, read only for {@see openingValues()}.
   */
  protected RequestStack $requestStack;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $widget = new static(
      $plugin_id,
      $plugin_definition,
      $configuration['field_definition'],
      $configuration['settings'],
      $configuration['third_party_settings'],
    );
    $widget->referenceOptions = $container->get('bb_core.reference_options');
    $widget->requestStack = $container->get('request_stack');
    return $widget;
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   The widget's default settings.
   */
  public static function defaultSettings(): array {
    return [
      // Where in the grammar this field renders. A form display's own
      // `region` key is core's two-valued content/hidden switch and cannot
      // say "lead" or "lines", so the grammar's region is a setting of the
      // widget — which is also the only thing that knows what the field is.
      // Named `picker_region` rather than `region` precisely so the two are
      // never mistaken for each other in the exported config.
      'picker_region' => PickerWidgetInterface::REGION_PILLS,
      'label' => '',
      'icon' => '',
      'searchable' => FALSE,
      'selected_chips' => FALSE,
      // Whether a full page also renders the rows as noscript form controls,
      // so the field can be set without JavaScript.
      'fallback' => FALSE,
      // Never a generic word: the sentence a reader picks is about this
      // field, the same rule `BbOptionPickerWidget` states for the facets.
      // Empty renders no clear row at all, which is how a field that must
      // always hold a value (a ticket's project) is expressed.
      'clear_label' => '',
      'create_label' => '',
      // The query parameter this field takes its opening value from when the
      // request carries no submitted value for it — `action-pattern.md` rule
      // 8's context resolution, as widget configuration rather than as a name
      // table in a form class. Empty means the field opens on whatever the
      // entity already holds.
      'context_parameter' => '',
      // The value this field opens on when the entity holds none and the
      // request carries none — the last of the three opening sources, after
      // the entity's own value and `context_parameter`. A field whose grammar
      // says it is never unset (a ticket's workflow decides its whole state
      // flow, so the dialog opens on one rather than on nothing) states it
      // here rather than in a form class.
      'default_value' => '',
      // The sentence rule 9 asks a side-effecting field to NAME at the
      // control. All three empty renders no note.
      'note_lead' => '',
      'note_prefix' => '',
      'note_suffix' => '',
      // A selection handler plugin id that replaces the field's own for this
      // form display only, e.g. the create dialog's project-scoped relations.
      // Empty uses the field's handler.
      'selection_handler' => '',
    ];
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The settings form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The state of the form this one is a subform of.
   *
   * @return array<string, mixed>
   *   The settings form.
   */
  public function settingsForm(array $form, FormStateInterface $form_state): array {
    $element = [];
    $element['picker_region'] = [
      '#type' => 'select',
      '#title' => $this->t('Picker region'),
      '#default_value' => $this->getSetting('picker_region'),
      '#options' => [
        PickerWidgetInterface::REGION_LEAD => $this->t('Lead (its own row, above the lines)'),
        PickerWidgetInterface::REGION_PILLS => $this->t('Peer property (the pill row)'),
      ],
    ];
    foreach ([
      'label' => $this->t('Field name shown on the pill'),
      'icon' => $this->t('Leading sprite symbol'),
      'clear_label' => $this->t('Clear row label, or empty for no clear row'),
      'create_label' => $this->t('Create row noun, or empty for no create row'),
      'context_parameter' => $this->t('Query parameter this field opens on'),
      'default_value' => $this->t('Value this field opens on, absent any other'),
      'note_lead' => $this->t('Note lead word, or empty for no note'),
      'note_prefix' => $this->t('Note text before the value'),
      'note_suffix' => $this->t('Note text after the value'),
      'selection_handler' => $this->t("Selection handler replacing the field's own, or empty"),
    ] as $name => $title) {
      $element[$name] = [
        '#type' => 'textfield',
        '#title' => $title,
        '#default_value' => $this->getSetting($name),
      ];
    }
    $element['searchable'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Render a search box above the rows'),
      '#default_value' => $this->getSetting('searchable'),
    ];
    $element['selected_chips'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Render each selected value as a removable chip'),
      '#default_value' => $this->getSetting('selected_chips'),
    ];
    $element['fallback'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Render a no-JavaScript fallback on full pages'),
      '#default_value' => $this->getSetting('fallback'),
    ];
    return $element;
  }

  /**
   * {@inheritdoc}
   *
   * @return array<int, \Drupal\Core\StringTranslation\TranslatableMarkup>
   *   The settings summary.
   */
  public function settingsSummary(): array {
    return [
      $this->t('@label in the @region region', [
        '@label' => $this->getSetting('label') !== '' ? $this->getSetting('label') : $this->fieldDefinition->getLabel(),
        '@region' => $this->getSetting('picker_region'),
      ]),
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function formElement(FieldItemListInterface $items, $delta, array $element, array &$form, FormStateInterface $form_state): array {
    // The pill supplies its label and optional user-facing explanatory note.
    $element['#description'] = '';
    return $element + [
      '#type' => 'bb_picker_value',
      '#title_display' => 'invisible',
      '#default_value' => $this->currentValues($items) ?: $this->openingValues($items),
      '#pre_render' => [[$this, 'renderPicker']],
      '#picker_items' => $items,
    ];
  }

  /**
   * Renders the widget after Drupal has processed all submitted field values.
   *
   * @param array<string, mixed> $element
   *   The processed field element.
   *
   * @return array<string, mixed>
   *   The field control and its optional explanatory note.
   */
  public function renderPicker(array $element): array {
    $items = $this->submittedItems ?? clone $element['#picker_items'];
    assert($items instanceof FieldItemListInterface);
    if ($this->submittedItems === NULL) {
      $items->setValue($element['#value']);
    }
    $element['control'] = $this->pickerElement($items);
    $element['control']['#props']['picker_id'] = $element['#id'];
    $element['note'] = $this->pickerNote($items);
    return $element;
  }

  /**
   * The submitted target ids the configured selection handler rejects.
   *
   * Empty without a `selection_handler` setting.
   *
   * @param \Drupal\Core\Field\FieldItemListInterface $items
   *   The submitted items on the entity being saved.
   * @param array<int|string> $kept
   *   Ids already stored on the entity; they are not checked again.
   *
   * @return list<string>
   *   The rejected ids.
   */
  public function rejectedValues(FieldItemListInterface $items, array $kept = []): array {
    $handler = (string) $this->getSetting('selection_handler');
    if ($handler === '') {
      return [];
    }
    $entity = $items->getEntity();
    assert($entity instanceof ContentEntityInterface);
    $ids = array_values(array_diff($this->currentValues($items), array_map('strval', $kept)));
    return $this->referenceOptions->unreferenceable($entity, $this->fieldDefinition->getName(), $ids, $handler);
  }

  /**
   * Retains Drupal's submitted entity context for dependent picker options.
   */
  public function extractFormValues(FieldItemListInterface $items, array $form, FormStateInterface $form_state): void {
    parent::extractFormValues($items, $form, $form_state);
    $this->submittedItems = $items;
  }

  /**
   * {@inheritdoc}
   */
  public static function trustedCallbacks(): array {
    return ['renderPicker'];
  }

  /**
   * {@inheritdoc}
   *
   * @param array<int, mixed> $values
   *   The raw submitted value: one scalar, or a list of them.
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   *
   * @return array<int, array<string, string>>
   *   Field item values. An empty submission produces NO items at all —
   *   `option_picker.twig` renders one hidden input per selected value and
   *   none when nothing is set, so a cleared picker is an ABSENT key and this
   *   is where that becomes an unset field rather than an empty sentinel
   *   (spec D5).
   */
  public function massageFormValues(array $values, array $form, FormStateInterface $form_state): array {
    $property = $this->valueProperty();
    $items = [];
    foreach ($this->normalise($values) as $value) {
      $items[] = [$property => $value];
    }
    return $items;
  }

  /**
   * {@inheritdoc}
   */
  public function pickerRegion(): string {
    return (string) $this->getSetting('picker_region');
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   The `bb_theme:property_pill` render array for this field.
   */
  public function pickerElement(FieldItemListInterface $items): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:property_pill',
      '#props' => $this->pickerProps($items) + [
        // Grammar 3a's weight, asked for by the field that carries it rather
        // than applied by whatever places it: the region IS the widget's own
        // setting, so nothing else has to know which field is the lead.
        'prominent' => $this->pickerRegion() === PickerWidgetInterface::REGION_LEAD,
      ],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function pickerLabel(): string {
    $label = (string) $this->getSetting('label');
    return $label !== '' ? $label : (string) $this->fieldDefinition->getLabel();
  }

  /**
   * This field's props, in `bb_theme:property_pill`'s own vocabulary.
   *
   * @param \Drupal\Core\Field\FieldItemListInterface $items
   *   The field's items on the entity the submitted values describe.
   *
   * @return array<string, mixed>
   *   The pill's props.
   */
  private function pickerProps(FieldItemListInterface $items): array {
    $options = $this->options($items);
    // Edit forms must retain a stored value or rejected attempt the picker
    // does not offer. It shows its title only when the reader may view it.
    if (!$items->getEntity()->isNew()) {
      $missing = array_values(array_diff($this->currentValues($items), array_map('strval', array_keys($options))));
      $host = $items->getEntity();
      assert($host instanceof ContentEntityInterface);
      $viewable = $this->referenceOptions->viewableLabels($host, $this->fieldDefinition->getName(), $missing);
      foreach ($missing as $value) {
        $options[$value] = $viewable[$value] ?? (string) $this->t('Unavailable selection (@value)', ['@value' => $value]);
      }
    }
    // A value the field does not OFFER is not a value the field is showing.
    // Measured on `?create=ticket&project=999999` before this rule existed:
    // an enabled submit, a hidden input carrying the unknown id, and a pill
    // rendering no value and no selected row, because nothing checked the id
    // against this account's own candidates. A picker cannot display a value
    // it has no row for, so it does not claim to.
    $values = array_values(array_filter(
      $this->currentValues($items),
      static fn (string $value): bool => array_key_exists($value, $options),
    ));
    $multiple = $this->fieldDefinition->getFieldStorageDefinition()->isMultiple();

    $props = [
      'name' => $this->fieldDefinition->getName(),
      'label' => $this->pickerLabel(),
      'icon' => (string) $this->getSetting('icon'),
    ];
    $props += $this->pickedProps($options, $values, $multiple);
    $props['values'] = $values;
    $props['searchable'] = (bool) $this->getSetting('searchable');
    $props['selected_chips'] = (bool) $this->getSetting('selected_chips');
    $props['fallback'] = (bool) $this->getSetting('fallback') && $this->isFullPage();
    $props['selected'] = array_values(array_filter(
      array_map(
        static fn (string $value): array => [
          'value' => $value,
          'label' => $options[$value] ?? '',
        ],
        $values,
      ),
      static fn (array $row): bool => $row['label'] !== '',
    ));
    if ((string) $this->getSetting('clear_label') !== '') {
      $props['clearable'] = TRUE;
      $props['clear_label'] = (string) $this->getSetting('clear_label');
    }
    if ((string) $this->getSetting('create_label') !== '') {
      $props['creatable'] = TRUE;
      $props['create_label'] = (string) $this->getSetting('create_label');
    }
    $props['options'] = $this->optionRows($options, $values);

    return $props;
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   The `bb_theme:note` render array, or an empty array.
   */
  public function pickerNote(FieldItemListInterface $items): array {
    $lead = (string) $this->getSetting('note_lead');
    if ($lead === '') {
      return [];
    }
    $options = $this->options($items);
    $values = $this->currentValues($items);
    $set = $values !== [] && array_key_exists($values[0], $options);
    $name = $this->fieldDefinition->getName();
    $label = $set ? $options[$values[0]] : '';
    // The note listens for the pick rather than being written into by the
    // picker. The picker dispatches `bakers-picker-picked` on the window with
    // the field name and the selected labels; a note whose own field name
    // matches updates itself. The server still renders the label and the
    // `hidden` attribute, so the note reads correctly with JavaScript disabled
    // and Alpine only binds what it already rendered.
    $state = Json::encode(['value' => $label, 'set' => $set]);
    $listener = sprintf(
      "\$event.detail.name === %s && (set = \$event.detail.labels.length > 0, value = set ? \$event.detail.labels[0] : value)",
      Json::encode($name),
    );
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:note',
      '#props' => ['lead' => $lead],
      '#slots' => [
        'body' => [
          ['#plain_text' => (string) $this->getSetting('note_prefix')],
          [
            '#type' => 'html_tag',
            '#tag' => 'span',
            '#attributes' => [
              'data-option-picker-note-value' => TRUE,
              'x-text' => 'value',
            ],
            '#value' => $label,
          ],
          ['#plain_text' => (string) $this->getSetting('note_suffix')],
        ],
      ],
      '#attributes' => [
        'data-option-picker-note' => $name,
        'x-data' => $state,
        '@bakers-picker-picked.window' => $listener,
        ':hidden' => '!set',
      ] + ($set ? [] : ['hidden' => TRUE]),
    ];
  }

  /**
   * The candidates this field offers, keyed by submitted value.
   *
   * @param \Drupal\Core\Field\FieldItemListInterface $items
   *   The field's items, read for the host entity the candidates are scoped
   *   by.
   *
   * @return array<string, string>
   *   Labels keyed by value.
   */
  private function options(FieldItemListInterface $items): array {
    $entity = $items->getEntity();
    // Every surface this widget is configured on is a content entity form;
    // `FieldItemListInterface::getEntity()` is typed one level wider.
    assert($entity instanceof ContentEntityInterface);
    if ($this->fieldDefinition->getType() === 'entity_reference') {
      return $this->plainOptions($this->referenceOptions->for(
        $entity,
        $this->fieldDefinition->getName(),
        handler: (string) $this->getSetting('selection_handler'),
      ));
    }
    // The same read `OptionsWidgetBase::getOptions()` makes: the OPTIONS
    // PROVIDER the storage definition names for this column, which for
    // `bb_ticket.workflow` is its own `allowed_values_function`. The item
    // list itself is not an options provider — measured, as a fatal.
    $provider = $this->fieldDefinition
      ->getFieldStorageDefinition()
      ->getOptionsProvider($this->valueProperty(), $entity);
    return $this->plainOptions($provider?->getSettableOptions() ?? []);
  }

  /**
   * A candidate map as plain strings keyed by plain strings.
   *
   * @param iterable<int|string, mixed> $options
   *   Whatever the field's own options source answered with.
   *
   * @return array<string, string>
   *   Labels keyed by value.
   */
  private function plainOptions(iterable $options): array {
    $plain = [];
    foreach ($options as $value => $label) {
      $plain[(string) $value] = (string) $label;
    }
    return $plain;
  }

  /**
   * The props that say what this field currently HOLDS.
   *
   * @param array<string, string> $options
   *   The candidates, keyed by value.
   * @param array<int, string> $values
   *   The picked values.
   * @param bool $multiple
   *   Whether the field holds several values at once.
   *
   * @return array<string, mixed>
   *   Either `multiple` plus `value_labels`, or `value_label`, or nothing.
   */
  private function pickedProps(array $options, array $values, bool $multiple): array {
    if (!$multiple) {
      $label = $values !== [] ? ($options[$values[0]] ?? NULL) : NULL;
      return $label !== NULL ? ['value_label' => $label] : [];
    }
    $labels = array_values(array_intersect_key($options, array_flip($values)));
    return ['multiple' => TRUE] + ($labels !== [] ? ['value_labels' => $labels] : []);
  }

  /**
   * This field's current values, as a list of submitted-shaped strings.
   *
   * @param \Drupal\Core\Field\FieldItemListInterface $items
   *   The field's items.
   *
   * @return array<int, string>
   *   The values, in item order.
   */
  private function currentValues(FieldItemListInterface $items): array {
    $property = $this->valueProperty();
    $values = [];
    foreach ($items as $item) {
      $value = $item->get($property)->getValue();
      if (is_scalar($value) && (string) $value !== '') {
        $values[] = (string) $value;
      }
    }
    return $values;
  }

  /**
   * The value this field opens on when it has none of its own.
   *
   * @param \Drupal\Core\Field\FieldItemListInterface $items
   *   The field's items, read only for the host the value is validated
   *   against.
   *
   * @return array<int, string>
   *   The opening value, or an empty list.
   */
  private function openingValues(FieldItemListInterface $items): array {
    $options = $this->options($items);
    $parameter = (string) $this->getSetting('context_parameter');
    $request = $this->requestStack->getCurrentRequest();
    if ($parameter !== '' && $request !== NULL) {
      $raw = $request->query->get($parameter);
      // Checked against the field's own candidates rather than taken at face
      // value — the same rule `pickerProps()` applies to a submitted value,
      // for the same reason.
      if (is_scalar($raw) && (string) $raw !== '' && array_key_exists((string) $raw, $options)) {
        return [(string) $raw];
      }
    }
    $default = (string) $this->getSetting('default_value');
    return ($default !== '' && array_key_exists($default, $options)) ? [$default] : [];
  }

  /**
   * Whether the request renders a full page rather than a swapped fragment.
   *
   * A swap parses noscript content into live controls, so a dialog or an
   * HTMX refresh must not carry the fallback.
   */
  private function isFullPage(): bool {
    $request = $this->requestStack->getCurrentRequest();
    return $request !== NULL && !$request->isXmlHttpRequest() && !$request->headers->has('HX-Request');
  }

  /**
   * The item property this field's value is stored in.
   */
  private function valueProperty(): string {
    return $this->fieldDefinition->getType() === 'entity_reference' ? 'target_id' : 'value';
  }

  /**
   * A raw submitted value as a list of non-empty strings.
   *
   * @param mixed $values
   *   Whatever the request carried at this field's own name.
   *
   * @return array<int, string>
   *   The submitted values, in submission order.
   */
  private function normalise(mixed $values): array {
    if ($values === NULL) {
      return [];
    }
    $list = is_array($values) ? array_values($values) : [$values];
    return array_values(array_filter(
      array_map(static fn (mixed $item): string => is_scalar($item) ? (string) $item : '', $list),
      static fn (string $item): bool => $item !== '',
    ));
  }

  /**
   * The panel's option rows, handed to `option_list`.
   *
   * @param array<string, string> $options
   *   The candidates, keyed by value.
   * @param array<int, string> $values
   *   The picked values, marking their matching rows selected.
   *
   * @return array<int, array<string, mixed>>
   *   The `options` prop.
   */
  private function optionRows(array $options, array $values): array {
    $rows = [];
    foreach ($options as $value => $label) {
      $row = ['value' => (string) $value, 'label' => $label];
      if (in_array((string) $value, $values, TRUE)) {
        $row['selected'] = TRUE;
      }
      $rows[] = $row;
    }
    return $rows;
  }

}
