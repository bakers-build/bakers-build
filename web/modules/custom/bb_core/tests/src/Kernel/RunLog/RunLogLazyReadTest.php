<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\RunLog;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\file\FileInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\RunLog\RunLogException;
use Drupal\Tests\bb_core\Kernel\WorkspaceFixtureTrait;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Proves run logs stay out of entity loads and the entity cache (AC4).
 *
 * F17 (search_api tracking must not pull the log payload into the index) is
 * not covered here: exercising search_api's indexing pipeline needs a
 * server/backend fixture beyond this Kernel test's scope. It is covered by
 * Task 7's `recipe-test` run instead.
 */
#[Group('bb_core')]
final class RunLogLazyReadTest extends KernelTestBase {

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
   * A plain entity load never brings the log payload along.
   */
  public function testEntityLoadCarriesNoPayload(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', str_repeat("secret-marker\n", 1000))->save();
    self::assertStringNotContainsString('secret-marker',
      (string) json_encode($this->reload($run)->toArray()));
  }

  /**
   * The entity cache entry never carries the log payload either.
   */
  public function testEntityCacheEntryCarriesNoPayload(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', str_repeat("secret-marker\n", 1000))->save();
    $this->reload($run);
    $cached = $this->container->get('cache.entity')->get('values:bb_run:' . $run->id());
    self::assertStringNotContainsString('secret-marker', (string) json_encode($cached->data ?? []));
  }

  /**
   * Listing runs does not read or decompress log files.
   */
  public function testListingDoesNotReadOrDecompressLogFiles(): void {
    $run = $this->createRunInWorkspace();
    $run->set('log', str_repeat("secret-marker\n", 1000))->save();
    $reloaded = $this->reload($run);
    $file = $reloaded->get('log_file')->entity;
    self::assertInstanceOf(FileInterface::class, $file);
    file_put_contents($file->getFileUri(), 'not-gzip');
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    $storage->resetCache([$run->id()]);
    $listed = $storage->loadMultiple([$run->id()]);
    self::assertArrayHasKey($run->id(), $listed);
    $listed_run = $listed[$run->id()];
    self::assertInstanceOf(BbRunInterface::class, $listed_run);
    self::assertStringNotContainsString('secret-marker', (string) json_encode($listed_run->toArray()));
    $this->expectException(RunLogException::class);
    $listed_run->readLog();
  }

  /**
   * A large log round-trips and does not blow past a sane memory ceiling.
   *
   * This is a measured peak for one gzip write + decoded read, not a claim
   * that memory is constant in the payload size.
   */
  public function testLargeLogRoundTripAndMemory(): void {
    $run = $this->createRunInWorkspace();
    $payload = str_repeat("a representative transcript line with some detail\n", 200000);
    $before = memory_get_peak_usage(TRUE);
    $run->set('log', $payload)->save();
    $read = $this->reload($run)->readLog();
    $peak = memory_get_peak_usage(TRUE) - $before;
    self::assertSame($payload, $read);
    // Record the ceiling rather than assert an invented one: AC7 asks for a
    // measurement, and the number goes into the operations note as the
    // practical transcript size limit. Written to a sidecar file rather than
    // printed to STDERR: phpunit.xml sets beStrictAboutOutputDuringTests,
    // which turns ANY write during a running test — STDOUT, STDERR or
    // error_log() alike — into a test error (`Test code ... printed
    // unexpected output`). `ddev exec cat` the file after the run to read
    // the number.
    file_put_contents(sys_get_temp_dir() . '/bakers-run-log-memory-peak.txt',
      sprintf("run-log write peak for %d MiB payload: %d MiB\n",
        strlen($payload) >> 20, $peak >> 20));
    self::assertLessThan(10 * strlen($payload), $peak);
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
