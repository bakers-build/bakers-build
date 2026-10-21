<?php

declare(strict_types=1);

namespace Drupal\bb_core\Run;

use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbRun;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Inspector\InspectorRows;
use Drupal\bb_core\Ticket\TicketInterventions;
use Drupal\bb_core\Time\BbDate;

/**
 * Inspector rails for the canonical run page.
 *
 * Status, attribution, timing, footprint and downloads.
 */
final class BbRunInspectorRows extends InspectorRows {

  use StringTranslationTrait;

  /**
   * Footprint fields in display order.
   *
   * @var array<string, string>
   */
  private const FOOTPRINT = [
    'tokens' => 'Tokens',
    'duration_s' => 'Duration',
    'active_s' => 'Active',
    'agent_turns' => 'Agent turns',
    'tool_calls' => 'Tool calls',
    'user_prompts' => 'User prompts',
    'user_prompt_words' => 'Prompt words',
  ];

  /**
   * Timing fields in display order.
   *
   * @var array<string, string>
   */
  private const TIMING = [
    'started_at' => 'Started',
    'heartbeat' => 'Heartbeat',
    'claim_expires_at' => 'Claim expiry',
    'closed_date' => 'Closed',
  ];

  /**
   * Constructs the inspector-row builder.
   *
   * @param \Drupal\bb_core\Time\BbDate $date
   *   Formats inspector timestamps in the product `normal` format.
   */
  public function __construct(
    private readonly BbDate $date,
  ) {}

  /**
   * Status zone: state badge and Cancel run while the reader may cancel.
   *
   * @return array<string, mixed>
   *   The zone render array, always present.
   */
  public function status(BbRunInterface $run): array {
    $state = $run->getRunState();
    [$glyph, $tone] = BbRun::STATE_MARKS[$state] ?? ['info-circle', 'neutral'];
    $content = [
      'state' => $this->list([
        $this->row('State', [
          'kind' => 'badge',
          'label' => $state,
          'tone' => $tone,
          'icon' => $glyph,
          'dot' => TRUE,
        ]),
      ]),
    ];
    $ticket = $run->getTicket();
    if ($ticket instanceof BbTicketInterface && TicketInterventions::mayCancelRun($run, $ticket)) {
      $content['cancel'] = $this->cancelButton($run, $ticket);
    }
    return $this->zone('Status', $content);
  }

  /**
   * Attribution zone: ticket, conductor, agent, harness and model.
   *
   * Omits empty provenance rows rather than showing them blank.
   *
   * @return array<string, mixed>
   *   The zone, or empty when nothing remains.
   */
  public function attribution(BbRunInterface $run): array {
    $items = [];
    $ticket = $run->getTicket();
    if ($ticket instanceof BbTicketInterface) {
      $label = $ticket->getIdentifier() !== '' ? $ticket->getIdentifier() : (string) $ticket->label();
      $items[] = $this->row('Ticket', [
        'kind' => 'link',
        'value' => $label,
        'url' => $ticket->toUrl()->toString(),
      ]);
    }
    $conductor = $run->get('conductor_id')->entity;
    if ($conductor !== NULL) {
      $items[] = $this->row('Conductor', $this->text((string) $conductor->label()));
    }
    foreach ([
      'agent' => 'Agent',
      'harness' => 'Harness',
      'model' => 'Model',
      'model_version' => 'Model version',
    ] as $field => $label) {
      $value = trim((string) ($run->get($field)->value ?? ''));
      if ($value !== '') {
        $items[] = $this->row($label, $this->text($value));
      }
    }
    return $items === [] ? [] : $this->zone('Attribution', $this->list($items));
  }

  /**
   * Timing zone. Omits empty timestamps.
   *
   * @return array<string, mixed>
   *   The zone, or empty when every timestamp is missing.
   */
  public function timing(BbRunInterface $run): array {
    $items = [];
    foreach (self::TIMING as $field => $label) {
      $raw = $run->get($field)->value;
      if ($raw === NULL || $raw === '') {
        continue;
      }
      $items[] = $this->row($label, $this->mono($this->date->normal((int) $raw)));
    }
    return $items === [] ? [] : $this->zone('Timing', $this->list($items));
  }

  /**
   * Footprint zone. Omitted when every metric is missing or zero.
   *
   * Stored zeros are shown when at least one metric is non-zero.
   *
   * @return array<string, mixed>
   *   The zone, or empty.
   */
  public function footprint(BbRunInterface $run): array {
    $values = [];
    $any = FALSE;
    foreach (array_keys(self::FOOTPRINT) as $field) {
      $raw = $run->get($field)->value;
      if ($raw === NULL || $raw === '') {
        $values[$field] = NULL;
        continue;
      }
      $int = (int) $raw;
      $values[$field] = $int;
      if ($int !== 0) {
        $any = TRUE;
      }
    }
    if (!$any) {
      return [];
    }
    $items = [];
    foreach (self::FOOTPRINT as $field => $label) {
      if ($values[$field] === NULL) {
        continue;
      }
      $display = in_array($field, ['duration_s', 'active_s'], TRUE) ? $values[$field] . 's' : (string) $values[$field];
      $items[] = $this->row($label, $this->mono($display));
    }
    return $this->zone('Footprint', $this->list($items));
  }

  /**
   * Downloads zone: captured logs as `link-group` doc rows.
   *
   * @return array<string, mixed>
   *   The zone, or empty when neither log is captured.
   */
  public function downloads(BbRunInterface $run): array {
    $links = [];
    foreach (['log' => 'Run log', 'error_log' => 'Error log'] as $kind => $title) {
      $bytes = $run->get($kind . '_bytes')->value;
      if ($bytes === NULL || $bytes === '') {
        continue;
      }
      $links[] = [
        'url' => Url::fromRoute('bb_core.run_log_download_api', [
          'bb_run' => $run->uuid(),
          'kind' => $kind,
        ])->toString(),
        'title' => $title,
        'kind' => 'doc',
      ];
    }
    if ($links === []) {
      return [];
    }
    return $this->zone('Downloads', [
      '#type' => 'component',
      '#component' => 'bb_theme:link-group',
      '#props' => [
        'label' => (string) $this->t('Logs'),
        'links' => $links,
      ],
    ]);
  }

  /**
   * Every inspector zone that has something to show, in display order.
   *
   * @return array<string, array<string, mixed>>
   *   Render arrays keyed by group.
   */
  public function blocks(BbRunInterface $run): array {
    return array_filter([
      'status' => $this->status($run),
      'attribution' => $this->attribution($run),
      'timing' => $this->timing($run),
      'footprint' => $this->footprint($run),
      'downloads' => $this->downloads($run),
    ]);
  }

  /**
   * A zone wrapping the given content.
   *
   * @param string $heading
   *   The zone heading.
   * @param array<string, mixed>|array<int, mixed> $content
   *   Slot content.
   *
   * @return array<string, mixed>
   *   The zone render array.
   */
  private function zone(string $heading, array $content): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => ['inset' => 'none', 'gap' => 'sm', 'columns' => 1],
      '#slots' => [
        'heading' => ['#plain_text' => $heading],
        'content' => $content,
      ],
    ];
  }

  /**
   * Cancel run, reusing the ticket intervention confirmation.
   *
   * @return array<string, mixed>
   *   The button render array.
   */
  private function cancelButton(BbRunInterface $run, BbTicketInterface $ticket): array {
    $attributes = [];
    foreach (TicketInterventions::dialogHx($ticket, $run) as $key => $value) {
      $attributes['data-hx-' . $key] = $value;
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#attached' => ['library' => ['core/drupal.htmx']],
      '#props' => [
        'label' => (string) $this->t('Cancel run'),
        'href' => TicketInterventions::confirmationUrl($ticket, $run, FALSE)->toString(),
        'variant' => 'danger',
        'attributes' => new Attribute($attributes),
      ],
    ];
  }

}
