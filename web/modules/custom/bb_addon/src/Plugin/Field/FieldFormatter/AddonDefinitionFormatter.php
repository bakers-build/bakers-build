<?php

declare(strict_types=1);

namespace Drupal\bb_addon\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_addon\AddonRepository;
use Drupal\bb_addon\Entity\BbAddonInterface;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * One part of an addon's definition: its label, icon or versions.
 *
 * The icon is shown only as a base64 `data:` URI in the `person` mark's image,
 * where a browser runs no script and loads nothing; it is never printed as
 * markup.
 */
#[FieldFormatter(
  id: 'bb_addon_definition',
  label: new TranslatableMarkup('Addon definition part'),
  field_types: ['string_long'],
)]
final class AddonDefinitionFormatter extends FormatterBase {

  use PersonIdentityTrait;

  /**
   * Reads the sibling versions of the addon's name.
   */
  private AddonRepository $repository;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->repository = $container->get('bb_addon.repository');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public static function defaultSettings(): array {
    return ['part' => 'label'] + parent::defaultSettings();
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   The form elements.
   */
  public function settingsForm(array $form, FormStateInterface $form_state): array {
    return [
      'part' => [
        '#type' => 'select',
        '#title' => $this->t('Part'),
        '#options' => [
          'label' => $this->t('Label'),
          'icon' => $this->t('Icon'),
          'versions' => $this->t('Versions of the name'),
        ],
        '#default_value' => $this->getSetting('part'),
      ],
    ];
  }

  /**
   * {@inheritdoc}
   *
   * @return array<int, array<string, mixed>>
   *   The single element.
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $addon = $items->getEntity();
    if (!$addon instanceof BbAddonInterface) {
      return [];
    }
    return [
      0 => match ($this->getSetting('part')) {
        'icon' => $this->icon($addon),
        'versions' => $this->versions($addon),
        default => ['#plain_text' => $addon->label()],
      },
    ];
  }

  /**
   * The addon's icon as an image, or its initials.
   *
   * @return array<string, mixed>
   *   The `person` component.
   */
  private function icon(BbAddonInterface $addon): array {
    $svg = $addon->definition()['icon'] ?? NULL;
    $props = [
      'variant' => 'compact',
      'size' => 'md',
      'initials' => $this->personInitials($addon->label()),
      'color' => $this->personColor((int) $addon->id()),
      'image_fit' => 'contain',
    ];
    if (is_string($svg) && $svg !== '') {
      $props['picture'] = 'data:image/svg+xml;base64,' . base64_encode($svg);
    }
    return ['#type' => 'component', '#component' => 'bb_theme:person', '#props' => $props];
  }

  /**
   * Every version of the addon's name once, newest first.
   *
   * @return array<string, mixed>
   *   The plain text, tagged so a new version refreshes it.
   */
  private function versions(BbAddonInterface $addon): array {
    $versions = array_unique(array_map(
      static fn (BbAddonInterface $row): string => $row->version(),
      $this->repository->rowsOf($addon->name(), $addon->workspaceId()),
    ));
    return [
      '#plain_text' => implode(', ', $versions),
      '#cache' => ['tags' => ['bb_addon_list']],
    ];
  }

}
