<?php

declare(strict_types=1);

namespace Drupal\bb_core\ParamConverter;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\ParamConverter\ParamConverterInterface;
use Symfony\Component\Routing\Route;

/**
 * Upcasts the workspace segment of a product URL from a workspace slug.
 *
 * The first path segment of every product route is the workspace slug, never
 * a workspace entity id, so the stock entity converter cannot bind it. An
 * unknown slug converts to NULL, which the router turns into a 404 before any
 * access check runs.
 *
 * `accessCheck(FALSE)` is deliberate. Whether the account may see this
 * workspace is the workspace access check's decision (`_bb_workspace_match`),
 * and it has to be, because the converter's failure mode and the access check's
 * are the same 404 for different reasons. Letting query access narrow the
 * lookup here would move that decision into a place with no cacheability
 * metadata and no way to tell "no such workspace" from "not your workspace".
 */
final class BbWorkspaceSlugConverter implements ParamConverterInterface {

  /**
   * The parameter type this converter binds.
   */
  public const TYPE = 'bb_workspace_slug';

  /**
   * Constructs a BbWorkspaceSlugConverter.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public function convert($value, $definition, $name, array $defaults) {
    if (!is_string($value) || $value === '') {
      return NULL;
    }
    $storage = $this->entityTypeManager->getStorage('bb_workspace');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('slug', $value)
      ->range(0, 1)
      ->execute();
    if ($ids === []) {
      return NULL;
    }
    return $storage->load(reset($ids));
  }

  /**
   * {@inheritdoc}
   */
  public function applies($definition, $name, Route $route) {
    return ($definition['type'] ?? NULL) === self::TYPE;
  }

}
