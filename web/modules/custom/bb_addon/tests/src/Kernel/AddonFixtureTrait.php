<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_addon\Kernel;

use Drupal\bb_addon\AddonWorkspaceResolver;
use Drupal\bb_addon\Entity\BbAddonInterface;
use Drupal\bb_core\Entity\BbConductorInterface;

/**
 * The ports definition every bb_addon test works with.
 */
trait AddonFixtureTrait {

  /**
   * The ports addon definition at the given version.
   *
   * @param string $version
   *   The version.
   *
   * @return array<string, mixed>
   *   The definition.
   */
  protected static function portsDefinition(string $version = '1.2.3'): array {
    $port = ['type' => 'integer', 'title' => 'Port', 'minimum' => 1, 'maximum' => 65535];
    return [
      'name' => 'ports',
      'version' => $version,
      'contract' => 2,
      'label' => 'Ports',
      'messages' => [
        'up' => [
          'label' => 'Share',
          'access' => 'view',
          'input' => ['type' => 'object', 'required' => ['port'], 'properties' => ['port' => $port]],
        ],
        'down' => [
          'label' => 'Stop',
          'access' => 'view',
          'input' => ['type' => 'object', 'required' => ['port'], 'properties' => ['port' => $port]],
        ],
        'reap' => ['label' => 'Reap'],
      ],
    ];
  }

  /**
   * The Ports definition as contract 1 registered it (`ports@0.0.1`).
   *
   * Only an old site's database still holds it; registration rejects it.
   *
   * @return array<string, mixed>
   *   The definition.
   */
  protected static function contractOnePortsDefinition(): array {
    $port = ['type' => 'integer', 'title' => 'Port', 'minimum' => 1, 'maximum' => 65535];
    $input = ['type' => 'object', 'required' => ['port'], 'properties' => ['port' => $port]];
    return [
      'name' => 'ports',
      'version' => '0.0.1',
      'contract' => 1,
      'label' => 'Ports',
      'views' => ['services' => ['label' => 'Services', 'refresh' => 30]],
      'actions' => [
        'up' => ['label' => 'Share', 'access' => 'view', 'input' => $input],
        'down' => ['label' => 'Stop', 'access' => 'view', 'input' => $input],
      ],
    ];
  }

  /**
   * Stores an addon definition run by the given conductors.
   *
   * Without an explicit `$workspace_id`, the row's workspace is derived from
   * the first conductor, like real registration; callers with no conductor
   * must pass one explicitly.
   *
   * @param array<string, mixed> $definition
   *   The definition.
   * @param \Drupal\bb_core\Entity\BbConductorInterface[] $conductors
   *   The conductors running it.
   * @param int|null $workspace_id
   *   The row's workspace; derived from the first conductor when omitted.
   */
  protected function storeAddon(array $definition, array $conductors, ?int $workspace_id = NULL): BbAddonInterface {
    if ($workspace_id === NULL) {
      $first = reset($conductors);
      if (!$first instanceof BbConductorInterface) {
        throw new \InvalidArgumentException('storeAddon() needs an explicit $workspace_id when $conductors is empty.');
      }
      $workspace = $this->container->get(AddonWorkspaceResolver::class)->resolve($first);
      $workspace_id = (int) ($workspace?->id() ?? throw new \InvalidArgumentException('The first conductor has no resolvable workspace.'));
    }
    $addon = $this->container->get('entity_type.manager')->getStorage('bb_addon')->create([
      'workspace_id' => $workspace_id,
      'name' => $definition['name'],
      'version' => $definition['version'],
      'contract' => $definition['contract'],
      'definition' => json_encode($definition),
      'conductors' => array_map(static fn (BbConductorInterface $c) => $c->id(), $conductors),
    ]);
    self::assertInstanceOf(BbAddonInterface::class, $addon);
    $addon->save();
    return $addon;
  }

}
