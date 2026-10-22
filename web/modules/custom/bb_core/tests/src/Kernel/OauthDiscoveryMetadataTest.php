<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\simple_oauth_server_metadata\Service\ResourceMetadataService;
use Drupal\simple_oauth_server_metadata\Service\ServerMetadataService;

/**
 * BB-658 AC1/AC6: RFC 8414 discovery with no controller code of ours.
 *
 * `simple_oauth_server_metadata` + `simple_oauth_pkce` supply the discovery
 * endpoint; this asserts the content claude.ai's OAuth client actually
 * needs, rather than trusting that enabling the modules was enough.
 */
#[\PHPUnit\Framework\Attributes\Group('bb_core')]
final class OauthDiscoveryMetadataTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'serialization', 'options', 'image', 'file',
    'consumers', 'simple_oauth',
    'simple_oauth_21', 'simple_oauth_server_metadata', 'simple_oauth_pkce',
    'simple_oauth_client_registration', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('consumer');
    $this->installEntitySchema('file');
    $this->installConfig([
      'simple_oauth', 'simple_oauth_server_metadata', 'simple_oauth_pkce',
      'simple_oauth_client_registration',
    ]);
  }

  /**
   * Core endpoints resolve to absolute URLs on THIS site.
   *
   * Issuer, authorize, token, jwks and userinfo — the authorization server
   * claude.ai talks to.
   */
  public function testCoreEndpointsAreAbsoluteUrlsOnThisSite(): void {
    $metadata = $this->serverMetadata()->getServerMetadata();

    foreach ([
      'issuer', 'authorization_endpoint', 'token_endpoint',
      'jwks_uri', 'userinfo_endpoint',
    ] as $key) {
      self::assertArrayHasKey($key, $metadata, "metadata is missing '$key'");
      self::assertMatchesRegularExpression(
        '#^https?://#',
        (string) $metadata[$key],
        "'$key' must be an absolute URL",
      );
    }
  }

  /**
   * S256 is advertised as a supported code challenge method (AC1/AC6).
   *
   * `simple_oauth_21`'s `ClaimsAuthDiscoveryService::
   * getCodeChallengeMethodsSupported()` (v1.13.1) hardcodes
   * `['S256', 'plain']` and does not read
   * `simple_oauth_pkce.settings` at all, so disabling `plain_enabled`
   * (recipes/bakers/config/simple_oauth_pkce.settings.yml) narrows which method
   * the TOKEN endpoint actually accepts, but does not remove `plain` from
   * this advertisement. Only the presence of S256 is asserted here — that is
   * everything the actual contract requires.
   */
  public function testS256IsAnAdvertisedCodeChallengeMethod(): void {
    $metadata = $this->serverMetadata()->getServerMetadata();

    self::assertArrayHasKey('code_challenge_methods_supported', $metadata);
    self::assertContains('S256', $metadata['code_challenge_methods_supported']);
  }

  /**
   * The `bb:session` scope is advertised once its config installs.
   *
   * `ScopeDiscoveryService::getOauthScopes()` advertises each scope's `name`
   * (the wire value, `bb:session`), not the config entity id
   * (`bb_session`, what a consumer's `scopes` field references) — the two
   * are deliberately different, as BB-391 documents.
   */
  public function testBbSessionScopeIsAdvertisedOnceScopeConfigIsInstalled(): void {
    // Only the one scope entity this assertion needs, not the whole of
    // bb_core's config/install — that pulls in `og.og_role.*`, which has no
    // schema without the `og` module this kernel test does not otherwise
    // need.
    $this->container->get('entity_type.manager')->getStorage('oauth2_scope')->create([
      'id' => 'bb_session',
      'name' => 'bb:session',
      'description' => 'bakers.build session scope.',
      'umbrella' => TRUE,
      'grant_types' => [
        'authorization_code' => ['status' => TRUE],
      ],
    ])->save();
    $this->config('simple_oauth.settings')->set('scope_provider', 'dynamic')->save();

    $metadata = $this->serverMetadata()->getServerMetadata();

    self::assertArrayHasKey('scopes_supported', $metadata);
    self::assertContains('bb:session', $metadata['scopes_supported']);
  }

  /**
   * The required grant types are advertised among the supported ones.
   *
   * `authorization_code` and `refresh_token` — the two grants a registered
   * MCP client uses.
   */
  public function testRequiredGrantTypesAreAdvertised(): void {
    $metadata = $this->serverMetadata()->getServerMetadata();

    self::assertArrayHasKey('grant_types_supported', $metadata);
    foreach (['authorization_code', 'refresh_token'] as $grant) {
      self::assertContains($grant, $metadata['grant_types_supported']);
    }
  }

  /**
   * BB-688 AC-01: authorize/token resolve to the exact `/oauth/*` paths.
   *
   * Claude.ai must never have to guess `/authorize` (a Drupal 404) — this
   * pins the exact paths the discovery document hands it.
   */
  public function testAuthorizeAndTokenEndpointsAreTheExactOauthPaths(): void {
    $metadata = $this->serverMetadata()->getServerMetadata();

    self::assertStringEndsWith('/oauth/authorize', (string) $metadata['authorization_endpoint']);
    self::assertStringEndsWith('/oauth/token', (string) $metadata['token_endpoint']);
  }

  /**
   * MCP clients find the dynamic client registration endpoint.
   *
   * Any MCP client registers itself at `/oauth/register` (RFC 7591) instead of
   * an admin creating a consumer per client; login and PKCE still guard every
   * token.
   */
  public function testTheRegistrationEndpointIsAdvertised(): void {
    $metadata = $this->serverMetadata()->getServerMetadata();

    self::assertArrayHasKey('registration_endpoint', $metadata);
    self::assertStringEndsWith('/oauth/register', (string) $metadata['registration_endpoint']);
  }

  /**
   * RFC 9728 `resource` names `/mcp`, not the site root (BB-658 review F5).
   *
   * `ResourceMetadataService` names `resource` from the issuer (base URL) by
   * default; `McpResourceMetadataSubscriber` narrows it to the actual
   * protected resource and advertises `bb:session` as the required scope.
   */
  public function testProtectedResourceMetadataNamesTheMcpEndpoint(): void {
    $metadata = $this->resourceMetadata()->getResourceMetadata();

    self::assertArrayHasKey('resource', $metadata);
    self::assertStringEndsWith('/mcp', (string) $metadata['resource']);
    self::assertArrayHasKey('authorization_servers', $metadata);
    self::assertArrayHasKey('scopes_supported', $metadata);
    self::assertContains('bb:session', $metadata['scopes_supported']);
  }

  /**
   * The server metadata service, as a shorthand.
   */
  private function serverMetadata(): ServerMetadataService {
    return $this->container->get('simple_oauth_server_metadata.server_metadata');
  }

  /**
   * The resource metadata service, as a shorthand.
   */
  private function resourceMetadata(): ResourceMetadataService {
    return $this->container->get('simple_oauth_server_metadata.resource_metadata');
  }

}
