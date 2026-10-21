<?php

declare(strict_types=1);

namespace Drupal\bb_core\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;

/**
 * Workspace-independent recovery pages for core's HTML error subrequests.
 */
final class BbErrorPageController extends ControllerBase {

  /**
   * Presents access denied without disclosing the requested resource.
   */
  public function on403(): array {
    return $this->page(
      $this->t('403 — Access denied'),
      $this->t("You don't have permission to open this page."),
      'signpost-denied',
    );
  }

  /**
   * Presents a missing page without echoing untrusted request details.
   */
  public function on404(): array {
    return $this->page(
      $this->t('404 — Page not found'),
      $this->t("We couldn't find this page. It may have moved or the address may be incorrect."),
      'signpost-missing',
    );
  }

  /**
   * Composes the shared error canvas and a native recovery link.
   */
  private function page(mixed $title, mixed $message, string $icon): array {
    $authenticated = $this->currentUser()->isAuthenticated();
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:canvas',
      '#props' => ['attributes' => new Attribute(['role' => 'main'])],
      '#cache' => ['contexts' => ['user.roles:authenticated', 'languages:language_interface']],
      '#slots' => [
        'header' => [
          '#type' => 'component',
          '#component' => 'bb_theme:text',
          '#props' => ['text' => (string) $title, 'as' => 'h1', 'size' => 'display', 'align' => 'center'],
        ],
        'main' => [
          'state' => [
            '#type' => 'component',
            '#component' => 'bb_theme:empty-state',
            '#props' => ['message' => (string) $message, 'icon' => $icon],
          ],
          'recovery' => [
            '#type' => 'component',
            '#component' => 'bb_theme:button',
            '#variant' => 'primary',
            '#props' => [
              'label' => $authenticated ? $this->t('Go to home') : $this->t('Sign in'),
              'href' => Url::fromRoute($authenticated ? 'bb_core.home' : 'user.login')->toString(),
              'attributes' => new Attribute(['data-hx-boost' => 'false']),
            ],
          ],
        ],
      ],
    ];
  }

}
