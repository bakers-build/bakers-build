<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Render\Element\Search;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\Url;
use Drupal\bb_core\Access\BbActiveWorkspaceInterface;
use Drupal\bb_core\Navigation\AccountWorkspaceContext;
use Drupal\bb_core\Plugin\EntityReferenceSelection\ActiveWorkspaceSelectionBase;
use Drupal\user\AccountForm;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Form-alter hooks: shaping the entity forms and widgets, not their access.
 */
final class FormAlterHooks {

  use StringTranslationTrait;

  public function __construct(
    #[Autowire(service: 'bb_core.active_workspace')]
    private readonly BbActiveWorkspaceInterface $activeWorkspace,
    private readonly RequestStack $requestStack,
    private readonly AccountWorkspaceContext $workspaceContext,
  ) {
  }

  /**
   * Implements hook_form_FORM_ID_alter() for user_register_form.
   *
   * Core's AccountForm is not ours to subclass; sign-in runs through the
   * email connector, so no account form sets or confirms a password.
   *
   * @param array<string, mixed> $form
   *   The form to alter.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  #[Hook('form_user_register_form_alter')]
  public function formUserRegisterFormAlter(array &$form, FormStateInterface $form_state): void {
    $this->removePasswordFields($form, $form_state);
  }

  /**
   * Implements hook_form_FORM_ID_alter() for views_exposed_form.
   *
   * Puts BEF's combined "Sort by" select ahead of the filter controls (Views
   * adds sorts after filters and neither Views nor BEF exposes a weight), and
   * makes a `title` search a search field.
   *
   * @param array<string, mixed> $form
   *   The exposed form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  #[Hook('form_views_exposed_form_alter')]
  public function formViewsExposedFormAlter(array &$form, FormStateInterface $form_state): void {
    if (isset($form['sort_bef_combine'])) {
      $form['sort_bef_combine']['#weight'] = -100;
    }
    // A listing search is a search field: native clear button, search role.
    if (($form['title']['#type'] ?? NULL) === 'textfield') {
      $form['title']['#type'] = 'search';
      $form['title']['#theme'] = 'input__search';
      // The element already carries Textfield's pre-render, which would set
      // `type="text"` again; Search's own sets `type="search"`.
      foreach ($form['title']['#pre_render'] ?? [] as $delta => $callback) {
        if (is_array($callback) && ($callback[1] ?? NULL) === 'preRenderTextfield') {
          $form['title']['#pre_render'][$delta] = [Search::class, 'preRenderSearch'];
        }
      }
    }
  }

  /**
   * Removes the password elements; unset also drops their validation.
   *
   * @param array<string, mixed> $form
   *   The account form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  private function removePasswordFields(array &$form, FormStateInterface $form_state): void {
    if (!$form_state->getFormObject() instanceof AccountForm) {
      return;
    }
    unset($form['account']['pass'], $form['account']['current_pass']);
    $form_state->set('user_pass_reset', TRUE);
  }

  /**
   * Implements hook_field_widget_single_element_form_alter().
   *
   * Hands the active workspace to the entity-autocomplete ENDPOINT.
   *
   * The autocomplete endpoint is its own request without `{bb_workspace}`,
   * so the selection plugins would fall open to the whole read scope. The
   * workspace travels in `#selection_settings`, which core hashes into the
   * endpoint key. Keyed on the handler id, so any field adopting one of these
   * plugins is covered.
   *
   * @phpstan-param array<string, mixed> $element
   * @phpstan-param array<string, mixed> $context
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  #[Hook('field_widget_single_element_form_alter')]
  public function fieldWidgetSingleElementFormAlter(
    array &$element,
    FormStateInterface $form_state,
    array $context,
  ): void {
    $items = $context['items'] ?? NULL;
    if (!$items instanceof FieldItemListInterface) {
      return;
    }
    $handler = $items->getFieldDefinition()->getSetting('handler');
    if (!in_array($handler, [
      'bb_group_in_active_workspace',
      'bb_project_in_active_workspace',
      // On an add form the ticket has no project yet, so the route's
      // workspace is the assignee plugin's only source.
      'bb_assignee_in_ticket_workspace',
    ], TRUE)) {
      return;
    }
    // Only an autocomplete widget has an endpoint to hand anything to; a select
    // widget builds its options in-process and is narrowed already.
    if (!isset($element['target_id']['#selection_settings'])) {
      return;
    }
    $workspace = $this->activeWorkspace->resolve();
    if ($workspace === NULL) {
      return;
    }
    $setting = ActiveWorkspaceSelectionBase::ACTIVE_WORKSPACE_SETTING;
    $settings = &$element['target_id']['#selection_settings'];
    $settings[$setting] = (int) $workspace->id();
  }

  /**
   * Implements hook_form_FORM_ID_alter() for user_form.
   *
   * Island boost on the shell content island would turn Save into an HTMX
   * fragment POST. The profile form is a full document save: a boosted submit
   * races a following reload and the widgets paint empty even though the
   * entity wrote. Login and other gate forms already opt out the same way.
   *
   * @param array<string, mixed> $form
   *   The form to alter.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  #[Hook('form_user_form_alter')]
  public function formUserFormAlter(
    array &$form,
    FormStateInterface $form_state,
  ): void {
    $this->removePasswordFields($form, $form_state);
    $form['#attributes']['data-hx-boost'] = 'false';
    // Opened by a boosted link, core's action keeps the htmx request's
    // ajax_page_state; Save's redirect then repeats it, and a full page told
    // its libraries are loaded renders without CSS or JavaScript. Replacing
    // core's action also skips its own removal of _wrapper_format, so every
    // htmx transport key goes, as in BbContentEntityFormBase::settingsUrl().
    $query = $this->requestStack->getCurrentRequest()?->query->all() ?? [];
    unset($query['ajax_page_state'], $query['_wrapper_format'], $query['_triggering_element_name'], $query['_triggering_element_value']);
    if ($this->workspaceContext->isOwnProfile()) {
      $cache = CacheableMetadata::createFromRenderArray($form);
      $workspace = $this->workspaceContext->resolve($cache);
      unset($query['workspace']);
      if ($workspace !== NULL) {
        $query['workspace'] = $workspace->uuid();
      }
      $form['#cache']['contexts'] = $cache->getCacheContexts();
      $form['#cache']['tags'] = $cache->getCacheTags();
      $form['#cache']['max-age'] = $cache->getCacheMaxAge();
    }
    $form['#action'] = Url::fromRoute('<current>', [], ['query' => $query])->toString();

    // Same AI-use notice the onboarding wizard shows, repeated verbatim so
    // the string extractor sees a literal here too. Weight 3 sits right after
    // full name, account and picture (display weights 0-2). Whether the
    // nickname is editable here is core's `change own username` permission,
    // which `authenticated` carries.
    if (isset($form['field_developer_title']) || isset($form['field_bb_background'])) {
      $form['bb_ai_use_notice'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:note',
        '#props' => ['tone' => 'attention'],
        '#slots' => [
          'body' => [
            [
              '#plain_text' => $this->t('bakers.build passes these details as context to the AI assistants it uses, so that explanations and support match your background and your goals. You can change or delete them later.'),
            ],
          ],
        ],
        '#weight' => 3,
      ];
    }
  }

  /**
   * Implements hook_element_info_alter().
   *
   * All bakers.build text is Markdown in one format, so core's format help and
   * guidelines below every text_format widget only mislead.
   *
   * @param array<string, array<string, mixed>> $info
   *   The element type defaults.
   */
  #[Hook('element_info_alter')]
  public function elementInfoAlter(array &$info): void {
    if (isset($info['text_format'])) {
      $info['text_format']['#process'][] = [self::class, 'hideFormatHelp'];
    }
  }

  /**
   * Hides the format help and guidelines of a processed text_format element.
   *
   * @param array<string, mixed> $element
   *   The text_format element, after core's processFormat().
   *
   * @return array<string, mixed>
   *   The element.
   */
  public static function hideFormatHelp(array $element): array {
    foreach (['help', 'guidelines'] as $key) {
      if (isset($element['format'][$key])) {
        $element['format'][$key]['#access'] = FALSE;
      }
    }
    return $element;
  }

}
