<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Claim\TicketStallReason;
use Drupal\bb_core\Entity\BbRun;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Run\RunExplanation;
use Drupal\bb_core\Ticket\TicketInterventions;
use Drupal\bb_core\Time\BbDate;
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
   * The product time formatter the row's start and duration go through.
   *
   * Injected in `create()` rather than through the constructor, and that is
   * phpmd's doing rather than taste: `SourcePluginBase::__construct()` already
   * takes ten arguments, so an eleventh trips `ExcessiveParameterList` — and
   * restating contrib's ten only to pass them on is the copy that rots when
   * contrib adds an eleventh of its own.
   */
  protected BbDate $date;

  /**
   * Words for a claimed or expired run; injected in `create()` like `$date`.
   */
  protected RunExplanation $explanation;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->date = $container->get(BbDate::class);
    $instance->explanation = $container->get(RunExplanation::class);
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
    $cache->addCacheableDependency(TicketInterventions::runCacheability($run));
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
      'from' => ['kind' => 'text', 'value' => (string) ($run->get('state_at_start')->value ?? '')],
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
      $cells['started'] = $this->date->cell((int) $started);
    }

    $duration = $run->get('duration_s')->value;
    if ($duration !== NULL && $duration !== '' && (int) $duration !== 0) {
      $cells['took_label'] = ['kind' => 'text', 'value' => 'took', 'emphasis' => 'faint'];
      $cells['took'] = ['kind' => 'text', 'value' => $this->date->duration((int) $duration)];
    }

    $cells += $this->actionCells($run);
    $item = [
      'accent' => in_array($tone, self::RESTING_TONES, TRUE) ? 'idle' : $tone,
      'cells' => $cells,
    ] + $this->detail($run);
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
   * The line beneath the cells: why the run failed, or what its claim means.
   *
   * A failure reason cut short carries its full line for the hover.
   *
   * @return array<string, string>
   *   The item's `detail` and `detail_title`, or nothing.
   */
  private function detail(BbRunInterface $run): array {
    $detail = $run->failureReason() ?? $this->explanation->forRun($run);
    if ($detail === NULL) {
      return [];
    }
    $full = $run->failureLine();
    return ['detail' => $detail] + ($full !== NULL && $full !== $detail ? ['detail_title' => $full] : []);
  }

  /**
   * The row's trailing cell: why a failed run cannot be retried, if so.
   *
   * The row is one link to the run; Retry, Re-dispatch, Cancel run and the
   * logs live on the run detail.
   *
   * @return array<string, array<string, mixed>>
   *   The `stall` cell, or none.
   */
  private function actionCells(BbRunInterface $run): array {
    $ticket = $run->getTicket();
    if (!$ticket instanceof BbTicketInterface) {
      return [];
    }
    $stall = TicketInterventions::retryStall($run, $ticket);
    return $stall === '' ? [] : ['stall' => ['kind' => 'badge'] + TicketStallReason::badge($stall, $ticket->getFrozenAt())];
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
