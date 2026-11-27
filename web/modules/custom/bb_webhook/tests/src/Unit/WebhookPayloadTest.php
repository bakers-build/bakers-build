<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_webhook\Unit;

use Drupal\bb_webhook\Webhook\WebhookPayload;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\TestCase;

/**
 * The signature a receiver recomputes.
 */
#[Group('bb_webhook')]
final class WebhookPayloadTest extends TestCase {

  /**
   * HMAC-SHA256 of "<timestamp>.<body>" with the secret, hex, `sha256=`.
   */
  public function testSignatureMatchesHmac(): void {
    $this->assertSame(
      'sha256=c6ef4734033cee2367414a0939385eca0397754aa7a59716da7463a9298b5146',
      WebhookPayload::sign('k', 1700000000, '{}'),
    );
  }

}
