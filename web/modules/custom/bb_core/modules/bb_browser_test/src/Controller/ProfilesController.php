<?php

declare(strict_types=1);

namespace Drupal\bb_browser_test\Controller;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\island\Entity\IslandProfile;
use Drupal\island\IslandProfileRenderer;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Renders the same persisted profile twice through the public renderer.
 */
final class ProfilesController implements ContainerInjectionInterface {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly IslandProfileRenderer $renderer,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('entity_type.manager'), $container->get('island.profile_renderer'));
  }

  /**
   * Builds both instances without bespoke wrappers or response handling.
   *
   * @return array<string, mixed>
   *   The fixture page.
   */
  public function page(string $profile_id = 'browser_test'): array {
    $profile = $this->entityTypeManager->getStorage('island_profile')->load($profile_id);
    if (!$profile instanceof IslandProfile) {
      throw new \LogicException('Apply the bb_e2e recipe before opening the browser fixture.');
    }
    $build = ['#cache' => ['max-age' => 0]];
    foreach (['first', 'second'] as $instance_id) {
      $build[$instance_id] = [
        '#type' => 'container',
        '#attributes' => ['data-profile-instance' => $instance_id],
        'profile' => $this->renderer->render($profile, $instance_id),
      ];
    }
    return $build;
  }

  /**
   * Supplies ordinary controller content to the real page-profile variant.
   *
   * @return array<string, mixed>
   *   The page body; profile selection and wrapping belong to Island.
   */
  public function menuPage(string $page): array {
    return [
      '#type' => 'container',
      '#attributes' => ['data-menu-page' => $page],
      'content' => ['#plain_text' => 'Controller result: ' . $page],
    ];
  }

}
