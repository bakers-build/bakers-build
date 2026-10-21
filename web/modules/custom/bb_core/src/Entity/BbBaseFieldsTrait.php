<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\user\EntityOwnerTrait;

/**
 * Builds the shared `owner_user_id`, `workspace_id` and identity base fields.
 *
 * Each helper returns the common definition; the caller adds its own
 * constraints, description or required flag.
 */
trait BbBaseFieldsTrait {

  /**
   * Builds the `owner_user_id` reference defaulting to the acting account.
   *
   * @param int $weight
   *   The form widget weight.
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup|null $label
   *   The field label; NULL for "Owner".
   */
  protected static function ownerBaseFieldDefinition(int $weight = 95, ?TranslatableMarkup $label = NULL): BaseFieldDefinition {
    return self::ownerReference($weight, $label)
      ->setDefaultValueCallback(EntityOwnerTrait::class . '::getDefaultEntityOwner');
  }

  /**
   * Builds the `owner_user_id` reference defaulting to anonymous (0).
   *
   * For owners that must never follow the session.
   *
   * @param int $weight
   *   The form widget weight.
   */
  protected static function anonymousOwnerBaseFieldDefinition(int $weight): BaseFieldDefinition {
    return self::ownerReference($weight, NULL)->setDefaultValue(0);
  }

  /**
   * Builds the user reference both owner variants share.
   */
  private static function ownerReference(int $weight, ?TranslatableMarkup $label): BaseFieldDefinition {
    return BaseFieldDefinition::create('entity_reference')
      ->setLabel($label ?? new TranslatableMarkup('Owner'))
      ->setSetting('target_type', 'user')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete', 'weight' => $weight]);
  }

  /**
   * Builds the required `workspace_id` reference.
   *
   * @param int|null $weight
   *   The form widget weight, or NULL for no default form widget.
   */
  protected static function workspaceBaseFieldDefinition(?int $weight): BaseFieldDefinition {
    $field = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Workspace'))
      ->setRequired(TRUE)
      ->setSetting('target_type', 'bb_workspace')
      ->setDisplayConfigurable('form', TRUE);
    if ($weight !== NULL) {
      $field->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete', 'weight' => $weight]);
    }
    return $field;
  }

  /**
   * Builds the optional plain-text `description` shown under a listing row.
   *
   * Multiline: its line breaks are kept and shown wherever it is printed.
   *
   * @param int $weight
   *   The form widget weight.
   */
  protected static function descriptionBaseFieldDefinition(int $weight): BaseFieldDefinition {
    return BaseFieldDefinition::create('string_long')
      ->setLabel(new TranslatableMarkup('Description'))
      ->setDescription(new TranslatableMarkup('A few lines of plain text, at most 280 characters.'))
      ->addPropertyConstraints('value', [
        'Length' => [
          'max' => 280,
          'maxMessage' => 'Description: may not be longer than 280 characters.',
        ],
      ])
      ->setDisplayOptions('form', ['type' => 'string_textarea', 'weight' => $weight, 'settings' => ['rows' => 3]])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE);
  }

  /**
   * Builds the optional `image` a listing row shows as its avatar.
   *
   * Stored privately; the square crop set where it is uploaded shapes the
   * avatar derivative. The avatar is decorative next to the name, so alt and
   * title inputs are off.
   *
   * @param string $directory
   *   The directory under private:// the uploads land in.
   * @param int $weight
   *   The form widget weight.
   */
  protected static function imageBaseFieldDefinition(string $directory, int $weight): BaseFieldDefinition {
    return BaseFieldDefinition::create('image')
      ->setLabel(new TranslatableMarkup('Image'))
      ->setSettings([
        'uri_scheme' => 'private',
        'file_directory' => $directory,
        'file_extensions' => 'png gif jpg jpeg webp',
        'max_filesize' => '2 MB',
        'alt_field' => FALSE,
        'alt_field_required' => FALSE,
        'title_field' => FALSE,
        'title_field_required' => FALSE,
      ])
      ->addConstraint('BbImageFileIsImage')
      ->setDisplayOptions('form', ['type' => 'image_image', 'weight' => $weight])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', TRUE);
  }

}
