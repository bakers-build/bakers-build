<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Attribute;

use Drupal\Component\Plugin\Attribute\AttributeBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Declares one activity kind; the plugin ID is the stored bb_activity.kind.
 *
 * The kind listens to its triggers; the facts a trigger hands over are its
 * contexts. See ActivityTrigger.
 */
#[\Attribute(\Attribute::TARGET_CLASS)]
final class BbActivityKind extends AttributeBase {

  /**
   * Constructs a BbActivityKind attribute.
   *
   * @param string $id
   *   The plugin ID, stored in bb_activity.kind.
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup $label
   *   The kind's name, the allowed-value label of bb_activity.kind.
   * @param int $weight
   *   The order kinds are listed in.
   * @param list<string> $triggers
   *   The ActivityTrigger moments this kind is asked about.
   * @param array<string, \Drupal\Core\Plugin\Context\ContextDefinitionInterface> $context_definitions
   *   The facts it reads, named as the triggers hand them over.
   * @param bool $mail
   *   Whether accounts can opt in to mails about rows of this kind; the kind's
   *   recipients() name who a row may reach.
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup|null $mail_label
   *   The checkbox label of its mails; NULL uses the kind label.
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup|null $mail_description
   *   The checkbox's help text.
   * @param bool $mail_default
   *   Whether the box is ticked for every account that has not saved its
   *   choices.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  public function __construct(
    public readonly string $id,
    public readonly TranslatableMarkup $label,
    public readonly int $weight = 0,
    public readonly array $triggers = [],
    public readonly array $context_definitions = [],
    public readonly bool $mail = FALSE,
    public readonly ?TranslatableMarkup $mail_label = NULL,
    public readonly ?TranslatableMarkup $mail_description = NULL,
    public readonly bool $mail_default = FALSE,
  ) {}

}
