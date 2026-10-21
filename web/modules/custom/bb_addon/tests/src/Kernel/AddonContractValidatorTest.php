<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_addon\Kernel;

use Drupal\bb_addon\AddonContractValidator;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The addon definition envelope and its delegation to the inbox validator.
 */
#[Group('bb_addon')]
#[RunTestsInSeparateProcesses]
final class AddonContractValidatorTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'file', 'image',
    'serialization', 'jsonapi', 'jsonapi_resources',
    'bb_core', 'bb_inbox', 'bb_addon',
  ];

  /**
   * The validator under test.
   */
  private AddonContractValidator $validator;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->validator = $this->container->get('bb_addon.contract_validator');
  }

  /**
   * A minimal contract-2 definition with a parameterless view message.
   */
  public function testAcceptsMinimalV2Definition(): void {
    $definition = [
      'name' => 'ports',
      'version' => '1.0.0',
      'contract' => 2,
      'label' => 'Ports',
      'messages' => ['tunnel' => ['label' => 'Tunnel-Links bereitstellen', 'access' => 'view']],
    ];
    self::assertSame([], $this->validator->validateDefinitionV2($definition));
  }

  /**
   * An optional icon must be inline SVG markup.
   */
  public function testIconIsInlineSvg(): void {
    $definition = [
      'name' => 'ports',
      'version' => '1.0.0',
      'contract' => 2,
      'icon' => '<svg xmlns="http://www.w3.org/2000/svg"/>',
      'messages' => ['tunnel' => ['label' => 'Tunnel']],
    ];
    self::assertSame([], $this->validator->validateDefinitionV2($definition));
    $definition['icon'] = '<img src="x">';
    self::assertNotSame([], $this->validator->validateDefinitionV2($definition));
  }

  /**
   * A contract-2 definition cannot carry the retired `actions`/`views` keys.
   */
  public function testRejectsRetiredKeysInV2Definition(): void {
    $definition = [
      'contract' => 2,
      'messages' => ['tunnel' => ['label' => 'Tunnel']],
      'actions' => [],
    ];
    self::assertNotSame([], $this->validator->validateDefinitionV2($definition));
  }

  /**
   * Each message is delegated to the inbox validator, errors under its key.
   */
  public function testDelegatesMessagesToTheInboxValidator(): void {
    $definition = [
      'name' => 'ports',
      'version' => '1.0.0',
      'contract' => 2,
      'messages' => [
        'stop' => [
          'label' => 'Stop',
          'input' => ['type' => 'object', 'required' => ['host'], 'properties' => ['port' => ['type' => 'integer']]],
        ],
        'tunnel' => ['access' => 'view'],
      ],
    ];
    $errors = $this->validator->validateDefinitionV2($definition);
    self::assertContains('messages.stop.input.required: host is not a property', $errors);
    self::assertCount(2, $errors);
    self::assertStringStartsWith('messages.tunnel', $errors[1]);
  }

}
