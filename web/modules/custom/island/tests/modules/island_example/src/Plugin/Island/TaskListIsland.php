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
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;
use Drupal\island\IslandPluginManagerInterface;
use Drupal\island\IslandResponse;
use Drupal\island_example\Form\TaskAddForm;
use Drupal\island_example\TaskStore;
use Psr\Log\LoggerInterface;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Task list demo island: rows, open links, delete actions, add form.
 */
#[Island(
  id: 'task_list',
  label: new TranslatableMarkup('Task list'),
  type: 'view',
)]
final class TaskListIsland extends IslandPluginBase {

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
    $build = ['#cache' => ['max-age' => 0]] + $this->paging();
    foreach (($data['tasks'] ?? []) as $task) {
      $open = $this->linkToRoute('island_example.task', ['task_id' => $task['id']], 'Open', '#island-tasks-content');
      $open['#attributes']['data-testid'] = 'open-task';
      $delete = $this->action('delete', ['task' => $task['id']], 'Delete', TRUE);
      $delete['#attributes']['data-testid'] = 'delete-task';
      $build['task_' . $task['id']] = [
        '#type' => 'container',
        '#attributes' => ['data-task-id' => $task['id']],
        'title' => ['#markup' => $task['title'] . ' '],
        'open' => $open,
        'delete' => $delete,
      ];
    }
    $build['add_form'] = $this->getForm(TaskAddForm::class);
    return $build;
  }

  /**
   * The demo's SAME-ROUTE navigation: a page marker and a link that moves it.
   *
   * An island-authored link to the route the user is already on, carrying
   * `?page=2`, beside a marker rendering the current value. It is the demo's
   * only link that passes url options through linkToRoute(), and the marker is
   * what makes the swap observable: the list is not actually paginated, so the
   * query changes the address and the marker and nothing else.
   *
   * @return array
   *   Render array children.
   */
  private function paging(): array {
    $page = (string) ($this->requestStack->getCurrentRequest()?->query->get('page') ?? '1');
    // linkToRoute(), not linkToPage(): `#island-tasks-content` is rendered by
    // TasksController and therefore appears in the response fragment, so it is
    // selected out of the fragment and replaced whole (spec D3).
    $page_link = $this->linkToRoute(
      'island_example.tasks',
      [],
      'Page 2',
      '#island-tasks-content',
      TRUE,
      ['query' => ['page' => '2']],
    );
    // Assigned rather than merged with `+`: the builder writes its own
    // `#attributes`, and `+` on the left-hand side would drop them.
    $page_link['#attributes']['data-testid'] = 'page-2';
    return [
      'page_marker' => [
        '#type' => 'html_tag',
        '#tag' => 'span',
        '#attributes' => ['data-testid' => 'task-list-page'],
        '#value' => $page,
      ],
      'page_link' => $page_link,
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function accessAction(string $action, array $parameters, AccountInterface $account): AccessResultInterface {
    return $action === 'delete' && isset($parameters['task'])
      ? AccessResult::allowed()
      : AccessResult::forbidden('Unknown island action.');
  }

  /**
   * {@inheritdoc}
   */
  public function applyAction(string $action, array $parameters): IslandResponse {
    if ($action !== 'delete') {
      return parent::applyAction($action, $parameters);
    }
    $this->taskStore->delete((int) $parameters['task']);
    return IslandResponse::make()
      ->rebuildSelf()
      ->dispatch('tasks.changed', ['count' => $this->taskStore->count()]);
  }

}
