<?php

declare(strict_types=1);

namespace Drupal\island\Plugin\DisplayVariant;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Display\Attribute\PageDisplayVariant;
use Drupal\Core\Display\PageVariantInterface;
use Drupal\Core\Display\VariantBase;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Extension\ModuleExtensionList;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Theme\Registry;
use Drupal\Component\Render\MarkupInterface;
use Drupal\island\Entity\App;
use Drupal\island\IslandProfileRenderer;
use Drupal\island\IslandProfileSelector;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Renders the selected Island Profile as a complete page variant.
 */
#[PageDisplayVariant(
  id: 'island_profile',
  admin_label: new TranslatableMarkup('Island profile page'),
)]
final class IslandProfilePageVariant extends VariantBase implements ContainerFactoryPluginInterface, PageVariantInterface {

  /**
   * The controller's page content.
   *
   * @var array<string, mixed>
   */
  private array $mainContent = [];

  /**
   * The page title.
   */
  private string|array $title = '';

  public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly IslandProfileSelector $selector,
    private readonly IslandProfileRenderer $renderer,
    private readonly Registry $themeRegistry,
    private readonly ModuleExtensionList $modules,
  ) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    return new static(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('entity_type.manager'),
      $container->get('island.profile_selector'),
      $container->get('island.profile_renderer'),
      $container->get('theme.registry'),
      $container->get('extension.list.module'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function build(): array {
    $app_id = (string) ($this->configuration['app'] ?? '');
    $app = $app_id === '' ? NULL : $this->entityTypeManager->getStorage('island_app')->load($app_id);
    if (!$app instanceof App || !$app->status()) {
      return ['content' => $this->mainContent];
    }

    // Like core's block variant, the page carries this variant's metadata,
    // which includes the selection event's, and the selection's own.
    $cache = CacheableMetadata::createFromObject($this);
    $profile = $this->selector->select($app, $cache);
    if ($profile === NULL) {
      $build = ['content' => $this->mainContent];
      $cache->applyTo($build);
      return $build;
    }

    // Like Display Builder Page Layout, the profile owns the entire page.
    // Keep Drupal's page pipeline, but omit the theme's extra page/region hull.
    $this->useProfilePageTemplates();
    $build = [
      'content' => $this->renderer->render($profile, 'page', [
        'content' => $this->mainContent,
        'title' => $this->title,
      ]),
    ];
    $cache->applyTo($build);
    return $build;
  }

  /**
   * Uses pass-through templates only when this page is owned by a profile.
   */
  private function useProfilePageTemplates(): void {
    $registry = $this->themeRegistry->get();
    $runtime = $this->themeRegistry->getRuntime();
    $path = $this->modules->getPath('island') . '/templates';
    foreach (['page', 'region'] as $hook) {
      $registry[$hook]['path'] = $path;
      $runtime->set($hook, $registry[$hook]);
    }
    // Theme-specific suggestions must not reintroduce the outer layout.
    foreach (array_keys($registry) as $hook) {
      if (str_starts_with($hook, 'page__') || str_starts_with($hook, 'region__')) {
        $runtime->delete($hook);
      }
    }
  }

  /**
   * {@inheritdoc}
   */
  public function setMainContent(array $main_content): self {
    $this->mainContent = $main_content;
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function setTitle($title): self {
    $this->title = match (TRUE) {
      $title instanceof MarkupInterface => (string) $title,
      is_array($title),
      is_string($title) => $title,
      default => '',
    };
    return $this;
  }

}
