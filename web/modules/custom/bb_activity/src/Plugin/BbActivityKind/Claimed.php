<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Plugin\BbActivityKind;

use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_activity\Activity\ActivityKindBase;
use Drupal\bb_activity\Activity\ActivityTrigger;
use Drupal\bb_activity\Activity\FeedMessage;
use Drupal\bb_activity\Attribute\BbActivityKind;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * The claim that starts real work on a ticket.
 *
 * Only the first run outside qualification writes a row; every later claim
 * is a routine dispatch. The claim service's lock and transaction keep a run
 * from being claimed twice.
 */
#[BbActivityKind(
  id: Claimed::ID,
  label: new TranslatableMarkup('Claimed'),
  weight: 20,
  triggers: [ActivityTrigger::TICKET_CLAIMED],
  context_definitions: [
    'ticket' => new EntityContextDefinition('entity:bb_ticket', new TranslatableMarkup('Ticket')),
    'run' => new EntityContextDefinition('entity:bb_run', new TranslatableMarkup('Run')),
    'conductor' => new EntityContextDefinition('entity:bb_conductor', new TranslatableMarkup('Conductor')),
  ],
)]
final class Claimed extends ActivityKindBase {

  public const ID = 'claimed';

  /**
   * {@inheritdoc}
   */
  public function record(): ?BbActivity {
    $ticket = $this->contextTicket();
    $run = $this->getContextValue('run');
    $conductor = $this->getContextValue('conductor');
    assert($run instanceof BbRunInterface && $conductor instanceof BbConductorInterface);
    if ($run->isNew() || $conductor->isNew()) {
      throw new \InvalidArgumentException('A claim needs a saved run and conductor.');
    }
    $step = (string) $run->get('state_at_start')->value;
    if ($step === 'qualification' || $this->hasEarlierWorkRun($ticket, $run)) {
      return NULL;
    }
    return $this->save($ticket, [
      'step' => $step,
      'run_id' => $run->id(),
      'conductor_id' => $conductor->id(),
    ]);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function messages(BbActivity $activity, AccountInterface $reader, string $langcode): array {
    $step = (string) ($activity->get('step')->value ?? '');
    return [new FeedMessage('started', 'started work' . ($step !== '' ? ' in ' . $step : ''))];
  }

  /**
   * Whether the ticket had a run outside qualification before this one.
   */
  private function hasEarlierWorkRun(BbTicketInterface $ticket, BbRunInterface $run): bool {
    return (int) $this->entityTypeManager->getStorage('bb_run')->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->condition('state_at_start', 'qualification', '<>')
      ->condition('id', $run->id(), '<')
      ->count()
      ->execute() > 0;
  }

}
