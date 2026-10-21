<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\argument_validator;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\ParamConverter\ParamConverterInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\views\Attribute\ViewsArgumentValidator;
use Drupal\views\Plugin\views\argument_validator\Entity;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Resolves bakers.build project keys and UUIDs before core's entity validation.
 */
#[ViewsArgumentValidator(
  id: 'bb_project_reference',
  title: new TranslatableMarkup('bakers.build project reference'),
)]
final class BbProjectReference extends Entity {

  /**
   * The same project converter used by workspace routes.
   */
  protected ParamConverterInterface $projectConverter;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $plugin_definition['entity_type'] = 'bb_project';
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->projectConverter = $container->get('bb_core.paramconverter.project_key');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function validateArgument(mixed $argument): bool {
    if (!is_scalar($argument) || (string) $argument === '') {
      return FALSE;
    }
    $project = $this->projectConverter->convert((string) $argument, ['type' => 'entity:bb_project'], 'bb_project', []);
    if (!$project instanceof EntityInterface || !parent::validateArgument($project->id())) {
      return FALSE;
    }
    // Keep the raw View args for URL generation; only the query uses the ID.
    $this->argument->argument = (string) $project->id();
    return TRUE;
  }

}
