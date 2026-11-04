<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_api_key\Kernel;

use Drupal\Component\Datetime\Time;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Session\AccountInterface;
use Drupal\Tests\bb_core\Kernel\Tool\BakersToolTestBase;
use Drupal\Tests\bb_core\Kernel\Tool\ForeignWorkspaceTrait;
use Drupal\Tests\simple_oauth\Functional\SimpleOauthTestTrait;
use Drupal\bb_api_key\ApiKeyManager;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\simple_oauth\Authentication\TokenAuthUserInterface;
use Drupal\simple_oauth\Exception\OAuthUnauthorizedHttpException;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * An API key sent as the bearer on `/mcp` acts as its owner, nothing more.
 */
#[Group('bb_core')]
#[Group('bb_api_key')]
#[RunTestsInSeparateProcesses]
final class ApiKeyBearerTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;
  use SimpleOauthTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'filter', 'bb_core', 'tool',
    'serialization', 'views', 'consumers', 'simple_oauth', 'bb_api_key',
  ];

  /**
   * {@inheritdoc}
   */
  public function register(ContainerBuilder $container): void {
    parent::register($container);
    $container->getDefinition('datetime.time')->setClass(ShiftableTime::class);
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    ShiftableTime::$offset = 0;
    parent::setUp();
    $this->installEntitySchema('consumer');
    $this->installEntitySchema('oauth2_token');
    $this->installConfig(['simple_oauth', 'bb_api_key']);
    $this->container->get('entity_type.manager')->getStorage('oauth2_scope')->create([
      'id' => 'bb_session',
      'name' => 'bb:session',
      'grant_types' => ['client_credentials' => ['status' => TRUE]],
      'umbrella' => TRUE,
    ])->save();
    // Real signing keys, so the inner provider judges a bearer as it does in
    // production instead of failing on missing configuration.
    mkdir($this->siteDirectory . '/keys', 0775, TRUE);
    foreach (['public_key' => $this->publicKey, 'private_key' => $this->privateKey] as $setting => $pem) {
      $path = $this->siteDirectory . '/keys/' . $setting . '.key';
      file_put_contents($path, $pem);
      chmod($path, 0660);
      $this->config('simple_oauth.settings')->set($setting, $path)->save();
    }
  }

  /**
   * Issues a managed key for the account, valid for a day.
   *
   * @return array{0: string, 1: \Drupal\consumers\Entity\ConsumerInterface}
   *   The bearer value `<client_id>:<secret>` and the key's consumer.
   */
  private function issueKey(UserInterface $owner): array {
    $manager = $this->container->get(ApiKeyManager::class);
    $currentUser = $this->container->get('current_user');
    $acting = $currentUser->getAccount();
    // Keys are self-service: the owner reference only validates as the owner.
    $currentUser->setAccount($owner);
    $issued = $manager->create($owner, 'Bot', $this->container->get('datetime.time')->getCurrentTime() + 86400);
    $currentUser->setAccount($acting);
    return [$issued['consumer']->get('client_id')->value . ':' . $issued['secret'], $issued['consumer']];
  }

  /**
   * Authenticates a request with this bearer through the real provider chain.
   */
  private function authenticate(string $bearer, string $path = '/mcp'): ?AccountInterface {
    return $this->container->get('authentication')->authenticate($this->request($bearer, $path));
  }

  /**
   * A new request carrying this bearer.
   */
  private function request(string $bearer, string $path): Request {
    // Each request is new: nothing loaded by an earlier one survives.
    $this->container->get('entity.memory_cache')->deleteAll();
    $request = Request::create($path, 'POST');
    $request->headers->set('Authorization', 'Bearer ' . $bearer);
    return $request;
  }

  /**
   * Asserts that this bearer is refused with a 401, `invalid_token` on `/mcp`.
   */
  private function assertRefused(string $bearer, string $path = '/mcp'): void {
    try {
      $account = $this->authenticate($bearer, $path);
      self::fail(sprintf('expected a 401, authenticated as %s', $account?->id() ?? 'anonymous'));
    }
    catch (OAuthUnauthorizedHttpException $exception) {
      self::assertSame(401, $exception->getStatusCode());
      if ($path === '/mcp') {
        self::assertStringContainsString('invalid_token', $exception->getHeaders()['WWW-Authenticate'] ?? '');
      }
      // The kernel's exception listeners, simple_oauth's logger among them,
      // must turn it into the 401 response, not fail on it.
      $event = new ExceptionEvent(
        $this->container->get('http_kernel'),
        $this->request($bearer, $path),
        HttpKernelInterface::MAIN_REQUEST,
        $exception,
      );
      $this->container->get('event_dispatcher')->dispatch($event, KernelEvents::EXCEPTION);
      self::assertSame(401, $event->getResponse()?->getStatusCode());
    }
  }

  /**
   * Reads a ticket through its tool as the given account.
   */
  private function readsTicket(AccountInterface $account, string $ticket): bool {
    $this->container->get('current_user')->setAccount($account);
    return $this->runTool('bakers_ticket_read', ['ticket' => $ticket])->isSuccess();
  }

  /**
   * A user's key and a service account's key each act as their owner.
   */
  public function testKeyBearerAuthenticatesAsOwner(): void {
    $ticket = $this->ticket('Owned');
    [$bearer] = $this->issueKey($this->actor);
    $account = $this->authenticate($bearer);
    self::assertInstanceOf(AccountInterface::class, $account);
    self::assertNotInstanceOf(TokenAuthUserInterface::class, $account);
    self::assertSame((int) $this->actor->id(), (int) $account->id());
    self::assertTrue($this->readsTicket($account, $ticket->uuid()));

    $this->container->get('current_user')->setAccount($this->actor);
    $lead = $this->account('lead');
    $this->addMembership($this->workspace, $lead, ['lead']);
    $team = $this->project->get('teams')->entity;
    self::assertInstanceOf(BbTeamInterface::class, $team);
    self::assertInstanceOf(BbWorkspaceInterface::class, $this->workspace);
    $team->set('workspace_id', $this->workspace->id())->save();
    $this->container->get('current_user')->setAccount($lead);
    $created = $this->container->get(ServiceAccountManager::class)->create(
      $this->workspace, $team, 'poller-bot', 'contributor', 'member', date('Y-m-d', time() + 10 * 86400), $lead,
    );
    $service = $this->authenticate($created['consumer']->get('client_id')->value . ':' . $created['secret']);
    self::assertInstanceOf(AccountInterface::class, $service);
    self::assertSame((int) $created['user']->id(), (int) $service->id());
    self::assertTrue($this->readsTicket($service, $ticket->uuid()));
  }

  /**
   * The key sees what its owner sees now, including a later membership.
   */
  public function testKeyBearerFollowsOwnerMembership(): void {
    [$workspace, $stranger] = $this->foreignWorkspace();
    $group = $this->entity('bb_group', ['name' => 'foreign-group', 'workspace_id' => $workspace->id()]);
    $team = $this->entity('bb_team', ['name' => 'foreign-team', 'workspace_id' => $workspace->id()]);
    $foreign = $this->entity('bb_project', [
      'name' => 'foreign-project',
      'group_id' => $group->id(),
      'teams' => [$team->id()],
    ]);
    $theirs = $this->ticket('Theirs', ['project_id' => $foreign->id()]);
    $this->container->get('current_user')->setAccount($this->actor);
    $ours = $this->ticket('Ours');
    [$bearer] = $this->issueKey($this->actor);

    $account = $this->authenticate($bearer);
    self::assertInstanceOf(AccountInterface::class, $account);
    self::assertTrue($this->readsTicket($account, $ours->uuid()));
    self::assertFalse($this->readsTicket($account, $theirs->uuid()));

    $this->container->get('current_user')->setAccount($stranger);
    $this->addMembership($workspace, $this->actor, ['contributor']);
    $this->addMembership($team, $this->actor);
    $account = $this->authenticate($bearer);
    self::assertInstanceOf(AccountInterface::class, $account);
    self::assertTrue($this->readsTicket($account, $theirs->uuid()));
  }

  /**
   * A revoked or disabled key, or one whose owner is blocked, gets a 401.
   */
  public function testRevokedDisabledOrBlockedKeyIsRefused(): void {
    [$revoked, $revokedKey] = $this->issueKey($this->actor);
    $this->container->get(ApiKeyManager::class)->revoke($revokedKey, $this->actor);
    $this->assertRefused($revoked);

    [$disabled, $disabledKey] = $this->issueKey($this->actor);
    $disabledKey->set('status', FALSE)->save();
    $this->assertRefused($disabled);

    $owner = $this->account('to-block');
    [$blocked] = $this->issueKey($owner);
    self::assertInstanceOf(AccountInterface::class, $this->authenticate($blocked));
    $owner->block()->save();
    $this->assertRefused($blocked);
  }

  /**
   * The key outlives an access token's lifetime but not its own expiry.
   */
  public function testKeyBearerOutlivesTokenLifetimeUntilKeyExpiry(): void {
    [$bearer, $key] = $this->issueKey($this->actor);
    ShiftableTime::$offset = ApiKeyManager::ACCESS_TOKEN_EXPIRATION + 1;
    self::assertSame((int) $this->actor->id(), (int) $this->authenticate($bearer)?->id());

    ShiftableTime::$offset = (int) $key->get('bb_expires')->value - time() + 1;
    $this->assertRefused($bearer);
  }

  /**
   * Malformed or unknown key bearers are refused, never served anonymously.
   */
  #[DataProvider('malformedBearers')]
  public function testMalformedOrUnknownBearerIsRefused(string $shape): void {
    [$bearer] = $this->issueKey($this->actor);
    [$clientId] = explode(':', $bearer, 2);
    $candidates = [
      'wrong secret' => $clientId . ':not-the-secret',
      'empty secret' => $clientId . ':',
      'unknown key' => ApiKeyManager::CLIENT_ID_PREFIX . 'nobody:secret',
      'prefix only' => ApiKeyManager::CLIENT_ID_PREFIX . 'x:',
    ];
    $this->assertRefused($candidates[$shape]);
  }

  /**
   * The malformed bearer shapes.
   *
   * @return array<string, array{string}>
   *   Data sets keyed by shape.
   */
  public static function malformedBearers(): array {
    return [
      'wrong secret' => ['wrong secret'],
      'empty secret' => ['empty secret'],
      'unknown key' => ['unknown key'],
      'prefix only' => ['prefix only'],
    ];
  }

  /**
   * A valid key is a bearer on `/mcp` only.
   */
  public function testKeyBearerElsewhereIsRefused(): void {
    [$bearer] = $this->issueKey($this->actor);
    $this->assertRefused($bearer, '/jsonapi');
  }

}

/**
 * A clock that runs a settable number of seconds ahead.
 */
final class ShiftableTime extends Time {

  /**
   * Seconds added to every reading.
   */
  public static int $offset = 0;

  /**
   * {@inheritdoc}
   */
  public function getRequestTime(): int {
    return parent::getRequestTime() + self::$offset;
  }

  /**
   * {@inheritdoc}
   */
  public function getCurrentTime(): int {
    return parent::getCurrentTime() + self::$offset;
  }

}
