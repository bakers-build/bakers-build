<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Run\RunExplanation;
use Drupal\bb_core\Time\BbDate;
use Drupal\file\FileInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The words a run carries: failure reason and claim explanation.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RunWordingTest extends KernelTestBase {

  use WorkspaceFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'field', 'file', 'image', 'og', 'bb_core', 'state_machine',
    'entity', 'user', 'options', 'text', 'link', 'filter',
  ];

  /**
   * {@inheritdoc}
   *
   * Core registers the private stream wrapper too early for a test.
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
    foreach ([
      'bb_workspace', 'bb_group', 'bb_project', 'bb_ticket', 'bb_run',
      'bb_conductor', 'file', 'user', 'og_membership',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
    $this->installConfig(['filter']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    $this->config('system.date')->set('timezone.default', 'UTC')->save();
  }

  /**
   * A failed run in its fixture chain, with the given error log.
   */
  private function failedRun(string $error_log): BbRunInterface {
    $run = $this->createRunInWorkspace();
    $run->set('state', 'failed');
    if ($error_log !== '') {
      $run->set('error_log', $error_log);
    }
    $run->save();
    return $this->reload($run);
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

  /**
   * A run in the given state with a conductor and claim timing.
   */
  private function claimRun(string $state, int $claimed_ago, int $expires_in): BbRunInterface {
    $now = $this->container->get('datetime.time')->getRequestTime();
    $conductor = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')
      ->create(['conductor_id' => 'node-wording', 'label' => 'Atlas', 'states' => ['coding']]);
    $conductor->save();
    $run = $this->createRunInWorkspace();
    $run->set('state', $state)
      ->set('conductor_id', $conductor->id())
      ->set('created', $now - $claimed_ago)
      ->set('claim_expires_at', $now + $expires_in)
      ->save();
    return $this->reload($run);
  }

  /**
   * The reason is the first non-empty line, minus the "Error: " prefix.
   */
  public function testFailureReasonIsFirstNonEmptyLineWithoutErrorPrefix(): void {
    $run = $this->failedRun("\n\nError: plugins: claude install failed: 401\nstack trace\n");
    self::assertSame('plugins: claude install failed: 401', $run->failureReason());
  }

  /**
   * A long line is cut at 140 characters with an ellipsis.
   */
  public function testFailureReasonIsCutAt140Characters(): void {
    $reason = $this->failedRun(str_repeat('é', 300))->failureReason();
    self::assertSame(140, mb_strlen((string) $reason));
    self::assertStringEndsWith('…', (string) $reason);
  }

  /**
   * A huge single line is bounded: its first 140 characters, cut.
   */
  public function testFailureReasonOfHugeSingleLineIsBounded(): void {
    $reason = $this->failedRun(str_repeat('a', 100000))->failureReason();
    self::assertSame(str_repeat('a', 139) . '…', $reason);
  }

  /**
   * Blank lines spanning several read chunks are skipped.
   */
  public function testFailureReasonSkipsBlankLinesBeyondOneChunk(): void {
    $run = $this->failedRun(str_repeat("\n", 20000) . 'Error: after the blanks');
    self::assertSame('after the blanks', $run->failureReason());
  }

  /**
   * An unreadable error log reads as no reason instead of throwing.
   */
  public function testFailureReasonOfMissingLogFileIsTheNoReasonCopy(): void {
    $run = $this->failedRun('Error: boom');
    $file = $run->get('error_log_file')->entity;
    self::assertInstanceOf(FileInterface::class, $file);
    unlink((string) $file->getFileUri());
    self::assertSame(
      'No reason was recorded. Open the log for details.',
      $run->failureReason(),
    );
  }

  /**
   * Without an error log the reason says so.
   */
  public function testFailureReasonWithoutErrorLog(): void {
    self::assertSame(
      'No reason was recorded. Open the log for details.',
      $this->failedRun('')->failureReason(),
    );
  }

  /**
   * Only a failed run has a failure reason.
   */
  public function testFailureReasonIsNullForOtherStates(): void {
    $run = $this->createRunInWorkspace();
    $run->set('state', 'done')->set('error_log', 'Error: left over')->save();
    self::assertNull($this->reload($run)->failureReason());
  }

  /**
   * A valid claim explains the lease.
   */
  public function testClaimedRunExplainsTheLease(): void {
    $run = $this->claimRun('claimed', 120, 600);
    $date = $this->container->get(BbDate::class);
    $now = $this->container->get('datetime.time')->getRequestTime();
    self::assertSame(
      sprintf(
        'Claimed by Atlas %s, not started yet. The claim lapses %s; after that the run expires and the ticket can be claimed again.',
        $date->label($now - 120),
        $date->label($now + 600),
      ),
      $this->container->get(RunExplanation::class)->forRun($run),
    );
  }

  /**
   * The explanation is plain text, so a renderer escapes it exactly once.
   */
  public function testExplanationIsPlainText(): void {
    $run = $this->claimRun('claimed', 120, 600);
    $conductor = $run->get('conductor_id')->entity;
    self::assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->set('label', "O'Brien & Co")->save();
    self::assertStringStartsWith(
      "Claimed by O'Brien & Co ",
      (string) $this->container->get(RunExplanation::class)->forRun($this->reload($run)),
    );
  }

  /**
   * A claim past its lease explains the next claim.
   */
  public function testLapsedClaimExplainsTheNextClaim(): void {
    $run = $this->claimRun('claimed', 1200, -600);
    $date = $this->container->get(BbDate::class);
    $now = $this->container->get('datetime.time')->getRequestTime();
    self::assertSame(
      sprintf(
        'The claim lapsed %s before the run started. The run expires the next time a conductor asks for work, and the ticket can be claimed again.',
        $date->label($now - 600),
      ),
      $this->container->get(RunExplanation::class)->forRun($run),
    );
  }

  /**
   * An expired run explains the lapse; other states have no explanation.
   */
  public function testExpiredRunExplainsTheLapse(): void {
    $explanation = $this->container->get(RunExplanation::class);
    self::assertSame(
      'The claim lapsed before the run started. The ticket can be claimed again.',
      $explanation->forRun($this->claimRun('expired', 1200, -600)),
    );
    self::assertNull($explanation->forRun($this->claimRun('running', 60, 600)));
  }

}
