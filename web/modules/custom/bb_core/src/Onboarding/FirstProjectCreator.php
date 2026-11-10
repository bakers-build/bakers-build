<?php

declare(strict_types=1);

namespace Drupal\bb_core\Onboarding;

use Drupal\Core\Database\Connection;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Workspace\WorkspaceProvisioner;
use Drupal\user\UserInterface;

/**
 * Creates the onboarding wizard's first group and project, or nothing.
 *
 * Both are saved in one explicit transaction: a group without its project is
 * a half-finished onboarding the customer would have to clean up.
 */
final class FirstProjectCreator {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly Connection $database,
    private readonly WorkspaceProvisioner $provisioner,
  ) {}

  /**
   * Creates a group and a project on the owner's teams of the workspace.
   *
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace both are created in.
   * @param \Drupal\user\UserInterface $owner
   *   The account creating them; the project belongs to its teams there.
   * @param string $projectName
   *   The project name; its key is derived.
   * @param string $repositoryUrl
   *   The clone URL.
   * @param string $groupName
   *   The name of the new group that owns the project.
   *
   * @return \Drupal\bb_core\Entity\BbProjectInterface
   *   The saved project.
   *
   * @throws \InvalidArgumentException
   *   When the owner may not create projects, is on no team of the workspace
   *   or an entity is invalid;
   *   nothing is saved then.
   */
  public function create(BbWorkspaceInterface $workspace, UserInterface $owner, string $projectName, string $repositoryUrl, string $groupName): BbProjectInterface {
    if (!$this->entityTypeManager->getAccessControlHandler('bb_project')->createAccess('bb_project', $owner)) {
      throw new \InvalidArgumentException('You may not create projects.');
    }
    $teamIds = $this->teamIds($workspace, $owner);
    if ($teamIds === []) {
      throw new \InvalidArgumentException('You are on no team of this workspace.');
    }
    $transaction = $this->database->startTransaction();
    try {
      $group = $this->entityTypeManager->getStorage('bb_group')->create([
        'name' => $groupName,
        'workspace_id' => $workspace->id(),
      ]);
      if (!$group instanceof ContentEntityInterface) {
        throw new \LogicException('bb_group storage returned an unexpected entity type.');
      }
      $this->assertValid($group);
      $group->save();

      $project = $this->entityTypeManager->getStorage('bb_project')->create([
        'name' => $projectName,
        'group_id' => $group->id(),
        'teams' => $teamIds,
        'repository' => ['url' => $repositoryUrl],
      ]);
      if (!$project instanceof BbProjectInterface) {
        throw new \LogicException('bb_project storage returned an unexpected entity type.');
      }
      $project->get('key')->applyDefaultValue();
      $this->assertValid($project);
      $project->save();
      return $project;
    }
    catch (\Throwable $error) {
      $transaction->rollBack();
      throw $error;
    }
  }

  /**
   * The ids of the workspace's teams the owner belongs to.
   *
   * @return array<int|string>
   *   Team ids.
   */
  public function teamIds(BbWorkspaceInterface $workspace, UserInterface $owner): array {
    $teams = $this->entityTypeManager->getStorage('bb_team')
      ->loadByProperties(['workspace_id' => $workspace->id()]);
    $ids = [];
    foreach ($teams as $team) {
      if ($this->provisioner->isMember($owner, $team)) {
        $ids[] = $team->id();
      }
    }
    return $ids;
  }

  /**
   * Throws the entity's violations as one message.
   */
  private function assertValid(ContentEntityInterface $entity): void {
    $violations = $entity->validate();
    if ($violations->count() === 0) {
      return;
    }
    $messages = [];
    foreach ($violations as $violation) {
      $messages[] = (string) $violation->getMessage();
    }
    throw new \InvalidArgumentException(implode(' ', $messages));
  }

}
