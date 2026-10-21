<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

/**
 * Defines the interface for bakers.build ticket template entities.
 *
 * A template is a reusable recipe for creating a `bb_ticket`: a title and
 * description pattern (with `{{date}}`/`{{month}}` placeholders), a workflow,
 * a target state to transition the generated ticket into, and the
 * project/conductor/labels/owner to copy onto it. It belongs to exactly one
 * project or, without a project, to one workspace. Instantiation is owned by
 * \Drupal\bb_core\TicketTemplate\TicketTemplateInstantiator, not by
 * this entity.
 */
interface BbTicketTemplateInterface extends BbContentEntityInterface {

  /**
   * The workspace of a workspace template, NULL on a project template.
   */
  public function getScopeWorkspaceId(): ?int;

  /**
   * Whether this template belongs to a workspace instead of a project.
   */
  public function isWorkspaceScoped(): bool;

  /**
   * Whether this template may currently be instantiated.
   */
  public function isEnabled(): bool;

  /**
   * The raw title pattern, before placeholder substitution.
   */
  public function getTitlePattern(): string;

  /**
   * The raw description pattern, before placeholder substitution.
   */
  public function getDescriptionPattern(): string;

  /**
   * The workflow plugin ID to set on generated tickets.
   */
  public function getWorkflow(): string;

  /**
   * The state a generated ticket should be transitioned into after creation.
   */
  public function getTargetState(): string;

}
