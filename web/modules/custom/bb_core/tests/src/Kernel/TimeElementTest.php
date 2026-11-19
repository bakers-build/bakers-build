<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Element\Time;
use Drupal\Core\Form\FormInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The `bb_time` form element: a duration or clock time typed as text.
 *
 * A bare whole hour is accepted and completed: `8` is `8:00` as a duration
 * and `08:00` as a clock time.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TimeElementTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'island', 'bb_core',
  ];

  /**
   * Typed values, their mode and the seconds they mean, NULL when invalid.
   *
   * @return array<string, array{string, string, int|null}>
   *   Typed value, mode, seconds.
   */
  public static function parsed(): array {
    return [
      'bare hour' => ['8', 'duration', 28800],
      'padded bare hour' => [' 8 ', 'duration', 28800],
      'zero' => ['0', 'duration', 0],
      'twelve' => ['12', 'duration', 43200],
      'H:MM' => ['8:00', 'duration', 28800],
      'H:MM with minutes' => ['8:30', 'duration', 30600],
      'long duration' => ['25', 'duration', 90000],
      'letters' => ['abc', 'duration', NULL],
      'minutes past 59' => ['8:75', 'duration', NULL],
      'decimal hours' => ['8.5', 'duration', NULL],
      'clock bare hour' => ['8', 'clock', 28800],
      'clock H:MM' => ['8:30', 'clock', 30600],
      'clock HH:MM' => ['23:59', 'clock', 86340],
      'clock midnight' => ['0', 'clock', 0],
      'clock 24' => ['24', 'clock', NULL],
      'clock minutes past 59' => ['8:75', 'clock', NULL],
      'clock letters' => ['abc', 'clock', NULL],
    ];
  }

  /**
   * Parses durations and clock times, a bare whole hour included.
   */
  #[DataProvider('parsed')]
  public function testParse(string $typed, string $mode, ?int $seconds): void {
    self::assertSame($seconds, Time::parse($typed, $mode));
  }

  /**
   * Typed values, their mode and the value the field shows.
   *
   * @return array<string, array{string, string, string}>
   *   Typed value, mode, shown value.
   */
  public static function normalized(): array {
    return [
      'bare hour' => ['8', 'duration', '8:00'],
      'padded bare hour' => [' 8 ', 'duration', '8:00'],
      'zero' => ['0', 'duration', '0:00'],
      'H:MM unchanged' => ['8:30', 'duration', '8:30'],
      'invalid unchanged' => ['abc', 'duration', 'abc'],
      'clock bare hour' => ['8', 'clock', '08:00'],
      'clock H:MM' => ['8:30', 'clock', '08:30'],
      'clock HH:MM unchanged' => ['14:30', 'clock', '14:30'],
      'clock invalid unchanged' => ['24', 'clock', '24'],
    ];
  }

  /**
   * Completes a valid value, and leaves an invalid one as typed.
   */
  #[DataProvider('normalized')]
  public function testNormalize(string $typed, string $mode, string $shown): void {
    self::assertSame($shown, Time::normalize($typed, $mode));
  }

  /**
   * Each invalid field gets its own error; a valid one its completed value.
   */
  public function testErrorsAtTheirOwnFields(): void {
    $form_state = new FormState();
    $form_state->setUserInput([
      'range' => '25',
      'format' => 'abc',
      'clock' => '24',
      'ok' => '8',
      'clock_ok' => '8:30',
      'empty' => '',
      'form_id' => 'bb_time_element_test_form',
    ]);
    $form_state->setProgrammed();
    $form_state->setAlwaysProcess(TRUE);
    $this->container->get('form_builder')->buildForm($this->formOf([
      'range' => [
        '#type' => 'bb_time',
        '#minimum' => 60,
        '#maximum' => 86400,
        '#range_error' => 'Out of range.',
      ],
      'format' => ['#type' => 'bb_time', '#format_error' => 'Bad format.'],
      'clock' => ['#type' => 'bb_time', '#mode' => 'clock'],
      'ok' => ['#type' => 'bb_time'],
      'clock_ok' => ['#type' => 'bb_time', '#mode' => 'clock'],
      'empty' => ['#type' => 'bb_time'],
    ]), $form_state);

    $errors = array_map('strval', $form_state->getErrors());
    self::assertSame([
      'range' => 'Out of range.',
      'format' => 'Bad format.',
      'clock' => 'Enter the time as whole hours or HH:MM (24 hours), for example 8 or 14:30.',
    ], $errors);
    self::assertSame('8:00', $form_state->getValue('ok'));
    self::assertSame('08:30', $form_state->getValue('clock_ok'));
  }

  /**
   * A form holding the given elements.
   *
   * @param array<string, mixed> $elements
   *   The form elements, keyed by name.
   */
  private function formOf(array $elements): FormInterface {
    return new class($elements) implements FormInterface {

      /**
       * @param array<string, mixed> $elements
       *   The form elements, keyed by name.
       */
      public function __construct(private readonly array $elements) {}

      /**
       * {@inheritdoc}
       */
      public function getFormId(): string {
        return 'bb_time_element_test_form';
      }

      /**
       * {@inheritdoc}
       */
      public function buildForm(array $form, FormStateInterface $form_state): array {
        return $form + $this->elements;
      }

      /**
       * {@inheritdoc}
       */
      public function validateForm(array &$form, FormStateInterface $form_state): void {}

      /**
       * {@inheritdoc}
       */
      public function submitForm(array &$form, FormStateInterface $form_state): void {}

    };
  }

}
