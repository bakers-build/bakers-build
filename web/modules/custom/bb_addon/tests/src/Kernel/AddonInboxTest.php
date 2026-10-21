<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_addon\Kernel;

use Drupal\Core\Access\AccessException;
use Drupal\bb_addon\Entity\BbAddonInterface;
use Drupal\bb_inbox\InboxRejected;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_inbox\Kernel\InboxWorldTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The addon module is the responsible inbox handler for `<addon>.<action>`.
 */
#[Group('bb_addon')]
#[RunTestsInSeparateProcesses]
final class AddonInboxTest extends KernelTestBase {

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
   * A guest may send a view-access action; the addon version is recorded.
   */
  public function testResponsibleAddonClaimsAndSetsVersion(): void {
    $message = $this->reloadMessage($this->send($this->guest, 'ports.up', ['port' => 443]));
    self::assertSame('pending', $message->status());
    self::assertSame('1.2.3', $message->get('version')->value);
  }

  /**
   * Extra or mistyped payload keys are rejected.
   */
  public function testPayloadRejectsExtraAndMistypedKeys(): void {
    foreach ([['port' => '443'], ['port' => 443, 'url' => 'http://x'], []] as $payload) {
      try {
        $this->send($this->guest, 'ports.up', $payload);
        self::fail('Payload ' . json_encode($payload) . ' must be rejected.');
      }
      catch (InboxRejected) {
      }
    }
  }

  /**
   * An update-access action is refused to a guest and allowed to an editor.
   */
  public function testUpdateAccessActionDeniedToViewer(): void {
    try {
      $this->send($this->guest, 'ports.reap');
      self::fail('A guest must not reap.');
    }
    catch (AccessException) {
    }
    self::assertSame('pending', $this->send($this->contributor, 'ports.reap')->status());
  }

  /**
   * Unknown actions and addons the conductor does not run have no handler.
   */
  public function testUnknownActionAndForeignConductorRejected(): void {
    foreach (['ports.nope', 'other.up'] as $id) {
      try {
        $this->send($this->guest, $id, ['port' => 443]);
        self::fail("$id must have no handler.");
      }
      catch (InboxRejected $e) {
        self::assertStringContainsString("no handler for message $id", $e->getMessage());
      }
    }
    $this->ticket->set('conductor_id', $this->createConductor('node-without-ports', $this->conductorOwner)->id())->save();
    $this->expectException(InboxRejected::class);
    $this->expectExceptionMessage('no handler for message ports.up');
    $this->send($this->guest, 'ports.up', ['port' => 443]);
  }

  /**
   * A message whose addon the conductor no longer runs can still be failed.
   */
  public function testMessageWithoutHandlerCanBeFailed(): void {
    $message = $this->send($this->guest, 'ports.up', ['port' => 443]);
    $addons = $this->container->get('entity_type.manager')->getStorage('bb_addon')->loadMultiple();
    foreach ($addons as $addon) {
      self::assertInstanceOf(BbAddonInterface::class, $addon);
      $addon->removeConductor($this->conductor)->save();
    }
    self::assertNotSame([], $this->writeResult($message, 'running', NULL), 'Nobody may claim it running.');
    $message = $this->reloadMessage($message);
    $failed = ['markdown' => 'no handler for message ports.up'];
    self::assertSame([], $this->writeResult($message, 'failed', $failed));
  }

  /**
   * A done result must follow the `{markdown}` result contract.
   */
  public function testResultValidatedAgainstAddonResult(): void {
    $message = $this->send($this->guest, 'ports.up', ['port' => 443]);
    self::assertNotSame([], $this->writeResult($message, 'done', ['rows' => []]));
    $message = $this->reloadMessage($message);
    self::assertSame([], $this->writeResult($message, 'done', ['markdown' => 'Shared: https://x.trycloudflare.com']));
  }

  /**
   * A contract-2 message claims, allows a guest and validates its result.
   *
   * The result must be `{markdown}`, not the retired message/level/rows shape.
   */
  public function testV2MessageClaimsAccessAndValidatesMarkdownResult(): void {
    $v2 = [
      'name' => 'ports',
      'version' => '2.0.0',
      'contract' => 2,
      'label' => 'Ports',
      'messages' => ['tunnel' => ['label' => 'Tunnel-Links bereitstellen', 'access' => 'view']],
    ];
    // Route the ticket to a fresh conductor running only the v2 addon.
    $v2Conductor = $this->createConductor('node-v2-ticket', $this->conductorOwner);
    $this->storeAddon($v2, [$v2Conductor]);
    $this->ticket->set('conductor_id', $v2Conductor->id())->save();

    $message = $this->reloadMessage($this->send($this->guest, 'ports.tunnel'));
    self::assertSame('pending', $message->status());
    self::assertSame('2.0.0', $message->get('version')->value);

    self::assertNotSame([], $this->writeResult($message, 'done', ['rows' => []]), 'The retired rows shape is rejected for a v2 message.');
    $message = $this->reloadMessage($message);
    self::assertSame([], $this->writeResult($message, 'done', ['markdown' => '- [443](https://preview.example.test)']));
  }

}
