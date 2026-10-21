<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Menu;

use Drupal\Core\Access\AccessResultInterface;

/**
 * A menu link whose route parameters come from the request, not storage.
 *
 * Core's `checkAccess` tree manipulator generates the link's URL before it
 * checks access, so a link missing its runtime parameter would fail there.
 * `BbMenuSource` asks this method first.
 */
interface AmbientScopedMenuLinkInterface {

  /**
   * The access result decided by the request context, or NULL.
   *
   * @return \Drupal\Core\Access\AccessResultInterface|null
   *   A result that replaces core's route access check, or NULL to let core
   *   check the route.
   */
  public function ambientAccess(): ?AccessResultInterface;

}
