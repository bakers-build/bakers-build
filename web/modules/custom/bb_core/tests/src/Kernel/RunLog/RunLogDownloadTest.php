<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\RunLog;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\Tests\bb_core\Kernel\WorkspaceFixtureTrait;
use Drupal\Core\File\FileSystemInterface;
use Drupal\file\FileInterface;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The retrieval route is the only door onto a run's stored log (BB-556).
 *
 * Converted from a Functional (`BrowserTestBase`) class by BB-556 review
 * finding C2: `.gitlab-ci.yml`'s `phpunit` job runs only
 * `--testsuite unit-kernel`, and `e2e` runs Playwright BDD plus
 * `bakers-test-integration`, not PHPUnit Functional — so the Functional class
 * executed in no gate anywhere, ever, and the whole AC3 denial set went
 * unobserved. Requests go through the real `http_kernel`, so the router, the
 * `entity:bb_run` param converter, `_entity_access` and
 * `hook_file_download()` all participate together, exactly as they did under
 * a browser — everything except the browser itself.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RunLogDownloadTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use WorkspaceFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine', 'field', 'og',
    'serialization', 'file', 'image', 'jsonapi', 'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   *
   * Core's own service provider only registers the `private` stream wrapper
   * when `file_private_path` is already set at container-build time
   * (`CoreServiceProvider::register()`), which is before this test's setUp()
   * gets a chance to call setSetting(). Registering it directly here mirrors
   * `RunLogLazyReadTest`.
   */
  public function register(ContainerBuilder $container): void {
    parent::register($container);
    $container->register('stream_wrapper.private', 'Drupal\Core\StreamWrapper\PrivateStream')
      ->addTag('stream_wrapper', ['scheme' => 'private']);
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->allowRunLogStorage();
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_run', 'file',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
    $this->installConfig(['user', 'jsonapi']);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->installOgScopeFixture();
    $this->container->get('router.builder')->rebuild();
    // Uid 1 bypasses every access check; consume it here so the accounts
    // created below are ordinary users whose verdicts this test can measure
    // (same reasoning as WorkspaceRouteAccessTest::setUp()).
    $this->createAccount('root', []);
  }

  /**
   * A workspace member downloads the exact transcript that was stored.
   */
  public function testAuthorizedMemberDownloadsTheTranscript(): void {
    [$url, $member] = $this->sealedRun('transcript body');
    self::assertSame(200, $this->requestAs($member, $url)->getStatusCode());
    self::assertSame('transcript body', $this->requestAs($member, $url)->getContent());
  }

  /**
   * The response is marked private and never stored by a shared cache.
   */
  public function testResponseIsNotShareCacheable(): void {
    [$url, $member] = $this->sealedRun('transcript body');
    $header = (string) $this->requestAs($member, $url)->headers->get('Cache-Control');
    self::assertStringContainsString('no-store', $header);
    self::assertStringContainsString('private', $header);
  }

  /**
   * HTML captured in a transcript is served as inert plain text.
   */
  public function testHtmlInTranscriptIsServedInert(): void {
    [$url, $member] = $this->sealedRun('<script>alert(1)</script>');
    $response = $this->requestAs($member, $url);
    self::assertStringContainsString('text/plain', (string) $response->headers->get('Content-Type'));
    self::assertStringContainsString('nosniff', (string) $response->headers->get('X-Content-Type-Options'));
  }

  /**
   * An anonymous visitor is denied.
   */
  public function testAnonymousIsDenied(): void {
    [$url] = $this->sealedRun('transcript body');
    self::assertSame(403, $this->requestAnonymously($url)->getStatusCode());
  }

  /**
   * A logged-in user with no access to the run is denied.
   */
  public function testUserWithoutRunAccessIsDenied(): void {
    [$url] = $this->sealedRun('transcript body');
    $account = $this->createAccount('outsider', []);
    self::assertSame(403, $this->requestAs($account, $url)->getStatusCode());
  }

  /**
   * A member of a different workspace is denied.
   */
  public function testMemberOfAnotherWorkspaceIsDenied(): void {
    [$url] = $this->sealedRun('transcript body');
    self::assertSame(403, $this->requestAs($this->memberOfAnotherWorkspace(), $url)->getStatusCode());
  }

  /**
   * The raw private:// path is denied even to the run's own workspace member.
   */
  public function testRawPrivatePathIsDeniedEvenForTheOwner(): void {
    [, $member, $file] = $this->sealedRun('transcript body');
    // The file must never be served by core's private-file pipeline: the
    // retrieval route is the only door, and hook_file_download() is what keeps
    // the raw path shut.
    $rawUrl = $file->createFileUrl(FALSE);
    self::assertSame(403, $this->requestAs($member, $rawUrl)->getStatusCode());
  }

  /**
   * A run with no stored log returns 204 (CR2), not 404.
   *
   * 404 is reserved for a route/access failure; 204 is the unambiguous "no
   * transcript" signal a client can trust without risking data loss. The
   * headers are still the same private, no-store pair as a successful
   * response (review finding I6).
   */
  public function testMissingLogIsNoContent(): void {
    $run = $this->createRunInWorkspace();
    $membership = $this->memberOfTheWorkspace($run);
    $response = $this->requestAs($membership['member'], $this->downloadUrl($run, $membership['workspace'], 'log'));
    self::assertSame(204, $response->getStatusCode());
    $header = (string) $response->headers->get('Cache-Control');
    self::assertStringContainsString('no-store', $header);
    self::assertStringContainsString('private', $header);
  }

  /**
   * The href `RunLogOperationsHooks::entityOperation()` generates resolves.
   *
   * Review finding C1: every production caller addresses the run-log routes
   * by UUID (this operations link included), while the routes converted by
   * numeric id. This drives the actual generated href through the router,
   * rather than hand-building one, so a future caller switching forms would
   * fail this assertion too.
   */
  public function testGeneratedOperationHrefResolves(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', 'transcript body');
    $run->save();
    $membership = $this->memberOfTheWorkspace($run);
    $this->container->get('current_user')->setAccount($membership['member']);
    $operations = \Drupal::moduleHandler()->invokeAll('entity_operation', [
      $run,
      new CacheableMetadata(),
    ]);
    self::assertArrayHasKey('log', $operations);
    /** @var \Drupal\Core\Url $url */
    $url = $operations['log']['url'];
    $response = $this->requestAs($membership['member'], $url->toString());
    self::assertSame(200, $response->getStatusCode());
    self::assertSame('transcript body', $response->getContent());
  }

  /**
   * The workspace-free API route accepts the conductor's auth providers.
   */
  public function testApiRouteAllowsConductorAuthProviders(): void {
    $route = $this->container->get('router.route_provider')
      ->getRouteByName('bb_core.run_log_download_api');
    self::assertSame(['basic_auth', 'oauth2', 'cookie'], $route->getOption('_auth'));
  }

  /**
   * The workspace-free API route serves an authorized member (finding C2).
   *
   * No workspace slug is needed at all.
   */
  public function testApiRouteAppliesTheSameAccessGate(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', 'transcript body');
    $run->save();
    $membership = $this->memberOfTheWorkspace($run);
    $url = Url::fromRoute('bb_core.run_log_download_api', [
      'bb_run' => $run->uuid(),
      'kind' => 'log',
    ])->toString();
    $response = $this->requestAs($membership['member'], $url);
    self::assertSame(200, $response->getStatusCode());
    self::assertSame('transcript body', $response->getContent());
  }

  /**
   * The API route denies a member of a different workspace.
   *
   * Exactly like the workspace-prefixed one.
   */
  public function testApiRouteDeniesAnotherWorkspacesMember(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', 'transcript body');
    $run->save();
    $url = Url::fromRoute('bb_core.run_log_download_api', [
      'bb_run' => $run->uuid(),
      'kind' => 'log',
    ])->toString();
    self::assertSame(403, $this->requestAs($this->memberOfAnotherWorkspace(), $url)->getStatusCode());
  }

  /**
   * The workspace-prefixed route also serves the error log (I3).
   *
   * Every case above exercised `kind=log` only, so the controller's
   * `error_log` branch and its access behaviour were never reached through
   * the router at all.
   */
  public function testAuthorizedMemberDownloadsTheErrorLog(): void {
    $run = $this->createRunInWorkspace();
    $run->set('error_log', 'boom: dispatch failed');
    $run->save();
    $membership = $this->memberOfTheWorkspace($run);
    $response = $this->requestAs(
      $membership['member'],
      $this->downloadUrl($run, $membership['workspace'], 'error_log'),
    );
    self::assertSame(200, $response->getStatusCode());
    self::assertSame('boom: dispatch failed', $response->getContent());
  }

  /**
   * The workspace-free API route serves `kind=error_log` too (I3).
   */
  public function testApiRouteServesTheErrorLog(): void {
    $run = $this->createRunInWorkspace();
    $run->set('error_log', 'boom: dispatch failed');
    $run->save();
    $membership = $this->memberOfTheWorkspace($run);
    $url = Url::fromRoute('bb_core.run_log_download_api', [
      'bb_run' => $run->uuid(),
      'kind' => 'error_log',
    ])->toString();
    $response = $this->requestAs($membership['member'], $url);
    self::assertSame(200, $response->getStatusCode());
    self::assertSame('boom: dispatch failed', $response->getContent());
  }

  /**
   * Gzip and identity negotiate the same plaintext on both routes and kinds.
   */
  public function testGzipAndIdentityOnBothRoutesAndKinds(): void {
    $cases = [];
    foreach (['log' => 'transcript body', 'error_log' => 'boom: dispatch failed'] as $kind => $payload) {
      $run = $this->createRunInWorkspace();
      $run->set($kind, $payload);
      $run->save();
      $membership = $this->memberOfTheWorkspace($run);
      $cases[] = [
        'payload' => $payload,
        'member' => $membership['member'],
        'urls' => [
          $this->downloadUrl($run, $membership['workspace'], $kind),
          Url::fromRoute('bb_core.run_log_download_api', [
            'bb_run' => $run->uuid(),
            'kind' => $kind,
          ])->toString(),
        ],
      ];
    }
    foreach ($cases as $case) {
      foreach ($case['urls'] as $url) {
        $gzip = $this->requestAs($case['member'], $url, ['Accept-Encoding' => 'gzip']);
        self::assertSame(200, $gzip->getStatusCode());
        self::assertSame('gzip', $gzip->headers->get('Content-Encoding'));
        $gzip_body = $this->responseBody($gzip);
        $this->assertGzipEquals($case['payload'], $gzip_body);
        self::assertSame((string) strlen($gzip_body), $gzip->headers->get('Content-Length'));
        self::assertStringContainsString('Accept-Encoding', (string) $gzip->headers->get('Vary'));
        $this->assertProtectedDownloadHeaders($gzip, TRUE);

        $identity = $this->requestAs($case['member'], $url);
        self::assertSame(200, $identity->getStatusCode());
        self::assertSame($case['payload'], $identity->getContent());
        self::assertNull($identity->headers->get('Content-Encoding'));
        $this->assertProtectedDownloadHeaders($identity, TRUE);
      }
    }
  }

  /**
   * Accept-Encoding qualities pick gzip, identity, or 406.
   */
  public function testAcceptEncodingNegotiation(): void {
    [$url, $member] = $this->sealedRun('transcript body');
    $cases = [
      [NULL, 'identity'],
      ['', 'identity'],
      ['gzip', 'gzip'],
      ['identity', 'identity'],
      ['gzip;q=0', 'identity'],
      ['identity;q=0, gzip', 'gzip'],
      ['gzip;q=0.8, identity;q=0.5', 'gzip'],
      ['gzip;q=0.1, identity;q=0.9', 'identity'],
      ['gzip, identity', 'gzip'],
      ['gzip, deflate, br', 'gzip'],
      ['*', 'gzip'],
      ['*/*', 'gzip'],
      ['gzip;q=0, identity;q=0', 406],
      ['*;q=0', 406],
      ['identity;q=0', 406],
    ];
    foreach ($cases as [$header, $expected]) {
      $headers = $header === NULL ? [] : ['Accept-Encoding' => $header];
      $response = $this->requestAs($member, $url, $headers);
      if ($expected === 406) {
        self::assertSame(406, $response->getStatusCode(), 'header ' . var_export($header, TRUE));
        self::assertSame('', $response->getContent());
        self::assertNull($response->headers->get('Content-Encoding'));
        $this->assertProtectedDownloadHeaders($response, FALSE);
        continue;
      }
      self::assertSame(200, $response->getStatusCode(), 'header ' . var_export($header, TRUE));
      if ($expected === 'gzip') {
        self::assertSame('gzip', $response->headers->get('Content-Encoding'));
        $gzip_body = $this->responseBody($response);
        $this->assertGzipEquals('transcript body', $gzip_body);
        self::assertSame((string) strlen($gzip_body), $response->headers->get('Content-Length'));
        self::assertStringContainsString('Accept-Encoding', (string) $response->headers->get('Vary'));
      }
      else {
        self::assertNull($response->headers->get('Content-Encoding'));
        self::assertSame('transcript body', $response->getContent());
        self::assertStringContainsString('Accept-Encoding', (string) $response->headers->get('Vary'));
      }
      $this->assertProtectedDownloadHeaders($response, TRUE);
    }
  }

  /**
   * Access denials stay 403 for gzip and identity on both routes.
   */
  public function testDenialsHoldForGzipAndIdentity(): void {
    [$url] = $this->sealedRun('transcript body');
    $run = $this->createRunInWorkspace();
    $run->set('log', 'transcript body');
    $run->save();
    $apiUrl = Url::fromRoute('bb_core.run_log_download_api', [
      'bb_run' => $run->uuid(),
      'kind' => 'log',
    ])->toString();
    $outsider = $this->createAccount('outsider-enc', []);
    $foreign = $this->memberOfAnotherWorkspace();
    foreach (['gzip', 'identity'] as $encoding) {
      $headers = ['Accept-Encoding' => $encoding];
      self::assertSame(403, $this->requestAnonymously($url, $headers)->getStatusCode());
      self::assertSame(403, $this->requestAs($outsider, $url, $headers)->getStatusCode());
      self::assertSame(403, $this->requestAs($foreign, $url, $headers)->getStatusCode());
      self::assertSame(403, $this->requestAs($foreign, $apiUrl, $headers)->getStatusCode());
    }
  }

  /**
   * The raw private path stays shut even when the client asks for gzip.
   */
  public function testRawPrivatePathIsDeniedForGzipAndIdentity(): void {
    [, $member, $file] = $this->sealedRun('transcript body');
    $rawUrl = $file->createFileUrl(FALSE);
    foreach (['gzip', 'identity'] as $encoding) {
      self::assertSame(403, $this->requestAs($member, $rawUrl, ['Accept-Encoding' => $encoding])->getStatusCode());
    }
  }

  /**
   * Missing logs stay 204 with no Content-Encoding.
   *
   * Even when gzip is asked for, or both encodings are forbidden.
   */
  public function testMissingLogIsNoContentEvenWhenGzipRequested(): void {
    $run = $this->createRunInWorkspace();
    $membership = $this->memberOfTheWorkspace($run);
    $url = $this->downloadUrl($run, $membership['workspace'], 'log');
    foreach ([NULL, 'gzip', 'gzip;q=0, identity;q=0'] as $header) {
      $headers = $header === NULL ? [] : ['Accept-Encoding' => $header];
      $response = $this->requestAs($membership['member'], $url, $headers);
      self::assertSame(204, $response->getStatusCode(), 'header ' . var_export($header, TRUE));
      self::assertSame('', $response->getContent());
      self::assertNull($response->headers->get('Content-Encoding'));
      $this->assertProtectedDownloadHeaders($response, FALSE);
    }
  }

  /**
   * HTML inside a gzipped 200 is still inert text/plain.
   */
  public function testHtmlInGzipTranscriptIsStillInertPlainText(): void {
    [$url, $member] = $this->sealedRun('<script>alert(1)</script>');
    $response = $this->requestAs($member, $url, ['Accept-Encoding' => 'gzip']);
    $this->assertGzipEquals('<script>alert(1)</script>', $this->responseBody($response));
    $this->assertProtectedDownloadHeaders($response, TRUE);
  }

  /**
   * A corrupt stored `.log.gz` is a generic 500 for gzip and identity.
   */
  public function testCorruptStoredGzipIsGeneric500(): void {
    [$url, $member, $file] = $this->sealedRun('transcript body');
    file_put_contents($file->getFileUri(), 'not-gzip');
    foreach ([NULL, 'gzip'] as $header) {
      $headers = $header === NULL ? [] : ['Accept-Encoding' => $header];
      $response = $this->requestAs($member, $url, $headers);
      self::assertSame(500, $response->getStatusCode());
      self::assertSame('', $response->getContent());
      self::assertNull($response->headers->get('Content-Encoding'));
      $this->assertProtectedDownloadHeaders($response, FALSE);
    }
  }

  /**
   * Legacy plaintext `.log` files still negotiate gzip of the decoded text.
   */
  public function testLegacyPlaintextLogNegotiatesGzipFromDecodedText(): void {
    $run = $this->createRunInWorkspace();
    $payload = 'legacy transcript';
    $this->plantLegacyPlaintextLog($run, $payload);
    $membership = $this->memberOfTheWorkspace($run);
    $url = $this->downloadUrl($run, $membership['workspace'], 'log');
    $gzip = $this->requestAs($membership['member'], $url, ['Accept-Encoding' => 'gzip']);
    self::assertSame(200, $gzip->getStatusCode());
    self::assertSame('gzip', $gzip->headers->get('Content-Encoding'));
    $this->assertGzipEquals($payload, $this->responseBody($gzip));
    $identity = $this->requestAs($membership['member'], $url);
    self::assertSame($payload, $identity->getContent());
    self::assertNull($identity->headers->get('Content-Encoding'));
  }

  /**
   * A JSON:API `?include=log_file` read cannot hand back a usable payload URL.
   *
   * The run's own attributes never carry the payload (`log`/`error_log` read
   * NULL — preSave() cleared them), and the referenced `file--file` resource
   * itself is omitted from `included` with a 403 recorded under
   * `meta.omitted`: JSON:API's own access check on the file entity denies it
   * before core's private-file pipeline is ever reached. This asserts both
   * halves, then confirms the one href JSON:API does surface for the omitted
   * resource — the raw item route — 403s the same way
   * `testRawPrivatePathIsDeniedEvenForTheOwner()` proves for a directly
   * created file.
   */
  public function testJsonApiIncludeCannotYieldUsableUrl(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', 'transcript body');
    $run->save();
    $membership = $this->memberOfTheWorkspace($run);
    $url = Url::fromRoute('jsonapi.bb_run--bb_run.individual', [
      'entity' => $run->uuid(),
    ])->toString() . '?include=log_file';
    $response = $this->requestAs($membership['member'], $url);
    self::assertSame(200, $response->getStatusCode());
    $document = json_decode((string) $response->getContent(), TRUE);
    self::assertIsArray($document);
    self::assertArrayHasKey('log', $document['data']['attributes']);
    self::assertNull($document['data']['attributes']['log']);
    self::assertArrayHasKey('error_log', $document['data']['attributes']);
    self::assertNull($document['data']['attributes']['error_log']);
    self::assertArrayNotHasKey('included', $document, 'the referenced file resource must not be included');
    $omitted = $document['meta']['omitted']['links'] ?? [];
    self::assertNotEmpty($omitted, 'the omission must be recorded rather than silently dropped');
    $omittedHref = NULL;
    foreach ($omitted as $link) {
      if (is_array($link) && ($link['meta']['rel'] ?? NULL) === 'item') {
        $omittedHref = $link['href'];
        break;
      }
    }
    self::assertIsString($omittedHref);
    self::assertSame(403, $this->requestAs($membership['member'], $omittedHref)->getStatusCode());
  }

  /**
   * Builds a run whose stored log is reachable only through the route.
   *
   * @return array{0: string, 1: \Drupal\user\UserInterface, 2: \Drupal\file\FileInterface}
   *   The download URL, a member of the run's own workspace, and the managed
   *   file the payload was written to.
   */
  private function sealedRun(string $payload): array {
    $run = $this->createRunInWorkspace();
    $run->set('log', $payload);
    $run->save();
    $file = $run->get('log_file')->entity;
    self::assertInstanceOf(FileInterface::class, $file);

    $membership = $this->memberOfTheWorkspace($run);
    return [$this->downloadUrl($run, $membership['workspace'], 'log'), $membership['member'], $file];
  }

  /**
   * Creates a `contributor` of the run's workspace on its project's team.
   *
   * @return array{workspace: \Drupal\bb_core\Entity\BbWorkspaceInterface, member: \Drupal\user\UserInterface}
   *   The workspace and the saved account.
   */
  private function memberOfTheWorkspace(BbRunInterface $run): array {
    $workspace = $this->container->get(WorkspaceResolverInterface::class)->resolve($run);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $member = $this->createAccount('member', []);
    $this->addMembership($workspace, $member, ['contributor']);
    $this->seatOnProjectTeam($run->getTicket()?->getProject(), $member);
    return ['workspace' => $workspace, 'member' => $member];
  }

  /**
   * Creates an account that belongs to an unrelated workspace only.
   */
  private function memberOfAnotherWorkspace(): UserInterface {
    $other = $this->createSecondWorkspace();
    $member = $this->createAccount('other-member', []);
    $this->addMembership($other, $member, ['contributor']);
    return $member;
  }

  /**
   * Builds the retrieval URL for a run's log or error log.
   *
   * The workspace segment must be a real, registered slug:
   * BbWorkspacePathProcessor only rewrites it onto the route's actual
   * `/_workspace/…` path when the segment is in the live slug set, so an
   * arbitrary placeholder here would 404 before the route's own access check
   * ever runs.
   */
  private function downloadUrl(BbRunInterface $run, BbWorkspaceInterface $workspace, string $kind): string {
    return Url::fromRoute('bb_core.run_log_download', [
      'bb_workspace' => $workspace->getSlug(),
      'bb_run' => $run->uuid(),
      'kind' => $kind,
    ])->toString();
  }

  /**
   * Creates a user holding exactly the given permissions.
   *
   * @param string $name
   *   The user name, also used to derive a dedicated role id.
   * @param array<string> $permissions
   *   The permissions to grant on that role.
   *
   * @return \Drupal\user\UserInterface
   *   The saved user.
   */
  private function createAccount(string $name, array $permissions): UserInterface {
    $role_id = 'r_' . $name . '_' . \bin2hex(\random_bytes(3));
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    if ($permissions !== []) {
      user_role_grant_permissions($role_id, $permissions);
    }
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name . \bin2hex(\random_bytes(3)), 'status' => 1, 'roles' => [$role_id]]);
    self::assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Runs a request through the real HTTP kernel as the given account.
   */
  private function requestAs(UserInterface $account, string $url, array $headers = []): Response {
    $this->container->get('current_user')->setAccount($account);
    $request = Request::create($url);
    foreach ($headers as $name => $value) {
      $request->headers->set($name, $value);
    }
    $response = $this->container->get('http_kernel')->handle($request);
    $this->container->get('request_stack')->pop();
    return $response;
  }

  /**
   * Runs a request through the real HTTP kernel as the anonymous user.
   */
  private function requestAnonymously(string $url, array $headers = []): Response {
    $this->container->get('current_user')->setAccount(new AnonymousUserSession());
    $request = Request::create($url);
    foreach ($headers as $name => $value) {
      $request->headers->set($name, $value);
    }
    $response = $this->container->get('http_kernel')->handle($request);
    $this->container->get('request_stack')->pop();
    return $response;
  }

  /**
   * Plants a leftover plaintext `.log` and points the run at it.
   */
  private function plantLegacyPlaintextLog(BbRunInterface $run, string $payload): FileInterface {
    $workspace = $this->container->get(WorkspaceResolverInterface::class)->resolve($run);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $directory = sprintf('private://bakers-run-logs/%s/%s', $workspace->uuid(), $run->uuid());
    $this->container->get('file_system')->prepareDirectory(
      $directory,
      FileSystemInterface::CREATE_DIRECTORY,
    );
    $name = 'legacy.log';
    $uri = $directory . '/' . $name;
    file_put_contents($uri, $payload);
    $file = $this->container->get('entity_type.manager')->getStorage('file')->create([
      'uri' => $uri,
      'filename' => $name,
      'filemime' => 'text/plain',
      'status' => FileInterface::STATUS_PERMANENT,
    ]);
    $file->save();
    self::assertInstanceOf(FileInterface::class, $file);
    $run->set('log_file', $file->id());
    $run->set('log_sha256', hash('sha256', $payload));
    $run->set('log_bytes', strlen($payload));
    $run->save();
    return $file;
  }

  /**
   * Returns the response body as a string.
   */
  private function responseBody(Response $response): string {
    $body = $response->getContent();
    self::assertNotFalse($body);
    return $body;
  }

  /**
   * Asserts a gzip wire body decodes to the expected plaintext.
   */
  private function assertGzipEquals(string $expected, string $gzip): void {
    $decoded = gzdecode($gzip);
    self::assertNotFalse($decoded);
    self::assertSame($expected, $decoded);
  }

  /**
   * Cache/security headers, and for a 200 the attachment/text-plain pair.
   */
  private function assertProtectedDownloadHeaders(Response $response, bool $download): void {
    $cache = (string) $response->headers->get('Cache-Control');
    self::assertStringContainsString('no-store', $cache);
    self::assertStringContainsString('private', $cache);
    self::assertStringContainsString('nosniff', (string) $response->headers->get('X-Content-Type-Options'));
    if ($download) {
      self::assertStringContainsString('text/plain', (string) $response->headers->get('Content-Type'));
      self::assertStringContainsString('attachment', (string) $response->headers->get('Content-Disposition'));
    }
  }

}
