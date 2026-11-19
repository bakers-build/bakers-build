<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Access\BbWorkspaceAccessCheck;
use Drupal\bb_core\EventSubscriber\WorkspaceSignInSubscriber;
use Drupal\Core\ParamConverter\ParamNotConvertedException;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\HttpKernelInterface;

/**
 * Covers the sign-in redirect of signed-out workspace deep links.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceSignInSubscriberTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = ['file', 'image', 'system', 'user', 'options', 'bb_core'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['system', 'user']);
    $this->createUser([], 'uid1-dummy');
  }

  /**
   * A signed-out workspace deep link signs in and returns to the same URI.
   */
  public function testAnonymousWorkspaceDeepLinkIsSentToSignIn(): void {
    $this->setCurrentUser(new AnonymousUserSession());
    foreach ([
      '/north/tickets' => $this->marked(),
      '/north/ticket/n-999' => new NotFoundHttpException(),
      '/north/stats?filter[period]=year' => new NotFoundHttpException(),
    ] as $uri => $exception) {
      $this->assertSignIn($uri, $this->respond($uri, $exception));
    }
  }

  /**
   * Known, missing and unknown targets answer identically, so none leaks.
   */
  public function testResponseRevealsNothing(): void {
    $this->setCurrentUser(new AnonymousUserSession());
    foreach ([
      '/north/ticket/n-1' => new AccessDeniedHttpException(),
      '/north/tickets' => $this->marked(),
      // A missing entity is still unconverted here; core 404s it later.
      '/north/ticket/n-999' => new ParamNotConvertedException('', 0, NULL, 'entity.bb_ticket.canonical'),
      '/no-such-ws/ticket/x-1' => new NotFoundHttpException(),
    ] as $uri => $exception) {
      $this->assertSignIn($uri, $this->respond($uri, $exception));
    }
  }

  /**
   * A signed-in account outside the workspace keeps the 404.
   */
  public function testSignedInAccountKeepsTheBoundary(): void {
    $stranger = $this->createUser([], 'stranger');
    self::assertInstanceOf(UserInterface::class, $stranger);
    $this->setCurrentUser($stranger);
    self::assertNull($this->respond('/north/tickets', $this->marked()));
    self::assertNull($this->respond('/no-such-ws/stats', new NotFoundHttpException()));
  }

  /**
   * Paths that can never be workspace URLs keep their 404.
   */
  public function testNonWorkspacePathsKeepTheir404(): void {
    $this->setCurrentUser(new AnonymousUserSession());
    foreach ([
      '/missing-application-page',
      '/favicon.ico',
      '/wp-login.php',
      '/north',
      '/north/',
      '/jsonapi/x',
      '/oauth/x',
      '/user/x/y',
      '/-bad/ticket/x',
    ] as $uri) {
      self::assertNull($this->respond($uri, new NotFoundHttpException()), $uri);
    }
  }

  /**
   * A signed-out write keeps its denial; it has no URL to return to.
   */
  public function testUnsafeMethodsKeepTheirDenial(): void {
    $this->setCurrentUser(new AnonymousUserSession());
    $uri = '/north/ticket/n-1/property';
    self::assertNull($this->respond($uri, new AccessDeniedHttpException(), 'POST'));
    self::assertNull($this->respond($uri, new AccessDeniedHttpException(), 'PATCH'));
    self::assertNull($this->respond($uri, new NotFoundHttpException(), 'POST'));
  }

  /**
   * Other errors than a denial or a 404 pass through.
   */
  public function testOtherErrorsPassThrough(): void {
    $this->setCurrentUser(new AnonymousUserSession());
    self::assertNull($this->respond('/north/tickets', new \RuntimeException()));
  }

  /**
   * Asserts a redirect to sign-in that returns to the URI.
   */
  private function assertSignIn(string $uri, ?Response $response): void {
    self::assertInstanceOf(RedirectResponse::class, $response, $uri);
    self::assertSame(
      Url::fromRoute('user.login', [], ['query' => ['destination' => $uri]])->toString(),
      $response->getTargetUrl(),
    );
  }

  /**
   * The workspace boundary's denial.
   */
  private function marked(): AccessDeniedHttpException {
    return new AccessDeniedHttpException(BbWorkspaceAccessCheck::WORKSPACE_MISMATCH_REASON);
  }

  /**
   * The response the subscriber gives a failed request, if any.
   */
  private function respond(string $uri, \Throwable $exception, string $method = 'GET'): ?Response {
    $event = new ExceptionEvent(
      $this->container->get('http_kernel'),
      Request::create($uri, $method),
      HttpKernelInterface::MAIN_REQUEST,
      $exception,
    );
    $subscriber = $this->container->get('bb_core.workspace_sign_in_subscriber');
    self::assertInstanceOf(WorkspaceSignInSubscriber::class, $subscriber);
    $subscriber->onException($event);
    return $event->getResponse();
  }

}
