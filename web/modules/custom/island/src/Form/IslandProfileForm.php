<?php

declare(strict_types=1);

namespace Drupal\island\Form;

use Drupal\Component\Plugin\Exception\PluginException;
use Drupal\Component\Utility\NestedArray;
use Drupal\Core\Condition\ConditionInterface;
use Drupal\Core\Condition\ConditionManager;
use Drupal\Core\Condition\ConditionPluginCollection;
use Drupal\Core\Entity\EntityForm;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Form\SubformState;
use Drupal\Core\Plugin\Context\ContextRepositoryInterface;
use Drupal\Core\Render\Element;
use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;
use Drupal\island\IslandLayoutManager;
use Drupal\island\IslandConfigurationValidationInterface;
use Drupal\island\AppProviderManager;
use Drupal\island\AppContextProviderInterface;
use Drupal\island\IslandPluginManagerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Add/edit form for island profiles.
 *
 * @SuppressWarnings("PHPMD.ExcessiveClassComplexity")
 */
final class IslandProfileForm extends EntityForm {

  /**
   * Reads available SDC layout slots.
   */
  protected IslandLayoutManager $layoutManager;

  /**
   * Discovers and instantiates island plugins.
   */
  protected IslandPluginManagerInterface $islandManager;

  /**
   * Resolves the selected app's event vocabulary.
   */
  protected AppProviderManager $providerManager;

  /**
   * Builds the condition plugins offered at profile and placement level.
   */
  protected ConditionManager $conditionManager;

  /**
   * Lists the contexts a condition can be mapped to.
   */
  protected ContextRepositoryInterface $contextRepository;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->layoutManager = $container->get('island.layout_manager');
    $form->islandManager = $container->get('plugin.manager.island');
    $form->providerManager = $container->get('island.app_provider_manager');
    $form->conditionManager = $container->get('plugin.manager.condition');
    $form->contextRepository = $container->get('context.repository');
    return $form;
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.NPathComplexity")
   * @SuppressWarnings("PHPMD.CyclomaticComplexity")
   */
  public function form(array $form, FormStateInterface $form_state): array {
    if ($form_state->has('profile_draft')) {
      $this->entity = $form_state->get('profile_draft');
    }
    $form = parent::form($form, $form_state);
    $form_state->setTemporaryValue('gathered_contexts', $this->contextRepository->getAvailableContexts());
    $form_state->set('island_condition_sets', []);
    /** @var \Drupal\island\Entity\IslandProfile $profile */
    $profile = $this->entity;
    $app = App::load($profile->getAppId());
    $provider = $app === NULL ? NULL : $this->providerManager->get($app->getProviderId());
    $contexts = $provider instanceof AppContextProviderInterface ? $provider->getProfileContexts($app, $profile) : [];
    $apps = [];
    foreach (App::loadMultiple() as $app) {
      $apps[$app->id()] = $app->label();
    }
    $form['label'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Label'),
      '#default_value' => $profile->label(),
      '#required' => TRUE,
    ];
    $form['id'] = [
      '#type' => 'machine_name',
      '#default_value' => $profile->id(),
      '#machine_name' => ['exists' => [IslandProfile::class, 'load']],
      '#disabled' => !$profile->isNew(),
    ];
    $form['app'] = [
      '#type' => 'select',
      '#title' => $this->t('App'),
      '#options' => $apps,
      '#default_value' => $profile->getAppId(),
      '#required' => TRUE,
    ];
    $form['layout'] = [
      '#type' => 'select',
      '#title' => $this->t('Layout component'),
      '#options' => $this->layoutOptions(),
      '#default_value' => $profile->getLayoutId(),
      '#required' => TRUE,
      '#description' => $this->t('The SDC component id that supplies the profile slots.'),
    ];
    $form['update_layout'] = [
      '#type' => 'submit',
      '#value' => $this->t('Update layout'),
      '#submit' => ['::updateLayoutSubmit'],
      '#limit_validation_errors' => [],
    ];
    $form['status'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Enabled'),
      '#default_value' => $profile->status(),
    ];
    $form['weight'] = [
      '#type' => 'number',
      '#title' => $this->t('Priority'),
      '#default_value' => (int) $profile->get('weight'),
      '#description' => $this->t('Lower values are selected first when conditions match.'),
    ];
    $form['visibility'] = $this->conditionsForm(
      $profile->getConditions(),
      $profile->getConditionOperator(),
      $form_state,
      ['visibility'],
      $this->t('Profile conditions'),
    );
    $form['visibility']['#description'] = $this->t('The profile is selected when its conditions pass. A profile without conditions is only used as its app default.');
    $form['placements'] = [
      '#type' => 'container',
      '#tree' => TRUE,
      '#title' => $this->t('Island placements'),
    ];
    $layout_id = (string) ($form_state->getValue('layout') ?: $profile->getLayoutId());
    $slots = $this->layoutManager->getSlots($layout_id);
    $slot_options = array_map(static fn(array $slot): string => (string) ($slot['title'] ?? ''), $slots);
    foreach ($slots as $slot_id => $slot) {
      $form['placements'][$slot_id] = [
        '#type' => 'details',
        '#title' => $slot['title'] ?? $slot_id,
        '#open' => TRUE,
        'placements' => [
          '#type' => 'container',
          '#tree' => TRUE,
        ],
      ];
      foreach ($profile->getPlacementsBySlot()[$slot_id] ?? [] as $placement_id => $placement) {
        $plugin_id = (string) ($placement['plugin_id'] ?? '');
        $form['placements'][$slot_id]['placements'][$placement_id] = [
          '#type' => 'details',
          '#title' => $this->t('Placement @id', ['@id' => $placement_id]),
          '#open' => TRUE,
          'plugin_id' => [
            '#type' => 'select',
            '#title' => $this->t('Island plugin'),
            '#options' => $this->pluginOptions($plugin_id),
            '#default_value' => $plugin_id,
            '#required' => TRUE,
          ],
          'slot' => [
            '#type' => 'select',
            '#title' => $this->t('Slot'),
            '#options' => $slot_options,
            '#default_value' => $slot_id,
          ],
          'remove' => [
            '#type' => 'checkbox',
            '#title' => $this->t('Remove placement'),
          ],
          'weight' => [
            '#type' => 'number',
            '#title' => $this->t('Order'),
            '#default_value' => $placement['weight'] ?? 0,
          ],
          'enabled' => [
            '#type' => 'checkbox',
            '#title' => $this->t('Enabled'),
            '#default_value' => $placement['enabled'] ?? TRUE,
          ],
          'events' => [
            '#type' => 'checkboxes',
            '#title' => $this->t('Refresh events'),
            '#options' => $this->eventOptions(
              (string) ($form_state->getValue('app') ?: $profile->getAppId()),
              (array) ($placement['events'] ?? []),
            ),
            '#default_value' => array_combine(
              array_map('strval', (array) ($placement['events'] ?? [])),
              array_map('strval', (array) ($placement['events'] ?? [])),
            ),
            '#description' => $this->t('Only selected events may refresh this placement.'),
          ],
          'visibility' => $this->conditionsForm(
            (array) ($placement['conditions'] ?? []),
            (string) ($placement['condition_operator'] ?? 'and'),
            $form_state,
            ['placements', $slot_id, 'placements', $placement_id, 'visibility'],
            $this->t('Placement conditions'),
            $placement_id,
          ),
        ];
        try {
          $plugin = $plugin_id === '' ? NULL : $this->islandManager->createInstance($plugin_id, ['contexts' => $contexts] + ($placement['configuration'] ?? []));
        }
        catch (PluginException) {
          $plugin = NULL;
          $form['placements'][$slot_id]['placements'][$placement_id]['configuration']['warning'] = [
            '#markup' => $this->t('The configured island plugin is unavailable. Reassign it before saving.'),
          ];
        }
        if ($plugin !== NULL && method_exists($plugin, 'settingsForm')) {
          $form['placements'][$slot_id]['placements'][$placement_id]['configuration'] = [
            '#type' => 'container',
            '#tree' => TRUE,
          ];
          $form['placements'][$slot_id]['placements'][$placement_id]['configuration'] = $plugin->settingsForm(
            $form['placements'][$slot_id]['placements'][$placement_id]['configuration'],
            $form_state,
          );
        }
      }
    }
    $unassigned = $profile->getUnassignedPlacements($slots);
    if ($unassigned !== []) {
      $slot_options = [];
      foreach ($slots as $slot_id => $slot) {
        $slot_options[$slot_id] = $slot['title'] ?? $slot_id;
      }
      $form['placements']['_unassigned'] = [
        '#type' => 'details',
        '#title' => $this->t('Unassigned placements'),
        '#open' => TRUE,
        '#description' => $this->t('Reassign each placement or explicitly remove it before saving this layout.'),
        'placements' => [
          '#type' => 'container',
          '#tree' => TRUE,
        ],
      ];
      foreach ($unassigned as $placement_id => $placement) {
        $form['placements']['_unassigned']['placements'][$placement_id] = [
          '#type' => 'details',
          '#title' => $this->t('Placement @id', ['@id' => $placement_id]),
          '#open' => TRUE,
          'slot' => [
            '#type' => 'select',
            '#title' => $this->t('Reassign to slot'),
            '#options' => $slot_options,
            '#empty_option' => $this->t('- Select a slot -'),
            '#default_value' => '',
          ],
          'remove' => [
            '#type' => 'checkbox',
            '#title' => $this->t('Remove placement'),
            '#default_value' => FALSE,
          ],
        ];
      }
    }
    $form['new_placement_plugin'] = [
      '#type' => 'select',
      '#title' => $this->t('Add placement'),
      '#options' => $this->pluginOptions(),
      '#empty_option' => $this->t('- Select an island plugin -'),
    ];
    $form['add_placement'] = [
      '#type' => 'submit',
      '#value' => $this->t('Add placement'),
      '#submit' => ['::addPlacementSubmit'],
      '#limit_validation_errors' => [],
    ];
    return $form;
  }

  /**
   * Builds core condition plugin forms for one condition collection.
   *
   * Like core's block visibility form, every applicable condition plugin is
   * offered; unconfigured ones are dropped on save. Stored conditions whose
   * plugin is unavailable are kept for repair.
   *
   * @param array<string, array<string, mixed>> $conditions
   *   Stored condition configurations keyed by plugin id.
   * @param string $operator
   *   The stored operator.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   * @param string[] $parents
   *   The element's parents; equal to its array parents in this form.
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup $title
   *   The element title.
   * @param string|null $placement_id
   *   The placement owning the collection, or NULL for the profile.
   *
   * @return array<string, mixed>
   *   The form element.
   */
  private function conditionsForm(array $conditions, string $operator, FormStateInterface $form_state, array $parents, $title, ?string $placement_id = NULL): array {
    $element = [
      '#type' => 'details',
      '#title' => $title,
      '#open' => $conditions !== [],
      '#tree' => TRUE,
      'condition_operator' => [
        '#type' => 'select',
        '#title' => $this->t('Combine conditions'),
        '#options' => [
          'and' => $this->t('All conditions must pass'),
          'or' => $this->t('Any condition may pass'),
        ],
        '#default_value' => $operator,
      ],
      'conditions' => [],
    ];
    $sets = $form_state->get('island_condition_sets') ?? [];
    $key = implode('][', $parents);
    $sets[$key] = [
      'parents' => $parents,
      'placement' => $placement_id,
      'stored' => $conditions,
      'operator' => $operator,
    ];
    $form_state->set('island_condition_sets', $sets);
    $definitions = $this->conditionManager->getFilteredDefinitions('island_profile', $form_state->getTemporaryValue('gathered_contexts'));
    foreach ($definitions as $condition_id => $definition) {
      // The theme is chosen after the page variant; it cannot select one.
      if ($condition_id === 'current_theme') {
        continue;
      }
      $condition = $this->conditionManager->createInstance($condition_id, $conditions[$condition_id] ?? []);
      assert($condition instanceof ConditionInterface);
      $form_state->set(['island_conditions', $key, $condition_id], $condition);
      $condition_form = $condition->buildConfigurationForm([], $form_state);
      $condition_form['#type'] = 'details';
      $condition_form['#title'] = is_array($definition) ? $definition['label'] : $condition_id;
      $condition_form['#open'] = isset($conditions[$condition_id]);
      // Every condition is offered, most of them unused. A required field (or
      // core's context choice once several contexts fit a slot) would block
      // saving for each of them; validateRequired() asks only a used one.
      self::optionalUntilUsed($condition_form);
      $element['conditions'][$condition_id] = $condition_form;
    }
    foreach (array_keys(array_diff_key($conditions, $definitions)) as $condition_id) {
      $element['conditions'][$condition_id] = [
        '#type' => 'item',
        '#title' => $this->t('[Unavailable] @condition', ['@condition' => $condition_id]),
        '#markup' => $this->t('The condition plugin is unavailable. Its configuration is kept and the collection denies until it is repaired.'),
      ];
    }
    return $element;
  }

  /**
   * Validates the profile operator and every condition plugin subform.
   */
  private function validateConditions(array &$form, FormStateInterface $form_state): void {
    if (!in_array($form_state->getValue(['visibility', 'condition_operator'], 'and'), ['and', 'or'], TRUE)) {
      $form_state->setErrorByName('visibility][condition_operator', $this->t('Select how the conditions combine.'));
    }
    $this->processConditions($form, $form_state, FALSE);
  }

  /**
   * Runs each condition plugin's validate or submit handler on its subform.
   *
   * @return array<string, array{conditions: array<string, mixed>, condition_operator: string, placement: string|null}>
   *   Submitted collections keyed by element path, or an empty array when only
   *   validating.
   */
  private function processConditions(array &$form, FormStateInterface $form_state, bool $submit): array {
    $collections = [];
    foreach ($form_state->get('island_condition_sets') ?? [] as $key => $set) {
      $configurations = [];
      foreach ($form_state->get(['island_conditions', $key]) ?? [] as $condition_id => $condition) {
        $subform = &NestedArray::getValue($form, [...$set['parents'], 'conditions', $condition_id]);
        // A collection or condition that was not submitted keeps its values.
        if (!is_array($subform) || !$form_state->hasValue([...$set['parents'], 'conditions', $condition_id])) {
          continue;
        }
        assert($condition instanceof ConditionInterface);
        $subform_state = SubformState::createForSubform($subform, $form, $form_state);
        if (!$submit) {
          $condition->validateConfigurationForm($subform, $subform_state);
          $this->validateRequired(clone $condition, $subform, $subform_state);
          continue;
        }
        $condition->submitConfigurationForm($subform, $subform_state);
        $configurations[$condition_id] = $condition->getConfiguration();
      }
      if (!$submit) {
        continue;
      }
      $operator = (string) $form_state->getValue([...$set['parents'], 'condition_operator'], $set['operator']);
      // Core's collection drops plugins left at their defaults, as on blocks.
      $configured = (new ConditionPluginCollection($this->conditionManager, $configurations))->getConfiguration();
      $collections[$key] = [
        'conditions' => $configured + array_diff_key($set['stored'], $configurations),
        'condition_operator' => $operator,
        'placement' => $set['placement'],
      ];
    }
    return $collections;
  }

  /**
   * Turns the required fields of a condition subform into optional ones.
   *
   * They are marked, so validateRequired() can require them of a used one.
   */
  private static function optionalUntilUsed(array &$element): void {
    foreach (Element::children($element) as $key) {
      self::optionalUntilUsed($element[$key]);
    }
    if (empty($element['#required'])) {
      return;
    }
    $element['#required'] = FALSE;
    $element['#island_required'] = TRUE;
    if (($element['#type'] ?? '') === 'select') {
      $element['#empty_value'] = '';
    }
  }

  /**
   * Requires the marked fields of a condition that is used.
   *
   * A condition left at its defaults is not stored, so it is unused.
   */
  private function validateRequired(ConditionInterface $probe, array $subform, FormStateInterface $subform_state): void {
    $probe->submitConfigurationForm($subform, $subform_state);
    $used = (new ConditionPluginCollection($this->conditionManager, [$probe->getPluginId() => $probe->getConfiguration()]))->getConfiguration();
    if ($used !== []) {
      $this->requireMarked($subform, $subform_state);
    }
  }

  /**
   * Sets an error on every empty marked field below an element.
   */
  private function requireMarked(array $element, FormStateInterface $form_state): void {
    foreach (Element::children($element) as $key) {
      $this->requireMarked($element[$key], $form_state);
    }
    if (!empty($element['#island_required']) && in_array($element['#value'] ?? NULL, [NULL, '', []], TRUE)) {
      $form_state->setError($element, $this->t('@name field is required.', ['@name' => $element['#title'] ?? '']));
    }
  }

  /**
   * Returns selectable island plugins, including standard and app plugins.
   *
   * @return array<string, string>
   *   Plugin options.
   */
  private function pluginOptions(?string $current = NULL): array {
    $options = [];
    foreach ($this->islandManager->getDefinitions() as $plugin_id => $definition) {
      $label = is_array($definition) ? ($definition['label'] ?? $plugin_id) : $definition->label();
      $options[$plugin_id] = (string) $label;
    }
    if (!empty($current) && !isset($options[$current])) {
      $options = [$current => (string) $this->t('[Unavailable] @plugin', ['@plugin' => $current])] + $options;
    }
    asort($options);
    return $options;
  }

  /**
   * Returns all available SDC components as layout choices.
   *
   * @return array<string, string>
   *   Component options.
   */
  private function layoutOptions(): array {
    $options = [];
    foreach ($this->layoutManager->getDefinitions() as $component_id => $definition) {
      $options[$component_id] = (string) ($definition['name'] ?? $component_id);
    }
    asort($options);
    return $options;
  }

  /**
   * Returns the event vocabulary exposed by the selected app provider.
   *
   * @param string $app_id
   *   App id.
   * @param string[] $current
   *   Events already stored on the placement.
   *
   * @return array<string, string>
   *   Valid event options.
   */
  private function eventOptions(string $app_id, array $current = []): array {
    $app = App::load($app_id);
    $options = [];
    if ($app !== NULL) {
      $provider = $this->providerManager->get($app->getProviderId());
      if ($provider !== NULL) {
        foreach ($provider->getEvents($app) as $event) {
          $options[(string) $event] = (string) $event;
        }
      }
    }
    foreach (array_diff(array_filter($current), array_keys($options)) as $event) {
      $options[$event] = (string) $this->t('[Unavailable] @event', ['@event' => $event]);
    }
    asort($options);
    return $options;
  }

  /**
   * Applies a layout selection while retaining all pending placement edits.
   */
  public function updateLayoutSubmit(array &$form, FormStateInterface $form_state): void {
    $form_state->setValues(array_replace($form_state->getUserInput(), $form_state->getValues()));
    $this->entity = $this->buildEntity($form, $form_state);
    $form_state->set('profile_draft', $this->entity);
    $form_state->setRebuild(TRUE);
  }

  /**
   * Adds an empty placement and rebuilds the slot form.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function addPlacementSubmit(array &$form, FormStateInterface $form_state): void {
    $form_state->setValues(array_replace($form_state->getUserInput(), $form_state->getValues()));
    $this->entity = $this->buildEntity($form, $form_state);
    /** @var \Drupal\island\Entity\IslandProfile $profile */
    $profile = $this->entity;
    $plugin_id = (string) $form_state->getValue('new_placement_plugin');
    $slots = $this->layoutManager->getSlots((string) $form_state->getValue('layout'));
    if ($plugin_id === '' || $slots === []) {
      $this->messenger()->addWarning($this->t('Select an island plugin and a layout with at least one slot.'));
      $form_state->setRebuild(TRUE);
      return;
    }
    $placements = $profile->get('placements') ?? [];
    $placement_id = 'placement_' . substr(hash('sha256', $plugin_id . microtime(TRUE) . count($placements)), 0, 12);
    $placements[$placement_id] = [
      'plugin_id' => $plugin_id,
      'slot' => (string) array_key_first($slots),
      'weight' => count($placements),
      'enabled' => TRUE,
      'configuration' => [],
    ];
    $profile->set('placements', $placements);
    $form_state->set('profile_draft', $this->entity);
    $form_state->setRebuild(TRUE);
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    parent::validateForm($form, $form_state);
    /** @var \Drupal\island\Entity\IslandProfile $profile */
    $profile = $this->entity;
    $layout_id = (string) $form_state->getValue('layout');
    $slots = $this->layoutManager->getSlots($layout_id);
    if (!isset($this->layoutManager->getDefinitions()[$layout_id])) {
      $form_state->setErrorByName('layout', $this->t('Select an available layout component.'));
    }
    $this->validateConditions($form, $form_state);
    $placements = $this->submittedPlacements($profile->get('placements') ?? [], $form_state->getValue('placements', []));
    foreach ($placements as $placement_id => $placement) {
      if (!isset($slots[(string) ($placement['slot'] ?? '')])) {
        $form_state->setErrorByName(
          'placements',
          $this->t('Placement @id must use a valid slot for the selected layout.', ['@id' => $placement_id]),
        );
      }
      if (!$this->islandManager->hasDefinition((string) ($placement['plugin_id'] ?? ''))) {
        $form_state->setErrorByName('placements', $this->t('Placement @id uses an unavailable island plugin. Reassign or remove it.', ['@id' => $placement_id]));
        continue;
      }
      $plugin = $this->islandManager->createInstance($placement['plugin_id'], $placement['configuration'] ?? []);
      if ($plugin instanceof IslandConfigurationValidationInterface) {
        foreach ($plugin->configurationErrors() as $error) {
          $form_state->setErrorByName('placements', $error);
        }
      }
    }
    $unassigned = $profile->getUnassignedPlacements($slots);
    $values = $form_state->getValue(['placements', '_unassigned', 'placements'], []);
    foreach (array_keys($unassigned) as $placement_id) {
      $value = $values[$placement_id] ?? [];
      if (!empty($value['remove'])) {
        continue;
      }
      $slot_id = (string) ($value['slot'] ?? '');
      if (!isset($slots[$slot_id])) {
        $form_state->setErrorByName(
          "placements][_unassigned][placements][$placement_id][slot",
          $this->t('Placement @id must be reassigned to a valid slot or removed.', ['@id' => $placement_id]),
        );
      }
    }
  }

  /**
   * Normalizes editor values before EntityForm's after-build and submit copies.
   */
  protected function copyFormValuesToEntity(EntityInterface $entity, array $form, FormStateInterface $form_state): void {
    assert($entity instanceof IslandProfile);
    $state = clone $form_state;
    // Conditions are applied by submitForm() through their plugins.
    $state->unsetValue('visibility');
    $state->setValue('weight', (int) $state->getValue('weight', 0));
    $state->setValue('placements', $this->submittedPlacements(
      $entity->get('placements') ?? [],
      $state->getValue('placements', []),
    ));
    parent::copyFormValuesToEntity($entity, $form, $state);
  }

  /**
   * Merges submitted slot controls into stable placement records.
   */
  private function submittedPlacements(array $placements, array $values): array {
    foreach ($values as $slot_id => $slot_values) {
      foreach ($slot_values['placements'] ?? [] as $placement_id => $value) {
        if (!isset($placements[$placement_id])) {
          continue;
        }
        if (!empty($value['remove'])) {
          unset($placements[$placement_id]);
          continue;
        }
        if (!empty($value['slot'])) {
          $placements[$placement_id]['slot'] = $value['slot'];
        }
        if ($slot_id === '_unassigned') {
          continue;
        }
        $placements[$placement_id] = array_replace(
          $placements[$placement_id],
          array_intersect_key($value, array_flip(['plugin_id', 'configuration'])),
        );
        $placements[$placement_id]['weight'] = (int) ($value['weight'] ?? 0);
        $placements[$placement_id]['enabled'] = (bool) ($value['enabled'] ?? FALSE);
        $placements[$placement_id]['events'] = array_values(array_filter((array) ($value['events'] ?? [])));
      }
    }
    return $placements;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    parent::submitForm($form, $form_state);
    /** @var \Drupal\island\Entity\IslandProfile $profile */
    $profile = $this->entity;
    $placements = $profile->get('placements') ?? [];
    foreach ($this->processConditions($form, $form_state, TRUE) as $collection) {
      $values = [
        'conditions' => $collection['conditions'],
        'condition_operator' => $collection['condition_operator'],
      ];
      if ($collection['placement'] === NULL) {
        $profile->set('conditions', $values['conditions'])->set('condition_operator', $values['condition_operator']);
      }
      elseif (isset($placements[$collection['placement']])) {
        $placements[$collection['placement']] = array_replace($placements[$collection['placement']], $values);
      }
    }
    $profile->set('placements', $placements);
  }

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $result = $this->entity->save();
    $this->messenger()->addStatus($this->t('Island profile %label has been saved.', ['%label' => $this->entity->label()]));
    $form_state->setRedirectUrl($this->entity->toUrl('collection'));
    return $result;
  }

}
