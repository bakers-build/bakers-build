<?php

declare(strict_types=1);

namespace Drupal\bb_track\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Form\InsightsFilterForm;
use Drupal\bb_core\Statistics\Period\PeriodResolver;
use Drupal\bb_track\Statistics\BillingReportPage;

/**
 * The Billing report Account and Project filters, as one GET form.
 *
 * The same pickers as the Overview's filters: every tick GETs the page
 * through htmx and swaps the report region plus the controls the filters
 * change; without JavaScript the panel's Apply submits a plain GET.
 */
final class BillingReportFilterForm extends FormBase {

  /**
   * The controls a tick refreshes beside the report.
   */
  public const OOB_IDS = [
    'insights-filter-account',
    'insights-filter-project',
    'insights-period',
    'insights-clear',
    'billing-group',
  ];

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_track_billing_report_filter';
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface|null $workspace
   *   The workspace the page shows.
   * @param array<string, string|list<string>> $filters
   *   The accepted filters of the request.
   * @param array<string, list<array<string, string>>> $entries
   *   Picker entries keyed by filter.
   * @param string $group
   *   The grouping, kept across ticks.
   *
   * @return array<string, mixed>
   *   The form.
   */
  public function buildForm(array $form, FormStateInterface $form_state, ?BbWorkspaceInterface $workspace = NULL, array $filters = [], array $entries = [], string $group = 'account'): array {
    $url = $workspace === NULL ? NULL : Url::fromRoute('bb_track.workspace.insights_billing', ['bb_workspace' => $workspace->get('slug')->value]);
    $form['#method'] = 'get';
    $form['#action'] = $url?->toString() ?? '';
    $form['#token'] = FALSE;
    $form['#after_build'][] = [InsightsFilterForm::class, 'dropBuildFields'];
    foreach (['period', ...PeriodResolver::COMPANIONS] as $key) {
      if (is_string($filters[$key] ?? NULL)) {
        $form['filter_' . $key] = ['#type' => 'hidden', '#name' => 'filter[' . $key . ']', '#value' => $filters[$key]];
      }
    }
    if ($group === 'person') {
      $form['group'] = ['#type' => 'hidden', '#name' => 'group', '#value' => $group];
    }
    if ($url === NULL) {
      return $form;
    }
    (new Htmx())
      ->get($url)
      // The search box fires change on blur; only ticks and bulk picks apply.
      ->trigger("change[target.type!='search']")
      ->target('#' . BillingReportPage::REGION_ID)
      ->select('#' . BillingReportPage::REGION_ID)
      ->swap('outerHTML')
      ->selectOob(array_map(static fn(string $id): string => '#' . $id, self::OOB_IDS))
      ->pushUrl(TRUE)
      ->applyTo($form);
    $labels = ['account' => $this->t('Account'), 'project' => $this->t('Project')];
    $pickers = [];
    foreach ($entries as $key => $list) {
      $pickers[$key] = InsightsFilterForm::picker($key, (string) $labels[$key], $list, (array) ($filters[$key] ?? []));
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
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    // A GET form submits to the page itself; nothing is processed here.
  }

}
