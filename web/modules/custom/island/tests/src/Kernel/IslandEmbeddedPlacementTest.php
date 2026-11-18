<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\Core\Config\ConfigImporterException;
use Drupal\Core\Form\FormState;
use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;
use Drupal\island\IslandProfileHost;
use Drupal\island\IslandResponse;
use Drupal\island\IslandRuntimeId;
use Drupal\island_test\ProfileAppProvider;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\HttpKernelInterface;

/**
 * A placement in the reserved `embedded` slot, rendered inside a component.
 *
 * The `header` component embeds the `tasks` action island in its slot; the
 * `counter` placement subscribes to the event the action dispatches.
 */
#[Group('island')]
final class IslandEmbeddedPlacementTest extends KernelTestBase {

  use ProfileRequestTrait;

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'system', 'path_alias', 'user', 'sdc', 'sdc_test', 'ui_patterns',
    'island', 'island_test', 'island_ui_patterns',
  ];

  /**
   * The fixture's access policy.
   */
  private ProfileAppProvider $provider;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('path_alias');
    $this->installConfig(['system']);
    $this->container->get('theme_installer')->install(['stark']);
    $this->container->get('config.factory')->getEditable('system.theme')->set('default', 'stark')->save();
    $this->container->get('router.builder')->rebuild();
    $this->container->get('request_stack')->getCurrentRequest()->setSession($this->container->get('session'));
    $this->provider = new ProfileAppProvider();
    $this->container->get('island.app_provider_manager')->addProvider($this->provider);
    App::create(['id' => 'embed', 'label' => 'Embed', 'provider' => 'profile_test'])->save();
    IslandProfile::create([
      'id' => 'embed',
      'label' => 'Embed',
      'app' => 'embed',
      'layout' => 'island_test:test_hull',
      'layout_settings' => ['title' => 'Page'],
      'placements' => self::placements(),
    ])->save();
  }

  /**
   * The valid fixture placements.
   *
   * @return array<string, array<string, mixed>>
   *   Placements keyed by id.
   */
  private static function placements(): array {
    return [
      'header' => [
        'plugin_id' => 'ui_patterns_component',
        'slot' => 'body',
        'configuration' => ['component' => self::embedding('tasks')],
        'events' => ['tasks.other'],
      ],
      'tasks' => ['plugin_id' => 'task_list', 'slot' => 'embedded'],
      'counter' => ['plugin_id' => 'task_count', 'slot' => 'body', 'weight' => 1, 'events' => ['tasks.changed']],
    ];
  }

  /**
   * A component mapping whose slot embeds the given placements.
   */
  private static function embedding(string ...$placement_ids): array {
    $sources = [];
    foreach ($placement_ids as $placement_id) {
      $sources[] = ['source_id' => 'island_placement', 'source' => ['placement' => $placement_id]];
    }
    return [
      'component_id' => 'island_test:test_hull',
      'props' => ['title' => ['source_id' => 'textfield', 'source' => ['value' => 'Header']]],
      'slots' => ['actions' => ['sources' => $sources]],
    ];
  }

  /**
   * The html id of one fixture placement in instance `one`.
   */
  private static function htmlId(string $placement_id): string {
    return IslandRuntimeId::forPlacement('embed', 'embed', 'one', $placement_id);
  }

  /**
   * Loads the fixture profile fresh.
   */
  private function profile(): IslandProfile {
    $profile = IslandProfile::load('embed');
    self::assertInstanceOf(IslandProfile::class, $profile);
    return $profile;
  }

  /**
   * Renders the profile page for a path and returns its markup.
   */
  private function renderPage(string $path = '/island-test'): string {
    $this->enterPath($path);
    $build = $this->container->get('island.profile_renderer')->render($this->profile(), 'one');
    $html = (string) $this->container->get('renderer')->renderInIsolation($build);
    $this->container->get('request_stack')->pop();
    return $html;
  }

  /**
   * The embedded island renders once, inside the component that references it.
   */
  public function testEmbeddedPlacementRendersInsideItsComponent(): void {
    $this->enterPath('/island-test');
    $build = $this->container->get('island.profile_renderer')->render($this->profile(), 'one');
    $this->container->get('request_stack')->pop();
    self::assertArrayNotHasKey('embedded', $build['#slots']);
    self::assertSame(['header', 'counter'], array_keys($build['#slots']['body']));

    $html = $this->renderPage();
    self::assertSame(1, substr_count($html, 'id="' . self::htmlId('tasks') . '"'));
    $header = strpos($html, 'id="' . self::htmlId('header') . '"');
    $tasks = strpos($html, 'id="' . self::htmlId('tasks') . '"');
    $counter = strpos($html, 'id="' . self::htmlId('counter') . '"');
    self::assertNotFalse($header);
    self::assertNotFalse($counter);
    self::assertTrue($header < $tasks && $tasks < $counter, 'The embedded island sits inside the header, before the next placement.');
    self::assertStringContainsString('list:3', $html);
    self::assertStringContainsString('Header', $html);
  }

  /**
   * A component rebuilt on its event renders the embedded island again.
   */
  public function testEmbeddingComponentRebuildKeepsEmbeddedIsland(): void {
    $this->enterPath('/island-test');
    $host = $this->container->get('island.profile_renderer')->registerHost($this->profile(), 'one');
    self::assertInstanceOf(IslandProfileHost::class, $host);
    $http = $this->container->get('island.responder')->toResponse(
      IslandResponse::make()->dispatch('tasks.other'), NULL, $host,
    );
    $this->container->get('request_stack')->pop();
    $html = (string) $http->getContent();
    self::assertMatchesRegularExpression('/id="' . preg_quote(self::htmlId('header'), '/') . '"[^>]*hx-swap-oob="outerHTML"/', $html);
    self::assertSame(1, substr_count($html, 'id="' . self::htmlId('tasks') . '"'));
    self::assertStringContainsString('list:3', $html);
  }

  /**
   * The embedded island's action posts to the page and answers with fragments.
   */
  public function testEmbeddedActionAnswersWithItsContainerAndSubscribers(): void {
    [$url, $vals] = $this->deleteLink();
    self::assertSame('/island-test', $url);
    self::assertSame('tasks', $vals['_island']);
    $response = $this->post($url, $vals);
    $html = (string) $response->getContent();
    self::assertSame(200, $response->getStatusCode());
    preg_match_all('/<div[^>]*id="(island-[^"]+)"[^>]*>/', $html, $matches);
    self::assertSame([self::htmlId('tasks'), self::htmlId('counter')], $matches[1]);
    self::assertStringNotContainsString('hx-swap-oob', $matches[0][0], 'The embedded container is the main fragment.');
    self::assertStringContainsString('hx-swap-oob="outerHTML"', $matches[0][1]);
    self::assertStringContainsString('count:2', $html);
    self::assertStringNotContainsString('>ok<', $html, 'The page controller does not run for an action.');
  }

  /**
   * Action and refresh are refused when the page would not show the island.
   */
  public function testEmbeddedAccessFollowsReferencingPlacement(): void {
    [$url, $vals] = $this->deleteLink();
    $token = $this->container->get('csrf_token');
    self::assertSame(200, $this->act($url, $vals));
    self::assertSame(403, $this->act($url, ['_island_token' => 'bogus'] + $vals), 'Bad token.');
    $denied = ['_island_action' => 'unknown', '_island_token' => $token->get('island/action/tasks/unknown')] + $vals;
    self::assertSame(403, $this->act($url, $denied), 'accessAction() denies.');

    foreach (['header', 'tasks'] as $hidden) {
      $placements = self::placements();
      $placements[$hidden]['conditions'] = self::pages('/elsewhere');
      $this->profile()->set('placements', $placements)->save();
      self::assertSame(403, $this->act($url, $vals), "Action while $hidden is hidden.");
      $this->enterPath('/island-test', 'island_test.page', 'POST');
      $host = $this->container->get('island.host_resolver')->resolve(IslandRuntimeId::forHost('embed', 'embed', 'one'));
      self::assertInstanceOf(IslandProfileHost::class, $host);
      self::assertFalse($host->accessIsland('tasks', $this->container->get('current_user'))->isAllowed(), "Refresh while $hidden is hidden.");
      self::assertTrue($host->accessIsland('counter', $this->container->get('current_user'))->isAllowed());
      $this->container->get('request_stack')->pop();
    }
  }

  /**
   * A valid profile passes the form and config import.
   */
  public function testValidProfileIsAccepted(): void {
    self::assertSame([], $this->formErrors($this->profile()));
    self::assertSame([], $this->importErrors($this->profile()));
  }

  /**
   * Broken embedding is refused by the form and by config import.
   */
  #[DataProvider('invalidProfiles')]
  public function testInvalidEmbeddingIsRefused(array $placements, string $named, string $layout = 'island_test:test_hull'): void {
    $profile = $this->profile()->set('placements', $placements)->set('layout', $layout);
    $errors = $this->formErrors($profile);
    self::assertNotEmpty($errors);
    self::assertStringContainsString($named, implode(' ', $errors));
    $errors = $this->importErrors($profile);
    self::assertNotEmpty($errors);
    self::assertStringContainsString($named, implode(' ', $errors));
  }

  /**
   * One invalid profile per refused shape, and the id the error must name.
   */
  public static function invalidProfiles(): \Generator {
    $placements = self::placements();
    $missing = $placements;
    $missing['header']['configuration']['component'] = self::embedding('tasks', 'ghost');
    yield '(a) missing' => [$missing, 'ghost'];

    $disabled = $placements;
    $disabled['tasks']['enabled'] = FALSE;
    yield '(b) disabled' => [$disabled, 'tasks'];

    $outside = $placements;
    $outside['header']['configuration']['component'] = self::embedding('tasks', 'counter');
    yield '(c) outside embedded' => [$outside, 'counter'];

    $unused = $placements;
    $unused['header']['configuration']['component'] = self::embedding();
    yield '(d) referenced zero times' => [$unused, 'tasks'];

    $twice = $placements;
    $twice['header']['configuration']['component'] = self::embedding('tasks', 'tasks');
    yield '(d) referenced twice' => [$twice, 'tasks'];

    yield '(e) layout declares embedded' => [$placements, 'tasks', 'island_test:embedded_slot_layout'];

    $nested = $placements;
    $nested['header']['configuration']['component'] = self::embedding('inner');
    $nested['inner'] = [
      'plugin_id' => 'ui_patterns_component',
      'slot' => 'embedded',
      'configuration' => ['component' => self::embedding('tasks')],
    ];
    yield '(f) nested' => [$nested, 'inner'];
  }

  /**
   * Errors the profile form reports for a profile.
   *
   * @return string[]
   *   Error messages.
   */
  private function formErrors(IslandProfile $profile): array {
    $form_object = $this->container->get('entity_type.manager')->getFormObject('island_profile', 'edit');
    $form_object->setEntity($profile);
    $state = (new FormState())->setValues(['layout' => $profile->getLayoutId()]);
    $form = [];
    $form_object->validateForm($form, $state);
    return array_map('strval', array_values($state->getErrors()));
  }

  /**
   * Errors config import reports when the profile arrives from sync.
   *
   * @return string[]
   *   Error messages.
   */
  private function importErrors(IslandProfile $profile): array {
    $sync = $this->container->get('config.storage.sync');
    $this->copyConfig($this->container->get('config.storage'), $sync);
    $data = $sync->read('island.profile.embed');
    self::assertIsArray($data);
    $data['placements'] = $profile->get('placements');
    $data['layout'] = $profile->getLayoutId();
    $sync->write('island.profile.embed', $data);
    $importer = $this->configImporter();
    try {
      $importer->import();
    }
    catch (ConfigImporterException) {
      return $importer->getErrors();
    }
    return [];
  }

  /**
   * The embedded island's delete link, as the rendered page carries it.
   *
   * @return array{0: string, 1: array<string, string>}
   *   The URL it posts to and the values it posts.
   */
  private function deleteLink(): array {
    $html = $this->renderPage();
    self::assertSame(1, preg_match('/data-hx-post="([^"]+)"/', $html, $post));
    self::assertSame(1, preg_match('/data-hx-vals="([^"]+)"/', $html, $vals));
    return [
      html_entity_decode($post[1]),
      json_decode(html_entity_decode($vals[1]), TRUE),
    ];
  }

  /**
   * Posts an action as a fresh request and returns its status code.
   *
   * The subscriber runs on fresh services, as on a new request; a refusal is
   * its 403 exception.
   */
  private function act(string $url, array $vals): int {
    $request = $this->enterPath($url, 'island_test.page', 'POST');
    $request->setSession($this->container->get('session'));
    $request->request->replace($vals);
    $event = new RequestEvent($this->container->get('http_kernel'), $request, HttpKernelInterface::MAIN_REQUEST);
    try {
      $this->container->get('island.action_subscriber')->onRequest($event);
    }
    catch (AccessDeniedHttpException) {
      return 403;
    }
    finally {
      $this->container->get('request_stack')->pop();
    }
    return $event->getResponse()?->getStatusCode() ?? 0;
  }

  /**
   * Posts island values to a page through the real kernel.
   */
  private function post(string $url, array $vals): Response {
    $request = Request::create($url, 'POST', $vals);
    $request->setSession($this->container->get('session'));
    return $this->container->get('http_kernel')->handle($request);
  }

}
