<?php

declare(strict_types=1);

namespace Drupal\bb_core\Run;

use Drupal\Core\Cache\Cache;
use Drupal\Core\StringTranslation\PluralTranslatableMarkup;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbRun;

/**
 * A ticket's runs in one line: how many, and the newest run's state and time.
 *
 * The newest run is the top row of the ticket's Run history.
 */
final readonly class RunSummary {

  /**
   * What a summary, or its absence, depends on: every run, and the reader.
   *
   * The count is access-checked, so it varies by user.
   */
  public const array CACHE = ['tags' => ['bb_run_list'], 'contexts' => ['user']];

  /**
   * Constructs the summary.
   *
   * @param int $count
   *   How many runs the ticket has.
   * @param string|null $latestState
   *   The newest run's state, NULL without runs.
   * @param int|null $latestAt
   *   When the newest run was created, NULL without runs.
   * @param array<string, mixed> $time
   *   The newest run's `BbDate::time()` element, empty without runs.
   */
  public function __construct(
    public int $count,
    public ?string $latestState = NULL,
    public ?int $latestAt = NULL,
    private array $time = [],
  ) {}

  /**
   * The summary as one sentence: "4 runs · last failed 2 hours ago".
   */
  public function text(): string {
    $badge = $this->badge();
    return trim($badge['label'] . ' ' . $badge['suffix']);
  }

  /**
   * The newest run's status role, NULL without runs.
   */
  public function tone(): ?string {
    return BbRun::STATE_MARKS[$this->latestState ?? ''][1] ?? NULL;
  }

  /**
   * The summary as `bb_theme:badge` props, in the newest run's role colour.
   *
   * The label carries count and state; the time is the suffix, with the exact
   * date on hover.
   *
   * @return array<string, string>
   *   The badge props.
   */
  public function badge(): array {
    if ($this->count === 0) {
      return [
        'label' => (string) new TranslatableMarkup('No runs yet'),
        'tone' => 'neutral',
        'icon' => 'run',
        'suffix' => '',
      ];
    }
    return [
      'label' => (string) new PluralTranslatableMarkup($this->count, '1 run · last @state', '@count runs · last @state', ['@state' => (string) $this->latestState]),
      'tone' => $this->tone() ?? 'neutral',
      'icon' => 'run',
      'suffix' => $this->time['#props']['label'] ?? '',
      'suffix_datetime' => $this->time['#props']['datetime'] ?? '',
      'suffix_title' => $this->time['#props']['title'] ?? '',
    ];
  }

  /**
   * The summary badge as a render array for the reader who may see the runs.
   *
   * It follows every run change and the reader's run access, and a relative
   * time expires when its label would change.
   *
   * @return array<string, mixed>
   *   The `bb_theme:badge` render array.
   */
  public function build(): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:badge',
      '#props' => $this->badge(),
      '#cache' => self::CACHE + ['max-age' => $this->time['#cache']['max-age'] ?? Cache::PERMANENT],
    ];
  }

}
