<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\search_api\processor;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\search_api\Attribute\SearchApiProcessor;
use Drupal\search_api\Datasource\DatasourceInterface;
use Drupal\search_api\IndexInterface;
use Drupal\search_api\Item\ItemInterface;
use Drupal\search_api\Processor\ProcessorPluginBase;
use Drupal\search_api\Processor\ProcessorProperty;
use Drupal\search_api\Query\ConditionGroupInterface;
use Drupal\search_api\Query\QueryInterface;

/**
 * Indexes the deployments carrying project work for the ticket drill-down.
 */
#[SearchApiProcessor(
  id: 'bb_deployment_identifiers',
  label: new TranslatableMarkup('bakers.build deployment identifiers'),
  description: new TranslatableMarkup('Deployment tickets carrying this work ticket.'),
  stages: ['add_properties' => 0, 'preprocess_query' => 0],
)]
final class BbDeploymentIdentifiers extends ProcessorPluginBase implements ContainerFactoryPluginInterface {

  /**
   * Reads deployment records at indexing and query time.
   */
  private EntityTypeManagerInterface $entityTypeManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->entityTypeManager = $container->get('entity_type.manager');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function preprocessSearchQuery(QueryInterface $query): void {
    $this->checkDeploymentConditions($query->getConditionGroup());
  }

  /**
   * A known identifier must not disclose an unreadable deployment's batch.
   */
  private function checkDeploymentConditions(ConditionGroupInterface $group): void {
    $conditions = &$group->getConditions();
    foreach ($conditions as $key => $condition) {
      if ($condition instanceof ConditionGroupInterface) {
        $this->checkDeploymentConditions($condition);
      }
      elseif ($condition->getField() === 'deployment_identifiers') {
        $values = array_filter((array) $condition->getValue(), static fn ($value): bool => $value !== '' && $value !== NULL);
        // The empty hidden form field submits '' when nothing is chosen.
        if ($values === []) {
          unset($conditions[$key]);
          continue;
        }
        $storage = $this->entityTypeManager->getStorage('bb_ticket');
        $ids = $storage->getQuery()->accessCheck(TRUE)
          ->condition('ticket_type.entity.name', 'deployment')
          ->condition('identifier', $values, 'IN')->execute();
        $readable = [];
        foreach ($storage->loadMultiple($ids) as $deployment) {
          assert($deployment instanceof BbTicketInterface);
          $readable[] = $deployment->getIdentifier();
        }
        $condition->setValue(is_array($condition->getValue()) ? ($readable ?: ['']) : ($readable[0] ?? ''));
      }
    }
  }

  /**
   * {@inheritdoc}
   */
  public static function supportsIndex(IndexInterface $index): bool {
    return $index->isValidDatasource('entity:bb_ticket');
  }

  /**
   * {@inheritdoc}
   */
  public function getPropertyDefinitions(?DatasourceInterface $datasource = NULL): array {
    return $datasource === NULL ? [
      'deployment_identifiers' => new ProcessorProperty([
        'label' => $this->t('Deployment identifiers'),
        'type' => 'string',
        'processor_id' => $this->getPluginId(),
        'is_list' => TRUE,
      ]),
    ] : [];
  }

  /**
   * {@inheritdoc}
   */
  public function addFieldValues(ItemInterface $item): void {
    $fields = $this->getFieldsHelper()->filterForPropertyPath($item->getFields(), NULL, 'deployment_identifiers');
    $ticket = $item->getOriginalObject()->getValue();
    if ($fields === [] || !$ticket instanceof BbTicketInterface
      || $ticket->get('ticket_type')->entity?->label() === 'deployment') {
      return;
    }
    // Indexing is viewer-independent; query-time scope protects the results.
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('ticket_type.entity.name', 'deployment')
      ->condition('referenced_tickets', $ticket->id())->execute();
    foreach ($storage->loadMultiple($ids) as $deployment) {
      assert($deployment instanceof BbTicketInterface);
      foreach ($fields as $field) {
        $field->addValue($deployment->getIdentifier());
      }
    }
  }

}
