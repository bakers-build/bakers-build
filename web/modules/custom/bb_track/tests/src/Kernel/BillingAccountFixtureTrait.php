<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\user\UserInterface;

/**
 * Gives a fixture project a resolvable project-wide billing account.
 *
 * Bypasses the configuration service's access checks directly, which
 * fixture setup need not satisfy.
 */
trait BillingAccountFixtureTrait {

  /**
   * Names the project's billing account, auto-created on project creation.
   *
   * Billing accounts can only be written through the checked configuration
   * operation, which requires project update access; fixture setup borrows
   * a throwaway administrator for the one call rather than widening any
   * fixture actor's real permissions.
   */
  protected function attachBillingAccount(BbProjectInterface $project): void {
    $current_user = $this->container->get('current_user');
    $previous = $current_user->getAccount();
    $admin = $this->createUser(['administer bakers'], 'billing-admin-' . $project->id());
    assert($admin instanceof UserInterface);
    $current_user->setAccount($admin);
    $assignments = $this->container->get('bb_track.assignments');
    $default = $assignments->defaultAccount((int) $project->id());
    $assignments->saveAccount((int) $project->id(), [
      'name' => $project->label() . ' billing',
    ], $default ? (int) $default->id() : NULL);
    $current_user->setAccount($previous);
  }

  /**
   * Archives every account of the project, so nothing resolves on it.
   */
  protected function archiveAccounts(BbProjectInterface $project): void {
    $current_user = $this->container->get('current_user');
    $previous = $current_user->getAccount();
    $admin = $this->createUser(['administer bakers'], 'billing-archiver-' . $project->id());
    assert($admin instanceof UserInterface);
    $current_user->setAccount($admin);
    $assignments = $this->container->get('bb_track.assignments');
    foreach ($assignments->activeAccounts((int) $project->id()) as $account) {
      // The default cannot be archived through the operation; a fixture
      // clears the flag together with archiving, as legacy data may.
      $account->set('is_default', FALSE)->set('active', FALSE)->save();
    }
    $current_user->setAccount($previous);
  }

}
