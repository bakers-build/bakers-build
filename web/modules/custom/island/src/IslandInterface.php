<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Component\Plugin\PluginInspectionInterface;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Session\AccountInterface;

/**
 * Interface for island plugins.
 */
interface IslandInterface extends PluginInspectionInterface, ContainerFactoryPluginInterface {

  /**
   * Builds the island content.
   *
   * @param array $data
   *   Host-supplied data. The island never receives the host itself.
   * @param array $options
   *   Additional rendering options.
   *
   * @return array
   *   A render array.
   */
  public function build(array $data = [], array $options = []): array;

  /**
   * Returns the translated plugin label.
   */
  public function label(): string;

  /**
   * Returns the island type id (a plain string registered by the host).
   */
  public function getTypeId(): string;

  /**
   * Returns the OOB-stable HTML wrapper id: island-<host>-<plugin>.
   */
  public function getHtmlId(string $host_id): string;

  /**
   * The client-side update contract this island declares for its container.
   *
   * The island is the ONE author of its own declaration, and every render asks
   * it: the host's page build, the main fragment of a boosted GET, the
   * out-of-band peer of somebody else's, and the mutation path. A caller that
   * applied the declaration itself would be a second author, and the page and
   * the fragment would then agree only for as long as somebody kept them in
   * step — which is the drift IslandBoost exists to make impossible.
   *
   * Asking is a LOOKUP. The island answers from what it is, never from the
   * route, the referrer or a comparison against the previous page.
   *
   * @return \Drupal\island\IslandBoost|null
   *   The declaration, or NULL for an island whose links are ordinary links.
   *   A fresh instance each call: the declaration is written onto a build and
   *   an island may be rendered more than once in a response.
   */
  public function boost(): ?IslandBoost;

  /**
   * Events this island subscribes to.
   *
   * @return array<string, string>
   *   Map of event name to a public method on the island accepting
   *   \Drupal\island\IslandEvent and returning a render array or NULL
   *   (NULL leaves the island untouched).
   */
  public function getSubscribedEvents(): array;

  /**
   * Access check for an action link invocation.
   */
  public function accessAction(string $action, array $parameters, AccountInterface $account): AccessResultInterface;

  /**
   * Applies an action link invocation (POST mutations only).
   */
  public function applyAction(string $action, array $parameters): IslandResponse;

}
