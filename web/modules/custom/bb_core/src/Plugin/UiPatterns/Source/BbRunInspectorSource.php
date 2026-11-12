<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Run\BbRunInspectorRows;
use Drupal\bb_core\Ticket\TicketInterventions;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Inspector rails of the canonical run page.
 */
#[Source(
  id: 'bb_run_inspector',
  label: new TranslatableMarkup('[bakers.build] Run inspector'),
  description: new TranslatableMarkup('Status, attribution, timing, footprint and downloads of a run.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_run', label: new TranslatableMarkup('Run'), required: TRUE),
  ],
)]
final class BbRunInspectorSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * Builds the inspector zones.
   */
  protected BbRunInspectorRows $inspectorRows;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->inspectorRows = $container->get('bb_core.run_inspector_rows');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $run = $this->run();
    if ($run === NULL) {
      return [];
    }
    $build = $this->inspectorRows->blocks($run);
    $cache = CacheableMetadata::createFromRenderArray($build)
      ->addCacheableDependency($run)
      ->addCacheableDependency(TicketInterventions::runCacheability($run))
      ->addCacheContexts(['user', 'url.path'])
      ->addCacheTags(['og_membership_list']);
    $ticket = $run->getTicket();
    if ($ticket !== NULL) {
      $cache->addCacheableDependency($ticket);
    }
    $conductor = $run->get('conductor_id')->entity;
    if ($conductor !== NULL) {
      $cache->addCacheableDependency($conductor);
    }
    $cache->applyTo($build);
    return $build;
  }

  /**
   * The run this display is rendering, or NULL off a run.
   */
  private function run(): ?BbRunInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    return $entity instanceof BbRunInterface ? $entity : NULL;
  }

}
