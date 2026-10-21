<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\PropTypeInterface;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * One sentence about the workspace the address carries.
 *
 * Derived from the route, never copied from a design sample: a `textfield`
 * source is a constant and there is no workspace token. The sentence is the
 * setting, with `@workspace` as its only placeholder. Off a workspace route
 * (kernel renders, the display builder preview) the workspace-less form is
 * used.
 */
#[Source(
  id: 'bb_ambient_workspace_sentence',
  label: new TranslatableMarkup('[bakers.build] Ambient workspace sentence'),
  description: new TranslatableMarkup('One line naming the workspace the current address carries.'),
  prop_types: ['string'],
)]
final class AmbientWorkspaceSentenceSource extends SourcePluginBase {

  /**
   * The route slot every workspace-prefixed route carries.
   *
   * `BbWorkspaceRouteSubscriber` stamps the converter on every route whose
   * path starts with the prefix — by PATH, not by a list of route names — so
   * the parameter is an upcast entity here whether the route came from an
   * entity type's `links`, from a routing file, or, as on this screen, from a
   * Views page display.
   */
  private const string PARAMETER = 'bb_workspace';

  /**
   * {@inheritdoc}
   */
  public function defaultSettings(): array {
    return [
      'sentence' => 'Every ticket in the @workspace workspace',
      'sentence_without_workspace' => 'Every ticket in this workspace',
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $workspace = $this->routeMatch->getParameter(self::PARAMETER);
    if (!$workspace instanceof BbWorkspaceInterface) {
      return (string) $this->getSetting('sentence_without_workspace');
    }

    return str_replace(
      '@workspace',
      (string) $workspace->label(),
      (string) $this->getSetting('sentence'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getValue(?PropTypeInterface $prop_type = NULL): mixed {
    return $this->getPropValue();
  }

  /**
   * {@inheritdoc}
   *
   * A STRING PROP HAS NOWHERE TO PUT CACHE METADATA — it is a scalar in
   * `#props`, not a render array — so the dependency is declared on the
   * COMPONENT this source fills instead, which is what `alterComponent()` is
   * for. Without it a workspace rename would leave the old name standing in
   * any render cache the display's `max-age: -1` allows.
   *
   * @param array<string, mixed> $element
   *   The component build this source contributes a prop to.
   *
   * @return array<string, mixed>
   *   The build, carrying the workspace's own cacheability.
   */
  public function alterComponent(array $element): array {
    $workspace = $this->routeMatch->getParameter(self::PARAMETER);
    $metadata = CacheableMetadata::createFromRenderArray($element)
      // The address is what decides which workspace this is, and it decides
      // it on both branches — including the one that found no workspace.
      ->addCacheContexts(['url.path']);
    if ($workspace instanceof BbWorkspaceInterface) {
      $metadata->addCacheableDependency($workspace);
    }
    $metadata->applyTo($element);

    return $element;
  }

}
