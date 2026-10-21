<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\TicketTrigger;

use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Url;
use Drupal\entity\BundlePlugin\BundlePluginInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;

/**
 * A ticket trigger target: what a trigger acts on, and what it does.
 *
 * Each target is a bundle of `bb_ticket_trigger`. It owns its reference
 * field, access and the action; the runner owns locking, the replay key and
 * retries, and the trigger type decides when an occurrence is due.
 * TicketTriggerTargetBase implements everything but the action side.
 */
interface BbTicketTriggerTargetInterface extends BundlePluginInterface {

  /**
   * The entity type the trigger acts on.
   */
  public function targetEntityType(): string;

  /**
   * The bundle field referencing the target.
   */
  public function targetField(): string;

  /**
   * The referenced target, or NULL when it no longer exists.
   */
  public function getTarget(BbTicketTriggerInterface $trigger): ?EntityInterface;

  /**
   * The target's workspace, which must be the trigger's own.
   */
  public function getWorkspace(BbTicketTriggerInterface $trigger): ?BbWorkspaceInterface;

  /**
   * Trigger access as the target grants it: `view` or, else, `update`.
   */
  public function access(BbTicketTriggerInterface $trigger, string $operation, AccountInterface $account): AccessResultInterface;

  /**
   * IDs of the targets $account may view, for query access.
   *
   * @return array<int|string>
   *   The target IDs.
   */
  public function readableTargetIds(AccountInterface $account): array;

  /**
   * Why $actor could not run the action now, or NULL when it could.
   */
  public function preflight(BbTicketTriggerInterface $trigger, AccountInterface $actor): ?string;

  /**
   * Runs the action as $actor, inside the runner's transaction.
   *
   * @throws \Throwable
   *   Classified by isPermanentFailure().
   */
  public function execute(BbTicketTriggerInterface $trigger, AccountInterface $actor): TriggerActionResult;

  /**
   * Whether retrying the same occurrence cannot fix $e.
   */
  public function isPermanentFailure(\Throwable $e): bool;

  /**
   * Where the trigger's forms return to, or NULL when the target has no UI.
   */
  public function listUrl(BbTicketTriggerInterface $trigger): ?Url;

}
