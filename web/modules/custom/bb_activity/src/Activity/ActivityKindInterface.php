<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Activity;

use Drupal\Component\Plugin\PluginInspectionInterface;
use Drupal\Core\Plugin\ContextAwarePluginInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_activity\Entity\BbActivity;

/**
 * One kind of activity: the row it records and how every channel reads it.
 *
 * Its facts are plugin contexts the causer sets on a fresh instance, the code
 * that already holds them: a ticket, a run, a review, the claim service. A new
 * kind is one plugin class plus one record() call at its causer.
 */
interface ActivityKindInterface extends ContextAwarePluginInterface, PluginInspectionInterface {

  /**
   * Writes the row the contexts describe, inside the caller's transaction.
   *
   * One call per instance. Storage, validation or kind failure propagates so
   * the surrounding write rolls back.
   *
   * @return \Drupal\bb_activity\Entity\BbActivity|null
   *   The saved row; NULL when the facts make no row.
   *
   * @throws \Drupal\Component\Plugin\Exception\ContextException
   *   When a required context is missing.
   * @throws \LogicException
   *   When the instance already recorded.
   */
  public function record(): ?BbActivity;

  /**
   * What every channel says about one row of this kind.
   *
   * @param \Drupal\bb_activity\Entity\BbActivity $activity
   *   The row.
   * @param \Drupal\Core\Session\AccountInterface $reader
   *   Who reads it; decides what of a related entity may show.
   * @param string $langcode
   *   The reader's language.
   *
   * @return list<\Drupal\bb_activity\Activity\ActivityMessageInterface>
   *   A feed message, and a mail message where the kind words one.
   */
  public function messages(BbActivity $activity, AccountInterface $reader, string $langcode): array;

  /**
   * The accounts a row of this kind may be mailed to, before their opt-in.
   *
   * @return list<int>
   *   Account IDs; the mailer keeps those who ticked the kind, are active,
   *   have an address and may view the ticket.
   */
  public function recipients(BbActivity $activity): array;

}
