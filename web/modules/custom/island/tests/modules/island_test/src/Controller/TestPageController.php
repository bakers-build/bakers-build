<?php

declare(strict_types=1);

namespace Drupal\island_test\Controller;

use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Trivial page for header assertions.
 */
final class TestPageController {

  /**
   * {@inheritdoc}
   */
  public function page(): array {
    return ['#markup' => 'ok'];
  }

  /**
   * A controller that decides the page does not exist.
   */
  public function missing(): array {
    throw new NotFoundHttpException();
  }

}
