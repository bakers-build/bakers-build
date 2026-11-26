<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_webhook\Kernel;

use Drupal\bb_webhook\Entity\BbWebhookInterface;
use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Queue\DelayedRequeueException;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Psr\Http\Message\RequestInterface;

/**
 * Activities are queued per covering webhook and POSTed signed, with retry.
 */
#[Group('bb_webhook')]
#[RunTestsInSeparateProcesses]
final class WebhookDeliveryTest extends WebhookKernelTestBase {

  /**
   * The requests the mocked client sent.
   *
   * @var array<int, array{request: \Psr\Http\Message\RequestInterface}>
   */
  private array $history = [];

  /**
   * The mocked responses, consumed in order.
   */
  private MockHandler $responses;

  /**
   * The clock the hook and the worker read, advanced by the tests.
   */
  private object $clock;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->responses = new MockHandler();
    $stack = HandlerStack::create($this->responses);
    $stack->push(Middleware::history($this->history));
    $this->container->set('http_client', new Client(['handler' => $stack]));
    $this->clock = new class implements TimeInterface {

      /**
       * The current Unix time.
       */
      public int $now = 1800000000;

      public function getRequestTime(): int {
        return $this->now;
      }

      public function getRequestMicroTime(): float {
        return $this->now;
      }

      public function getCurrentTime(): int {
        return $this->now;
      }

      public function getCurrentMicroTime(): float {
        return $this->now;
      }

    };
    $this->container->set('datetime.time', $this->clock);
  }

  /**
   * Moves the clock past every retry delay.
   */
  private function laterOn(): void {
    $this->clock->now += 3600;
  }

  /**
   * Saves a webhook of side a.
   *
   * @param array<string, mixed> $values
   *   Field values.
   */
  private function saved(array $values = []): BbWebhookInterface {
    $webhook = $this->newWebhook('a', $values);
    $webhook->save();
    return $webhook;
  }

  /**
   * Records a status change on side a's ticket.
   */
  private function recordActivity(): void {
    $this->createEntity('bb_activity', [
      'ticket_id' => $this->fixture('a', 'bb_ticket')->id(),
      'kind' => 'status_changed',
      'actor' => $this->leads['a']->id(),
      'previous_state' => 'plan',
      'new_state' => 'working',
    ]);
  }

  /**
   * The webhook ids of the queued items, sorted.
   *
   * @return array<int>
   *   The ids.
   */
  private function queuedWebhookIds(): array {
    $queue = $this->container->get('queue')->get('bb_webhook_delivery');
    $ids = [];
    while ($item = $queue->claimItem()) {
      $ids[] = (int) $item->data['webhook'];
      $queue->deleteItem($item);
    }
    sort($ids);
    return $ids;
  }

  /**
   * Runs the delivery worker like cron, until it is empty or must wait.
   */
  private function drain(): void {
    $queue = $this->container->get('queue')->get('bb_webhook_delivery');
    $worker = $this->container->get('plugin.manager.queue_worker')->createInstance('bb_webhook_delivery');
    for ($i = 0; $i < 50 && ($item = $queue->claimItem()); $i++) {
      try {
        $worker->processItem($item->data);
      }
      catch (DelayedRequeueException) {
        $queue->releaseItem($item);
        return;
      }
      $queue->deleteItem($item);
    }
  }

  /**
   * The URLs that were POSTed, in order.
   *
   * @return array<string>
   *   The URLs.
   */
  private function postedUrls(): array {
    return array_map(static fn (array $entry): string => (string) $entry['request']->getUri(), $this->history);
  }

  /**
   * Project, its group and the workspace fire; another project and side b don't.
   */
  public function testActivityEnqueuesMatchingScopesOnly(): void {
    $other_project = $this->createEntity('bb_project', [
      'name' => 'project-a2',
      'group_id' => $this->fixture('a', 'bb_group')->id(),
      'teams' => [$this->fixture('a', 'bb_team')->id()],
    ]);
    $expected = [
      (int) $this->saved()->id(),
      (int) $this->saved(['project_id' => $this->fixture('a', 'bb_project')->id()])->id(),
      (int) $this->saved(['group_id' => $this->fixture('a', 'bb_group')->id()])->id(),
    ];
    $this->saved(['project_id' => $other_project->id()]);
    $this->saved(['enabled' => FALSE]);
    $this->newWebhook('b')->save();
    $this->recordActivity();
    sort($expected);
    $this->assertSame($expected, $this->queuedWebhookIds());
  }

  /**
   * Recording an activity sends nothing.
   */
  public function testNoHttpOnInsert(): void {
    $this->saved();
    $this->recordActivity();
    $this->assertSame([], $this->history);
  }

  /**
   * The POST carries the event headers and a verifiable signature.
   */
  public function testPostCarriesSignedHeaders(): void {
    $webhook = $this->saved();
    $this->recordActivity();
    $this->responses->append(new Response(204));
    $this->drain();

    $this->assertCount(1, $this->history);
    $request = $this->history[0]['request'];
    assert($request instanceof RequestInterface);
    $this->assertSame('POST', $request->getMethod());
    $this->assertSame($webhook->getUrl(), (string) $request->getUri());
    $this->assertSame('application/json', $request->getHeaderLine('Content-Type'));
    $this->assertSame('status_changed', $request->getHeaderLine('X-Bakers-Event'));
    $body = (string) $request->getBody();
    $timestamp = $request->getHeaderLine('X-Bakers-Timestamp');
    $this->assertSame('sha256=' . hash_hmac('sha256', "$timestamp.$body", $webhook->getSecret()), $request->getHeaderLine('X-Bakers-Signature'));
    $payload = json_decode($body, TRUE);
    $this->assertSame('status_changed', $payload['event']);
    $this->assertSame($request->getHeaderLine('X-Bakers-Delivery'), $payload['id']);
    $this->assertSame($this->fixture('a', 'bb_ticket')->uuid(), $payload['ticket']['uuid']);
    $this->assertSame('plan', $payload['previous_state']);
    $this->assertSame('working', $payload['new_state']);
    $this->assertSame($this->leads['a']->uuid(), $payload['actor']);
  }

  /**
   * A failing endpoint is tried five times in total, then dropped.
   */
  public function testFailureRequeuedUntilFifthAttempt(): void {
    $this->saved();
    $this->recordActivity();
    for ($i = 0; $i < 10; $i++) {
      $this->responses->append(new Response(500));
    }
    $this->drain();
    $this->assertCount(1, $this->history, 'the retry waits for a later cron run');
    $this->drain();
    $this->assertCount(1, $this->history, 'the retry is not sent before its delay');
    for ($i = 0; $i < 6; $i++) {
      $this->laterOn();
      $this->drain();
    }
    $this->assertCount(5, $this->history);
    $this->assertSame([], $this->queuedWebhookIds());
  }

  /**
   * A connection error is retried like a failing response.
   */
  public function testTimeoutRequeued(): void {
    $this->saved();
    $this->recordActivity();
    $this->responses->append(new ConnectException('timed out', new Request('POST', 'https://hooks.example.com/a')), new Response(200));
    $this->drain();
    $this->laterOn();
    $this->drain();
    $this->assertCount(2, $this->history);
    $this->assertSame([], $this->queuedWebhookIds());
  }

  /**
   * A webhook disabled or deleted after queueing gets no POST.
   */
  public function testDisabledOrDeletedSkipped(): void {
    $disabled = $this->saved(['name' => 'disabled']);
    $deleted = $this->saved(['url' => 'https://hooks.example.com/deleted']);
    $kept = $this->saved(['url' => 'https://hooks.example.com/kept']);
    $this->recordActivity();
    $disabled->set('enabled', FALSE)->save();
    $deleted->delete();
    $this->responses->append(new Response(200), new Response(200), new Response(200));
    $this->drain();
    $this->assertSame([$kept->getUrl()], $this->postedUrls());
  }

}
