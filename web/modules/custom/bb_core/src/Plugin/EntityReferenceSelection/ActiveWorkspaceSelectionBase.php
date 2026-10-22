<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\EntityReferenceSelection;

use Drupal\Core\Entity\Plugin\EntityReferenceSelection\DefaultSelection;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Shared plumbing for workspace-narrowing selection handlers on bakers types.
 *
 * The plugins narrow different types with different conditions, but they ask
 * the same two questions first — "may this account be narrowed at all" and
 * "which workspace am I in" — and got them wrong in the same way once already.
 * One base class so the answers cannot drift apart again.
 *
 * THE ANSWERS THEMSELVES LIVE IN `ActiveWorkspaceSelectionTrait`, not here, and
 * that is a single-inheritance constraint rather than taste: `assignee_user_id`
 * narrows the `user` type, whose handler must extend core's `UserSelection` to
 * keep the anonymous, blocked and role filtering that class adds — so it cannot
 * also extend this one. The trait is what both branches share; this class stays
 * as the base for every bakers-type plugin, which is what the two existing ones
 * already are.
 *
 * @see \Drupal\bb_core\Plugin\EntityReferenceSelection\ActiveWorkspaceSelectionTrait
 */
abstract class ActiveWorkspaceSelectionBase extends DefaultSelection {

  use ActiveWorkspaceSelectionTrait;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->initActiveWorkspaceServices($container);
    return $instance;
  }

}
