<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Link\LinkKind;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies bb_ticket derives each link's kind into options.bakers at save.
 *
 * The kind is classified from the URI by LinkKind and stored in the link
 * item's options blob under options.bakers.kind. Pre-existing options survive
 * and re-saving is idempotent.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbTicketLinkPresaveTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership',
      'bb_group',
      'bb_project',
      'bb_conductor',
      'bb_ticket',
      'bb_comment',
      'bb_run',
      'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
  }

  /**
   * Saving derives options.bakers.kind per link and preserves existing options.
   */
  public function testDerivesKindPreservingOptions(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $ticket = $storage->create([
      'identifier' => 'bakers-t1',
      'title' => 'T',
      'workflow' => 'bb_work',
      'links' => [
        [
          'uri' => 'https://git.key-tec.de/g/p/-/merge_requests/42',
          'title' => 'MR',
          'options' => ['attributes' => ['x' => 1]],
        ],
        ['uri' => 'https://git.key-tec.de/g/p/-/tree/main', 'title' => 'Branch'],
        ['uri' => 'https://example.com/spec.pdf', 'title' => 'Doc'],
        ['uri' => 'https://acme.slack.com/archives/C0123ABCD/p1700000000000100', 'title' => 'Slack thread'],
      ],
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();

    $reloaded = $storage->loadUnchanged($ticket->id());
    assert($reloaded instanceof BbTicketInterface);
    $items = $reloaded->get('links');

    $this->assertSame(LinkKind::MR, $items[0]->get('options')->getValue()['bakers']['kind']);
    // Pre-existing options are preserved.
    $this->assertSame(1, $items[0]->get('options')->getValue()['attributes']['x']);
    $this->assertSame(LinkKind::BRANCH, $items[1]->get('options')->getValue()['bakers']['kind']);
    $this->assertSame(LinkKind::DOC, $items[2]->get('options')->getValue()['bakers']['kind']);
    $this->assertSame(LinkKind::CHAT, $items[3]->get('options')->getValue()['bakers']['kind']);
  }

  /**
   * Identical link URIs are de-duplicated at save (first occurrence wins).
   */
  public function testDeduplicatesIdenticalUris(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $ticket = $storage->create([
      'identifier' => 'bakers-dedup',
      'title' => 'T',
      'workflow' => 'bb_work',
      'links' => [
        ['uri' => 'https://git.key-tec.de/g/p/-/merge_requests/42', 'title' => 'MR'],
        ['uri' => 'https://example.com/spec.pdf', 'title' => 'Doc'],
        // Duplicate of the MR — must be dropped, keeping the first.
        ['uri' => 'https://git.key-tec.de/g/p/-/merge_requests/42', 'title' => 'MR again'],
      ],
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();

    $reloaded = $storage->loadUnchanged($ticket->id());
    assert($reloaded instanceof BbTicketInterface);
    $values = $reloaded->get('links')->getValue();
    $this->assertCount(2, $values);
    $this->assertSame('https://git.key-tec.de/g/p/-/merge_requests/42', $values[0]['uri']);
    $this->assertSame('MR', $values[0]['title']);
    $this->assertSame('https://example.com/spec.pdf', $values[1]['uri']);
  }

  /**
   * Re-saving is idempotent: kind stays correct, no nesting drift.
   */
  public function testResaveIsIdempotent(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $ticket = $storage->create([
      'identifier' => 'bakers-t2',
      'title' => 'T2',
      'workflow' => 'bb_work',
      'links' => [
        ['uri' => 'https://git.key-tec.de/g/p/-/merge_requests/7', 'title' => 'MR'],
      ],
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    $ticket->save();

    $reloaded = $storage->loadUnchanged($ticket->id());
    assert($reloaded instanceof BbTicketInterface);
    $items = $reloaded->get('links');
    $this->assertSame(['kind' => LinkKind::MR], $items[0]->get('options')->getValue()['bakers']);
  }

}
