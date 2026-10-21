<?php

declare(strict_types=1);

namespace Drupal\designbook_config_schema\Commands;

use Drupal\Core\Config\TypedConfigManagerInterface;
use Drupal\config_inspector\ConfigInspectorManager;
use Drush\Commands\DrushCommands;
use Symfony\Component\Yaml\Yaml;

/**
 * Drush commands for designbook sync: schema emission + YAML validation.
 *
 * Provides two commands:
 * - designbook:config-schema <config_name>: walks the typed-config definition
 *   tree for <config_name> and prints a minimal JSON Schema
 *   (type/properties/required/items) to stdout (exit 0).
 * - designbook:config-validate <config_name> <yaml_path>: parses the YAML at
 *   <yaml_path> inside the container, runs it through Drupal's typed-config
 *   constraint system, and exits 0 (valid) or throws (invalid) with violation
 *   detail on stderr.
 */
class ConfigSchemaCommands extends DrushCommands {

  /**
   * Typed configuration manager.
   */
  protected TypedConfigManagerInterface $typedConfig;

  /**
   * Constructs ConfigSchemaCommands.
   *
   * @param \Drupal\Core\Config\TypedConfigManagerInterface $typed_config
   *   The typed config manager.
   */
  public function __construct(TypedConfigManagerInterface $typed_config) {
    parent::__construct();
    $this->typedConfig = $typed_config;
  }

  /**
   * Maps a typed-config scalar type string to a JSON Schema primitive.
   *
   * Returns NULL when the type is not a known scalar (i.e. it is a mapping or
   * sequence and the caller must walk the definition tree further).
   *
   * @param string $type
   *   Typed-config type string, e.g. "boolean", "label", "uuid".
   *
   * @return string|null
   *   JSON Schema primitive ("string", "boolean", "integer", "number") or NULL.
   */
  private function scalarToJsonSchemaType(string $type): ?string {
    $map = [
      'string'           => 'string',
      'text'             => 'string',
      'label'            => 'string',
      'required_label'   => 'string',
      'uri'              => 'string',
      'uuid'             => 'string',
      'email'            => 'string',
      'langcode'         => 'string',
      'machine_name'     => 'string',
      'color_hex'        => 'string',
      'path'             => 'string',
      'boolean'          => 'boolean',
      'integer'          => 'integer',
      'float'            => 'number',
      'weight'           => 'integer',
    ];
    return $map[$type] ?? NULL;
  }

  /**
   * Recursively walks a typed-config definition and returns a JSON Schema.
   *
   * Mirrors the proven drush php:eval walker from the Task-1 spike.
   *
   * @param array $definition
   *   A typed-config definition from TypedConfigManager::getDefinition().
   * @param \Drupal\Core\Config\TypedConfigManagerInterface $tcm
   *   The typed config manager (used to resolve type aliases at depth).
   * @param int $depth
   *   Current recursion depth. Hard-stopped at 4 to avoid infinite loops on
   *   self-referential types (e.g. views display_options). At depth ≥ 4 the
   *   property degrades to an empty (permissive) schema.
   *
   * @return array
   *   JSON Schema fragment (associative array; json_encode-ready).
   */
  private function walkDefinition(array $definition, TypedConfigManagerInterface $tcm, int $depth = 0): array {
    if ($depth > 4) {
      return [];
    }

    $type  = $definition['type'] ?? '';
    $class = $definition['class'] ?? '';

    // --- Mapping (object) ---------------------------------------------------
    if (isset($definition['mapping']) || str_contains($class, 'Mapping')) {
      return $this->walkMapping($definition, $tcm, $depth);
    }

    // --- Sequence (array) ---------------------------------------------------
    if (isset($definition['sequence']) || str_contains($class, 'Sequence')) {
      return $this->walkSequence($definition, $tcm, $depth);
    }

    // --- Scalar / type alias ------------------------------------------------
    return $this->walkScalar($type, $tcm, $depth);
  }

  /**
   * Resolves a scalar or type-alias definition to a JSON Schema fragment.
   *
   * @param string $type
   *   The typed-config type string.
   * @param \Drupal\Core\Config\TypedConfigManagerInterface $tcm
   *   The typed config manager.
   * @param int $depth
   *   Current recursion depth.
   *
   * @return array
   *   JSON Schema fragment: a primitive-typed schema, the resolved alias tree,
   *   or an empty (permissive) fragment when nothing resolves.
   */
  private function walkScalar(string $type, TypedConfigManagerInterface $tcm, int $depth): array {
    $primitive = $this->scalarToJsonSchemaType($type);
    if ($primitive !== NULL) {
      return ['type' => $primitive];
    }

    // Fallback: unknown or compound type string (e.g. "condition.plugin").
    // Try resolving the type alias one level; degrade to "string" on failure.
    if ($type !== '' && $depth < 4) {
      try {
        $resolved = $tcm->getDefinition($type);
        return $this->walkDefinition($resolved, $tcm, $depth + 1);
      }
      catch (\Exception) {
        // Cannot resolve — fall through.
      }
    }

    return [];
  }

  /**
   * Walks a sequence (array) typed-config definition to a JSON Schema fragment.
   *
   * @param array $definition
   *   A sequence typed-config definition.
   * @param \Drupal\Core\Config\TypedConfigManagerInterface $tcm
   *   The typed config manager.
   * @param int $depth
   *   Current recursion depth.
   *
   * @return array
   *   JSON Schema array fragment.
   */
  private function walkSequence(array $definition, TypedConfigManagerInterface $tcm, int $depth): array {
    $schema = ['type' => ['array', 'object']];
    if (isset($definition['sequence'])) {
      $schema['items'] = $this->walkDefinition($definition['sequence'], $tcm, $depth + 1);
    }
    return $schema;
  }

  /**
   * Walks a mapping (object) typed-config definition to a JSON Schema fragment.
   *
   * Extracted from walkDefinition() so each walker stays within the project's
   * complexity budget.
   *
   * @param array $definition
   *   A mapping typed-config definition.
   * @param \Drupal\Core\Config\TypedConfigManagerInterface $tcm
   *   The typed config manager (used to resolve type aliases at depth).
   * @param int $depth
   *   Current recursion depth.
   *
   * @return array
   *   JSON Schema object fragment.
   */
  private function walkMapping(array $definition, TypedConfigManagerInterface $tcm, int $depth): array {
    $schema = [
      'type'       => 'object',
      'properties' => [],
      'required'   => [],
    ];

    foreach (($definition['mapping'] ?? []) as $key => $propDef) {
      // Attempt to resolve a type alias so we get the full mapping/sequence
      // tree for named types (e.g. "config_dependencies", "langcode").
      $resolved = $this->resolveMappingProperty($propDef, $tcm);
      $schema['properties'][$key] = $this->walkDefinition($resolved, $tcm, $depth + 1);

      // A property is required unless explicitly marked optional.
      if (!isset($propDef['requiredKey']) || $propDef['requiredKey'] !== FALSE) {
        $schema['required'][] = $key;
      }
    }

    // Drupal-managed keys at the config-entity root: drush config:import
    // generates "uuid" and "_core" when absent, so sync-authored config
    // that omits them still imports successfully. They must stay allowed
    // (kept in "properties") but must not be required.
    if ($depth === 0) {
      $schema['required'] = array_values(array_diff($schema['required'], ['uuid', '_core']));
    }

    if (empty($schema['required'])) {
      unset($schema['required']);
    }

    if (empty($schema['properties'])) {
      unset($schema['properties']);
    }

    return $schema;
  }

  /**
   * Resolves a mapping property's type alias to its full definition.
   *
   * @param array $propDef
   *   The raw property definition from a parent mapping.
   * @param \Drupal\Core\Config\TypedConfigManagerInterface $tcm
   *   The typed config manager.
   *
   * @return array
   *   The resolved definition, or the raw property definition when it is
   *   already a mapping/sequence or the type alias cannot be resolved.
   */
  private function resolveMappingProperty(array $propDef, TypedConfigManagerInterface $tcm): array {
    if (isset($propDef['mapping']) || isset($propDef['sequence']) || !isset($propDef['type'])) {
      return $propDef;
    }
    try {
      return $tcm->getDefinition($propDef['type']);
    }
    catch (\Exception) {
      // Unknown type alias — keep the raw propDef; scalar fallback applies.
      return $propDef;
    }
  }

  /**
   * Emits the JSON Schema for a Drupal config name on stdout.
   *
   * @param string $config_name
   *   The Drupal config object name, e.g. "node.type.article".
   *
   * @usage drush designbook:config-schema node.type.article
   *   Print the JSON Schema for node.type.article.
   *
   * @command designbook:config-schema
   * @aliases dcs
   */
  public function configSchema(string $config_name): void {
    $definition = $this->typedConfig->getDefinition($config_name);
    $schema     = $this->walkDefinition($definition, $this->typedConfig);
    $schema     = empty($schema) ? new \stdClass() : $this->forceEmptySchemasToObjects($schema);
    // Write directly to stdout — Drush formatters are not involved.
    fwrite(STDOUT, json_encode($schema, JSON_THROW_ON_ERROR) . PHP_EOL);
  }

  /**
   * Recursively rewrites empty-array schema fragments to stdClass.
   *
   * WalkDefinition() returns PHP `[]` for a permissive ("accept anything")
   * schema fragment — see the depth-cap and unresolvable-type fallbacks.
   * PHP's json_encode() always renders an empty array as JSON `[]`, but a
   * bare `[]` is not a valid value wherever a JSON Schema is expected (e.g.
   * "items" must be an object or boolean per the JSON Schema meta-schema,
   * and AJV rejects `"items": []`). This walks the "items" and "properties"
   * schema-fragment slots and swaps any empty-array fragment for
   * `new \stdClass()` so it encodes as `{}` instead — semantically identical
   * ("no constraints"), but valid at every position a schema is expected.
   *
   * @param array $schema
   *   A JSON Schema fragment as produced by walkDefinition().
   *
   * @return array
   *   The same fragment with empty-array sub-schemas normalized to objects.
   */
  private function forceEmptySchemasToObjects(array $schema): array {
    if (isset($schema['items'])) {
      $schema['items'] = empty($schema['items'])
        ? new \stdClass()
        : $this->forceEmptySchemasToObjects($schema['items']);
    }

    if (isset($schema['properties'])) {
      foreach ($schema['properties'] as $key => $propSchema) {
        $schema['properties'][$key] = empty($propSchema)
          ? new \stdClass()
          : $this->forceEmptySchemasToObjects($propSchema);
      }
    }

    return $schema;
  }

  /**
   * Validates a YAML file against a Drupal config schema.
   *
   * Returns cleanly (exit 0) when the YAML conforms; throws (non-zero exit)
   * and writes violation detail to stderr when violations are found.
   *
   * @param string $config_name
   *   The Drupal config object name, e.g. "node.type.article".
   * @param string $yaml_path
   *   Absolute path (inside the container) to the YAML file to validate.
   *
   * @usage drush designbook:config-validate node.type.article /tmp/test.yml
   *   Validate /tmp/test.yml against the node.type.article schema.
   *
   * @command designbook:config-validate
   * @aliases dcv
   *
   * @throws \RuntimeException
   *   When the file is unreadable or the YAML fails schema validation; Drush
   *   surfaces this as a non-zero exit.
   */
  public function configValidate(string $config_name, string $yaml_path): void {
    $contents = file_exists($yaml_path) ? file_get_contents($yaml_path) : FALSE;
    if ($contents === FALSE) {
      throw new \RuntimeException("File not found or unreadable: $yaml_path");
    }

    $data = Yaml::parse($contents);

    $definition     = $this->typedConfig->getDefinition($config_name);
    $dataDefinition = $this->typedConfig->buildDataDefinition($definition, $data);
    $typedData      = $this->typedConfig->create($dataDefinition, $data, $config_name);
    $violations     = $typedData->validate();

    if (count($violations) === 0) {
      // Valid — return cleanly (exit 0).
      return;
    }

    // Write human-readable violations JSON to stderr, then fail non-zero.
    $detail = ConfigInspectorManager::violationsToArray($violations);
    fwrite(STDERR, json_encode($detail, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT) . PHP_EOL);
    throw new \RuntimeException("Config $config_name failed schema validation.");
  }

}
