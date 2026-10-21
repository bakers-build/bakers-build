<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_connector\Kernel;

use Drupal\bb_connector\Entity\BbConnector;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Tests CRUD and settings access for the bb_connector config entity.
 */
#[Group('bb_connector')]
final class ConnectorEntityTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'file', 'image',
    'link', 'text', 'bb_core', 'bb_connector',
  ];

  /**
   * Tests saving, reloading, and settings access.
   */
  public function testCrudAndSettings(): void {
    $connector = BbConnector::create([
      'id' => 'keytec_gitlab',
      'label' => 'keytec GitLab',
      'plugin' => 'gitlab',
      'import_interval' => 3600,
      'settings' => [
        'base_url' => 'https://gitlab.example.test',
        'token' => 'glpat-test',
      ],
    ]);
    $connector->save();

    $loaded = BbConnector::load('keytec_gitlab');
    $this->assertInstanceOf(BbConnector::class, $loaded);
    $this->assertSame('gitlab', $loaded->getPluginId());
    $this->assertSame(3600, $loaded->getImportInterval());
    $this->assertSame('https://gitlab.example.test', $loaded->getSetting('base_url'));
    $this->assertSame('glpat-test', $loaded->getSetting('token'));
    $this->assertNull($loaded->getSetting('missing'));
  }

  /**
   * Tests the gitlab connector plugin URL building and parsing.
   */
  public function testGitlabPlugin(): void {
    $connector = BbConnector::create([
      'id' => 'keytec_gitlab',
      'label' => 'keytec GitLab',
      'plugin' => 'gitlab',
      'settings' => ['base_url' => 'https://gitlab.example.test/', 'token' => 't'],
    ]);
    $connector->save();

    /** @var \Drupal\bb_connector\ConnectorPluginManager $manager */
    $manager = $this->container->get('plugin.manager.bb_connector');
    /** @var \Drupal\bb_connector\ConnectorPluginInterface $plugin */
    $plugin = $manager->createInstance('gitlab');

    $this->assertSame(
      'https://gitlab.example.test/api/v4/projects/group%2Fproj/issues?scope=all&per_page=100&page=1',
      $plugin->issuesUrl($connector, 'group/proj', 1),
    );
    $this->assertSame(
      'https://gitlab.example.test/api/v4/projects/group%2Fproj/issues?scope=all&per_page=100&page=1&iids%5B%5D=42',
      $plugin->issuesUrl($connector, 'group/proj', 1, [42]),
    );
    $this->assertSame(['PRIVATE-TOKEN' => 't'], $plugin->authHeaders($connector));

    $parsed = $plugin->parseIssueUrl($connector, 'https://gitlab.example.test/group/proj/-/issues/42');
    $this->assertSame(['project_path' => 'group/proj', 'iid' => 42], $parsed);
    $this->assertNull($plugin->parseIssueUrl($connector, 'https://other.example.test/group/proj/-/issues/42'));
    $this->assertNull($plugin->parseIssueUrl($connector, 'https://gitlab.example.test/group/proj/-/merge_requests/7'));
  }

}
