<?php

declare(strict_types=1);

namespace Drupal\island_test\Form;

/**
 * A wrapped-dialog form whose id the format cannot serve.
 *
 * THE ONLY PROOF THE GUARD FIRES. `WrappedDialogFormTrait` refuses a form id
 * that does not end in `_form`, because core's own htmx-form heuristic
 * (`FormBuilder.php:781-791`) keys on the `-form` suffix of the DOM id and on
 * nothing else — a dialog breaking the convention would be handed an
 * out-of-band build-id swap while its build id was already in the main swap,
 * which is a surface that cannot be submitted twice rather than an error.
 *
 * IT IS A SECOND FIXTURE AND NOT A PARAMETER ON THE FIRST, because the id is
 * what is under test: a `getFormId()` that answered differently per case would
 * make every OTHER case in `WrappedDialogFormTest` depend on which one it is,
 * and the trait reads the id at build time through core's builder.
 */
final class WrappedDialogMisnamedProbeForm extends WrappedDialogProbeForm {

  /**
   * {@inheritdoc}
   *
   * No `_form` suffix, deliberately. Everything else about this form is the
   * probe's.
   */
  public function getFormId(): string {
    return 'island_test_wrapped_dialog_misnamed';
  }

}
