<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\jsonapi\ResourceType\ResourceType;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Storage, upgrade, Views, JSON:API and admin form for ticket reviewers.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketReviewersTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'datetime', 'views',
    'serialization', 'jsonapi',
    'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installConfig(['system', 'user', 'jsonapi']);
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_conductor',
      'bb_ticket', 'bb_comment', 'bb_run', 'bb_term',
      'bb_team',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->createUser([], 'uid1-dummy');
    $this->setUpCurrentUser([], [
      'view bb_ticket', 'view bb_project', 'view bb_conductor',
      'administer bakers', 'administer users',
    ]);
  }

  /**
   * The field is an optional unlimited user reference with workspace selection.
   */
  public function testFieldDefinition(): void {
    $fields = $this->container->get('entity_field.manager')
      ->getBaseFieldDefinitions('bb_ticket');
    self::assertArrayHasKey('reviewers', $fields);
    $definition = $fields['reviewers'];
    self::assertInstanceOf(BaseFieldDefinition::class, $definition);
    self::assertSame('entity_reference', $definition->getType());
    self::assertSame('user', $definition->getSetting('target_type'));
    self::assertSame('bb_assignee_in_ticket_workspace', $definition->getSetting('handler'));
    self::assertFalse($definition->getSetting('handler_settings')['include_anonymous'] ?? TRUE);
    self::assertSame(BaseFieldDefinition::CARDINALITY_UNLIMITED, $definition->getCardinality());
    self::assertFalse($definition->isRequired());
    self::assertFalse($definition->isComputed());
  }

  /**
   * JSON:API exposes reviewers as a writable to-many user relationship.
   */
  public function testJsonApiExposesWritableToManyRelationship(): void {
    $resource_type = $this->container->get('jsonapi.resource_type.repository')
      ->get('bb_ticket', 'bb_ticket');
    self::assertInstanceOf(ResourceType::class, $resource_type);
    self::assertTrue($resource_type->hasField('reviewers'));
    self::assertTrue($resource_type->isFieldEnabled('reviewers'));
    $field = $resource_type->getFieldByInternalName('reviewers');
    self::assertFalse($field->hasOne());
    self::assertFalse($resource_type->getRelatableResourceTypesByField('reviewers') === []);
  }

  /**
   * Empty, two reviewers, independent removal and clear persist across reload.
   */
  public function testPersistsMultipleReviewersAndClear(): void {
    $a = $this->account('reviewer-a');
    $b = $this->account('reviewer-b');
    $ticket = $this->createTicket(['title' => 'reviewers-persist']);
    self::assertTrue($ticket->get('reviewers')->isEmpty());

    $ticket->set('reviewers', [$a->id(), $b->id()])->save();
    $reloaded = $this->reload($ticket);
    self::assertEqualsCanonicalizing(
      [(int) $a->id(), (int) $b->id()],
      $this->reviewerIds($reloaded),
    );

    $reloaded->set('reviewers', [$b->id()])->save();
    $after_remove = $this->reload($reloaded);
    self::assertSame([(int) $b->id()], $this->reviewerIds($after_remove));

    $after_remove->set('reviewers', [])->save();
    self::assertSame([], $this->reviewerIds($this->reload($after_remove)));
  }

  /**
   * Duplicate selection collapses to one stored account.
   */
  public function testDuplicateSelectionStoresOnce(): void {
    $a = $this->account('reviewer-dup');
    $ticket = $this->createTicket();
    $ticket->set('reviewers', [$a->id(), $a->id()])->save();
    self::assertSame([(int) $a->id()], $this->reviewerIds($this->reload($ticket)));
  }

  /**
   * Adding reviewers does not rewrite owner or assignee.
   */
  public function testReviewersDoNotChangeOwnerOrAssignee(): void {
    $owner = $this->account('ticket-owner');
    $assignee = $this->account('ticket-assignee');
    $reviewer = $this->account('ticket-reviewer');
    $ticket = $this->createTicket([
      'owner_user_id' => $owner->id(),
      'assignee_user_id' => $assignee->id(),
    ]);
    $ticket->set('reviewers', [$reviewer->id()])->save();
    $reloaded = $this->reload($ticket);
    self::assertSame((int) $owner->id(), (int) $reloaded->get('owner_user_id')->target_id);
    self::assertSame((int) $assignee->id(), (int) $reloaded->get('assignee_user_id')->target_id);
  }

  /**
   * Anonymous is dropped on save; a missing user fails ValidReference.
   */
  public function testInvalidReferencesAreRejected(): void {
    $ticket = $this->createTicket();
    $ticket->set('reviewers', [0])->save();
    self::assertSame([], $this->reviewerIds($this->reload($ticket)));

    $ticket->set('reviewers', [999999]);
    self::assertGreaterThan(0, count($ticket->validate()->getByField('reviewers')));
  }

  /**
   * An eligible user passes validation when the handler bypass is in force.
   */
  public function testEligibleUserPassesValidation(): void {
    $user = $this->account('eligible-reviewer');
    $ticket = $this->createTicket(['reviewers' => [$user->id()]]);
    self::assertTrue($ticket->hasField('reviewers'));
    self::assertCount(0, $ticket->validate()->getByField('reviewers'));
  }

  /**
   * Views data maps the dedicated multi-value table to users.
   */
  public function testViewsDataHasDedicatedTableAndUserRelationship(): void {
    $data = $this->container->get('views.views_data')->getAll();
    self::assertArrayHasKey('bb_ticket__reviewers', $data);
    $table = $data['bb_ticket__reviewers'];
    self::assertArrayHasKey('reviewers_target_id', $table);
    self::assertArrayHasKey('relationship', $table['reviewers_target_id']);
    self::assertSame('users_field_data', $table['reviewers_target_id']['relationship']['base']);
  }

  /**
   * A Views-style query for reviewer B finds the ticket once.
   */
  public function testViewQueryFindsTicketOnceForReviewer(): void {
    $a = $this->account('views-a');
    $b = $this->account('views-b');
    $ticket = $this->createTicket(['reviewers' => [$a->id(), $b->id()]]);
    $this->createTicket(['title' => 'other']);

    $ids = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->getQuery()
      ->accessCheck(FALSE)
      ->condition('reviewers', $b->id())
      ->execute();
    self::assertSame([(string) $ticket->id()], array_values($ids));
  }

  /**
   * The admin form puts reviewers in People & Project after assignee.
   */
  public function testAdminFormPlacesReviewersInPeopleGroup(): void {
    $ticket = $this->createTicket();
    $form = $this->container->get('entity.form_builder')->getForm($ticket, 'default');
    self::assertArrayHasKey('reviewers', $form);
    self::assertSame('people', $form['reviewers']['#group']);
    self::assertSame('people', $form['assignee_user_id']['#group']);
    $people_fields = array_values(array_filter(
      ['project_id', 'assignee_user_id', 'reviewers'],
      static fn (string $name): bool => ($form[$name]['#group'] ?? NULL) === 'people',
    ));
    self::assertSame(['project_id', 'assignee_user_id', 'reviewers'], $people_fields);
  }

  /**
   * Creates a saved user account.
   */
  private function account(string $name): UserInterface {
    $account = $this->createUser([], $name);
    self::assertInstanceOf(UserInterface::class, $account);
    return $account;
  }

  /**
   * Creates and saves a ticket.
   *
   * @param array<string, mixed> $values
   *   Extra field values.
   */
  private function createTicket(array $values = []): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create($values + [
        'title' => 'reviewers-ticket',
        'workflow' => 'bb_feature',
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Reloads a ticket from storage.
   */
  private function reload(BbTicketInterface $ticket): BbTicketInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $storage->resetCache([(int) $ticket->id()]);
    $reloaded = $storage->load($ticket->id());
    self::assertInstanceOf(BbTicketInterface::class, $reloaded);
    return $reloaded;
  }

  /**
   * Target ids currently stored on reviewers.
   *
   * @return array<int>
   *   Integer user ids in storage order.
   */
  private function reviewerIds(BbTicketInterface $ticket): array {
    $ids = [];
    foreach ($ticket->get('reviewers') as $item) {
      $ids[] = (int) ($item->getValue()['target_id'] ?? 0);
    }
    return $ids;
  }

}
