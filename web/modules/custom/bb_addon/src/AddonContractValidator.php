<?php

declare(strict_types=1);

namespace Drupal\bb_addon;

use Drupal\bb_inbox\MessageContractValidator;

/**
 * Validates an addon definition (contract 2): its envelope and messages.
 *
 * `schemas/addon-definition.v2.schema.json` covers name, version, contract
 * and the `messages` map; each message is validated by the inbox's
 * message-contract validator, with errors under `messages.<key>.`.
 */
final class AddonContractValidator {

  /**
   * The decoded addon-definition schema.
   */
  private ?object $schema = NULL;

  public function __construct(
    private readonly MessageContractValidator $messages,
  ) {}

  /**
   * Validates a contract-2 definition and each of its messages.
   *
   * @param array<string, mixed>|object $definition
   *   The definition; an object when decoded from JSON text.
   *
   * @return array<string>
   *   The errors, empty when valid.
   */
  public function validateDefinitionV2(array|object $definition): array {
    $errors = $this->messages->schemaErrors($this->schema(), $definition);
    if ($errors !== []) {
      return $errors;
    }
    $messages = (array) ((array) $definition)['messages'];
    foreach ($messages as $key => $message) {
      foreach ($this->messages->validateDefinition($message) as $error) {
        $errors[] = str_starts_with($error, '(root)')
          ? "messages.$key" . substr($error, 6)
          : "messages.$key.$error";
      }
    }
    return $errors;
  }

  /**
   * The addon-definition schema, decoded to objects.
   */
  private function schema(): object {
    if ($this->schema === NULL) {
      $schema = json_decode((string) file_get_contents(dirname(__DIR__) . '/schemas/addon-definition.v2.schema.json'));
      assert(is_object($schema));
      $this->schema = $schema;
    }
    return $this->schema;
  }

}
