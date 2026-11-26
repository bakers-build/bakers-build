<?php

declare(strict_types=1);

namespace Drupal\bb_webhook\Entity;

use Drupal\bb_core\Entity\BbContentEntityInterface;

/**
 * A signed HTTPS endpoint for the ticket activities of one scope.
 *
 * The scope is a project (`project_id`), a group (`group_id`) or, with
 * neither, the workspace (`workspace_id`, always set). It never changes after
 * the first save.
 */
interface BbWebhookInterface extends BbContentEntityInterface {

  /**
   * The endpoint, always `https://`.
   */
  public function getUrl(): string;

  /**
   * The HMAC key; generated on the first save.
   */
  public function getSecret(): string;

  /**
   * Whether deliveries are sent.
   */
  public function isEnabled(): bool;

  /**
   * The scope: `project`, `group` or `workspace`.
   */
  public function scope(): string;

}
