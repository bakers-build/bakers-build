<?php

declare(strict_types=1);

namespace Drupal\bb_core;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Generates one restricted view permission per configured figure.
 */
final class FigurePermissions implements ContainerInjectionInterface {

  use StringTranslationTrait;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('entity_type.manager'));
  }

  /**
   * Builds dynamic permissions for configured figures.
   *
   * @return array<string, array<string, mixed>>
   *   The permissions keyed by permission name.
   */
  public function permissions(): array {
    $permissions = [];
    foreach ($this->entityTypeManager->getStorage('bb_figure')->loadMultiple() as $figure) {
      assert($figure instanceof BbFigureInterface);
      $permissions['view bakers figure ' . $figure->id()] = [
        'title' => $this->t('View the %label figure', ['%label' => $figure->label()]),
        'description' => $this->t('Read this server-composed statistics figure in an applicable context.'),
        'restrict access' => TRUE,
        'dependencies' => ['config' => [$figure->getConfigDependencyName()]],
      ];
    }
    return $permissions;
  }

}
