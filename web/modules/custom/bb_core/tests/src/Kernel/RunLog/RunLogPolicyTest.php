<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\RunLog;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\RunLog\RunLogPolicy;
use Drupal\bb_core\RunLog\RunLogStore;
use Drupal\Tests\bb_core\Kernel\WorkspaceFixtureTrait;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;

/**
 * Effective run-log storage: operator flag AND the run's own workspace opt-in.
 */
#[Group('bb_core')]
final class RunLogPolicyTest extends KernelTestBase {

  use UserCreationTrait;
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
    foreach (['bb_workspace', 'bb_group', 'bb_project', 'bb_ticket', 'bb_run', 'file', 'user', 'og_membership'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
    $this->installConfig(['filter']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
  }

  /**
   * Every flag/opt-in combination; only a boolean TRUE flag plus opt-in allows.
   *
   * @return array<string, array{0: mixed, 1: bool, 2: bool}>
   *   Flag setting value, workspace opt-in, expected effective policy.
   */
  public static function matrix(): array {
    return [
      'flag missing, opted in' => [NULL, TRUE, FALSE],
      'flag false, opted in' => [FALSE, TRUE, FALSE],
      'flag string "1", opted in' => ['1', TRUE, FALSE],
      'flag on, not opted in' => [TRUE, FALSE, FALSE],
      'flag on, opted in' => [TRUE, TRUE, TRUE],
    ];
  }

  /**
   * The effective policy, the computed run field and the store all agree.
   */
  #[DataProvider('matrix')]
  public function testPolicyMatrix(mixed $flag, bool $opted_in, bool $expected): void {
    if ($flag !== NULL) {
      $this->setSetting('feature_flags', [RunLogPolicy::FLAG => $flag]);
    }
    $run = $this->createRunInWorkspace();
    $this->workspaceOf($run)->set(RunLogPolicy::WORKSPACE_FIELD, $opted_in)->save();

    self::assertSame($expected, $this->container->get(RunLogPolicy::class)->allowsStorage($run));
    self::assertSame($expected, (bool) $this->reload($run)->get(RunLogPolicy::RUN_FIELD)->value);

    $run->set('log', "transcript\n")->save();
    self::assertSame($expected ? "transcript\n" : NULL, $this->reload($run)->readLog());
  }

  /**
   * A new workspace defaults to no opt-in, so a flag alone stores nothing.
   */
  public function testWorkspaceDefaultsToDisabled(): void {
    $this->setSetting('feature_flags', [RunLogPolicy::FLAG => TRUE]);
    $run = $this->createRunInWorkspace();
    self::assertFalse((bool) $this->workspaceOf($run)->get(RunLogPolicy::WORKSPACE_FIELD)->value);
    self::assertFalse($this->container->get(RunLogPolicy::class)->allowsStorage($run));
  }

  /**
   * A run that resolves to no workspace is denied rather than failing.
   */
  public function testRunWithoutWorkspaceIsDenied(): void {
    $this->setSetting('feature_flags', [RunLogPolicy::FLAG => TRUE]);
    $run = $this->container->get('entity_type.manager')->getStorage('bb_run')->create([]);
    self::assertInstanceOf(BbRunInterface::class, $run);
    self::assertFalse($this->container->get(RunLogPolicy::class)->allowsStorage($run));
  }

  /**
   * The opt-in of one workspace never allows another workspace's runs.
   */
  public function testOptInIsPerWorkspace(): void {
    $this->setSetting('feature_flags', [RunLogPolicy::FLAG => TRUE]);
    $opted = $this->createRunInWorkspace();
    $other = $this->createRunInWorkspace();
    $this->workspaceOf($opted)->set(RunLogPolicy::WORKSPACE_FIELD, TRUE)->save();

    $policy = $this->container->get(RunLogPolicy::class);
    self::assertTrue($policy->allowsStorage($opted));
    self::assertFalse($policy->allowsStorage($other));
  }

  /**
   * A disable persisted after the run's workspace was loaded still wins.
   *
   * Models a conductor that read `true` before the lead switched storage off:
   * the next write is checked against the persisted workspace, not a copy.
   */
  public function testPersistedDisableBeatsStaleLoadedWorkspace(): void {
    $this->setSetting('feature_flags', [RunLogPolicy::FLAG => TRUE]);
    $run = $this->createRunInWorkspace();
    $stale = $this->workspaceOf($run);
    $stale->set(RunLogPolicy::WORKSPACE_FIELD, TRUE)->save();
    self::assertTrue((bool) $run->get(RunLogPolicy::RUN_FIELD)->value, 'the conductor reads true');

    $fresh = $this->container->get('entity_type.manager')->getStorage('bb_workspace')->loadUnchanged($stale->id());
    self::assertInstanceOf(BbWorkspaceInterface::class, $fresh);
    $fresh->set(RunLogPolicy::WORKSPACE_FIELD, FALSE)->save();
    // The stale copy still says TRUE in memory.
    $stale->set(RunLogPolicy::WORKSPACE_FIELD, TRUE);

    $run->set('log', "late transcript\n")->markClosed(1700000000)->save();
    $reloaded = $this->reload($run);
    self::assertNull($reloaded->readLog(), 'no transcript is stored after the disable');
    self::assertTrue($reloaded->isClosed(), 'the close still lands');
  }

  /**
   * Enabling before the upload lets that same run's transcript be stored.
   */
  public function testEnableBeforeUploadStoresThatRun(): void {
    $this->setSetting('feature_flags', [RunLogPolicy::FLAG => TRUE]);
    $run = $this->createRunInWorkspace();
    $this->workspaceOf($run)->set(RunLogPolicy::WORKSPACE_FIELD, TRUE)->save();
    $run->set('log', "transcript\n")->save();
    self::assertSame("transcript\n", $this->reload($run)->readLog());
  }

  /**
   * Disabling keeps the stored transcript and still stores error logs.
   */
  public function testDisableKeepsHistoryAndErrorLog(): void {
    $this->setSetting('feature_flags', [RunLogPolicy::FLAG => TRUE]);
    $run = $this->createRunInWorkspace();
    $workspace = $this->workspaceOf($run);
    $workspace->set(RunLogPolicy::WORKSPACE_FIELD, TRUE)->save();
    $run->set('log', "old transcript\n")->save();
    $file = $this->reload($run)->get('log_file')->target_id;

    $workspace->set(RunLogPolicy::WORKSPACE_FIELD, FALSE)->save();
    $run = $this->reload($run);
    $run->set('log', "new transcript\n")->set('error_log', 'dispatch failed')->save();

    $reloaded = $this->reload($run);
    self::assertSame($file, $reloaded->get('log_file')->target_id);
    self::assertSame("old transcript\n", $reloaded->readLog());
    self::assertSame('dispatch failed', $reloaded->readErrorLog());
  }

  /**
   * A denied direct store write returns no file; error logs are not gated.
   */
  public function testStoreRefusesDeniedTranscriptButKeepsErrorLog(): void {
    $run = $this->createRunInWorkspace();
    $store = $this->container->get(RunLogStore::class);
    self::assertNull($store->write($run, 'transcript'));
    self::assertNull($store->write($run, 'transcript', 'log'));
    self::assertNotNull($store->write($run, 'dispatch failed', 'error_log'));
  }

  /**
   * The computed policy field is never writable.
   */
  public function testComputedFieldIsNotEditable(): void {
    $run = $this->createRunInWorkspace();
    $admin = $this->setUpCurrentUser([], [], TRUE);
    self::assertFalse($run->get(RunLogPolicy::RUN_FIELD)->access('edit', $admin));
  }

  /**
   * Reloads a run, bypassing the static entity cache.
   */
  private function reload(BbRunInterface $run): BbRunInterface {
    $reloaded = $this->container->get('entity_type.manager')->getStorage('bb_run')->loadUnchanged($run->id());
    self::assertInstanceOf(BbRunInterface::class, $reloaded);
    return $reloaded;
  }

  /**
   * The workspace the run resolves to.
   */
  private function workspaceOf(BbRunInterface $run): BbWorkspaceInterface {
    $workspace = $this->container->get('bb_core.workspace_resolver')->resolve($run);
    self::assertNotNull($workspace);
    return $workspace;
  }

}
