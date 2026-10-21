<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\DefaultContent\Finder;
use Drupal\Core\DefaultContent\Importer;
use Drupal\Core\DefaultContent\PreEntityImportEvent;
use Drupal\KernelTests\KernelTestBase;
use Drupal\og\OgMembershipInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\Yaml\Yaml;

/**
 * An og_membership becomes expressible as recipe content (V9).
 *
 * BB-317 D8 read `og_membership` as not expressible as recipe content. The
 * obstacle turns out to be exactly one field: `entity_id` is a plain `string`
 * base field, so a fixture cannot name its group by UUID the way every other
 * reference does, and `OgMembership::preSave()` throws
 * `LogicException('A group entity is required for creating a membership.')`
 * before any `hook_presave` could rewrite it.
 *
 * `PreEntityImportEvent` is early enough — it carries the raw decoded array
 * before the entity object exists — and core's `Finder` topologically sorts on
 * `_meta.depends`, so the group is already imported by the time the membership
 * is (spec D9, Fact 13, Fact 14).
 *
 * The end-to-end case matters more than the unit ones here: only a real import
 * proves the resolved id survives `OgMembership::preSave()`.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class MembershipFixtureImportTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
  }

  /**
   * A UUID in entity_id is replaced by the referenced group's numeric id.
   */
  public function testUuidEntityIdIsResolvedToTheNumericId(): void {
    $workspace = $this->createEntity('bb_workspace', ['name' => 'resolve-me']);

    $data = $this->dispatch($this->membershipData($workspace->uuid()));

    self::assertSame(
      (string) $workspace->id(),
      $data['default']['entity_id'][0]['value'],
    );
  }

  /**
   * A numeric entity_id passes through untouched.
   *
   * A fixture may legitimately name a numeric id, and a resolver that rewrote
   * everything would corrupt it — `entity.repository` would find no entity for
   * "7" and the fixture would fail for a reason it did not cause.
   */
  public function testNumericEntityIdIsLeftAlone(): void {
    $data = $this->dispatch($this->membershipData('7'));

    self::assertSame('7', $data['default']['entity_id'][0]['value']);
  }

  /**
   * A different entity type is not touched at all.
   */
  public function testOtherEntityTypesAreUntouched(): void {
    $uuid = '11111111-2222-4333-8444-555555555555';
    $data = $this->dispatch([
      '_meta' => [
        'version' => '1.0',
        'entity_type' => 'bb_project',
        'uuid' => 'dbf00000-0000-4000-8000-0000000000ff',
      ],
      'default' => [
        'name' => [['value' => 'untouched']],
        'entity_id' => [['value' => $uuid]],
      ],
    ]);

    self::assertSame($uuid, $data['default']['entity_id'][0]['value']);
  }

  /**
   * An unresolvable UUID fails with a message naming the fixture.
   *
   * The point of the exception is the diagnosis. OG's own failure is `A group
   * entity is required for creating a membership.` — true, and useless: it
   * names neither the file, nor the entity type, nor the UUID that did not
   * resolve, and a recipe seeds dozens of files in one run.
   */
  public function testUnresolvableUuidNamesTheFixture(): void {
    $missing = '99999999-9999-4999-8999-999999999999';
    $membership_uuid = 'dbd10000-0000-4000-8000-0000000000ff';

    $this->expectExceptionMessageMatches('/' . $missing . '/');
    $this->expectExceptionMessageMatches('/bb_workspace/');
    $this->dispatch($this->membershipData($missing, $membership_uuid));
  }

  /**
   * A membership fixture on disk imports into a real, role-bearing membership.
   *
   * The only case that proves the whole chain: the resolved id survives
   * OgMembership::preSave(), the dependency ordering puts the workspace first,
   * and the `roles` reference to an og_role CONFIG entity works by plain id.
   */
  public function testMembershipFixtureImportsEndToEnd(): void {
    $account = $this->createAccount('fixture-member');
    $workspace_uuid = 'dbc60000-0000-4000-8000-0000000000aa';
    $membership_uuid = 'dbd10000-0000-4000-8000-0000000000aa';
    $directory = $this->siteDirectory . '/bakers318-content';

    $this->writeFixture($directory, 'bb_workspace', $workspace_uuid, [
      '_meta' => [
        'version' => '1.0',
        'entity_type' => 'bb_workspace',
        'uuid' => $workspace_uuid,
        'default_langcode' => 'en',
      ],
      // `slug` is required since BB-350 and core's default-content Importer
      // validates what it imports, so a workspace fixture without one aborts
      // the whole import — which is also why every recipe workspace content
      // file carries a slug.
      'default' => [
        'name' => [['value' => 'imported workspace']],
        'slug' => [['value' => 'imported-workspace']],
      ],
    ]);
    $this->writeFixture($directory, 'og_membership', $membership_uuid, [
      '_meta' => [
        'version' => '1.0',
        'entity_type' => 'og_membership',
        'uuid' => $membership_uuid,
        // Required, and not in the spec's example: core's Importer reads the
        // bundle from _meta and ContentEntityStorageBase::create() refuses a
        // bundled entity type without one. The `type` field below is what the
        // exporter writes; it is not what the importer reads.
        'bundle' => 'default',
        'default_langcode' => 'en',
        'depends' => [
          $workspace_uuid => 'bb_workspace',
          $account->uuid() => 'user',
        ],
      ],
      'default' => [
        'type' => [['target_id' => 'default']],
        'entity_type' => [['value' => 'bb_workspace']],
        'entity_bundle' => [['value' => 'bb_workspace']],
        'entity_id' => [['value' => $workspace_uuid]],
        'uid' => [['entity' => $account->uuid()]],
        'roles' => [['target_id' => 'bb_workspace-bb_workspace-lead']],
        'state' => [['value' => 'active']],
      ],
    ]);

    $importer = $this->container->get(Importer::class);
    self::assertInstanceOf(Importer::class, $importer);
    $importer->importContent(new Finder($directory));

    $membership = $this->container->get('entity.repository')
      ->loadEntityByUuid('og_membership', $membership_uuid);
    self::assertInstanceOf(OgMembershipInterface::class, $membership);
    $workspace = $this->container->get('entity.repository')
      ->loadEntityByUuid('bb_workspace', $workspace_uuid);
    self::assertNotNull($workspace);
    self::assertSame((string) $workspace->id(), (string) $membership->getGroupId());
    self::assertSame('bb_workspace', $membership->getGroupEntityType());
    self::assertSame(OgMembershipInterface::STATE_ACTIVE, $membership->getState());
    // assertContains, not assertSame: OgMembership::getRolesIds() always adds
    // the group type's required `member` role beside whatever the fixture
    // states, so a fixture role set is never the whole answer.
    self::assertContains(
      'bb_workspace-bb_workspace-lead',
      $membership->getRolesIds(),
      'A role-bearing membership is what makes the admin rule assertable in '
      . 'the seeded worlds rather than only in kernel tests (D9).',
    );
  }

  /**
   * Builds a minimal og_membership content array.
   *
   * @param string $entity_id
   *   The value to put in the entity_id field.
   * @param string $uuid
   *   The membership's own UUID.
   *
   * @return array<string, mixed>
   *   The raw decoded content array, `_meta` included.
   */
  private function membershipData(string $entity_id, string $uuid = 'dbd10000-0000-4000-8000-000000000001'): array {
    return [
      '_meta' => [
        'version' => '1.0',
        'entity_type' => 'og_membership',
        'uuid' => $uuid,
        'default_langcode' => 'en',
      ],
      'default' => [
        'type' => [['target_id' => 'default']],
        'entity_type' => [['value' => 'bb_workspace']],
        'entity_bundle' => [['value' => 'bb_workspace']],
        'entity_id' => [['value' => $entity_id]],
        'state' => [['value' => 'active']],
      ],
    ];
  }

  /**
   * Dispatches PreEntityImportEvent and returns the resulting data.
   *
   * @param array<string, mixed> $data
   *   The raw decoded content array.
   *
   * @return array<string, mixed>
   *   The data after the subscribers ran, without `_meta`.
   */
  private function dispatch(array $data): array {
    $event = new PreEntityImportEvent($data);
    $this->container->get('event_dispatcher')->dispatch($event);
    return $event->data;
  }

  /**
   * Writes one content fixture file into a per-entity-type subdirectory.
   *
   * @param string $directory
   *   The content root.
   * @param string $entity_type_id
   *   The entity type, which names the subdirectory.
   * @param string $uuid
   *   The entity UUID, which names the file.
   * @param array<string, mixed> $data
   *   The content array to serialise.
   */
  private function writeFixture(string $directory, string $entity_type_id, string $uuid, array $data): void {
    $path = $directory . '/' . $entity_type_id;
    self::assertTrue(
      is_dir($path) || mkdir($path, 0777, TRUE),
      "The fixture directory $path exists.",
    );
    file_put_contents($path . '/' . $uuid . '.yml', Yaml::dump($data, 6));
  }

}
