<?php

declare(strict_types=1);

namespace Drupal\bb_webhook\Plugin\QueueWorker;

use Drupal\bb_webhook\Entity\BbWebhookInterface;
use Drupal\bb_webhook\Webhook\WebhookPayload;
use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Queue\Attribute\QueueWorker;
use Drupal\Core\Queue\QueueFactory;
use Drupal\Core\Queue\QueueWorkerBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\GuzzleException;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * POSTs one signed delivery; a failure is queued again, up to five attempts.
 */
#[QueueWorker(
  id: 'bb_webhook_delivery',
  title: new TranslatableMarkup('Webhook delivery'),
  cron: ['time' => 30],
)]
final class WebhookDelivery extends QueueWorkerBase implements ContainerFactoryPluginInterface {

  /**
   * Attempts per delivery, the first included.
   */
  public const MAX_ATTEMPTS = 5;

  /**
   * Constructs the worker.
   *
   * @param array<string, mixed> $configuration
   *   The plugin configuration.
   * @param string $plugin_id
   *   The plugin ID.
   * @param mixed $plugin_definition
   *   The plugin definition.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   Loads the webhook at send time.
   * @param \GuzzleHttp\ClientInterface $httpClient
   *   Sends the POST.
   * @param \Drupal\Core\Queue\QueueFactory $queueFactory
   *   Re-queues a failed delivery.
   * @param \Drupal\Component\Datetime\TimeInterface $time
   *   The signature timestamp.
   * @param \Psr\Log\LoggerInterface $logger
   *   Records a dropped delivery.
   */
  public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly ClientInterface $httpClient,
    private readonly QueueFactory $queueFactory,
    private readonly TimeInterface $time,
    private readonly LoggerInterface $logger,
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
      $container->get('http_client'),
      $container->get('queue'),
      $container->get('datetime.time'),
      $container->get('logger.factory')->get('bb_webhook'),
    );
  }

  /**
   * {@inheritdoc}
   *
   * @param array{webhook: int, body: string, event: string, delivery: string, attempt: int} $data
   *   The queued delivery.
   */
  public function processItem($data): void {
    $webhook = $this->entityTypeManager->getStorage('bb_webhook')->load($data['webhook']);
    if (!$webhook instanceof BbWebhookInterface || !$webhook->isEnabled()) {
      return;
    }
    if ($this->send($webhook, $data)) {
      return;
    }
    if ($data['attempt'] < self::MAX_ATTEMPTS) {
      $this->queueFactory->get('bb_webhook_delivery')->createItem(['attempt' => $data['attempt'] + 1] + $data);
      return;
    }
    $this->logger->warning('Webhook %id dropped delivery %delivery after @attempts attempts.', [
      '%id' => $webhook->id(),
      '%delivery' => $data['delivery'],
      '@attempts' => self::MAX_ATTEMPTS,
    ]);
  }

  /**
   * Sends one attempt; TRUE on a 2xx answer.
   *
   * @param \Drupal\bb_webhook\Entity\BbWebhookInterface $webhook
   *   The webhook.
   * @param array{webhook: int, body: string, event: string, delivery: string, attempt: int} $data
   *   The queued delivery.
   */
  private function send(BbWebhookInterface $webhook, array $data): bool {
    $timestamp = $this->time->getCurrentTime();
    try {
      $response = $this->httpClient->request('POST', $webhook->getUrl(), [
        'body' => $data['body'],
        'timeout' => 5,
        'connect_timeout' => 5,
        'allow_redirects' => FALSE,
        'http_errors' => FALSE,
        'headers' => [
          'Content-Type' => 'application/json',
          'X-Bakers-Event' => $data['event'],
          'X-Bakers-Delivery' => $data['delivery'],
          'X-Bakers-Timestamp' => (string) $timestamp,
          'X-Bakers-Signature' => WebhookPayload::sign($webhook->getSecret(), $timestamp, $data['body']),
        ],
      ]);
    }
    catch (GuzzleException) {
      return FALSE;
    }
    $status = $response->getStatusCode();
    return $status >= 200 && $status < 300;
  }

}
