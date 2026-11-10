<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Utility\Crypt;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Form\EnforcedResponseException;
use Drupal\Core\Form\FormState;
use Drupal\Core\Template\Attribute;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbInvite;
use Drupal\bb_core\Form\BbContentEntityFormBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * Every delete form answers as a dialog over the page, and as a page.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class DeleteDialogTest extends KernelTestBase {

  use UserCreationTrait {
    createUser as private;
  }
  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og', 'views',
    'island', 'bb_core', 'bb_connector',
  ];

  /**
   * The screen a trigger opens the dialog over.
   */
  private const string UNDER = '/under/the/dialog?tab=2';

  /**
   * A minimal valid measurement.
   */
  private const array MEASUREMENT = [
    'label' => 'Probe count',
    'value_type' => 'integer',
    'source' => ['entity_type' => 'bb_ticket', 'time_field' => 'created'],
    'operation' => ['type' => 'count'],
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->installConfig(['system', 'filter']);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->buildTwoWorkspaceWorld();
    // Outbound links without a route context carry the default slug.
    $this->fixture('a', 'bb_workspace')->set('slug', 'bakers')->save();
    $this->setCurrentUser($this->createAccount('site-admin', ['administer bakers']));
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * The delete routes of the content inventory.
   *
   * @return array<string, array{string, bool}>
   *   The entity type of each case, and whether this world blocks its delete.
   */
  public static function contentTypes(): array {
    $cases = [];
    foreach ([
      'bb_ticket' => FALSE,
      'bb_project' => TRUE,
      'bb_team' => TRUE,
      'bb_group' => TRUE,
      'bb_environment' => FALSE,
      'bb_ticket_template' => FALSE,
      'bb_term' => FALSE,
      'bb_comment' => FALSE,
      'bb_run' => FALSE,
      'bb_workspace' => TRUE,
      'bb_conductor' => FALSE,
      'bb_machine' => FALSE,
    ] as $type => $blocked) {
      $cases[$type] = [$type, $blocked];
    }
    return $cases;
  }

  /**
   * The dialog format answers the hull: title, form, actions in the footer.
   */
  #[DataProvider('contentTypes')]
  public function testDialogFormatAnswersTheHull(string $type, bool $blocked): void {
    $this->assertDialog($this->fixture('a', $type), $blocked);
  }

  /**
   * A config entity's Delete stays core's page; its list opens no overlay.
   *
   * @param string $type
   *   The config entity type.
   * @param array<string, mixed> $values
   *   The values of a minimal entity of it.
   */
  #[DataProvider('configTypes')]
  public function testConfigDeleteKeepsThePage(string $type, array $values): void {
    $this->setCurrentUser($this->createAccount('config-admin', [
      'administer bakers',
      'administer island apps',
      'administer island profiles',
      'administer permissions',
    ]));
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_measurement');
    $storage->create(['id' => 'probe_count'] + self::MEASUREMENT)->save();
    $entity = $this->container->get('entity_type.manager')->getStorage($type)->create($values);
    $entity->save();
    $this->openScreenUnder();

    $operation = $this->container->get('entity_type.manager')->getListBuilder($type)->getOperations($entity)['delete'] ?? [];
    $markup = (string) $this->get($entity->toUrl('delete-form')->toString())->getContent();

    self::assertArrayNotHasKey('data-hx-get', $operation['attributes'] ?? [], 'the list operation opens no overlay');
    self::assertStringContainsString('<html', $markup, 'the delete route renders a page');
    self::assertMatchesRegularExpression('/<form[^>]*-delete-form/', $markup);
    self::assertStringNotContainsString('hx-post', $markup);
  }

  /**
   * The config entities that keep core's delete page.
   *
   * @return array<string, array{string, array<string, mixed>}>
   *   The entity type and minimal values of each case.
   */
  public static function configTypes(): array {
    return [
      'bb_figure' => [
        'bb_figure',
        [
          'id' => 'probe',
          'label' => 'Probe figure',
          'widget' => 'tiles',
          'measurements' => ['probe_count'],
          'categories' => ['type' => 'total'],
        ],
      ],
      'bb_figure_group' => ['bb_figure_group', ['id' => 'probe', 'label' => 'Probe group']],
      'bb_measurement' => ['bb_measurement', ['id' => 'probe', 'label' => 'Probe measurement'] + self::MEASUREMENT],
      'bb_connector' => ['bb_connector', ['id' => 'probe', 'label' => 'Probe connector']],
      'island_app' => ['island_app', ['id' => 'probe', 'label' => 'Probe app', 'provider' => 'bb_core']],
      'island_profile' => ['island_profile', ['id' => 'probe', 'label' => 'Probe profile']],
      'user_role' => ['user_role', ['id' => 'probe', 'label' => 'Probe role']],
    ];
  }

  /**
   * Opens an entity's delete route through the dialog format and checks it.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  private function assertDialog(EntityInterface $entity, bool $blocked): void {
    $response = $this->get($entity->toUrl('delete-form')->toString() . '?_wrapper_format=island_dialog&destination=' . urlencode(self::UNDER));

    $markup = (string) $response->getContent();
    self::assertSame(200, $response->getStatusCode());
    self::assertStringNotContainsString('<html class', $markup, 'a fragment, not the page');
    self::assertMatchesRegularExpression('/<dialog[^>]*data-dialog/', $markup);
    self::assertMatchesRegularExpression('/<h2 id="bakers-dialog__title" class="dialog__title[^"]*">Delete /', $markup);
    self::assertMatchesRegularExpression('/<form[^>]*hx-post="[^"]*_wrapper_format=island_dialog/', $markup);
    [, $footer] = explode('class="dialog__actions', $markup, 2) + [1 => ''];
    self::assertMatchesRegularExpression('/<a[^>]*data-dialog-cancel[^>]*href="' . preg_quote(htmlspecialchars(self::UNDER), '/') . '"/', $footer, 'cancel closes to the screen underneath');
    if ($blocked) {
      self::assertStringNotContainsString('type="submit"', $markup, 'a blocked delete offers no confirm');
      self::assertStringContainsString('>Close<', $footer);
    }
    else {
      self::assertMatchesRegularExpression('/<button[^>]*form="[^"]*"[^>]*type="submit"/', $footer, 'the confirm sits in the footer');
    }
  }

  /**
   * Without the format the same route renders the confirm form as a page.
   */
  #[DataProvider('contentTypes')]
  public function testRouteWithoutTheFormatRendersThePage(string $type): void {
    $entity = $this->fixture('a', $type);

    $response = $this->get($entity->toUrl('delete-form')->toString());

    self::assertSame(200, $response->getStatusCode());
    $markup = (string) $response->getContent();
    self::assertStringContainsString('<html', $markup);
    self::assertStringNotContainsString('hx-post', $markup);
    self::assertMatchesRegularExpression('/<form[^>]*-delete-form/', $markup);
  }

  /**
   * Confirming in the dialog deletes and lands on today's redirect target.
   */
  public function testDialogConfirmLandsOnTheFormsRedirect(): void {
    $environment = $this->fixture('a', 'bb_environment');
    $project = $this->fixture('a', 'bb_project');

    $response = $this->confirmInDialog($environment);

    self::assertNull($this->reload($environment), 'the environment is deleted');
    self::assertSame(200, $response->getStatusCode());
    $location = (string) $response->headers->get('HX-Location');
    self::assertSame('/bakers/project/' . $project->id() . '/settings', $location, 'the project settings, not the destination');
    self::assertSame(
      ['Deleted <em class="placeholder">env-a</em>.'],
      array_map('strval', $this->container->get('messenger')->messagesByType('status')),
    );
  }

  /**
   * A conductor, machine or run delete lands on a product page.
   */
  public function testDeleteLandsInTheProduct(): void {
    $this->installUserListStubs();
    $user = $this->container->get('current_user')->id();
    $machine = $this->fixture('a', 'bb_machine');
    $run = $this->fixture('a', 'bb_run');
    $expected = [
      'bb_conductor' => [$this->fixture('a', 'bb_conductor'), '/user/' . $user . '/conductors'],
      'bb_machine' => [$machine, '/user/' . $machine->get('owner_user_id')->target_id . '/machines'],
      'bb_run' => [$run, $this->fixture('a', 'bb_ticket')->toUrl()->toString()],
    ];

    foreach ($expected as $type => [$entity, $landing]) {
      $response = $this->confirmInDialog($entity);

      self::assertNull($this->reload($entity), $type . ' is deleted');
      self::assertSame($landing, (string) $response->headers->get('HX-Location'), $type . ' lands in the product');
    }
  }

  /**
   * Registers the two account listings a delete lands on.
   */
  private function installUserListStubs(): void {
    $this->installConfig(['views']);
    $storage = $this->container->get('entity_type.manager')->getStorage('view');
    foreach (['conductors', 'machines'] as $id) {
      $storage->create([
        'id' => $id,
        'base_table' => 'users_field_data',
        'display' => [
          'default' => [
            'display_plugin' => 'default',
            'id' => 'default',
            'display_title' => 'Default',
            'position' => 0,
            'display_options' => [],
          ],
          'user_list' => [
            'display_plugin' => 'page',
            'id' => 'user_list',
            'display_title' => 'User list',
            'position' => 1,
            'display_options' => ['path' => 'user/%user/' . $id],
          ],
        ],
      ])->save();
    }
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * A blocked delete warns, names and links its blockers, and offers Close.
   */
  public function testBlockedDeleteNamesItsBlockers(): void {
    $project = $this->fixture('a', 'bb_project');
    $ticket = $this->fixture('a', 'bb_ticket');

    $markup = (string) $this->get($project->toUrl('delete-form')->toString() . '?_wrapper_format=island_dialog')->getContent();

    self::assertMatchesRegularExpression('/data-component-id="bb_theme:message"[^>]*>.*project-a<\/em> can\'t be deleted: 1 bakers\.build ticket still uses it\. Remove or reassign it first\./s', $markup, 'the counts per type');
    self::assertMatchesRegularExpression('/<h3>bakers\.build ticket \(1\)<\/h3>\s*<ul><li><a href="[^"]*' . preg_quote((string) $ticket->toUrl()->toString(), '/') . '"[^>]*>ticket-a<\/a>/', $markup, 'blockers are grouped and linked');
    self::assertStringNotContainsString('This action cannot be undone', $markup);
  }

  /**
   * A delete that takes others along says so in an attention note.
   */
  public function testCascadeIsAnAttentionNote(): void {
    $markup = (string) $this->get($this->fixture('a', 'bb_ticket')->toUrl('delete-form')->toString() . '?_wrapper_format=island_dialog')->getContent();

    self::assertMatchesRegularExpression('/data-component-id="bb_theme:note" class="[^"]*border-state-attention[^"]*">.*This also deletes [^<]*\b1 bakers\.build comment\b[^<]*:.*<h3>bakers\.build comment \(1\)<\/h3>/s', $markup);
  }

  /**
   * A blocker that appears while the dialog is open blocks; nothing is deleted.
   */
  public function testBlockerAddedWhileOpenRerendersBlocked(): void {
    // The race: the dialog opened unblocked, and by the time its confirm is
    // posted something uses the project. The post rebuilds the form, so a
    // project blocked at post time is that moment.
    $project = $this->fixture('a', 'bb_project');

    [$form, $form_state, $response] = $this->postDelete($project);

    self::assertNull($response, 'no landing');
    self::assertNotNull($this->reload($project), 'nothing is deleted');
    self::assertSame([], array_map('strval', $form_state->getErrors()), 'a blocked dialog, not a form error');
    self::assertFalse($form['#island_hull_actions']['submit']['#access'], 'the answer is the blocked dialog');
    self::assertContains(['hx-retarget', '#bakers-overlay', TRUE], $form['#attached']['http_header'], 'the whole dialog is swapped');
  }

  /**
   * The Delete action of edit forms and detail cards opens the overlay.
   */
  public function testDeleteActionOpensTheOverlay(): void {
    $ticket = $this->fixture('a', 'bb_ticket');
    $this->openScreenUnder();

    $action = BbContentEntityFormBase::deleteAction($ticket)['delete'];

    self::assertSame($ticket->toUrl('delete-form')->toString(), $action['#props']['href'], 'the page link stays for no JavaScript');
    self::assertInstanceOf(Attribute::class, $action['#props']['attributes']);
    $this->assertOpensOverlay($ticket->toUrl('delete-form')->toString(), $action['#props']['attributes']->toArray());
  }

  /**
   * The Members screen's invite revoke opens the overlay.
   */
  public function testInviteRevokeOpensTheOverlay(): void {
    $invite = $this->createEntity('bb_invite', [
      'email' => 'invitee@example.com',
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
    ]);
    self::assertInstanceOf(BbInvite::class, $invite);
    $this->openScreenUnder();

    $remove = $this->container->get('bb_core.workspace_invite')->inviteItems([$invite], TRUE)['controls'][0]['remove'];

    self::assertSame($invite->toUrl('delete-form')->toString(), $remove['#props']['href']);
    $this->assertOpensOverlay($invite->toUrl('delete-form')->toString(), $remove['#props']['attributes']->toArray());
  }

  /**
   * A list's Delete operation opens the overlay instead of core's modal.
   */
  public function testListDeleteOperationOpensTheOverlay(): void {
    $run = $this->fixture('a', 'bb_run');
    $this->openScreenUnder();

    $operation = $this->container->get('entity_type.manager')->getListBuilder('bb_run')->getOperations($run)['delete'];

    self::assertArrayNotHasKey('class', $operation['attributes'], 'no core use-ajax modal');
    self::assertArrayNotHasKey('data-dialog-type', $operation['attributes']);
    $this->assertOpensOverlay($run->toUrl('delete-form')->toString(), $operation['attributes']);
  }

  /**
   * Makes UNDER the screen being rendered.
   */
  private function openScreenUnder(): void {
    $request = Request::create(self::UNDER);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
  }

  /**
   * Asserts htmx attributes that open a route's dialog over UNDER.
   *
   * @param string $path
   *   The delete route's path.
   * @param array<string, mixed> $attributes
   *   The trigger's attributes.
   */
  private function assertOpensOverlay(string $path, array $attributes): void {
    $get = (string) ($attributes['data-hx-get'] ?? '');
    self::assertStringStartsWith($path . '?', $get);
    parse_str((string) parse_url($get, PHP_URL_QUERY), $query);
    self::assertSame('island_dialog', $query['_wrapper_format'] ?? NULL);
    self::assertSame(self::UNDER, $query['destination'] ?? NULL);
    self::assertSame('#bakers-overlay', $attributes['data-hx-target'] ?? NULL);
    self::assertSame('dialog:not(dialog dialog)', $attributes['data-hx-select'] ?? NULL);
    self::assertStringStartsWith('innerHTML', (string) ($attributes['data-hx-swap'] ?? ''));
  }

  /**
   * Requests a path through the full kernel.
   */
  private function get(string $path): Response {
    $request = Request::create($path);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $response = $this->container->get('http_kernel')->handle($request);
    $this->container->get('request_stack')->pop();
    return $response;
  }

  /**
   * Posts an entity's delete form the way the dialog does; expects a landing.
   */
  private function confirmInDialog(EntityInterface $entity): Response {
    [, $form_state, $response] = $this->postDelete($entity);
    self::assertInstanceOf(Response::class, $response, 'The dialog answers a response: ' . json_encode(array_map('strval', $form_state->getErrors())));
    return $response;
  }

  /**
   * Posts an entity's delete form the way the dialog does.
   *
   * @return array{0: array<string, mixed>, 1: \Drupal\Core\Form\FormStateInterface, 2: ?\Symfony\Component\HttpFoundation\Response}
   *   The built form, its state and the response it answered with, if any.
   */
  private function postDelete(EntityInterface $entity): array {
    $form_object = $this->container->get('entity_type.manager')
      ->getFormObject($entity->getEntityTypeId(), 'delete')
      ->setEntity($entity);
    $form_id = $form_object->getFormId();
    $request = Request::create(
      $entity->toUrl('delete-form')->toString() . '?_wrapper_format=island_dialog&destination=' . urlencode(self::UNDER),
      'POST',
      [
        'op' => 'Delete',
        'confirm' => '1',
        'form_id' => $form_id,
        'form_token' => $this->container->get('csrf_token')->get('form_token_placeholder_' . Crypt::hashBase64($form_id)),
      ],
      [],
      [],
      // An htmx post, on which core disables form redirects.
      ['HTTP_HX_REQUEST' => 'true'],
    );
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $form_state = new FormState();
    try {
      $form = $this->container->get('form_builder')->buildForm($form_object, $form_state);
      return [$form, $form_state, NULL];
    }
    catch (EnforcedResponseException $answer) {
      return [[], $form_state, $answer->getResponse()];
    }
    finally {
      $this->container->get('request_stack')->pop();
    }
  }

  /**
   * Loads an entity afresh.
   */
  private function reload(EntityInterface $entity): ?EntityInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage($entity->getEntityTypeId());
    $storage->resetCache([$entity->id()]);
    return $storage->load($entity->id());
  }

}
