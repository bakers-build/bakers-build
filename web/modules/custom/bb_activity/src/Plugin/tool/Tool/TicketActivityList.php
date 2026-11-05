<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Plugin\tool\Tool;

use Drupal\bb_activity\Activity\ActivityKindManager;
use Drupal\bb_activity\Activity\FeedMessage;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Plugin\tool\Tool\PagedQueryTrait;
use Drupal\bb_core\Plugin\tool\Tool\TicketInputTrait;
use Drupal\Component\Uuid\Uuid;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Language\LanguageManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\ListOutputDefinition;
use Drupal\tool\TypedData\MapOutputDefinition;
use Drupal\tool\TypedData\OutputDefinition;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Lists the viewable activities of one ticket or project, newest first.
 */
#[Tool(
  id: 'bakers_ticket_activity_list',
  label: new TranslatableMarkup('List ticket activity'),
  description: new TranslatableMarkup('Lists the activity events of one ticket or of one project’s tickets, newest first, as the activity feed shows them. Give exactly one of ticket and project.'),
  operation: ToolOperation::Read,
  permission: 'view bb_ticket',
  input_definitions: [
    'ticket' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Ticket'),
      description: new TranslatableMarkup('Ticket identifier (e.g. BAKERS-15) or UUID.'),
      required: FALSE,
    ),
    'project' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Project'),
      description: new TranslatableMarkup('Project key or UUID.'),
      required: FALSE,
    ),
    'limit' => new InputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Limit'),
      description: new TranslatableMarkup('Rows per page, 1-100; default 50.'),
      required: FALSE,
    ),
    'offset' => new InputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Offset'),
      description: new TranslatableMarkup('Rows to skip; default 0.'),
      required: FALSE,
    ),
  ],
  output_definitions: [
    'events' => new ListOutputDefinition(
      label: new TranslatableMarkup('Events'),
      description: new TranslatableMarkup('The viewable activity events.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Event'),
        description: new TranslatableMarkup('One activity event.'),
        property_definitions: [
          'uuid' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('UUID'),
            description: new TranslatableMarkup('The activity UUID.'),
          ),
          'kind' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Kind'),
            description: new TranslatableMarkup('The activity kind, e.g. created or status_changed.'),
          ),
          'created' => new OutputDefinition(
            data_type: 'integer',
            label: new TranslatableMarkup('Created'),
            description: new TranslatableMarkup('Unix time of the event.'),
          ),
          'actor' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Actor'),
            description: new TranslatableMarkup('Display name of the account that caused it.'),
            nullable: TRUE,
          ),
          'ticket' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Ticket'),
            description: new TranslatableMarkup('The ticket identifier.'),
            nullable: TRUE,
          ),
          'message' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Message'),
            description: new TranslatableMarkup('The feed statement, e.g. "started work in implementation".'),
            nullable: TRUE,
          ),
        ],
      ),
    ),
    'next_offset' => new OutputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Next offset'),
      description: new TranslatableMarkup('The offset of the next page, or null on the last page.'),
      nullable: TRUE,
    ),
  ],
)]
final class TicketActivityList extends ToolBase {

  use TicketInputTrait;
  use PagedQueryTrait;

  /**
   * Words each row through its activity kind.
   */
  private ActivityKindManager $kinds;

  /**
   * The language the kind words the row in.
   */
  private LanguageManagerInterface $languages;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->kinds = $container->get('plugin.manager.bb_activity_kind');
    $instance->languages = $container->get('language_manager');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $ticket = $values['ticket'] ?? NULL;
    $project = $values['project'] ?? NULL;
    if (($ticket === NULL) === ($project === NULL)) {
      throw new \InvalidArgumentException('Give exactly one of ticket and project.');
    }
    $tickets = $ticket !== NULL
      ? [$this->readableTicket($ticket)->id()]
      : array_values($this->entities()->getStorage('bb_ticket')->getQuery()->accessCheck(TRUE)
        ->condition('project_id', $this->readableProjectId($project))->execute());
    $storage = $this->entities()->getStorage('bb_activity');
    // The feed's order: created, then id for rows of the same second.
    [$ids, $next] = $tickets === [] ? [[], NULL] : $this->page($storage->getQuery()->accessCheck(TRUE)
      ->condition('ticket_id', $tickets, 'IN')
      ->sort('created', 'DESC')
      ->sort('id', 'DESC'), $values);
    $events = [];
    foreach ($storage->loadMultiple($ids) as $activity) {
      assert($activity instanceof BbActivity);
      if ($activity->access('view', $this->currentUser)) {
        $events[] = $this->event($activity);
      }
    }
    return ExecutableResult::success(new TranslatableMarkup('@count events found.', ['@count' => count($events)]), [
      'events' => $events,
      'next_offset' => $next,
    ]);
  }

  /**
   * One output row.
   *
   * @return array<string, mixed>
   *   The event.
   */
  private function event(BbActivity $activity): array {
    $actor = $activity->get('actor');
    $ticket = $activity->get('ticket_id')->entity;
    return [
      'uuid' => $activity->uuid(),
      'kind' => (string) $activity->get('kind')->value,
      'created' => (int) $activity->get('created')->value,
      // A user's label is its display name.
      'actor' => $actor->access('view', $this->currentUser) ? $actor->entity?->label() : NULL,
      'ticket' => $ticket instanceof BbTicketInterface ? $ticket->getIdentifier() : NULL,
      'message' => $this->message($activity),
    ];
  }

  /**
   * The statement the kind words for the feed, if any.
   */
  private function message(BbActivity $activity): ?string {
    $langcode = $this->languages->getCurrentLanguage()->getId();
    foreach ($this->kinds->forActivity($activity)?->messages($activity, $this->currentUser, $langcode) ?? [] as $message) {
      if ($message instanceof FeedMessage) {
        return $message->statement;
      }
    }
    return NULL;
  }

  /**
   * The id of the readable project with this key or UUID.
   *
   * @throws \InvalidArgumentException
   */
  private function readableProjectId(string $project): int|string {
    $storage = $this->entities()->getStorage('bb_project');
    $ids = $storage->getQuery()->accessCheck(TRUE)
      ->condition(Uuid::isValid($project) ? 'uuid' : 'key', $project)->range(0, 1)->execute();
    $entity = $ids ? $storage->load(reset($ids)) : NULL;
    if ($entity === NULL || !$entity->access('view', $this->currentUser)) {
      throw new \InvalidArgumentException(sprintf('Project %s does not exist or is not readable.', $project));
    }
    return $entity->id();
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // The access-checked queries and entity access in doExecute() decide.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
