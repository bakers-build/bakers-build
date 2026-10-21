<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_addon\Kernel;

use Drupal\Core\Session\AccountInterface;
use Drupal\bb_addon\Resource\TicketMessagesResource;
use Drupal\jsonapi\JsonApiResource\ResourceObject;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_inbox\Kernel\InboxWorldTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * The personal message history resource (BB-661 AC-4).
 */
#[Group('bb_addon')]
#[RunTestsInSeparateProcesses]
final class TicketMessagesResourceTest extends KernelTestBase {

  use AddonFixtureTrait;
  use InboxWorldTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'file', 'image',
    'serialization', 'jsonapi', 'jsonapi_resources',
    'bb_core', 'bb_inbox', 'bb_addon',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->buildInboxWorld();
    $this->installEntitySchema('bb_addon');
    $this->storeAddon(self::portsDefinition(), [$this->conductor]);
  }

  /**
   * Only this person's own messages are listed, newest first.
   */
  public function testListsOnlyOwnMessagesNewestFirst(): void {
    $this->send($this->guest, 'ports.up', ['port' => 443]);
    $this->send($this->guest, 'ports.down', ['port' => 443]);
    $this->send($this->contributor, 'ports.up', ['port' => 8080]);

    $messages = $this->history($this->guest)['messages'];
    self::assertCount(2, $messages);
    self::assertSame('ports.down', $messages[0]['message_id']);
    self::assertSame('ports.up', $messages[1]['message_id']);
  }

  /**
   * A requester with no messages sees an empty list, not an error.
   */
  public function testEmptyHistoryForRequesterWithNoMessages(): void {
    $this->send($this->guest, 'ports.up', ['port' => 443]);
    self::assertSame([], $this->history($this->contributor)['messages']);
  }

  /**
   * The `addon` filter narrows history to one addon name.
   */
  public function testAddonFilterNarrowsToOneAddon(): void {
    $this->send($this->guest, 'ports.up', ['port' => 443]);
    $messages = $this->history($this->guest, 'ports')['messages'];
    self::assertCount(1, $messages);
    $none = $this->history($this->guest, 'other')['messages'];
    self::assertSame([], $none);
  }

  /**
   * The `before` cursor pages to strictly older messages, none repeated.
   */
  public function testBeforeCursorPagesToOlderMessages(): void {
    $this->send($this->guest, 'ports.up', ['port' => 443]);
    $this->send($this->guest, 'ports.down', ['port' => 443]);
    $first = $this->history($this->guest)['messages'];
    self::assertCount(2, $first);
    $second = $this->history($this->guest, NULL, $first[1]['id'])['messages'];
    self::assertSame([], $second, 'Paging after the oldest message yields nothing further.');
    $page = $this->history($this->guest, NULL, $first[0]['id'])['messages'];
    self::assertSame([$first[1]], $page);
  }

  /**
   * Reads the history resource as the given account.
   *
   * @return array<string, mixed>
   *   The decoded `messages`.
   */
  private function history(AccountInterface $account, ?string $addon = NULL, ?string $before = NULL): array {
    $this->container->get('current_user')->setAccount($account);
    $query = array_filter(['addon' => $addon, 'before' => $before], static fn ($v) => $v !== NULL);
    $request = Request::create('/', 'GET', $query);
    $resource = TicketMessagesResource::create($this->container);
    $resource->setResourceResponseFactory($this->container->get('jsonapi_resources.resource_response_factory'));
    $resource->setDocumentExtractor($this->container->get('jsonapi_resources.document_extractor'));
    $response = $resource->process($request, $this->ticket);
    $object = $response->getResponseData()->getData()->getIterator()->current();
    self::assertInstanceOf(ResourceObject::class, $object);
    return ['messages' => $object->getField('messages')];
  }

}
