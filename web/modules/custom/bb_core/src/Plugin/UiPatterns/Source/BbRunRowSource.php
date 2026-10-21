<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Datetime\DateFormatterInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbRun;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Ticket\TicketInterventions;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * ONE RUN, AS THE ONE ITEM OF A `list` — the row in a ticket's Run history.
 *
 * `list.items` is an array of keyed cell maps, which ui_patterns guesses as
 * the `unknown` PropType, so no display config can bind it; this source
 * declares `prop_types: ['unknown']` and builds the row in PHP.
 * `TicketDetailScreenTest` pins that guess.
 *.
 *
 * `BbRun::STATE_MARKS` must match the teaser mapping, which still lacks
 * `cancelled`. Every badge cell states `icon` and `suffix`, even empty:
 * `table.twig` forwards them without a default and a NULL string prop throws.
 */
#[Source(
  id: 'bb_run_row',
  label: new TranslatableMarkup('[bakers.build] Run row'),
  description: new TranslatableMarkup("The run, as the one item of a `list` — state, from-state, conductor, start and duration."),
  prop_types: ['unknown'],
  context_definitions: [
    // `EntityContextDefinition` rather than `ContextDefinition`, and core
    // asserts the difference: a data type of `entity:*` on a plain
    // `ContextDefinition` is an AssertionError at plugin-definition time.
    'entity' => new EntityContextDefinition('entity:bb_run', label: new TranslatableMarkup('Run'), required: TRUE),
  ],
)]
final class BbRunRowSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * The tones that mean "nothing is happening", collapsed to one accent.
   *
   * The item accent is narrower than the badge tone on purpose: a
   * rail says whether anything is happening, a badge says which state it is.
   * `idle` and `stale` both rest, and `list`'s `accent` enum has no `stale`
   * member at all — an out-of-enum accent is a silently dropped prop.
   *
   * @var array<int, string>
   */
  private const RESTING_TONES = ['idle', 'stale', 'neutral'];

  /**
   * The date formatter the row's start timestamp goes through.
   *
   * Injected in `create()` rather than through the constructor, and that is
   * phpmd's doing rather than taste: `SourcePluginBase::__construct()` already
   * takes ten arguments, so an eleventh trips `ExcessiveParameterList` — and
   * restating contrib's ten only to pass them on is the copy that rots when
   * contrib adds an eleventh of its own.
   */
  private DateFormatterInterface $dateFormatter;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->dateFormatter = $container->get('date.formatter');
    return $instance;
  }

  /**
   * {@inheritdoc}
   *
   * The run and its conductor are read here, so both have to be declared —
   * `alterComponent()` runs BEFORE `getValue()` (`ComponentElementBuilder`
   * says so in its own comment), so the context entity is available and the
   * declaration cannot be deferred to value time.
   */
  public function alterComponent(array $element): array {
    $element = parent::alterComponent($element);
    $run = $this->run();
    if ($run === NULL) {
      return $element;
    }
    $cache = CacheableMetadata::createFromRenderArray($element);
    $cache->addCacheableDependency($run)->addCacheContexts(['user']);
    $conductor = $run->get('conductor_id')->entity;
    if ($conductor !== NULL) {
      // The row prints the conductor's LABEL, so renaming a conductor has to
      // reach a cached row. The run's own tag does not carry that.
      $cache->addCacheableDependency($conductor);
    }
    $cache->applyTo($element);
    return $element;
  }

  /**
   * {@inheritdoc}
   *
   * @return array<int, array<string, mixed>>
   *   Exactly one `list` item, or none.
   */
  public function getPropValue(): mixed {
    $run = $this->run();
    if ($run === NULL) {
      // An empty array is what `isPropValueEmpty()` drops, which leaves the
      // component exactly as it was before this source existed — an empty list
      // rather than a broken one.
      return [];
    }

    $state = (string) ($run->get('state')->value ?? '');
    [$glyph, $tone] = BbRun::STATE_MARKS[$state] ?? ['info-circle', 'neutral'];

    $url = $this->canonicalUrl($run);
    $cells = [
      'state' => [
        'kind' => 'badge',
        // The raw machine state, which is the vocabulary the workflow, the CLI
        // and the API all use. A prettified label here would be a fourth
        // spelling of the same five words.
        'label' => $state,
        'tone' => $tone,
        'icon' => $glyph,
        'suffix' => '',
        'dot' => TRUE,
      ],
      'from_label' => ['kind' => 'text', 'value' => 'from', 'emphasis' => 'faint'],
      'from' => ['kind' => 'mono', 'value' => (string) ($run->get('state_at_start')->value ?? '')],
    ];

    $conductor = $run->get('conductor_id')->entity;
    if ($conductor !== NULL) {
      // The conductor keeps its icon: it is the one value here that names a
      // MACHINE, and without the icon it is another mono string beside the
      // from-state.
      $cells['conductor'] = [
        'kind' => 'badge',
        'label' => (string) $conductor->label(),
        'tone' => 'neutral',
        'icon' => 'conductor',
        'suffix' => '',
        'mono' => TRUE,
      ];
    }

    $started = $run->get('started_at')->value;
    if ($started !== NULL && $started !== '') {
      $cells['started_label'] = ['kind' => 'text', 'value' => 'started', 'emphasis' => 'faint'];
      // MINUTE PRECISION, not the raw timestamp: the seconds and the offset are
      // noise on a list whose job is to let a reader pick the run to open. The
      // overlay keeps the full timestamp, where precision is the point.
      $cells['started'] = [
        'kind' => 'mono',
        'value' => $this->dateFormatter->format((int) $started, 'custom', 'Y-m-d H:i'),
      ];
    }

    $duration = $run->get('duration_s')->value;
    if ($duration !== NULL && $duration !== '' && (int) $duration !== 0) {
      $cells['took_label'] = ['kind' => 'text', 'value' => 'took', 'emphasis' => 'faint'];
      $cells['took'] = ['kind' => 'mono', 'value' => (int) $duration . 's'];
    }

    $cells += array_filter(['log' => $this->logCell($run), 'cancel' => $this->cancelCell($run)]);
    $item = [
      'accent' => in_array($tone, self::RESTING_TONES, TRUE) ? 'idle' : $tone,
      'cells' => $cells,
    ];
    if ($url !== NULL) {
      $item['cells']['state']['url'] = $url;
      $item['url'] = $url;
    }
    return [$item];
  }

  /**
   * The run's nested canonical address, or NULL when the ticket is missing.
   */
  private function canonicalUrl(BbRunInterface $run): ?string {
    try {
      return $run->toUrl()->toString();
    }
    catch (\Exception) {
      return NULL;
    }
  }

  /**
   * The row's Cancel run action, while the reader may cancel this run.
   *
   * The intervention on a run lives on its row and opens its confirmation in
   * the overlay; without JavaScript the link opens the same page.
   *
   * @return array<string, mixed>|null
   *   The `action` cell, or NULL.
   */
  private function cancelCell(BbRunInterface $run): ?array {
    $ticket = $run->getTicket();
    if ($ticket === NULL || !TicketInterventions::mayCancelRun($run, $ticket)) {
      return NULL;
    }
    return [
      'kind' => 'action',
      'label' => (string) $this->t('Cancel run'),
      'variant' => 'danger',
      'href' => TicketInterventions::confirmationUrl($ticket, $run, FALSE)->toString(),
      'hx' => TicketInterventions::dialogHx($ticket, $run),
    ];
  }

  /**
   * The row's own link to its captured log, or NULL off neither.
   *
   * 'log' is preferred over 'error_log' when both are captured, because a
   * transcript is what an operator scanning the ticket's run history reaches
   * for first; the error log is one click further, on the run's own detail
   * page. NULL when neither is captured — a link to a route that answers 204
   * is a link to nothing, and this row already states that in `Log`/`Error
   * log` on the run's own full view mode.
   *
   * @return array<string, mixed>|null
   *   A `link` cell, or NULL.
   */
  private function logCell(BbRunInterface $run): ?array {
    $logBytes = $run->get('log_bytes')->value;
    $errorLogBytes = $run->get('error_log_bytes')->value;
    $kind = $logBytes !== NULL && $logBytes !== '' ? 'log' : ($errorLogBytes !== NULL && $errorLogBytes !== '' ? 'error_log' : NULL);
    if ($kind === NULL) {
      return NULL;
    }
    // `run_log_download_api`, never the
    // workspace-prefixed route: this row has no resolved workspace slug in
    // hand, only the run entity, and the API route's gate — `bb_run.view`
    // — is identical.
    return [
      'kind' => 'link',
      'value' => $kind === 'log' ? 'log' : 'error log',
      'url' => Url::fromRoute('bb_core.run_log_download_api', [
        'bb_run' => $run->uuid(),
        'kind' => $kind,
      ])->toString(),
    ];
  }

  /**
   * The run this display is rendering, or NULL off a run.
   */
  private function run(): ?BbRunInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    return $entity instanceof BbRunInterface ? $entity : NULL;
  }

}
