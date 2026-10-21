<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Datetime\Entity\DateFormat;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_activity\Plugin\BbActivityKind\Claimed;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Canonical run page: nested route, body empty-states, inspector rails.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class RunActivityViewTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine', 'views',
    'field', 'og', 'link', 'text', 'filter', 'file', 'image',
    'markdown_easy', 'bb_core', 'bb_activity', 'island',
    'display_builder', 'display_builder_entity_view',
    'ui_patterns', 'ui_patterns_field', 'ui_patterns_field_formatters',
  ];

  /**
   * The ticket the fixture run belongs to.
   */
  private BbTicketInterface $ticket;

  /**
   * The run under test.
   */
  private BbRunInterface $run;

  /**
   * {@inheritdoc}
   *
   * Core's own service provider only registers the `private` stream wrapper
   * when `file_private_path` is already set at container-build time.
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
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_workspace', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_activity', 'bb_notification_setting', 'bb_comment', 'bb_run',
      'bb_conductor', 'bb_term', 'file',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    $this->installConfig(['system', 'user', 'display_builder']);
    $this->config('system.date')
      ->set('timezone.default', 'UTC')
      ->set('timezone.user.configurable', FALSE)
      ->save();
    DateFormat::create([
      'id' => 'normal',
      'label' => 'Normal',
      'pattern' => 'j M Y, H:i',
      'status' => TRUE,
    ])->save();
    $this->installRunCanonicalDisplays();
    $this->setUpCurrentUser(['uid' => 1], ['administer bakers']);
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);

    $etm = $this->container->get('entity_type.manager');
    $workspace = $etm->getStorage('bb_workspace')->create([
      'name' => 'bakers.build',
      'slug' => 'bakers',
    ]);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $group = $etm->getStorage('bb_group')->create([
      'name' => 'bakers.build group',
      'workspace_id' => $workspace->id(),
    ]);
    $group->save();
    $project = $etm->getStorage('bb_project')->create([
      'name' => 'bakers.build',
      'key' => 'bakers.build',
      'group_id' => $group->id(),
    ]);
    $project->save();
    $ticket = $etm->getStorage('bb_ticket')->create([
      'title' => 'Canonical run page',
      'project_id' => $project->id(),
      'number' => 656,
      'identifier' => 'BB-656',
    ]);
    $ticket->save();
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $this->ticket = $ticket;

    $run = $etm->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'state' => 'done',
      'state_at_start' => 'coding',
    ]);
    $run->save();
    self::assertInstanceOf(BbRunInterface::class, $run);
    $this->run = $run;
  }

  /**
   * A run with no summary and no activity shows both empty-states.
   */
  public function testEmptyBodyShowsHonestEmptyStates(): void {
    $html = $this->renderMode('full');
    self::assertStringContainsString('Latest ticket summary', $html);
    self::assertStringContainsString('No ticket summary', $html);
    self::assertStringContainsString('Activity', $html);
    self::assertStringContainsString('No activity for this run', $html);
    self::assertStringNotContainsString('data-component-id="bb_theme:log-viewer"', $html);
  }

  /**
   * The newest summary comment and newest run activity reach the body.
   */
  public function testBodyRendersSummaryAndNewestActivity(): void {
    $etm = $this->container->get('entity_type.manager');
    $author = $etm->getStorage('user')->create(['name' => 'summary-author']);
    $author->save();
    $etm->getStorage('bb_comment')->create([
      'ticket_id' => $this->ticket->id(),
      'author' => $author->id(),
      'body' => ['value' => 'Latest summary body', 'format' => 'bb_rich'],
      'type' => 'summary',
    ])->save();
    $etm->getStorage('bb_activity')->create([
      'ticket_id' => $this->ticket->id(),
      'run_id' => $this->run->id(),
      'kind' => 'run_ended',
      'step' => 'coding',
      'actor' => 1,
      'workflow' => 'bb_feature',
    ])->save();
    $etm->getStorage('bb_ticket')->resetCache([$this->ticket->id()]);
    $etm->getStorage('bb_run')->resetCache([$this->run->id()]);
    $reloaded = $etm->getStorage('bb_run')->load($this->run->id());
    self::assertInstanceOf(BbRunInterface::class, $reloaded);
    $this->run = $reloaded;

    $html = $this->renderMode('full');
    self::assertStringNotContainsString('No ticket summary', $html);
    self::assertStringNotContainsString('No activity for this run', $html);
    self::assertStringContainsString('Latest summary body', $html);
    self::assertStringContainsString('Open summary comment', $html);
    self::assertStringNotContainsString('Previous:', $html);
    self::assertStringNotContainsString('Next:', $html);
  }

  /**
   * The body keeps the newest activity when several reference this run.
   */
  public function testBodyKeepsTheNewestRunActivity(): void {
    $etm = $this->container->get('entity_type.manager');
    $older = $etm->getStorage('bb_activity')->create([
      'ticket_id' => $this->ticket->id(),
      'run_id' => $this->run->id(),
      'kind' => Claimed::ID,
      'step' => 'older-coding',
      'actor' => 1,
      'workflow' => 'bb_feature',
      'created' => 1700000000,
    ]);
    $older->save();
    $newer = $etm->getStorage('bb_activity')->create([
      'ticket_id' => $this->ticket->id(),
      'run_id' => $this->run->id(),
      'kind' => Claimed::ID,
      'step' => 'newer-review',
      'actor' => 1,
      'workflow' => 'bb_feature',
      'created' => 1700003600,
    ]);
    $newer->save();

    $html = $this->renderMode('full');
    self::assertStringContainsString('newer-review', $html);
    self::assertStringNotContainsString('older-coding', $html);
  }

  /**
   * Renders the run in a shipped view mode.
   */
  private function renderMode(string $mode): string {
    $build = $this->container->get('entity_type.manager')
      ->getViewBuilder('bb_run')
      ->view($this->run, $mode);
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Installs the view modes and displays the canonical page composes.
   */
  private function installRunCanonicalDisplays(): void {
    $module = $this->container->get('extension.list.module')->getPath('bb_core');
    $recipe = dirname(DRUPAL_ROOT) . '/recipes/bakers/config';
    $target = $this->container->get('config.storage');
    $this->writeShippedConfig($target, $module . '/config/install', 'filter.format.bb_rich');
    foreach ([
      'core.entity_view_mode.bb_run.full' => $module . '/config/optional',
      'core.entity_view_mode.bb_run.overlay' => $module . '/config/optional',
      'core.entity_view_display.bb_run.bb_run.full' => $recipe,
      'core.entity_view_display.bb_run.bb_run.overlay' => $recipe,
      'core.entity_view_mode.bb_comment.full' => $module . '/config/optional',
      'core.entity_view_display.bb_comment.bb_comment.full' => $recipe,
      'core.entity_view_mode.bb_comment.teaser' => $module . '/config/optional',
      'core.entity_view_display.bb_comment.bb_comment.teaser' => $recipe,
      'core.entity_view_mode.bb_activity.full' => $this->container->get('extension.list.module')->getPath('bb_activity') . '/config/optional',
      'core.entity_view_display.bb_activity.bb_activity.full' => $recipe,
    ] as $name => $directory) {
      $this->writeShippedConfig($target, $directory, $name);
    }
  }

  /**
   * Writes one shipped config file into active config.
   *
   * @param \Drupal\Core\Config\StorageInterface $target
   *   Active config storage.
   * @param string $directory
   *   Directory the shipped YAML lives in.
   * @param string $name
   *   Config name without `.yml`.
   */
  private function writeShippedConfig($target, string $directory, string $name): void {
    $file = $directory . '/' . $name . '.yml';
    self::assertFileExists($file, sprintf('%s ships.', $name));
    $data = Yaml::decode((string) file_get_contents($file));
    $data['uuid'] = $this->container->get('uuid')->generate();
    $target->write($name, $data);
  }

}
