<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\Core\Render\Element;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbConductorInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Disable/Enable confirmation and the Identity card Save of a conductor.
 *
 * Opening a confirmation writes nothing; only the posted confirm button
 * writes, and only the active flag, after re-reading the conductor. The
 * Identity card Save writes only the label.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConductorActionFormTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine', 'views',
    'field', 'og', 'link', 'text', 'filter', 'file', 'image', 'bb_core', 'island',
  ];

  /**
   * The conductor under test.
   */
  private BbConductorInterface $conductor;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_workspace', 'bb_team',
      'bb_project', 'bb_machine', 'bb_ticket', 'bb_run', 'bb_conductor',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->setUpCurrentUser(['uid' => 1], ['administer bakers']);
    $this->container->get('router.builder')->rebuild();

    $etm = $this->container->get('entity_type.manager');
    $workspace = $etm->getStorage('bb_workspace')->create(['name' => 'Acme', 'slug' => 'acme']);
    $workspace->save();
    $project = $etm->getStorage('bb_project')->create(['name' => 'Platform', 'workspace_id' => $workspace->id()]);
    $project->save();
    $conductor = $etm->getStorage('bb_conductor')->create([
      'label' => 'Alpha',
      'project_id' => $project->id(),
      'status' => 'online',
      'reported_load' => 1,
    ]);
    $conductor->save();
    assert($conductor instanceof BbConductorInterface);
    $this->conductor = $conductor;
  }

  /**
   * Opening writes nothing; confirming disables, a second confirm enables.
   */
  public function testDisableThenEnableAreConfirmed(): void {
    $form = $this->container->get('entity.form_builder')->getForm($this->reload(), 'action');
    self::assertSame(['bb_confirm' => 'Disable conductor'], $this->buttonLabels($form));
    self::assertTrue($this->isActive(), 'The confirmation page writes nothing.');

    $this->confirm('1');
    self::assertFalse($this->isActive());
    self::assertSame('online', $this->reload()->getStatus(), 'Process status is untouched.');

    $form = $this->container->get('entity.form_builder')->getForm($this->reload(), 'action');
    self::assertSame(['bb_confirm' => 'Enable conductor'], $this->buttonLabels($form));
    $this->confirm('0');
    self::assertTrue($this->isActive());
  }

  /**
   * A confirm rendered from the other value, or repeated, never toggles back.
   */
  public function testStaleOrRepeatedConfirmWritesNothing(): void {
    $this->confirm('1');
    self::assertFalse($this->isActive());
    // The same Disable submitted again, from the now stale "active" page.
    $this->confirm('1');
    self::assertFalse($this->isActive());
    self::assertNotEmpty($this->container->get('messenger')->messagesByType('error'));
  }

  /**
   * A missing or forged trigger never falls back to the confirm button.
   */
  public function testMissingOrForgedTriggerWritesNothing(): void {
    $this->submit((new FormState())->setRequestMethod('POST')->setValues(['bb_from_active' => '1']));
    self::assertTrue($this->isActive());
    $this->submit((new FormState())->setRequestMethod('POST')->setValues([
      'bb_other' => 'x',
      'bb_from_active' => '1',
    ]));
    self::assertTrue($this->isActive());
    $this->confirm(NULL);
    self::assertTrue($this->isActive());
  }

  /**
   * Without update access there is no confirm button and no write.
   */
  public function testNoChangeWithoutAccess(): void {
    $this->setUpCurrentUser([], []);
    $form = $this->container->get('entity.form_builder')->getForm($this->reload(), 'action');
    self::assertSame([], $this->buttonLabels($form));
    $this->confirm('1');
    self::assertTrue($this->isActive());
  }

  /**
   * Identity Save writes only the label onto fresh data.
   */
  public function testIdentitySaveKeepsActivityAndTelemetry(): void {
    $form_object = $this->container->get('entity_type.manager')->getFormObject('bb_conductor', 'identity');
    $form = $this->container->get('entity.form_builder')->getForm($this->reload(), 'identity');
    self::assertArrayHasKey('label', $form);
    $protected_fields = [
      'states', 'active', 'status', 'owner_user_id', 'project_id',
      'machine', 'reported_load', 'conductor_id', 'last_seen',
    ];
    foreach ($protected_fields as $protected) {
      self::assertArrayNotHasKey($protected, $form, $protected . ' is not editable here.');
    }
    self::assertSame('Save', (string) $form['actions']['submit']['#value']);
    self::assertArrayNotHasKey('delete', $form['actions']);

    // A heartbeat and a deactivation land after the box was opened.
    $fresh = $this->reload();
    $fresh->set('reported_load', 3)->set('active', FALSE)->save();

    $form_object->setEntity($this->reload());
    $state = (new FormState())->setRequestMethod('POST')->setValues([
      'label' => [['value' => 'Renamed']],
      // Forged values for fields the box does not offer.
      'states' => ['coding' => 'coding'],
      'active' => ['value' => 1],
      'status' => 'online',
      'reported_load' => [['value' => 9]],
      'op' => 'Save',
    ]);
    $this->container->get('form_builder')->submitForm($form_object, $state);
    self::assertSame([], $state->getErrors());

    $saved = $this->reload();
    self::assertSame('Renamed', $saved->label());
    self::assertSame($fresh->getStates(), $saved->getStates(), 'States are read-only here.');
    self::assertSame($fresh->get('status')->value, $saved->get('status')->value);
    self::assertFalse((bool) $saved->get('active')->value, 'Save does not re-activate.');
    self::assertSame(3, (int) $saved->get('reported_load')->value, 'Save keeps the heartbeat.');
  }

  /**
   * Posts the confirm button, as rendered from the given active value.
   */
  private function confirm(?string $from): void {
    $values = ['bb_confirm' => $this->reload()->get('active')->value ? 'Disable conductor' : 'Enable conductor'];
    if ($from !== NULL) {
      $values['bb_from_active'] = $from;
    }
    $this->submit((new FormState())->setRequestMethod('POST')->setValues($values));
  }

  /**
   * Submits the action form programmatically.
   */
  private function submit(FormState $form_state): void {
    $form = $this->container->get('entity_type.manager')->getFormObject('bb_conductor', 'action');
    $form->setEntity($this->reload());
    $this->container->get('form_builder')->submitForm($form, $form_state);
  }

  /**
   * Every submit button's label in a built form, keyed by button name.
   *
   * @param array<string, mixed> $element
   *   A built form or part of one.
   *
   * @return array<string, string>
   *   Labels by name.
   */
  private function buttonLabels(array $element): array {
    $labels = [];
    if (($element['#type'] ?? '') === 'submit' && isset($element['#name'])) {
      $labels[$element['#name']] = (string) $element['#value'];
    }
    foreach (Element::children($element) as $key) {
      $labels += $this->buttonLabels($element[$key]);
    }
    return $labels;
  }

  /**
   * Whether the stored conductor is active.
   */
  private function isActive(): bool {
    return (bool) $this->reload()->get('active')->value;
  }

  /**
   * The stored conductor.
   */
  private function reload(): BbConductorInterface {
    $fresh = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->loadUnchanged($this->conductor->id());
    assert($fresh instanceof BbConductorInterface);
    return $fresh;
  }

}
