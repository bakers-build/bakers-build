<?php

declare(strict_types=1);

namespace Drupal\bb_inbox;

use JsonSchema\Constraints\Constraint;
use JsonSchema\Validator;

/**
 * Validates message definitions, payloads and results (message contract 2).
 *
 * `schemas/` holds byte-identical copies of `@bakers-build/message`'s schemas
 * (`bakers-cli/message/schemas/`); the checks beyond the schema mirror its
 * TypeScript validators, with the same error paths.
 */
final class MessageContractValidator {

  /**
   * Decoded schemas, keyed by file name.
   *
   * @var array<string, object>
   */
  private array $schemas = [];

  /**
   * Validates one message definition: schema plus type consistency.
   *
   * @param array<string, mixed>|object $definition
   *   The message definition; an object when decoded from JSON text.
   *
   * @return array<string>
   *   The errors, empty when valid.
   */
  public function validateDefinition(array|object $definition): array {
    $errors = $this->schemaErrors($this->schema('message-definition.v2.schema.json'), $definition);
    return $errors === [] ? $this->consistencyErrors(self::toArray($definition)['input'] ?? NULL) : $errors;
  }

  /**
   * Validates a payload against a message's input, closed to extra keys.
   *
   * @param array<string, mixed> $definition
   *   The message definition; no `input` means an empty object.
   * @param array<string, mixed>|object $payload
   *   The payload; an object when decoded from JSON text.
   *
   * @return array<string>
   *   The errors, empty when valid.
   */
  public function validateArgs(array $definition, array|object $payload): array {
    $input = $definition['input'] ?? ['type' => 'object', 'properties' => []];
    $input['additionalProperties'] = FALSE;
    $schema = self::toJsonObject($input);
    $schema->properties = (object) ($schema->properties ?? []);
    return $this->schemaErrors($schema, $payload);
  }

  /**
   * Validates a message result: just the closed `{markdown}` schema.
   *
   * @param array<string, mixed>|object $result
   *   The result; an object when decoded from JSON text.
   *
   * @return array<string>
   *   The errors, empty when valid.
   */
  public function validateResult(array|object $result): array {
    return $this->schemaErrors($this->schema('message-result.v2.schema.json'), $result);
  }

  /**
   * Runs the draft-07 validator.
   *
   * Strict mode is the only one that knows draft-07 keywords, and it reads
   * JSON objects as stdClass only; arrays are converted first.
   *
   * @param object $schema
   *   The decoded schema.
   * @param array<mixed>|object $data
   *   The data.
   *
   * @return array<string>
   *   The errors, as `path: message`.
   */
  public function schemaErrors(object $schema, array|object $data): array {
    $value = is_array($data) ? self::toJsonObject($data) : $data;
    $validator = new Validator();
    $validator->validate($value, $schema, Constraint::CHECK_MODE_NORMAL | Constraint::CHECK_MODE_STRICT);
    $errors = [];
    foreach ($validator->getErrors() as $error) {
      $path = ltrim((string) ($error['property'] ?? ''), '.') ?: '(root)';
      $errors[] = "$path: {$error['message']}";
    }
    return $errors;
  }

  /**
   * The checks JSON Schema cannot express, for a schema-valid input.
   *
   * @param array<string, mixed>|null $input
   *   The message's input, if any.
   *
   * @return array<string>
   *   The errors.
   */
  private function consistencyErrors(?array $input): array {
    if ($input === NULL) {
      return [];
    }
    $errors = [];
    foreach ($input['properties'] as $name => $field) {
      $errors = [...$errors, ...$this->fieldErrors("input.properties.$name", $field)];
    }
    foreach ($input['required'] ?? [] as $name) {
      if (!array_key_exists($name, $input['properties'])) {
        $errors[] = "input.required: $name is not a property";
      }
    }
    return $errors;
  }

  /**
   * Type-consistency errors of one field.
   *
   * @param string $at
   *   The field's path.
   * @param array<string, mixed> $field
   *   The field.
   *
   * @return array<string>
   *   The errors.
   */
  private function fieldErrors(string $at, array $field): array {
    return [...$this->valueErrors($at, $field), ...$this->keywordErrors($at, $field)];
  }

  /**
   * The default and enum values must fit the field type.
   *
   * @param string $at
   *   The field's path.
   * @param array<string, mixed> $field
   *   The field.
   *
   * @return array<string>
   *   The errors.
   */
  private function valueErrors(string $at, array $field): array {
    $errors = [];
    $type = $field['type'];
    if (array_key_exists('default', $field) && !self::matchesType($type, $field['default'])) {
      $errors[] = "$at.default: does not match type $type";
    }
    foreach ($field['enum'] ?? [] as $value) {
      if (!self::matchesType($type, $value)) {
        $errors[] = "$at.enum: items must match type $type";
        break;
      }
    }
    return $errors;
  }

  /**
   * Number keywords only on numbers, string keywords only on strings.
   *
   * @param string $at
   *   The field's path.
   * @param array<string, mixed> $field
   *   The field.
   *
   * @return array<string>
   *   The errors.
   */
  private function keywordErrors(string $at, array $field): array {
    $errors = [];
    $type = $field['type'];
    $numeric = in_array($type, ['integer', 'number'], TRUE);
    foreach (['minimum', 'maximum'] as $keyword) {
      if (array_key_exists($keyword, $field) && !$numeric) {
        $errors[] = "$at.$keyword: only allowed on integer or number";
      }
    }
    foreach (['minLength', 'maxLength', 'pattern', 'format'] as $keyword) {
      if (array_key_exists($keyword, $field) && $type !== 'string') {
        $errors[] = "$at.$keyword: only allowed on string";
      }
    }
    if (isset($field['pattern']) && !self::compiles($field['pattern'])) {
      $errors[] = "$at.pattern: does not compile";
    }
    return $errors;
  }

  /**
   * Whether a pattern compiles, without emitting the PCRE warning.
   */
  private static function compiles(string $pattern): bool {
    set_error_handler(static fn () => TRUE);
    try {
      return preg_match('/' . str_replace('/', '\/', $pattern) . '/u', '') !== FALSE;
    }
    finally {
      restore_error_handler();
    }
  }

  /**
   * Whether a value fits a field type.
   */
  private static function matchesType(string $type, mixed $value): bool {
    return match ($type) {
      'integer' => is_int($value) || (is_float($value) && floor($value) === $value),
      'number' => (is_int($value) || is_float($value)) && is_finite((float) $value),
      'boolean' => is_bool($value),
      'string' => is_string($value),
      default => FALSE,
    };
  }

  /**
   * Converts a decoded array to a JSON object.
   *
   * An associative json_decode() cannot tell `{}` from `[]`; the top level
   * is an object, nested lists and empty arrays are read as lists.
   *
   * @param array<mixed> $value
   *   The array.
   */
  private static function toJsonObject(array $value): \stdClass {
    $object = new \stdClass();
    foreach ($value as $key => $item) {
      $object->{$key} = self::toJsonValue($item);
    }
    return $object;
  }

  /**
   * Converts a nested decoded value to its JSON form.
   */
  private static function toJsonValue(mixed $value): mixed {
    if (!is_array($value)) {
      return $value;
    }
    return $value === [] || array_is_list($value)
      ? array_map(static fn ($v) => self::toJsonValue($v), $value)
      : self::toJsonObject($value);
  }

  /**
   * Decodes JSON values to arrays for the checks beyond the schema.
   *
   * @param array<mixed>|object $data
   *   The data.
   *
   * @return array<mixed>
   *   The data as arrays.
   */
  private static function toArray(array|object $data): array {
    return is_array($data) ? $data : (array) json_decode((string) json_encode($data), TRUE);
  }

  /**
   * A schema file of this module, decoded to objects.
   */
  private function schema(string $file): object {
    if (!isset($this->schemas[$file])) {
      $schema = json_decode((string) file_get_contents(dirname(__DIR__) . '/schemas/' . $file));
      assert(is_object($schema));
      $this->schemas[$file] = $schema;
    }
    return $this->schemas[$file];
  }

}
