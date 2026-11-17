<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Entity\ContentEntityInterface;

/**
 * Personas and readbacks shared by the environment tool tests.
 *
 * Users of this trait also use ForeignWorkspaceTrait for entity().
 */
trait EnvironmentToolTrait {

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_environment');
  }

  /**
   * Acts as a new lead of the project's workspace.
   *
   * A new account, because permissions are memoised per account once read.
   */
  private function actAsLead(string $name = 'lead'): void {
    $lead = $this->account($name, ['skill_user']);
    $this->addMembership($this->workspace, $lead, ['lead']);
    $this->container->get('current_user')->setAccount($lead);
  }

  /**
   * Acts as a guest of the project's workspace, seated on its team.
   */
  private function actAsGuest(): void {
    $guest = $this->account('guest', ['skill_user']);
    $this->addMembership($this->workspace, $guest, ['guest']);
    $this->addMembership($this->project->get('teams')->entity, $guest);
    $this->container->get('current_user')->setAccount($guest);
  }

  /**
   * Acts as the lead of another workspace.
   */
  private function actAsForeignLead(): void {
    $lead = $this->account('foreign-lead', ['skill_user']);
    $foreign = $this->entity('bb_workspace', ['name' => 'foreign', 'slug' => 'foreign', 'owner_user_id' => $lead->id()]);
    $this->addMembership($foreign, $lead, ['lead']);
    $this->container->get('current_user')->setAccount($lead);
  }

  /**
   * Creates an environment on the actor's project, or on the given one.
   */
  private function environment(string $name, string $branch, ?int $project_id = NULL): ContentEntityInterface {
    return $this->entity('bb_environment', [
      'name' => $name,
      'branch' => $branch,
      'base_url' => "https://$name.example.test",
      'project_id' => $project_id ?? $this->project->id(),
    ]);
  }

  /**
   * The project's environments as bakers_project_read lists them to a lead.
   *
   * @return array<array<string, mixed>>
   *   Name, branch and base URL per environment.
   */
  private function readEnvironments(): array {
    $current = $this->container->get('current_user')->getAccount();
    $this->actAsLead($this->randomMachineName());
    $read = $this->outputs($this->runTool('bakers_project_read', ['project' => 'TOOLPROJEC']));
    $this->container->get('current_user')->setAccount($current);
    return $read['environments'];
  }

  /**
   * The environment as stored.
   */
  private function reloadEnvironment(int|string $id): ContentEntityInterface {
    $stored = $this->container->get('entity_type.manager')->getStorage('bb_environment')->loadUnchanged($id);
    self::assertInstanceOf(ContentEntityInterface::class, $stored);
    return $stored;
  }

  /**
   * The number of stored environments.
   */
  private function environmentCount(): int {
    return (int) $this->container->get('entity_type.manager')->getStorage('bb_environment')
      ->getQuery()->accessCheck(FALSE)->count()->execute();
  }

}
