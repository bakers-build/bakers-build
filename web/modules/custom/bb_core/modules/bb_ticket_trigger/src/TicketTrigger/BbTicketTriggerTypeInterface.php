<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\TicketTrigger;

use Drupal\Component\Plugin\ConfigurableInterface;
use Drupal\Component\Plugin\PluginInspectionInterface;
use Drupal\Core\Plugin\PluginFormInterface;

/**
 * A ticket trigger type: decides when a template's trigger fires.
 *
 * The configuration and its form use the core plugin methods, so the Plugin
 * module's field and widget store and edit it. Ticket creation is not the
 * type's business: TicketTriggerRunner calls the template instantiator.
 */
interface BbTicketTriggerTypeInterface extends PluginInspectionInterface, ConfigurableInterface, PluginFormInterface {

  /**
   * One line describing the configuration, for the trigger list.
   */
  public function summary(): string;

  /**
   * The first occurrence strictly after $after.
   *
   * @return \DateTimeImmutable|null
   *   The occurrence, or NULL for a type that is not scheduled.
   */
  public function nextOccurrence(\DateTimeImmutable $after): ?\DateTimeImmutable;

  /**
   * Errors of the current configuration; empty when it is valid.
   *
   * Shared by the configuration form and the activation constraint, which
   * also guards saves that bypass the form.
   *
   * @return array<string>
   *   The error messages.
   */
  public function configurationErrors(): array;

}
