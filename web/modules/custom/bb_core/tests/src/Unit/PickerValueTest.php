<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Core\Form\FormState;
use Drupal\bb_core\Element\PickerValue;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;

/**
 * A picker accepts scalar values, never nested request structures.
 */
#[Group('bb_core')]
final class PickerValueTest extends UnitTestCase {

  /**
   * Malformed input remains a validation error, not a successful clear.
   */
  public function testNestedInputIsRejected(): void {
    $element = ['#parents' => ['example'], '#title' => 'Example'];
    $state = new FormState();
    PickerValue::valueCallback($element, [['nested' => '1']], $state);
    self::assertTrue($element['#invalid_picker_input'] ?? FALSE);
  }

  /**
   * Scalars, flat lists, absent input, and defaults retain their meanings.
   */
  public function testAcceptedValues(): void {
    $element = ['#default_value' => ['default']];
    $state = new FormState();
    self::assertSame(['default'], PickerValue::valueCallback($element, FALSE, $state));
    self::assertSame([], PickerValue::valueCallback($element, NULL, $state));
    self::assertSame(['1'], PickerValue::valueCallback($element, '1', $state));
    self::assertSame(['1', '2'], PickerValue::valueCallback($element, ['1', '2'], $state));
    self::assertSame([], PickerValue::valueCallback($element, '', $state));
  }

}
