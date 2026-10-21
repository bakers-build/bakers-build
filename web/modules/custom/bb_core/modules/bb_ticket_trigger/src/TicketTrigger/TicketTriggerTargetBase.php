<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\TicketTrigger;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\PluginBase;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Session\AccountSwitcherInterface;
use Drupal\entity\BundleFieldDefinition;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Target lookup, tenancy and access from the attribute's target type/field.
 */
abstract class TicketTriggerTargetBase extends PluginBase implements BbTicketTriggerTargetInterface, ContainerFactoryPluginInterface {

  /**
   * Constructs a TicketTriggerTargetBase.
   *
   * @param array<string, mixed> $configuration
   *   The plugin configuration.
   * @param string $plugin_id
   *   The plugin ID.
   * @param array<string, mixed> $plugin_definition
   *   The plugin definition.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager.
   * @param \Drupal\bb_core\Access\WorkspaceResolverInterface $workspaceResolver
   *   The workspace resolver.
   * @param \Drupal\Core\Session\AccountSwitcherInterface $accountSwitcher
   *   The account switcher.
   */
  final public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    protected readonly EntityTypeManagerInterface $entityTypeManager,
    protected readonly WorkspaceResolverInterface $workspaceResolver,
    protected readonly AccountSwitcherInterface $accountSwitcher,
  ) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
  }

  /**
   * {@inheritdoc}
   *
   * @param \Symfony\Component\DependencyInjection\ContainerInterface $container
   *   The container.
   * @param array<string, mixed> $configuration
   *   The plugin configuration.
   * @param string $plugin_id
   *   The plugin ID.
   * @param array<string, mixed> $plugin_definition
   *   The plugin definition.
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    return new static(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('entity_type.manager'),
      $container->get(WorkspaceResolverInterface::class),
      $container->get('account_switcher'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function buildFieldDefinitions(): array {
    $field = $this->targetField();
    return [
      $field => BundleFieldDefinition::create('entity_reference')
        ->setName($field)
        ->setLabel($this->definition('label'))
        ->setRequired(TRUE)
        ->setSetting('target_type', $this->targetEntityType()),
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function getTarget(BbTicketTriggerInterface $trigger): ?EntityInterface {
    $field = $this->targetField();
    if (!$trigger->hasField($field)) {
      return NULL;
    }
    $target = $trigger->get($field)->entity;
    return $target instanceof EntityInterface ? $target : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getWorkspace(BbTicketTriggerInterface $trigger): ?BbWorkspaceInterface {
    $target = $this->getTarget($trigger);
    return $target === NULL ? NULL : $this->workspaceResolver->resolve($target);
  }

  /**
   * {@inheritdoc}
   */
  public function access(BbTicketTriggerInterface $trigger, string $operation, AccountInterface $account): AccessResultInterface {
    $target = $this->getTarget($trigger);
    if ($target === NULL) {
      return AccessResult::forbidden('The trigger has no target.')->addCacheableDependency($trigger);
    }
    return $target->access($operation === 'view' ? 'view' : 'update', $account, TRUE);
  }

  /**
   * {@inheritdoc}
   */
  public function readableTargetIds(AccountInterface $account): array {
    $this->accountSwitcher->switchTo($account);
    try {
      // shortcut: readable target IDs materialised per query; use a SQL
      // subquery if targets per account grow large.
      return array_values($this->entityTypeManager->getStorage($this->targetEntityType())
        ->getQuery()
        ->accessCheck(TRUE)
        ->execute());
    }
    finally {
      $this->accountSwitcher->switchBack();
    }
  }

  /**
   * {@inheritdoc}
   */
  public function targetEntityType(): string {
    return $this->definition('target_entity_type');
  }

  /**
   * {@inheritdoc}
   */
  public function targetField(): string {
    return $this->definition('target_field');
  }

  /**
   * One string value of the plugin definition.
   */
  private function definition(string $key): string {
    $definition = $this->getPluginDefinition();
    assert(is_array($definition));
    return (string) $definition[$key];
  }

}
