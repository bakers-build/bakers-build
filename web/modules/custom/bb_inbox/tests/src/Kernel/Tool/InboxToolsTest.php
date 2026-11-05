<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_inbox\Kernel\Tool;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Session\AccountInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_inbox\Kernel\InboxWorldTrait;
use Drupal\bb_inbox\Entity\BbInboxMessageInterface;
use Drupal\tool\FormattedToolResultInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Sends and reads inbox messages through the tools the MCP bridge runs.
 */
#[Group('bb_inbox')]
#[RunTestsInSeparateProcesses]
final class InboxToolsTest extends KernelTestBase {

  use InboxWorldTrait {
    register as worldRegister;
  }

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'file', 'image',
    'serialization', 'jsonapi', 'jsonapi_resources', 'tool',
    'bb_core', 'bb_inbox', 'bb_inbox_test',
  ];

  /**
   * {@inheritdoc}
   */
  public function register(ContainerBuilder $container): void {
    $this->worldRegister($container);
    // No conductor answers in a kernel test; return without waiting.
    $container->setParameter('bb_inbox.send_wait_seconds', 0);
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->buildInboxWorld();
  }

  /**
   * A viewer sends a message and gets its id and pending status.
   */
  public function testSendReturnsPending(): void {
    $out = $this->outputs($this->runAs($this->guest, 'bakers_inbox_send', [
      'ticket' => $this->ticket->getIdentifier(),
      'message' => 'test.echo',
      'payload' => ['text' => 'hi'],
    ]));
    self::assertSame('pending', $out['status']);
    self::assertSame('', $out['markdown']);
    $message = $this->messageByUuid($out['id']);
    self::assertSame('test.echo', $message->messageId());
    self::assertSame(['text' => 'hi'], $message->payload());
    self::assertSame((int) $this->guest->id(), (int) $message->get('requested_by')->target_id);
  }

  /**
   * The sender's refusals come back as tool errors.
   */
  public function testSendRefusals(): void {
    $send = fn (AccountInterface $account, string $message, array $payload = []) => $this->runAs($account, 'bakers_inbox_send', [
      'ticket' => $this->ticket->uuid(),
      'message' => $message,
      'payload' => $payload,
    ]);
    $this->assertFailure($send($this->guest, 'test.echo', ['deny' => TRUE]), 'payload.deny');
    $this->assertFailure($send($this->guest, 'nobody.x'), 'no handler for message nobody.x');
    $this->assertFailure($send($this->guest, 'test.echo', ['bad' => TRUE]), 'payload.bad');
    $this->assertFailure($send($this->outsider, 'test.echo'), 'is not readable');

    $this->ticket->set('conductor_id', NULL)->save();
    $this->assertFailure($send($this->guest, 'test.echo'), 'has no conductor');
  }

  /**
   * Reading returns status and answer; others cannot tell it exists.
   */
  public function testRead(): void {
    $message = $this->send($this->guest, 'test.echo');
    self::assertSame([], $this->writeResult($message, 'running', NULL));
    self::assertSame([], $this->writeResult($message, 'done', ['markdown' => 'web: shared at https://x']));

    $out = $this->outputs($this->runAs($this->guest, 'bakers_inbox_read', ['message' => $message->uuid()]));
    self::assertSame(['id' => $message->uuid(), 'status' => 'done', 'markdown' => 'web: shared at https://x'], $out);

    $denied = $this->runAs($this->outsider, 'bakers_inbox_read', ['message' => $message->uuid()]);
    $unknown = $this->runAs($this->guest, 'bakers_inbox_read', ['message' => '00000000-0000-4000-8000-000000000000']);
    $this->assertFailure($denied, 'not found');
    self::assertSame(
      str_replace($message->uuid(), 'X', (string) $denied->getMessage()),
      str_replace('00000000-0000-4000-8000-000000000000', 'X', (string) $unknown->getMessage()),
    );
  }

  /**
   * Runs a tool as the given account through the runner the MCP bridge uses.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The caller.
   * @param string $id
   *   The tool plugin id.
   * @param array<string, mixed> $values
   *   Input values.
   */
  private function runAs(AccountInterface $account, string $id, array $values): FormattedToolResultInterface {
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($account);
    try {
      return $this->container->get('tool.runner')->run($id, $values)->getFormattedResult();
    }
    finally {
      $switcher->switchBack();
    }
  }

  /**
   * The successful result's outputs.
   *
   * @return array<string, mixed>
   *   Outputs keyed by name.
   */
  private function outputs(FormattedToolResultInterface $result): array {
    self::assertTrue($result->isSuccess(), (string) $result->getMessage());
    return $result->getContextValues();
  }

  /**
   * Asserts a failed result whose message contains the given text.
   */
  private function assertFailure(FormattedToolResultInterface $result, string $text): void {
    self::assertFalse($result->isSuccess());
    self::assertStringContainsString($text, (string) $result->getMessage());
  }

  /**
   * Loads a message by UUID.
   */
  private function messageByUuid(string $uuid): BbInboxMessageInterface {
    $found = $this->container->get('entity_type.manager')->getStorage('bb_inbox_message')->loadByProperties(['uuid' => $uuid]);
    $message = reset($found);
    self::assertInstanceOf(BbInboxMessageInterface::class, $message);
    return $message;
  }

}
