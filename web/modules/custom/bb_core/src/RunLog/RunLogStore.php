<?php

declare(strict_types=1);

namespace Drupal\bb_core\RunLog;

use Drupal\Component\Utility\Crypt;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\File\FileSystemInterface;
use Drupal\file\FileInterface;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbRunInterface;

/**
 * Stores a run log as a managed file under the private scheme.
 *
 * Layout: private://bakers-run-logs/<workspace-uuid>/<run-uuid>/<random>.log.gz.
 *
 * The workspace segment is the UUID rather than the slug, so renaming a
 * workspace cannot orphan its files. New writes are gzip (not encrypted);
 * leftover `.log` files stay plaintext. The access gate on the retrieval
 * route is the only thing protecting them. Encryption would attach here, at
 * the file boundary, without changing anything else.
 */
final class RunLogStore {

  public const DIRECTORY = 'bakers-run-logs';

  public function __construct(
    private readonly WorkspaceResolverInterface $workspaceResolver,
    private readonly FileSystemInterface $fileSystem,
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {
  }

  /**
   * Writes a payload and returns the managed file holding it.
   *
   * @throws \Drupal\bb_core\RunLog\RunLogException
   *
   * @SuppressWarnings("PHPMD.ErrorControlOperator")
   */
  public function write(BbRunInterface $run, string $payload): FileInterface {
    $workspace_uuid = $this->workspaceUuid($run);
    $directory = sprintf('private://%s/%s/%s', self::DIRECTORY, $workspace_uuid, (string) $run->uuid());
    if (!$this->fileSystem->prepareDirectory($directory, FileSystemInterface::CREATE_DIRECTORY)) {
      throw new RunLogException('Run log directory is not writable.');
    }
    $encoded = gzencode($payload, 6);
    if ($encoded === FALSE) {
      throw new RunLogException('Run log could not be compressed.');
    }
    $name = Crypt::randomBytesBase64(18) . '.log.gz';
    // Atomic: write to a sibling temporary path, flush, then rename into place.
    // A reader therefore never observes a half-written file, and a crash leaves
    // a stray .part rather than a truncated log.
    $part = $directory . '/' . $name . '.part';
    $handle = fopen($part, 'xb');
    if ($handle === FALSE) {
      throw new RunLogException('Run log could not be opened for writing.');
    }
    try {
      if (fwrite($handle, $encoded) !== strlen($encoded) || !fflush($handle)) {
        throw new RunLogException('Run log could not be written.');
      }
    }
    catch (RunLogException $e) {
      @unlink($part);
      throw $e;
    }
    finally {
      fclose($handle);
    }
    $uri = $directory . '/' . $name;
    $part_real = $this->fileSystem->realpath($part);
    $directory_real = $this->fileSystem->realpath($directory);
    if ($part_real === FALSE || $directory_real === FALSE || !@rename($part_real, $directory_real . '/' . $name)) {
      @unlink($part);
      throw new RunLogException('Run log could not be committed.');
    }
    $file = $this->entityTypeManager->getStorage('file')->create([
      'uri' => $uri,
      'filename' => $name,
      'filemime' => 'application/gzip',
      'status' => FileInterface::STATUS_PERMANENT,
    ]);
    $file->save();
    return $file;
  }

  /**
   * Reads a file for the run that owns it.
   *
   * @throws \Drupal\bb_core\RunLog\RunLogException
   *
   * @SuppressWarnings("PHPMD.ErrorControlOperator")
   */
  public function read(FileInterface $file, BbRunInterface $run): string {
    $path_workspace = self::workspaceUuidFromUri((string) $file->getFileUri());
    $run_workspace = $this->workspaceUuid($run);
    if ($path_workspace === '' || $path_workspace !== $run_workspace) {
      // The path says one workspace and the run resolves to another. Refuse
      // rather than pick one: this cross-check turns a resolution defect into a
      // denial instead of a cross-workspace read.
      throw new RunLogException('Run log does not belong to this run.');
    }
    $contents = @file_get_contents((string) $file->getFileUri());
    if ($contents === FALSE) {
      throw new RunLogException('Run log could not be read.');
    }
    if (!self::isGzipLog($file)) {
      return $contents;
    }
    $decoded = @gzdecode($contents);
    if ($decoded === FALSE) {
      throw new RunLogException('Run log could not be decompressed.');
    }
    return $decoded;
  }

  /**
   * Whether this managed file is a gzip log, decided by suffix only.
   */
  private static function isGzipLog(FileInterface $file): bool {
    return str_ends_with((string) $file->getFileUri(), '.log.gz');
  }

  /**
   * Extracts the workspace uuid from a run-log uri, or '' when it is not one.
   */
  public static function workspaceUuidFromUri(string $uri): string {
    $prefix = 'private://' . self::DIRECTORY . '/';
    if (!str_starts_with($uri, $prefix)) {
      return '';
    }
    $rest = substr($uri, strlen($prefix));
    $slash = strpos($rest, '/');
    return $slash === FALSE ? '' : substr($rest, 0, $slash);
  }

  /**
   * Resolves the run's workspace UUID, or throws when it has none.
   */
  private function workspaceUuid(BbRunInterface $run): string {
    $workspace = $this->workspaceResolver->resolve($run);
    if ($workspace === NULL) {
      // Fail closed. A shared fallback directory would be exactly the
      // cross-tenant hole this layout exists to prevent.
      throw new RunLogException('Run has no resolvable workspace.');
    }
    return (string) $workspace->uuid();
  }

}
