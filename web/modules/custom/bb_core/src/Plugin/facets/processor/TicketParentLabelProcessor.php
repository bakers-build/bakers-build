<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\facets\processor;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\facets\FacetInterface;
use Drupal\facets\Processor\BuildProcessorInterface;
use Drupal\facets\Processor\ProcessorPluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Names a parent ticket "KEY · Title" by the identifier the facet holds.
 *
 * The facet value is the parent's identifier, which is also the `?parent=`
 * value. The lookup applies the workspace read scope, so a key nothing
 * carries, or one of a ticket the reader may not read, keeps its raw value
 * and never discloses another workspace's title.
 *
 * @FacetsProcessor(
 *   id = "bb_ticket_parent_label",
 *   label = @Translation("bakers.build ticket parent label"),
 *   description = @Translation("Displays a parent ticket identifier as its key and title."),
 *   stages = {
 *     "build" = 5
 *   }
 * )
 */
final class TicketParentLabelProcessor extends ProcessorPluginBase implements BuildProcessorInterface, ContainerFactoryPluginInterface {

  /**
   * The entity type manager the parents are read through.
   */
  private EntityTypeManagerInterface $entityTypeManager;

  /**
   * {@inheritdoc}
   *
   * @param \Symfony\Component\DependencyInjection\ContainerInterface $container
   *   The service container.
   * @param array<string, mixed> $configuration
   *   The plugin configuration.
   * @param string $plugin_id
   *   The plugin id.
   * @param mixed $plugin_definition
   *   The plugin definition.
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = new static($configuration, $plugin_id, $plugin_definition);
    $instance->entityTypeManager = $container->get('entity_type.manager');
    return $instance;
  }

  /**
   * {@inheritdoc}
   *
   * @param \Drupal\facets\FacetInterface $facet
   *   The facet being built.
   * @param array<int, \Drupal\facets\Result\ResultInterface> $results
   *   The results to name.
   *
   * @return array<int, \Drupal\facets\Result\ResultInterface>
   *   The same results, named.
   */
  public function build(FacetInterface $facet, array $results): array {
    $keys = [];
    foreach ($results as $result) {
      $keys[] = (string) $result->getRawValue();
    }
    $labels = self::labels($this->entityTypeManager, $keys);
    foreach ($results as $result) {
      $key = (string) $result->getRawValue();
      if (isset($labels[$key])) {
        $result->setDisplayValue($labels[$key]);
      }
    }
    return $results;
  }

  /**
   * The "KEY · Title" label of every given key the reader may read.
   *
   * Shared with the filter summary, which names a chosen parent the facet
   * has no result for.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entity_type_manager
   *   The entity type manager.
   * @param array<int, string> $keys
   *   Ticket identifiers.
   *
   * @return array<string, string>
   *   The labels, keyed by identifier; an unknown or unreadable key is absent.
   */
  public static function labels(EntityTypeManagerInterface $entity_type_manager, array $keys): array {
    if ($keys === []) {
      return [];
    }
    $storage = $entity_type_manager->getStorage('bb_ticket');
    $ids = $storage->getQuery()->accessCheck(TRUE)->condition('identifier', $keys, 'IN')->execute();
    $labels = [];
    foreach ($storage->loadMultiple($ids) as $ticket) {
      if ($ticket instanceof BbTicketInterface) {
        $labels[$ticket->getIdentifier()] = $ticket->getIdentifier() . ' · ' . $ticket->label();
      }
    }
    return $labels;
  }

}
