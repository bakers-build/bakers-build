<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_oauth_device\Kernel;

use Drupal\Component\Serialization\Json;
use Drupal\Component\Utility\Html;
use Drupal\Core\Form\FormState;
use Drupal\Core\Logger\RfcLogLevel;
use Drupal\KernelTests\Core\Entity\EntityKernelTestBase;
use Drupal\consumers\Entity\Consumer;
use Drupal\entity_test\Entity\EntityTestBundle;
use Drupal\entity_test\Entity\EntityTestWithBundle;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\bb_oauth_device\Form\DeviceVerificationForm;
use Drupal\simple_oauth\Entity\Oauth2Scope;
use Drupal\simple_oauth\Entity\Oauth2Token;
use Drupal\simple_oauth\Plugin\Field\FieldType\Oauth2ScopeReferenceItemListInterface;
use Drupal\user\Entity\User;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\HttpKernelInterface;

/**
 * Walks the whole RFC 8628 flow in-process, over the real routes and forms.
 *
 * A `BrowserTestBase` version of this test served real HTTP requests from a
 * second PHP process (php-fpm) that does not share this suite's `:memory:`
 * sqlite database with the PHPUnit process — every request past the first
 * would land on a site php-fpm sees as never installed, and Drupal answers
 * with its own installer instead of a route (BB-496 review finding 3).
 * `phpunit.xml`'s own `unit-kernel` testsuite comment states the same
 * architecture decision: no Functional (`BrowserTestBase`) test belongs in
 * this repository. This test exercises the identical endpoints and forms
 * through the in-process HTTP kernel and `FormBuilder`, the pattern
 * `simple_oauth`'s own `Kernel\AuthorizedRequestBase` already uses for the
 * token endpoint.
 */
#[Group('bb_oauth_device')]
#[RunTestsInSeparateProcesses]
class DeviceAuthorizationFlowTest extends EntityKernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'file',
    'image',
    'options',
    'serialization',
    'consumers',
    'simple_oauth',
    'bb_oauth_device',
  ];

  /**
   * The public consumer declaring the device grant.
   */
  protected Consumer $consumer;

  /**
   * The in-process HTTP kernel `simple_oauth`'s own Kernel tests use.
   */
  protected HttpKernelInterface $httpKernel;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();

    $this->installEntitySchema('user');
    $this->installEntitySchema('file');
    $this->installEntitySchema('consumer');
    $this->installEntitySchema('oauth2_token');
    $this->installConfig(['user', 'simple_oauth']);
    // The verification page renders bb_theme components.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();

    $this->httpKernel = $this->container->get('http_kernel');

    // simple_oauth needs a key pair before any grant can mint.
    $this->setUpKeys();

    // The URN-keyed grant_types block is otherwise a single point of failure
    // no test can see: ScopeRepository::finalizeScopes() only iterates a
    // consumer's own scopes, so a scope-less consumer (as this fixture was
    // before I-5) never reaches the code that reads the block at all.
    $scope = Oauth2Scope::create([
      'name' => 'test:device',
      'description' => 'Test device scope',
      'grant_types' => [
        'urn:ietf:params:oauth:grant-type:device_code' => [
          'status' => TRUE,
          'description' => 'Test device scope device_code',
        ],
        // ScopeRepository::finalizeScopes() re-checks the scope against the
        // running grant on every refresh, so a refresh needs its own block.
        'refresh_token' => [
          'status' => TRUE,
          'description' => 'Test device scope refresh_token',
        ],
      ],
      'umbrella' => FALSE,
    ]);
    $scope->save();

    $this->consumer = Consumer::create([
      'client_id' => 'device-functional',
      'label' => 'Device functional client',
      'confidential' => FALSE,
      'grant_types' => ['device_code'],
      'access_token_expiration' => 300,
      'scopes' => [$scope->id()],
    ]);
    $this->consumer->save();
  }

  /**
   * Requesting device authorization returns the RFC 8628 section 3.2 shape.
   */
  public function testDeviceAuthorizationResponseShape(): void {
    $body = $this->requestDeviceAuthorization();

    $this->assertIsString($body['device_code']);
    $this->assertNotSame('', $body['device_code']);
    $this->assertIsString($body['user_code']);
    $this->assertNotSame('', $body['user_code']);
    $this->assertIsString($body['verification_uri']);
    $this->assertStringEndsWith('/oauth/device', $body['verification_uri']);
    $this->assertIsInt($body['expires_in']);
    $this->assertIsInt($body['interval']);
    $this->assertIsString($body['verification_uri_complete']);
    $this->assertStringContainsString($body['user_code'], $body['verification_uri_complete']);
  }

  /**
   * Polling before confirmation is authorization_pending, then slow_down.
   */
  public function testPollingBeforeConfirmation(): void {
    $body = $this->requestDeviceAuthorization();

    $this->assertSame('authorization_pending', $this->pollError($body['device_code']));
    // The second poll arrives inside the retry interval.
    $this->assertSame('slow_down', $this->pollError($body['device_code']));
  }

  /**
   * Confirming on the verification route makes the next poll mint a token.
   */
  public function testConfirmationYieldsAccessToken(): void {
    $body = $this->requestDeviceAuthorization();

    $user = $this->drupalCreateUser(['grant simple_oauth codes']);
    $this->assertInstanceOf(User::class, $user);
    $this->setCurrentUser($user);
    $this->submitVerificationForm($body['user_code'], 'confirm');

    $token = $this->poll($body['device_code']);
    $this->assertSame('Bearer', $token['token_type']);
    $this->assertNotEmpty($token['access_token']);
    // The fixture consumer does not declare the refresh_token grant.
    $this->assertArrayNotHasKey('refresh_token', $token);

    // Pins the URN-keyed grant_types block: without it finalizeScopes() would
    // grant no scope, and the persisted access token would carry none (I-5).
    // simple_oauth's BearerTokenResponse never surfaces scope in the JSON
    // body (no override of league's empty getExtraParams()), so this reads
    // the persisted oauth2_token entity directly rather than the response.
    $storage = \Drupal::entityTypeManager()->getStorage('oauth2_token');
    $storage->resetCache();
    /** @var \Drupal\simple_oauth\Entity\Oauth2Token[] $tokens */
    $tokens = $storage->loadByProperties(['bundle' => 'access_token']);
    $this->assertNotEmpty($tokens);
    $issued = end($tokens);
    $this->assertInstanceOf(Oauth2Token::class, $issued);
    $scopes_field = $issued->get('scopes');
    $this->assertInstanceOf(Oauth2ScopeReferenceItemListInterface::class, $scopes_field);
    $scope_names = array_map(static fn ($scope) => $scope->getName(), $scopes_field->getScopes());
    $this->assertSame(['test:device'], $scope_names);
  }

  /**
   * A refresh-enabled consumer's own refresh lifetime bounds the new token.
   */
  public function testRefreshTokenFollowsConsumerLifetime(): void {
    $this->createDeviceConsumer('device-refresh', ['device_code', 'refresh_token'], 600);

    $before = time();
    $token = $this->signInWithDevice('device-refresh');
    $after = time();

    $this->assertNotEmpty($token['refresh_token']);
    $expire = $this->latestRefreshTokenExpiry();
    $this->assertGreaterThanOrEqual($before + 600, $expire);
    $this->assertLessThanOrEqual($after + 600, $expire);
  }

  /**
   * An empty consumer refresh lifetime falls back to two weeks.
   */
  public function testRefreshTokenLifetimeFallsBackWhenUnset(): void {
    $this->createDeviceConsumer('device-refresh-default', ['device_code', 'refresh_token'], NULL);

    $before = time();
    $token = $this->signInWithDevice('device-refresh-default');
    $after = time();

    $this->assertNotEmpty($token['refresh_token']);
    $expire = $this->latestRefreshTokenExpiry();
    $this->assertGreaterThanOrEqual($before + 1209600, $expire);
    $this->assertLessThanOrEqual($after + 1209600, $expire);
  }

  /**
   * A device-issued refresh token renews the session for the same user/scope.
   */
  public function testDeviceRefreshTokenRenewsSession(): void {
    $this->createDeviceConsumer('device-refresh', ['device_code', 'refresh_token'], 600);
    $token = $this->signInWithDevice('device-refresh');
    $user_id = $this->latestAccessToken()->get('auth_user_id')->target_id;

    $response = $this->httpKernel->handle(Request::create('/oauth/token', 'POST', [
      'grant_type' => 'refresh_token',
      'refresh_token' => $token['refresh_token'],
      'client_id' => 'device-refresh',
    ]));
    $this->assertSame(200, $response->getStatusCode(), (string) $response->getContent());
    $renewed = Json::decode((string) $response->getContent());

    $this->assertNotSame($token['access_token'], $renewed['access_token']);
    $this->assertNotSame($token['refresh_token'], $renewed['refresh_token']);
    $access = $this->latestAccessToken();
    $this->assertSame($user_id, $access->get('auth_user_id')->target_id);
    $scopes_field = $access->get('scopes');
    $this->assertInstanceOf(Oauth2ScopeReferenceItemListInterface::class, $scopes_field);
    $this->assertSame(['test:device'], array_map(static fn ($scope) => $scope->getName(), $scopes_field->getScopes()));

    // The consumed refresh token is rotated out.
    $replay = $this->httpKernel->handle(Request::create('/oauth/token', 'POST', [
      'grant_type' => 'refresh_token',
      'refresh_token' => $token['refresh_token'],
      'client_id' => 'device-refresh',
    ]));
    $this->assertSame('invalid_grant', Json::decode((string) $replay->getContent())['error'] ?? '');
  }

  /**
   * A refresh-less consumer's grant does not disable refresh for the next one.
   *
   * The refresh token repository is a shared service whose disablement is
   * one-way, and both sign-ins run in this one container.
   */
  public function testRefreshlessConsumerDoesNotDisableRefreshForOthers(): void {
    $this->createDeviceConsumer('device-refresh', ['device_code', 'refresh_token'], 600);

    $this->assertArrayNotHasKey('refresh_token', $this->signInWithDevice('device-functional'));
    $this->assertNotEmpty($this->signInWithDevice('device-refresh')['refresh_token'] ?? NULL);
  }

  /**
   * Denying on the verification route makes the next poll access_denied.
   */
  public function testDenialIsTerminal(): void {
    $body = $this->requestDeviceAuthorization();

    $user = $this->drupalCreateUser(['grant simple_oauth codes']);
    $this->assertInstanceOf(User::class, $user);
    $this->setCurrentUser($user);
    $this->submitVerificationForm($body['user_code'], 'deny');

    $this->assertSame('access_denied', $this->pollError($body['device_code']));
  }

  /**
   * Polling a lapsed code answers expired_token, the fifth AC-2 outcome (K-1).
   *
   * Backdates the stored `code:` row's own `expires` timestamp into the past
   * while it is still inside the repository's grace window, so the row is
   * still readable and league's own `time() > getExpiryDateTime()` check
   * (DeviceCodeGrant::validateDeviceCode()) is what fires — rather than the
   * key-value store deleting the row and league falling back to
   * invalid_grant, which is exactly the bug this replaces.
   */
  public function testPollingLapsedCodeYieldsExpiredToken(): void {
    $body = $this->requestDeviceAuthorization();

    /** @var \Drupal\Core\KeyValueStore\KeyValueStoreExpirableInterface $store */
    $store = \Drupal::service('keyvalue.expirable')->get('bb_oauth_device_code');
    $state = $store->get('code:' . $body['device_code']);
    $this->assertIsArray($state);
    $state['expires'] = time() - 5;
    $store->setWithExpire('code:' . $body['device_code'], $state, 30);

    $this->assertSame('expired_token', $this->pollError($body['device_code']));
  }

  /**
   * A confirmed code is final: a second submitter cannot re-bind it (R-1).
   */
  public function testConfirmedCodeCannotBeReDecided(): void {
    $body = $this->requestDeviceAuthorization();

    $first = $this->drupalCreateUser(['grant simple_oauth codes']);
    $this->assertInstanceOf(User::class, $first);
    $this->setCurrentUser($first);
    $this->submitVerificationForm($body['user_code'], 'confirm');

    $second = $this->drupalCreateUser(['grant simple_oauth codes']);
    $this->assertInstanceOf(User::class, $second);
    $this->setCurrentUser($second);
    $messages = $this->submitVerificationForm($body['user_code'], 'deny');
    $this->assertStringContainsString('That code is not valid.', (string) $messages);

    // The token still carries the first, confirming user's decision.
    $token = $this->poll($body['device_code']);
    $this->assertSame('Bearer', $token['token_type']);
  }

  /**
   * A denied code is terminal: it cannot later be confirmed (R-1).
   */
  public function testDeniedCodeCannotLaterBeConfirmed(): void {
    $body = $this->requestDeviceAuthorization();

    $denier = $this->drupalCreateUser(['grant simple_oauth codes']);
    $this->assertInstanceOf(User::class, $denier);
    $this->setCurrentUser($denier);
    $this->submitVerificationForm($body['user_code'], 'deny');

    $confirmer = $this->drupalCreateUser(['grant simple_oauth codes']);
    $this->assertInstanceOf(User::class, $confirmer);
    $this->setCurrentUser($confirmer);
    $messages = $this->submitVerificationForm($body['user_code'], 'confirm');
    $this->assertStringContainsString('That code is not valid.', (string) $messages);

    $this->assertSame('access_denied', $this->pollError($body['device_code']));
  }

  /**
   * The consent screen names the consumer before a decision is made (R-2).
   */
  public function testConsentScreenNamesTheConsumer(): void {
    $body = $this->requestDeviceAuthorization();

    $user = $this->drupalCreateUser(['grant simple_oauth codes']);
    $this->assertInstanceOf(User::class, $user);
    $this->setCurrentUser($user);
    $request = Request::create('/oauth/device', 'GET', ['user_code' => $body['user_code']]);
    $response = $this->httpKernel->handle($request);
    $content = (string) $response->getContent();
    $this->assertStringContainsString('Device functional client', $content);
    $this->assertStringContainsString('test:device', $content);
  }

  /**
   * A sent link fills in its code for comparison and names the account.
   */
  public function testLinkedCodeIsFilledInAndNamesTheAccount(): void {
    $body = $this->requestDeviceAuthorization();

    $user = $this->drupalCreateUser(['grant simple_oauth codes']);
    $this->assertInstanceOf(User::class, $user);
    $this->setCurrentUser($user);
    $request = Request::create('/oauth/device', 'GET', ['user_code' => $body['user_code']]);
    $content = (string) $this->httpKernel->handle($request)->getContent();
    $this->assertStringContainsString('Device functional client', $content);
    $this->assertStringContainsString(' as ' . $user->getDisplayName() . '.', $content);

    $fields = (new \DOMXPath(Html::load($content)))->query('//input[@name="user_code"]');
    $this->assertInstanceOf(\DOMNodeList::class, $fields);
    $field = $fields->item(0);
    $this->assertInstanceOf(\DOMElement::class, $field);
    $this->assertSame('text', $field->getAttribute('type'));
    $this->assertSame($body['user_code'], $field->getAttribute('value'));
    $this->assertStringContainsString('Compare with the code in your terminal.', $content);

    $messages = $this->submitVerificationForm('', 'confirm', $body['user_code']);
    $this->assertStringContainsString('Device code field is required.', $messages);
    $this->assertSame('authorization_pending', $this->pollError($body['device_code']));
  }

  /**
   * Memberships are grouped by workspace, typed and listed once each.
   *
   * The account leads two workspaces and a team in one of them, is a plain
   * member of a team in the other, and of a team whose workspace it holds no
   * membership in: that workspace still heads its team, without a rank.
   */
  public function testConsentGroupsMembershipsByWorkspace(): void {
    $this->installGroupFixture();
    $bakers = $this->createGroup('workspace', 'bakers');
    $keytec = $this->createGroup('workspace', 'keytec');
    $solo = $this->createGroup('workspace', 'solo');
    $bakers_team = $this->createGroup('team', 'bakers', $bakers);
    $north = $this->createGroup('team', 'North', $keytec);
    $orphan = $this->createGroup('team', 'Orphan', $solo);
    $this->createGroup('team', 'Elsewhere', $keytec);

    $user = $this->createConsentingUser();
    $admin = OgRole::loadByGroupAndName($bakers, 'lead');
    $lead = OgRole::loadByGroupAndName($bakers_team, 'lead');
    $this->assertInstanceOf(OgRole::class, $admin);
    $this->assertInstanceOf(OgRole::class, $lead);
    Og::createMembership($bakers, $user)->addRole($admin)->save();
    Og::createMembership($keytec, $user)->addRole($admin)->save();
    Og::createMembership($bakers_team, $user)->addRole($lead)->save();
    Og::createMembership($north, $user)->save();
    Og::createMembership($orphan, $user)->save();

    $content = $this->consentPage();
    $lines = array_values(array_filter($this->linesOf($content), static fn (string $line): bool => preg_match('/^(Workspace|Team) /', $line) === 1));
    $this->assertSame([
      'Workspace bakers — Admin',
      'Team bakers — Lead',
      'Workspace keytec — Admin',
      'Team North — Member',
      'Workspace solo',
      'Team Orphan — Member',
    ], $lines, 'Each group once, teams below their workspace, workspaces sorted.');
    $text = $this->textOf($content);
    $this->assertStringNotContainsString('Elsewhere', $text);
    $this->assertStringNotContainsString('Lead, Lead', $text);
    $this->assertStringNotContainsString('Acts within your memberships', $text);
  }

  /**
   * Group names show as typed, escaped once; a lost workspace leaves a team.
   *
   * A team whose workspace was deleted stays a team, at the top level.
   */
  public function testConsentShowsGroupNamesAsTyped(): void {
    $this->installGroupFixture();
    $workspace = $this->createGroup('workspace', 'R&D\'s <lab>');
    $gone = $this->createGroup('workspace', 'Gone');
    $team = $this->createGroup('team', 'Left "behind"', $gone);
    $user = $this->createConsentingUser();
    Og::createMembership($workspace, $user)->save();
    Og::createMembership($team, $user)->save();
    $gone->delete();

    $lines = $this->linesOf($this->consentPage());
    $this->assertContains('Workspace R&D\'s <lab> — Member', $lines);
    $this->assertContains('Team Left "behind" — Member', $lines);
    $this->assertNotContains('Workspace Left "behind" — Member', $lines);
    $this->assertEmpty(preg_grep('/&(amp|quot|lt|#0?39);/', $lines), 'No entity shows as text.');
  }

  /**
   * The consent says who signs in where and what confirming grants.
   */
  public function testConsentExplainsAccessPlainly(): void {
    $this->installGroupFixture();
    $workspace = $this->createGroup('workspace', 'keytec');
    $this->config('system.site')->set('name', 'bakers.build')->save();
    $user = $this->createConsentingUser();
    Og::createMembership($workspace, $user)->save();

    $content = $this->consentPage();
    $text = $this->textOf($content);
    $this->assertStringContainsString('Device functional client wants to sign in to bakers.build (localhost) as ' . $user->getDisplayName() . '.', $text);
    $this->assertStringContainsString('If you confirm, the device can do everything you can do on bakers.build, in the workspaces and teams below, with your roles there.', $text);
    $this->assertStringNotContainsString('Requested access:', $text);

    $xpath = new \DOMXPath(Html::load($content));
    $details = $xpath->query('//details[not(@open)][contains(., "Technical details")][contains(., "test:device")]');
    $this->assertInstanceOf(\DOMNodeList::class, $details);
    $this->assertSame(1, $details->length, 'The scopes sit in one collapsed element.');
    $this->assertSame(1, substr_count($text, 'test:device'), 'No scope appears outside it.');

    $links = $xpath->query('//a[@href="https://bakers.build/docs/provision/security/access-and-data#roles-and-permissions"][contains(., "What do these roles mean?")]');
    $this->assertInstanceOf(\DOMNodeList::class, $links);
    $this->assertSame(1, $links->length);
  }

  /**
   * The consent says a confirmed device cannot be signed out by its owner yet.
   */
  public function testConsentStatesRevokeGap(): void {
    $this->createConsentingUser();
    $this->assertStringContainsString("You can't sign this device out yourself yet. Ask a site administrator to revoke it.", $this->consentText());
  }

  /**
   * Without any membership the consent says the device reaches no workspace.
   */
  public function testConsentWithoutMemberships(): void {
    $this->installGroupFixture();
    $this->createGroup('workspace', 'keytec');
    $this->createConsentingUser();

    $text = $this->consentText();
    $this->assertStringContainsString("You aren't in any workspace yet, so the device can't reach any workspace content.", $text);
    $this->assertStringNotContainsString('Workspace keytec', $text);
    $this->assertStringNotContainsString('What do these roles mean?', $text);
  }

  /**
   * The denial says the device got nothing.
   *
   * The confirmed screen links to bb_core's home route, which this module's
   * kernel tests do not install; gate-presentation.feature covers its copy.
   */
  public function testDenialResultExplainsOutcome(): void {
    $this->createConsentingUser();

    $denied = $this->textOf((string) $this->httpKernel->handle(Request::create('/oauth/device', 'GET', ['done' => 'denied']))->getContent());
    $this->assertStringContainsString('Sign-in denied', $denied);
    $this->assertStringContainsString('The device was not signed in and got no access. You can close this page.', $denied);
  }

  /**
   * A page that described one device cannot confirm another one.
   */
  public function testTypedCodeMustMatchTheDescribedOne(): void {
    $shown = $this->requestDeviceAuthorization();
    $other = $this->requestDeviceAuthorization();

    $user = $this->drupalCreateUser(['grant simple_oauth codes']);
    $this->assertInstanceOf(User::class, $user);
    $this->setCurrentUser($user);
    $messages = $this->submitVerificationForm($other['user_code'], 'confirm', $shown['user_code']);
    $this->assertStringContainsString('That code is not valid.', $messages);
    $this->assertSame('authorization_pending', $this->pollError($other['device_code']));
    $this->assertSame('authorization_pending', $this->pollError($shown['device_code']));

    // Typed the way a human retypes it, the described code still confirms.
    $this->submitVerificationForm(strtolower(substr($shown['user_code'], 0, 4) . ' ' . substr($shown['user_code'], 4)), 'confirm', $shown['user_code']);
    $this->assertSame('Bearer', $this->poll($shown['device_code'])['token_type']);
  }

  /**
   * The verification route is closed to an account without the permission.
   */
  public function testVerificationRouteIsPermissionGated(): void {
    // Uid 1 is Drupal's superuser and bypasses every permission check
    // (User::hasPermission()) — createUser() here would otherwise mint the
    // route's own "unprivileged" test account as uid 1, since no earlier
    // user entity in this test class has consumed it.
    $this->drupalCreateUser([]);
    $unprivileged = $this->drupalCreateUser([]);
    $this->assertInstanceOf(User::class, $unprivileged);
    $this->setCurrentUser($unprivileged);
    $response = $this->httpKernel->handle(Request::create('/oauth/device'));
    $this->assertSame(403, $response->getStatusCode());
  }

  /**
   * A named scope the consumer does not itself hold is rejected (J-1).
   */
  public function testRequestingUnauthorizedScopeIsRejected(): void {
    $foreign_scope = Oauth2Scope::create([
      'name' => 'test:foreign',
      'description' => 'Scope the fixture consumer does not hold',
      'grant_types' => [
        'urn:ietf:params:oauth:grant-type:device_code' => [
          'status' => TRUE,
          'description' => 'Foreign device scope',
        ],
      ],
      'umbrella' => FALSE,
    ]);
    $foreign_scope->save();

    $response = $this->httpKernel->handle(Request::create('/oauth/device_authorization', 'POST', [
      'client_id' => 'device-functional',
      'scope' => 'test:foreign',
    ]));

    $this->assertSame(400, $response->getStatusCode());
    $body = Json::decode((string) $response->getContent());
    $this->assertSame('invalid_scope', $body['error']);
  }

  /**
   * A named scope the consumer does hold is honoured, not rejected (J-1).
   */
  public function testRequestingOwnedScopeSucceeds(): void {
    $body = $this->requestDeviceAuthorization(['scope' => 'test:device']);
    $this->assertIsString($body['device_code']);
    $this->assertNotSame('', $body['device_code']);
  }

  /**
   * The anonymous endpoint's flood bucket is per-caller and retryable.
   */
  public function testAnonymousEndpointFloodIsPerCallerAndRetryable(): void {
    $limit = 60;
    for ($i = 0; $i < $limit; $i++) {
      $response = $this->httpKernel->handle($this->deviceAuthorizationRequestFrom('203.0.113.10'));
      $this->assertSame(200, $response->getStatusCode());
    }

    // The identity that exhausted the bucket is now throttled ….
    $throttled = $this->httpKernel->handle($this->deviceAuthorizationRequestFrom('203.0.113.10'));
    $this->assertSame(429, $throttled->getStatusCode());
    $throttled_body = Json::decode((string) $throttled->getContent());
    // invalid_request, not slow_down (K-2): slow_down is an RFC 8628 §3.5
    // token-endpoint code for a caller that already holds a device code and
    // an interval to lengthen, which this anonymous caller does not have.
    $this->assertSame('invalid_request', $throttled_body['error']);
    $this->assertTrue($throttled->headers->has('Retry-After'), 'A 429 names its own retry window.');

    // … but a second identity behind the same client_id still receives a
    // fresh device code (J-2: no single site-wide bucket).
    $unaffected = $this->httpKernel->handle($this->deviceAuthorizationRequestFrom('203.0.113.99'));
    $this->assertSame(200, $unaffected->getStatusCode());
  }

  /**
   * Looping past the verification form's limit refuses further attempts (J-4).
   */
  public function testVerificationFormFloodRefusesFurtherAttempts(): void {
    $this->enableModules(['dblog']);
    $this->installSchema('dblog', ['watchdog']);
    $account = $this->drupalCreateUser(['grant simple_oauth codes']);
    $this->assertInstanceOf(User::class, $account);
    $this->setCurrentUser($account);

    for ($i = 0; $i < 10; $i++) {
      $this->submitVerificationForm('WRONG-CODE', 'deny');
    }

    $logged = fn (): array => $this->container->get('database')->select('watchdog', 'w')
      ->fields('w', ['message', 'severity'])
      ->condition('type', 'bb_oauth_device')
      ->orderBy('wid')
      ->execute()->fetchAll();
    $before = count($logged());
    $messages = $this->submitVerificationForm('WRONG-CODE', 'deny');
    $this->assertStringContainsString('Too many attempts.', (string) $messages);
    // Each refused attempt leaves one notice in the site log.
    $rows = $logged();
    $this->assertCount($before + 1, $rows);
    $this->assertSame('Device code attempts blocked for account %uid.', end($rows)->message);
    $this->assertSame(RfcLogLevel::NOTICE, (int) end($rows)->severity);

    // A different, unaffected account can still attempt a lookup.
    $body = $this->requestDeviceAuthorization();
    $other = $this->drupalCreateUser(['grant simple_oauth codes']);
    $this->assertInstanceOf(User::class, $other);
    $this->setCurrentUser($other);
    $request = Request::create('/oauth/device', 'GET', ['user_code' => $body['user_code']]);
    $response = $this->httpKernel->handle($request);
    $this->assertStringNotContainsString('Too many attempts.', (string) $response->getContent());
  }

  /**
   * Registers workspace and team bundles as OG groups, as bb_core ships them.
   *
   * A team references its workspace through `workspace_id`; each group type
   * has a `lead` rank, labelled the way the shipped config labels it.
   */
  protected function installGroupFixture(): void {
    $this->enableModules(['og']);
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('entity_test_with_bundle');
    $this->installConfig(['og']);
    // enableModules() rebuilt the container; the kernel from setUp() is stale.
    $this->httpKernel = $this->container->get('http_kernel');
    foreach (['workspace' => 'Admin', 'team' => 'Lead'] as $bundle => $lead) {
      EntityTestBundle::create(['id' => $bundle, 'label' => ucfirst($bundle)])->save();
      Og::addGroup('entity_test_with_bundle', $bundle);
      OgRole::create(['name' => 'lead', 'label' => $lead])
        ->setGroupType('entity_test_with_bundle')
        ->setGroupBundle($bundle)
        ->save();
    }
    FieldStorageConfig::create([
      'field_name' => 'workspace_id',
      'entity_type' => 'entity_test_with_bundle',
      'type' => 'entity_reference',
      'settings' => ['target_type' => 'entity_test_with_bundle'],
    ])->save();
    FieldConfig::create([
      'field_name' => 'workspace_id',
      'entity_type' => 'entity_test_with_bundle',
      'bundle' => 'team',
    ])->save();
  }

  /**
   * Creates a workspace, or a team in the given workspace.
   */
  protected function createGroup(string $bundle, string $name, ?EntityTestWithBundle $workspace = NULL): EntityTestWithBundle {
    $group = EntityTestWithBundle::create(['type' => $bundle, 'name' => $name] + ($workspace ? ['workspace_id' => $workspace->id()] : []));
    $group->save();
    return $group;
  }

  /**
   * Signs in an account that may confirm devices, never uid 1.
   */
  protected function createConsentingUser(): User {
    // Uid 1 bypasses every check; the consenting account must not be it.
    $this->drupalCreateUser([]);
    $user = $this->drupalCreateUser(['grant simple_oauth codes']);
    $this->assertInstanceOf(User::class, $user);
    $this->setCurrentUser($user);
    return $user;
  }

  /**
   * Opens the consent for a fresh device code and returns the page HTML.
   */
  protected function consentPage(): string {
    $body = $this->requestDeviceAuthorization();
    $request = Request::create('/oauth/device', 'GET', ['user_code' => $body['user_code']]);
    return (string) $this->httpKernel->handle($request)->getContent();
  }

  /**
   * The consent page's visible text, entities decoded.
   */
  protected function consentText(): string {
    return $this->textOf($this->consentPage());
  }

  /**
   * A page's text with HTML entities decoded, tags kept for line context.
   */
  protected function textOf(string $html): string {
    return html_entity_decode($html, ENT_QUOTES | ENT_HTML5);
  }

  /**
   * A page's paragraphs as the reader sees them, trimmed, in document order.
   *
   * @return string[]
   *   One entry per `p` element's text content.
   */
  protected function linesOf(string $html): array {
    $paragraphs = (new \DOMXPath(Html::load($html)))->query('//p');
    $this->assertInstanceOf(\DOMNodeList::class, $paragraphs);
    $lines = [];
    foreach ($paragraphs as $paragraph) {
      $lines[] = trim($paragraph->nodeValue ?? '');
    }
    return $lines;
  }

  /**
   * Posts a device authorization request the way the CLI does.
   */
  protected function requestDeviceAuthorization(array $extra_params = []): array {
    $extra_params += ['client_id' => 'device-functional'];
    $response = $this->httpKernel->handle(Request::create('/oauth/device_authorization', 'POST', $extra_params));
    $this->assertSame(200, $response->getStatusCode(), (string) $response->getContent());

    return Json::decode((string) $response->getContent());
  }

  /**
   * Builds a POST request to `/oauth/device_authorization` from a given IP.
   */
  protected function deviceAuthorizationRequestFrom(string $ip): Request {
    return Request::create(
      '/oauth/device_authorization',
      'POST',
      ['client_id' => 'device-functional'],
      [],
      [],
      ['REMOTE_ADDR' => $ip],
    );
  }

  /**
   * Polls the token endpoint and returns the decoded success body.
   */
  protected function poll(string $deviceCode, string $clientId = 'device-functional'): array {
    $response = $this->httpKernel->handle(Request::create('/oauth/token', 'POST', [
      'grant_type' => 'urn:ietf:params:oauth:grant-type:device_code',
      'device_code' => $deviceCode,
      'client_id' => $clientId,
    ]));
    $this->assertSame(200, $response->getStatusCode(), (string) $response->getContent());

    return Json::decode((string) $response->getContent());
  }

  /**
   * Creates a public consumer holding the device scope.
   */
  protected function createDeviceConsumer(string $clientId, array $grantTypes, ?int $refreshTokenExpiration): void {
    Consumer::create([
      'client_id' => $clientId,
      'label' => $clientId,
      'confidential' => FALSE,
      'grant_types' => $grantTypes,
      'access_token_expiration' => 300,
      'refresh_token_expiration' => $refreshTokenExpiration,
      'scopes' => $this->consumer->get('scopes')->getValue(),
    ])->save();
  }

  /**
   * Runs a confirmed device sign-in and returns the token response.
   */
  protected function signInWithDevice(string $clientId): array {
    $body = $this->requestDeviceAuthorization(['client_id' => $clientId]);
    $user = $this->drupalCreateUser(['grant simple_oauth codes']);
    $this->assertInstanceOf(User::class, $user);
    $this->setCurrentUser($user);
    $this->submitVerificationForm($body['user_code'], 'confirm');

    return $this->poll($body['device_code'], $clientId);
  }

  /**
   * Loads the most recently issued token of a bundle.
   */
  protected function latestToken(string $bundle): Oauth2Token {
    $storage = \Drupal::entityTypeManager()->getStorage('oauth2_token');
    $storage->resetCache();
    $tokens = $storage->loadByProperties(['bundle' => $bundle]);
    $this->assertNotEmpty($tokens);
    ksort($tokens);
    $token = end($tokens);
    $this->assertInstanceOf(Oauth2Token::class, $token);

    return $token;
  }

  /**
   * Loads the most recently issued access token.
   */
  protected function latestAccessToken(): Oauth2Token {
    return $this->latestToken('access_token');
  }

  /**
   * Returns the expiry timestamp of the most recently issued refresh token.
   */
  protected function latestRefreshTokenExpiry(): int {
    return (int) $this->latestToken('refresh_token')->get('expire')->value;
  }

  /**
   * Polls the token endpoint and returns the OAuth error code it answered.
   */
  protected function pollError(string $deviceCode): string {
    $response = $this->httpKernel->handle(Request::create('/oauth/token', 'POST', [
      'grant_type' => 'urn:ietf:params:oauth:grant-type:device_code',
      'device_code' => $deviceCode,
      'client_id' => 'device-functional',
    ]));

    return Json::decode((string) $response->getContent())['error'] ?? '';
  }

  /**
   * Submits `DeviceVerificationForm` the way a browser posting it would.
   *
   * Pushes a request carrying the query string `buildForm()` reads its
   * prefill from, then drives `FormBuilder` directly instead of scraping
   * `form_build_id`/`form_token` out of rendered HTML — the module logic
   * under test is validate/submit, not Drupal core's own form-cache
   * machinery. Returns the rendered status messages, so a caller can assert
   * on a validation error.
   *
   * @param string $userCode
   *   The device user code the human typed.
   * @param string $decision
   *   Either 'confirm' or 'deny', the name of the button to trigger.
   * @param string|null $linkCode
   *   The code the opened link carries, when it differs from the typed one.
   */
  protected function submitVerificationForm(string $userCode, string $decision, ?string $linkCode = NULL): string {
    $request = Request::create('/oauth/device', 'GET', ['user_code' => $linkCode ?? $userCode]);
    $this->container->get('request_stack')->push($request);
    try {
      // FormBuilder::submitForm() immediately overwrites user input with
      // getValues() (`$form_state->setUserInput($form_state->getValues())`),
      // so the raw submission has to go through setValues(), not
      // setUserInput() — anything set the other way is discarded before
      // doBuildForm() ever runs. `_triggering_element_name` is FormBuilder's
      // own scripted-submission key (elementTriggeredScriptedSubmission());
      // form_id/form_token must ride along too, an authenticated form
      // carries #token and doBuildForm() wipes all input when it's missing.
      $form_id = 'bb_oauth_device_verify';
      $form_state = (new FormState())->setValues([
        'user_code' => $userCode,
        '_triggering_element_name' => $decision,
        'form_id' => $form_id,
        'form_token' => $this->container->get('csrf_token')->get($form_id),
      ]);
      $this->container->get('form_builder')->submitForm(DeviceVerificationForm::class, $form_state);
      $messages = $this->container->get('messenger')->all();
      $this->container->get('messenger')->deleteAll();

      return implode(' ', array_map('strval', array_merge(...array_values($messages ?: [[]]))));
    }
    finally {
      $this->container->get('request_stack')->pop();
    }
  }

  /**
   * Generates and configures the OAuth key pair.
   */
  protected function setUpKeys(): void {
    // openssl_pkey_export_to_file() cannot write through a stream wrapper
    // (a PHP limitation, not a Drupal one), and KernelTestBase's
    // `$this->siteDirectory` is a vfsStream URI — export to a PEM string
    // with openssl_pkey_export() instead and write that with
    // file_put_contents(), which vfsStream does support.
    $path = $this->siteDirectory . '/oauth';
    mkdir($path, 0775, TRUE);
    $private = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    if ($private === FALSE || !openssl_pkey_export($private, $private_pem)) {
      throw new \RuntimeException('Could not generate an OAuth test key pair.');
    }
    file_put_contents($path . '/private.key', $private_pem);
    $details = openssl_pkey_get_details($private);
    if ($details === FALSE) {
      throw new \RuntimeException('Could not read the OAuth test key pair.');
    }
    file_put_contents($path . '/public.key', $details['key']);
    chmod($path . '/private.key', 0600);
    chmod($path . '/public.key', 0600);

    $this->config('simple_oauth.settings')
      ->set('private_key', $path . '/private.key')
      ->set('public_key', $path . '/public.key')
      ->save();
  }

}
