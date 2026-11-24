<?php

declare(strict_types=1);

namespace Drupal\bb_core;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Generates the two label permissions per protected label namespace.
 */
final class ProtectedLabelPermissions implements ContainerInjectionInterface {

  use StringTranslationTrait;

  public function __construct(
    private readonly ConfigFactoryInterface $configFactory,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('config.factory'));
  }

  /**
   * The permission adding any label of the namespace to any ticket.
   */
  public static function any(string $namespace): string {
    return "set any $namespace label on bb_ticket";
  }

  /**
   * The permission adding the namespace's labels with an own conductor.
   */
  public static function own(string $namespace): string {
    return "set $namespace label on bb_ticket with own conductor";
  }

  /**
   * Builds the permissions of every configured namespace.
   *
   * @return array<string, array<string, mixed>>
   *   The permissions keyed by permission name.
   */
  public function permissions(): array {
    $permissions = [];
    foreach ($this->configFactory->get('bb_core.settings')->get('protected_label_namespaces') ?? [] as $namespace) {
      $permissions[self::any($namespace)] = [
        'title' => $this->t('Set any %namespace label on tickets', ['%namespace' => $namespace]),
        'description' => $this->t('Add %namespace: labels to every ticket and ticket template of the workspace.', ['%namespace' => $namespace]),
        'restrict access' => TRUE,
      ];
      $permissions[self::own($namespace)] = [
        'title' => $this->t('Set %namespace labels on tickets with own conductor', ['%namespace' => $namespace]),
        'description' => $this->t('Add %namespace: labels to tickets and ticket templates assigned to a conductor the account owns. "Own" means the account owns the assigned conductor, not the ticket.', ['%namespace' => $namespace]),
        'restrict access' => TRUE,
      ];
    }
    return $permissions;
  }

}
