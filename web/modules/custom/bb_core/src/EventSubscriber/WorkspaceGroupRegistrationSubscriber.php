<?php

declare(strict_types=1);

namespace Drupal\bb_core\EventSubscriber;

use Drupal\Core\Config\ConfigCrudEvent;
use Drupal\Core\Config\ConfigEvents;
use Drupal\bb_core\Hook\WorkspaceMembershipHooks;
use Drupal\og\GroupTypeManagerInterface;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Places the default workspace owner in `lead` when og.settings registers it.
 *
 * A recipe registers bb_workspace in its `actions:`, after the default
 * workspace and its ranks exist, so the owner placement waits for this save.
 */
final class WorkspaceGroupRegistrationSubscriber implements EventSubscriberInterface {

  public function __construct(
    private readonly WorkspaceMembershipHooks $membershipHooks,
    // Optional only for kernel tests that enable bb_core without og.
    private readonly ?GroupTypeManagerInterface $groupTypeManager = NULL,
  ) {
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, string>
   *   The subscribed events.
   */
  public static function getSubscribedEvents(): array {
    return [ConfigEvents::SAVE => 'onConfigSave'];
  }

  /**
   * Reacts to a changed group registration in og.settings.
   *
   * @param \Drupal\Core\Config\ConfigCrudEvent $event
   *   The config save event.
   */
  public function onConfigSave(ConfigCrudEvent $event): void {
    $config = $event->getConfig();
    if ($this->groupTypeManager === NULL || $config->getName() !== 'og.settings' || !$event->isChanged('groups')) {
      return;
    }
    // Only the registration itself places the owner; a later save of the
    // group map must not undo a demotion.
    $registered = static fn (mixed $groups): bool => in_array('bb_workspace', (array) ($groups['bb_workspace'] ?? []), TRUE);
    if ($registered($config->getOriginal('groups')) || !$registered($config->get('groups'))) {
      return;
    }
    // The group map is cached per request; this save just changed it.
    $this->groupTypeManager->resetGroupMap();
    $this->membershipHooks->placeDefaultWorkspaceOwnerInLead();
  }

}
