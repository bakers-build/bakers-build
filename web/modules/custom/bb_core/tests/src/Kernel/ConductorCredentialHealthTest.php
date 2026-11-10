<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Conductor\ConductorRegistrar;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\RoleInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * Covers the credential health a conductor reports on its heartbeat.
 *
 * The box checks its own credentials; the server stores the latest report
 * as `credential_health` so the conductor page can warn before a token
 * expires. A registration ping from `poll`/`reap` sends no report and must
 * keep the stored one.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConductorCredentialHealthTest extends KernelTestBase {

  use OgScopeFixtureTrait;

  private const HOST = '63655f9e-904a-5f43-92cc-c48a75ae7eae';

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'serialization', 'jsonapi', 'jsonapi_resources',
    'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_machine',
      'bb_group', 'bb_project', 'bb_conductor',
      'bb_ticket', 'bb_comment', 'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user', 'jsonapi']);
    $this->installOgScopeFixture();
    $this->createUser('uid1-dummy');
    $this->createProject('default-project');
  }

  /**
   * A reported list is stored as JSON and replaced by the next report.
   */
  public function testHeartbeatStoresAndReplacesTheReport(): void {
    $owner = $this->createUser('owner-store');
    $report = [
      ['name' => 'github', 'status' => 'warning', 'expires_at' => '2026-11-20', 'reason' => 'Token expires in 10 days.'],
      ['name' => 'claude', 'status' => 'error', 'reason' => 'Not logged in.'],
      ['name' => 'gitlab', 'status' => 'ok', 'reason' => ''],
    ];

    $conductor = $this->heartbeat($owner, ['credentials' => $report]);
    $this->assertSame($report, $this->stored($conductor));

    $after = $this->heartbeat($owner, ['credentials' => []]);
    $this->assertSame([], $this->stored($after), 'An empty report clears the previous one.');
  }

  /**
   * A heartbeat without the attribute keeps the stored report.
   */
  public function testHeartbeatWithoutTheReportKeepsIt(): void {
    $owner = $this->createUser('owner-keep');
    $report = [['name' => 'github', 'status' => 'error', 'reason' => 'Token revoked.']];
    $this->heartbeat($owner, ['credentials' => $report]);

    $after = $this->heartbeat($owner, []);

    $this->assertSame($report, $this->stored($after));
  }

  /**
   * A malformed report is refused before anything is written.
   *
   * @param mixed $credentials
   *   The malformed attribute.
   */
  #[DataProvider('malformedProvider')]
  public function testMalformedReportIsRefused(mixed $credentials): void {
    $owner = $this->createUser('owner-malformed');
    $report = [['name' => 'github', 'status' => 'ok', 'reason' => '']];
    $conductor = $this->heartbeat($owner, ['credentials' => $report]);

    try {
      $this->heartbeat($owner, ['credentials' => $credentials]);
      $this->fail('A malformed report must be refused.');
    }
    catch (UnprocessableEntityHttpException $e) {
      $this->assertStringContainsString('credentials', $e->getMessage());
    }
    $this->assertSame($report, $this->stored($this->reload($conductor->id())));
  }

  /**
   * Malformed reports.
   *
   * @return array<string, array{mixed}>
   *   The attribute per case.
   */
  public static function malformedProvider(): array {
    $ok = ['name' => 'github', 'status' => 'ok', 'reason' => ''];
    return [
      'not a list' => ['github: ok'],
      'keyed object' => [['github' => $ok]],
      'entry not an object' => [['github']],
      'unknown status' => [[['status' => 'expired'] + $ok]],
      'missing name' => [[array_diff_key($ok, ['name' => 1])]],
      'missing reason' => [[array_diff_key($ok, ['reason' => 1])]],
      'name too long' => [[['name' => str_repeat('n', 201)] + $ok]],
      'reason too long' => [[['reason' => str_repeat('r', 201)] + $ok]],
      'expiry not a date' => [[['expires_at' => '20 Nov 2026'] + $ok]],
      'expiry impossible' => [[['expires_at' => '2026-02-30'] + $ok]],
      'too many entries' => [array_fill(0, 51, $ok)],
    ];
  }

  /**
   * The heartbeat response carries the report as a JSON:API attribute.
   */
  public function testHeartbeatResponseExposesTheReport(): void {
    $owner = $this->createUser('owner-http');
    user_role_grant_permissions(RoleInterface::AUTHENTICATED_ID, ['register bakers conductor']);
    $this->config('jsonapi.settings')->set('read_only', FALSE)->save();
    $this->container->get('current_user')->setAccount($owner);
    $report = [['name' => 'github', 'status' => 'warning', 'expires_at' => '2026-11-20', 'reason' => 'Expires soon.']];
    $request = Request::create('/jsonapi/bakers/heartbeat', 'POST', [], [], [], [
      'CONTENT_TYPE' => 'application/vnd.api+json',
      'HTTP_ACCEPT' => 'application/vnd.api+json',
      'HTTP_X_BAKERS_CLIENT' => 'bakers/99.0.0',
    ], json_encode(['data' => ['attributes' => $this->attrs(['credentials' => $report])]], JSON_THROW_ON_ERROR));

    $response = $this->container->get('http_kernel')->handle($request);

    $this->assertSame(200, $response->getStatusCode(), (string) $response->getContent());
    $body = json_decode((string) $response->getContent(), TRUE, 512, JSON_THROW_ON_ERROR);
    $this->assertSame($report, json_decode($body['data']['attributes']['credential_health'], TRUE, 512, JSON_THROW_ON_ERROR));
  }

  /**
   * Sends one heartbeat for the test conductor.
   *
   * @param \Drupal\user\UserInterface $owner
   *   The owner.
   * @param array<string, mixed> $extra
   *   Attributes beyond the identity.
   */
  private function heartbeat(UserInterface $owner, array $extra): BbConductorInterface {
    $registrar = \Drupal::service('bb_core.conductor_registrar');
    $this->assertInstanceOf(ConductorRegistrar::class, $registrar);
    return $registrar->heartbeat($owner, $this->attrs($extra));
  }

  /**
   * The identity attributes plus extras.
   *
   * @param array<string, mixed> $extra
   *   Attributes beyond the identity.
   *
   * @return array<string, mixed>
   *   The heartbeat attributes.
   */
  private function attrs(array $extra): array {
    return $extra + [
      'conductor_id' => 'mid-credentials',
      'host_key' => self::HOST,
      'project' => 'default-project',
    ];
  }

  /**
   * The stored report, decoded.
   *
   * @return array<int, array<string, string>>
   *   The entries.
   */
  private function stored(BbConductorInterface $conductor): array {
    $reloaded = $this->reload($conductor->id());
    return json_decode((string) $reloaded->get('credential_health')->value, TRUE, 512, JSON_THROW_ON_ERROR);
  }

  /**
   * Reloads a conductor from storage, bypassing the entity static cache.
   */
  private function reload(int|string|null $id): BbConductorInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_conductor');
    $storage->resetCache([$id]);
    $conductor = $storage->load($id);
    $this->assertInstanceOf(BbConductorInterface::class, $conductor);
    return $conductor;
  }

  /**
   * Creates a user account.
   */
  private function createUser(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    $this->addContributorEverywhere($user);
    return $user;
  }

  /**
   * Creates a project with a workspace chain the registrar can resolve.
   */
  private function createProject(string $name): void {
    $storage = fn (string $type) => $this->container->get('entity_type.manager')->getStorage($type);
    $workspace = $storage('bb_workspace')->create(['name' => 'ws-' . $name]);
    $workspace->save();
    $group = $storage('bb_group')->create(['name' => 'g-' . $name, 'workspace_id' => $workspace->id()]);
    $group->save();
    $team = $storage('bb_team')->create(['name' => 't-' . $name, 'workspace_id' => $workspace->id()]);
    $team->save();
    $storage('bb_project')->create(['name' => $name, 'group_id' => $group->id(), 'teams' => [$team->id()]])->save();
  }

}
