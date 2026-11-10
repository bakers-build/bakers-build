<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Hook\Attribute\Hook;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Keeps the remembered read scope current when a project is written.
 */
final class ProjectReadScopeHooks {

  public function __construct(
    #[Autowire(service: 'bb_core.workspace_read_scope')]
    private readonly BbWorkspaceReadScopeInterface $readScope,
  ) {}

  /**
   * Drops every read-scope memo once a project is written.
   *
   * A new project or a change of its teams or group changes who reaches it;
   * entity access reads the same memo, so the rest of the request must not
   * see the old set.
   */
  #[Hook('bb_project_insert')]
  #[Hook('bb_project_update')]
  public function projectWrite(): void {
    $this->readScope->reset();
  }

}
