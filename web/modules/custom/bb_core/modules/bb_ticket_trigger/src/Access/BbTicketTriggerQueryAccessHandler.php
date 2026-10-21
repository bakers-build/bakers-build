<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Access;

use Drupal\Core\Entity\EntityTypeBundleInfoInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Component\Plugin\PluginManagerInterface;
use Drupal\entity\QueryAccess\ConditionGroup;
use Drupal\entity\QueryAccess\QueryAccessHandler;
use Drupal\bb_ticket_trigger\TicketTrigger\BbTicketTriggerTargetInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\EventDispatcher\EventDispatcherInterface;

/**
 * Restricts trigger listings to the account's readable targets.
 *
 * One OR branch per target bundle: `bundle = <id> AND <target field> IN
 * <readable target IDs>`. The IDs are materialised by the target plugin, as
 * BbActivityQueryAccessHandler does for tickets, instead of a dotted
 * read-scope rule, which Views would map onto the wrong column
 *.
 */
final class BbTicketTriggerQueryAccessHandler extends QueryAccessHandler {

  /**
   * Constructs a BbTicketTriggerQueryAccessHandler.
   */
  public function __construct(
    EntityTypeInterface $entity_type,
    EntityTypeBundleInfoInterface $bundle_info,
    EventDispatcherInterface $event_dispatcher,
    AccountInterface $current_user,
    private readonly PluginManagerInterface $targetManager,
  ) {
    parent::__construct($entity_type, $bundle_info, $event_dispatcher, $current_user);
  }

  /**
   * {@inheritdoc}
   */
  public static function createInstance(ContainerInterface $container, EntityTypeInterface $entity_type): static {
    return new static(
      $entity_type,
      $container->get('entity_type.bundle.info'),
      $container->get('event_dispatcher'),
      $container->get('current_user'),
      $container->get('plugin.manager.bb_ticket_trigger_target'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function buildConditions($operation, AccountInterface $account): ConditionGroup {
    $conditions = new ConditionGroup('OR');
    $conditions->addCacheContexts(['user', 'user.permissions']);
    $conditions->addCacheTags(['og_membership_list']);
    if ($operation !== 'view') {
      return $conditions->alwaysFalse();
    }
    foreach (array_keys($this->targetManager->getDefinitions()) as $bundle) {
      $target = $this->targetManager->createInstance($bundle);
      assert($target instanceof BbTicketTriggerTargetInterface);
      $conditions->addCacheTags([$target->targetEntityType() . '_list']);
      $ids = $target->readableTargetIds($account);
      if ($ids === []) {
        continue;
      }
      $conditions->addCondition((new ConditionGroup('AND'))
        ->addCondition('bundle', $bundle)
        ->addCondition($target->targetField(), $ids));
    }
    if ($conditions->count() === 0) {
      return $conditions->alwaysFalse();
    }
    return $conditions;
  }

}
