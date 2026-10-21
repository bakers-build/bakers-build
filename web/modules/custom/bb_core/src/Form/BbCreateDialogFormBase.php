<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Entity\Display\EntityFormDisplayInterface;
use Drupal\Core\Entity\Entity\EntityFormDisplay;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Template\Attribute;
use Drupal\bb_core\Plugin\Field\FieldWidget\PickerWidgetInterface;
use Drupal\island\Form\WrappedDialogFormTrait;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Shared presentation and submission lifecycle for create dialogs.
 *
 * Subjects supply labels, defaults, validation and optionally island intents.
 * WrappedDialogFormTrait owns the transport and dialog completion behavior.
 * The permission check here also protects direct form invocation; route-level
 * entity access remains authoritative and may impose stricter requirements.
 */
abstract class BbCreateDialogFormBase extends ContentEntityForm {

  // THE WRAPPER-FORMAT ROUND TRIP, WHICH IS `island`'s.
  // `isDialogRequest()`, `attachDialogHtmx()`, `dialogPostUrl()`,
  // `returnUrl()` and `respondAtReturnUrl()` are properties of the format
  // rather than of a subject or of this product, so they live beside the
  // renderer that defines the format.
  use WrappedDialogFormTrait;

  /**
   * The unsaved entity this dialog would create.
   *
   * Redeclared only to narrow `ContentEntityForm`'s own annotation.
   *
   * @var \Drupal\Core\Entity\ContentEntityInterface
   */
  protected $entity;

  /**
   * The permission this form enforces independently of its container (R10).
   *
   * @return string
   *   The permission name, the one thing about this check that is a subject's.
   */
  protected function subjectCreatePermission(): string {
    return 'create ' . $this->entity->getEntityTypeId();
  }

  /**
   * The subject's action labels.
   *
   * @return array{submit: \Drupal\Core\StringTranslation\TranslatableMarkup, cancel: \Drupal\Core\StringTranslation\TranslatableMarkup}
   *   The create and cancel labels.
   */
  abstract protected function actionLabels(): array;

  /**
   * Builds the shared action row and save-then-finish callback chain.
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    $labels = $this->actionLabels();
    $actions = parent::actions($form, $form_state);
    $actions['submit']['#value'] = $labels['submit'];
    $actions['submit']['#submit'][] = '::landAtReturnUrl';
    $actions['submit']['#theme_wrappers'] = ['input__submit__bb_button'];
    $actions['cancel'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#props' => [
        'variant' => 'ghost',
        'label' => (string) $labels['cancel'],
        'href' => $this->returnUrl()->toString(),
        'attributes' => new Attribute(['data-dialog-cancel' => 'data-dialog-cancel']),
      ],
      '#weight' => -10,
    ];
    return $actions;
  }

  /**
   * Refuses direct or stale submissions without creation access.
   */
  protected function assertCreateAccess(): void {
    if (!$this->createAccess()->isAllowed()) {
      throw new AccessDeniedHttpException('Creation is not permitted.');
    }
  }

  /**
   * Initializes the subject for routed and direct form construction.
   */
  public function prepareSubject(ContainerInterface $container, string $entity_type_id, string $form_mode): void {
    $entity_type_manager = $container->get('entity_type.manager');
    $this->setEntityTypeManager($entity_type_manager);
    $this->setModuleHandler($container->get('module_handler'));
    $this->setStringTranslation($container->get('string_translation'));
    $this->setOperation($form_mode);
    $this->setEntity($entity_type_manager->getStorage($entity_type_id)->create());
  }

  /**
   * Adds the common presenter and dialog transport to the Drupal form.
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $this->assertCreateAccess();
    $form = parent::buildForm($form, $form_state);
    $form['#theme'] = 'bb_create_dialog';
    $this->attachDialogHtmx($form);
    return $form;
  }

  /**
   * The form mode whose display this dialog renders.
   *
   * Defaults to the routed operation, which is correct for a subject reached
   * only through `EntityFormBuilder`/`prepareSubject()`. A subject reached
   * through an `_entity_form` ROUTE instead is overridden here, because
   * `EntityTypeManager::getFormObject()` calls `setOperation($operation)`
   * AFTER construction — using the route's own operation string,
   * unconditionally — which clobbers whatever `prepareSubject()` set during
   * `::create()`. That operation string also selects this subject's FORM
   * CLASS via
   * `handlers.form`, so it cannot simply be renamed to the display's mode
   * without breaking the class lookup too. Overriding this method is what lets
   * the two diverge: the handler key stays `create`, the display mode does not
   * have to.
   */
  protected function formDisplayMode(): string {
    return $this->getOperation();
  }

  /**
   * Lets a subject add a widget the configured display does not carry.
   *
   * Called after `collectRenderDisplay()` and before access/rendering, so a
   * subject may add a component (for example BB-664's project picker, shown
   * only when no route/query bound a project) without a second configured
   * form mode for the same dialog.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  protected function alterFormDisplay(EntityFormDisplayInterface $display, FormStateInterface $form_state): void {
  }

  /**
   * Builds the display widgets and declares their presenter positions.
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $display = EntityFormDisplay::collectRenderDisplay($this->entity, $this->formDisplayMode());
    $this->alterFormDisplay($display, $form_state);
    $this->setFormDisplay($display, $form_state);
    $access = $this->createAccess();
    // Merged rather than hand-listed: the access result's own cacheability is
    // what keeps a permission change from being served out of a stale cached
    // fragment.
    CacheableMetadata::createFromRenderArray($form)
      ->merge(CacheableMetadata::createFromObject($access))
      ->applyTo($form);
    $form = parent::form($form, $form_state);
    // An empty `<div>` core adds for a revision/author sidebar a create dialog
    // does not have. Dropped rather than styled away.
    unset($form['footer']);
    foreach (array_keys($this->getFormDisplay($form_state)->getComponents()) as $name) {
      if (isset($form[$name])) {
        $widget = $this->getFormDisplay($form_state)->getRenderer($name);
        $form[$name]['#picker_region'] = $widget instanceof PickerWidgetInterface ? $widget->pickerRegion() : 'lines';
        $form[$name]['#picker_label'] = $widget instanceof PickerWidgetInterface ? $widget->pickerLabel() : '';
      }
    }
    return $form;
  }

  /**
   * Rechecks access before Drupal applies submitted values.
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $this->assertCreateAccess();
    parent::submitForm($form, $form_state);
  }

  /**
   * Finishes a successful save through the shared dialog response mechanism.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function landAtReturnUrl(array &$form, FormStateInterface $form_state): void {
    $this->respondAtReturnUrl($form_state);
  }

  /**
   * Whether the current account holds this surface's create permission.
   *
   * THE RAW PERMISSION, AND THAT IS WEAKER THAN THE ROUTE'S DOOR — see the
   * class contract. `_entity_create_access` resolves through the
   * entity type's access control handler; this does not. It is the floor under
   * a form reached without that route, not a second asking of the same
   * question.
   */
  protected function createAccess(): AccessResultInterface {
    return AccessResult::allowedIfHasPermission($this->currentUser(), $this->subjectCreatePermission());
  }

}
