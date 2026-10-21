<?php

declare(strict_types=1);

namespace Drupal\bb_connector\Plugin\BbConnector;

use Drupal\Core\Plugin\PluginBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_connector\Attribute\BbConnectorPlugin;
use Drupal\bb_connector\ConnectorPluginInterface;
use Drupal\bb_connector\Entity\BbConnectorInterface;

/**
 * Connector plugin for GitLab instances (REST API v4).
 */
#[BbConnectorPlugin(
  id: 'gitlab',
  label: new TranslatableMarkup('GitLab'),
)]
final class GitlabConnector extends PluginBase implements ConnectorPluginInterface {

  /**
   * {@inheritdoc}
   */
  public function issuesUrl(BbConnectorInterface $connector, string $project_id, int $page, array $iids = []): string {
    $base = rtrim((string) $connector->getSetting('base_url'), '/');
    $query = ['scope' => 'all', 'per_page' => 100, 'page' => $page];
    if ($iids !== []) {
      $query['iids'] = array_values($iids);
    }
    // http_build_query() encodes iids as iids[0]=…; GitLab expects iids[]=…
    // — strip the array index from the encoded key.
    $encoded = http_build_query($query);
    $encoded = preg_replace('/%5B\d+%5D/', '%5B%5D', $encoded);
    return sprintf('%s/api/v4/projects/%s/issues?%s', $base, rawurlencode($project_id), $encoded);
  }

  /**
   * {@inheritdoc}
   */
  public function authHeaders(BbConnectorInterface $connector): array {
    return ['PRIVATE-TOKEN' => (string) $connector->getSetting('token')];
  }

  /**
   * {@inheritdoc}
   */
  public function parseIssueUrl(BbConnectorInterface $connector, string $url): ?array {
    $base = rtrim((string) $connector->getSetting('base_url'), '/');
    if ($base === '' || !str_starts_with($url, $base . '/')) {
      return NULL;
    }
    $path = substr($url, strlen($base));
    if (!preg_match('#^/(.+?)/-/issues/(\d+)(?:[/?\#].*)?$#', $path, $matches)) {
      return NULL;
    }
    return ['project_path' => $matches[1], 'iid' => (int) $matches[2]];
  }

}
