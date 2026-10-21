<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\CreateActionSourceBase;
use Drupal\bb_core\Plugin\UiPatterns\Source\BbPageHeaderDescriptionSource;
use Drupal\bb_track\Plugin\UiPatterns\Source\WorklogCreateActionSource;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\Yaml\Yaml;

/**
 * Record time is the create action on My time, opening the island dialog.
 */
#[Group('bb_track')]
final class WorklogCreateActionTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use UserCreationTrait;

  private const WORKSPACE_SLUG = 'workspace-a';

  private const PATH = '/time';

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file',
    'image',
    'system',
    'user',
    'field',
    'options',
    'text',
    'filter',
    'link',
    'datetime',
    'entity',
    'state_machine',
    'og',
    'views',
    'island',
    'views_filters_summary',
    'ui_patterns',
    'display_builder',
    'ui_patterns_views',
    'display_builder_views',
    'bb_core',
    'bb_track',
  ];

  /**
   * Workspace the My time request is made against.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'file', 'og_membership', 'bb_workspace', 'bb_group',
      'bb_project', 'bb_track_submission', 'bb_track_account', 'bb_track_worklog',
    ] as $entity_type_id) {
      $this->installEntitySchema($entity_type_id);
    }
    $this->installSchema('file', ['file_usage']);
    $this->installConfig(['system', 'user', 'filter', 'views']);
    $this->installOgScopeFixture();
    $path = dirname(__DIR__, 7) . '/recipes/bakers/config/views.view.worklog.yml';
    $data = Yaml::parseFile($path);
    self::assertIsArray($data);
    $this->container->get('entity_type.manager')->getStorage('view')->create($data)->save();
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->createUser();
    $owner = $this->createUser([], 'world-owner');
    self::assertInstanceOf(UserInterface::class, $owner);
    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create([
        'name' => 'Workspace A',
        'slug' => self::WORKSPACE_SLUG,
        'owner_user_id' => $owner->id(),
      ]);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;
  }

  /**
   * A guest sees no Record time plus.
   */
  public function testTheActionIsAbsentWithoutRecordPermission(): void {
    $guest = $this->createUser(['view bb_project'], 'guest-no-record');
    self::assertInstanceOf(UserInterface::class, $guest);
    $this->addMembership($this->workspace, $guest, ['guest']);
    $this->container->get('current_user')->setAccount($guest);

    $value = $this->actionValue();
    self::assertIsArray($value);
    self::assertArrayNotHasKey('#type', $value);
    self::assertSame('', $this->actionMarkup());
  }

  /**
   * A recorder gets both doors: page href and dialog hx-get.
   */
  public function testTheActionCarriesTheCurrentScreenAsItsDestination(): void {
    $this->asRecorder();
    $markup = $this->actionMarkup();

    self::assertStringContainsString('/time/add', $markup);
    self::assertStringContainsString('destination=', $markup);
    self::assertStringContainsString('_wrapper_format=island_dialog', $markup);
    self::assertStringContainsString('aria-label="Record time"', $markup);
    self::assertStringContainsString(
      'sprite.svg?v=' . $this->container->get('asset.query_string')->get() . '#plus',
      $markup,
    );
  }

  /**
   * The plain href is /time/add with destination only.
   */
  public function testThePlainHrefCarriesNothingButTheDestination(): void {
    $this->asRecorder();
    $href = $this->hrefOf($this->actionMarkup('mode=day&date=2026-10-06'));

    self::assertStringStartsWith('/time/add?', $href);
    self::assertStringNotContainsString('_wrapper_format', $href);
    self::assertStringContainsString('destination=/' . self::WORKSPACE_SLUG . self::PATH, $href);
    self::assertStringContainsString('%3Fmode%3Dday', $href);
    self::assertStringNotContainsString(
      'mode=day',
      str_replace(['%3Fmode%3Dday', '%26mode%3Dday'], '', $href),
    );
  }

  /**
   * Record time on a proposal week adds the new entry to that proposal.
   */
  public function testRecordTimeForwardsTheSubmission(): void {
    $this->asRecorder();
    $uuid = '6b0f6a52-5e6d-4b9e-8f43-0c6a1f9d2a11';
    $href = $this->hrefOf($this->actionMarkup('mode=week&date=2026-10-06&submission=' . $uuid));
    [, $query_string] = explode('?', $href, 2);
    parse_str($query_string, $query);
    self::assertSame($uuid, $query['submission'] ?? NULL);
    [, $forged_string] = explode('?', $this->hrefOf($this->actionMarkup('mode=week&submission=not-a-uuid')), 2);
    parse_str($forged_string, $forged);
    self::assertArrayNotHasKey('submission', $forged);
  }

  /**
   * Record time prefills the selected date, project and ticket.
   */
  public function testRecordTimePrefillsTheCalendarSelection(): void {
    $this->asRecorder();
    $href = $this->hrefOf($this->actionMarkup('mode=day&date=2026-10-06&project=5&ticket=7&person=3'));
    [, $query_string] = explode('?', $href, 2);
    parse_str($query_string, $query);
    self::assertSame('2026-10-06', $query['date'] ?? NULL);
    self::assertSame('5', $query['project'] ?? NULL);
    self::assertSame('7', $query['ticket'] ?? NULL);
    self::assertArrayNotHasKey('person', $query);
    self::assertArrayNotHasKey('mode', $query);
    $destination = $query['destination'] ?? '';
    self::assertIsString($destination);
    self::assertStringContainsString('person=3', $destination);

    $forged = $this->hrefOf($this->actionMarkup('date=06-10-2026&project=x'));
    [, $forged_string] = explode('?', $forged, 2);
    parse_str($forged_string, $forged_query);
    self::assertArrayNotHasKey('date', $forged_query);
    self::assertArrayNotHasKey('project', $forged_query);
  }

  /**
   * The action applies on the personal calendar too.
   */
  public function testTheActionAppliesOnThePersonalCalendar(): void {
    $this->asRecorder();
    $uid = $this->container->get('current_user')->id();
    $value = $this->onPath('/user/' . $uid . '/time', fn (): mixed => $this->source()->getPropValue());
    self::assertIsArray($value);
    self::assertArrayHasKey('#component', $value);
  }

  /**
   * The trigger fetches the dialog into the shell overlay.
   */
  public function testTheTriggerFetchesTheDialogIntoTheOneOverlay(): void {
    $this->asRecorder();
    $anchor = $this->anchorOf($this->actionMarkup());

    self::assertStringContainsString('data-hx-get="', $anchor);
    self::assertStringContainsString('_wrapper_format=island_dialog', $anchor);
    self::assertStringContainsString(
      'data-hx-target="#' . CreateActionSourceBase::TARGET_ID . '"',
      $anchor,
    );
    self::assertStringContainsString('data-hx-swap="innerHTML', $anchor);
    self::assertStringContainsString('data-hx-select="dialog:not(dialog dialog)"', $anchor);
    self::assertStringNotContainsString('data-hx-select="form#', $anchor);
  }

  /**
   * The plus belongs on My time only.
   */
  public function testTheActionAppliesOnlyOnMyTime(): void {
    $this->asRecorder();
    $on_projects = $this->onPath('/' . self::WORKSPACE_SLUG . '/projects', function (): mixed {
      return $this->source()->getPropValue();
    });
    self::assertIsArray($on_projects);
    self::assertArrayNotHasKey('#component', $on_projects);

    $on_time = $this->actionValue();
    self::assertSame('bb_theme:button', $on_time['#component'] ?? NULL);
  }

  /**
   * Both island profile copies place the source in the page-header actions.
   */
  public function testShippedShellHeaderListsTheAction(): void {
    $root = dirname(__DIR__, 7);
    foreach (['recipes/bakers/config', 'config/sync'] as $where) {
      $header = Yaml::parseFile($root . '/' . $where . '/island.profile.bb_shell.yml')['placements']['shell_page_header']['configuration']['component'];
      self::assertContains(
        'bb_worklog_create_action',
        array_column($header['slots']['actions']['sources'], 'source_id'),
        $where,
      );
    }
  }

  /**
   * The shell sub-line names recorded hours on My time.
   */
  public function testTheHeaderDescribesRecordedHours(): void {
    $this->asRecorder();
    $value = $this->onTheScreen('', function (): mixed {
      $schema = $this->container->get('plugin.manager.ui_patterns_prop_type')
        ->getDefinition('string')['schema'];
      $source = $this->container->get('plugin.manager.ui_patterns_source')
        ->createInstance(
          'bb_page_header_description',
          SourcePluginBase::buildConfiguration('description', $schema, ['source' => []], []),
        );
      self::assertInstanceOf(BbPageHeaderDescriptionSource::class, $source);
      return $source->getPropValue();
    });
    self::assertSame('Your recorded hours in the Workspace A workspace', $value);
  }

  /**
   * Record time is no longer a My work local task.
   */
  public function testRecordTimeLocalTaskGone(): void {
    $definitions = $this->container->get('plugin.manager.menu.local_task')->getDefinitions();
    self::assertArrayNotHasKey('bb_track.record_time', $definitions);
  }

  /**
   * My work tabs weigh Tickets, then My time, then Stats.
   */
  public function testMyWorkTabsWeighMyTimeBeforeStats(): void {
    $definitions = $this->container->get('plugin.manager.menu.local_task')->getDefinitions();
    self::assertArrayHasKey('bb_track.my_time', $definitions);
    self::assertArrayHasKey('bb_core.my_work.stats', $definitions);
    self::assertSame('view.tickets.my_work', $definitions['bb_track.my_time']['base_route']);
    self::assertSame('view.tickets.my_work', $definitions['bb_core.my_work.stats']['base_route']);
    $tickets = Yaml::parseFile(dirname(__DIR__, 7) . '/recipes/bakers/config/views.view.tickets.yml');
    self::assertSame(0, $tickets['display']['my_work']['display_options']['menu']['weight']);
    self::assertGreaterThan(0, (int) $definitions['bb_track.my_time']['weight']);
    self::assertLessThan(
      (int) $definitions['bb_core.my_work.stats']['weight'],
      (int) $definitions['bb_track.my_time']['weight'],
    );
  }

  /**
   * Grants lead rank so the add route allows recording.
   */
  private function asRecorder(): void {
    $recorder = $this->createUser([
      'record own worklog',
      'view bb_project',
    ], 'recorder');
    self::assertInstanceOf(UserInterface::class, $recorder);
    $this->addMembership($this->workspace, $recorder, ['lead']);
    $this->container->get('current_user')->setAccount($recorder);
  }

  /**
   * The source's own answer on a pushed My time request.
   *
   * @param string $query
   *   The screen's query string, without a leading `?`.
   *
   * @return array<string, mixed>
   *   The prop value.
   */
  private function actionValue(string $query = ''): array {
    $value = $this->onTheScreen($query, fn (): mixed => $this->source()->getPropValue());
    self::assertIsArray($value);
    return $value;
  }

  /**
   * The source, rendered.
   *
   * @param string $query
   *   The screen's query string, without a leading `?`.
   *
   * @return string
   *   The markup, which is the empty string when nothing is offered.
   */
  private function actionMarkup(string $query = ''): string {
    return $this->onTheScreen($query, function (): string {
      $build = $this->source()->getPropValue();
      self::assertIsArray($build);
      return (string) $this->container->get('renderer')->renderInIsolation($build);
    });
  }

  /**
   * Runs a callback with the My time request on the stack.
   *
   * @param string $query
   *   The screen's query string, without a leading `?`.
   * @param callable $measure
   *   The callback to run.
   *
   * @return mixed
   *   Whatever the callback returned.
   */
  private function onTheScreen(string $query, callable $measure): mixed {
    return $this->onPath(
      '/' . self::WORKSPACE_SLUG . self::PATH . ($query === '' ? '' : '?' . $query),
      $measure,
    );
  }

  /**
   * Runs a callback with `$path` as the current request.
   *
   * @param string $path
   *   The path to push, including a leading `/`.
   * @param callable $measure
   *   The callback to run.
   *
   * @return mixed
   *   Whatever the callback returned.
   */
  private function onPath(string $path, callable $measure): mixed {
    $request = Request::create($path);
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    else {
      $request->setSession(new Session(new MockArraySessionStorage()));
    }
    try {
      $request->attributes->add($this->container->get('router')->matchRequest($request));
    }
    catch (\Exception) {
      // Projects is not installed in this kernel; the source must still refuse.
    }
    $this->container->get('request_stack')->push($request);
    try {
      return $measure();
    }
    finally {
      $this->container->get('request_stack')->pop();
    }
  }

  /**
   * A fresh Record time source, reading the request and account as they are.
   */
  private function source(): WorklogCreateActionSource {
    $definition = $this->container->get('plugin.manager.ui_patterns_prop_type')
      ->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance(
        'bb_worklog_create_action',
        SourcePluginBase::buildConfiguration('actions', $definition, ['source' => []], []),
      );
    self::assertInstanceOf(WorklogCreateActionSource::class, $source);
    return $source;
  }

  /**
   * The address the trigger points at.
   *
   * @param string $markup
   *   The rendered trigger.
   *
   * @return string
   *   The decoded href.
   */
  private function hrefOf(string $markup): string {
    self::assertSame(1, preg_match('/href="([^"]+)"/', $markup, $matches));
    return html_entity_decode($matches[1]);
  }

  /**
   * The trigger's own anchor, cut out of the rendered markup.
   *
   * @param string $markup
   *   The rendered trigger.
   *
   * @return string
   *   The anchor's opening tag.
   */
  private function anchorOf(string $markup): string {
    $at = strpos($markup, 'aria-label="Record time"');
    self::assertNotFalse($at, 'The trigger did not render.');
    $start = strrpos(substr($markup, 0, $at), '<a ');
    self::assertNotFalse($start);
    $end = strpos($markup, '>', $at);
    self::assertNotFalse($end);
    return substr($markup, $start, $end - $start);
  }

}
