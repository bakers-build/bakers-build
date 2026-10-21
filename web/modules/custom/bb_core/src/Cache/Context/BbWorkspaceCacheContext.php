<?php

declare(strict_types=1);

namespace Drupal\bb_core\Cache\Context;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Cache\Context\CacheContextInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Navigation\AccountWorkspaceContext;

/**
 * Varies by the ambient workspace of the request.
 *
 * Cache context ID: 'bb_workspace'.
 */
final class BbWorkspaceCacheContext implements CacheContextInterface {

  public function __construct(
    private readonly AccountWorkspaceContext $workspaceContext,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function getLabel(): TranslatableMarkup {
    return new TranslatableMarkup('Ambient bakers.build workspace');
  }

  /**
   * {@inheritdoc}
   */
  public function getContext(): string {
    return (string) ($this->workspaceContext->resolve(new CacheableMetadata())?->id() ?? 'none');
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheableMetadata(): CacheableMetadata {
    $cache = new CacheableMetadata();
    $this->workspaceContext->resolve($cache);
    return $cache;
  }

}
