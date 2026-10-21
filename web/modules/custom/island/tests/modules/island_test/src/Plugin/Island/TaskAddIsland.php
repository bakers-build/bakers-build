<?php

declare(strict_types=1);

namespace Drupal\island_test\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;
use Drupal\island_test\Form\TestTaskRecordForm;

/**
 * An island that IS a form, for the mutation path over HTTP.
 *
 * The recorded marker is rendered beside the form rather than inside it, so a
 * response proves two separate things at once: that the fragment is this
 * island's own container, and that the submit handler behind the form ran.
 */
#[Island(
  id: 'task_add',
  label: new TranslatableMarkup('Add task'),
  description: new TranslatableMarkup('Kernel test fixture: an island form.'),
  type: 'widget',
)]
final class TaskAddIsland extends IslandPluginBase {

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    return [
      'recorded' => ['#markup' => 'recorded:' . ($data['recorded'] ?? '')],
      'form' => $this->getForm(TestTaskRecordForm::class),
    ];
  }

}
