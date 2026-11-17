<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Component\Utility\UrlHelper;
use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbProfileInterface;

/**
 * Edits a profile's position and background in its workspace.
 *
 * The form of `bb_profile`, shown on the user's Profile tab, so a workspace
 * lead editing a service account never reaches name, mail or password.
 */
final class UserProfileForm extends ContentEntityForm {

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $result = parent::save($form, $form_state);
    $this->messenger()->addStatus($this->t('Profile saved.'));
    TicketNavigation::finishAt($this->returnUrl(), $form_state, $this->getRequest());
    return $result;
  }

  /**
   * The local `destination`, else this profile page.
   */
  private function returnUrl(): Url {
    $destination = $this->getRequest()->query->get('destination');
    if (is_string($destination) && str_starts_with($destination, '/') && !UrlHelper::isExternal($destination)) {
      return Url::fromUserInput($destination);
    }
    $profile = $this->entity;
    assert($profile instanceof BbProfileInterface);
    $workspace = $profile->get('workspace_id')->entity;
    return Url::fromRoute('bb_core.user.profile', ['user' => $profile->getOwnerId()], [
      'query' => $workspace === NULL ? [] : ['workspace' => $workspace->uuid()],
    ]);
  }

}
