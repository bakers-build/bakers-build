<?php

declare(strict_types=1);

namespace Drupal\island_test\Form;

use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Url;
use Drupal\island\Form\WrappedDialogFormBase;

/**
 * A wrapper-format dialog form holding nothing but pass-throughs.
 *
 * THE FIXTURE FOR `WrappedDialogFormTest`, and deliberately in THIS module
 * rather than in a consumer's. The round trip the trait carries is a property
 * of the wrapper format, so it has to be observable with `island` and
 * `island_test` alone — no theme, no entity type, no product. A test that
 * drove a bakers.build form instead would be measuring that form's own composition and
 * would keep passing if the trait were quietly bypassed.
 *
 * THE ID ENDS IN `_form`, AND THAT IS PART OF THE FIXTURE RATHER THAN A
 * naming habit: the format refuses any other, because core's own htmx-form
 * heuristic keys on the `-form` suffix of the DOM id
 * `Html::getUniqueId($form_id)` produces. {@see WrappedDialogMisnamedProbeForm}
 * is the fixture that proves the refusal.
 *
 * NOT `final`, for that fixture's sake alone: the misnamed probe differs in one
 * method and everything else about it has to stay this class's.
 *
 * THE PASS-THROUGHS EXIST BECAUSE THE TRAIT'S MEMBERS ARE `protected`, and
 * they stay that way: `returnUrl()` and `dialogPostUrl()` are a form's own
 * business and nothing outside one calls them. A fixture widening its own view
 * of them is how a protected member gets asserted without loosening the real
 * contract.
 */
class WrappedDialogProbeForm extends WrappedDialogFormBase {

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'island_test_wrapped_dialog_probe_form';
  }

  /**
   * {@inheritdoc}
   *
   * `attachDialogHtmx()` is called unconditionally — deciding whether this
   * request is a dialog one is the trait's job, not a consumer's, and that is
   * exactly what `testHtmxIsAttachedOnlyOnADialogRequest()` measures.
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $form['title'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Title'),
    ];
    $form['actions']['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Save'),
    ];
    // APPENDED BEFORE `attachDialogHtmx()`, which is the order an
    // `EntityForm`-shaped consumer produces by construction: its `form()` adds
    // its own callbacks and its `buildForm()` calls the trait afterwards. The
    // fixture reproduces that order deliberately, because it is what
    // `WrappedDialogFormTest::testAConsumersOwnAfterBuildRunsBeforeTheLift()`
    // is about.
    $form['#after_build'][] = '::finishOwnSubmit';
    $this->attachDialogHtmx($form);
    return $form;
  }

  /**
   * Finishes this fixture's own submit control, the way a consumer does.
   *
   * A REAL CONSUMER'S SHAPE AND NOT A MARKER FOR ITS OWN SAKE: a create
   * surface decides a submit's disabled state and its dependency attribute
   * here, because both need values only the built form has. All of that
   * addresses `$form['actions']`, so it can only work while the row is still
   * one of the form's children.
   *
   * @param array $element
   *   The finished form. Ungenerified for the reason the trait's own
   *   `#after_build` members give: the array is handed straight back out and a
   *   narrower annotation is widened on the way through.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state. Unused.
   *
   * @return array
   *   The same form, with this fixture's mark on its submit.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function finishOwnSubmit(array $element, FormStateInterface $form_state): array {
    if (isset($element['actions']['submit'])) {
      $element['actions']['submit']['#attributes']['data-probe-finished'] = 'seen-by-the-consumer';
    }
    return $element;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $this->respondAtReturnUrl($form_state);
  }

  /**
   * The trait's `returnUrl()`, widened for this fixture only.
   */
  public function publicReturnUrl(): Url {
    return $this->returnUrl();
  }

  /**
   * The trait's `dialogPostUrl()`, widened for this fixture only.
   */
  public function publicDialogPostUrl(): Url {
    return $this->dialogPostUrl();
  }

  /**
   * The trait's `isDialogRequest()`, widened for this fixture only.
   */
  public function publicIsDialogRequest(): bool {
    return $this->isDialogRequest();
  }

}
