<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldType;

use Drupal\Core\Field\Attribute\FieldType;
use Drupal\Core\Field\FieldItemBase;
use Drupal\Core\Field\FieldStorageDefinitionInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\TypedData\DataDefinition;

/**
 * Defines the 'bb_repo' field type for storing repository metadata.
 *
 * Persists three columns per value: the repository URL (required), the name
 * of the default branch, and a branch-naming convention string that tooling
 * can use when creating feature branches.
 */
#[FieldType(
  id: 'bb_repo',
  label: new TranslatableMarkup('bakers.build repository'),
  description: new TranslatableMarkup('Stores repository URL and branch metadata.'),
  default_widget: 'bb_repo',
  default_formatter: 'bb_repo',
)]
final class BbRepoItem extends FieldItemBase {

  /**
   * {@inheritdoc}
   */
  public static function propertyDefinitions(FieldStorageDefinitionInterface $field_definition): array {
    $properties = [];
    // Stored as a plain string, not 'uri': the SSH scp shorthand
    // (git@host:path.git) is not a valid URI, so the 'uri' primitive-type
    // constraint would reject it before any custom validation runs. The
    // BbRepoUrl constraint owns clone-URL validation instead.
    $properties['url'] = DataDefinition::create('string')
      ->setLabel(new TranslatableMarkup('URL'))
      ->setRequired(TRUE)
      ->addConstraint('BbRepoUrl');
    $properties['default_branch'] = DataDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Default branch'));
    $properties['branch_convention'] = DataDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Branch convention'));
    return $properties;
  }

  /**
   * {@inheritdoc}
   */
  public static function schema(FieldStorageDefinitionInterface $field_definition): array {
    return [
      'columns' => [
        'url' => [
          'type' => 'varchar',
          'length' => 2048,
          'not null' => TRUE,
        ],
        'default_branch' => [
          'type' => 'varchar',
          'length' => 255,
        ],
        'branch_convention' => [
          'type' => 'varchar',
          'length' => 255,
        ],
      ],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function isEmpty(): bool {
    $value = $this->get('url')->getValue();
    return $value === NULL || $value === '';
  }

}
