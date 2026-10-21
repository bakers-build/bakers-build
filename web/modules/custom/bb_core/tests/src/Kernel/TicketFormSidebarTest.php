<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the bb_ticket form sidebar grouping and closed-field handling.
 *
 * The State panel groups state + workflow (under a group key that does not
 * collide with the `state` field). The closed / closed_date fields are hidden
 * until the ticket is actually closed, and the closed toggle is read-only once
 * shown, because both are derived from the → done transition.
 *
 * @see \Drupal\bb_core\Form\BbTicketForm
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketFormSidebarTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'datetime', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    // Datetime widgets (closed_date, created, changed) need the html_date /
    // html_time date-format entities.
    $this->installConfig(['system']);
    foreach ([
      'user', 'og_membership',
      'bb_group',
      'bb_project',
      'bb_conductor',
      'bb_ticket',
      'bb_comment',
      'bb_run',
      'bb_term',
      // BB-420 Task 34: the default form display renders every
      // display-configurable field with no explicit widget of its own, and
      // `team` is one now — its `options_select` widget queries `bb_team`
      // through the default selection handler the moment the sidebar form
      // is built, table or not.
      'bb_team',
    ] as $type) {
      $this->installEntitySchema($type);
    }
  }

  /**
   * Builds the default form for a ticket.
   *
   * @return array<string, mixed>
   *   The built form render array.
   */
  private function buildForm(bool $closed): array {
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create(['title' => 'T', 'identifier' => 'T-1']);
    assert($ticket instanceof BbTicketInterface);
    if ($closed) {
      $ticket->markClosed(1_700_000_000);
    }
    return $this->container->get('entity.form_builder')->getForm($ticket, 'default');
  }

  /**
   * State + workflow live in the lifecycle group, keeping the state intact.
   */
  public function testStateGroup(): void {
    $form = $this->buildForm(FALSE);
    $this->assertArrayHasKey('lifecycle', $form, 'The State (lifecycle) group container exists.');
    $this->assertArrayHasKey('state', $form, 'The state field element is not clobbered by the group key.');
    $this->assertSame('lifecycle', $form['state']['#group']);
    $this->assertSame('lifecycle', $form['workflow']['#group']);
  }

  /**
   * On an open ticket the closed fields are hidden.
   */
  public function testClosedFieldsHiddenWhenOpen(): void {
    $form = $this->buildForm(FALSE);
    $this->assertFalse($form['closed']['#access']);
    $this->assertFalse($form['closed_date']['#access']);
  }

  /**
   * Reviewers join the People group after assignee when the widget is present.
   */
  public function testReviewersJoinThePeopleGroup(): void {
    $form = $this->buildForm(FALSE);
    $this->assertArrayHasKey('reviewers', $form);
    $this->assertSame('people', $form['reviewers']['#group']);
    $this->assertSame('people', $form['assignee_user_id']['#group']);
  }

  /**
   * On a closed ticket the closed toggle is shown but disabled.
   */
  public function testClosedToggleDisabledWhenClosed(): void {
    $form = $this->buildForm(TRUE);
    $this->assertNotFalse($form['closed']['#access'] ?? TRUE, 'closed is not hidden on a closed ticket.');
    $this->assertTrue($form['closed']['#disabled']);
    $this->assertNotFalse($form['closed_date']['#access'] ?? TRUE, 'closed_date is visible on a closed ticket.');
    $this->assertTrue($form['closed_date']['#disabled'], 'closed_date is read-only on a closed ticket.');
  }

}
