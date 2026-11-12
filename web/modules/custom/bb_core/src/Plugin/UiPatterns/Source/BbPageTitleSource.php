<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Component\Render\MarkupInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Controller\TitleResolverInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Render\Markup;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\PropTypeInterface;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\Routing\Route;

/**
 * The Drupal page title, as a string the shell header can print.
 *
 * TitleResolver may return a string, markup, or a render array with #markup
 * (`UserController::userTitle`). A string prop cannot hold a render array,
 * and Twig escapes a plain string, so only a markup title stays markup.
 */
#[Source(
  id: 'bb_page_title',
  label: new TranslatableMarkup('[bakers.build] Page title'),
  description: new TranslatableMarkup('The current route title as plain text.'),
  prop_types: ['string'],
)]
final class BbPageTitleSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * Resolves the route title.
   */
  protected TitleResolverInterface $titleResolver;

  /**
   * The current request.
   */
  protected RequestStack $requestStack;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->titleResolver = $container->get('title_resolver');
    $instance->requestStack = $container->get('request_stack');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $request = $this->requestStack->getCurrentRequest();
    $route = $request?->attributes->get('_route_object');
    if ($request === NULL || !$route instanceof Route) {
      return '';
    }
    $title = $this->titleResolver->getTitle($request, $route);
    // A plain-text title is escaped at render; markup carries its escaping.
    return $title instanceof MarkupInterface ? Markup::create(self::stringify($title)) : self::stringify($title);
  }

  /**
   * {@inheritdoc}
   */
  public function getValue(?PropTypeInterface $prop_type = NULL): mixed {
    return $this->getPropValue();
  }

  /**
   * {@inheritdoc}
   */
  public function alterComponent(array $element): array {
    $metadata = CacheableMetadata::createFromRenderArray($element)
      ->addCacheContexts(['url']);
    $metadata->applyTo($element);
    return $element;
  }

  /**
   * Drupal titles may be a string, markup, or a render array with #markup.
   */
  public static function stringify(mixed $resolved): string {
    if (is_scalar($resolved) || $resolved instanceof \Stringable) {
      return trim((string) $resolved);
    }
    if (is_array($resolved)) {
      $markup = $resolved['#markup'] ?? $resolved['#plain_text'] ?? '';
      return trim(strip_tags((string) $markup));
    }
    return '';
  }

}
