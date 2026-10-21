<?php

declare(strict_types=1);

namespace Drupal\island_example\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;
use Drupal\island_example\Entity\Note;

/**
 * Note demo island: note summary plus the entity edit form.
 */
#[Island(
  id: 'note',
  label: new TranslatableMarkup('Note'),
  type: 'view',
)]
final class NoteIsland extends IslandPluginBase {

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    $note = $data['note'] ?? NULL;
    if (!$note instanceof Note) {
      return ['#markup' => (string) $this->t('No note.')];
    }
    $form_object = $this->entityTypeManager->getFormObject('island_example_note', 'edit');
    $form_object->setEntity($note);
    return [
      '#cache' => ['max-age' => 0],
      'summary' => [
        '#type' => 'inline_template',
        '#template' => '<div data-testid="note-summary"><h2>{{ title }}</h2><p>{{ body }}</p></div>',
        '#context' => [
          'title' => $note->label(),
          'body' => (string) $note->get('body')->value,
        ],
      ],
      'form' => $this->formBuilder->getForm($form_object, [
        'island_id' => 'note',
        'host_id' => $this->hostId(),
      ]),
    ];
  }

}
