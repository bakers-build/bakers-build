<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\filter\Entity\FilterFormat;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\og\Entity\OgRole;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\HttpKernelInterface;

/**
 * The instantiate endpoint: POST .../bb_ticket_template/{uuid}/instantiate.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketTemplateEndpointTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  private const PATH = '/jsonapi/bb_ticket_template/bb_ticket_template/%s/instantiate';

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine', 'field', 'og',
    'serialization', 'jsonapi', 'jsonapi_resources', 'link', 'text', 'filter',
    'bb_core',
  ];

  /**
   * An account allowed to instantiate and to see the result.
   */
  private UserInterface $actor;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->installConfig(['jsonapi']);
    // As the shipped config: write operations are enabled.
    $this->config('jsonapi.settings')->set('read_only', FALSE)->save();
    FilterFormat::create(['format' => 'bb_rich', 'name' => 'bakers.build rich'])->save();
    $this->buildTwoWorkspaceWorld();

    $role = OgRole::load('bb_workspace-bb_workspace-contributor');
    self::assertNotNull($role);
    foreach (['use bb_ticket_template', 'view bb_ticket_template'] as $permission) {
      $role->grantPermission($permission);
    }
    $role->save();
    $this->actor = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $this->actor, ['contributor']);
    $this->addMembership($this->fixture('a', 'bb_team'), $this->actor, []);
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Creates a saved template in workspace A's project.
   *
   * @param array<string, mixed> $values
   *   Values overriding the defaults.
   */
  private function createTemplate(array $values = []): BbTicketTemplateInterface {
    $template = $this->createEntity('bb_ticket_template', $values + [
      'name' => 'tpl',
      'enabled' => TRUE,
      'title_pattern' => 'Ticket',
      'description' => ['value' => 'Body', 'format' => 'bb_rich'],
      'workflow' => 'bb_work',
      'target_state' => 'qualification',
      'project_id' => $this->fixture('a', 'bb_project')->id(),
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    self::assertInstanceOf(BbTicketTemplateInterface::class, $template);
    return $template;
  }

  /**
   * Sends a request as an account.
   *
   * @param string $method
   *   The HTTP method.
   * @param string $uuid
   *   The template UUID in the path.
   * @param \Drupal\user\UserInterface $account
   *   The account the request runs as.
   * @param string $body
   *   The request body.
   * @param array<string, string> $cookies
   *   Request cookies.
   */
  private function send(string $method, string $uuid, UserInterface $account, string $body = '', array $cookies = []): Response {
    $this->container->get('current_user')->setAccount($account);
    $request = Request::create(sprintf(self::PATH, $uuid), $method, [], $cookies, [], [], $body);
    $request->headers->set('Accept', 'application/vnd.api+json');
    $request->headers->set('Content-Type', 'application/vnd.api+json');
    return $this->container->get('http_kernel')->handle($request, HttpKernelInterface::SUB_REQUEST);
  }

  /**
   * The route exists at its literal JSON:API path, with the placeholder gone.
   */
  public function testRouteExistsAtLiteralPath(): void {
    $provider = $this->container->get('router.route_provider');
    $path = '/jsonapi/bb_ticket_template/bb_ticket_template/{bb_ticket_template}/instantiate';
    self::assertNotEmpty(iterator_to_array($provider->getRoutesByPattern($path)));
    $route = $provider->getRouteByName('bb_core.ticket_template_instantiate');
    self::assertSame($path, $route->getPath());
    self::assertSame(['POST'], $route->getMethods());
  }

  /**
   * Every call creates a new ticket (201), with or without an empty body.
   */
  public function testSecondCallCreatesAgain(): void {
    $template = $this->createTemplate();

    $first = $this->send('POST', $template->uuid(), $this->actor);
    self::assertSame(201, $first->getStatusCode(), (string) $first->getContent());
    $document = json_decode((string) $first->getContent(), TRUE);
    self::assertSame('bb_ticket--bb_ticket', $document['data']['type']);
    self::assertTrue($document['meta']['created']);

    $second = $this->send('POST', $template->uuid(), $this->actor, '{}');
    self::assertSame(201, $second->getStatusCode(), (string) $second->getContent());
    $again = json_decode((string) $second->getContent(), TRUE);
    self::assertTrue($again['meta']['created']);
    self::assertNotSame($document['data']['id'], $again['data']['id']);
  }

  /**
   * Builds an override document.
   *
   * @param array<string, mixed> $attributes
   *   The attributes.
   * @param array<string, mixed> $relationships
   *   The relationships.
   * @param array<string, mixed> $extra
   *   Further top-level `data` members.
   */
  private static function document(array $attributes = [], array $relationships = [], array $extra = []): string {
    $data = ['type' => 'bb_ticket--bb_ticket'] + $extra;
    if ($attributes !== []) {
      $data['attributes'] = $attributes;
    }
    if ($relationships !== []) {
      $data['relationships'] = $relationships;
    }
    return (string) json_encode(['data' => $data]);
  }

  /**
   * A `project_id` relationship naming a project UUID.
   *
   * @return array<string, mixed>
   *   The relationships member.
   */
  private static function project(string $uuid): array {
    return ['project_id' => ['data' => ['type' => 'bb_project--bb_project', 'id' => $uuid]]];
  }

  /**
   * Attribute and relationship overrides reach the created ticket.
   */
  public function testBodyOverridesAreApplied(): void {
    $template = $this->createTemplate();
    $project = $this->fixture('a', 'bb_project');
    $body = self::document(
      ['title' => 'Custom {{month}}', 'description' => ['value' => 'Custom body']],
      self::project((string) $project->uuid()),
    );

    $response = $this->send('POST', $template->uuid(), $this->actor, $body);

    self::assertSame(201, $response->getStatusCode(), (string) $response->getContent());
    $document = json_decode((string) $response->getContent(), TRUE);
    self::assertStringStartsWith('Custom 20', $document['data']['attributes']['title']);
    self::assertSame('Custom body', trim($document['data']['attributes']['description']['value']));
    self::assertSame($project->uuid(), $document['data']['relationships']['project_id']['data']['id']);
  }

  /**
   * Malformed JSON, a foreign type or a client id is a 400.
   */
  public function testMalformedBodyIs400(): void {
    $template = $this->createTemplate();
    $bodies = [
      'malformed' => '{"data":',
      'wrong type' => (string) json_encode(['data' => ['type' => 'bb_project--bb_project']]),
      'client id' => self::document([], [], ['id' => '11111111-2222-4333-8444-555555555555']),
    ];
    foreach ($bodies as $case => $body) {
      self::assertSame(400, $this->send('POST', $template->uuid(), $this->actor, $body)->getStatusCode(), $case);
    }
  }

  /**
   * A field outside the overridable set is a 422.
   */
  public function testUnknownFieldIs422(): void {
    $template = $this->createTemplate();
    $owner = ['data' => ['type' => 'user--user', 'id' => $this->actor->uuid()]];
    foreach ([self::document(['state' => 'working']), self::document([], ['owner_user_id' => $owner])] as $body) {
      self::assertSame(422, $this->send('POST', $template->uuid(), $this->actor, $body)->getStatusCode(), $body);
    }
  }

  /**
   * A value of the wrong type is a 422, never cast into the ticket.
   */
  public function testNonStringValueIs422(): void {
    $template = $this->createTemplate();
    $bodies = [
      self::document(['title' => ['x']]),
      self::document(['workflow' => 5]),
      self::document(['description' => 5]),
      self::document(['description' => ['value' => ['x']]]),
      (string) json_encode(['data' => ['type' => 'bb_ticket--bb_ticket'], 'meta' => ['target_state' => ['x']]]),
    ];
    foreach ($bodies as $body) {
      self::assertSame(422, $this->send('POST', $template->uuid(), $this->actor, $body)->getStatusCode(), $body);
    }
  }

  /**
   * A relationship UUID that resolves to nothing is a 422.
   */
  public function testUnresolvableUuidIs422(): void {
    $template = $this->createTemplate();
    $body = self::document([], self::project('11111111-2222-4333-8444-555555555555'));
    self::assertSame(422, $this->send('POST', $template->uuid(), $this->actor, $body)->getStatusCode());
  }

  /**
   * A workspace template needs the project in the body.
   */
  public function testWorkspaceTemplateWithoutProjectIs422(): void {
    $template = $this->createTemplate([
      'project_id' => NULL,
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
    ]);
    self::assertSame(422, $this->send('POST', $template->uuid(), $this->actor)->getStatusCode());

    $project = $this->fixture('a', 'bb_project');
    $body = self::document([], self::project((string) $project->uuid()));
    $response = $this->send('POST', $template->uuid(), $this->actor, $body);
    self::assertSame(201, $response->getStatusCode(), (string) $response->getContent());
  }

  /**
   * Without the permission the route is closed (403).
   */
  public function testMissingPermissionIs403(): void {
    $template = $this->createTemplate();
    $nobody = $this->createAccount('endpoint-nobody');
    self::assertSame(403, $this->send('POST', $template->uuid(), $nobody)->getStatusCode());
  }

  /**
   * Unknown and disabled templates are 404.
   */
  public function testUnknownAndDisabledTemplatesAre404(): void {
    self::assertSame(404, $this->send('POST', '11111111-2222-4333-8444-555555555555', $this->actor)->getStatusCode());
    $disabled = $this->createTemplate(['enabled' => FALSE]);
    self::assertSame(404, $this->send('POST', $disabled->uuid(), $this->actor)->getStatusCode());
  }

  /**
   * A template that renders an invalid ticket is a 422.
   */
  public function testBadTemplateIs422(): void {
    $template = $this->createTemplate(['title_pattern' => 'Report {{bogus}}']);
    self::assertSame(422, $this->send('POST', $template->uuid(), $this->actor)->getStatusCode());
  }

  /**
   * A cookie session must present the CSRF header token.
   */
  public function testCookieSessionWithoutCsrfTokenIsDenied(): void {
    $template = $this->createTemplate();
    $request = Request::create(sprintf(self::PATH, $template->uuid()), 'POST');
    $session_name = $this->container->get('session_configuration')->getOptions($request)['name'];

    $response = $this->send('POST', $template->uuid(), $this->actor, '', [$session_name => 'x']);
    self::assertSame(403, $response->getStatusCode());
  }

  /**
   * Only POST is routed.
   */
  public function testGetIsNotAllowed(): void {
    $template = $this->createTemplate();
    self::assertSame(405, $this->send('GET', $template->uuid(), $this->actor)->getStatusCode());
  }

}
