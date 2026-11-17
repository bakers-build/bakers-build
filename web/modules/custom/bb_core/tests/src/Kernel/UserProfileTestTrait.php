<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Entity\BbProfileInterface;
use Drupal\bb_core\Profile\Profiles;
use Drupal\user\UserInterface;

/**
 * Installs and submits the Profile form (position and background).
 */
trait UserProfileTestTrait {

  /**
   * Installs the profile entity the form edits.
   */
  protected function installUserProfileConfig(): void {
    $this->installEntitySchema('bb_profile');
  }

  /**
   * Presses Save on a user's Profile form in a workspace, as the current user.
   */
  protected function submitUserProfile(UserInterface $user, int $workspace_id, string $position, string $background): FormStateInterface {
    $form = $this->container->get('entity_type.manager')->getFormObject('bb_profile', 'default');
    $form->setEntity($this->container->get(Profiles::class)->forAccount((int) $user->id(), $workspace_id));
    $formState = (new FormState())->setValues([
      'position' => [['value' => $position]],
      'background' => [['value' => $background]],
      'op' => 'Save',
    ]);
    $this->container->get('form_builder')->submitForm($form, $formState);
    return $formState;
  }

  /**
   * A user's stored position and background in a workspace.
   *
   * @return array{0: string, 1: string}
   *   Position and background as stored; empty when there is no profile.
   */
  protected function storedUserProfile(UserInterface $user, int $workspace_id): array {
    $this->container->get('entity_type.manager')->getStorage('bb_profile')->resetCache();
    $profile = $this->container->get(Profiles::class)->forAccount((int) $user->id(), $workspace_id);
    self::assertInstanceOf(BbProfileInterface::class, $profile);
    return [$profile->position(), $profile->background()];
  }

}
