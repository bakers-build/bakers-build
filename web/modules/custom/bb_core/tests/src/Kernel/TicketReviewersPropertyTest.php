<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Form\FormState;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Plugin\Field\FieldWidget\PickerWidget;
use Drupal\bb_core\Ticket\TicketInspectorRows;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * Reviewers on the Web Properties picker: chips, search, inspector order.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketReviewersPropertyTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'filter', 'datetime',
    'bb_core', 'island',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_conductor',
      'bb_ticket', 'bb_comment', 'bb_run', 'bb_term',
      'bb_team', 'bb_workspace',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'filter']);
    $this->createUser([], 'uid1-dummy');
    $this->setUpCurrentUser([], [
      'view bb_ticket', 'administer bakers', 'access user profiles',
    ]);
    $this->installPropertyDisplay();
  }

  /**
   * Reviewers sits after Assignee as a searchable chip picker.
   */
  public function testPropertyDisplayPlacesReviewersAfterAssignee(): void {
    $display = $this->container->get('entity_type.manager')
      ->getStorage('entity_form_display')
      ->load('bb_ticket.bb_ticket.property');
    self::assertNotNull($display);
    $components = $display->getComponents();
    self::assertArrayHasKey('reviewers', $components);
    self::assertSame('bb_picker', $components['reviewers']['type']);
    self::assertSame('Reviewers', $components['reviewers']['settings']['label']);
    self::assertSame('user', $components['reviewers']['settings']['icon']);
    self::assertTrue($components['reviewers']['settings']['searchable']);
    self::assertTrue($components['reviewers']['settings']['selected_chips']);
    self::assertSame('No reviewers', $components['reviewers']['settings']['clear_label']);
    self::assertSame('', $components['reviewers']['settings']['create_label']);
    self::assertGreaterThan(
      $components['assignee_user_id']['weight'],
      $components['reviewers']['weight'],
    );
  }

  /**
   * Other property pickers keep the existing chip-less presentation.
   */
  public function testOtherPropertyPickersDoNotOptIntoChips(): void {
    $display = $this->container->get('entity_type.manager')
      ->getStorage('entity_form_display')
      ->load('bb_ticket.bb_ticket.property');
    self::assertNotNull($display);
    foreach (['assignee_user_id', 'conductor_id', 'priority', 'labels'] as $field) {
      self::assertFalse(
        (bool) ($display->getComponents()[$field]['settings']['selected_chips'] ?? FALSE),
        $field . ' stays on the existing presentation.',
      );
    }
  }

  /**
   * Inspector rows place Reviewers immediately after Assignee.
   */
  public function testInspectorPlacesReviewersAfterAssignee(): void {
    $fields = array_keys(TicketInspectorRows::FIELDS);
    $assignee = array_search('assignee_user_id', $fields, TRUE);
    self::assertNotFalse($assignee);
    self::assertSame('reviewers', $fields[$assignee + 1]);
  }

  /**
   * The widget defaults selected_chips off so other fields stay unchanged.
   */
  public function testSelectedChipsDefaultsOff(): void {
    self::assertFalse(PickerWidget::defaultSettings()['selected_chips']);
  }

  /**
   * The property surface forwards identity-bearing selected chips.
   */
  public function testPropertySurfaceForwardsSelectedIdentities(): void {
    $a = $this->account('Ada Lovelace');
    $b = $this->account('Alan Turing');
    $ticket = $this->ticket([$a->id(), $b->id()]);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $form = $this->container->get('entity.form_builder')->getForm($ticket, 'property');
    $items = $form['inspector']['#slots']['content']['#props']['items'];
    $cell = NULL;
    foreach ($items as $item) {
      if (($item['cells']['label']['value'] ?? '') === 'Reviewers') {
        $cell = $item['cells']['value'];
        break;
      }
    }
    self::assertIsArray($cell);
    self::assertSame('picker', $cell['kind']);
    self::assertTrue($cell['searchable']);
    self::assertTrue($cell['selected_chips']);
    self::assertTrue($cell['multiple']);
    $selected = $cell['selected'] ?? [];
    $ids = array_column($selected, 'value');
    self::assertEqualsCanonicalizing([(string) $a->id(), (string) $b->id()], $ids);
    foreach ($selected as $row) {
      self::assertArrayHasKey('label', $row);
      self::assertNotSame('', $row['label']);
    }
  }

  /**
   * A plain ticket reader sees other people's names in the read-only rows.
   *
   * Names follow `view label`, as the ticket cell formatters do: no
   * bakers.build role holds `access user profiles`, so `view` would blank every
   * other person.
   */
  public function testReadOnlyPeopleRowsNameOtherAccountsForPlainReaders(): void {
    $assignee = $this->account('Assigned Person');
    $reviewer = $this->account('Other Reviewer');
    $creator = $this->account('Ticket Creator');
    $viewer = $this->createUser(['view bb_ticket'], 'Plain Reader');
    self::assertInstanceOf(UserInterface::class, $viewer);
    self::assertFalse($reviewer->access('view', $viewer));
    $ticket = $this->ticket([$viewer->id(), $reviewer->id()]);
    $ticket->set('assignee_user_id', $assignee->id());
    $ticket->set('owner_user_id', $creator->id());
    $ticket->save();
    $this->setCurrentUser($viewer);
    $rows = $this->container->get('bb_core.ticket_inspector_rows')->build($ticket);
    $value = static fn(string $field): string => (string) ($rows[$field]['cells']['value']['value'] ?? '');
    self::assertSame('Plain Reader, Other Reviewer', $value('reviewers'));
    self::assertSame('Assigned Person', $value('assignee_user_id'));
    self::assertSame('Ticket Creator', $value('owner_user_id'));
  }

  /**
   * Write a review lives in the sidebar Reviews block, not in Properties.
   */
  public function testPropertiesCarryNoWriteReviewEntry(): void {
    $this->container->get('theme_installer')->install(['bb_theme']);
    $me = $this->container->get('current_user');
    $form = $this->container->get('entity.form_builder')->getForm($this->ticket([$me->id()]), 'property');
    self::assertArrayNotHasKey('write_review', $form);
  }

  /**
   * Saving yourself in or out of Reviewers reloads the ticket in place.
   *
   * The Reviews block beside Properties depends on that membership, and the
   * Save swaps only the Properties form.
   */
  public function testSavingOwnReviewerChangeNavigatesToTheTicket(): void {
    $me = $this->container->get('current_user');
    $ticket = $this->ticket([]);
    self::assertNull($this->savedResponse($ticket, [$this->account('Someone Else')->id()]));
    $response = $this->savedResponse($ticket, [$me->id()]);
    self::assertNotNull($response);
    self::assertStringContainsString($ticket->toUrl()->toString(), (string) $response->headers->get('HX-Location'));
  }

  /**
   * Saves new reviewers through the property form as an htmx request.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param array<int|string> $reviewer_ids
   *   The saved reviewer ids.
   */
  private function savedResponse(BbTicketInterface $ticket, array $reviewer_ids): ?Response {
    $request = Request::create('/property', 'POST');
    $request->headers->set('HX-Request', 'true');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $opened = $storage->loadUnchanged($ticket->id());
    self::assertInstanceOf(BbTicketInterface::class, $opened);
    $form_object = $this->container->get('entity_type.manager')->getFormObject('bb_ticket', 'property');
    $edited = clone $opened;
    $edited->set('reviewers', $reviewer_ids);
    $form_object->setEntity($edited);
    $form_state = new FormState();
    $form_state->set('property_baseline', clone $opened);
    $form = [];
    $form_object->save($form, $form_state);
    $this->container->get('request_stack')->pop();
    $response = $form_state->getResponse();
    return $response instanceof Response ? $response : NULL;
  }

  /**
   * Creates a saved user account.
   */
  private function account(string $name): UserInterface {
    $account = $this->createUser(['access user profiles'], $name);
    self::assertInstanceOf(UserInterface::class, $account);
    return $account;
  }

  /**
   * Creates a ticket with the given reviewer ids.
   *
   * @param array<int|string> $reviewer_ids
   *   Reviewer user ids.
   */
  private function ticket(array $reviewer_ids): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create([
        'title' => 'reviewers-property',
        'workflow' => 'bb_work',
        'reviewers' => $reviewer_ids,
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Installs the shipped property form mode and display.
   */
  private function installPropertyDisplay(): void {
    $recipe = dirname(DRUPAL_ROOT) . '/recipes/bakers/config';
    $target = $this->container->get('config.storage');
    foreach ([
      'core.entity_form_mode.bb_ticket.property',
      'core.entity_form_display.bb_ticket.bb_ticket.property',
    ] as $name) {
      $file = $recipe . '/' . $name . '.yml';
      self::assertFileExists($file);
      $data = Yaml::decode((string) file_get_contents($file));
      $data['uuid'] = $this->container->get('uuid')->generate();
      $target->write($name, $data);
    }
  }

}
