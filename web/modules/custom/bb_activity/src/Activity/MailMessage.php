<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Activity;

use Drupal\Component\Render\MarkupInterface;

/**
 * How a mail about one row reads, in the reader's language.
 *
 * It never names the actor or a conductor. Whether anyone is mailed is the
 * business of the module that sends it.
 */
final class MailMessage implements ActivityMessageInterface {

  /**
   * Constructs a mail text.
   *
   * @param \Drupal\Component\Render\MarkupInterface $subject
   *   The one-line sentence the subject carries.
   * @param \Drupal\Component\Render\MarkupInterface|null $body
   *   An optional paragraph below it.
   */
  public function __construct(
    private readonly MarkupInterface $subject,
    private readonly ?MarkupInterface $body = NULL,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function subject(): MarkupInterface {
    return $this->subject;
  }

  /**
   * {@inheritdoc}
   */
  public function body(): ?MarkupInterface {
    return $this->body;
  }

}
