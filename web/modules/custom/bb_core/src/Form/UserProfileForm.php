<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Component\Utility\UrlHelper;
use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Url;

/**
 * Edits only a user's position and background (the `profile` form mode).
 *
 * Core's ProfileForm always adds name, mail and password, which a workspace
 * lead editing a service account must not reach.
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
    return Url::fromRoute('bb_core.user.profile', ['user' => $this->entity->id()]);
  }

}
