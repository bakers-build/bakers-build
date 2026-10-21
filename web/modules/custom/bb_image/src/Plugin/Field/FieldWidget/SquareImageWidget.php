<?php

declare(strict_types=1);

namespace Drupal\bb_image\Plugin\Field\FieldWidget;

use Drupal\Core\Field\Attribute\FieldWidget;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\file\FileInterface;
use Drupal\bb_image\Hook\SquareCropHooks;
use Drupal\image\Plugin\Field\FieldWidget\ImageWidget;
use Symfony\Component\Validator\ConstraintViolationInterface;

/**
 * Core's image widget with a square crop dialog and no separate upload.
 *
 * Everything core's widget does — validators, destination, alt and title,
 * cardinality, Remove — stays. Two things change: the file travels with the
 * parent form's Save instead of an Ajax upload, so nothing is uploaded or
 * persisted before Save; and each image carries a hidden `crop` input that the
 * `bb_theme:image_crop` dialog writes. The widget checks it against the
 * uploaded file and stages it on the item; SquareCropHooks writes it once the
 * entity has saved.
 */
#[FieldWidget(
  id: 'bb_square_image',
  label: new TranslatableMarkup('Image with square crop'),
  field_types: ['image'],
)]
final class SquareImageWidget extends ImageWidget {

  /**
   * {@inheritdoc}
   */
  public function formElement(FieldItemListInterface $items, $delta, array $element, array &$form, FormStateInterface $form_state): array {
    $element = parent::formElement($items, $delta, $element, $form, $form_state);
    // One new file per element: each file needs its own crop input.
    // ponytail: a multi-value field adds one image per Save; a per-file crop
    // list for a multiple file input is the upgrade path.
    $element['#multiple'] = FALSE;
    return $element;
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $element
   *   The managed file element.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   * @param array<string, mixed> $form
   *   The complete form.
   */
  public static function process($element, FormStateInterface $form_state, $form): array {
    $element = parent::process($element, $form_state, $form);
    $element['upload_button']['#access'] = FALSE;
    // The alt text is asked together with the file, which no longer arrives
    // before Save; core shows it only once a file is uploaded.
    // Required only with a file: on Save the upload is processed before this
    // runs, so a new file without alt text is still refused.
    if ($element['#alt_field']) {
      $element['alt']['#access'] = TRUE;
      $element['alt']['#required'] = $element['#alt_field_required'] && !empty($element['#files']);
    }
    // A plain submit, so the widget needs no Drupal Ajax inside HTMX forms,
    // drawn as the theme's quiet button beside Edit crop.
    unset($element['remove_button']['#ajax']);
    $element['remove_button']['#bb_variant'] = 'ghost';
    $element['remove_button']['#theme_wrappers'] = ['input__submit__bb_button'];
    // The dialog shows the staged framing; core's preview would show the saved.
    $element['preview']['#access'] = FALSE;

    $file = $element['#files'] ? reset($element['#files']) : NULL;
    $crop = $element['#value']['crop'] ?? NULL;
    $element['crop'] = [
      '#type' => 'hidden',
      '#value' => is_string($crop) ? $crop : '',
      '#attributes' => ['data-bakers-crop-value' => TRUE],
    ];
    $props = [
      'label' => (string) ($element['#title'] ?? new TranslatableMarkup('Image')),
      'id' => $element['#id'] . '-crop',
      'hint' => static::hint($element),
    ];
    if (isset($element['upload']['#id']) && ($element['upload']['#access'] ?? TRUE)) {
      $props['input_id'] = $element['upload']['#id'];
    }
    if ($file instanceof FileInterface) {
      $image = \Drupal::service('image.factory')->get($file->getFileUri());
      $saved = \Drupal::service(SquareCropHooks::class)->find($file);
      $props += [
        'src' => \Drupal::service('file_url_generator')->generateString($file->getFileUri()),
        'width' => (int) $image->getWidth(),
        'height' => (int) $image->getHeight(),
        'crop' => is_string($crop) && $crop !== '' ? $crop : json_encode($saved),
      ];
      // The thumbnail names the file; core's file link would repeat it.
      $element['file_' . $file->id()]['#access'] = FALSE;
    }
    // image-widget--bakers-square-image.html.twig hands these and the widget's
    // children to `bb_theme:image_crop`; the hint replaces core's help text.
    $element['#element_validate'][] = [static::class, 'validateCrop'];
    $element['#theme'] = 'image_widget__bb_square_image';
    $element['#bb_crop'] = $props;
    $element['#description'] = NULL;
    return $element;
  }

  /**
   * Refuses a staged crop that is no square inside the uploaded file.
   *
   * Checked against the file this element accepted, read from disk, so a
   * submission cannot claim other dimensions or crop another file.
   *
   * @param array<string, mixed> $element
   *   The managed file element.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  public static function validateCrop(array $element, FormStateInterface $form_state): void {
    $geometry = json_decode((string) ($element['#value']['crop'] ?? ''), TRUE);
    $file = $element['#files'] ? reset($element['#files']) : NULL;
    if ($geometry === NULL || !$file instanceof FileInterface) {
      return;
    }
    $violation = \Drupal::service(SquareCropHooks::class)->violation($geometry, $file);
    if ($violation !== NULL) {
      $form_state->setError($element, $violation);
    }
  }

  /**
   * The accepted formats, from the field's own upload validators.
   *
   * @param array<string, mixed> $element
   *   The managed file element.
   */
  protected static function hint(array $element): string {
    $extensions = $element['#upload_validators']['FileExtension']['extensions'] ?? '';
    return implode(', ', array_map('strtoupper', array_filter(explode(' ', $extensions))));
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $element
   *   The managed file element.
   * @param mixed $input
   *   The submitted input, or FALSE without one.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  public static function value($element, $input, FormStateInterface $form_state): array {
    $return = parent::value($element, $input, $form_state);
    // The raw JSON survives a rebuild; massageFormValues() decodes it.
    $return['crop'] = is_array($input) && is_string($input['crop'] ?? NULL) ? $input['crop'] : '';
    return $return;
  }

  /**
   * {@inheritdoc}
   *
   * Core's ImageWidget resolves a violation to the item's sub-element named
   * by its path, and returns NULL for an item-level one such as a refused
   * file reference; those point at the widget.
   */
  public function errorElement(array $element, ConstraintViolationInterface $error, array $form, FormStateInterface $form_state): array|bool {
    if (!isset(explode('.', $error->getPropertyPath())[1])) {
      return $element;
    }
    return parent::errorElement($element, $error, $form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function massageFormValues(array $values, array $form, FormStateInterface $form_state): array {
    $massaged = parent::massageFormValues($values, $form, $form_state);
    foreach ($massaged as &$value) {
      $crop = json_decode((string) ($value['crop'] ?? ''), TRUE);
      $value['crop'] = is_array($crop) ? $crop : NULL;
    }
    return $massaged;
  }

}
