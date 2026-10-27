<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Statistics\InsightsFilterOptions;
use Drupal\bb_core\Statistics\InsightsPage;
use Drupal\bb_core\Statistics\Period\PeriodResolver;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The Insights filters, as one GET form.
 *
 * A workspace page filters by Project, Team and Person; a project's Stats tab
 * by Epic (one choice) and Person.
 * Each filter is a picker whose panel holds real checkboxes named
 * `filter[<key>][]`. Every tick GETs the page through htmx and swaps only the
 * figures region and the header parts the filters change, never the open
 * panel, so its search, scroll and focus stay. Without JavaScript the panel's
 * Apply submits the same form as a plain GET.
 */
final class InsightsFilterForm extends FormBase {

  /**
   * The page region a tick replaces.
   */
  public const FIGURES_ID = 'insights-figures';

  /**
   * The header parts a tick refreshes beside the figures and filters.
   */
  public const OOB_IDS = [
    'insights-period',
    'insights-clear',
  ];

  public function __construct(private readonly InsightsFilterOptions $options) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('bb_core.insights_filter_options'));
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_core_insights_filter';
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface|\Drupal\bb_core\Entity\BbProjectInterface|null $scope
   *   The workspace or project the page shows.
   * @param array<string, string|list<string>> $filters
   *   The accepted filters of the request.
   * @param string $action
   *   The page path the form submits to.
   * @param \Drupal\user\UserInterface|null $user
   *   On My work › Stats, the account: only its projects are offered.
   *
   * @return array<string, mixed>
   *   The form.
   */
  public function buildForm(array $form, FormStateInterface $form_state, BbWorkspaceInterface|BbProjectInterface|null $scope = NULL, array $filters = [], string $action = '', ?UserInterface $user = NULL): array {
    $form['#method'] = 'get';
    $form['#action'] = $action;
    $form['#token'] = FALSE;
    $form['#after_build'][] = [static::class, 'dropBuildFields'];
    foreach (['period', ...PeriodResolver::COMPANIONS] as $key) {
      if (is_string($filters[$key] ?? NULL)) {
        $form['filter_' . $key] = ['#type' => 'hidden', '#name' => 'filter[' . $key . ']', '#value' => $filters[$key]];
      }
    }
    if ($scope === NULL) {
      return $form;
    }
    (new Htmx())
      ->get(Url::fromUserInput($action))
      // The search box fires change on blur; only ticks and bulk picks apply.
      ->trigger("change[target.type!='search']")
      ->target('#' . self::FIGURES_ID)
      ->select('#' . self::FIGURES_ID)
      ->swap('outerHTML')
      ->selectOob(array_map(static fn(string $id): string => '#' . $id, self::oobIds($scope)))
      ->pushUrl(TRUE)
      ->applyTo($form);
    $labels = [
      'epic' => $this->t('Epic'),
      'project' => $this->t('Project'),
      'team' => $this->t('Team'),
      'user' => $this->t('Person'),
    ];
    $pickers = [];
    $byFilter = $user === NULL ? self::entries($this->options, $scope, $filters) : ['project' => $this->options->projects($user, $filters)];
    foreach ($byFilter as $key => $entries) {
      $pickers[$key] = self::picker((string) $key, (string) $labels[$key], $entries, (array) ($filters[$key] ?? []));
    }
    $form['filters'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => ['inset' => 'none', 'direction' => 'row', 'gap' => 'sm'],
      '#slots' => ['content' => $pickers],
    ];
    return $form;
  }

  /**
   * The ids of the parts a tick refreshes beside the figures.
   *
   * @return list<string>
   *   The element ids.
   */
  private static function oobIds(BbWorkspaceInterface|BbProjectInterface $scope): array {
    $ids = [
      ...array_map(static fn(string $key): string => 'insights-filter-' . $key, InsightsPage::entityFilters($scope)),
      ...self::OOB_IDS,
    ];
    // The project tab keeps the project's own header.
    if ($scope instanceof BbWorkspaceInterface) {
      $ids[] = 'page-header-description';
    }
    return $ids;
  }

  /**
   * One filter's picker; the epic picker takes a single choice.
   *
   * @param string $key
   *   The filter key; the inputs are named `filter[<key>][]`.
   * @param string $label
   *   The button label.
   * @param list<array<string, mixed>> $entries
   *   Entries with `value` and `label`, optionally `count`, `group`,
   *   `initials` and `color`.
   * @param list<string> $selected
   *   The selected values.
   *
   * @return array<string, mixed>
   *   The `bb_theme:option_picker` render array.
   */
  public static function picker(string $key, string $label, array $entries, array $selected): array {
    $single = $key === 'epic';
    [$options, $names] = self::options($entries, array_flip($selected));
    $all = $single ? new TranslatableMarkup('All epics') : new TranslatableMarkup('All');
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:option_picker',
      '#props' => [
        'variant' => 'field',
        'id' => 'insights-filter-' . $key,
        'label' => $label,
        'value_label' => $names === [] ? (string) $all : implode(', ', $names),
        'prominent' => $names !== [],
        'multiple' => !$single,
        'searchable' => TRUE,
      ],
      '#slots' => [
        'options' => [
          '#type' => 'component',
          '#component' => 'bb_theme:option_list',
          '#props' => [
            'multiple' => !$single,
            'input_type' => $single ? 'radio' : 'checkbox',
            // A radio name gets no [] from the list, yet every entity filter
            // is a list in the address.
            'input_name' => 'filter[' . $key . ']' . ($single ? '[]' : ''),
            'bulk_actions' => !$single,
            'summary' => TRUE,
            'apply_label' => (string) new TranslatableMarkup('Apply'),
            'auto_apply' => TRUE,
            'options' => $options,
          ],
        ],
      ],
    ];
  }

  /**
   * A picker's option rows and the names of the selected ones.
   *
   * @param list<array<string, mixed>> $entries
   *   The filter's entries.
   * @param array<string, int> $selected
   *   The selected values, as keys.
   *
   * @return array{0: list<array<string, mixed>>, 1: list<string>}
   *   The option rows and the selected names.
   */
  private static function options(array $entries, array $selected): array {
    $options = [];
    $names = [];
    foreach ($entries as $entry) {
      // All epics is the epic picker's choice while none is selected.
      $chosen = isset($selected[$entry['value']]) || ($entry['value'] === '' && $selected === []);
      $options[] = array_filter([
        'value' => $entry['value'],
        'label' => $entry['label'],
        'count' => isset($entry['count']) ? (string) $entry['count'] : NULL,
        'selected' => $chosen,
        'group' => $entry['group'] ?? NULL,
        'initials' => $entry['initials'] ?? NULL,
        'color' => $entry['color'] ?? NULL,
      ], static fn($value): bool => $value !== NULL);
      if ($chosen && $entry['value'] !== '') {
        $names[] = $entry['label'];
      }
    }
    return [$options, $names];
  }

  /**
   * The entries of every filter, flat and in display order.
   *
   * A person entry carries its team as `group`, so the panel draws the team
   * headings. The epic list starts with All epics, its empty choice.
   *
   * @return array<string, list<array<string, mixed>>>
   *   Entries keyed by filter.
   */
  public static function entries(InsightsFilterOptions $options, BbWorkspaceInterface|BbProjectInterface $scope, array $filters): array {
    $people = [];
    foreach ($options->people($scope, $filters) as $group) {
      foreach ($group['entries'] as $entry) {
        $people[] = $entry + ['group' => $group['team']];
      }
    }
    if ($scope instanceof BbProjectInterface) {
      return [
        'epic' => [['value' => '', 'label' => 'All epics'], ...$options->epics($scope, $filters)],
        'user' => $people,
      ];
    }
    $workspace = $scope;
    return [
      'project' => $options->projects($workspace, $filters),
      'team' => $options->teams($workspace, $filters),
      'user' => $people,
    ];
  }

  /**
   * Drops the build fields, so the GET query carries only the filters.
   *
   * @param array<string, mixed> $form
   *   The built form.
   *
   * @return array<string, mixed>
   *   The form without form_id, form_build_id and op.
   */
  public static function dropBuildFields(array $form): array {
    unset($form['form_id'], $form['form_build_id'], $form['op']);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    // A GET form submits to the page itself; nothing is processed here.
  }

}
