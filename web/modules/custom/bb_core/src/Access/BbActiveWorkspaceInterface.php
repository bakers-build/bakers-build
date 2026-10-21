<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\bb_core\Entity\BbWorkspaceInterface;

/**
 * Resolves the workspace a request is standing in.
 *
 * The URL is the only source: an add-form route (`_entity_form` operation
 * `add`) whose match carries an upcast bb_workspace parameter; otherwise
 * none. It takes no account and is permission-blind by construction.
 *.
 */
interface BbActiveWorkspaceInterface {

  /**
   * The workspace came from an add-form route's parameter.
   */
  const SOURCE_ROUTE = 'route';

  /**
   * There is no active workspace.
   */
  const SOURCE_NONE = 'none';

  /**
   * Resolves the active workspace of the current request.
   *
   * @return \Drupal\bb_core\Entity\BbWorkspaceInterface|null
   *   The active workspace, or NULL when the request is not create context.
   */
  public function resolve(): ?BbWorkspaceInterface;

  /**
   * Names which link of the chain answered.
   *
   * @return string
   *   One of self::SOURCE_ROUTE or self::SOURCE_NONE. Consumers compare
   *   against those constants, never against a bare string.
   */
  public function source(): string;

}
