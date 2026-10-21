<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Component\Plugin\PluginManagerInterface;
use Drupal\Core\Block\BlockManagerInterface;

/**
 * Converts the portable legacy source grammar into standalone profile values.
 */
final class IslandLegacyLayoutConverter {

  public function __construct(
    private readonly IslandLayoutManager $layoutManager,
    private readonly IslandPluginManagerInterface $islandManager,
    private readonly BlockManagerInterface $blockManager,
    private readonly ?PluginManagerInterface $sourceManager = NULL,
  ) {
  }

  /**
   * Converts the supported source grammar and rejects every lossy conversion.
   */
  public function convert(array $legacy): array {
    $sources = $legacy['sources'] ?? [];
    if (count($sources) !== 1 || ($sources[0]['source_id'] ?? '') !== 'component') {
      throw new \UnexpectedValueException('Expected exactly one root component');
    }
    $root = $sources[0]['source']['component'] ?? [];
    $layout = (string) ($root['component_id'] ?? '');
    $definitions = $this->layoutManager->getDefinitions();
    if (!isset($definitions[$layout])) {
      throw new \UnexpectedValueException("Unknown root component $layout");
    }
    if (!empty($root['variant_id'])) {
      throw new \UnexpectedValueException('Root variant_id requires explicit mapping');
    }
    $placements = $this->convertSlots($root, $layout);
    return [
      'id' => (string) $legacy['id'],
      'label' => (string) $legacy['label'],
      'status' => (bool) ($legacy['status'] ?? TRUE),
      'app' => 'bakers',
      'layout' => $layout,
      'layout_settings' => $this->scalarSources($root['props'] ?? []),
      'placements' => $placements,
      'weight' => (int) ($legacy['weight'] ?? 0),
      'conditions' => $this->conditions($legacy['conditions'] ?? []),
    ];
  }

  /**
   * Converts slots and remaps legacy wrapper references to profile placements.
   */
  private function convertSlots(array $root, string $layout): array {
    $placements = [];
    $targets = [];
    $slots = $this->layoutManager->getSlots($layout);
    foreach ($root['slots'] ?? [] as $slot_id => $slot) {
      if (!isset($slots[$slot_id])) {
        throw new \UnexpectedValueException("Unknown layout slot $slot_id");
      }
      foreach ($slot['sources'] ?? [] as $index => $source) {
        $this->convertSource($source, $slot_id, $placements, $slot_id . '_' . $index);
        if (($source['source_id'] ?? '') === 'island' && !empty($source['source']['island_id'])) {
          $targets['#' . $source['source']['island_id']] = $source['node_id'] ?? $slot_id . '_' . $index;
        }
      }
    }
    foreach ($placements as &$placement) {
      $target = $placement['configuration']['swap_target'] ?? '';
      if (isset($targets[$target])) {
        $placement['configuration']['target_placement'] = $targets[$target];
        unset($placement['configuration']['swap_target']);
      }
    }
    unset($placement);
    return $placements;
  }

  /**
   * Preserves wrapper identity and content grouping when adapting a source.
   */
  private function convertSource(array $source, string $slot_id, array &$placements, string $fallback_id): void {
    $id = (string) ($source['node_id'] ?? $fallback_id);
    if (!preg_match('/^[a-zA-Z0-9_]+$/', $id) || isset($placements[$id])) {
      throw new \UnexpectedValueException("Invalid or duplicate placement ID $id");
    }
    $source_id = $source['source_id'] ?? '';
    $settings = $source['source'] ?? [];
    if ($source_id === 'island') {
      $children = $settings['content'] ?? [];
      if (count($children) === 1) {
        $child = reset($children);
        $child['node_id'] = $id;
        $this->convertSource($child, $slot_id, $placements, $id);
      }
      if (count($children) !== 1) {
        $placements[$id] = $this->placement('page_content', $slot_id, count($placements), $this->contentGroup($children));
      }
      $target = trim((string) ($settings['swap_target'] ?? ''));
      if ($target !== '' && $placements[$id]['plugin_id'] !== 'ui_patterns_component') {
        throw new \UnexpectedValueException('Swap target requires a component island');
      }
      if ($target !== '') {
        $placements[$id]['configuration']['boost'] = TRUE;
        // Resolve references in a second pass when all legacy wrappers exist.
        $placements[$id]['configuration']['swap_target'] = $target;
      }
      return;
    }
    $plugin = match ($source_id) {
      'component' => 'ui_patterns_component',
      'block' => 'block',
      'main_page_content' => 'page_content',
      default => throw new \UnexpectedValueException("Unsupported source $source_id at $id"),
    };
    if (!$this->islandManager->hasDefinition($plugin)) {
      throw new \UnexpectedValueException("Required island plugin $plugin is unavailable at $id");
    }
    $configuration = match ($source_id) {
      'main_page_content' => [],
      'block' => $this->blockConfiguration($settings),
      'component' => $this->componentConfiguration($settings),
    };
    $placements[$id] = $this->placement($plugin, $slot_id, count($placements), $configuration);
  }

  /**
   * Keeps leading block sources inside the current controller's refresh target.
   */
  private function contentGroup(array $children): array {
    $last = array_pop($children);
    if (($last['source_id'] ?? '') !== 'main_page_content') {
      throw new \UnexpectedValueException('Grouped island must end with main_page_content');
    }
    $blocks = [];
    foreach ($children as $child) {
      if (($child['source_id'] ?? '') !== 'block' || empty($child['node_id'])) {
        throw new \UnexpectedValueException('Grouped island supports only named block prefixes before main_page_content');
      }
      if (in_array($child['node_id'], ['content', 'title'], TRUE)) {
        throw new \UnexpectedValueException('Reserved grouped block source ID requires explicit mapping');
      }
      if (isset($blocks[$child['node_id']])) {
        throw new \UnexpectedValueException('Duplicate grouped block source ID');
      }
      $blocks[$child['node_id']] = $this->blockConfiguration($child['source']);
    }
    return ['prefix_blocks' => $blocks, 'content_source_id' => $last['node_id'] ?? 'content'];
  }

  /**
   * Verifies nested components exist before retaining their source mappings.
   */
  private function componentConfiguration(array $settings): array {
    $this->validateMappings($settings);
    $component = $settings['component'] ?? [];
    $id = (string) ($component['component_id'] ?? '');
    if (!isset($this->layoutManager->getDefinitions()[$id])) {
      throw new \UnexpectedValueException("Unknown component $id");
    }
    foreach ($component['slots'] ?? [] as $slot) {
      foreach ($slot['sources'] ?? [] as $source) {
        if (($source['source_id'] ?? '') === 'component') {
          $this->componentConfiguration($source['source']);
        }
      }
    }
    return $settings;
  }

  /**
   * Checks every nested UI Patterns source against installed plugin discovery.
   */
  private function validateMappings(array $mapping): void {
    if (isset($mapping['source_id']) && !$this->sourceManager?->hasDefinition($mapping['source_id'])) {
      throw new \UnexpectedValueException("Unavailable mapping source {$mapping['source_id']}");
    }
    foreach ($mapping as $value) {
      if (is_array($value)) {
        $this->validateMappings($value);
      }
    }
  }

  /**
   * Adapts UI Patterns' plugin-ID-keyed block settings without dropping values.
   */
  private function blockConfiguration(array $settings): array {
    $plugin_id = (string) ($settings['plugin_id'] ?? '');
    if (!$this->blockManager->hasDefinition($plugin_id)) {
      throw new \UnexpectedValueException("Unavailable block plugin $plugin_id");
    }
    return ['plugin_id' => $plugin_id, 'configuration' => $settings[$plugin_id] ?? $settings['configuration'] ?? []];
  }

  /**
   * Builds a complete saved placement record.
   */
  private function placement(string $plugin, string $slot, int $weight, array $configuration): array {
    return [
      'plugin_id' => $plugin,
      'slot' => $slot,
      'weight' => $weight,
      'enabled' => TRUE,
      'configuration' => $configuration,
      'data' => [],
    ];
  }

  /**
   * Converts literal props; dynamic root mappings require explicit resolution.
   */
  private function scalarSources(array $props): array {
    foreach ($props as $key => $value) {
      if (!is_array($value) || ($value['source_id'] ?? '') !== 'textfield') {
        throw new \UnexpectedValueException("Unsupported root prop mapping $key");
      }
      $props[$key] = $value['source']['value'] ?? '';
    }
    return $props;
  }

  /**
   * Keeps a legacy core request_path condition, refusing unknown conditions.
   */
  private function conditions(array $conditions): array {
    if (array_diff(array_keys($conditions), ['request_path'])) {
      throw new \UnexpectedValueException('Unsupported conditions require explicit mapping');
    }
    $pages = trim((string) ($conditions['request_path']['pages'] ?? ''));
    $negate = (bool) ($conditions['request_path']['negate'] ?? FALSE);
    // Empty pages restricted nothing: the layout is an unconditional fallback.
    if ($pages === '' && !$negate) {
      return [];
    }
    return ['request_path' => ['id' => 'request_path', 'negate' => $negate, 'pages' => $pages]];
  }

}
