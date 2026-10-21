<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\bb_activity_kind_test\Hook\FailingKindHooks;
use Drupal\bb_activity\Activity\ActivityKindInterface;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Records a claim as the claim service does, and makes kinds fail on demand.
 */
trait ActivityKindTestTrait {

  /**
   * Records the claimed kind for a run, as TicketClaimService does.
   */
  protected function claimed(BbTicketInterface $ticket, BbRunInterface $run, BbConductorInterface $conductor): ?BbActivity {
    $kind = $this->container->get('plugin.manager.bb_activity_kind')->createInstance('claimed');
    assert($kind instanceof ActivityKindInterface);
    $kind->setContextValue('ticket', $ticket);
    $kind->setContextValue('run', $run);
    $kind->setContextValue('conductor', $conductor);
    return $kind->record();
  }

  /**
   * Makes the listed kinds throw inside record() from now on.
   */
  protected function failKinds(string ...$ids): void {
    $this->enableModules(['bb_activity_kind_test']);
    $this->container->get('state')->set(FailingKindHooks::STATE, $ids);
    $this->container->get('plugin.manager.bb_activity_kind')->clearCachedDefinitions();
  }

}
