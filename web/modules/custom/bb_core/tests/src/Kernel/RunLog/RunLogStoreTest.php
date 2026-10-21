<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\RunLog;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\File\FileSystemInterface;
use Drupal\file\FileInterface;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\RunLog\RunLogException;
use Drupal\bb_core\RunLog\RunLogStore;
use Drupal\Tests\bb_core\Kernel\WorkspaceFixtureTrait;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Covers RunLogStore's write/read round trip and its per-workspace layout.
 */
#[Group('bb_core')]
final class RunLogStoreTest extends KernelTestBase {

  use WorkspaceFixtureTrait;

  /**
   * Modules to enable.
   *
   * @var array<int, string>
   */
  protected static $modules = [
    'system', 'field', 'file', 'image', 'og', 'bb_core', 'state_machine', 'entity',
    'user', 'options', 'text', 'link',
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
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_group');
    $this->installEntitySchema('bb_project');
    $this->installEntitySchema('bb_ticket');
    $this->installEntitySchema('bb_run');
    $this->installEntitySchema('file');
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installSchema('file', ['file_usage']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
  }

  /**
   * A write followed by a read returns the exact bytes, unicode included.
   */
  public function testWriteThenReadIsLossless(): void {
    $store = $this->container->get(RunLogStore::class);
    $run = $this->createRunInWorkspace();
    $payload = "transcript line one\ntranscript line two\n\xF0\x9F\x94\x92\n";
    $file = $store->write($run, $payload);
    self::assertSame($payload, $store->read($file, $run));
    $this->assertGzipFileEquals($payload, $file);
  }

  /**
   * An empty payload round-trips too.
   */
  public function testEmptyPayloadRoundTrips(): void {
    $store = $this->container->get(RunLogStore::class);
    $run = $this->createRunInWorkspace();
    $file = $store->write($run, '');
    self::assertSame('', $store->read($file, $run));
    $this->assertGzipFileEquals('', $file);
  }

  /**
   * The stored file's URI groups by workspace UUID, then run UUID.
   */
  public function testUriIsGroupedByWorkspaceUuidThenRunUuid(): void {
    $store = $this->container->get(RunLogStore::class);
    $run = $this->createRunInWorkspace();
    $workspace = $this->container->get(WorkspaceResolverInterface::class)
      ->resolve($run);
    self::assertStringStartsWith(
      'private://bakers-run-logs/' . $workspace->uuid() . '/' . $run->uuid() . '/',
      $store->write($run, 'x')->getFileUri(),
    );
  }

  /**
   * The generated filename carries a random component, so it never collides.
   */
  public function testFilenameCarriesRandomComponent(): void {
    $store = $this->container->get(RunLogStore::class);
    $run = $this->createRunInWorkspace();
    self::assertNotSame(
      $store->write($run, 'x')->getFileUri(),
      $store->write($run, 'x')->getFileUri(),
    );
  }

  /**
   * No `.part` temporary file survives a completed write.
   */
  public function testNoTemporaryFileSurvivesTheWrite(): void {
    $store = $this->container->get(RunLogStore::class);
    $run = $this->createRunInWorkspace();
    $store->write($run, 'payload');
    $root = $this->siteDirectory . '/private';
    $iterator = new \RecursiveIteratorIterator(
      new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $path) {
      self::assertStringEndsNotWith('.part', (string) $path);
    }
  }

  /**
   * Reading a file written for another run's workspace is refused.
   */
  public function testReadRefusesFileFromAnotherWorkspace(): void {
    $store = $this->container->get(RunLogStore::class);
    $run = $this->createRunInWorkspace();
    $other = $this->createRunInWorkspace();
    $file = $store->write($other, 'foreign payload');
    $this->expectException(RunLogException::class);
    $store->read($file, $run);
  }

  /**
   * WorkspaceUuidFromUri() extracts the workspace UUID segment, or ''.
   */
  public function testWorkspaceUuidFromUri(): void {
    self::assertSame('abc',
      RunLogStore::workspaceUuidFromUri('private://bakers-run-logs/abc/def/x.log'));
    self::assertSame('abc',
      RunLogStore::workspaceUuidFromUri('private://bakers-run-logs/abc/def/x.log.gz'));
    self::assertSame('',
      RunLogStore::workspaceUuidFromUri('private://other/abc/x.log'));
  }

  /**
   * New writes are gzip files: magic, `.log.gz` name, application/gzip MIME.
   */
  public function testWriteStoresGzipMagicFilenameAndMime(): void {
    $store = $this->container->get(RunLogStore::class);
    $run = $this->createRunInWorkspace();
    $file = $store->write($run, "transcript\n");
    self::assertStringEndsWith('.log.gz', $file->getFilename());
    self::assertStringEndsWith('.log.gz', $file->getFileUri());
    self::assertSame('application/gzip', $file->getMimeType());
    self::assertSame("\x1f\x8b", substr((string) file_get_contents($file->getFileUri()), 0, 2));
  }

  /**
   * BbRun checksums and byte counts stay uncompressed; file size is gzip.
   */
  public function testRunMetadataStaysUncompressedWhileFileIsGzip(): void {
    $run = $this->createRunInWorkspace();
    $payload = str_repeat("transcript line\n", 50);
    $run->set('log', $payload)->save();
    $file = $run->get('log_file')->entity;
    self::assertInstanceOf(FileInterface::class, $file);
    self::assertSame(hash('sha256', $payload), $run->get('log_sha256')->value);
    self::assertSame(strlen($payload), (int) $run->get('log_bytes')->value);
    $on_disk = (string) file_get_contents($file->getFileUri());
    self::assertSame(strlen($on_disk), (int) $file->getSize());
    self::assertLessThan(strlen($payload), (int) $file->getSize());
    self::assertSame($payload, gzdecode($on_disk));
  }

  /**
   * Error logs, unicode included, gzip on disk and read as original text.
   */
  public function testErrorLogUnicodeRoundTripsThroughGzip(): void {
    $run = $this->createRunInWorkspace();
    $payload = "boom: \xF0\x9F\x94\x92 dispatch failed\n";
    $run->set('error_log', $payload)->save();
    $file = $run->get('error_log_file')->entity;
    self::assertInstanceOf(FileInterface::class, $file);
    self::assertSame($payload, $run->readErrorLog());
    $this->assertGzipFileEquals($payload, $file);
    self::assertSame(hash('sha256', $payload), $run->get('error_log_sha256')->value);
    self::assertSame(strlen($payload), (int) $run->get('error_log_bytes')->value);
  }

  /**
   * A rewritten payload replaces the previous gzip managed file.
   */
  public function testRewritingReplacesTheGzipManagedFile(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', "first\n")->save();
    $first_id = (int) $run->get('log_file')->target_id;
    $run->set('log', "second\n")->save();
    $file = $run->get('log_file')->entity;
    self::assertInstanceOf(FileInterface::class, $file);
    self::assertNotSame($first_id, (int) $file->id());
    self::assertNull($this->container->get('entity_type.manager')->getStorage('file')->load($first_id));
    self::assertStringEndsWith('.log.gz', $file->getFilename());
    self::assertSame("second\n", $run->readLog());
  }

  /**
   * Deleting a run deletes the gzip managed file with it.
   */
  public function testDeletingTheRunDeletesTheGzipFile(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', "transcript\n")->save();
    $file = $run->get('log_file')->entity;
    self::assertInstanceOf(FileInterface::class, $file);
    $file_id = (int) $file->id();
    $realpath = $this->container->get('file_system')->realpath($file->getFileUri());
    self::assertIsString($realpath);
    $run->delete();
    self::assertNull($this->container->get('entity_type.manager')->getStorage('file')->load($file_id));
    self::assertFileDoesNotExist($realpath);
  }

  /**
   * A leftover plaintext `.log` is returned byte-for-byte, never gunzipped.
   */
  public function testLegacyPlaintextLogIsReadUntouched(): void {
    $store = $this->container->get(RunLogStore::class);
    $run = $this->createRunInWorkspace();
    $payload = "legacy plaintext\n";
    $file = $this->plantLegacyLog($run, $payload);
    self::assertSame($payload, $store->read($file, $run));
    self::assertSame($payload, file_get_contents($file->getFileUri()));
  }

  /**
   * Suffix, not magic bytes, decides decoding.
   *
   * A leftover `.log` that looks like gzip stays raw.
   */
  public function testLegacyPlaintextThatLooksLikeGzipIsNotDecoded(): void {
    $store = $this->container->get(RunLogStore::class);
    $run = $this->createRunInWorkspace();
    $payload = gzencode('not a legacy decode', 6);
    self::assertNotFalse($payload);
    $file = $this->plantLegacyLog($run, $payload);
    self::assertSame($payload, $store->read($file, $run));
  }

  /**
   * A truncated or garbage `.log.gz` throws rather than returning junk.
   */
  public function testCorruptGzipThrows(): void {
    $store = $this->container->get(RunLogStore::class);
    $run = $this->createRunInWorkspace();
    $file = $store->write($run, 'ok');
    file_put_contents($file->getFileUri(), 'this is not gzip');
    $this->expectException(RunLogException::class);
    $store->read($file, $run);
  }

  /**
   * Asserts a managed gzip file decodes to the expected plaintext.
   */
  private function assertGzipFileEquals(string $expected, FileInterface $file): void {
    $on_disk = file_get_contents($file->getFileUri());
    self::assertNotFalse($on_disk);
    $decoded = gzdecode($on_disk);
    self::assertNotFalse($decoded);
    self::assertSame($expected, $decoded);
  }

  /**
   * Plants a plaintext `.log` in the run's directory, as a pre-gzip leftover.
   */
  private function plantLegacyLog(BbRunInterface $run, string $payload): FileInterface {
    $workspace = $this->container->get(WorkspaceResolverInterface::class)->resolve($run);
    $directory = sprintf('private://bakers-run-logs/%s/%s', $workspace->uuid(), $run->uuid());
    $this->container->get('file_system')->prepareDirectory(
      $directory,
      FileSystemInterface::CREATE_DIRECTORY,
    );
    $name = 'legacy.log';
    $uri = $directory . '/' . $name;
    file_put_contents($uri, $payload);
    $file = $this->container->get('entity_type.manager')->getStorage('file')->create([
      'uri' => $uri,
      'filename' => $name,
      'filemime' => 'text/plain',
      'status' => FileInterface::STATUS_PERMANENT,
    ]);
    $file->save();
    self::assertInstanceOf(FileInterface::class, $file);
    return $file;
  }

}
