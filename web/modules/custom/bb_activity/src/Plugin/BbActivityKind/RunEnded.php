<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Plugin\BbActivityKind;

use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_activity\Activity\ActivityKindBase;
use Drupal\bb_activity\Activity\FeedMessage;
use Drupal\bb_activity\Attribute\BbActivityKind;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * A run that ended failed, expired or cancelled.
 *
 * `done` is told by the status row. Every end path (conductor PATCH, lease
 * expiry, cancel action) saves the run. The end state is a run detail: it is
 * named only to a reader who may view that run.
 */
#[BbActivityKind(
  id: RunEnded::ID,
  label: new TranslatableMarkup('Run ended'),
  weight: 30,
  triggers: ['bb_run:update'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_run', new TranslatableMarkup('Run')),
    'original' => new EntityContextDefinition('entity:bb_run', new TranslatableMarkup('Stored run')),
  ],
)]
final class RunEnded extends ActivityKindBase {

  public const ID = 'run_ended';

  /**
   * Run end states that get their own row.
   */
  public const ENDED_STATES = ['failed', 'expired', 'cancelled'];

  /**
   * {@inheritdoc}
   */
  public function record(): ?BbActivity {
    $run = $this->getContextValue('entity');
    $original = $this->getContextValue('original');
    assert($run instanceof BbRunInterface && $original instanceof BbRunInterface);
    // Only the save that ends the run counts.
    if (!in_array($run->getRunState(), self::ENDED_STATES, TRUE)
      || in_array($original->getRunState(), [...self::ENDED_STATES, 'done'], TRUE)) {
      return NULL;
    }
    $ticket = $run->getTicket();
    if (!$ticket instanceof BbTicketInterface) {
      return NULL;
    }
    return $this->save($ticket, [
      'step' => (string) $run->get('state_at_start')->value,
      'run_id' => $run->id(),
      'conductor_id' => $run->get('conductor_id')->target_id,
    ]);
  }

  /**
   * {@inheritdoc}
   */
  public function messages(BbActivity $activity, AccountInterface $reader, string $langcode): array {
    // The feed shows what the reader may see of the reference, as for every
    // related entity of a row.
    $items = $activity->get('run_id');
    $run = $items->entity;
    return [$this->feedMessage($activity, $run instanceof BbRunInterface && $items->access('view', $reader) ? $run : NULL)];
  }

  /**
   * The feed line, with the outcome and failed-log detail of a viewable run.
   */
  private function feedMessage(BbActivity $activity, ?BbRunInterface $run): FeedMessage {
    $state = $run?->getRunState() ?? '';
    $outcome = in_array($state, self::ENDED_STATES, TRUE) ? $state : '';
    $step = (string) ($activity->get('step')->value ?? '');
    $detail = NULL;
    if ($run !== NULL && $state === 'failed') {
      $lines = array_filter(array_map('trim', explode("\n", (string) $run->readErrorLog())));
      $detail = (string) (reset($lines) ?: '');
    }
    return new FeedMessage(
      $outcome !== '' ? $outcome : 'ended',
      'run ' . ($outcome !== '' ? $outcome : 'ended') . ($step !== '' ? ' in ' . $step : ''),
      detail: $detail,
      duration: TRUE,
    );
  }

}
