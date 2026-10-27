<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbTerm;
use PHPUnit\Framework\Attributes\Group;

/**
 * A ticket may only carry terms of its own workspace.
 *
 * The rule spans two entities and a three-hop reference walk, so it needs a
 * two-workspace world. WorkspaceReadScopeTestTrait already builds exactly that,
 * which is why this is a kernel test and not a functional one (D7).
 *
 * @see \Drupal\bb_core\Plugin\Validation\Constraint\BbTicketLabelWorkspaceConstraint
 */
#[Group('bb_core')]
final class BbTicketLabelWorkspaceTest extends KernelTestBase {

  use UserCreationTrait;
  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
    // Act as a member of side A rather than as the anonymous account. Every
    // other rule on a ticket is account-sensitive — the group scope on
    // project_id and the labels field's own ValidReference both report for a
    // non-member — so without a real actor the own-label case could never come
    // back clean and the foreign-label cases would be measuring the wrong
    // violation.
    $actor = $this->createAccount('label-actor', [
      'view bb_term', 'view bb_workspace', 'view bb_project',
      'view bb_ticket', 'view bb_run', 'view bb_comment',
    ]);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $actor, ['member']);
    // BB-462 D4/D7: project visibility now follows team membership, not
    // direct project OG membership, which no longer exists once BB-462
    // Phase 3 deregisters bb_project as an OG group.
    $this->addMembership($this->fixture('a', 'bb_team'), $actor, []);
    $this->setCurrentUser($actor);
  }

  /**
   * The property paths a validation run reported.
   *
   * @param \Drupal\Core\Entity\FieldableEntityInterface $entity
   *   The entity to validate.
   *
   * @return array<string>
   *   One path per violation.
   */
  private function violationPaths(FieldableEntityInterface $entity): array {
    $paths = [];
    foreach ($entity->validate() as $violation) {
      $paths[] = $violation->getPropertyPath();
    }
    return $paths;
  }

  /**
   * A label of the ticket's own workspace validates.
   */
  public function testOwnWorkspaceLabelIsValid(): void {
    $ticket = $this->fixture('a', 'bb_ticket');
    $ticket->set('labels', [$this->fixture('a', 'bb_term')->id()]);

    $paths = $this->violationPaths($ticket);
    self::assertSame([], $paths, implode(' | ', $paths));
  }

  /**
   * A label of another workspace is rejected, on the labels field.
   */
  public function testForeignWorkspaceLabelIsRejected(): void {
    $ticket = $this->fixture('a', 'bb_ticket');
    $ticket->set('labels', [$this->fixture('b', 'bb_term')->id()]);

    self::assertContains('labels', $this->violationPaths($ticket));
  }

  /**
   * A foreign label at delta 1 is caught too — labels is multi-value.
   *
   * A first()-only walk would wave this one through, which is why the validator
   * iterates every item.
   */
  public function testForeignLabelBesideAnOwnOneIsRejected(): void {
    $ticket = $this->fixture('a', 'bb_ticket');
    $ticket->set('labels', [
      $this->fixture('a', 'bb_term')->id(),
      $this->fixture('b', 'bb_term')->id(),
    ]);

    self::assertContains('labels', $this->violationPaths($ticket));
  }

  /**
   * A ticket whose workspace cannot be resolved abstains on labels.
   *
   * That emptiness is project_id's own business, and two messages about one
   * missing value is noise.
   */
  public function testProjectlessTicketAbstains(): void {
    $term = BbTerm::create([
      'vid' => 'label',
      'name' => 'floating',
      'workspace_id' => $this->fixture('b', 'bb_workspace')->id(),
    ]);
    $term->save();

    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create([
        'identifier' => 'T-NOPROJECT',
        'title' => 'no project',
        'workflow' => 'bb_work',
        'labels' => [$term->id()],
      ]);
    self::assertInstanceOf(FieldableEntityInterface::class, $ticket);

    self::assertNotContains('labels', $this->violationPaths($ticket));
  }

  /**
   * Type and recipe follow the same workspace rule as labels.
   */
  public function testForeignWorkspaceTypeAndRecipeAreRejected(): void {
    foreach (['ticket_type' => 'type', 'recipe' => 'recipe'] as $field => $vid) {
      $own = $this->createTerm($vid, 'a');
      $foreign = $this->createTerm($vid, 'b');
      $ticket = $this->fixture('a', 'bb_ticket');

      $ticket->set($field, $own->id());
      $paths = $this->violationPaths($ticket);
      self::assertSame([], $paths, implode(' | ', $paths));

      $ticket->set($field, $foreign->id());
      self::assertContains($field, $this->violationPaths($ticket));
      $ticket->set($field, NULL);
    }
  }

  /**
   * A second type or recipe value is rejected: both fields hold one value.
   */
  public function testSecondTypeOrRecipeValueIsRejected(): void {
    foreach (['ticket_type' => 'type', 'recipe' => 'recipe'] as $field => $vid) {
      $ticket = $this->fixture('a', 'bb_ticket');
      $ticket->set($field, [
        $this->createTerm($vid, 'a')->id(),
        $this->createTerm($vid, 'a')->id(),
      ]);
      self::assertContains($field, $this->violationPaths($ticket));
      $ticket->set($field, NULL);
    }
  }

  /**
   * Creates a term of a bundle in the workspace of a side.
   */
  private function createTerm(string $vid, string $side): BbTerm {
    $term = BbTerm::create([
      'vid' => $vid,
      'name' => $this->randomMachineName(),
      'workspace_id' => $this->fixture($side, 'bb_workspace')->id(),
    ]);
    $term->save();
    return $term;
  }

}
