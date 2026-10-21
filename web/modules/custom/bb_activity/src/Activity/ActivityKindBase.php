<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Activity;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\ContextAwarePluginTrait;
use Drupal\Core\Plugin\PluginBase;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\bb_activity\ActivityMailer;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Shared plumbing of activity kinds: contexts, the one row, wording helpers.
 */
abstract class ActivityKindBase extends PluginBase implements ActivityKindInterface, ContainerFactoryPluginInterface {

  use ContextAwarePluginTrait;
  use PersonIdentityTrait;

  /**
   * Whether this instance already saved its row.
   */
  private bool $recorded = FALSE;

  /**
   * Constructs an activity kind.
   *
   * @param array<string, mixed> $configuration
   *   The plugin configuration.
   * @param string $plugin_id
   *   The plugin ID.
   * @param mixed $plugin_definition
   *   The plugin definition.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   Loads tickets, accounts and related rows.
   * @param \Drupal\Core\Session\AccountProxyInterface $currentUser
   *   The initiating account at capture time.
   * @param \Drupal\Component\Datetime\TimeInterface $time
   *   Wall-clock time used for created, not the request-start timestamp.
   * @param \Drupal\bb_activity\ActivityMailer $mailer
   *   Sends the mails of a saved row once the write has committed.
   */
  final public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    protected readonly EntityTypeManagerInterface $entityTypeManager,
    protected readonly AccountProxyInterface $currentUser,
    protected readonly TimeInterface $time,
    private readonly ActivityMailer $mailer,
  ) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
  }

  /**
   * {@inheritdoc}
   *
   * @param \Symfony\Component\DependencyInjection\ContainerInterface $container
   *   The service container.
   * @param array<string, mixed> $configuration
   *   The plugin configuration.
   * @param string $plugin_id
   *   The plugin ID.
   * @param mixed $plugin_definition
   *   The plugin definition.
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    return new static(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('entity_type.manager'),
      $container->get('current_user'),
      $container->get('datetime.time'),
      $container->get(ActivityMailer::class),
    );
  }

  /**
   * Saves this kind's one row for the ticket and sends its mails.
   *
   * Adds kind, ticket, actor, workflow and created time to the values. The
   * mails go out after the caller's write commits, never for a rollback.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket the row belongs to.
   * @param array<string, mixed> $values
   *   Kind-specific field values.
   *
   * @throws \LogicException
   *   When this instance already saved its row.
   */
  protected function save(BbTicketInterface $ticket, array $values): BbActivity {
    if ($this->recorded) {
      throw new \LogicException(sprintf('The %s activity kind instance already recorded; create a new one.', $this->getPluginId()));
    }
    $this->recorded = TRUE;
    $activity = $this->entityTypeManager->getStorage('bb_activity')->create($values + [
      'kind' => $this->getPluginId(),
      'ticket_id' => $ticket->id(),
      'actor' => $this->currentUser->id(),
      'workflow' => (string) $ticket->get('workflow')->value,
      'created' => $this->time->getCurrentTime(),
    ]);
    assert($activity instanceof BbActivity);
    $activity->save();
    $this->mailer->afterCommit($activity);
    return $activity;
  }

  /**
   * The ticket the kind is about: the saved entity, or a claim's ticket.
   *
   * @throws \Drupal\Component\Plugin\Exception\ContextException
   *   When the trigger handed over no ticket.
   */
  protected function contextTicket(): BbTicketInterface {
    $ticket = $this->getContextValue('ticket');
    assert($ticket instanceof BbTicketInterface);
    return $ticket;
  }

  /**
   * The saved ticket of a ticket trigger.
   *
   * @throws \Drupal\Component\Plugin\Exception\ContextException
   *   When the trigger handed over no entity.
   */
  protected function contextEntity(): BbTicketInterface {
    $ticket = $this->getContextValue('entity');
    assert($ticket instanceof BbTicketInterface);
    return $ticket;
  }

  /**
   * The workflow label of a state field of the row, else the machine name.
   */
  protected function stateLabel(BbActivity $activity, string $field): string {
    $state = (string) $activity->get($field)->value;
    $metadata = TypeWorkflows::stateMetadata((string) $activity->get('workflow')->value, $state);
    return (string) ($metadata['label'] ?? $state);
  }

  /**
   * {@inheritdoc}
   *
   * The accounts the row is addressed to.
   */
  public function recipients(BbActivity $activity): array {
    return $this->accountIds($activity);
  }

  /**
   * The accounts the row is addressed to, uid 0 excluded.
   *
   * @return list<int>
   *   Account IDs.
   */
  protected function accountIds(BbActivity $activity): array {
    $uids = array_map(static fn (array $item): int => (int) ($item['target_id'] ?? 0), $activity->get('accounts')->getValue());
    return array_values(array_unique(array_filter($uids, static fn (int $uid): bool => $uid > 0)));
  }

  /**
   * Display names of the addressed accounts the reader may view.
   *
   * @return list<string>
   *   Names, in stored order.
   */
  protected function accountNames(BbActivity $activity, AccountInterface $reader): array {
    $names = [];
    foreach ($this->entityTypeManager->getStorage('user')->loadMultiple($this->accountIds($activity)) as $account) {
      if ($account instanceof UserInterface && $account->access('view', $reader)) {
        $names[] = $this->personDisplayName($account);
      }
    }
    return $names;
  }

}
