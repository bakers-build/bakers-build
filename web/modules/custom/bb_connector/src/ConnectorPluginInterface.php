<?php

declare(strict_types=1);

namespace Drupal\bb_connector;

use Drupal\bb_connector\Entity\BbConnectorInterface;

/**
 * Interface for connector plugins (one per external system type).
 */
interface ConnectorPluginInterface {

  /**
   * Builds the paginated issues list URL for one external project.
   *
   * @param \Drupal\bb_connector\Entity\BbConnectorInterface $connector
   *   The connector instance configuration.
   * @param string $project_id
   *   External project ID or URL-encoded path (e.g. 'group/proj' or '123').
   * @param int $page
   *   The 1-based page number.
   * @param array<int> $iids
   *   Optional issue IIDs to restrict the listing to (single import).
   */
  public function issuesUrl(BbConnectorInterface $connector, string $project_id, int $page, array $iids = []): string;

  /**
   * Returns auth headers for API requests.
   *
   * @return array<string, string>
   *   Header name => value.
   */
  public function authHeaders(BbConnectorInterface $connector): array;

  /**
   * Parses a human-facing issue URL belonging to this connector.
   *
   * @return array{project_path: string, iid: int}|null
   *   Parsed parts, or NULL when the URL does not belong to this connector
   *   or is not an issue URL.
   */
  public function parseIssueUrl(BbConnectorInterface $connector, string $url): ?array;

}
