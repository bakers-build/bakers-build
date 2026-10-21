<?php

declare(strict_types=1);

namespace Drupal\island\Form;

use Drupal\Core\Form\FormBase;

/**
 * Base class for forms answered through the dialog wrapper format.
 *
 * THE OTHER HALF OF A PAIRING THIS MODULE ALREADY HAS, and it mirrors
 * {@see IslandFormBase} / {@see IslandFormTrait} one for one — for the reason
 * that class's own docblock gives: "the wiring itself lives in IslandFormTrait
 * so any form base class (e.g. ContentEntityForm) can reuse it." The trait is
 * where the behaviour lives; this class is only the convenience for a consumer
 * that is NOT an entity form and therefore has a free base class to spend.
 *
 * A CONSUMER GETS NOTHING HERE IT COULD NOT GET FROM THE TRAIT. It is
 * deliberately four lines: no `final buildForm()`, no template method, no
 * abstract hook. {@see IslandFormBase} finalises its three Form API methods
 * because an island form's response shape is the module's contract; a wrapped
 * route's is Form API's own, so there is nothing here to protect.
 *
 * @see \Drupal\island\Form\WrappedDialogFormTrait
 * @see \Drupal\island\Render\WrappedRouteRenderer
 */
abstract class WrappedDialogFormBase extends FormBase {

  use WrappedDialogFormTrait;

}
