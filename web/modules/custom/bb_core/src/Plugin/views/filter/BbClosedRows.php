<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\filter;

use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\search_api\Plugin\views\SearchApiHandlerTrait;
use Drupal\views\Attribute\ViewsFilter;
use Drupal\views\Plugin\views\filter\FilterPluginBase;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Narrows a listing to open rows, to closed rows, or to neither.
 *
 * An exposed filter that renders its own `bb_theme:segmented_control` in
 * place of the operator/value pair and reads the parameter from the request in
 * `query()`. `hook_views_filters_summary_info_alter()` keeps it out of the
 * removable-chip summary.
 *
 * The default is the absence of the parameter, so an untouched listing keeps a
 * clean address. An unknown value falls back to `open`, never `all`, so a typo
 * never becomes a silent history dump.
 */
#[ViewsFilter('bb_closed_rows')]
final class BbClosedRows extends FilterPluginBase {

  use SearchApiHandlerTrait;

  /**
   * The query parameter this filter and its control share.
   */
  public const PARAMETER = 'closed';

  /**
   * The three positions, in the order the control renders them.
   *
   * The order matches the terminal cockpit, so both UIs answer the same
   * question the same way.
   */
  public const POSITIONS = ['open', 'only', 'all'];

  /**
   * Drupal's own query keys, none of which belongs in a pasted link.
   *
   * The `ajax_page_state` prefix is handled separately because it arrives as a
   * family of keys rather than one. These four are exact names: the first
   * three are AJAX bookkeeping like that prefix, and `destination` is worse
   * than noise — carried into the control's links it would send the reader who
   * follows one somewhere other than the listing they were looking at.
   */
  private const INTERNAL_PARAMETERS = [
    '_wrapper_format',
    'ajax_form',
    '_drupal_ajax',
    'destination',
  ];

  /**
   * {@inheritdoc}
   *
   * The name is core's — `FilterPluginBase` declares it in snake_case and reads
   * it in `buildOptionsForm()` to decide whether to offer an operator select.
   *
   * @var bool
   */
  // phpcs:ignore Drupal.NamingConventions.ValidVariableName.LowerCamelName
  public $no_operator = TRUE;

  /**
   * The request stack the position is read from.
   */
  protected RequestStack $requestStack;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->requestStack = $container->get('request_stack');
    return $instance;
  }

  /**
   * Resolves the position a raw query value names.
   *
   * Public and static because the control that renders the three links has to
   * mark the same position this filter applies; two private readings of one
   * parameter is how a control ends up highlighting a position the query did
   * not take.
   *
   * @param string|null $raw
   *   The raw `closed` query value, or NULL when it is absent.
   *
   * @return string
   *   One of self::POSITIONS.
   */
  public static function positionFromRequest(?string $raw): string {
    return in_array($raw, self::POSITIONS, TRUE) ? $raw : 'open';
  }

  /**
   * Builds the three positions for a path and a query.
   *
   * Static and service-free so the address arithmetic is unit-testable
   * without a container.
   *
   * @param string $path
   *   The current request path, carried rather than rebuilt: a project or
   *   team listing is this same control on a different address, and a
   *   rebuilt path would drop the contextual argument.
   * @param array<array-key, mixed> $query
   *   The current query parameters, including any `closed` key. The key type
   *   is `array-key` and not `string` on purpose: PHP casts a numeric query
   *   key to int, so `?0=x` really does arrive here as an int, and a narrower
   *   annotation would describe an input this method does not actually get.
   * @param string $active
   *   The resolved active position, from self::positionFromRequest().
   *
   * @return array<int, array{label: string, url: string, active: bool}>
   *   The three items, in self::POSITIONS order.
   *
   * @SuppressWarnings("PHPMD.ElseExpression")
   */
  public static function buildItems(string $path, array $query, string $active): array {
    $labels = ['open' => 'Open', 'only' => 'Closed', 'all' => 'All'];
    // Drupal's own bookkeeping, never something a pasted link should carry: a
    // listing rendered inside a BEF auto-submit AJAX response stamps every
    // query dict handed to buildExposedForm() with the `ajax_page_state`
    // family, ~1.5 KB of noise no reader of a pasted link asked for.
    //
    // The key is deliberately NOT typed `string`. PHP casts a numeric array
    // key to int, so a hand-edited address like `?0=x` hands this closure an
    // int, and under strict_types a typed parameter would turn that into a
    // TypeError — a white screen on the listing, from the address bar.
    $query = array_filter(
      $query,
      static fn ($key): bool => !str_starts_with((string) $key, 'ajax_page_state')
        && !in_array((string) $key, self::INTERNAL_PARAMETERS, TRUE),
      ARRAY_FILTER_USE_KEY,
    );
    $items = [];
    foreach (self::POSITIONS as $position) {
      $next = $query;
      // `open` is the absence of the parameter, not `closed=open`.
      if ($position === 'open') {
        unset($next[self::PARAMETER]);
      }
      else {
        $next[self::PARAMETER] = $position;
      }
      // Switching position changes the result set, so a page number carried
      // forward from the old set may not exist in the new one; reset to
      // page 1 rather than land on a page that could be short or absent.
      if ($position !== $active) {
        unset($next['page']);
      }
      $suffix = $next === [] ? '' : '?' . http_build_query($next);
      $items[] = [
        'label' => $labels[$position],
        'url' => $path . $suffix,
        'active' => $position === $active,
      ];
    }
    return $items;
  }

  /**
   * {@inheritdoc}
   */
  public function canExpose(): bool {
    return TRUE;
  }

  /**
   * {@inheritdoc}
   */
  public function adminSummary(): string {
    return (string) $this->t('follows the closed control in the address');
  }

  /**
   * {@inheritdoc}
   *
   * Replaces the default operator/value widget with the three-link
   * segmented control.
   */
  public function buildExposedForm(&$form, FormStateInterface $form_state): void {
    $identifier = $this->options['expose']['identifier'] ?: self::PARAMETER;
    $request = $this->requestStack->getCurrentRequest();
    $path = $request?->getPathInfo() ?? '/';
    $query = $request?->query->all() ?? [];
    $raw = $request?->query->get(self::PARAMETER);
    $active = self::positionFromRequest(is_string($raw) ? $raw : NULL);

    $form[$identifier] = [
      '#type' => 'component',
      '#component' => 'bb_theme:segmented_control',
      '#props' => [
        'label' => (string) new TranslatableMarkup('Closed rows'),
        'items' => self::buildItems($path, $query, $active),
      ],
      '#cache' => [
        'contexts' => ['url.query_args', 'url.path'],
      ],
    ];
  }

  /**
   * {@inheritdoc}
   *
   * Always TRUE. The rendered widget is a `component` with no `#input`, so the
   * parent would find no submitted value whenever another exposed filter
   * submits and skip `query()`, silently dropping the narrowing. `query()`
   * reads the request directly instead.
   */
  public function acceptExposedInput($input): bool {
    return TRUE;
  }

  /**
   * {@inheritdoc}
   */
  public function query(): void {
    $query = $this->getQuery();
    if ($query === NULL) {
      return;
    }
    $request = $this->requestStack->getCurrentRequest();
    $raw = $request?->query->get(self::PARAMETER);
    $position = self::positionFromRequest(is_string($raw) ? $raw : NULL);
    if ($position === 'all') {
      return;
    }
    $query->addCondition($this->realField, $position === 'only' ? 1 : 0, '=', $this->options['group']);
  }

}
