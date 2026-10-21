<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_addon\Kernel;

use Drupal\Core\Session\AnonymousUserSession;
use Drupal\bb_addon\AddonReadModel;
use Drupal\bb_addon\Entity\BbAddonInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_inbox\Kernel\InboxWorldTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The personal-latest read model (BB-661 AC-3/AC-4).
 *
 * `AddonReadModel::entry()` must show the signed-in requester's own newest
 * request, never another requester's, and never fall back when this
 * requester has sent none — even when a different requester's answer is
 * strictly newer.
 */
#[Group('bb_addon')]
#[RunTestsInSeparateProcesses]
final class AddonPersonalReadModelTest extends KernelTestBase {

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
   * An older request finishing later does not replace the newer one's cell.
   */
  public function testOwnLatestSurvivesAnOlderRequestFinishingLater(): void {
    $addon = $this->theAddon();
    $a1 = $this->send($this->guest, 'ports.up', ['port' => 443]);
    $a2 = $this->send($this->guest, 'ports.down', ['port' => 443]);
    // A1 (older, by id) finishes AFTER A2 (newer) — must not become "latest".
    self::assertSame([], $this->writeResult($a2, 'done', ['markdown' => 'stopped']));
    self::assertSame([], $this->writeResult($a1, 'done', ['markdown' => 'shared']));

    $entry = $this->readModel()->entry($this->ticket, $addon, $this->guest);
    self::assertSame('down', $entry['latest']['action']);
    self::assertSame($a2->uuid(), $entry['latest']['id']);
  }

  /**
   * B sending a newer request never replaces A's own latest, and vice versa.
   */
  public function testTwoRequestersSeeOnlyTheirOwn(): void {
    $addon = $this->theAddon();
    $this->send($this->guest, 'ports.up', ['port' => 443]);
    // Contributor (a different requester) sends a strictly newer request.
    $this->send($this->contributor, 'ports.up', ['port' => 8080]);

    $forGuest = $this->readModel()->entry($this->ticket, $addon, $this->guest);
    $forContributor = $this->readModel()->entry($this->ticket, $addon, $this->contributor);
    self::assertSame('up', $forGuest['latest']['action']);
    self::assertSame('up', $forContributor['latest']['action']);
    self::assertNotSame($forGuest['latest']['id'], $forContributor['latest']['id']);
  }

  /**
   * A requester with no own message sees an empty state, never another's.
   */
  public function testNoOwnMessageNeverFallsBackToAnothersAnswer(): void {
    $addon = $this->theAddon();
    $this->send($this->guest, 'ports.up', ['port' => 443]);

    $entry = $this->readModel()->entry($this->ticket, $addon, $this->contributor);
    self::assertNull($entry['latest']);
  }

  /**
   * Anonymous never resolves a personal latest.
   */
  public function testAnonymousHasNoPersonalLatest(): void {
    $addon = $this->theAddon();
    $this->send($this->guest, 'ports.up', ['port' => 443]);
    $anonymous = new AnonymousUserSession();
    $entry = $this->readModel()->entry($this->ticket, $addon, $anonymous);
    self::assertNull($entry['latest']);
  }

  /**
   * The read model under test.
   */
  private function readModel(): AddonReadModel {
    return $this->container->get('bb_addon.read_model');
  }

  /**
   * The registered ports addon.
   */
  private function theAddon(): BbAddonInterface {
    $addons = $this->container->get('entity_type.manager')->getStorage('bb_addon')->loadByProperties(['name' => 'ports']);
    $addon = reset($addons);
    self::assertInstanceOf(BbAddonInterface::class, $addon);
    return $addon;
  }

}
