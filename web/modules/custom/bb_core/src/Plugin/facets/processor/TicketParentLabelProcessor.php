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
    if ($keys === []) {
      return $results;
    }
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $ids = $storage->getQuery()->accessCheck(TRUE)->condition('identifier', $keys, 'IN')->execute();
    $titles = [];
    foreach ($storage->loadMultiple($ids) as $ticket) {
      if ($ticket instanceof BbTicketInterface) {
        $titles[$ticket->getIdentifier()] = (string) $ticket->label();
      }
    }
    foreach ($results as $result) {
      $key = (string) $result->getRawValue();
      if (isset($titles[$key])) {
        $result->setDisplayValue($key . ' · ' . $titles[$key]);
      }
    }
    return $results;
  }

}
