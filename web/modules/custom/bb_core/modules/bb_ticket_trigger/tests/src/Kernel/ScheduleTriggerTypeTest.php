<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_ticket_trigger\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\bb_ticket_trigger\TicketTrigger\BbTicketTriggerTypeInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the `schedule` ticket trigger type: recurrence, validation, summary.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ScheduleTriggerTypeTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'plugin',
    'link', 'text', 'filter', 'bb_core', 'bb_ticket_trigger',
  ];

  /**
   * Creates a `schedule` instance with the given configuration.
   *
   * @param array<string, mixed> $configuration
   *   The plugin configuration.
   */
  private function schedule(array $configuration): BbTicketTriggerTypeInterface {
    $plugin = $this->container->get('plugin.manager.bb_ticket_trigger_type')->createInstance('schedule', $configuration);
    self::assertInstanceOf(BbTicketTriggerTypeInterface::class, $plugin);
    return $plugin;
  }

  /**
   * Returns the next occurrence after a UTC instant, as a UTC ISO string.
   *
   * @param array<string, mixed> $configuration
   *   The plugin configuration.
   * @param string $after
   *   The UTC instant.
   */
  private function nextAfter(array $configuration, string $after): ?string {
    $next = $this->schedule($configuration)->nextOccurrence(new \DateTimeImmutable($after));
    return $next?->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i\Z');
  }

  /**
   * Recurrence cases: zone, month end, DST gap and overlap, exact boundary.
   *
   * @return array<string, array{array<string, mixed>, string, string}>
   *   Configuration, `after` (UTC), expected next occurrence (UTC).
   */
  public static function occurrences(): array {
    $monthly = ['frequency' => 'monthly', 'day' => '1', 'time' => '09:00', 'timezone' => 'Europe/Berlin'];
    $day31 = ['day' => '31'] + $monthly;
    $daily = ['frequency' => 'daily', 'time' => '02:30', 'timezone' => 'Europe/Berlin'];
    return [
      'monthly in winter time' => [$monthly, '2026-10-20T00:00Z', '2026-11-01T08:00Z'],
      'monthly in summer time' => [$monthly, '2027-03-02T00:00Z', '2027-04-01T07:00Z'],
      'day 31 in February' => [$day31, '2027-02-01T00:00Z', '2027-02-28T08:00Z'],
      'day 31 in a leap February' => [$day31, '2028-02-01T00:00Z', '2028-02-29T08:00Z'],
      'day 31 in April' => [$day31, '2027-04-01T00:00Z', '2027-04-30T07:00Z'],
      'last day of the month' => [
        ['day' => 'last', 'time' => '18:00'] + $monthly,
        '2026-11-15T00:00Z',
        '2026-11-30T17:00Z',
      ],
      'spring gap runs after the gap' => [$daily, '2027-03-27T12:00Z', '2027-03-28T01:30Z'],
      'autumn overlap runs at the first instance' => [$daily, '2026-10-24T12:00Z', '2026-10-25T00:30Z'],
      'autumn overlap runs only once' => [$daily, '2026-10-25T00:30Z', '2026-10-26T01:30Z'],
      'weekly exactly due is strictly after' => [
        ['frequency' => 'weekly', 'weekday' => 1, 'time' => '09:00', 'timezone' => 'Europe/Berlin'],
        '2026-10-19T07:00Z',
        '2026-10-26T08:00Z',
      ],
    ];
  }

  /**
   * The next occurrence follows zone, month-end and DST rules.
   *
   * @param array<string, mixed> $configuration
   *   The plugin configuration.
   * @param string $after
   *   The instant the occurrence must be strictly after.
   * @param string $expected
   *   The expected occurrence, UTC.
   */
  #[DataProvider('occurrences')]
  public function testNextOccurrence(array $configuration, string $after, string $expected): void {
    $this->assertSame($expected, $this->nextAfter($configuration, $after));
  }

  /**
   * Each invalid setting yields exactly one error.
   */
  public function testConfigurationErrors(): void {
    $valid = ['frequency' => 'monthly', 'day' => '1', 'time' => '09:00', 'timezone' => 'Europe/Berlin'];
    $this->assertSame([], $this->schedule($valid)->configurationErrors());
    $this->assertCount(1, $this->schedule(['timezone' => 'Mars/Olympus'] + $valid)->configurationErrors());
    $this->assertCount(1, $this->schedule(['time' => '25:00'] + $valid)->configurationErrors());
    $this->assertCount(1, $this->schedule(['day' => '0'] + $valid)->configurationErrors());
    $this->assertCount(1, $this->schedule(['frequency' => 'weekly', 'time' => '09:00', 'timezone' => 'UTC'])->configurationErrors());
    $stale = ['frequency' => 'daily', 'day' => '31', 'time' => '09:00', 'timezone' => 'UTC'];
    $this->assertSame([], $this->schedule($stale)->configurationErrors());
  }

  /**
   * Submitting the form keeps only the chosen frequency's keys.
   */
  public function testSubmitDropsStaleKeys(): void {
    $plugin = $this->schedule([]);
    $form = ['#parents' => ['settings']];
    $form_state = new FormState();
    $form_state->setValue('settings', [
      'frequency' => 'daily',
      'weekday' => '3',
      'day' => '31',
      'time' => '07:15',
      'timezone' => 'UTC',
    ]);
    $plugin->submitConfigurationForm($form, $form_state);
    $this->assertSame(['frequency' => 'daily', 'time' => '07:15', 'timezone' => 'UTC'], $plugin->getConfiguration());
  }

  /**
   * The time is a native time input in a plain form element, stored as HH:MM.
   *
   * A textfield, not core's datetime element, so the label and description
   * render like every other field.
   */
  public function testTimeIsPickedWithTheBrowsersTimeInput(): void {
    $plugin = $this->schedule([]);
    $form = $plugin->buildConfigurationForm([], new FormState());
    $this->assertSame('textfield', $form['time']['#type']);
    $this->assertSame('time', $form['time']['#attributes']['type'] ?? NULL);
    $this->assertSame('09:00', $form['time']['#default_value']);

    $form = ['#parents' => ['settings']];
    $form_state = new FormState();
    $form_state->setValue('settings', ['frequency' => 'daily', 'time' => '07:05', 'timezone' => 'UTC']);
    $plugin->submitConfigurationForm($form, $form_state);
    $this->assertSame('07:05', $plugin->getConfiguration()['time']);
  }

  /**
   * The summary is a one-line, human-readable description.
   */
  public function testSummary(): void {
    $this->assertSame(
      'Monthly on day 1 at 09:00 (Europe/Berlin)',
      $this->schedule(['frequency' => 'monthly', 'day' => '1', 'time' => '09:00', 'timezone' => 'Europe/Berlin'])->summary(),
    );
  }

  /**
   * The plugin module derives a field type for the trigger plugin type.
   */
  public function testPluginFieldTypeExists(): void {
    $this->assertTrue($this->container->get('plugin.manager.field.field_type')->hasDefinition('plugin:bb_ticket_trigger_type'));
  }

}
