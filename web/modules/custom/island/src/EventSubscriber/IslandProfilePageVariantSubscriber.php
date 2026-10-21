<?php

declare(strict_types=1);

namespace Drupal\island\EventSubscriber;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Render\PageDisplayVariantSelectionEvent;
use Drupal\Core\Render\RenderEvents;
use Drupal\island\Entity\App;
use Drupal\island\IslandProfileRenderer;
use Drupal\island\IslandProfileSelector;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Selects the configured page app's Island Profile for front-end pages.
 */
final class IslandProfilePageVariantSubscriber implements EventSubscriberInterface {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly IslandProfileSelector $selector,
    private readonly IslandProfileRenderer $renderer,
    private readonly ConfigFactoryInterface $configFactory,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    return [
      KernelEvents::REQUEST => [
        ['onRequest', 31],
      ],
      RenderEvents::SELECT_PAGE_DISPLAY_VARIANT => [
        ['onSelectPageDisplayVariant', -100],
      ],
    ];
  }

  /**
   * Registers the selected profile host after routing, before kernel.view.
   */
  public function onRequest(RequestEvent $event): void {
    if (!$event->isMainRequest()) {
      return;
    }

    $request = $event->getRequest();
    $route = $request->attributes->get('_route_object');
    if ($route === NULL || ($route->getOption('_admin_route') ?? FALSE)) {
      return;
    }

    $app_id = (string) $this->configFactory->get('island.settings')->get('page_app');
    $app = $app_id === '' ? NULL : $this->entityTypeManager->getStorage('island_app')->load($app_id);
    if (!$app instanceof App || !$app->status()) {
      return;
    }

    $profile = $this->selector->select($app);
    if ($profile !== NULL) {
      $request->attributes->set('_island_profile_host', $this->renderer->registerHost($profile, 'page'));
    }
  }

  /**
   * Selects an Island Profile when a configured profile applies.
   */
  public function onSelectPageDisplayVariant(PageDisplayVariantSelectionEvent $event): void {
    $route = $event->getRouteMatch()->getRouteObject();
    if ($route === NULL || ($route->getOption('_admin_route') ?? FALSE)) {
      return;
    }

    $app_id = (string) $this->configFactory->get('island.settings')->get('page_app');
    $app = $app_id === '' ? NULL : $this->entityTypeManager->getStorage('island_app')->load($app_id);
    if (!$app instanceof App || !$app->status()) {
      return;
    }

    // The decision varies the page also when no profile matched: the ordinary
    // variant's output must not be served where a profile applies.
    $cache = new CacheableMetadata();
    $profile = $this->selector->select($app, $cache);
    $event->addCacheableDependency($cache);
    $event->addCacheableDependency($this->configFactory->get('island.settings'));
    if ($profile === NULL) {
      return;
    }

    $event->setPluginId('island_profile');
    $event->setPluginConfiguration(['app' => $app_id]);
  }

}
