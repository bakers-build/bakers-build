<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Deployment\DeploymentLookup;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\bb_core\Project\AttentionItem;
use Drupal\bb_core\Project\ProjectHealth;
use Drupal\bb_core\Ticket\ProjectOverviewTickets;
use Drupal\bb_core\Time\BbDate;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\Routing\Exception\RouteNotFoundException;

/**
 * One section of the project Overview.
 *
 * Main column: metrics, Needs attention and Epics while the viewer may view a
 * ticket of the project, else the page empty state. Inspector: the About text
 * and the Properties Edit link.
 */
#[Source(
  id: 'bb_project_overview',
  label: new TranslatableMarkup('[bakers.build] Project overview'),
  description: new TranslatableMarkup('Metrics, Needs attention, epic progress, empty state, About or Edit of a project.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_project', label: new TranslatableMarkup('Project'), required: TRUE),
  ],
)]
final class ProjectOverviewSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  use PersonIdentityTrait;

  /**
   * Needs attention shows at most this many tickets.
   */
  private const ATTENTION_ROWS = 5;

  /**
   * Computes the Overview facts.
   */
  protected ProjectOverviewTickets $overview;

  /**
   * Names the tickets where a person has to act.
   */
  protected ProjectHealth $health;

  /**
   * Holds the attention set for the rest of the request.
   */
  protected RequestStack $requestStack;

  /**
   * The viewer the attention set is read for.
   */
  protected AccountInterface $currentUser;

  /**
   * Formats "Created … ago".
   */
  protected BbDate $date;

  /**
   * Reads accessible deployment rows.
   */
  protected DeploymentLookup $deploymentLookup;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->overview = $container->get(ProjectOverviewTickets::class);
    $instance->health = $container->get('bb_core.project_health');
    $instance->requestStack = $container->get('request_stack');
    $instance->currentUser = $container->get('current_user');
    $instance->date = $container->get(BbDate::class);
    $instance->deploymentLookup = $container->get('bb_core.deployment_lookup');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function defaultSettings(): array {
    return ['section' => ''] + parent::defaultSettings();
  }

  /**
   * {@inheritdoc}
   */
  public function settingsForm(array $form, FormStateInterface $form_state): array {
    $form['section'] = [
      '#type' => 'select',
      '#title' => $this->t('Section'),
      '#options' => [
        'metrics' => $this->t('Metrics'),
        'attention' => $this->t('Needs attention'),
        'epics' => $this->t('Epics'),
        'deployments' => $this->t('Deployments'),
        'empty' => $this->t('Empty state'),
        'description' => $this->t('About'),
        'edit' => $this->t('Edit link'),
      ],
      '#default_value' => $this->getSetting('section') ?? '',
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $project = $this->project();
    if ($project === NULL || $project->isNew() || !$project->access('view')) {
      return [];
    }
    $section = (string) ($this->getSetting('section') ?? '');
    // The ticket sections and the empty state exclude each other.
    if (in_array($section, ['metrics', 'attention', 'epics', 'empty'], TRUE)
      && $this->overview->hasTickets($project) === ($section === 'empty')) {
      return [];
    }
    return match ($section) {
      'metrics' => $this->metrics($project),
      'attention' => $this->attention($project),
      'epics' => $this->epics($project),
      'deployments' => $this->deployments($project),
      'empty' => $this->emptyState(),
      'description' => $this->description($project),
      'edit' => $this->editLink($project),
      default => [],
    };
  }

  /**
   * {@inheritdoc}
   */
  public function alterComponent(array $element): array {
    $element = parent::alterComponent($element);
    $metadata = CacheableMetadata::createFromRenderArray($element);
    $project = $this->project();
    if ($project !== NULL) {
      $metadata->addCacheableDependency($project);
      // Memberships decide which tickets the viewer sees, so the empty state.
      $metadata->addCacheTags(['bb_ticket_list', 'bb_environment_list', 'og_membership_list']);
    }
    $metadata->addCacheContexts(['user']);
    $metadata->applyTo($element);
    return $element;
  }

  /**
   * The About text: the description, or the faint empty mark.
   *
   * @return array<string, mixed>
   *   A `text` component.
   */
  private function description(BbProjectInterface $project): array {
    $text = trim((string) $project->get('description')->value);
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:text',
      '#props' => [
        'text' => $text === '' ? '—' : $text,
        'as' => 'p',
        'size' => 'body',
        'tone' => $text === '' ? 'faint' : 'default',
        'align' => 'start',
      ],
    ];
  }

  /**
   * The Unhealthy, Intake and In progress tiles.
   *
   * @return array<string, mixed>
   *   A three-column zone, never cached.
   */
  private function metrics(BbProjectInterface $project): array {
    $unhealthy = count($this->attentionSet($project));
    $counts = $this->health->workStateCounts($project);
    $tiles = [
      [
        'label' => (string) $this->t('Unhealthy'),
        'value' => (string) $unhealthy,
        'detail' => (string) ($unhealthy > 0 ? $this->t('need a person now') : $this->t('nothing blocks the flow')),
        'info' => (string) $this->t('Open tickets where a person has to act now.'),
        'source' => 'bb_core.project_health',
        'tone' => $unhealthy > 0 ? 'attention' : 'neutral',
        'url' => $this->boardUrl($project, ['health' => 'unhealthy']),
      ],
      [
        'label' => (string) $this->t('Intake'),
        'value' => (string) $counts['intake'],
        'detail' => (string) $this->t('conductor set, not started'),
        'info' => (string) $this->t("The Board's Intake column."),
        'source' => 'bb_ticket.work_state',
      ],
      [
        'label' => (string) $this->t('In progress'),
        'value' => (string) $counts['working'],
        'detail' => (string) $this->t('being worked on'),
        'info' => (string) $this->t("The Board's Working column."),
        'source' => 'bb_ticket.work_state',
      ],
    ];
    $content = [];
    foreach ($tiles as $props) {
      $content[] = [
        '#type' => 'component',
        '#component' => 'bb_theme:stat-tile',
        '#props' => ['size' => 'kpi'] + array_filter($props, static fn (string $value): bool => $value !== ''),
      ];
    }
    return $this->zone('', '', $content, 3) + ['#cache' => ['max-age' => 0]];
  }

  /**
   * Needs attention: the first tickets with their reason, or a calm note.
   *
   * @return array<string, mixed>
   *   A zone, never cached.
   */
  private function attention(BbProjectInterface $project): array {
    $items = $this->attentionSet($project);
    $rows = array_map($this->attentionItem(...), array_slice($items, 0, self::ATTENTION_ROWS));
    $content = $items === [] ? [
      [
        '#type' => 'component',
        '#component' => 'bb_theme:note',
        '#props' => ['tone' => 'success', 'lead' => (string) $this->t('Everything is flowing')],
        '#slots' => ['body' => ['#plain_text' => (string) $this->t('No open ticket needs a person right now.')]],
      ],
    ] : [
      $this->ticketList($rows),
      [
        '#type' => 'component',
        '#component' => 'bb_theme:text',
        '#props' => [
          'text' => (string) $this->t('Showing @shown of @total unhealthy tickets', [
            '@shown' => count($rows),
            '@total' => count($items),
          ]),
          'size' => 'meta',
          'tone' => 'light',
        ],
      ],
    ];
    $build = $this->zone((string) $this->t('Needs attention'), (string) $this->t('Open tickets where a person has to act now'), $content);
    $board = $this->boardUrl($project);
    if ($board !== '') {
      $build['#slots']['actions'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => ['label' => (string) $this->t('Open board'), 'href' => $board, 'variant' => 'ghost'],
      ];
    }
    return $build + ['#cache' => ['max-age' => 0]];
  }

  /**
   * The attention set, read once per request for metrics and Needs attention.
   *
   * @return list<\Drupal\bb_core\Project\AttentionItem>
   *   The unhealthy tickets the viewer may view.
   */
  private function attentionSet(BbProjectInterface $project): array {
    $attributes = $this->requestStack->getCurrentRequest()?->attributes;
    $key = 'bb_project_attention:' . $project->id() . ':' . $this->currentUser->id();
    if ($attributes?->has($key)) {
      return $attributes->get($key);
    }
    $items = $this->health->attention($project);
    $attributes?->set($key, $items);
    return $items;
  }

  /**
   * Epics with the progress of their direct children, or the empty copy.
   *
   * @return array<string, mixed>
   *   A zone.
   */
  private function epics(BbProjectInterface $project): array {
    $epics = $this->overview->epicTickets($project);
    $progress = $this->overview->epicProgress($epics);
    $content = [];
    foreach ($epics as $epic) {
      $counts = $progress[(int) $epic->id()];
      $content[] = [
        '#type' => 'component',
        '#component' => 'bb_theme:progress',
        '#props' => $counts + [
          'identifier' => $epic->getIdentifier(),
          'title' => (string) $epic->label(),
          'url' => $this->ticketUrl($epic),
          'percent' => $counts['total'] > 0 ? (int) round(100 * $counts['done'] / $counts['total']) : 0,
        ],
      ];
    }
    if ($content === []) {
      $content[] = [
        '#type' => 'component',
        '#component' => 'bb_theme:empty-state',
        '#props' => ['message' => (string) $this->t('No epics in this project.')],
      ];
    }
    return $this->zone((string) $this->t('Epics'), '', $content);
  }

  /**
   * Deployment history with a project-scoped ticket drill-down.
   *
   * @return array<string, mixed>
   *   A zone containing the deployment list or its empty state.
   */
  private function deployments(BbProjectInterface $project): array {
    $items = [];
    foreach ($this->deploymentLookup->projectDeployments($project) as $deployment) {
      $ticket = $deployment['ticket'];
      $row = $this->ticketItem($ticket);
      $row['cells']['environment'] = [
        'kind' => 'text',
        'value' => implode(', ', $deployment['environments']) ?: '—',
      ];
      $row['cells']['workflow'] = [
        'kind' => 'badge',
        'label' => $row['cells']['state']['label'],
        'tone' => 'neutral',
      ];
      $row['cells']['count'] = [
        'kind' => 'link',
        'value' => (string) $this->formatPlural($deployment['count'], '1 ticket', '@count tickets'),
        'url' => Url::fromUserInput($project->toUrl()->toString() . '/tickets', [
          'query' => ['deployment' => $ticket->getIdentifier(), 'closed' => 'all'],
        ])->toString(),
      ];
      $items[] = $row;
    }
    $content = $items === [] ? [
      '#type' => 'component',
      '#component' => 'bb_theme:empty-state',
      '#props' => ['message' => (string) $this->t('No deployments in this project.')],
    ] : [
      '#type' => 'component',
      '#component' => 'bb_theme:list',
      '#props' => [
        'layout' => 'lines',
        'pattern' => [
          'avatar' => ['state'],
          'headline' => ['identifier', 'title'],
          'meta' => ['workflow', 'environment', 'created'],
          'right' => ['count'],
        ],
        'items' => $items,
      ],
    ];
    return $this->zone((string) $this->t('Deployments'), '', [$content]);
  }

  /**
   * The page empty state of a project without visible tickets.
   *
   * @return array<string, mixed>
   *   An `empty-state` component.
   */
  private function emptyState(): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:empty-state',
      '#props' => [
        'title' => (string) $this->t('No tickets yet'),
        'message' => (string) $this->t('Once tickets arrive, this page shows what needs attention, how epics progress and what happened.'),
        'icon' => 'ticket',
      ],
    ];
  }

  /**
   * Edit, to the project's Settings, for `update` access only.
   *
   * @return array<string, mixed>
   *   A ghost `button` link, or nothing; either varies with the access.
   */
  private function editLink(BbProjectInterface $project): array {
    $access = $project->access('update', NULL, TRUE);
    $build = [];
    if ($access->isAllowed()) {
      $url = Url::fromRoute('bb_core.bb_project.settings', $project->toUrl()->getRouteParameters());
      $build = [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => ['label' => (string) $this->t('Edit'), 'href' => $url->toString(), 'variant' => 'ghost'],
      ];
    }
    CacheableMetadata::createFromObject($access)->applyTo($build);
    return $build;
  }

  /**
   * The project Board's address, or empty while the Board is not installed.
   *
   * @param \Drupal\bb_core\Entity\BbProjectInterface $project
   *   The project.
   * @param array<string, string> $query
   *   Query parameters.
   */
  private function boardUrl(BbProjectInterface $project, array $query = []): string {
    try {
      return Url::fromRoute('view.project_board.project_board', $project->toUrl()->getRouteParameters(), ['query' => $query])->toString();
    }
    catch (RouteNotFoundException) {
      return '';
    }
  }

  /**
   * One zone component.
   *
   * @param string $heading
   *   Zone heading.
   * @param string $description
   *   Zone description.
   * @param list<array<string, mixed>> $content
   *   Direct children of the zone.
   * @param int $columns
   *   Column count for the zone grid; 1 omits the prop.
   */
  private function zone(string $heading, string $description, array $content, int $columns = 1): array {
    $props = [
      'inset' => 'none',
      'gap' => 'sm',
    ];
    if ($description !== '') {
      $props['description'] = $description;
    }
    if ($columns > 1) {
      $props['columns'] = $columns;
    }
    $slots = [
      'content' => $content,
    ];
    if ($heading !== '') {
      $slots['heading'] = ['#plain_text' => $heading];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => $props,
      '#slots' => $slots,
    ];
  }

  /**
   * Ticket rows in the listing pattern, the reason on the meta line.
   *
   * @param list<array<string, mixed>> $items
   *   The `list` items.
   *
   * @return array<string, mixed>
   *   A `list` component.
   */
  private function ticketList(array $items): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:list',
      '#props' => [
        'layout' => 'lines',
        'pattern' => [
          'avatar' => ['state'],
          'headline' => ['title', 'priority'],
          'meta' => ['identifier', 'created', 'workflow', 'reason'],
          'right' => ['assignee'],
          'captions' => [
            'created' => (string) $this->t('Created'),
          ],
        ],
        'items' => $items,
      ],
    ];
  }

  /**
   * One Needs attention row: ticket, state, reason and severity rail.
   *
   * @return array<string, mixed>
   *   A `list` item.
   */
  private function attentionItem(AttentionItem $item): array {
    $tone = $item->severity === 'red' ? 'critical' : 'attention';
    $row = $this->ticketItem($item->ticket);
    $row['accent'] = $tone;
    $row['cells']['workflow'] = [
      'kind' => 'badge',
      'label' => $row['cells']['state']['label'],
      'tone' => 'neutral',
      'dot' => TRUE,
    ];
    $row['cells']['reason'] = [
      'kind' => 'badge',
      'label' => $item->reason,
      'tone' => $tone,
      'dot' => TRUE,
    ];
    return $row;
  }

  /**
   * One ticket row in the ticket listing pattern.
   *
   * @return array<string, mixed>
   *   A `list` item.
   */
  private function ticketItem(BbTicketInterface $ticket): array {
    $state = (string) ($ticket->get('state')->value ?? '');
    $state_item = $ticket->get('state')->first();
    $state_label = $state_item instanceof StateItemInterface
      ? (string) ($state_item->getLabel() ?? $state_item->getId())
      : $state;
    $priority = $ticket->getPriority();
    $working = $this->isRunning($ticket);
    $url = $this->ticketUrl($ticket);
    $cells = [
      'state' => $this->stateCell($ticket, $state_label),
      'title' => $this->titleCell($ticket, $url),
      'identifier' => $this->identifierCell($ticket, $url),
      'created' => $this->created($ticket),
      'assignee' => $this->assigneeCell($ticket),
    ];
    if ($priority !== NULL) {
      $cells['priority'] = [
        'kind' => 'badge',
        'label' => 'P' . $priority,
        'tone' => $priority === 1 ? 'critical' : 'neutral',
      ];
    }
    return [
      'url' => $url,
      'accent' => $working ? 'running' : 'idle',
      'cells' => $cells,
    ];
  }

  /**
   * Headline title as a route link, so the whole patterned row is clickable.
   *
   * Same affordance as the tickets View (`link_to_entity` on title): list.twig
   * only forwards a row click when the headline cell is a `link`.
   *
   * @return array<string, mixed>
   *   A `link` cell.
   */
  private function titleCell(BbTicketInterface $ticket, string $url): array {
    return [
      'kind' => 'link',
      'value' => (string) $ticket->label(),
      'url' => $url,
    ];
  }

  /**
   * Identifier as the tickets View's identifier cell: a monospaced route link.
   *
   * @return array<string, mixed>
   *   A `link` cell.
   */
  private function identifierCell(BbTicketInterface $ticket, string $url): array {
    return [
      'kind' => 'link',
      'value' => $ticket->getIdentifier(),
      'url' => $url,
      'mono' => TRUE,
    ];
  }

  /**
   * Status glyph named by the workflow label.
   *
   * @return array<string, mixed>
   *   A `status` cell.
   */
  private function stateCell(BbTicketInterface $ticket, string $label): array {
    return [
      'kind' => 'status',
      'label' => $label,
      'working' => $this->isRunning($ticket),
    ];
  }

  /**
   * TRUE when the ticket's stored state is the running phase.
   */
  private function isRunning(BbTicketInterface $ticket): bool {
    $workflow = (string) ($ticket->get('workflow')->value ?? '');
    $state = (string) ($ticket->get('state')->value ?? '');
    if (TypeWorkflows::stateMetadata($workflow, $state) === []) {
      return FALSE;
    }
    return TypeWorkflows::phase($workflow, $state) === 'running';
  }

  /**
   * The `time` cell for the Created caption, or none without a stamp.
   *
   * @return array<string, string>
   *   The cell, or an empty array the list skips.
   */
  private function created(BbTicketInterface $ticket): array {
    $timestamp = (int) $ticket->getCreatedTime();
    return $timestamp > 0 ? $this->date->cell($timestamp) : [];
  }

  /**
   * Assignee mark, or the Unassigned placeholder.
   *
   * @return array<string, mixed>
   *   A `person` cell.
   */
  private function assigneeCell(BbTicketInterface $ticket): array {
    $items = $ticket->get('assignee_user_id');
    if (!$items->access('view')) {
      return [
        'kind' => 'person',
        'display_name' => (string) $this->t('Unassigned'),
        'initials' => '?',
        'color' => 'offline',
        'name_hidden' => TRUE,
      ];
    }
    $account = $items->entity;
    if ($account instanceof UserInterface) {
      $name = $this->personDisplayName($account);
      return [
        'kind' => 'person',
        'display_name' => $name,
        'initials' => $this->personInitials($name),
        'color' => $this->personColor((int) $account->id()),
        'name_hidden' => TRUE,
      ];
    }
    return [
      'kind' => 'person',
      'display_name' => (string) $this->t('Unassigned'),
      'initials' => '?',
      'color' => 'offline',
      'name_hidden' => TRUE,
    ];
  }

  /**
   * Canonical ticket URL, or empty when the route is missing.
   */
  private function ticketUrl(BbTicketInterface $ticket): string {
    try {
      return $ticket->toUrl('canonical')->toString();
    }
    catch (\Exception) {
      return Url::fromRoute('<none>')->toString();
    }
  }

  /**
   * The project context, if present.
   */
  private function project(): ?BbProjectInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    return $entity instanceof BbProjectInterface ? $entity : NULL;
  }

}
