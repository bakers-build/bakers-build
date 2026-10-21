<?php

declare(strict_types=1);

namespace Drupal\bb_activity;

use Drupal\Component\Render\PlainTextOutput;
use Drupal\Core\Database\Connection;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Mail\MailManagerInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\Url;
use Drupal\bb_activity\Activity\ActivityKindInterface;
use Drupal\bb_activity\Activity\ActivityKindManager;
use Drupal\bb_activity\Activity\MailMessage;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\user\UserInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Mails a recorded activity to the kind's recipients that ticked the kind.
 *
 * Sending waits until the outermost transaction ends: a rolled-back write
 * sends nothing, and no mail or lookup error can reach the write. Each
 * recipient's failure is logged and never retried. The kind names its
 * recipients and words the text; this class knows no kind by name.
 */
final class ActivityMailer {

  use StringTranslationTrait;

  public function __construct(
    private readonly Connection $database,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly ActivityKindManager $kinds,
    private readonly NotificationSettings $settings,
    private readonly MailManagerInterface $mailManager,
    #[Autowire(service: 'logger.channel.bb_activity')]
    private readonly LoggerInterface $logger,
  ) {}

  /**
   * Sends the activity's mails once its write has committed.
   *
   * Never throws: the recording kind calls it inside the write.
   */
  public function afterCommit(BbActivity $activity): void {
    $id = (int) $activity->id();
    $transactions = $this->database->transactionManager();
    if (!$transactions->inTransaction()) {
      $this->sendSafely($id);
      return;
    }
    $transactions->addPostTransactionCallback(function (bool $committed) use ($id): void {
      if ($committed) {
        $this->sendSafely($id);
      }
    });
  }

  /**
   * Sends one activity's mails; logs and swallows every failure.
   */
  private function sendSafely(int $activity_id): void {
    try {
      $this->send($activity_id);
    }
    catch (\Throwable $e) {
      $this->logger->error('Activity @activity: mail failed: @message', [
        '@activity' => $activity_id,
        '@message' => $e->getMessage(),
      ]);
    }
  }

  /**
   * Sends every ticked message of one stored activity.
   */
  private function send(int $activity_id): void {
    // An inner rollback may have removed the row this request saw, and it does
    // not undo the persistent entity cache: read the database, not the cache.
    $storage = $this->entityTypeManager->getStorage('bb_activity');
    $storage->resetCache([$activity_id]);
    $activity = $storage->load($activity_id);
    if (!$activity instanceof BbActivity) {
      return;
    }
    $kind = $this->kinds->forActivity($activity);
    $ticket = $activity->get('ticket_id')->entity;
    if ($kind === NULL || !$ticket instanceof BbTicketInterface) {
      return;
    }
    $definition = $kind->getPluginDefinition();
    if (!is_array($definition) || empty($definition['mail'])) {
      return;
    }
    $subscribers = $this->settings->subscribers($kind->getPluginId());
    if ($subscribers === []) {
      return;
    }
    foreach (array_unique(array_intersect($kind->recipients($activity), $subscribers)) as $uid) {
      $this->mailOne($activity, $ticket, $kind, (int) $uid);
    }
  }

  /**
   * Mails the kind's mail to one account, if it can still be reached.
   *
   * A kind that words no mail text for the reader mails nothing.
   */
  private function mailOne(BbActivity $activity, BbTicketInterface $ticket, ActivityKindInterface $kind, int $uid): void {
    try {
      $recipient = $this->entityTypeManager->getStorage('user')->load($uid);
      if (!$recipient instanceof UserInterface
        || !$recipient->isActive()
        || (string) $recipient->getEmail() === ''
        || !$ticket->access('view', $recipient)) {
        return;
      }
      $langcode = $recipient->getPreferredLangcode();
      $options = ['langcode' => $langcode];
      $text = $this->text($kind, $activity, $recipient, $langcode);
      if ($text === NULL) {
        return;
      }
      $summary = $text->subject();
      $identifier = $ticket->getIdentifier();
      $params = [
        'subject' => PlainTextOutput::renderFromHtml((string) $this->t('[@identifier] @summary', [
          '@identifier' => $identifier,
          '@summary' => $summary,
        ], $options)),
        'body' => [
          '# ' . $identifier . ': ' . $ticket->label(),
          $summary,
          ...array_filter([$text->body()]),
          $this->t('Open the ticket: @url', [
            '@url' => $ticket->toUrl('canonical', ['absolute' => TRUE])->toString(),
          ], $options),
          $this->t('Change which mails you get: @url', [
            '@url' => Url::fromRoute('bb_activity.notifications', ['user' => $uid], ['absolute' => TRUE])->toString(),
          ], $options),
        ],
      ];
      $message = $this->mailManager->mail('bb_activity', 'activity', (string) $recipient->getEmail(), $langcode, $params);
      if (($message['result'] ?? NULL) === FALSE) {
        $this->logger->warning('Activity @activity: the @message mail to account @uid was not delivered.', [
          '@activity' => $activity->id(),
          '@message' => $kind->getPluginId(),
          '@uid' => $uid,
        ]);
      }
    }
    catch (\Throwable $e) {
      $this->logger->error('Activity @activity: the @message mail to account @uid failed: @error', [
        '@activity' => $activity->id(),
        '@message' => $kind->getPluginId(),
        '@uid' => $uid,
        '@error' => $e->getMessage(),
      ]);
    }
  }

  /**
   * The kind's mail text for one reader, if it words one.
   */
  private function text(ActivityKindInterface $kind, BbActivity $activity, UserInterface $recipient, string $langcode): ?MailMessage {
    foreach ($kind->messages($activity, $recipient, $langcode) as $message) {
      if ($message instanceof MailMessage) {
        return $message;
      }
    }
    return NULL;
  }

}
