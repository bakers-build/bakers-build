<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\bb_activity\Activity\FeedMessage;
use Drupal\bb_activity\Entity\BbActivity;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A kind added as one class in a module is recorded, worded and mailed.
 *
 * The test module bb_activity_test adds `test_default_on` as one kind class
 * that names its trigger and nothing else.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class NewActivityKindTest extends ActivityMailKernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'file', 'image', 'serialization', 'jsonapi',
    'bb_core', 'bb_activity', 'bb_activity_test',
  ];

  /**
   * The new kind writes its row and its message reaches who ticked it.
   */
  public function testNewKindIsRecordedWordedAndMailedWithoutOtherChanges(): void {
    $watcher = $this->recipient('a', 'watcher-a');
    $this->tick($watcher, ['test_default_on']);
    $this->container->get('state')->set('bb_activity_test.record', TRUE);

    $this->ticket('a')->set('title', 'touched')->save();

    $storage = $this->container->get('entity_type.manager')->getStorage('bb_activity');
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('ticket_id', $this->ticket('a')->id())
      ->condition('kind', 'test_default_on')
      ->execute();
    self::assertCount(1, $ids);
    $row = $storage->load(reset($ids));
    self::assertInstanceOf(BbActivity::class, $row);
    $kind = $this->container->get('plugin.manager.bb_activity_kind')->forActivity($row);
    self::assertNotNull($kind);
    $feed = $kind->messages($row, $watcher, 'en')[0];
    self::assertInstanceOf(FeedMessage::class, $feed);
    self::assertSame('did a test thing', $feed->statement);
    $mails = $this->mailsTo($watcher);
    self::assertCount(1, $mails);
    self::assertStringContainsString('A test activity happened', (string) $mails[0]->getSubject());
  }

}
