<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\island\IslandContextProviderInterface;
use Drupal\island\IslandInterface;
use Drupal\island\IslandPluginManagerInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * Tests island plugin discovery, the attribute, and the host context seam.
 */
#[Group('island')]
final class IslandPluginManagerTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['system', 'island', 'island_test'];

  /**
   * {@inheritdoc}
   */
  public function testDiscoveryAndAttribute(): void {
    $manager = $this->container->get('plugin.manager.island');
    $this->assertInstanceOf(IslandPluginManagerInterface::class, $manager);
    $definition = $manager->getDefinition('test_island');
    $this->assertSame('Test island', (string) $definition['label']);
    // D5: type is a plain string, no enum.
    $this->assertSame('widget', $definition['type']);
    $this->assertSame('content', $definition['default_region']);
    $this->assertTrue($definition['enabled_by_default']);
  }

  /**
   * {@inheritdoc}
   */
  public function testInstanceContractAndHtmlId(): void {
    $manager = $this->container->get('plugin.manager.island');
    $island = $manager->createInstance('test_island');
    $this->assertInstanceOf(IslandInterface::class, $island);
    $this->assertSame('Test island', $island->label());
    $this->assertSame('widget', $island->getTypeId());
    // D2: OOB-stable wrapper id convention.
    $this->assertSame('island-tasks-test_island', $island->getHtmlId('tasks'));
    $this->assertSame([], $island->getSubscribedEvents());
  }

  /**
   * {@inheritdoc}
   */
  public function testHostContextSeam(): void {
    $host = new class implements IslandContextProviderInterface {

      /**
       * {@inheritdoc}
       */
      public function hostId(): string {
        return 'tasks';
      }

      /**
       * {@inheritdoc}
       */
      public function getIslandIds(): array {
        return ['test_island'];
      }

      /**
       * {@inheritdoc}
       */
      public function getIslandConfiguration(string $island_id): array {
        return [];
      }

      /**
       * {@inheritdoc}
       */
      public function getIslandData(string $island_id): array {
        return ['marker' => 'from-host'];
      }

    };
    $manager = $this->container->get('plugin.manager.island');
    $config = $host->getIslandConfiguration('test_island');
    $config['contexts']['host'] = $host;
    $island = $manager->createInstance('test_island', $config);
    $this->assertInstanceOf(IslandInterface::class, $island);
    // D2: build() receives plain data; the host flows via contexts, not a type.
    $build = $island->build($host->getIslandData('test_island'));
    $this->assertSame('test-island:from-host', (string) $build['#markup']);
  }

  /**
   * An html id resolves to its host and island by being parsed (BB-408 D4).
   *
   * Parsed, not searched. The unscoped walk over every registered provider is
   * exactly what BB-398 deleted, and reviving it under a new caller would be
   * the same code with a better excuse. Machine names are `[a-z0-9_]`, so
   * `island-<host>-<plugin>` splits unambiguously on its first two hyphens.
   */
  public function testHtmlIdResolvesToItsHostAndIsland(): void {
    $resolved = $this->container->get('island.host_resolver')->resolveHtmlId('island-tasks-task_list');

    $this->assertIsArray($resolved);
    // Read through ?? rather than straight off the union: the resolver returns
    // one of two shapes, and naming the branch is how the test says which one
    // it expects rather than assuming it.
    $host = $resolved['host'] ?? NULL;
    $this->assertInstanceOf(IslandContextProviderInterface::class, $host);
    $this->assertSame('tasks', $host->hostId());
    $this->assertSame('task_list', $resolved['island_id'] ?? NULL);
  }

  /**
   * Every way of not being an island html id is a miss, not a guess.
   */
  public function testUnresolvableHtmlIdsReturnNull(): void {
    $resolver = $this->container->get('island.host_resolver');

    // A host nobody registered.
    $this->assertNull($resolver->resolveHtmlId('island-nosuchhost-task_list'));
    // A plugin the host does not claim.
    $this->assertNull($resolver->resolveHtmlId('island-tasks-not_an_island'));
    // Not an island id at all.
    $this->assertNull($resolver->resolveHtmlId('block-system-main'));
    // Too few segments to parse.
    $this->assertNull($resolver->resolveHtmlId('island-tasks'));
    $this->assertNull($resolver->resolveHtmlId(''));
  }

  /**
   * A plugin that overrides getHtmlId() is a miss, never the wrong island.
   *
   * This is the verification step, and it is the whole reason the parse is
   * safe. `renamed` is registered by the fixture host and answers to
   * `island-tasks-somewhere_else`; the parse of `island-tasks-renamed` finds
   * it, asks it for its own id, and drops it when the two disagree.
   */
  public function testAnIslandThatRenamesItselfIsNotResolvedByItsParsedId(): void {
    $resolver = $this->container->get('island.host_resolver');

    $this->assertNull($resolver->resolveHtmlId('island-tasks-renamed'));
    // And the id it DOES answer to does not resolve either: 'somewhere_else'
    // is not a plugin id, so there is no second address into the same island.
    $this->assertNull($resolver->resolveHtmlId('island-tasks-somewhere_else'));
  }

}
