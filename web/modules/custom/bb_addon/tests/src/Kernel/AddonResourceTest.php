<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_addon\Kernel;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_addon\Entity\BbAddonInterface;
use Drupal\bb_addon\Resource\AddonsRegisterResource;
use Drupal\bb_addon\Resource\TicketAddonsResource;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\jsonapi\JsonApiResource\ResourceObject;
use Drupal\jsonapi\ResourceResponse;
use Drupal\jsonapi_resources\Resource\EntityResourceBase;
use Drupal\jsonapi_resources\Resource\ResourceBase;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_inbox\Kernel\InboxWorldTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * Registration and the ticket read model.
 */
#[Group('bb_addon')]
#[RunTestsInSeparateProcesses]
final class AddonResourceTest extends KernelTestBase {

  use AddonFixtureTrait;
  use InboxWorldTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'file', 'image',
    'serialization', 'jsonapi', 'jsonapi_resources',
    'bb_core', 'bb_inbox', 'bb_addon',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installConfig(['jsonapi']);
    $this->buildInboxWorld();
    $this->installEntitySchema('bb_addon');
  }

  /**
   * Registration stores the definition and lists the conductor on it.
   */
  public function testRegisterUpsertsAndListsConductor(): void {
    [$status, $data] = $this->registerAddons($this->conductor, [self::portsDefinition()]);
    self::assertSame(200, $status);
    self::assertSame([], $data['rejected']);
    self::assertCount(1, $data['accepted']);
    $addon = $this->addon('ports', '1.2.3');
    self::assertSame($addon->uuid(), $data['accepted'][0]['id']);
    self::assertTrue($addon->runsOn($this->conductor));

    [$status] = $this->registerAddons($this->conductor, [self::portsDefinition()]);
    self::assertSame(200, $status);
    self::assertCount(1, $this->addons());
  }

  /**
   * Different workspaces registering the same name@version stay isolated.
   *
   * Two conductors in different workspaces get separate rows; neither's
   * metadata or conductor association leaks into the other's workspace
   * (BB-660/661 AC-12).
   */
  public function testOtherWorkspaceRegistrationIsIsolated(): void {
    $ownerB = $this->workspaceMember('b', $this->createAccount('owner-b', ['register bakers conductor']), 'contributor');
    $conductorB = $this->createEntity('bb_conductor', [
      'conductor_id' => 'node-owner-b',
      'label' => 'node-owner-b',
      'project_id' => $this->fixture('b', 'bb_project')->id(),
      'owner_user_id' => $ownerB->id(),
      'status' => 'online',
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $conductorB);
    $definitionA = self::portsDefinition('1.0.0');
    $definitionA['label'] = 'A';
    $definitionB = self::portsDefinition('1.0.0');
    $definitionB['label'] = 'B';

    [$statusA, $dataA] = $this->registerAddons($this->conductor, [$definitionA]);
    [$statusB, $dataB] = $this->registerAddons($conductorB, [$definitionB], $ownerB);
    self::assertSame([200, 200], [$statusA, $statusB]);
    self::assertSame([[], []], [$dataA['rejected'], $dataB['rejected']]);
    self::assertNotSame($dataA['accepted'][0]['id'], $dataB['accepted'][0]['id']);

    $rows = $this->addonsByLabel();
    self::assertSame(['A', 'B'], array_keys($rows));
    self::assertSame([(int) $this->conductor->id()], $this->conductorIds($rows['A']));
    self::assertSame([(int) $conductorB->id()], $this->conductorIds($rows['B']));
    $repository = $this->container->get('bb_addon.repository');
    self::assertSame('A', $repository->forConductor($this->conductor)['ports']->label());
    self::assertSame('B', $repository->forConductor($conductorB)['ports']->label());
    self::assertNotSame($rows['A']->workspaceId(), $rows['B']->workspaceId());
    self::assertSame(['A'], array_map(
      static fn (BbAddonInterface $a): string => $a->label(),
      $repository->rowsOf('ports', $rows['A']->workspaceId()),
    ), "Workspace A's rowsOf() must not see workspace B's row of the same name.");
  }

  /**
   * Loosely equal definitions are still different definitions.
   *
   * `"1.0" == "1"` in PHP must not let two conductors share a row whose
   * definition only one of them sent.
   */
  public function testLooselyEqualDefinitionsGetSeparateRows(): void {
    $second = $this->createConductor('node-loose', $this->conductorOwner);
    $one = self::portsDefinition();
    $one['label'] = '1.0';
    $other = self::portsDefinition();
    $other['label'] = '1';
    $this->registerAddons($this->conductor, [$one]);
    $this->registerAddons($second, [$other]);
    $pairs = array_map(
      fn (BbAddonInterface $addon): string => $addon->label() . ':' . implode(',', $this->conductorIds($addon)),
      array_values($this->addonsByLabel()),
    );
    sort($pairs);
    self::assertSame(['1.0:' . $this->conductor->id(), '1:' . $second->id()], $pairs);
  }

  /**
   * Conductors sending an identical definition share one row.
   */
  public function testIdenticalDefinitionSharesRow(): void {
    $second = $this->createConductor('node-second', $this->conductorOwner);
    $this->registerAddons($this->conductor, [self::portsDefinition()]);
    $this->registerAddons($second, [self::portsDefinition()]);
    self::assertCount(1, $this->addons());
    $addon = $this->addon('ports', '1.2.3');
    self::assertTrue($addon->runsOn($this->conductor));
    self::assertTrue($addon->runsOn($second));
  }

  /**
   * A differing definition at the same name@version gets its own row.
   *
   * Another member's earlier registration never sets the access level or
   * input schema of a message on my conductor.
   */
  public function testDifferingDefinitionAtSameIdentityGetsItsOwnRow(): void {
    $other = $this->workspaceMember('a', $this->createAccount('owner-other', ['register bakers conductor']), 'contributor');
    $otherConductor = $this->createEntity('bb_conductor', [
      'conductor_id' => 'node-owner-other',
      'label' => 'node-owner-other',
      'project_id' => $this->fixture('a', 'bb_project')->id(),
      'owner_user_id' => $other->id(),
      'status' => 'online',
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $otherConductor);
    $theirs = self::portsDefinition('1.2.3');
    $theirs['label'] = 'X';
    $mine = self::portsDefinition('1.2.3');
    $mine['label'] = 'Y';
    $mine['messages']['up']['access'] = 'update';
    $this->registerAddons($otherConductor, [$theirs], $other);
    [$status] = $this->registerAddons($this->conductor, [$mine]);
    self::assertSame(200, $status);

    $rows = $this->addonsByLabel();
    self::assertSame(['X', 'Y'], array_keys($rows));
    self::assertSame([(int) $otherConductor->id()], $this->conductorIds($rows['X']));
    self::assertSame([(int) $this->conductor->id()], $this->conductorIds($rows['Y']));
    $repository = $this->container->get('bb_addon.repository');
    self::assertSame('update', $repository->forConductor($this->conductor)['ports']->message('up')['access']);
    self::assertSame('view', $repository->forConductor($otherConductor)['ports']->message('up')['access']);
  }

  /**
   * An invalid definition is rejected and the conductor is not listed.
   */
  public function testRegisterRejectsInvalidDefinition(): void {
    $bad = self::portsDefinition();
    $bad['messages']['up']['input']['properties']['port'] = ['type' => 'object', 'properties' => []];
    [$status, $data] = $this->registerAddons($this->conductor, [$bad]);
    self::assertSame(422, $status);
    self::assertSame('ports', $data['rejected'][0]['name']);
    self::assertNotSame('', $data['rejected'][0]['error']);
    self::assertSame([], $this->addons());

    $fake = self::portsDefinition();
    $fake['name'] = 'fake';
    [$status, $data] = $this->registerAddons($this->conductor, [$bad, $fake]);
    self::assertSame(200, $status, 'Partial success still registers the rest.');
    self::assertCount(1, $data['rejected']);
    self::assertCount(1, $data['accepted']);
  }

  /**
   * A new version takes the conductor; the newest row wins a tie.
   */
  public function testRegistrationMovesConductorToNewVersion(): void {
    $this->registerAddons($this->conductor, [self::portsDefinition('1.2.3')]);
    $this->registerAddons($this->conductor, [self::portsDefinition('1.3.0')]);
    self::assertFalse($this->addon('ports', '1.2.3')->runsOn($this->conductor));
    self::assertTrue($this->addon('ports', '1.3.0')->runsOn($this->conductor));

    // An upgrade race: both rows list the conductor. The newest changed wins.
    $old = $this->addon('ports', '1.2.3');
    $old->addConductor($this->conductor)->save();
    $new = $this->addon('ports', '1.3.0');
    $new->set('changed', $old->getChangedTime() + 10)->save();
    $resolved = $this->container->get('bb_addon.repository')->resolve($this->conductor, 'ports.up');
    self::assertNotNull($resolved);
    self::assertSame('1.3.0', $resolved[0]->version());
    self::assertSame('up', $resolved[1]);
  }

  /**
   * Two conductors with two versions produce two coexisting rows.
   */
  public function testTwoConductorsTwoVersionsCoexist(): void {
    $secondOwner = $this->createAccount('second-owner', ['register bakers conductor']);
    $second = $this->createConductor('node-second', $secondOwner);
    $this->registerAddons($this->conductor, [self::portsDefinition('1.2.3')]);
    $this->registerAddons($second, [self::portsDefinition('2.0.0')], $secondOwner);
    self::assertCount(2, $this->addons());
    self::assertTrue($this->addon('ports', '1.2.3')->runsOn($this->conductor));
    self::assertTrue($this->addon('ports', '2.0.0')->runsOn($second));
    self::assertFalse($this->addon('ports', '2.0.0')->runsOn($this->conductor));
  }

  /**
   * The read model filters messages by the viewer's ticket access.
   */
  public function testTicketReadModelFiltersActionsByAccess(): void {
    $this->registerAddons($this->conductor, [self::portsDefinition()]);
    $this->send($this->guest, 'ports.up', ['port' => 443]);

    $model = $this->readModel($this->guest);
    self::assertSame('online', $model['conductor']['status']);
    self::assertCount(1, $model['addons']);
    $ports = $model['addons'][0];
    self::assertSame(
      ['ports', '1.2.3', 2, 'Ports'],
      [$ports['name'], $ports['version'], $ports['contract'], $ports['label']],
    );
    $access = array_column($ports['messages'], 'access_ok', 'key');
    self::assertSame(['up' => TRUE, 'down' => TRUE, 'reap' => FALSE], $access);
    self::assertSame(
      ['up', 'Share', 'pending'],
      [$ports['latest']['action'], $ports['latest']['label'], $ports['latest']['status']],
    );

    $editorMessages = $this->readModel($this->contributor)['addons'][0]['messages'];
    self::assertTrue(array_column($editorMessages, 'access_ok', 'key')['reap']);

    $this->ticket->set('conductor_id', NULL)->save();
    self::assertSame([], $this->readModel($this->guest)['addons']);
  }

  /**
   * The read model carries the addon's newest message, not one per message.
   */
  public function testReadModelCarriesOnlyTheNewestMessage(): void {
    $this->registerAddons($this->conductor, [self::portsDefinition()]);
    $this->send($this->guest, 'ports.up', ['port' => 443]);
    $this->send($this->guest, 'ports.down', ['port' => 443]);

    $ports = $this->readModel($this->guest)['addons'][0];
    self::assertSame(['down', 'Stop', 'pending'], [
      $ports['latest']['action'],
      $ports['latest']['label'],
      $ports['latest']['status'],
    ]);
    foreach ($ports['messages'] as $message) {
      self::assertArrayNotHasKey('latest', $message);
    }
  }

  /**
   * Without any message the read model's latest is NULL.
   */
  public function testReadModelLatestIsNullWithoutMessages(): void {
    $this->registerAddons($this->conductor, [self::portsDefinition()]);
    self::assertNull($this->readModel($this->guest)['addons'][0]['latest']);
  }

  /**
   * Addon rows are not readable through generic entity access.
   *
   * Rows are per definition and so per tenant; product readers check ticket
   * or conductor access themselves.
   */
  public function testAddonRowsAreNotGenericallyReadable(): void {
    $this->registerAddons($this->conductor, [self::portsDefinition()]);
    $addon = $this->addon('ports', '1.2.3');
    self::assertFalse($addon->access('view', $this->guest));
    self::assertFalse($addon->access('view', $this->conductorOwner));
    self::assertTrue($addon->access('view', $this->createAccount('addon-admin', ['administer bakers'])));
  }

  /**
   * Posts a registration; returns status and data.
   *
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The registering conductor.
   * @param array<int, array<string, mixed>> $definitions
   *   The definitions.
   * @param \Drupal\Core\Session\AccountInterface|null $account
   *   The caller; defaults to the conductor owner.
   *
   * @return array{0: int, 1: array<string, mixed>}
   *   Status and decoded data.
   */
  private function registerAddons(BbConductorInterface $conductor, array $definitions, ?AccountInterface $account = NULL): array {
    $this->container->get('current_user')->setAccount($account ?? $this->conductorOwner);
    $response = $this->resource(AddonsRegisterResource::class)->process($this->jsonRequest([
      'conductor_id' => $conductor->get('conductor_id')->value,
      'addons' => $definitions,
    ]));
    return [$response->getStatusCode(), $this->data($response, ['accepted', 'rejected'])];
  }

  /**
   * Reads the ticket read model as the given account.
   *
   * @return array<string, mixed>
   *   The decoded data.
   */
  private function readModel(AccountInterface $account): array {
    $this->container->get('current_user')->setAccount($account);
    $response = $this->resource(TicketAddonsResource::class)->process(Request::create('/', 'GET'), $this->ticket);
    self::assertSame(200, $response->getStatusCode());
    return $this->data($response, ['conductor', 'addons']);
  }

  /**
   * Loads the addon row of a name and version.
   */
  private function addon(string $name, string $version): BbAddonInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_addon');
    $storage->resetCache();
    $rows = $storage->loadByProperties(['name' => $name, 'version' => $version]);
    $addon = reset($rows);
    self::assertInstanceOf(BbAddonInterface::class, $addon);
    return $addon;
  }

  /**
   * All addon rows keyed by label, freshly loaded.
   *
   * @return array<string, \Drupal\bb_addon\Entity\BbAddonInterface>
   *   The rows, sorted by label.
   */
  private function addonsByLabel(): array {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_addon');
    $storage->resetCache();
    $rows = [];
    foreach ($storage->loadMultiple() as $addon) {
      self::assertInstanceOf(BbAddonInterface::class, $addon);
      $rows[$addon->label()] = $addon;
    }
    ksort($rows);
    return $rows;
  }

  /**
   * The ids of the conductors listed on a row.
   *
   * @return array<int>
   *   The conductor ids.
   */
  private function conductorIds(BbAddonInterface $addon): array {
    return array_map('intval', array_column($addon->get('conductors')->getValue(), 'target_id'));
  }

  /**
   * All addon rows.
   *
   * @return \Drupal\Core\Entity\EntityInterface[]
   *   The rows.
   */
  private function addons(): array {
    return $this->container->get('entity_type.manager')->getStorage('bb_addon')->loadMultiple();
  }

  /**
   * The named fields of the response's single resource object.
   *
   * @param \Drupal\jsonapi\ResourceResponse $response
   *   The response.
   * @param array<string> $fields
   *   The field names.
   *
   * @return array<string, mixed>
   *   The values.
   */
  private function data(ResourceResponse $response, array $fields): array {
    $object = $response->getResponseData()->getData()->getIterator()->current();
    self::assertInstanceOf(ResourceObject::class, $object);
    $values = [];
    foreach ($fields as $field) {
      $values[$field] = $object->getField($field);
    }
    return $values;
  }

  /**
   * Builds a JSON:API style request carrying data.attributes.
   *
   * @param array<string, mixed> $attributes
   *   The attributes.
   */
  private function jsonRequest(array $attributes): Request {
    return Request::create('/', 'POST', [], [], [], ['CONTENT_TYPE' => 'application/vnd.api+json'], (string) json_encode(['data' => ['attributes' => $attributes]]));
  }

  /**
   * Instantiates a resource with the setters the router would call.
   *
   * @param class-string<T> $class
   *   The resource class.
   *
   * @return T
   *   The resource.
   *
   * @template T of \Drupal\jsonapi_resources\Resource\ResourceBase&\Drupal\Core\DependencyInjection\ContainerInjectionInterface
   */
  private function resource(string $class): ResourceBase&ContainerInjectionInterface {
    $resource = $class::create($this->container);
    $resource->setResourceResponseFactory($this->container->get('jsonapi_resources.resource_response_factory'));
    $resource->setDocumentExtractor($this->container->get('jsonapi_resources.document_extractor'));
    if ($resource instanceof EntityResourceBase) {
      $resource->setResourceTypeRepository($this->container->get('jsonapi.resource_type.repository'));
      $resource->setEntityTypeManager($this->container->get('entity_type.manager'));
      $resource->setEntityAccessChecker($this->container->get('jsonapi_resources.entity_access_checker'));
    }
    return $resource;
  }

}
