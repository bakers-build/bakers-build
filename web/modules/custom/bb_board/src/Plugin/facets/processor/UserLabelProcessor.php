<?php

declare(strict_types=1);

namespace Drupal\bb_board\Plugin\facets\processor;

use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\facets\FacetInterface;
use Drupal\facets\Processor\BuildProcessorInterface;
use Drupal\facets\Processor\ProcessorPluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Names a user facet value by display name and keeps the missing value.
 *
 * Contrib's `uid_to_username_callback` drops every row that is not a user,
 * which drops the "no user" row too, so an Unassigned choice could never be
 * offered. This one names that row by the facet's missing label, loads the
 * accounts in one batch, and drops ids that no longer load.
 *
 * @FacetsProcessor(
 *   id = "bb_user_label",
 *   label = @Translation("bakers.build user label"),
 *   description = @Translation("Displays a user id by display name and the missing value by the missing label."),
 *   stages = {
 *     "build" = 5
 *   }
 * )
 */
final class UserLabelProcessor extends ProcessorPluginBase implements BuildProcessorInterface, ContainerFactoryPluginInterface {

  /**
   * Loads the accounts.
   */
  private EntityTypeManagerInterface $entityTypeManager;

  /**
   * {@inheritdoc}
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
   *   The named results.
   */
  public function build(FacetInterface $facet, array $results): array {
    $ids = [];
    foreach ($results as $result) {
      if (!$result->isMissing()) {
        $ids[] = $result->getRawValue();
      }
    }
    $accounts = $this->entityTypeManager->getStorage('user')->loadMultiple($ids);
    $named = [];
    foreach ($results as $result) {
      if ($result->isMissing()) {
        $result->setDisplayValue($facet->getMissingLabel());
        $named[] = $result;
        continue;
      }
      $account = $accounts[$result->getRawValue()] ?? NULL;
      if ($account instanceof AccountInterface) {
        $result->setDisplayValue((string) $account->getDisplayName());
        $facet->addCacheableDependency($account);
        $named[] = $result;
      }
    }
    return $named;
  }

}
