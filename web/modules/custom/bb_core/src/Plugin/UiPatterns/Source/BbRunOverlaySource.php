<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbRun;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Run\BbRunOverlayRows;
use Drupal\bb_core\Time\BbDate;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Overlay body of a run: state, origin, error log, measurements, timeline.
 *
 * Canonical body and downloads never read a log. This overlay source may.
 */
#[Source(
  id: 'bb_run_overlay',
  label: new TranslatableMarkup('[bakers.build] Run overlay'),
  description: new TranslatableMarkup('Read-only overlay body of a run, including the error log when captured.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_run', label: new TranslatableMarkup('Run'), required: TRUE),
  ],
)]
final class BbRunOverlaySource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * Formats overlay timestamps in the product `normal` format.
   */
  private BbDate $date;

  /**
   * Shared list-row helpers.
   */
  private BbRunOverlayRows $rows;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->date = $container->get(BbDate::class);
    $instance->rows = new BbRunOverlayRows();
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $run = $this->run();
    if ($run === NULL) {
      return [];
    }
    $build = array_filter([
      'hero' => $this->hero($run),
      'origin' => $this->origin($run),
      'log' => $this->errorLog($run),
      'measurements' => $this->measurements($run),
      'timeline' => $this->timeline($run),
    ]);
    CacheableMetadata::createFromRenderArray($build)
      ->addCacheableDependency($run)
      // The error log shows only to a reader who may read the run's logs.
      ->addCacheContexts(['user'])
      ->applyTo($build);
    return $build;
  }

  /**
   * State hero: badge, from-state, duration.
   *
   * @return array<string, mixed>
   *   A list component.
   */
  private function hero(BbRunInterface $run): array {
    $state = $run->getRunState();
    [$glyph, $tone] = BbRun::STATE_MARKS[$state] ?? ['info-circle', 'neutral'];
    $accent = in_array($tone, ['idle', 'stale', 'neutral'], TRUE) ? 'idle' : $tone;
    $cells = [
      'state' => [
        'kind' => 'badge',
        'label' => $state,
        'tone' => $tone,
        'icon' => $glyph,
        'dot' => TRUE,
      ],
      'from_label' => ['kind' => 'text', 'value' => 'from', 'emphasis' => 'faint'],
      'from' => ['kind' => 'text', 'value' => (string) ($run->get('state_at_start')->value ?? '')],
    ];
    $duration = $run->get('duration_s')->value;
    if ($duration !== NULL && $duration !== '' && (int) $duration !== 0) {
      $cells['took_label'] = ['kind' => 'text', 'value' => 'took', 'emphasis' => 'faint'];
      $cells['took'] = ['kind' => 'text', 'value' => $this->date->duration((int) $duration)];
    }
    return $this->rows->list([['accent' => $accent, 'cells' => $cells]], 'lines');
  }

  /**
   * Origin zone: agent, conductor, worktree. Omits empty rows.
   *
   * @return array<string, mixed>
   *   The zone, or empty.
   */
  private function origin(BbRunInterface $run): array {
    $pairs = [];
    $agent = trim((string) ($run->get('agent')->value ?? ''));
    if ($agent !== '') {
      $pairs[] = $this->rows->pair('agent', $agent);
    }
    $conductor = $run->get('conductor_id')->entity;
    if ($conductor !== NULL) {
      $pairs[] = $this->rows->pair('conductor', (string) $conductor->label());
    }
    $worktree = trim((string) ($run->get('worktree_path')->value ?? ''));
    if ($worktree !== '') {
      $pairs[] = $this->rows->pair('worktree', $worktree);
    }
    return $pairs === [] ? [] : $this->rows->namedZone('Origin', $pairs);
  }

  /**
   * Error log, absent when none is captured.
   *
   * @return array<string, mixed>
   *   The log-viewer, or empty.
   */
  private function errorLog(BbRunInterface $run): array {
    if (!$run->access('view_log')) {
      return [];
    }
    $text = $run->readErrorLog();
    if ($text === NULL || $text === '') {
      return [];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:log-viewer',
      '#props' => [
        'caption' => (string) $this->t('Error log'),
        'text' => $text,
      ],
    ];
  }

  /**
   * Measurements zone. Omitted when every metric is empty.
   *
   * @return array<string, mixed>
   *   The zone, or empty.
   */
  private function measurements(BbRunInterface $run): array {
    $took = $run->get('duration_s')->value;
    $active = $run->get('active_s')->value;
    $pairs = array_filter([
      $this->rows->optionalPair('tokens', $run->get('tokens')->value),
      $this->rows->optionalPair('duration', $took === NULL || $took === '' ? NULL : $this->date->duration((int) $took)),
      $this->rows->optionalPair('active', $active === NULL || $active === '' ? NULL : $this->date->duration((int) $active)),
      $this->rows->optionalPair('agent turns', $run->get('agent_turns')->value),
      $this->rows->optionalPair('tool calls', $run->get('tool_calls')->value),
      $this->rows->optionalPair('user prompts', $run->get('user_prompts')->value),
      $this->rows->optionalPair('prompt words', $run->get('user_prompt_words')->value),
    ]);
    return $pairs === [] ? [] : $this->rows->namedZone('Measurements', $pairs);
  }

  /**
   * Timeline zone. Omits empty timestamps.
   *
   * @return array<string, mixed>
   *   The zone, or empty.
   */
  private function timeline(BbRunInterface $run): array {
    $pairs = [];
    foreach ([
      'created' => 'created',
      'started_at' => 'started',
      'heartbeat' => 'heartbeat',
      'closed_date' => 'closed',
    ] as $field => $label) {
      $raw = $run->get($field)->value;
      if ($raw === NULL || $raw === '') {
        continue;
      }
      $pairs[] = $this->rows->pair($label, $this->date->cell((int) $raw));
    }
    return $pairs === [] ? [] : $this->rows->namedZone('Timeline', $pairs);
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
