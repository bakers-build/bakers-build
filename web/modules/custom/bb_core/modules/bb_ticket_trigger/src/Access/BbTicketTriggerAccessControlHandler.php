<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\EntityAccessControlHandler;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\bb_ticket_trigger\TicketTrigger\UnavailableTriggerType;

/**
 * Delegates trigger access to its target, through the bundle's plugin.
 *
 * Viewing a trigger needs only target `view`, so whoever sees a template
 * sees its automation. Changing one needs target `update` plus the trigger
 * permission, which only the workspace lead rank carries. The rank fence
 * scopes the permission to the trigger's own workspace. `toggle`
 * (pause/resume) is `update` minus the type form, so a trigger of an
 * unavailable type can still be paused while its edit form, which cannot
 * render that type, is denied.
 */
final class BbTicketTriggerAccessControlHandler extends EntityAccessControlHandler {

  /**
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity, $operation, AccountInterface $account): AccessResultInterface {
    if (!$entity instanceof BbTicketTriggerInterface || $entity->getTarget() === NULL) {
      return AccessResult::forbidden('The trigger has no target.')->addCacheableDependency($entity);
    }
    $target = $entity->getTargetPlugin();
    // neutral()->orIf() carries the trigger's own cacheability along.
    $own = AccessResult::neutral()->addCacheableDependency($entity);
    if ($operation === 'view') {
      return $own->orIf($target->access($entity, 'view', $account));
    }
    if ($operation === 'update' && $entity->getTypePlugin() instanceof UnavailableTriggerType) {
      return AccessResult::forbidden('The trigger type is unavailable.')->addCacheableDependency($entity);
    }
    $operation = $operation === 'toggle' ? 'update' : $operation;
    return $own->orIf($target->access($entity, $operation, $account)
      ->andIf(parent::checkAccess($entity, $operation, $account)));
  }

}
