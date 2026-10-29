<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\filter\Entity\FilterFormat;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\tool\FormattedToolResultInterface;
use Drupal\user\UserInterface;

/**
 * Runs bakers tools through the Tool plugin manager as a scoped actor.
 */
abstract class BakersToolTestBase extends KernelTestBase {

  use OgScopeFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'filter', 'bb_core', 'tool',
  ];

  /**
   * The acting account: a team member who may read and write tickets.
   */
  protected UserInterface $actor;

  /**
   * A project the actor's team works on.
   */
  protected ContentEntityInterface $project;

  /**
   * The workspace the project belongs to.
   */
  protected ContentEntityInterface $workspace;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team', 'bb_project',
      'bb_conductor', 'bb_ticket', 'bb_run', 'bb_comment', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user', 'filter']);
    $this->installOgScopeFixture();
    FilterFormat::create(['format' => 'bb_rich', 'name' => 'Rich'])->save();
    $etm = $this->container->get('entity_type.manager');
    $etm->getStorage('bb_comment_type')->create(['id' => 'bb_comment', 'label' => 'Comment'])->save();
    foreach (['type', 'recipe', 'label'] as $vid) {
      $etm->getStorage('bb_vocabulary')->create(['id' => $vid, 'label' => $vid])->save();
    }
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    // Claim uid 1 so the actor never inherits the superuser bypass.
    $etm->getStorage('user')->create(['name' => 'root', 'status' => 1])->save();
    $etm->getStorage('user_role')->create(['id' => 'skill_user', 'label' => 'Skill user'])->save();
    user_role_grant_permissions('skill_user', [
      'view bb_ticket', 'update any bb_ticket', 'view bb_comment', 'create bb_comment',
      'use text format bb_rich', 'view bb_term', 'view bb_project',
    ]);
    $this->actor = $this->account('actor', ['skill_user']);
    $workspace = $etm->getStorage('bb_workspace')->create(['name' => 'tool-workspace', 'slug' => 'tool-workspace']);
    assert($workspace instanceof ContentEntityInterface);
    $workspace->save();
    $this->workspace = $workspace;
    $group = $etm->getStorage('bb_group')->create(['name' => 'tool-group', 'workspace_id' => $workspace->id()]);
    $group->save();
    $team = $etm->getStorage('bb_team')->create(['name' => 'tool-team']);
    assert($team instanceof ContentEntityInterface);
    $team->save();
    $project = $etm->getStorage('bb_project')->create([
      'name' => 'tool-project',
      'group_id' => $group->id(),
      'teams' => [$team->id()],
    ]);
    assert($project instanceof ContentEntityInterface);
    $project->save();
    $this->project = $project;
    $this->addMembership($workspace, $this->actor, ['contributor']);
    $this->addMembership($team, $this->actor);
    $this->container->get('current_user')->setAccount($this->actor);
  }

  /**
   * Creates an active account with the given roles.
   *
   * @param string $name
   *   The account name.
   * @param array<string> $roles
   *   Role ids.
   */
  protected function account(string $name, array $roles = []): UserInterface {
    $account = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => $roles]);
    assert($account instanceof UserInterface);
    $account->save();
    return $account;
  }

  /**
   * Creates a ticket on the actor's project, or on the given one.
   *
   * @param string $identifier
   *   Identifier and title.
   * @param array<string, mixed> $values
   *   Extra field values.
   */
  protected function ticket(string $identifier, array $values = []): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create($values + [
      'identifier' => $identifier,
      'workflow' => 'bb_work',
      'title' => $identifier,
      'project_id' => $this->project->id(),
    ]);
    assert($ticket instanceof BbTicketInterface);
    $ticket->save();
    return $ticket;
  }

  /**
   * Creates a term of the given vocabulary in the project's workspace.
   */
  protected function term(string $vid, string $name): ContentEntityInterface {
    $term = $this->container->get('entity_type.manager')->getStorage('bb_term')
      ->create(['vid' => $vid, 'name' => $name, 'workspace_id' => $this->workspace->id()]);
    assert($term instanceof ContentEntityInterface);
    $term->save();
    return $term;
  }

  /**
   * The ticket as stored.
   */
  protected function reload(BbTicketInterface $ticket): BbTicketInterface {
    $stored = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->loadUnchanged($ticket->id());
    assert($stored instanceof BbTicketInterface);
    return $stored;
  }

  /**
   * Runs a tool as the current user through the runner the MCP bridge uses.
   *
   * @param string $id
   *   The tool plugin id.
   * @param array<string, mixed> $values
   *   Input values.
   */
  protected function runTool(string $id, array $values): FormattedToolResultInterface {
    return $this->container->get('tool.runner')->run($id, $values)->getFormattedResult();
  }

  /**
   * The successful result's outputs.
   *
   * @return array<string, mixed>
   *   Outputs keyed by name.
   */
  protected function outputs(FormattedToolResultInterface $result): array {
    self::assertTrue($result->isSuccess(), (string) $result->getMessage());
    return $result->getContextValues();
  }

  /**
   * Asserts a failed result whose message contains the given text.
   */
  protected function assertFailure(FormattedToolResultInterface $result, string $text): void {
    self::assertFalse($result->isSuccess());
    self::assertStringContainsString($text, (string) $result->getMessage());
  }

}
