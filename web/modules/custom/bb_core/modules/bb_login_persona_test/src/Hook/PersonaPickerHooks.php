<?php

declare(strict_types=1);

namespace Drupal\bb_login_persona_test\Hook;

use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\bb_login_persona_test\Form\PersonaPickerForm;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Puts the persona picker on the sign-in page, beside the login form.
 */
final class PersonaPickerHooks {

  public function __construct(
    #[Autowire(service: 'current_route_match')]
    private readonly RouteMatchInterface $routeMatch,
    #[Autowire(service: 'form_builder')]
    private readonly FormBuilderInterface $formBuilder,
  ) {}

  /**
   * Implements hook_page_bottom().
   *
   * A form of its own rather than buttons on the login form, which stays the
   * product's one-field form.
   *
   * @param array<string, mixed> $page_bottom
   *   The page bottom render array.
   */
  #[Hook('page_bottom')]
  public function pageBottom(array &$page_bottom): void {
    $page_bottom['#cache']['contexts'][] = 'route';
    if ($this->routeMatch->getRouteName() === 'user.login') {
      $page_bottom['bb_login_persona_test'] = $this->formBuilder->getForm(PersonaPickerForm::class);
    }
  }

}
