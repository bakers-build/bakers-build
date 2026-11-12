<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\RunLog;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\Tests\bb_core\Kernel\WorkspaceFixtureTrait;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Conductor download route through the real basic_auth stack.
 *
 * RunLogDownloadTest::requestAs() sets current_user and never sends
 * credentials, so AuthenticationSubscriber does not run there.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RunLogDownloadAuthTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use WorkspaceFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine', 'field', 'og',
    'serialization', 'file', 'image', 'jsonapi', 'link', 'text', 'basic_auth',
    'bb_core',
  ];

  /**
   * {@inheritdoc}
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
    $this->createAccount('root', []);
  }

  /**
   * A Basic-authenticated outsider is still denied on the conductor route.
   */
  public function testApiRouteDeniesBasicAuthenticatedOutsider(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', 'transcript body');
    $run->save();
    $workspace = $this->container->get(WorkspaceResolverInterface::class)->resolve($run);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $password = 'basic-pass';
    $member = $this->createAccount('member-basic', []);
    $member->setPassword($password)->save();
    $this->addMembership($workspace, $member, ['contributor']);
    $this->seatOnProjectTeam($run->getTicket()?->getProject(), $member);
    $outsider = $this->createAccount('outsider-basic', []);
    $outsider->setPassword($password)->save();
    $url = Url::fromRoute('bb_core.run_log_download_api', [
      'bb_run' => $run->uuid(),
      'kind' => 'log',
    ])->toString();
    $member_response = $this->requestWithBasicAuth(
      (string) $member->getAccountName(),
      $password,
      $url,
    );
    self::assertSame(200, $member_response->getStatusCode(), (string) $member_response->getContent());
    self::assertSame('transcript body', $member_response->getContent());
    $denied = $this->requestWithBasicAuth(
      (string) $outsider->getAccountName(),
      $password,
      $url,
    );
    self::assertSame(403, $denied->getStatusCode(), (string) $denied->getContent());
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
   * Runs a GET through the kernel with HTTP Basic credentials.
   */
  private function requestWithBasicAuth(string $username, string $password, string $url): Response {
    $this->container->get('current_user')->setAccount(new AnonymousUserSession());
    $request = Request::create($url, 'GET', [], [], [], [
      'PHP_AUTH_USER' => $username,
      'PHP_AUTH_PW' => $password,
    ]);
    $response = $this->container->get('http_kernel')->handle($request);
    $this->container->get('request_stack')->pop();
    return $response;
  }

}
