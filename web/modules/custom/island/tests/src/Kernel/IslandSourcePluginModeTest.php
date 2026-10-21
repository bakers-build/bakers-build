<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\island\IslandContextProviderInterface;
use Drupal\island\IslandResponse;
use PHPUnit\Framework\Attributes\Group;

/**
 * An island placed in a ui_patterns tree stays ADDRESSABLE (BB-396).
 *
 * This is the property the whole plugin mode exists for, and it is not obvious
 * from the markup: a container rendered from configuration alone and one
 * rendered from a plugin look the same on the page. The difference is whether
 * anything can re-render it on its own — and that decides whether the island
 * can change content at all, because the action route, `IslandFormBase` and
 * `IslandResponse` all reach an island by resolving its html id.
 *
 * So the assertion is the round trip: place the island, take the id out of the
 * rendered container, and hand that id back to `IslandHostResolver`. Asserting
 * the id's SHAPE would be weaker and would pass on a string that merely looks
 * right; asserting that the resolver answers with the same island is the claim.
 *
 * The negative control is the other mode. Configuration mode is not a lesser
 * plugin mode, it is a different thing: its container resolves to nothing, on
 * purpose, and a boosted navigation is answered with the ordinary page for
 * htmx to extract from. Without this half the test would pass just as well if
 * plugin mode had silently fallen through to configuration mode.
 */
#[Group('island')]
final class IslandSourcePluginModeTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = ['system', 'user', 'ui_patterns', 'island', 'island_test'];

  /**
   * {@inheritdoc}
   *
   * The user schema is not decoration: constructing ANY ui_patterns source
   * reaches the context repository, whose current-user provider loads the
   * account — so without the table every case here dies before it asserts.
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
  }

  /**
   * Plugin mode renders a container the host resolver can find again.
   */
  public function testPlacedIslandIsAddressable(): void {
    $build = $this->sourceValue([
      'host' => 'tasks',
      'island' => 'task_count',
    ]);

    $html_id = $build['#attributes']['id'] ?? '';
    $this->assertNotSame('', $html_id, 'Plugin mode produced a container with an id.');

    $resolved = $this->container->get('island.host_resolver')->resolveHtmlId($html_id);
    $this->assertIsArray($resolved, sprintf('The rendered id "%s" resolves.', $html_id));
    $this->assertSame('task_count', $resolved['island_id'] ?? NULL);
    $this->assertSame('tasks', ($resolved['host'] ?? NULL)->hostId());
  }

  /**
   * A host may place one plugin under several independent identities.
   */
  public function testAliasedPlacementsKeepTheirOwnAddress(): void {
    $host = new class implements IslandContextProviderInterface {

      /**
       * {@inheritdoc}
       */
      public function hostId(): string {
        return 'aliases';
      }

      /**
       * {@inheritdoc}
       */
      public function getIslandIds(): array {
        return ['first', 'second'];
      }

      /**
       * Resolves the common plugin behind both placements.
       */
      public function getIslandPluginId(string $island_id): string {
        return 'task_count';
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
        return ['count' => $island_id === 'first' ? 3 : 7];
      }

    };
    $resolver = $this->container->get('island.host_resolver');
    $resolver->addProvider($host);
    foreach (['first', 'second'] as $placement) {
      $build = $this->sourceValue(['host' => 'aliases', 'island' => $placement]);
      self::assertSame('island-aliases-' . $placement, $build['#attributes']['id']);
      $resolved = $resolver->resolveHtmlId($build['#attributes']['id']);
      self::assertSame($placement, $resolved['island_id'] ?? NULL);
      self::assertSame('task_count', $resolved['island']->getPluginId());
      $response = $this->container->get('island.responder')->toResponse(IslandResponse::make()->rebuildSelf(), $resolved['island'], $host);
      $html = $response->getContent();
      self::assertIsString($html);
      self::assertStringContainsString('id="island-aliases-' . $placement . '"', $html);
      self::assertStringContainsString($placement === 'first' ? 'count:3' : 'count:7', $html);
    }
  }

  /**
   * Configuration mode renders a container that resolves to nothing.
   */
  public function testConfiguredIslandIsNotAddressable(): void {
    $build = $this->sourceValue([
      'island_id' => 'island-content',
      'swap_target' => '',
      'content' => [],
    ]);

    $this->assertSame('island-content', $build['#attributes']['id'] ?? '');
    $this->assertNull(
      $this->container->get('island.host_resolver')->resolveHtmlId('island-content'),
      'A configured island is deliberately not addressable — nothing can re-render it on its own.',
    );
  }

  /**
   * A placement naming a host that does not exist renders nothing.
   */
  public function testUnknownHostRendersNothing(): void {
    $this->assertSame([], $this->sourceValue(['host' => 'nope', 'island' => 'task_count']));
  }

  /**
   * The `island` source's value for one settings array.
   *
   * @param array<string, mixed> $settings
   *   The source settings under test.
   *
   * @return array<string, mixed>
   *   The render array the source produced.
   */
  private function sourceValue(array $settings): array {
    /** @var \Drupal\ui_patterns\SourcePluginManager $manager */
    $manager = $this->container->get('plugin.manager.ui_patterns_source');
    /** @var \Drupal\ui_patterns\SourceInterface $source */
    $source = $manager->createInstance('island', [
      'source_id' => 'island',
      'settings' => $settings,
    ]);
    $value = $source->getPropValue();
    return is_array($value) ? $value : [];
  }

}
