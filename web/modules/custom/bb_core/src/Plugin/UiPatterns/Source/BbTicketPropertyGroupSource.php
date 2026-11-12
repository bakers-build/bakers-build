<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Ticket\TicketInspectorRows;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * One read-only block of the ticket's Properties rail: Effort, Code, Relations.
 *
 * One source per block, so the inspector draws the divider between them.
 */
#[Source(
  id: 'bb_ticket_property_group',
  label: new TranslatableMarkup('[bakers.build] Ticket property group'),
  description: new TranslatableMarkup('A read-only block of the ticket Properties rail.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket', label: new TranslatableMarkup('Ticket'), required: TRUE),
  ],
)]
final class BbTicketPropertyGroupSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * Builds the rail's rows.
   */
  protected TicketInspectorRows $inspectorRows;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->inspectorRows = $container->get('bb_core.ticket_inspector_rows');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function settingsForm(array $form, FormStateInterface $form_state): array {
    $form['group'] = [
      '#type' => 'select',
      '#title' => $this->t('Group'),
      '#options' => array_combine(array_keys(TicketInspectorRows::GROUPS), array_keys(TicketInspectorRows::GROUPS)),
      '#default_value' => $this->getSetting('group') ?? 'effort',
      '#required' => TRUE,
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $ticket = $this->ticket();
    $group = (string) ($this->getSetting('group') ?? '');
    if ($ticket === NULL || !isset(TicketInspectorRows::GROUPS[$group])) {
      return [];
    }
    $build = $this->inspectorRows->groupBlock($group, $this->inspectorRows->build($ticket), $ticket);
    CacheableMetadata::createFromRenderArray($build)
      ->addCacheableDependency($ticket)
      ->addCacheContexts(['user'])
      ->addCacheTags(['bb_ticket_list', 'og_membership_list'])
      ->applyTo($build);
    return $build;
  }

  /**
   * Returns the ticket context, if present.
   */
  private function ticket(): ?BbTicketInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    return $entity instanceof BbTicketInterface ? $entity : NULL;
  }

}
