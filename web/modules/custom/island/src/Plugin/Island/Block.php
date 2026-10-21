<?php

declare(strict_types=1);

namespace Drupal\island\Plugin\Island;

use Drupal\Core\Block\BlockManagerInterface;
use Drupal\Core\Block\BlockPluginInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Access\CsrfTokenGenerator;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\Render\RendererInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;
use Drupal\island\IslandPluginManagerInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Renders a configured Drupal block as an island placement.
 *
 * This adapter lets migrated Display Builder page layouts retain block
 * placements while the page-layout entity itself is retired. The standard
 * Menu and Page Content plugins remain the preferred choices for new profiles.
 *
 * @SuppressWarnings("PHPMD.ExcessiveParameterList")
 */
#[Island(
  id: 'block',
  label: new TranslatableMarkup('Block'),
  description: new TranslatableMarkup('Renders a Drupal block plugin.'),
  type: 'block',
)]
final class Block extends IslandPluginBase {

  public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    EntityTypeManagerInterface $entity_type_manager,
    RendererInterface $renderer,
    FormBuilderInterface $form_builder,
    IslandPluginManagerInterface $island_manager,
    LoggerInterface $logger,
    CsrfTokenGenerator $csrf_token,
    RequestStack $request_stack,
    BlockManagerInterface $block_manager,
    private readonly AccountInterface $currentUser,
  ) {
    parent::__construct(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $entity_type_manager,
      $renderer,
      $form_builder,
      $island_manager,
      $logger,
      $csrf_token,
      $request_stack,
    );
    $this->blockManager = $block_manager;
  }

  /**
   * The block plugin manager.
   */
  private BlockManagerInterface $blockManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    return new static(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('entity_type.manager'),
      $container->get('renderer'),
      $container->get('form_builder'),
      $container->get('plugin.manager.island'),
      $container->get('logger.factory')->get('island'),
      $container->get('csrf_token'),
      $container->get('request_stack'),
      $container->get('plugin.manager.block'),
      $container->get('current_user'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    $configuration = $this->configuration;
    $plugin_id = trim((string) ($configuration['plugin_id'] ?? ''));
    if ($plugin_id === '') {
      return [];
    }

    $block = $this->blockManager->createInstance($plugin_id, $configuration['configuration'] ?? []);
    if (!$block instanceof BlockPluginInterface) {
      return [];
    }
    $access = $block->access($this->currentUser, TRUE);
    $build = $access->isAllowed() ? $block->build() : [];
    CacheableMetadata::createFromObject($block)
      ->addCacheableDependency($access)
      ->applyTo($build);
    return $build;
  }

}
