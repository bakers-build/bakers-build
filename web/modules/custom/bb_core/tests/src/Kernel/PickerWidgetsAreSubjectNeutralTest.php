<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\Entity\EntityFormDisplay;
use Drupal\Core\Entity\Display\EntityFormDisplayInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Plugin\Field\FieldWidget\PickerWidgetInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * AC7: a second surface is a second form display, not a second copy of code.
 */
#[Group('bb_core')]
final class PickerWidgetsAreSubjectNeutralTest extends KernelTestBase {

  use UserCreationTrait;

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
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project',
      'bb_conductor', 'bb_ticket', 'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'filter', 'bb_core']);
    $account = $this->createUser(['administer bakers'], 'surface-reuse');
    self::assertInstanceOf(UserInterface::class, $account);
    $this->setCurrentUser($account);
  }

  /**
   * The two widgets render a subject they were never written for.
   *
   * One display, two fields, two regions — and every string on the resulting
   * surface comes from the display's own settings, which is the whole claim:
   * nothing in either plugin names an entity type, a field or a label.
   */
  public function testSecondFormDisplayGetsTheSameSurfaceForFree(): void {
    $display = $this->conductorDisplay();
    $conductor = $this->conductor();

    $lead = $display->getRenderer('status');
    $pill = $display->getRenderer('project_id');
    self::assertInstanceOf(PickerWidgetInterface::class, $lead);
    self::assertInstanceOf(PickerWidgetInterface::class, $pill);

    // The region each field renders in is the widget's own answer, read off
    // the display — no form class decided either of these two.
    self::assertSame(PickerWidgetInterface::REGION_LEAD, $lead->pickerRegion());
    self::assertSame(PickerWidgetInterface::REGION_PILLS, $pill->pickerRegion());

    // ASSERTED ON WHAT THE WIDGET RENDERS, not on a props array it hands
    // something else: since BB-420 Task 20 a picker widget renders itself,
    // so the two components below are the whole of a field's appearance and
    // there is no composed surface anywhere to read.
    $leadElement = $lead->pickerElement($conductor->get('status'));
    self::assertSame('bb_theme:property_pill', $leadElement['#component']);
    $leadProps = $leadElement['#props'];
    self::assertSame('status', $leadProps['name']);
    self::assertSame('Status', $leadProps['label']);
    self::assertTrue($leadProps['prominent'], 'The lead asks for grammar 3a\'s weight itself.');
    self::assertFalse($leadProps['selected_chips'] ?? FALSE, 'Subject-neutral pickers keep the chip-less default.');
    self::assertNotSame([], $leadProps['options'], 'The list field offers its own allowed values.');

    $pillElement = $pill->pickerElement($conductor->get('project_id'));
    self::assertSame('bb_theme:property_pill', $pillElement['#component']);
    $pillProps = $pillElement['#props'];
    self::assertSame('project_id', $pillProps['name']);
    self::assertSame('Project', $pillProps['label']);
    self::assertFalse($pillProps['prominent'], 'A peer is not the lead.');
    self::assertTrue($pillProps['clearable']);
    self::assertSame('No project', $pillProps['clear_label']);
    self::assertFalse($pillProps['selected_chips'] ?? FALSE);
  }

  /**
   * A picker survives the form cache, which serializes it with its form.
   *
   * The widget is its own `#pre_render` callback, so a cached form — after a
   * file field's Remove, for instance — carries it. Its services must come
   * back with it, or rendering the rebuilt form fails.
   */
  public function testPickerRendersAfterSerialization(): void {
    // The form cache's own round trip, on an object this test built.
    // phpcs:ignore DrupalPractice.FunctionCalls.InsecureUnserialize.InsecureUnserialize
    $pill = unserialize(serialize($this->conductorDisplay()->getRenderer('project_id')));
    self::assertInstanceOf(PickerWidgetInterface::class, $pill);
    $element = $pill->pickerElement($this->conductor()->get('project_id'));
    self::assertSame('bb_theme:property_pill', $element['#component']);
  }

  /**
   * A field naming no side effect asks for no note; one naming it gets one.
   *
   * The `conductor_id` note of the create dialog is not special-cased
   * anywhere: it is three widget settings, so any field of any surface can
   * have one and a field without them has none.
   */
  public function testNoteIsPlainWidgetConfiguration(): void {
    $display = $this->conductorDisplay();
    $conductor = $this->conductor();

    $pill = $display->getRenderer('project_id');
    self::assertInstanceOf(PickerWidgetInterface::class, $pill);

    $note = $pill->pickerNote($conductor->get('project_id'));
    self::assertSame('bb_theme:note', $note['#component'] ?? NULL);
    self::assertSame('Note', $note['#props']['lead'] ?? NULL);
    self::assertSame(
      'project_id',
      $note['#attributes']['data-option-picker-note'] ?? NULL,
      'The note names the field whose picker reveals it.',
    );
    self::assertArrayHasKey(
      'hidden',
      $note['#attributes'],
      'A note for a field holding nothing opens hidden.',
    );
  }

  /**
   * The note listens for the pick rather than being written into.
   *
   * The picker announces a pick on the window and the note updates itself, so
   * the note carries its own scope, a listener filtered to its own field name,
   * and a binding for the `hidden` attribute the server rendered. Without the
   * name filter every note on the surface would answer every field's pick.
   */
  public function testNoteUpdatesItselfFromThePickEvent(): void {
    $display = $this->conductorDisplay();
    $conductor = $this->conductor();

    $pill = $display->getRenderer('project_id');
    self::assertInstanceOf(PickerWidgetInterface::class, $pill);
    $note = $pill->pickerNote($conductor->get('project_id'));

    self::assertArrayHasKey('x-data', $note['#attributes']);
    self::assertArrayHasKey('@bakers-picker-picked.window', $note['#attributes']);
    self::assertStringContainsString(
      '"project_id"',
      $note['#attributes']['@bakers-picker-picked.window'],
      'The listener answers only its own field.',
    );
    self::assertSame('!set', $note['#attributes'][':hidden'] ?? NULL);

    $value = $note['#slots']['body'][1] ?? [];
    self::assertSame(
      'value',
      $value['#attributes']['x-text'] ?? NULL,
      'The value span renders from the scope rather than being assigned to.',
    );
  }

  /**
   * An unsaved conductor, the subject neither widget was written for.
   */
  private function conductor(): ContentEntityInterface {
    $conductor = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')
      ->create(['label' => 'A conductor label']);
    self::assertInstanceOf(ContentEntityInterface::class, $conductor);
    return $conductor;
  }

  /**
   * A second surface, on a subject neither widget was written for.
   *
   * NO `label` COMPONENT (BB-420 Task 29): the deleted `bb_surface_line`
   * used to sit here, on the same plain `string` field type as the create
   * dialog's own `title` — precisely the reuse this suite existed to prove.
   * A core widget needs no such proof.
   */
  private function conductorDisplay(): EntityFormDisplayInterface {
    $display = EntityFormDisplay::create([
      'targetEntityType' => 'bb_conductor',
      'bundle' => 'bb_conductor',
      'mode' => 'reuse_probe',
      'status' => TRUE,
    ]);
    $display->setComponent('status', [
      'type' => 'bb_picker',
      'weight' => 1,
      'settings' => ['picker_region' => 'lead', 'label' => 'Status', 'icon' => 'board'],
    ]);
    $display->setComponent('project_id', [
      'type' => 'bb_picker',
      'weight' => 2,
      'settings' => [
        'picker_region' => 'pills',
        'label' => 'Project',
        'icon' => 'dashboard',
        'clear_label' => 'No project',
        'note_lead' => 'Note',
        'note_prefix' => 'This conductor works on ',
        'note_suffix' => ' only.',
      ],
    ]);
    return $display;
  }

}
