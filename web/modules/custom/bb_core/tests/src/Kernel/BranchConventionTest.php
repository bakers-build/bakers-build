<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies branch_name derivation from the repo branch_convention (tokens).
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BranchConventionTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'filter', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_group', 'bb_project', 'bb_ticket'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
  }

  /**
   * Creates and saves a bb_ticket on the given project.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $project
   *   The project to attach the ticket to.
   * @param string $title
   *   The ticket title.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved ticket.
   */
  private function ticketOn(ContentEntityInterface $project, string $title = 'Sub Ticket Branch'): ContentEntityInterface {
    $t = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'workflow' => 'bb_feature',
        'state' => 'todo',
        'title' => $title,
        'project_id' => $project->id(),
      ]);
    assert($t instanceof ContentEntityInterface);
    $t->save();
    return $t;
  }

  /**
   * Creates and saves a bb_project with one repo and optional convention.
   *
   * @param string|null $convention
   *   The branch_convention template, or NULL to omit it.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved project.
   */
  private function project(?string $convention): ContentEntityInterface {
    $repo = ['url' => 'https://x', 'default_branch' => 'main'];
    if ($convention !== NULL) {
      $repo['branch_convention'] = $convention;
    }
    $p = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => 'p', 'repository' => [$repo]]);
    assert($p instanceof ContentEntityInterface);
    $p->save();
    return $p;
  }

  /**
   * A repo branch_convention template drives the frozen branch_name.
   */
  public function testConventionTemplateDrivesBranchName(): void {
    $project = $this->project('feature/[bb_ticket:identifier]-[bb_ticket:title]');
    $t = $this->ticketOn($project);
    // Identifier e.g. P-1, title slugified; whole thing git-safe lower-case.
    self::assertMatchesRegularExpression(
      '#^feature/[a-z0-9._/-]+$#',
      (string) $t->get('branch_name')->value,
    );
    self::assertStringContainsString('sub-ticket-branch', (string) $t->get('branch_name')->value);
  }

  /**
   * With no repo convention the overridable default convention applies.
   *
   * The default is a token template (feat/<id>-<title>), not a separate
   * hard-coded path — it runs through the same sanitise + 30-char cap.
   */
  public function testEmptyConventionUsesDefaultConvention(): void {
    $project = $this->project(NULL);
    $t = $this->ticketOn($project);
    $branch = (string) $t->get('branch_name')->value;
    self::assertStringStartsWith('feat/', $branch);
    // The title portion is present (capped at 30 chars, so possibly truncated).
    self::assertStringContainsString('sub-ticket', $branch);
    self::assertLessThanOrEqual(30, mb_strlen($branch));
  }

}
