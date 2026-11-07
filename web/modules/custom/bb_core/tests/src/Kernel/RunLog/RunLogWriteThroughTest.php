<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\RunLog;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\file\FileInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\RunLog\RunLogException;
use Drupal\Tests\bb_core\Kernel\WorkspaceFixtureTrait;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Proves bb_run's preSave() write-through moves log payloads to files.
 */
#[Group('bb_core')]
final class RunLogWriteThroughTest extends KernelTestBase {

  use WorkspaceFixtureTrait;

  /**
   * Modules to enable.
   *
   * @var array<int, string>
   */
  protected static $modules = [
    'system', 'field', 'file', 'image', 'og', 'bb_core', 'state_machine', 'entity',
    'user', 'options', 'text', 'link', 'filter',
  ];

  /**
   * {@inheritdoc}
   *
   * Core's own service provider only registers the `private` stream wrapper
   * when `file_private_path` is already set at container-build time
   * (`CoreServiceProvider::register()`), which is before this test's setUp()
   * gets a chance to call setSetting(). Registering it directly here mirrors
   * core's own `Drupal\KernelTests\Core\File\FileTestBase`.
   */
  public function register(ContainerBuilder $container): void {
    parent::register($container);
    $container->register('stream_wrapper.private', 'Drupal\Core\StreamWrapper\PrivateStream')
      ->addTag('stream_wrapper', ['scheme' => 'private']);
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->allowRunLogStorage();
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_group');
    $this->installEntitySchema('bb_project');
    $this->installEntitySchema('bb_ticket');
    $this->installEntitySchema('bb_run');
    $this->installEntitySchema('file');
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installSchema('file', ['file_usage']);
    $this->installConfig(['filter']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
  }

  /**
   * Saving a log clears the raw field and fills in the file reference.
   */
  public function testSavingLogClearsTheFieldAndFillsTheReference(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', "transcript\n")->save();
    $reloaded = $this->reload($run);
    self::assertNull($reloaded->get('log')->value);
    self::assertNotNull($reloaded->get('log_file')->target_id);
    self::assertSame(hash('sha256', "transcript\n"), $reloaded->get('log_sha256')->value);
    self::assertSame(11, (int) $reloaded->get('log_bytes')->value);
  }

  /**
   * ReadLog() returns the payload the write-through stored.
   */
  public function testReadLogReturnsThePayload(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', "transcript\n")->save();
    self::assertSame("transcript\n", $this->reload($run)->readLog());
  }

  /**
   * Appending to a log reads the existing payload then rewrites the file.
   */
  public function testAppendReadsThenRewrites(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', "first\n")->save();
    $reloaded = $this->reload($run);
    $reloaded->set('log', $reloaded->readLog() . "second\n")->save();
    self::assertSame("first\nsecond\n", $this->reload($run)->readLog());
  }

  /**
   * Error_log takes the same write-through path as log.
   */
  public function testErrorLogTakesTheSamePath(): void {
    $run = $this->createRunInWorkspace();
    $run->set('error_log', 'dispatch failed')->save();
    self::assertNull($this->reload($run)->get('error_log')->value);
    self::assertSame('dispatch failed', $this->reload($run)->readErrorLog());
  }

  /**
   * Resaving a run without changing its log does not rewrite the file.
   */
  public function testResavingWithoutChangeDoesNotRewriteTheFile(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', "transcript\n")->save();
    $first = $this->reload($run)->get('log_file')->target_id;
    $again = $this->reload($run);
    $again->set('state', 'running')->save();
    self::assertSame($first, $this->reload($run)->get('log_file')->target_id);
  }

  /**
   * Writing an empty log is a no-op — no file is created.
   */
  public function testEmptyLogWriteIsNoOp(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', '')->save();
    self::assertNull($this->reload($run)->get('log_file')->target_id);
  }

  /**
   * Reading a log with no file reference returns null.
   */
  public function testReadingWithNoFileReturnsNull(): void {
    self::assertNull($this->createRunInWorkspace()->readLog());
  }

  /**
   * A second, genuinely different save deletes the file it superseded.
   *
   * BB-556 finding 4: `RunLogStore::write()` creates a NEW file every time
   * a changed payload is saved (e.g. appendRunNote()'s read-modify-write) and
   * repoints `log_file` at it, but nothing used to delete the PREVIOUS file
   * — and with no `file_usage` record, core's normal temporary-file cleanup
   * can never find it either, so the private volume grew by one orphan per
   * rewrite. Two successive saves with different payloads must leave exactly
   * one `file` entity for this run's `log_file`, holding the LATEST payload.
   */
  public function testRewritingTheLogDeletesTheSupersededFile(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', "first\n")->save();
    $first_file_id = (int) $this->reload($run)->get('log_file')->target_id;

    $reloaded = $this->reload($run);
    $reloaded->set('log', "second\n")->save();
    $second_file_id = (int) $this->reload($run)->get('log_file')->target_id;

    self::assertNotSame($first_file_id, $second_file_id);
    $file_storage = $this->container->get('entity_type.manager')->getStorage('file');
    self::assertNull($file_storage->load($first_file_id));
    self::assertNotNull($file_storage->load($second_file_id));
    self::assertSame("second\n", $this->reload($run)->readLog());
  }

  /**
   * The deferred unlink: deleting a run deletes its log files with it.
   *
   * `log`/`error_log` carry no `file_usage` record (the write-through path
   * never registers one — same reason
   * `testRewritingTheLogDeletesTheSupersededFile()` gives), so core's own
   * temporary-file cleanup can never find or reap them once the run that
   * referenced them is gone. Without `BbRun::postDelete()` deleting them
   * explicitly, a deleted run's captured transcript and error log would sit
   * on the private volume forever with no entity left to name them.
   */
  public function testDeletingRunDeletesItsLogFiles(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', "transcript\n")->save();
    $run->set('error_log', "boom\n")->save();
    $reloaded = $this->reload($run);
    $log_file_id = (int) $reloaded->get('log_file')->target_id;
    $error_log_file_id = (int) $reloaded->get('error_log_file')->target_id;
    self::assertNotSame(0, $log_file_id);
    self::assertNotSame(0, $error_log_file_id);

    $reloaded->delete();

    $file_storage = $this->container->get('entity_type.manager')->getStorage('file');
    self::assertNull($file_storage->load($log_file_id), 'The transcript file is deleted with the run.');
    self::assertNull($file_storage->load($error_log_file_id), 'The error log file is deleted with the run.');
  }

  /**
   * Deleting a run with no captured log deletes nothing and does not error.
   */
  public function testDeletingRunWithNoCapturedLogIsNoOp(): void {
    $run = $this->createRunInWorkspace();
    $id = (int) $run->id();
    $run->delete();
    self::assertNull(
      $this->container->get('entity_type.manager')->getStorage('bb_run')->load($id),
      'The run itself is gone, with no exception on the absent log_file/error_log_file reference.',
    );
  }

  /**
   * Warning appended when a transcript upload is omitted for size.
   */
  private const OMISSION_WARNING = 'Transcript upload omitted because the run-log upload exceeded a size limit.';

  /**
   * An omitted upload keeps original diagnostics and appends the warning once.
   */
  public function testOmittedUploadAppendsTheFixedWarning(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', "transcript line\n")->save();
    $run->set('error_log', "dispatch failed\nsee transcript for details\n")
      ->save();

    $reloaded = $this->reload($run);
    $reloaded->set('closed', TRUE);
    $reloaded->set('log_upload_omitted', TRUE);
    $reloaded->save();

    $saved = $this->reload($run);
    self::assertTrue((bool) $saved->get('closed')->value);
    self::assertFalse((bool) $saved->get('log_upload_omitted')->value);
    self::assertSame("transcript line\n", $saved->readLog());
    self::assertSame(
      "dispatch failed\nsee transcript for details\n" . self::OMISSION_WARNING,
      $saved->readErrorLog(),
    );
    self::assertSame(
      1,
      substr_count((string) $saved->readErrorLog(), self::OMISSION_WARNING),
    );
  }

  /**
   * Saving the omission flag again does not duplicate the warning line.
   */
  public function testRepeatedOmissionFlagDoesNotDuplicateTheWarning(): void {
    $run = $this->createRunInWorkspace();
    $run->set('error_log', "dispatch failed\n")->save();
    $once = $this->reload($run);
    $once->set('closed', TRUE);
    $once->set('log_upload_omitted', TRUE);
    $once->save();

    $again = $this->reload($run);
    $again->set('closed', TRUE);
    $again->set('log_upload_omitted', TRUE);
    $again->save();

    $saved = $this->reload($run);
    self::assertSame(
      "dispatch failed\n" . self::OMISSION_WARNING,
      $saved->readErrorLog(),
    );
    self::assertSame(
      1,
      substr_count((string) $saved->readErrorLog(), self::OMISSION_WARNING),
    );
  }

  /**
   * An unreadable existing error log fails the save; the close stays unsaved.
   */
  public function testUnreadableErrorLogLeavesTheCloseUnsaved(): void {
    $run = $this->createRunInWorkspace();
    $run->set('error_log', "dispatch failed\n")->save();
    $reloaded = $this->reload($run);
    $file = $reloaded->get('error_log_file')->entity;
    self::assertInstanceOf(FileInterface::class, $file);
    file_put_contents($file->getFileUri(), 'this is not gzip');

    $reloaded->set('closed', TRUE);
    $reloaded->set('log_upload_omitted', TRUE);
    try {
      $reloaded->save();
      self::fail('Omitted close with an unreadable error log must fail.');
    }
    catch (EntityStorageException $e) {
      self::assertInstanceOf(RunLogException::class, $e->getPrevious());
    }

    $saved = $this->reload($run);
    self::assertFalse((bool) $saved->get('closed')->value);
    self::assertFalse((bool) $saved->get('log_upload_omitted')->value);
  }

  /**
   * An unwritable error-log store fails the save and leaves the close unsaved.
   */
  public function testUnwritableErrorLogLeavesTheCloseUnsaved(): void {
    $run = $this->createRunInWorkspace();
    $run->set('error_log', "dispatch failed\n")->save();
    $reloaded = $this->reload($run);
    $file = $reloaded->get('error_log_file')->entity;
    self::assertInstanceOf(FileInterface::class, $file);
    $realpath = $this->container->get('file_system')
      ->realpath($file->getFileUri());
    self::assertNotFalse($realpath);
    $directory = dirname($realpath);
    chmod($directory, 0555);
    try {
      $reloaded->set('closed', TRUE);
      $reloaded->set('log_upload_omitted', TRUE);
      try {
        $reloaded->save();
        self::fail('Omitted close with an unwritable error log must fail.');
      }
      catch (EntityStorageException $e) {
        self::assertInstanceOf(RunLogException::class, $e->getPrevious());
      }
    }
    finally {
      chmod($directory, 0755);
    }

    $saved = $this->reload($run);
    self::assertFalse((bool) $saved->get('closed')->value);
    self::assertSame("dispatch failed\n", $saved->readErrorLog());
  }

  /**
   * A large preexisting error log is read locally, not sent on the fallback.
   */
  public function testLargePreexistingErrorLogStaysLocal(): void {
    $run = $this->createRunInWorkspace();
    $existing = str_repeat("diagnostic line\n", 20000);
    $run->set('error_log', $existing)->save();
    self::assertGreaterThan(
      200000,
      (int) $this->reload($run)->get('error_log_bytes')->value,
    );

    $reloaded = $this->reload($run);
    $reloaded->set('closed', TRUE);
    $reloaded->set('log_upload_omitted', TRUE);
    $reloaded->save();

    $saved = $this->reload($run);
    self::assertSame(
      $existing . self::OMISSION_WARNING,
      $saved->readErrorLog(),
    );
    self::assertTrue((bool) $saved->get('closed')->value);
  }

  /**
   * The omission flag with a new log or error_log payload is rejected first.
   */
  public function testOmissionFlagWithPayloadIsRejected(): void {
    $run = $this->createRunInWorkspace();
    $run->set('error_log', "dispatch failed\n")->save();
    $reloaded = $this->reload($run);
    $reloaded->set('closed', TRUE);
    $reloaded->set('log_upload_omitted', TRUE);
    $reloaded->set('log', 'should not land');
    $violations = $reloaded->validate();
    self::assertGreaterThan(0, $violations->count());
    self::assertGreaterThan(
      0,
      count($violations->getByField('log_upload_omitted')),
    );

    $again = $this->reload($run);
    $again->set('closed', TRUE);
    $again->set('log_upload_omitted', TRUE);
    $again->set('error_log', 'replacement diagnostics');
    self::assertGreaterThan(0, $again->validate()->count());
    self::assertFalse((bool) $this->reload($run)->get('closed')->value);
    self::assertSame("dispatch failed\n", $this->reload($run)->readErrorLog());
    self::assertNull($this->reload($run)->readLog());
  }

  /**
   * The omission flag on a non-closing write is rejected before mutation.
   */
  public function testOmissionFlagOnNonClosingWriteIsRejected(): void {
    $run = $this->createRunInWorkspace();
    $run->set('error_log', "dispatch failed\n")->save();
    $reloaded = $this->reload($run);
    $reloaded->set('log_upload_omitted', TRUE);
    $violations = $reloaded->validate();
    self::assertGreaterThan(0, $violations->count());
    self::assertGreaterThan(
      0,
      count($violations->getByField('log_upload_omitted')),
    );
    self::assertFalse((bool) $this->reload($run)->get('closed')->value);
    self::assertSame("dispatch failed\n", $this->reload($run)->readErrorLog());
  }

  /**
   * Reloads a run from storage.
   */
  private function reload(BbRunInterface $run): BbRunInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $storage->resetCache([$run->id()]);
    $reloaded = $storage->load($run->id());
    self::assertInstanceOf(BbRunInterface::class, $reloaded);
    return $reloaded;
  }

}
