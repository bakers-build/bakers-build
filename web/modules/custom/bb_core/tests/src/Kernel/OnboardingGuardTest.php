<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Cache\CacheableResponseInterface;
use Drupal\Core\Config\FileStorage;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\bb_core\EventSubscriber\OnboardingGuardSubscriber;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\HttpKernelInterface;

/**
 * Incomplete browser entry is sent to the wizard.
 *
 * API and completed users are not redirected.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class OnboardingGuardTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'ui_patterns', 'file', 'image', 'bb_core',
  ];

  /**
   * The subscriber under test.
   */
  private OnboardingGuardSubscriber $subscriber;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['system', 'user']);
    $this->container->get('router.builder')->rebuild();
    $this->createUser([], 'uid1-dummy');
    $this->installCompletionField();
    $subscriber = $this->container->get('bb_core.onboarding_guard_subscriber');
    self::assertInstanceOf(OnboardingGuardSubscriber::class, $subscriber);
    $this->subscriber = $subscriber;
  }

  /**
   * An incomplete HTML request to an application route is sent to the wizard.
   */
  public function testIncompleteBrowserRequestRedirectsToWizard(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);

    $event = $this->requestEvent('/home', 'bb_core.home', 'text/html');
    $this->subscriber->onRequest($event);

    self::assertTrue($event->hasResponse());
    $response = $event->getResponse();
    self::assertInstanceOf(CacheableResponseInterface::class, $response);
    self::assertSame(302, $response->getStatusCode());
    self::assertStringContainsString('/home/onboarding', (string) $response->headers->get('location'));
    self::assertSame(0, $response->getCacheableMetadata()->getCacheMaxAge());
  }

  /**
   * Completing the stored flag lets the same request through.
   */
  public function testCompleteAccountIsNotRedirected(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $account->set('field_onboarding_completed', TRUE)->save();
    $this->container->get('current_user')->setAccount($account);

    $event = $this->requestEvent('/home', 'bb_core.home', 'text/html');
    $this->subscriber->onRequest($event);

    self::assertFalse($event->hasResponse());
  }

  /**
   * The wizard route itself is never intercepted, so the guard cannot loop.
   */
  public function testWizardRouteIsNotIntercepted(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);

    $event = $this->requestEvent('/home/onboarding', 'bb_core.onboarding', 'text/html');
    $this->subscriber->onRequest($event);

    self::assertFalse($event->hasResponse());
  }

  /**
   * JSON:API collection requests are outside the browser entry guard.
   */
  public function testJsonApiRequestIsNotIntercepted(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);

    $event = $this->requestEvent(
      '/jsonapi/bb_ticket/bb_ticket',
      'jsonapi.bb_ticket--bb_ticket.collection',
      'application/vnd.api+json',
    );
    $this->subscriber->onRequest($event);

    self::assertFalse($event->hasResponse());
  }

  /**
   * Anonymous visitors are not sent to the wizard.
   */
  public function testAnonymousRequestIsNotIntercepted(): void {
    $anonymous = $this->container->get('current_user');
    self::assertTrue($anonymous->isAnonymous());

    $event = $this->requestEvent('/home', 'bb_core.home', 'text/html');
    $this->subscriber->onRequest($event);

    self::assertFalse($event->hasResponse());
  }

  /**
   * Logout remains reachable while onboarding is incomplete.
   */
  public function testLogoutRouteIsNotIntercepted(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);

    $event = $this->requestEvent('/user/logout', 'user.logout', 'text/html');
    $this->subscriber->onRequest($event);

    self::assertFalse($event->hasResponse());
  }

  /**
   * A site without the completion field lets everyone through.
   *
   * Between a code deploy and the config import the field does not exist
   * yet, and no account could ever be marked complete, so failing closed
   * would loop every account between the wizard and the overview.
   */
  public function testMissingCompletionFieldIsNotIntercepted(): void {
    FieldConfig::loadByName('user', 'user', 'field_onboarding_completed')?->delete();
    $this->container->get('entity_field.manager')->clearCachedFieldDefinitions();
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);

    $event = $this->requestEvent('/home', 'bb_core.home', 'text/html');
    $this->subscriber->onRequest($event);

    self::assertFalse($event->hasResponse());
  }

  /**
   * bakers.build's own API is not a browser screen, even without an Accept header.
   */
  public function testBbApiRequestIsNotIntercepted(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);

    $event = $this->requestEvent(
      '/_bakers-api/run/00000000-0000-4000-8000-000000000000/log/log',
      'bb_core.run_log_download_api',
      '',
    );
    $this->subscriber->onRequest($event);

    self::assertFalse($event->hasResponse());
  }

  /**
   * Ordinary account forms cannot author the completion flag.
   */
  public function testCompletionFieldEditAccessIsForbidden(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    $items = $account->get('field_onboarding_completed');
    self::assertFalse($items->access('edit', $account));
    self::assertFalse($items->access('edit', $this->container->get('current_user')));
  }

  /**
   * The completion rule does not displace another field-access rule.
   *
   * Core keys each module's hook_entity_field_access() answer by module name,
   * so a second implementation in bb_core would overwrite the rank fence's
   * answer for every field instead of adding to it.
   */
  public function testBbCoreImplementsFieldAccessOnce(): void {
    $modules = [];
    $this->container->get('module_handler')->invokeAllWith(
      'entity_field_access',
      function (callable $hook, string $module) use (&$modules): void {
        $modules[] = $module;
      },
    );
    self::assertCount(1, array_keys($modules, 'bb_core', TRUE));
  }

  /**
   * Builds a main-request event with route and Accept already set.
   */
  private function requestEvent(string $path, string $route, string $accept): RequestEvent {
    $request = Request::create($path, 'GET');
    $request->headers->set('Accept', $accept);
    $request->attributes->set('_route', $route);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $kernel = $this->container->get('http_kernel');
    self::assertInstanceOf(HttpKernelInterface::class, $kernel);
    return new RequestEvent($kernel, $request, HttpKernelInterface::MAIN_REQUEST);
  }

  /**
   * Installs the completion field from config/sync.
   */
  private function installCompletionField(): void {
    $this->container->get('config.typed')->clearCachedDefinitions();
    $storage = new FileStorage(dirname($this->root) . '/config/sync');
    $storageData = $storage->read('field.storage.user.field_onboarding_completed');
    self::assertIsArray($storageData, 'config/sync/field.storage.user.field_onboarding_completed.yml exists.');
    FieldStorageConfig::create($storageData)->save();
    $fieldData = $storage->read('field.field.user.user.field_onboarding_completed');
    self::assertIsArray($fieldData, 'config/sync/field.field.user.user.field_onboarding_completed.yml exists.');
    FieldConfig::create($fieldData)->save();
  }

}
