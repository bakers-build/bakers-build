<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Plugin\views\field;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Url;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * A trigger row's operations as the theme's action menu.
 *
 * The items are the entity's own operations (Edit, Pause/Resume, Delete), so
 * their access checks stay the list builder's. Only Pause/Resume keeps its
 * link attributes: they open its confirmation in the overlay.
 */
#[ViewsField('bb_ticket_trigger_actions')]
final class BbTicketTriggerActions extends FieldPluginBase {

  /**
   * Supplies the trigger list builder, the owner of its operations.
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->entityTypeManager = $container->get('entity_type.manager');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function query(): void {
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>|string
   *   The action menu, or nothing when no operation is permitted.
   */
  public function render(ResultRow $values) {
    $trigger = $this->getEntity($values);
    if (!$trigger instanceof BbTicketTriggerInterface) {
      return '';
    }
    $operations = $this->entityTypeManager->getListBuilder('bb_ticket_trigger')->getOperations($trigger);
    $items = [];
    foreach ($operations as $key => $operation) {
      $url = $operation['url'] ?? NULL;
      if (!$url instanceof Url) {
        continue;
      }
      $item = ['label' => (string) $operation['title'], 'url' => $url->toString()];
      if ($key === 'toggle') {
        $item['attributes'] = $url->getOption('attributes') ?: [];
      }
      $items[] = $item;
    }
    $build = ['#cache' => ['contexts' => ['user.permissions', 'url.path'], 'tags' => $trigger->getCacheTags()]];
    if ($items === []) {
      return $build;
    }
    return $build + [
      '#type' => 'component',
      '#component' => 'bb_theme:action_menu',
      '#props' => [
        'label' => (string) $this->t('Actions for @label', ['@label' => $trigger->label()]),
        'items' => $items,
      ],
    ];
  }

}
