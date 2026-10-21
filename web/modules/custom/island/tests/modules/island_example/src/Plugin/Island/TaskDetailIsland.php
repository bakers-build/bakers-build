<?php

declare(strict_types=1);

namespace Drupal\island_example\Plugin\Island;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Access\CsrfTokenGenerator;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\Render\RendererInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;
use Drupal\island\IslandPluginManagerInterface;
use Drupal\island\IslandResponse;
use Drupal\island_example\TaskStore;
use Psr\Log\LoggerInterface;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Task detail demo island with a reset action returning HX-Location.
 */
#[Island(
  id: 'task_detail',
  label: new TranslatableMarkup('Task detail'),
  type: 'view',
)]
final class TaskDetailIsland extends IslandPluginBase {

  /**
   * Constructs the island plugin.
   *
   * The Drupal plugin dependency-injection idiom: three plugin arguments
   * plus the services the island helpers need. IslandPluginBase carries the
   * same suppression for the same reason.
   *
   * @SuppressWarnings("PHPMD.ExcessiveParameterList")
   */
  public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    EntityTypeManagerInterface $entityTypeManager,
    RendererInterface $renderer,
    FormBuilderInterface $formBuilder,
    IslandPluginManagerInterface $islandManager,
    LoggerInterface $logger,
    CsrfTokenGenerator $csrfToken,
    RequestStack $requestStack,
    protected TaskStore $taskStore,
  ) {
    parent::__construct($configuration, $plugin_id, $plugin_definition, $entityTypeManager, $renderer, $formBuilder, $islandManager, $logger, $csrfToken, $requestStack);
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    return new static(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('entity_type.manager'),
      $container->get('renderer'),
      $container->get('form_builder'),
      $container->get('plugin.manager.island'),
      $container->get('logger.factory')->get('island'),
      $container->get('csrf_token'),
      $container->get('request_stack'),
      $container->get('island_example.task_store'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    $reset = $this->action('reset', [], 'Reset tasks');
    $reset['#attributes']['data-testid'] = 'reset-tasks';
    return [
      '#cache' => ['max-age' => 0],
      'title' => ['#markup' => ($data['task']['title'] ?? '') . ' '],
      'reset' => $reset,
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function accessAction(string $action, array $parameters, AccountInterface $account): AccessResultInterface {
    return $action === 'reset'
      ? AccessResult::allowed()
      : AccessResult::forbidden('Unknown island action.');
  }

  /**
   * {@inheritdoc}
   */
  public function applyAction(string $action, array $parameters): IslandResponse {
    if ($action !== 'reset') {
      return parent::applyAction($action, $parameters);
    }
    $this->taskStore->reset();
    return IslandResponse::make()
      ->location(Url::fromRoute('island_example.tasks'));
  }

}
