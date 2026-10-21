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
 * Resolves a bakers.build workspace slug before core's entity validation.
 *
 * Mirrors BbProjectReference: the segment reaching this validator is a
 * workspace *slug*, upcast by BbWorkspaceSlugConverter, never a numeric
 * entity id, so the stock entity validator cannot resolve it on its own.
 */
#[ViewsArgumentValidator(
  id: 'bb_workspace_reference',
  title: new TranslatableMarkup('bakers.build workspace reference'),
)]
final class BbWorkspaceReference extends Entity {

  /**
   * The same slug converter used by workspace routes.
   */
  protected ParamConverterInterface $workspaceConverter;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $plugin_definition['entity_type'] = 'bb_workspace';
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->workspaceConverter = $container->get('bb_core.paramconverter.workspace_slug');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function validateArgument(mixed $argument): bool {
    if (!is_scalar($argument) || (string) $argument === '') {
      return FALSE;
    }
    $workspace = $this->workspaceConverter->convert((string) $argument, ['type' => 'bb_workspace_slug'], 'bb_workspace', []);
    if (!$workspace instanceof EntityInterface || !parent::validateArgument($workspace->id())) {
      return FALSE;
    }
    // Keep the raw View args for URL generation; only the query uses the ID.
    $this->argument->argument = (string) $workspace->id();
    return TRUE;
  }

}
