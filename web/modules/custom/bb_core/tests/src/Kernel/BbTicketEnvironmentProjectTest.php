<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbEnvironment;
use PHPUnit\Framework\Attributes\Group;

/**
 * A ticket may only carry environments of its own project.
 *
 * Bb_environment is unique per project and carries project_id rather than a
 * workspace_id, so the rule is stated against the project the ticket already
 * points at — one hop, not the three the label rule walks.
 */
#[Group('bb_core')]
final class BbTicketEnvironmentProjectTest extends KernelTestBase {

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
    $actor = $this->createAccount('environment-actor', [
      'view bb_term', 'view bb_workspace', 'view bb_project',
      'view bb_ticket', 'view bb_run', 'view bb_comment',
      'view bb_environment',
    ]);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $actor, ['member']);
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
   * The rendered violation messages a validation run reported.
   *
   * @param \Drupal\Core\Entity\FieldableEntityInterface $entity
   *   The entity to validate.
   *
   * @return array<string>
   *   One rendered message per violation.
   */
  private function violationMessages(FieldableEntityInterface $entity): array {
    $messages = [];
    foreach ($entity->validate() as $violation) {
      $messages[] = (string) $violation->getMessage();
    }
    return $messages;
  }

  /**
   * An environment of the ticket's own project validates.
   */
  public function testOwnProjectEnvironmentIsValid(): void {
    $ticket = $this->fixture('a', 'bb_ticket');
    $ticket->set('environments', [$this->fixture('a', 'bb_environment')->id()]);

    $paths = $this->violationPaths($ticket);
    self::assertSame([], $paths, implode(' | ', $paths));
  }

  /**
   * An environment of another project is rejected, on the environments field.
   */
  public function testForeignProjectEnvironmentIsRejected(): void {
    $ticket = $this->fixture('a', 'bb_ticket');
    $ticket->set('environments', [$this->fixture('b', 'bb_environment')->id()]);

    self::assertContains('environments', $this->violationPaths($ticket));
  }

  /**
   * A foreign environment at delta 1 is caught too.
   *
   * The environments field is multi-value.
   */
  public function testForeignEnvironmentBesideAnOwnOneIsRejected(): void {
    $ticket = $this->fixture('a', 'bb_ticket');
    $ticket->set('environments', [
      $this->fixture('a', 'bb_environment')->id(),
      $this->fixture('b', 'bb_environment')->id(),
    ]);

    self::assertContains('environments', $this->violationPaths($ticket));
  }

  /**
   * The rejection names the offending environment and both projects (AC4).
   */
  public function testForeignEnvironmentMessageNamesEnvironmentAndProjects(): void {
    $ticket = $this->fixture('a', 'bb_ticket');
    $environment = $this->fixture('b', 'bb_environment');
    $ticket->set('environments', [$environment->id()]);

    $messages = implode(' | ', $this->violationMessages($ticket));
    self::assertStringContainsString((string) $environment->label(), $messages);
    self::assertStringContainsString((string) $this->fixture('b', 'bb_project')->label(), $messages);
    self::assertStringContainsString((string) $this->fixture('a', 'bb_project')->label(), $messages);
  }

  /**
   * A ticket whose project cannot be resolved abstains on environments (AC6).
   *
   * That emptiness is project_id's own business, and two messages about one
   * missing value is noise.
   */
  public function testProjectlessTicketAbstains(): void {
    $environment = BbEnvironment::create([
      'name' => 'floating',
      'project_id' => $this->fixture('b', 'bb_project')->id(),
    ]);
    $environment->save();

    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create([
        'identifier' => 'T-NOPROJECT',
        'title' => 'no project',
        'workflow' => 'bb_feature',
        'environments' => [$environment->id()],
      ]);
    self::assertInstanceOf(FieldableEntityInterface::class, $ticket);

    self::assertNotContains('environments', $this->violationPaths($ticket));
  }

}
