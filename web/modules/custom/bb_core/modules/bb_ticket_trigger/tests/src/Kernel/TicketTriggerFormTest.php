<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_ticket_trigger\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\bb_ticket_trigger\Form\TicketTriggerToggleForm;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The trigger form inside the template: type form, accounts, activation.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketTriggerFormTest extends KernelTestBase {

  use TicketTriggerTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'system', 'user', 'serialization', 'options', 'entity',
    'state_machine', 'link', 'text', 'filter', 'markdown_easy', 'field', 'og',
    'plugin', 'consumers', 'simple_oauth', 'views', 'island', 'bb_core',
    'bb_api_key', 'bb_ticket_trigger',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installTriggerWorld();
    $this->freezeTriggerTime('2026-10-20T00:00:00Z');
  }

  /**
   * Builds the add form for a new trigger on side a's template.
   *
   * @return array<string, mixed>
   *   The built form.
   */
  private function buildAddForm(FormStateInterface $form_state): array {
    $this->container->get('current_user')->setAccount($this->lead('a'));
    $form_object = $this->container->get('entity_type.manager')->getFormObject('bb_ticket_trigger', 'add');
    $form_object->setEntity($this->newTrigger('a'));
    return $this->container->get('form_builder')->buildForm($form_object, $form_state);
  }

  /**
   * The values of a monthly submission.
   *
   * @return array<string, mixed>
   *   Form values.
   */
  private static function monthlyValues(string $actor, bool $enabled): array {
    return [
      'trigger_type' => [
        [
          'plugin_selector' => [
            'container' => [
              'select' => ['container' => ['plugin_id' => 'schedule']],
              'plugin_form' => [
                'frequency' => 'monthly',
                'weekday' => '3',
                'day' => '15',
                'time' => '06:45',
                'timezone' => 'Europe/Berlin',
              ],
            ],
          ],
        ],
      ],
      'actor_uid' => $actor,
      'enabled' => ['value' => $enabled ? 1 : 0],
    ];
  }

  /**
   * Submits the add form and returns the saved trigger, if any.
   *
   * @param array<string, mixed> $values
   *   The submitted values.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state, holding the errors afterwards.
   */
  private function submitAddForm(array $values, FormStateInterface $form_state): ?BbTicketTriggerInterface {
    $this->container->get('current_user')->setAccount($this->lead('a'));
    $form_object = $this->container->get('entity_type.manager')->getFormObject('bb_ticket_trigger', 'add');
    $form_object->setEntity($this->newTrigger('a'));
    $form_state->setValues($values);
    $form_state->setValue('op', 'Save');
    $this->container->get('form_builder')->submitForm($form_object, $form_state);
    $ids = $this->container->get('entity_type.manager')->getStorage('bb_ticket_trigger')->getQuery()->accessCheck(FALSE)->execute();
    $trigger = $ids === [] ? NULL : $this->container->get('entity_type.manager')->getStorage('bb_ticket_trigger')->load(reset($ids));
    return $trigger instanceof BbTicketTriggerInterface ? $trigger : NULL;
  }

  /**
   * The form renders the schedule's own form and offers own accounts only.
   */
  public function testFormOffersScheduleAndOwnServiceAccounts(): void {
    $own = $this->serviceAccount('a');
    $foreign = $this->serviceAccount('b');
    $form = $this->buildAddForm(new FormState());

    $this->assertSame('monthly', $form['trigger_type']['widget'][0]['plugin_selector']['container']['plugin_form']['frequency']['#default_value'] ?? NULL);
    $options = $form['actor_uid']['widget']['#options'];
    $this->assertArrayHasKey((int) $own->id(), $options);
    $this->assertArrayNotHasKey((int) $foreign->id(), $options);
    $this->assertArrayNotHasKey((int) $this->lead('a')->id(), $options);
  }

  /**
   * The schedule form of a form built for $frequency.
   *
   * @return array<string, mixed>
   *   The schedule's plugin form.
   */
  private function scheduleFormFor(?string $frequency): array {
    $form_state = new FormState();
    if ($frequency !== NULL) {
      // As the htmx refresh posts it: the frequency, not a button.
      $values = self::monthlyValues('', FALSE);
      $values['trigger_type'][0]['plugin_selector']['container']['plugin_form']['frequency'] = $frequency;
      // Programmed, so no session token is needed; the frequency is the
      // triggering element, so no submit handler runs.
      $form_state->setProgrammed();
      $form_state->setUserInput($values + [
        '_triggering_element_name' => 'trigger_type[0][plugin_selector][container][plugin_form][frequency]',
      ]);
    }
    $form = $this->buildAddForm($form_state);
    return $form['trigger_type']['widget'][0]['plugin_selector']['container']['plugin_form'];
  }

  /**
   * Only the chosen frequency's own fields are offered.
   */
  public function testScheduleOffersOnlyTheChosenFrequencysFields(): void {
    $expected = [
      'monthly' => ['weekday' => FALSE, 'day' => TRUE],
      'weekly' => ['weekday' => TRUE, 'day' => FALSE],
      'daily' => ['weekday' => FALSE, 'day' => FALSE],
    ];
    foreach ($expected as $frequency => $fields) {
      $schedule = $this->scheduleFormFor($frequency);
      foreach ($fields as $field => $offered) {
        $this->assertSame($offered, $schedule[$field]['#access'] ?? TRUE, "$frequency offers $field: " . var_export($offered, TRUE));
      }
    }
    $default = $this->scheduleFormFor(NULL);
    $this->assertFalse($default['weekday']['#access'] ?? TRUE, 'the default monthly schedule hides the weekday');
  }

  /**
   * Changing the frequency refreshes the schedule section over htmx.
   */
  public function testFrequencyChangeRefreshesTheScheduleOverHtmx(): void {
    $schedule = $this->scheduleFormFor(NULL);
    $this->assertArrayHasKey('data-trigger-schedule', $schedule['#attributes'] ?? []);
    $attributes = $schedule['frequency']['#attributes'] ?? [];
    $this->assertArrayHasKey('data-hx-post', $attributes);
    $this->assertSame('change', $attributes['data-hx-trigger'] ?? NULL);
    $this->assertSame('[data-trigger-schedule]', $attributes['data-hx-select'] ?? NULL);
    $this->assertSame('[data-trigger-schedule]', $attributes['data-hx-target'] ?? NULL);
    $this->assertStringStartsWith('outerHTML', (string) ($attributes['data-hx-swap'] ?? ''));
  }

  /**
   * Enabling without an account is refused and stores nothing enabled.
   */
  public function testEnablingWithoutAccountShowsActivationError(): void {
    $form_state = new FormState();
    $trigger = $this->submitAddForm(self::monthlyValues('_none', TRUE), $form_state);

    $this->assertNull($trigger);
    $this->assertContains('Choose a service account before enabling the trigger.', array_map('strval', $form_state->getErrors()));
  }

  /**
   * A valid monthly submission stores only the monthly configuration keys.
   */
  public function testMonthlySubmissionStoresOnlyMonthlyKeys(): void {
    $actor = $this->serviceAccount('a');
    $form_state = new FormState();
    $trigger = $this->submitAddForm(self::monthlyValues((string) $actor->id(), TRUE), $form_state);

    $this->assertSame([], array_map('strval', $form_state->getErrors()));
    $this->assertInstanceOf(BbTicketTriggerInterface::class, $trigger);
    $this->assertSame('schedule', $trigger->getType());
    $this->assertSame(
      ['frequency' => 'monthly', 'day' => '15', 'time' => '06:45', 'timezone' => 'Europe/Berlin'],
      $trigger->getTypePlugin()->getConfiguration(),
    );
    $this->assertTrue($trigger->isEnabled());
    $this->assertSame((new \DateTimeImmutable('2026-11-15T05:45:00Z'))->getTimestamp(), $trigger->getNextRun());
  }

  /**
   * Pause and resume toggle `enabled`; resuming re-runs the activation gate.
   */
  public function testToggleResumesOnlyWhatCanRun(): void {
    $actor = $this->serviceAccount('a');
    $trigger = $this->newTrigger('a', ['actor_uid' => $actor->id(), 'enabled' => TRUE]);
    $trigger->save();

    $this->assertSame([], $this->submitToggle($trigger));
    $this->assertFalse($this->reloadTrigger($trigger)->isEnabled());

    $this->serviceAccounts()->disable($actor, $this->lead('a'));
    $this->assertNotSame([], $this->submitToggle($this->reloadTrigger($trigger)));
    $this->assertFalse($this->reloadTrigger($trigger)->isEnabled());
  }

  /**
   * Submits the pause/resume form and returns its errors.
   *
   * @return array<string>
   *   The error messages.
   */
  private function submitToggle(BbTicketTriggerInterface $trigger): array {
    $this->container->get('current_user')->setAccount($this->lead('a'));
    $form_object = $this->container->get('entity_type.manager')->getFormObject('bb_ticket_trigger', 'toggle');
    $this->assertInstanceOf(TicketTriggerToggleForm::class, $form_object);
    $form_object->setEntity($trigger);
    $form_state = (new FormState())->setValue('op', 'Confirm');
    $this->container->get('form_builder')->submitForm($form_object, $form_state);
    return array_map('strval', $form_state->getErrors());
  }

  /**
   * Reloads a trigger from storage.
   */
  private function reloadTrigger(BbTicketTriggerInterface $trigger): BbTicketTriggerInterface {
    $fresh = $this->container->get('entity_type.manager')->getStorage('bb_ticket_trigger')->loadUnchanged($trigger->id());
    self::assertInstanceOf(BbTicketTriggerInterface::class, $fresh);
    return $fresh;
  }

}
