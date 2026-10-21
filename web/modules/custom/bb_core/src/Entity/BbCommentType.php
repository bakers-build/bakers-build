<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Config\Entity\ConfigEntityBundleBase;
use Drupal\Core\Entity\Attribute\ConfigEntityType;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Bundle config entity for bb_comment.
 *
 * `ConfigEntityBundleBase` so creating a type clears cached bundle info, the
 * same reason BbVocabulary uses it.
 */
#[ConfigEntityType(
  id: 'bb_comment_type',
  label: new TranslatableMarkup('bakers.build comment type'),
  label_collection: new TranslatableMarkup('bakers.build comment types'),
  label_singular: new TranslatableMarkup('bakers.build comment type'),
  label_plural: new TranslatableMarkup('bakers.build comment types'),
  config_prefix: 'bb_comment_type',
  entity_keys: ['id' => 'id', 'label' => 'label'],
  admin_permission: 'administer bakers',
  bundle_of: 'bb_comment',
  config_export: ['id', 'label'],
)]
final class BbCommentType extends ConfigEntityBundleBase implements BbCommentTypeInterface {

  /**
   * The machine name.
   */
  protected string $id = '';

  /**
   * The human-readable label.
   */
  protected string $label = '';

}
