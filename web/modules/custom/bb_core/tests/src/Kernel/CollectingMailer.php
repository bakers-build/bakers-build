<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Symfony\Component\Mailer\Envelope;
use Symfony\Component\Mailer\MailerInterface;
use Symfony\Component\Mime\Email;
use Symfony\Component\Mime\RawMessage;

/**
 * A mailer that keeps what it is handed instead of delivering it.
 */
final class CollectingMailer implements MailerInterface {

  /**
   * Messages handed over, in order.
   *
   * @var list<\Symfony\Component\Mime\Email>
   */
  public array $sent = [];

  /**
   * Send attempts, including failed ones.
   */
  public int $attempts = 0;

  /**
   * When set, every send throws it.
   */
  public ?\Exception $failure = NULL;

  /**
   * {@inheritdoc}
   */
  public function send(RawMessage $message, ?Envelope $envelope = NULL): void {
    $this->attempts++;
    if ($this->failure !== NULL) {
      throw $this->failure;
    }
    assert($message instanceof Email);
    $this->sent[] = $message;
  }

}
