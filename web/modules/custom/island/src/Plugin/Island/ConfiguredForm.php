<?php

declare(strict_types=1);

namespace Drupal\island\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;

/**
 * Renders a configured form as the whole island body.
 *
 * A host places it under its own placement id by returning this plugin's id
 * from `getIslandPluginId()` and the configuration below from
 * `getIslandConfiguration()`; the html id then uses the host's placement id.
 *
 * Plugin configuration (`getIslandConfiguration()`'s return value):
 * - `form_class` (string, required): the `IslandFormBase` subclass to render.
 * - `required_data_key` (string, optional): a key `build()`'s `$data` must
 *   carry, or the island renders empty rather than call the form with data
 *   it does not expect.
 * - `required_data_class` (string, optional): the class or interface the
 *   value at `required_data_key` must be an instance of. Ignored when
 *   `required_data_key` is not set.
 */
#[Island(
  id: 'configured_form',
  label: new TranslatableMarkup('Form'),
  description: new TranslatableMarkup('Renders a configured form as the whole island body.'),
  type: 'region',
)]
final class ConfiguredForm extends IslandPluginBase {

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    $required_key = $this->configuration['required_data_key'] ?? NULL;
    if (is_string($required_key) && $required_key !== '') {
      $value = $data[$required_key] ?? NULL;
      $required_class = $this->configuration['required_data_class'] ?? NULL;
      $class_mismatch = is_string($required_class)
        && $required_class !== ''
        && !($value instanceof $required_class);
      if ($value === NULL || $class_mismatch) {
        // No ambient data of the required shape — see the host. Rendering
        // regardless would be a tenancy or a route-context leak.
        return [];
      }
    }

    $form_class = (string) ($this->configuration['form_class'] ?? '');
    if ($form_class === '') {
      return [];
    }

    // `$data` is NOT forwarded as form build-info args. `getForm()`'s second
    // argument is extra keys merged into the `island_id`/`host_id` tuple,
    // which Form API serialises with the form. Island data can carry live
    // objects (an account, a group) that do not belong there. The configured
    // form reaches its host's data through `IslandFormTrait::resolveIsland()`,
    // the same path every other island form already uses.
    return $this->getForm($form_class);
  }

}
