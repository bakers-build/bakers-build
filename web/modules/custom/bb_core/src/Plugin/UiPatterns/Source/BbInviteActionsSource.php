<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbInvite;
use Drupal\Core\Template\Attribute;
use Drupal\bb_core\Form\OverlayTrigger;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * The invitation detail's footer: Revoke, behind its confirmation.
 */
#[Source(
  id: 'bb_invite_actions',
  label: new TranslatableMarkup('[bakers.build] Invitation actions'),
  description: new TranslatableMarkup('Revoke an invitation, behind a confirmation.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_invite', label: new TranslatableMarkup('Invitation'), required: TRUE),
  ],
)]
final class BbInviteActionsSource extends SourcePluginBase {

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    try {
      $invite = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return [];
    }
    if (!$invite instanceof BbInvite) {
      return [];
    }
    $access = $invite->access('delete', NULL, TRUE);
    $build = $access->isAllowed() ? ['revoke' => self::revokeButton($invite)] : [];
    CacheableMetadata::createFromObject($access)->addCacheableDependency($invite)->applyTo($build);
    return $build;
  }

  /**
   * The Revoke button: opens the revoke confirm dialog in the overlay.
   *
   * A revoke never happens in one click. The href is the confirm page
   * without JavaScript.
   *
   * @return array<string, mixed>
   *   A `bb_theme:button` render array.
   */
  public static function revokeButton(BbInvite $invite): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#attached' => ['library' => ['core/drupal.htmx']],
      '#props' => [
        'variant' => 'danger',
        'label' => (string) new TranslatableMarkup('Revoke invitation'),
        'href' => $invite->toUrl('delete-form')->toString(),
        'attributes' => new Attribute(OverlayTrigger::attributes($invite->toUrl('delete-form'))),
      ],
    ];
  }

}
