<?php

declare(strict_types=1);

namespace Drupal\island\EventSubscriber;

use Drupal\Component\Plugin\Exception\PluginException;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Access\CsrfTokenGenerator;
use Drupal\Core\Session\AccountInterface;
use Drupal\island\IslandContextProviderInterface;
use Drupal\island\IslandHostResolver;
use Drupal\island\IslandInterface;
use Drupal\island\IslandViewAccessInterface;
use Drupal\island\IslandPluginManagerInterface;
use Drupal\island\IslandResponder;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Answers island action links, which POST to the page they are shown on.
 *
 * The action runs in the page's own request, as island forms do: placement
 * conditions, contexts and the page route's access all see the real page.
 * Runs at kernel.request after routing and route access (priority 32), so a
 * visitor who may not see the page cannot act on it, and before the page
 * controller, which never runs for an action.
 */
final class IslandActionSubscriber implements EventSubscriberInterface {

  /**
   * POST keys that address the action; everything else is a parameter.
   */
  public const ISLAND = '_island';
  public const ACTION = '_island_action';
  public const HOST = '_island_host';
  public const TOKEN = '_island_token';

  public function __construct(
    private readonly IslandHostResolver $hostResolver,
    private readonly IslandPluginManagerInterface $islandManager,
    private readonly IslandResponder $responder,
    private readonly AccountInterface $currentUser,
    private readonly CsrfTokenGenerator $csrfToken,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    return [KernelEvents::REQUEST => [['onRequest', 28]]];
  }

  /**
   * The CSRF token seed of one island action.
   */
  public static function tokenSeed(string $island_id, string $action): string {
    return sprintf('island/action/%s/%s', $island_id, $action);
  }

  /**
   * Applies a posted island action and answers with its fragments.
   */
  public function onRequest(RequestEvent $event): void {
    $request = $event->getRequest();
    if (!$event->isMainRequest() || !$request->isMethod('POST') || !$request->request->has(self::ACTION)) {
      return;
    }
    $island_id = (string) $request->request->get(self::ISLAND, '');
    $action = (string) $request->request->get(self::ACTION, '');
    if (!$this->csrfToken->validate((string) $request->request->get(self::TOKEN, ''), self::tokenSeed($island_id, $action))) {
      throw new AccessDeniedHttpException('Invalid island action token.');
    }
    $host_id = (string) $request->request->get(self::HOST, '');
    $host = $host_id === '' ? NULL : $this->hostResolver->resolve($host_id);
    $island = $host === NULL ? NULL : $this->createIsland($island_id, $host);
    if ($host === NULL || $island === NULL) {
      throw new AccessDeniedHttpException('Unknown island.');
    }
    $parameters = $this->actionParameters($request);
    if (!$this->access($island_id, $action, $parameters, $host, $island)->isAllowed()) {
      throw new AccessDeniedHttpException();
    }
    $event->setResponse($this->responder->toResponse($island->applyAction($action, $parameters), $island, $host));
  }

  /**
   * The host's view access and the island plugin's accessAction(), combined.
   */
  private function access(string $island_id, string $action, array $parameters, IslandContextProviderInterface $host, IslandInterface $island): AccessResultInterface {
    $access = AccessResult::allowed();
    if ($host instanceof IslandViewAccessInterface) {
      $access = $host->accessIsland($island_id, $this->currentUser);
      if (!$access->isAllowed()) {
        return $access;
      }
    }
    return $island->accessAction($action, $parameters, $this->currentUser)->andIf($access);
  }

  /**
   * Action parameters: posted values minus the addressing keys.
   */
  private function actionParameters(Request $request): array {
    $parameters = $request->request->all();
    unset($parameters[self::ISLAND], $parameters[self::ACTION], $parameters[self::HOST], $parameters[self::TOKEN]);
    return $parameters;
  }

  /**
   * Creates an island instance wired to its host context.
   *
   * The island id is client-supplied: an id the host does not claim and an id
   * without a plugin are both a miss, as in
   * IslandHostResolver::verifiedIsland(), never a 500.
   */
  private function createIsland(string $island_id, IslandContextProviderInterface $host): ?IslandInterface {
    if (!in_array($island_id, $host->getIslandIds(), TRUE)) {
      return NULL;
    }
    $config = $host->getIslandConfiguration($island_id);
    $config['contexts']['host'] = $host;
    $config['contexts']['placement_id'] = $island_id;
    try {
      $island = $this->islandManager->createInstance($this->hostResolver->pluginId($island_id, $host), $config);
    }
    catch (PluginException) {
      return NULL;
    }
    return $island instanceof IslandInterface ? $island : NULL;
  }

}
