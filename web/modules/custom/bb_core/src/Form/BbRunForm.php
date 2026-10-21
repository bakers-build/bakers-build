<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Run entity form with a meta header block and a read-only Footprint panel.
 */
final class BbRunForm extends BbContentEntityFormBase {

  /**
   * The conductor-written footprint metric fields.
   *
   * @var string[]
   */
  private const FOOTPRINT_FIELDS = [
    'tokens',
    'duration_s',
    'active_s',
    'agent_turns',
    'tool_calls',
    'user_prompts',
    'user_prompt_words',
  ];

  /**
   * {@inheritdoc}
   */
  protected static function metaGroups(): array {
    return [
      'meta' => [
        'label' => new TranslatableMarkup('Meta'),
        'open' => TRUE,
        'weight' => 0,
        'fields' => [
          'state',
          'conductor_id',
          'ticket_id',
          'started_at',
          'state_at_start',
          'claim_expires_at',
          'created',
          'changed',
        ],
      ],
      // Footprint: the effort metrics the conductor writes at run close. Shown
      // for visibility only — rendered read-only below (see form()).
      'footprint' => [
        'label' => new TranslatableMarkup('Footprint'),
        'open' => TRUE,
        'weight' => 10,
        'fields' => self::FOOTPRINT_FIELDS,
      ],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    // The metrics are conductor-written; render them read-only so the panel is
    // for visibility, not manual editing.
    foreach (self::FOOTPRINT_FIELDS as $field) {
      if (isset($form[$field])) {
        $form[$field]['#disabled'] = TRUE;
      }
    }
    return $form;
  }

}
