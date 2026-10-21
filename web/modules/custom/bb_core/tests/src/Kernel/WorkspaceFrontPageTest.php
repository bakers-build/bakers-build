<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\PathProcessor\BbWorkspacePathProcessor;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Yaml\Yaml;

/**
 * A workspace-prefixed `system.site.front` reaches its route (BB-350 D8).
 *
 * Two inbound path processors have to compose for a front page that lives under
 * a workspace to resolve at all, and the order between them is the whole test:
 *
 *   `/`  --PathProcessorFront-->  `/bakers/board`
 *        --BbWorkspacePathProcessor-->  `/_workspace/bakers/board`
 *
 * D1 puts the workspace at the site root, which Drupal's router cannot serve
 * directly, so workspace routes carry the internal `_workspace` prefix and this
 * processor bridges the two forms. `system.site.front` is a PUBLIC path, so it
 * arrives needing that same bridging — but only if the workspace processor runs
 * AFTER the front processor. It shipped at inbound priority 250, above
 * PathProcessorFront's 200, so it inspected a bare `/`, found no slug, and the
 * front page 404'd on every install path the moment `page.front` moved under a
 * workspace. Measured on the running site, not read.
 *
 * WHY THE BRIDGING HALF USES A FIXTURE AND NOT THE SHIPPED LITERAL (BB-396,
 * restated by BB-415). It used to read `config/sync/system.site.yml` and
 * bridge whatever it found. That literal has left the workspace for good: it is
 * `/home` now — this product's own landing route, which carries NO workspace
 * and is on `BbWorkspaceSlugConstraint::RESERVED` so that none can ever claim
 * it. Bridging it here would make this test invent a workspace slugged `home`
 * and assert a rewrite the product must never perform; it would pass, and prove
 * the opposite of what it says.
 *
 * SO THE SUBJECT SPLIT IN TWO, AND BOTH HALVES ARE IN THIS CLASS. The front
 * page no longer depends on the 200/150 ordering, and
 * `testTheFrontPageResolvesToTheHomeRouteAndIsNotBridged()` asserts exactly
 * that against the SHIPPED literal — the new chain. Every PRODUCT URL still
 * does depend on the ordering, and the `/bakers/board` fixture is what keeps that
 * regression covered now that the shipped literal has stopped exercising it.
 * The fixture is not a leftover; it is the only remaining way to exercise the
 * composition. That both install paths agree on the shipped literal remains
 * \Drupal\Tests\bb_core\Unit\ShippedConfigDriftTest's job.
 *
 * The processor manager is asked to process the path, rather than a full
 * request being sent through the kernel: the composition of the two processors
 * IS the mechanism, and asserting on it names which half broke.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceFrontPageTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'bb_core',
  ];

  /**
   * A workspace-prefixed front path: `/<slug>/<something>`.
   */
  private const FRONT = '/bakers/board';

  /**
   * The front path under test.
   */
  private string $front;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);

    $this->front = self::FRONT;
    $this->config('system.site')->set('page.front', $this->front)->save();

    // The workspace the front path addresses. Its slug is the first segment of
    // that path, so the fixture cannot disagree with the config it just set.
    $this->create('bb_workspace', [
      'name' => 'Front',
      'slug' => explode('/', ltrim($this->front, '/'))[0],
    ]);
  }

  /**
   * The site root is rewritten all the way to the internal workspace path.
   */
  public function testFrontPageResolvesToTheWorkspaceRoute(): void {
    self::assertSame(
      '/' . BbWorkspacePathProcessor::PREFIX . $this->front,
      $this->processInbound('/'),
      'The front page reaches the internal workspace path the router serves.',
    );
  }

  /**
   * The front path typed out in full resolves to the same internal path.
   *
   * The negative control for the assertion above: it proves the bridging works
   * at all, so a failure there is about the ORDER of the two processors and
   * not about the workspace processor being broken.
   */
  public function testTheSameWorkspacePathResolvesWhenRequestedDirectly(): void {
    self::assertSame(
      '/' . BbWorkspacePathProcessor::PREFIX . $this->front,
      $this->processInbound($this->front),
    );
  }

  /**
   * The real chain: `/` resolves to `/home` and is NOT bridged (BB-415 D10).
   *
   * The shipped front page, asserted as the shipped front page — read out of
   * `config/sync/system.site.yml` rather than restated, so a literal that moves
   * without this test moving fails here instead of on a server.
   *
   * TWO ASSERTIONS, AND THE SECOND IS THE POINT. That `/` becomes the shipped
   * literal is `PathProcessorFront` doing its job and would hold for any value.
   * That the result is NOT `/_workspace/home` is what this ticket has to
   * guarantee: were `home` ever claimable as a slug, this processor would
   * rewrite the site root into a path that matches no route, and the front page
   * would 404 with nothing in the log naming the cause.
   * ReservedSlugCoverageTest enforces the reservation from the router's side;
   * this is the same guarantee, measured through the real processor chain.
   */
  public function testTheFrontPageResolvesToTheHomeRouteAndIsNotBridged(): void {
    $shipped = Yaml::parseFile(dirname($this->root) . '/config/sync/system.site.yml');
    $front = $shipped['page']['front'] ?? NULL;
    self::assertIsString($front, 'config/sync/system.site.yml states a front page.');

    $this->config('system.site')->set('page.front', $front)->save();

    self::assertSame(
      $front,
      $this->processInbound('/'),
      'The site root reaches the landing route unchanged.',
    );
    self::assertStringNotContainsString(
      BbWorkspacePathProcessor::PREFIX,
      $this->processInbound('/'),
      'The landing route carries no workspace and must never be bridged into one.',
    );
  }

  /**
   * A path under no known slug is left exactly as it came in.
   *
   * Without this the assertions above would also hold if the processor blindly
   * prefixed everything, which would make every 404 an internal workspace path.
   */
  public function testAnUnknownFirstSegmentIsNotBridged(): void {
    self::assertSame('/nope/dashboard', $this->processInbound('/nope/dashboard'));
  }

  /**
   * CR1 regression (BB-556) — `_bakers-api` never collides with a slug.
   *
   * Even with a workspace actually slugged `bakers` (the default slug)
   * present.
   *
   * The run-log download API route used to start with the literal `bakers`,
   * which IS `BbWorkspace::DEFAULT_SLUG` — so a live workspace using that
   * slug got the route silently rewritten under `/_workspace/bakers/...`
   * instead, 404ing every run outside the default workspace. The fix moved
   * the route to `/_bakers-api/...`: an underscore-led segment the slug pattern
   * forbids (`BbWorkspacePathProcessor::PREFIX`'s own docblock), so no
   * workspace can ever be named after it. This is that guarantee, measured
   * through the real processor chain rather than read off the routing file —
   * with a workspace ACTUALLY slugged `bakers` in play, so a regression that
   * reintroduces the collision fails here rather than only on a live site
   * running two workspaces.
   */
  public function testRunLogRouteSurvivesDefaultSlugWorkspace(): void {
    $this->create('bb_workspace', ['name' => 'Default', 'slug' => 'bakers']);

    self::assertSame(
      '/_bakers-api/run/1a49fe21-c38e-42ef-acaa-70828ba864f1/log/log',
      $this->processInbound('/_bakers-api/run/1a49fe21-c38e-42ef-acaa-70828ba864f1/log/log'),
      'The API route is not bridged under /_workspace/bakers/... despite a workspace slugged "bakers" existing.',
    );
  }

  /**
   * Runs a path through the site's real inbound path processors.
   *
   * @param string $path
   *   The public path.
   *
   * @return string
   *   The internal path the router is asked to match.
   */
  private function processInbound(string $path): string {
    return $this->container->get('path_processor_manager')
      ->processInbound($path, Request::create($path));
  }

  /**
   * Creates and saves an entity of the given type.
   *
   * @param string $entity_type_id
   *   The entity type to create.
   * @param array<string, mixed> $values
   *   The field values.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved entity.
   */
  private function create(string $entity_type_id, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')
      ->getStorage($entity_type_id)
      ->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    $entity->save();
    return $entity;
  }

}
