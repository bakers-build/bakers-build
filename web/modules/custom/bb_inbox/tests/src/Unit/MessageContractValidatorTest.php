<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_inbox\Unit;

use Drupal\bb_inbox\MessageContractValidator;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;

/**
 * The PHP message validator agrees with `@bakers-build/message`.
 */
#[Group('bb_inbox')]
final class MessageContractValidatorTest extends UnitTestCase {

  /**
   * The validator under test.
   */
  private MessageContractValidator $validator;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->validator = new MessageContractValidator();
  }

  /**
   * The schema copies stay byte-identical to `bakers-cli/message/schemas/`.
   */
  public function testSchemasAreCopiesOfTheCliPackage(): void {
    $root = dirname(__DIR__, 7);
    foreach (['message-definition.v2.schema.json', 'message-result.v2.schema.json'] as $file) {
      self::assertFileEquals(
        "$root/bakers-cli/message/schemas/$file",
        "$root/web/modules/custom/bb_inbox/schemas/$file",
        "bb_inbox/schemas/$file drifted from bakers-cli/message/schemas/$file.",
      );
    }
  }

  /**
   * A message definition: schema and type consistency, with input paths.
   */
  public function testValidatesDefinition(): void {
    self::assertSame([], $this->validator->validateDefinition(['label' => 'Tunnel', 'access' => 'view']));
    self::assertNotSame([], $this->validator->validateDefinition(['access' => 'view']));
    $nested = ['label' => 'Stop', 'input' => ['type' => 'object', 'properties' => ['port' => ['type' => 'object']]]];
    self::assertNotSame([], $this->validator->validateDefinition($nested));
    $inconsistent = [
      'label' => 'Stop',
      'input' => [
        'type' => 'object',
        'required' => ['host'],
        'properties' => ['port' => ['type' => 'integer', 'default' => 'x', 'pattern' => '\\d+']],
      ],
    ];
    self::assertSame([
      'input.properties.port.default: does not match type integer',
      'input.properties.port.pattern: only allowed on string',
      'input.required: host is not a property',
    ], $this->validator->validateDefinition($inconsistent));
  }

  /**
   * A result is only `{markdown}`, and tolerates an empty string.
   */
  public function testValidatesResult(): void {
    self::assertSame([], $this->validator->validateResult(['markdown' => '']));
    self::assertNotSame([], $this->validator->validateResult(['markdown' => '', 'rows' => []]));
    self::assertNotSame([], $this->validator->validateResult(['message' => 'x', 'level' => 'error']));
    self::assertNotSame([], $this->validator->validateResult([]));
  }

  /**
   * A payload validates against its message's input, closed to extras.
   */
  public function testValidatesArgs(): void {
    $stop = [
      'label' => 'Stop',
      'input' => ['type' => 'object', 'required' => ['port'], 'properties' => ['port' => ['type' => 'integer']]],
    ];
    self::assertSame([], $this->validator->validateArgs($stop, ['port' => 443]));
    self::assertNotSame([], $this->validator->validateArgs($stop, []));
    self::assertNotSame([], $this->validator->validateArgs($stop, ['port' => 443, 'extra' => 1]));
    self::assertSame([], $this->validator->validateArgs(['label' => 'Tunnel'], []));
    self::assertNotSame([], $this->validator->validateArgs(['label' => 'Tunnel'], ['extra' => 1]));
  }

}
