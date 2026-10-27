<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTerm;

/**
 * An epic is a bb_work ticket whose type term is named `epic`.
 */
trait EpicTermTrait {

  /**
   * The `epic` type term of the project's workspace, created on first use.
   */
  private function epicTerm(BbProjectInterface $project): BbTerm {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_term');
    $group = $project->get('group_id')->entity;
    self::assertInstanceOf(BbGroupInterface::class, $group);
    $values = ['vid' => 'type', 'name' => 'epic', 'workspace_id' => $group->getWorkspace()?->id()];
    $term = current($storage->loadByProperties($values)) ?: $storage->create($values);
    self::assertInstanceOf(BbTerm::class, $term);
    $term->save();
    return $term;
  }

}
