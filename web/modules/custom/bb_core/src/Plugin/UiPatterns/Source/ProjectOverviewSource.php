<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\bb_core\Ticket\ProjectOverviewTickets;
use Drupal\bb_core\Time\BbDate;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Description and epic ticket rows.
 */
#[Source(
  id: 'bb_project_overview',
  label: new TranslatableMarkup('[bakers.build] Project overview'),
  description: new TranslatableMarkup('Epics list and the project description.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_project', label: new TranslatableMarkup('Project'), required: TRUE),
  ],
)]
final class ProjectOverviewSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  use PersonIdentityTrait;

  /**
   * Computes the Overview facts.
   */
  protected ProjectOverviewTickets $overview;

  /**
   * Formats "Created … ago".
   */
  protected BbDate $date;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->overview = $container->get(ProjectOverviewTickets::class);
    $instance->date = $container->get(BbDate::class);
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
        'description' => $this->t('Description'),
        'epics' => $this->t('Epics'),
      ],
      '#empty_option' => $this->t('- All -'),
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
    $wanted = (string) ($this->getSetting('section') ?? '');
    return match ($wanted) {
      'description' => $this->description($project),
      'epics' => $this->zone(
        (string) $this->t('Epics'),
        '',
        [$this->epicList($this->overview->epicTickets($project))],
      ),
      '' => array_values(array_filter([
        $this->description($project),
        $this->zone(
          (string) $this->t('Epics'),
          '',
          [$this->epicList($this->overview->epicTickets($project))],
        ),
      ])),
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
      $metadata->addCacheTags(['bb_ticket_list']);
    }
    $metadata->addCacheContexts(['user']);
    $metadata->applyTo($element);
    return $element;
  }

  /**
   * Left-aligned project note, or empty when the field is blank.
   *
   * @return array<string, mixed>
   *   A `text` component, or empty.
   */
  private function description(BbProjectInterface $project): array {
    $text = trim((string) $project->get('description')->value);
    if ($text === '') {
      return [];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:text',
      '#props' => [
        'text' => $text,
        'as' => 'p',
        'size' => 'body',
        'align' => 'start',
      ],
    ];
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
   * Epic tickets as the normal ticket list row.
   *
   * @param list<\Drupal\bb_core\Entity\BbTicketInterface> $tickets
   *   Epic tickets, identifier order.
   */
  private function epicList(array $tickets): array {
    $items = [];
    foreach ($tickets as $ticket) {
      $items[] = $this->epicItem($ticket);
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:list',
      '#props' => [
        'layout' => 'lines',
        'pattern' => [
          'avatar' => ['state'],
          'headline' => ['title', 'priority'],
          'meta' => ['identifier', 'created'],
          'right' => ['assignee'],
          'captions' => [
            'created' => (string) $this->t('Created'),
          ],
        ],
        'items' => $items,
      ],
      '#slots' => [
        'empty' => [
          '#type' => 'component',
          '#component' => 'bb_theme:empty-state',
          '#props' => [
            'message' => (string) $this->t('No epics in this project.'),
          ],
        ],
      ],
    ];
  }

  /**
   * One epic row in the ticket listing pattern.
   *
   * @return array<string, mixed>
   *   A `list` item.
   */
  private function epicItem(BbTicketInterface $ticket): array {
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
      'created' => [
        'kind' => 'rendered',
        'markup' => $this->createdAgo($ticket),
      ],
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
   * The created time label for the Created caption.
   */
  private function createdAgo(BbTicketInterface $ticket): string {
    $timestamp = (int) $ticket->getCreatedTime();
    if ($timestamp <= 0) {
      return '';
    }
    return $this->date->label($timestamp);
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
