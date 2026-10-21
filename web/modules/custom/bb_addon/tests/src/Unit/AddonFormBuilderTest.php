<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_addon\Unit;

use Drupal\bb_addon\AddonFormBuilder;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;

/**
 * The input subset maps onto Form API elements and back to typed values.
 */
#[Group('bb_addon')]
final class AddonFormBuilderTest extends UnitTestCase {

  private const INPUT = [
    'type' => 'object',
    'required' => ['name', 'port', 'level'],
    'properties' => [
      'name' => ['type' => 'string', 'title' => 'Name', 'description' => 'Who', 'maxLength' => 20],
      'note' => ['type' => 'string', 'format' => 'multiline'],
      'url' => ['type' => 'string', 'format' => 'uri'],
      'color' => ['type' => 'string', 'enum' => ['red', 'blue']],
      'port' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 65535],
      'ratio' => ['type' => 'number'],
      'force' => ['type' => 'boolean'],
      'level' => ['type' => 'integer', 'default' => 2],
    ],
  ];

  /**
   * Each field form renders as the element the rendering table names.
   */
  public function testElementsFollowTheRenderingTable(): void {
    $elements = (new AddonFormBuilder())->elements(self::INPUT);
    self::assertSame(['name', 'note', 'url', 'color', 'port', 'ratio', 'force', 'level'], array_keys($elements));
    self::assertSame('textfield', $elements['name']['#type']);
    self::assertSame(20, $elements['name']['#maxlength']);
    self::assertSame('Name', $elements['name']['#title']);
    self::assertSame('Who', $elements['name']['#description']);
    self::assertSame('textarea', $elements['note']['#type']);
    self::assertSame('note', $elements['note']['#title']);
    self::assertSame('url', $elements['url']['#type']);
    self::assertSame('select', $elements['color']['#type']);
    self::assertSame(['red' => 'red', 'blue' => 'blue'], $elements['color']['#options']);
    self::assertSame(['number', 1, 1, 65535], [
      $elements['port']['#type'],
      $elements['port']['#step'],
      $elements['port']['#min'],
      $elements['port']['#max'],
    ]);
    self::assertSame(['number', 'any'], [$elements['ratio']['#type'], $elements['ratio']['#step']]);
    self::assertSame('checkbox', $elements['force']['#type']);
  }

  /**
   * Required without a default is mandatory; defaults prefill.
   */
  public function testRequiredAndDefaults(): void {
    $elements = (new AddonFormBuilder())->elements(self::INPUT, ['port' => 443]);
    self::assertTrue($elements['name']['#required']);
    self::assertTrue($elements['port']['#required']);
    self::assertFalse($elements['level']['#required']);
    self::assertFalse($elements['note']['#required']);
    self::assertSame(2, $elements['level']['#default_value']);
    self::assertSame(443, $elements['port']['#default_value']);
  }

  /**
   * Submitted strings become typed values; empty optional fields are omitted.
   */
  public function testValuesAreTypedAndEmptyOptionalsOmitted(): void {
    $values = (new AddonFormBuilder())->values(self::INPUT, [
      'name' => 'a',
      'note' => '',
      'url' => '',
      'color' => 'red',
      'port' => '443',
      'ratio' => '0.5',
      'force' => 1,
      'level' => '3',
    ]);
    self::assertSame(['name' => 'a', 'color' => 'red', 'port' => 443, 'ratio' => 0.5, 'force' => TRUE, 'level' => 3], $values);
    self::assertSame([], (new AddonFormBuilder())->values(NULL, ['x' => 1]));
  }

}
