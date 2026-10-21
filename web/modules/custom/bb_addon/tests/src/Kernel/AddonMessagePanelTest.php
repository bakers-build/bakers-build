<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_addon\Kernel;

use Drupal\Core\Access\AccessException;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\bb_addon\Controller\TicketAddonsController;
use Drupal\bb_addon\Plugin\Island\AddonPanelIsland;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_inbox\Entity\BbInboxMessageInterface;
use Drupal\bb_inbox\Resource\InboxPendingResource;
use Drupal\jsonapi\JsonApiResource\ResourceObject;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_inbox\Kernel\InboxWorldTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\DomCrawler\Crawler;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * The contract-2 addon panel: MessageForms and the requester's own answer.
 */
#[Group('bb_addon')]
#[RunTestsInSeparateProcesses]
final class AddonMessagePanelTest extends KernelTestBase {

  use AddonFixtureTrait;
  use InboxWorldTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'og', 'file', 'image',
    'serialization', 'jsonapi', 'jsonapi_resources',
    'island', 'ui_patterns', 'markdown_easy',
    'bb_core', 'bb_inbox', 'bb_addon',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->buildInboxWorld();
    $this->installEntitySchema('bb_addon');
    $this->installConfig(['system', 'filter', 'bb_core']);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $request = Request::create('/');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $this->storeAddon([
      'name' => 'demo',
      'version' => '1.0.0',
      'contract' => 2,
      'label' => 'Demo',
      'messages' => [
        'tunnel' => ['label' => 'Share tunnels', 'access' => 'view'],
      ],
    ], [$this->conductor]);
  }

  /**
   * Opening the panel with no own message yet shows the explicit empty state.
   */
  public function testEmptyStateBeforeAnyMessage(): void {
    $page = new Crawler($this->renderOverlay($this->guest, 'demo'));
    self::assertStringContainsString('You have not sent a message to this addon.', $page->text());
  }

  /**
   * A parameterless view message renders as a button, never a form.
   */
  public function testParameterlessMessageIsButtonNotForm(): void {
    $page = new Crawler($this->renderOverlay($this->guest, 'demo'));
    self::assertCount(0, $page->filter('form'));
    self::assertStringContainsString('Share tunnels', $page->text());
  }

  /**
   * A done answer renders its Markdown as formatted content, not raw text.
   */
  public function testAnswerRendersMarkdownAsFormattedContent(): void {
    $message = $this->send($this->guest, 'demo.tunnel');
    self::assertSame([], $this->writeResult($message, 'done', ['markdown' => "- [443](https://preview.example.test)\n"]));
    $page = new Crawler($this->renderOverlay($this->guest, 'demo'));
    self::assertCount(1, $page->filter('a[href="https://preview.example.test"]'));
    self::assertStringNotContainsString('[443]', $page->text());
  }

  /**
   * An empty markdown answer renders explicit text, not a blank panel.
   */
  public function testEmptyAnswerRendersExplicitText(): void {
    $message = $this->send($this->guest, 'demo.tunnel');
    self::assertSame([], $this->writeResult($message, 'done', ['markdown' => '']));
    $page = new Crawler($this->renderOverlay($this->guest, 'demo'));
    self::assertStringContainsString('Completed without a response.', $page->text());
  }

  /**
   * B's newer answer never replaces A's own, and vice versa.
   */
  public function testOwnLatestNeverReplacedByAnotherRequester(): void {
    $a = $this->send($this->guest, 'demo.tunnel');
    self::assertSame([], $this->writeResult($a, 'done', ['markdown' => 'A answer']));
    $b = $this->send($this->contributor, 'demo.tunnel');
    self::assertSame([], $this->writeResult($b, 'done', ['markdown' => 'B answer']));

    $forGuest = new Crawler($this->renderOverlay($this->guest, 'demo'));
    self::assertStringContainsString('A answer', $forGuest->text());
    self::assertStringNotContainsString('B answer', $forGuest->text());

    $forContributor = new Crawler($this->renderOverlay($this->contributor, 'demo'));
    self::assertStringContainsString('B answer', $forContributor->text());
    self::assertStringNotContainsString('A answer', $forContributor->text());
  }

  /**
   * Offline shows a notice and a disabled button instead of a live link.
   */
  public function testOfflineConductorDisablesTheButton(): void {
    $this->conductor->set('status', 'offline')->save();
    $page = new Crawler($this->renderOverlay($this->guest, 'demo'));
    self::assertStringContainsString('queued until it returns', $page->text());
    self::assertCount(0, $page->filter('[data-hx-post]'));
  }

  /**
   * An `update` message is not offered to, and refused for, a view-only guest.
   *
   * Replaces the deleted AddonOverlayTest's guest-vs-Reap coverage for
   * contract 2: the panel does not offer the message, the island refuses the
   * send action, a send forced past the island becomes an error message and
   * stores nothing, and anonymous is refused even a `view` message.
   */
  public function testUpdateMessageDeniedToGuestAndAnonymous(): void {
    $this->storeAddon([
      'name' => 'gate',
      'version' => '1.0.0',
      'contract' => 2,
      'label' => 'Gate',
      'messages' => ['reap' => ['label' => 'Reap tunnels', 'access' => 'update']],
    ], [$this->conductor]);
    $anonymous = new AnonymousUserSession();

    self::assertStringNotContainsString('Reap tunnels', (new Crawler($this->renderOverlay($this->guest, 'gate')))->text());
    self::assertStringContainsString('Reap tunnels', (new Crawler($this->renderOverlay($this->contributor, 'gate')))->text());

    $island = $this->panelIsland();
    $reap = $this->sendParameters('gate', 'reap');
    self::assertFalse($island->accessAction('send', $reap, $this->guest)->isAllowed());
    self::assertFalse($island->accessAction('send', $reap, $anonymous)->isAllowed());
    self::assertFalse($island->accessAction('send', $this->sendParameters('demo', 'tunnel'), $anonymous)->isAllowed());
    self::assertTrue($island->accessAction('send', $reap, $this->contributor)->isAllowed());

    $this->container->get('current_user')->setAccount($this->guest);
    $island->applyAction('send', $reap);
    self::assertSame(
      ['update access on the ticket is required for gate.reap'],
      array_map('strval', $this->container->get('messenger')->deleteByType('error')),
    );
    self::assertSame([], $this->messageIds());

    try {
      $this->send($anonymous, 'demo.tunnel');
      self::fail('Anonymous must not send a view message.');
    }
    catch (AccessException) {
    }
    self::assertSame([], $this->messageIds());
  }

  /**
   * Send, poll, running, done: the requester sees the answer, nobody else.
   *
   * The server side of AC-3/AC-4 end to end: the guest sends through the
   * panel's send action, the conductor owner polls the pending resource,
   * answers running then done, and the panel renders the Markdown for the
   * requester and the empty state for another member.
   */
  public function testSendPollAnswerRendersForRequesterOnly(): void {
    $this->installConfig(['jsonapi']);
    $island = $this->panelIsland();
    $parameters = $this->sendParameters('demo', 'tunnel');
    self::assertTrue($island->accessAction('send', $parameters, $this->guest)->isAllowed());
    $this->container->get('current_user')->setAccount($this->guest);
    $island->applyAction('send', $parameters);

    $ids = $this->messageIds();
    self::assertCount(1, $ids);
    $message = $this->container->get('entity_type.manager')->getStorage('bb_inbox_message')->load($ids[0]);
    self::assertInstanceOf(BbInboxMessageInterface::class, $message);
    self::assertSame(
      ['demo.tunnel', 'pending', (int) $this->guest->id()],
      [$message->messageId(), $message->status(), (int) $message->get('requested_by')->target_id],
    );
    self::assertCount(1, (new Crawler($this->renderOverlay($this->guest, 'demo')))->filter('[data-hx-trigger="every 3s"]'), 'The open message polls.');

    $this->container->get('current_user')->setAccount($this->conductorOwner);
    $pending = InboxPendingResource::create($this->container);
    $pending->setResourceResponseFactory($this->container->get('jsonapi_resources.resource_response_factory'));
    $pending->setDocumentExtractor($this->container->get('jsonapi_resources.document_extractor'));
    $object = $pending->process(Request::create('/', 'GET'), (string) $this->conductor->get('conductor_id')->value)
      ->getResponseData()->getData()->getIterator()->current();
    self::assertInstanceOf(ResourceObject::class, $object);
    self::assertSame([$message->uuid()], array_column($object->getField('messages'), 'id'));

    self::assertSame([], $this->writeResult($message, 'running', NULL));
    $message = $this->reloadMessage($message);
    self::assertSame([], $this->writeResult($message, 'done', ['markdown' => "- [443](https://preview.example.test)\n"]));

    $forGuest = new Crawler($this->renderOverlay($this->guest, 'demo'));
    self::assertCount(1, $forGuest->filter('a[href="https://preview.example.test"]'));
    self::assertCount(0, $forGuest->filter('[data-hx-trigger="every 3s"]'), 'A done message stops polling.');
    $forOther = new Crawler($this->renderOverlay($this->contributor, 'demo'));
    self::assertCount(0, $forOther->filter('a[href="https://preview.example.test"]'));
    self::assertStringContainsString('You have not sent a message to this addon.', $forOther->text());
  }

  /**
   * The addon panel island, as the island action route instantiates it.
   */
  private function panelIsland(): AddonPanelIsland {
    $island = $this->container->get('plugin.manager.island')->createInstance('addon_panel', [
      'contexts' => ['host' => $this->container->get('bb_addon.island_host'), 'placement_id' => 'addon_panel'],
    ]);
    self::assertInstanceOf(AddonPanelIsland::class, $island);
    return $island;
  }

  /**
   * The island send action's parameters for a parameterless message.
   *
   * @return array<string, string>
   *   The parameters.
   */
  private function sendParameters(string $addon, string $message): array {
    return ['ticket' => $this->ticket->uuid(), 'addon' => $addon, 'action' => $message, 'args' => '{}'];
  }

  /**
   * The ids of every stored inbox message.
   *
   * @return array<int>
   *   The ids.
   */
  private function messageIds(): array {
    $ids = $this->container->get('entity_type.manager')->getStorage('bb_inbox_message')
      ->getQuery()->accessCheck(FALSE)->execute();
    return array_map('intval', array_values($ids));
  }

  /**
   * Renders the overlay as the given account.
   */
  private function renderOverlay(AccountInterface $account, string $addon): string {
    $this->container->get('current_user')->setAccount($account);
    $build = TicketAddonsController::create($this->container)->overlay($this->reloadTicket(), $addon);
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Reloads the ticket, so a conductor change made after setUp() is seen.
   */
  private function reloadTicket(): BbTicketInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $storage->resetCache([$this->ticket->id()]);
    $ticket = $storage->load($this->ticket->id());
    assert($ticket instanceof BbTicketInterface);
    return $ticket;
  }

}
