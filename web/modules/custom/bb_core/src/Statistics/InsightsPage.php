<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\Core\Entity\EntityRepositoryInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\bb_core\Form\InsightsFilterForm;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\user\UserInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\Url;
use Drupal\bb_core\BbFigureInterface;
use Drupal\bb_core\Statistics\Figure\FigureEvaluator;
use Drupal\bb_core\Statistics\Figure\FigureFilterResolver;
use Drupal\bb_core\Statistics\Period\PeriodRange;
use Drupal\bb_core\Statistics\Period\PeriodResolver;
use Symfony\Component\HttpFoundation\Request;

/**
 * The Insights page: period, filters, figures.
 *
 * It serves the workspace Insights › Overview and, for one project, the
 * project's Insights tab.
 */
final class InsightsPage {

  use StringTranslationTrait;
  use PersonIdentityTrait;

  /**
   * The entity filters the workspace page carries.
   */
  public const ENTITY_FILTERS = ['project', 'team', 'user'];

  /**
   * The entity filters the project page carries.
   */
  public const PROJECT_FILTERS = ['epic', 'user'];

  public function __construct(
    private readonly FigureRenderer $renderer,
    private readonly FigureEvaluator $evaluator,
    private readonly FigureFilterResolver $filterResolver,
    private readonly InsightsFilterOptions $options,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TimeInterface $time,
    private readonly FormBuilderInterface $formBuilder,
    private readonly EntityRepositoryInterface $entityRepository,
  ) {}

  /**
   * Builds the page for one workspace or project.
   *
   * @return array<string, mixed>
   *   The page render array.
   */
  public function build(BbWorkspaceInterface|BbProjectInterface $scope, AccountInterface $account, Request $request): array {
    $project = $scope instanceof BbProjectInterface;
    $contexts = [$project ? 'project' : 'workspace' => $scope];
    $filters = $this->filters($request, $scope);
    $now = $this->time->getRequestTime();
    $period = $this->options->period($scope, $filters);
    $build = [
      '#type' => 'container',
      '#attributes' => ['data-bakers-tab-body' => $project ? 'stats' : 'insights'],
      'controls' => $this->controls($scope, $period, $filters),
      'content' => [
        '#type' => 'container',
        // No htmx history snapshot: Back after a tick refetches the page
        // rather than restoring markup Alpine has already processed.
        '#attributes' => ['id' => InsightsFilterForm::FIGURES_ID, 'data-hx-history' => 'false'],
        'figures' => $this->closedTickets($contexts, $filters, $now) > 0
          ? $this->renderer->build($contexts, $account, $filters, ['controls' => FALSE, 'layout' => 'insights'])
          : $this->empty($scope, $period),
      ],
    ];
    (new CacheableMetadata())
      ->setCacheMaxAge(0)
      ->addCacheContexts(['user.permissions', 'url.query_args'])
      ->addCacheableDependency($scope)
      ->applyTo($build);
    return $build;
  }

  /**
   * The request's period and accepted entity filters.
   *
   * Values the API would refuse are dropped here, so an old or shared
   * bookmark keeps opening the page instead of answering 400. The epic
   * filter keeps one epic.
   *
   * @return array<string, string|list<string>>
   *   Selected filters.
   */
  public function filters(Request $request, BbWorkspaceInterface|BbProjectInterface $scope): array {
    $filters = [];
    foreach ($request->query->all('filter') as $key => $value) {
      if (in_array($key, self::entityFilters($scope), TRUE) && is_array($value)) {
        $uuids = array_map('strval', array_filter($value, 'is_scalar'));
        $accepted = $this->filterResolver->accepted($key, $uuids, $scope);
        $filters[$key] = $key === 'epic' ? array_slice($accepted, 0, 1) : $accepted;
      }
      elseif (in_array($key, ['period', ...PeriodResolver::COMPANIONS], TRUE) && is_scalar($value)) {
        $filters[$key] = (string) $value;
      }
    }
    return array_filter($filters, static fn($value): bool => $value !== [] && $value !== '');
  }

  /**
   * The entity filters a scope's page carries, in button order.
   *
   * @return list<string>
   *   The filter keys.
   */
  public static function entityFilters(BbWorkspaceInterface|BbProjectInterface $scope): array {
    return $scope instanceof BbProjectInterface ? self::PROJECT_FILTERS : self::ENTITY_FILTERS;
  }

  /**
   * The period range, submitting to this page.
   *
   * @return array<string, mixed>
   *   The controls render array.
   */
  private function controls(BbWorkspaceInterface|BbProjectInterface $scope, PeriodRange $period, array $filters): array {
    $props = [
      'kind' => $period->kind,
      'date' => $period->start,
      'today' => gmdate('Y-m-d', $this->time->getRequestTime()),
      'name' => 'filter',
      'action' => $this->pageUrl($scope),
    ];
    if ($period->kind === 'custom') {
      $props += ['start' => $period->start, 'end' => $period->end];
    }
    // A GET form replaces the action's query, so the entity filters ride
    // along as hidden inputs.
    foreach (array_intersect_key($filters, array_flip(self::entityFilters($scope))) as $key => $uuids) {
      foreach ((array) $uuids as $uuid) {
        $props['params'][] = ['name' => 'filter[' . $key . '][]', 'value' => $uuid];
      }
    }
    $chosen = array_intersect_key($filters, array_flip(self::entityFilters($scope)));
    $entries = InsightsFilterForm::entries($this->options, $scope, $filters);
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => ['inset' => 'lg', 'gap' => 'sm'],
      '#slots' => [
        'content' => [
          // The standard filters toolbar: below `lg` the period stays in the
          // row and the pickers sit behind the "Filters · N" sheet.
          'bar' => [
            '#type' => 'component',
            '#component' => 'bb_theme:filters',
            '#props' => [
              'layout' => 'toolbar',
              'label' => (string) $this->t('Insights filters'),
              'sheet' => TRUE,
              'active_count' => count($chosen),
              // The period control keeps its natural width on desktop.
              'pinned_width' => 'auto',
              // A tick refreshes the "Filters · N" opener out of band.
              'opener_id' => 'insights-filters-opener',
            ],
            '#slots' => [
              // Wrapped, so a filter tick can refresh the hidden filter inputs.
              'pinned' => [
                '#type' => 'container',
                '#attributes' => ['id' => 'insights-period'],
                'range' => ['#type' => 'component', '#component' => 'bb_theme:period-range', '#props' => $props],
              ],
              'controls' => $this->formBuilder->getForm(InsightsFilterForm::class, $scope, $filters, $this->pageUrl($scope), NULL, $entries),
              // Present even when empty: the first tick needs a target.
              'actions' => ['#type' => 'container', '#attributes' => ['id' => 'insights-clear']] + $this->clearLink($scope, $filters),
            ],
          ],
          // Present even when empty, so a tick has a target to refresh.
          'chips' => [
            '#type' => 'container',
            '#attributes' => ['id' => 'insights-chips'],
          ] + $this->chips($scope, $filters, $chosen, $entries),
        ],
      ],
    ];
  }

  /**
   * The chosen entity filters as removable chips, one per filter.
   *
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface|\Drupal\bb_core\Entity\BbProjectInterface $scope
   *   The workspace or project.
   * @param array<string, string|list<string>> $filters
   *   The accepted filters.
   * @param array<string, string|list<string>> $chosen
   *   The accepted entity filters.
   * @param array<string, list<array<string, mixed>>> $entries
   *   The picker entries by filter, as the form shows them.
   *
   * @return array<string, array<string, mixed>>
   *   The chips render array keyed `strip`, or nothing.
   */
  private function chips(BbWorkspaceInterface|BbProjectInterface $scope, array $filters, array $chosen, array $entries): array {
    if ($chosen === []) {
      return [];
    }
    $labels = [
      'epic' => $this->t('Epic'),
      'project' => $this->t('Project'),
      'team' => $this->t('Team'),
      'user' => $this->t('Person'),
    ];
    $facets = [];
    foreach ($chosen as $key => $uuids) {
      $names = array_column($entries[$key] ?? [], 'label', 'value');
      $rest = array_diff_key($filters, [$key => TRUE]);
      $facets[] = [
        'field' => (string) ($labels[$key] ?? $key),
        'values' => array_values(array_map(
          static fn (string $uuid): string => (string) ($names[$uuid] ?? $uuid),
          (array) $uuids,
        )),
        'remove_url' => $this->url($scope, ['query' => $rest === [] ? [] : ['filter' => $rest]])->toString(),
      ];
    }
    return [
      'strip' => [
        '#type' => 'component',
        '#component' => 'bb_theme:active-filters',
        '#variant' => 'inline',
        '#props' => ['label' => (string) $this->t('Active filters'), 'facets' => $facets],
      ],
    ];
  }

  /**
   * The shell header's sub-line: the workspace and what the filters narrow.
   *
   * The shell renders the title and the Overview tab; the page header
   * description source asks this for the line under them.
   *
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace.
   * @param array<string, string|list<string>> $filters
   *   The accepted filters.
   */
  public function scope(BbWorkspaceInterface $workspace, array $filters): string {
    $parts = [(string) $workspace->label()];
    foreach (['project' => 'bb_project', 'team' => 'bb_team'] as $key => $type) {
      $uuids = (array) ($filters[$key] ?? []);
      if (count($uuids) === 1) {
        $parts[] = (string) $this->entityRepository->loadEntityByUuid($type, $uuids[0])?->label();
      }
      elseif ($uuids !== []) {
        $parts[] = $key === 'project'
          ? (string) $this->t('@count projects', ['@count' => count($uuids)])
          : (string) $this->t('@count teams', ['@count' => count($uuids)]);
      }
    }
    $people = (array) ($filters['user'] ?? []);
    if (count($people) > 2) {
      $parts[] = (string) $this->t('@count people', ['@count' => count($people)]);
    }
    elseif ($people !== []) {
      $parts[] = implode(', ', array_map(function (string $uuid): string {
        $user = $uuid === FigureFilterResolver::UNASSIGNED ? NULL : $this->entityRepository->loadEntityByUuid('user', $uuid);
        return $user instanceof UserInterface ? $this->personDisplayName($user) : (string) $this->t('Unassigned tickets');
      }, $people));
    }
    if (count($parts) === 1) {
      $parts[] = (string) $this->t('all projects, all teams');
    }
    return implode(' · ', $parts);
  }

  /**
   * The Clear filters link, keeping only the period, when a filter is set.
   *
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface|\Drupal\bb_core\Entity\BbProjectInterface $scope
   *   The workspace or project.
   * @param array<string, string|list<string>> $filters
   *   The accepted filters.
   *
   * @return array<string, array<string, mixed>>
   *   The link render array keyed `link`, or nothing.
   */
  private function clearLink(BbWorkspaceInterface|BbProjectInterface $scope, array $filters): array {
    $entityFilters = array_flip(self::entityFilters($scope));
    if (array_intersect_key($filters, $entityFilters) === []) {
      return [];
    }
    $period = array_diff_key($filters, $entityFilters);
    $url = $this->url($scope, ['query' => $period === [] ? [] : ['filter' => $period]]);
    return [
      'link' => [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => ['label' => (string) $this->t('Clear filters'), 'href' => $url->toString(), 'variant' => 'ghost'],
      ],
    ];
  }

  /**
   * The explained empty state that replaces the figures.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  private function empty(BbWorkspaceInterface|BbProjectInterface $scope, PeriodRange $period): array {
    [$description, $button] = $this->emptyCopy($scope);
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => [
        'inset' => 'lg',
        'description' => (string) $description,
      ],
      '#slots' => [
        'heading' => ['#plain_text' => (string) $this->t('No closed tickets in @period yet', ['@period' => $period->label])],
        'content' => [
          '#type' => 'component',
          '#component' => 'bb_theme:zone',
          '#props' => ['inset' => 'none', 'direction' => 'row'],
          '#slots' => [
            'content' => [
              '#type' => 'component',
              '#component' => 'bb_theme:button',
              '#props' => $button,
            ],
          ],
        ],
      ],
    ];
  }

  /**
   * The empty state's explanation and its way out, per scope.
   *
   * @return array{0: \Drupal\Core\StringTranslation\TranslatableMarkup, 1: array{label: string, href: string}}
   *   The description and the button props.
   */
  private function emptyCopy(BbWorkspaceInterface|BbProjectInterface $scope): array {
    if ($scope instanceof BbProjectInterface) {
      return [
        $this->t('Insights counts the tickets of @project that reach done in the selected period, the runs on them and the AI tokens they used. The figures appear once a ticket is closed.', ['@project' => $scope->label()]),
        ['label' => (string) $this->t('Open tickets'), 'href' => $scope->toUrl()->toString() . '/tickets'],
      ];
    }
    return [
      $this->t('Insights counts the tickets of every project in @workspace that reach done in the selected period, the runs on them and the AI tokens they used. The figures appear once a ticket is closed.', ['@workspace' => $scope->label()]),
      [
        'label' => (string) $this->t('Open projects'),
        'href' => Url::fromUserInput('/' . $scope->get('slug')->value . '/projects')->toString(),
      ],
    ];
  }

  /**
   * Tickets closed in the selected period and filters.
   *
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
   *   The named contexts.
   * @param array<string, string|list<string>> $filters
   *   The selected filters.
   * @param int $now
   *   The request time.
   */
  private function closedTickets(array $contexts, array $filters, int $now): int {
    $figure = $this->entityTypeManager->getStorage('bb_figure')->load(isset($contexts['project']) ? 'project_overview' : 'workspace_overview');
    if (!$figure instanceof BbFigureInterface) {
      return 0;
    }
    $payload = $this->evaluator->evaluate($figure, $contexts, $filters, $now)->toArray();
    $closed = array_column($payload['measurements'], 'values', 'id')['closed_tickets']['total'] ?? 0;
    return (int) $closed;
  }

  /**
   * The page path: the workspace's Insights, or the project's Insights tab.
   */
  private function pageUrl(BbWorkspaceInterface|BbProjectInterface $scope): string {
    return $this->url($scope)->toString();
  }

  /**
   * The page URL.
   *
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface|\Drupal\bb_core\Entity\BbProjectInterface $scope
   *   The workspace or project.
   * @param array<string, mixed> $options
   *   The URL options.
   */
  private function url(BbWorkspaceInterface|BbProjectInterface $scope, array $options = []): Url {
    return $scope instanceof BbProjectInterface
      ? Url::fromRoute('bb_core.bb_project.stats', $scope->toUrl()->getRouteParameters(), $options)
      : Url::fromRoute('bb_core.workspace.insights', ['bb_workspace' => $scope->get('slug')->value], $options);
  }

}
