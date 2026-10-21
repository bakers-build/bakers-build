<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_oauth_device\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\consumers\Entity\Consumer;
use League\OAuth2\Server\Grant\DeviceCodeGrant;

/**
 * Tests the device code grant plugin.
 *
 * @group bb_oauth_device
 */
class DeviceCodeGrantPluginTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'user',
    'system',
    'file',
    'image',
    'options',
    'serialization',
    'consumers',
    'simple_oauth',
    'bb_oauth_device',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('consumer');
    $this->installConfig(['simple_oauth']);
  }

  /**
   * The plugin is discoverable under an id free of derivative separators.
   */
  public function testPluginIsDiscoverable(): void {
    $definitions = $this->container->get('plugin.manager.oauth2_grant.processor')->getDefinitions();

    $this->assertArrayHasKey('device_code', $definitions);
    $this->assertStringNotContainsString(':', (string) $definitions['device_code']['id']);
  }

  /**
   * The grant it builds reports league's URN, which is the wire grant type.
   */
  public function testGrantReportsTheRfcIdentifier(): void {
    $grant = $this->grantForConsumer();

    $this->assertInstanceOf(DeviceCodeGrant::class, $grant);
    $this->assertSame('urn:ietf:params:oauth:grant-type:device_code', $grant->getIdentifier());
  }

  /**
   * Building a refresh-less consumer's grant leaves the shared repository on.
   */
  public function testRefreshlessGrantLeavesSharedRepositoryEnabled(): void {
    $this->grantForConsumer();

    $this->assertNotNull($this->container->get('simple_oauth.repositories.refresh_token')->getNewRefreshToken());
  }

  /**
   * The existing grant plugins are still registered and untouched.
   */
  public function testSiblingGrantsRemain(): void {
    $definitions = $this->container->get('plugin.manager.oauth2_grant.processor')->getDefinitions();

    $this->assertArrayHasKey('authorization_code', $definitions);
    $this->assertArrayHasKey('client_credentials', $definitions);
    $this->assertArrayHasKey('refresh_token', $definitions);
  }

  /**
   * Builds the grant for a consumer declaring the device grant.
   */
  protected function grantForConsumer(): object {
    $consumer = Consumer::create([
      'client_id' => 'device-plugin-test',
      'label' => 'Device plugin test',
      'confidential' => FALSE,
      'grant_types' => ['device_code'],
      'access_token_expiration' => 300,
    ]);
    $consumer->save();

    /** @var \Drupal\simple_oauth\Plugin\Oauth2GrantInterface $plugin */
    $plugin = $this->container->get('plugin.manager.oauth2_grant.processor')
      ->createInstance('device_code');

    return $plugin->getGrantType($consumer);
  }

}
