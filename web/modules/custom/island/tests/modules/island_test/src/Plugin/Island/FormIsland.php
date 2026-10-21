<?php

declare(strict_types=1);

namespace Drupal\island_test\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;
use Drupal\island_test\Form\TestTaskAddForm;

/**
 * An island whose build CONTAINS A FORM, for the mutation path's render pass.
 *
 * The other fixtures here render markup, and markup cannot show the property
 * IslandMutationPathTest exists for: a form's CSRF token is emitted as a
 * PLACEHOLDER that only a root render pass resolves, so whether the responder
 * root-rendered is invisible unless something in the fragment has a placeholder
 * to leave behind.
 *
 * It is a separate island rather than a form bolted onto `task_list` because
 * `task_list` and `task_count` are the mutation path's existing fixtures and
 * IslandResponderTest reads their markup — adding a form to one of them would
 * change that markup without any behaviour changing, which is the same reason
 * the host's docblock keeps `rail` apart from them.
 *
 * It subscribes to no events and declares no boost, so it never joins another
 * island's fragment set and adding it changed no existing expectation.
 */
#[Island(
  id: 'task_form',
  label: new TranslatableMarkup('Task form'),
  type: 'region',
)]
final class FormIsland extends IslandPluginBase {

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    return ['form' => $this->getForm(TestTaskAddForm::class)];
  }

}
