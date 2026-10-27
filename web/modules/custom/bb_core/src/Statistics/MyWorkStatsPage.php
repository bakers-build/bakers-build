<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\Url;
use Drupal\bb_core\BbFigureInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Form\InsightsFilterForm;
use Drupal\bb_core\Statistics\Figure\FigureEvaluator;
use Drupal\bb_core\Statistics\Figure\FigureFilterResolver;
use Drupal\bb_core\Statistics\Period\PeriodRange;
use Drupal\bb_core\Statistics\Period\PeriodResolver;
use Drupal\user\UserInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * The My work › Stats page: period, project filter, the account's figures.
 */
final class MyWorkStatsPage {

  use StringTranslationTrait;

  public function __construct(
    private readonly FigureRenderer $renderer,
    private readonly FigureEvaluator $evaluator,
    private readonly FigureFilterResolver $filterResolver,
    private readonly InsightsFilterOptions $options,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TimeInterface $time,
    private readonly FormBuilderInterface $formBuilder,
  ) {}

  /**
   * Builds the page for the signed-in account.
   *
   * @return array<string, mixed>
   *   The page render array.
   */
  public function build(BbWorkspaceInterface $workspace, AccountInterface $account, Request $request): array {
    $user = $this->entityTypeManager->getStorage('user')->load($account->id());
    if (!$user instanceof UserInterface) {
      throw new NotFoundHttpException('No account to read figures for.');
    }
    $contexts = ['user' => $user];
    $filters = $this->filters($request, $user);
    $period = $this->options->period($user, $filters);
    $action = Url::fromRoute('bb_core.my_work.stats', ['bb_workspace' => $workspace->get('slug')->value])->toString();
    $build = [
      '#type' => 'container',
      '#attributes' => ['data-bakers-tab-body' => 'stats'],
      'controls' => $this->controls($workspace, $user, $period, $filters, $action),
      'content' => [
        '#type' => 'container',
        '#attributes' => ['id' => InsightsFilterForm::FIGURES_ID, 'data-hx-history' => 'false'],
        'figures' => $this->closedTickets($contexts, $filters) > 0
          ? $this->renderer->build($contexts, $account, $filters, [
            'controls' => FALSE,
            'layout' => 'insights',
            'subtitles' => [
              'user_projects' => (string) $this->t('Where your closed tickets and runs went.'),
              'user_tickets' => (string) $this->t('Most AI usage first.'),
            ],
          ])
          : $this->empty($workspace, $period),
      ],
    ];
    (new CacheableMetadata())
      ->setCacheMaxAge(0)
      ->addCacheContexts(['user', 'url.query_args'])
      ->applyTo($build);
    return $build;
  }

  /**
   * The request's period and accepted project filter.
   *
   * A project the account has no ticket in is dropped, so an old or shared
   * bookmark keeps opening the page instead of narrowing to someone else's.
   *
   * @return array<string, string|list<string>>
   *   Selected filters.
   */
  private function filters(Request $request, UserInterface $user): array {
    $filters = [];
    foreach ($request->query->all('filter') as $key => $value) {
      if ($key === 'project' && is_array($value)) {
        $filters[$key] = $this->filterResolver->accepted('project', array_map('strval', array_filter($value, 'is_scalar')), $user);
      }
      elseif (in_array($key, ['period', ...PeriodResolver::COMPANIONS], TRUE) && is_scalar($value)) {
        $filters[$key] = (string) $value;
      }
    }
    return array_filter($filters, static fn($value): bool => $value !== [] && $value !== '');
  }

  /**
   * The period range and the project filter, submitting to this page.
   *
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace the page is opened in.
   * @param \Drupal\user\UserInterface $user
   *   The account.
   * @param \Drupal\bb_core\Statistics\Period\PeriodRange $period
   *   The selected period.
   * @param array<string, string|list<string>> $filters
   *   The accepted filters.
   * @param string $action
   *   This page's path.
   *
   * @return array<string, mixed>
   *   The controls render array.
   */
  private function controls(BbWorkspaceInterface $workspace, UserInterface $user, PeriodRange $period, array $filters, string $action): array {
    $props = [
      'kind' => $period->kind,
      'date' => $period->start,
      'today' => gmdate('Y-m-d', $this->time->getRequestTime()),
      'name' => 'filter',
      'action' => $action,
    ];
    if ($period->kind === 'custom') {
      $props += ['start' => $period->start, 'end' => $period->end];
    }
    // A GET form replaces the action's query, so the project rides along.
    foreach ((array) ($filters['project'] ?? []) as $uuid) {
      $props['params'][] = ['name' => 'filter[project][]', 'value' => $uuid];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => ['inset' => 'lg', 'direction' => 'row', 'gap' => 'sm'],
      '#slots' => [
        'content' => [
          'period' => [
            '#type' => 'container',
            '#attributes' => ['id' => 'insights-period'],
            'range' => ['#type' => 'component', '#component' => 'bb_theme:period-range', '#props' => $props],
          ],
          'filters' => $this->formBuilder->getForm(InsightsFilterForm::class, $workspace, $filters, $action, $user),
        ],
      ],
    ];
  }

  /**
   * The explained empty state that replaces the figures.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  private function empty(BbWorkspaceInterface $workspace, PeriodRange $period): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => [
        'inset' => 'lg',
        'description' => (string) $this->t('My work counts the tickets currently assigned to you that reach done in the selected period, in every workspace, plus their runs and AI tokens. The figures appear once one of your tickets is closed.'),
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
              '#props' => [
                'label' => (string) $this->t('Open my tickets'),
                'href' => Url::fromUserInput('/' . $workspace->get('slug')->value . '/tickets')->toString(),
              ],
            ],
          ],
        ],
      ],
    ];
  }

  /**
   * The account's tickets closed in the selected period and project.
   *
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
   *   The named contexts.
   * @param array<string, string|list<string>> $filters
   *   The selected filters.
   */
  private function closedTickets(array $contexts, array $filters): int {
    $figure = $this->entityTypeManager->getStorage('bb_figure')->load('user_overview');
    if (!$figure instanceof BbFigureInterface) {
      return 0;
    }
    $payload = $this->evaluator->evaluate($figure, $contexts, $filters, $this->time->getRequestTime())->toArray();
    return (int) (array_column($payload['measurements'], 'values', 'id')['closed_tickets']['total'] ?? 0);
  }

}
