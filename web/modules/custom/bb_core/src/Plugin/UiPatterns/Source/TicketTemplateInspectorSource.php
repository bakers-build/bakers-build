<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\bb_core\TicketTemplate\TicketTemplateInspectorRows;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The Properties block of a ticket template's detail screen.
 */
#[Source(
  id: 'bb_ticket_template_inspector',
  label: new TranslatableMarkup('[bakers.build] Ticket template properties'),
  description: new TranslatableMarkup('The read-only properties a ticket template copies into its tickets.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket_template', label: new TranslatableMarkup('Ticket template'), required: TRUE),
  ],
)]
final class TicketTemplateInspectorSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * Builds the rail's rows.
   */
  protected TicketTemplateInspectorRows $inspectorRows;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->inspectorRows = $container->get('bb_core.ticket_template_inspector_rows');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    try {
      $template = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return [];
    }
    if (!$template instanceof BbTicketTemplateInterface) {
      return [];
    }
    $build = $this->inspectorRows->propertiesBlock($this->inspectorRows->build($template));
    CacheableMetadata::createFromRenderArray($build)
      ->addCacheableDependency($template)
      ->addCacheContexts(['user'])
      ->addCacheTags(['bb_term_list', 'bb_conductor_list', 'og_membership_list'])
      ->applyTo($build);
    return $build;
  }

}
