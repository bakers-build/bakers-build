<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\BbFigureInterface;
use Drupal\bb_core\Statistics\Context\FigureRequestContextResolver;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;

/**
 * Keeps direct figure reads in parity with discovery disclosure.
 */
final class FigureAccess implements ContainerInjectionInterface {

  public function __construct(
    private readonly FigureRequestContextResolver $contextResolver,
    private readonly FigureDisclosure $disclosure,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('bb_core.figure_request_context_resolver'), $container->get('bb_core.figure_disclosure'));
  }

  /**
   * Checks access to one direct figure read.
   */
  public function access(BbFigureInterface $bb_figure, Request $request, AccountInterface $account): AccessResultInterface {
    try {
      $contexts = $this->contextResolver->fromRequest($request);
    }
    catch (\Throwable) {
      return AccessResult::forbidden('Missing or unknown statistics context.')->setCacheMaxAge(0);
    }
    return AccessResult::allowedIf($this->disclosure->mayView($account, $bb_figure, $contexts))
      ->addCacheableDependency($bb_figure)
      ->addCacheableDependency($account)
      ->addCacheContexts(['user.permissions'])
      ->addCacheTags(['og_membership_list'])
      ->setCacheMaxAge(0);
  }

}
