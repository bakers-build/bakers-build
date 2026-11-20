<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Hook;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\bb_ticket_trigger\TicketTrigger\BbTicketTriggerTargetInterface;
use Drupal\bb_ticket_trigger\TicketTrigger\TicketTriggerRunner;
use Drupal\bb_ticket_trigger\TicketTrigger\TicketTriggerTargetPluginManager;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Ticket trigger lifecycle: cron and removal with the target.
 */
final class TicketTriggerHooks {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    #[Autowire(service: 'bb_ticket_trigger.runner')]
    private readonly TicketTriggerRunner $runner,
    #[Autowire(service: 'plugin.manager.bb_ticket_trigger_target')]
    private readonly TicketTriggerTargetPluginManager $targetManager,
  ) {}

  /**
   * Runs the due triggers; Drupal's cron lock keeps runs from overlapping.
   */
  #[Hook('cron')]
  public function cron(): void {
    $this->runner->runDue();
  }

  /**
   * Deletes the triggers of a deleted target with it.
   */
  #[Hook('entity_delete')]
  public function entityDelete(EntityInterface $entity): void {
    $storage = $this->entityTypeManager->getStorage('bb_ticket_trigger');
    foreach (array_keys($this->targetManager->getDefinitions()) as $bundle) {
      $target = $this->targetManager->createInstance($bundle);
      assert($target instanceof BbTicketTriggerTargetInterface);
      if ($target->targetEntityType() !== $entity->getEntityTypeId()) {
        continue;
      }
      $ids = $storage->getQuery()->accessCheck(FALSE)
        ->condition('bundle', $bundle)
        ->condition($target->targetField(), $entity->id())
        ->execute();
      $storage->delete($storage->loadMultiple($ids));
    }
  }

}
