<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Component\Utility\Crypt;
use Drupal\Core\Access\CsrfTokenGenerator;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Url;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * An explicit-Save form that never overwrites concurrent edits.
 *
 * The opening values travel as a signed snapshot bound to the entity, the
 * operation, the form build and the visitor's session. On POST the entity is
 * loaded fresh and only the fields changed against that snapshot are applied,
 * each re-checked for update and field edit access. The POST swaps this form
 * only, so sibling forms on the page keep their unsent input.
 *
 * A form that autosaves submits on every pick and keeps Save only without
 * JavaScript. It refuses a changed field whose stored value no longer matches
 * the snapshot, writing nothing; changes to other fields still merge.
 */
abstract class BbPropertyFormBase extends ContentEntityForm implements ReadOnlyEntityFormInterface {

  /**
   * The current entity.
   *
   * @var \Drupal\Core\Entity\ContentEntityInterface
   */
  protected $entity;

  /**
   * Authenticates the opening values without caching a form on a safe GET.
   */
  protected CsrfTokenGenerator $csrfToken;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->csrfToken = $container->get('csrf_token');
    return $form;
  }

  /**
   * The read-only rendering for a visitor without update access.
   *
   * @return array<string, mixed>
   *   A render array.
   */
  abstract protected function readOnly(): array;

  /**
   * Whether this form edits anything; a form that does not only shows values.
   */
  protected function editsFields(): bool {
    return TRUE;
  }

  /**
   * Whether each pick saves itself, refusing a field changed meanwhile.
   */
  protected function autosaves(): bool {
    return FALSE;
  }

  /**
   * The route this form posts to.
   */
  protected function postUrl(): Url {
    return Url::fromRoute(
      'entity.' . $this->entity->getEntityTypeId() . '.' . $this->getOperation() . '_form',
      $this->entity->toUrl()->getRouteParameters(),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    if (!$this->entity->access('view')) {
      throw new AccessDeniedHttpException();
    }
    $access = $this->entity->access('update', NULL, TRUE);
    $cache = CacheableMetadata::createFromObject($this->entity)
      ->addCacheableDependency($access)->addCacheContexts(['user', 'route'])
      ->addCacheTags(['og_membership_list'])->setCacheMaxAge(0);
    foreach ($this->entity->getFields() as $items) {
      $cache->addCacheableDependency($items->access('view', NULL, TRUE));
    }
    if (!$access->isAllowed() || !$this->editsFields()) {
      if ($this->getRequest()->isMethod('POST')) {
        throw new AccessDeniedHttpException();
      }
      $form['readonly'] = $this->readOnly();
      $cache->applyTo($form);
      return $form;
    }

    // Drupal forbids form-state caching on GET. Only the displayed properties
    // travel as an opaque signed snapshot; JavaScript never interprets them.
    if (!$form_state->has('property_baseline')) {
      $form_state->set('property_baseline', clone $this->entity);
    }
    if (!$form_state->has('property_build_id')) {
      $build_id = 'form-' . Crypt::randomBytesBase64();
      if ($this->getRequest()->isMethod('POST')) {
        $this->openingSnapshot($form_state);
        $build_id = $form_state->getUserInput()['form_build_id'];
      }
      $form_state->set('property_build_id', $build_id);
    }
    $form['#build_id'] = $form_state->get('property_build_id');
    // The snapshot is signed with this build id. A rebuild without a save (an
    // image upload or removal) keeps it, or the next Save would be refused.
    $form_state->addRebuildInfo('copy', ['#build_id' => TRUE]);
    $form = parent::form($form, $form_state);
    $payload = $this->baselinePayload($form_state);
    $form['property_baseline'] = ['#type' => 'hidden', '#default_value' => $payload];
    $form['property_signature'] = [
      '#type' => 'hidden',
      '#default_value' => $this->csrfToken->get($this->baselineKey($payload, $form['#build_id'])),
    ];
    unset($form['footer']);
    $url = $this->postUrl();
    $form['#action'] = $url->toString();
    // An explicit Save: nothing changes until Save. The POST swaps this form
    // only; a second Save while one is in flight is dropped, not queued.
    $form['#attributes']['data-form-save'] = '';
    $form['#attached']['library'][] = 'bb_core/form_save';
    (new Htmx())->post($url)->onlyMainContent()->swap('outerHTML ignoreTitle:true')
      ->trigger('submit')->applyTo($form);
    $form['#attributes']['data-hx-target'] = 'this';
    $form['#attributes']['data-hx-select'] = 'form[data-form-save]';
    $form['#attributes']['data-hx-sync'] = 'this:drop';
    $form['#attributes']['data-hx-push-url'] = 'false';
    $form['#attributes']['data-hx-select-oob'] = 'unset';
    // Filled by form-save.js only when the request itself fails; a completed
    // save or a validation error reports through the messages below.
    $form['save_status'] = [
      '#type' => 'html_tag',
      '#tag' => 'span',
      '#attributes' => ['role' => 'alert', 'hidden' => 'hidden', 'data-form-save-status' => ''],
      '#value' => '',
      '#weight' => -1001,
    ];
    $form['messages'] = ['#type' => 'status_messages', '#weight' => -1000];
    $cache->merge(CacheableMetadata::createFromRenderArray($form))->applyTo($form);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    $actions = parent::actions($form, $form_state);
    unset($actions['delete']);
    $actions['submit']['#value'] = $this->t('Save');
    $actions['submit']['#access'] = $this->entity->access('update');
    if ($this->autosaves()) {
      // Core's js-hide: Save stays the fallback without JavaScript only.
      $actions['#attributes']['class'][] = 'js-hide';
    }
    return $actions;
  }

  /**
   * {@inheritdoc}
   */
  public function buildEntity(array $form, FormStateInterface $form_state): ContentEntityInterface {
    $type = $this->entity->getEntityTypeId();
    $route_entity = $this->getRouteMatch()->getParameter($type);
    if ($route_entity instanceof EntityInterface && $route_entity->id() !== $this->entity->id()) {
      throw new AccessDeniedHttpException();
    }
    $entity = $this->entityTypeManager->getStorage($type)->loadUnchanged($this->entity->id());
    if (!$entity instanceof ContentEntityInterface) {
      throw new NotFoundHttpException();
    }
    $this->entity = $entity;
    $built = parent::buildEntity($form, $form_state);
    assert($built instanceof ContentEntityInterface);
    return $built;
  }

  /**
   * Extracts only configured widgets and merges their changes onto fresh data.
   */
  protected function copyFormValuesToEntity(EntityInterface $entity, array $form, FormStateInterface $form_state): void {
    assert($entity instanceof ContentEntityInterface);
    $submitted = clone $entity;
    $display = $this->getFormDisplay($form_state);
    $extracted = $display->extractFormValues($submitted, $form, $form_state);
    $baseline = $form_state->get('property_baseline');
    if ($this->getRequest()->isMethod('POST') && !$form_state->has('property_saved')) {
      $snapshot = $this->openingSnapshot($form_state);
      $baseline = clone $entity;
      foreach (array_intersect_key($snapshot, $display->getComponents()) as $field => $values) {
        $baseline->set($field, $values);
      }
    }
    $changed = [];
    foreach (array_keys($extracted) as $field) {
      if ($baseline !== NULL && $submitted->get($field)->equals($baseline->get($field))) {
        continue;
      }
      if (!$entity->access('update') || !$entity->get($field)->access('edit')) {
        throw new AccessDeniedHttpException();
      }
      if ($this->changedMeanwhile($entity, $baseline, $field)) {
        $form_state->setErrorByName($field, $this->t('Someone changed this meanwhile. The page shows their value.'));
        continue;
      }
      $entity->set($field, $submitted->get($field)->getValue());
      $changed[] = $field;
    }
    $form_state->set('property_changed', $changed);
  }

  /**
   * Whether an autosaving form's field was stored anew since its snapshot.
   */
  private function changedMeanwhile(ContentEntityInterface $stored, ?ContentEntityInterface $baseline, string $field): bool {
    return $this->autosaves() && $baseline !== NULL && !$stored->get($field)->equals($baseline->get($field));
  }

  /**
   * Verifies the original submitted snapshot before using any opening values.
   *
   * @return array<string, array<int, array<string, mixed>>>
   *   Only the configured fields rendered when this form was opened.
   */
  private function openingSnapshot(FormStateInterface $form_state): array {
    $input = $form_state->getUserInput();
    $payload = $input['property_baseline'] ?? NULL;
    $signature = $input['property_signature'] ?? NULL;
    $build_id = $input['form_build_id'] ?? NULL;
    if (!is_string($payload) || strlen($payload) > 16384 || !is_string($signature)
      || !is_string($build_id) || strlen($build_id) > 128
      || !$this->csrfToken->validate($signature, $this->baselineKey($payload, $build_id))) {
      throw new AccessDeniedHttpException();
    }
    $json = base64_decode(strtr($payload, '-_', '+/'), TRUE);
    if ($json === FALSE) {
      throw new AccessDeniedHttpException();
    }
    return json_decode($json, TRUE, 16, JSON_THROW_ON_ERROR);
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): EntityInterface {
    if (!$this->entity->access('update')) {
      throw new AccessDeniedHttpException();
    }
    $entity = parent::validateForm($form, $form_state);
    if ($this->autosaves() && $form_state->getErrors()) {
      // The answer shows the stored values; the next pick compares with them.
      $form_state->set('property_baseline', clone $this->entity);
      $payload = $this->baselinePayload($form_state);
      $form['property_baseline']['#value'] = $payload;
      $form['property_signature']['#value'] = $this->csrfToken->get($this->baselineKey($payload, $form['#build_id']));
    }
    return $entity;
  }

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $form_state): int {
    if (!$this->entity->access('update')) {
      throw new AccessDeniedHttpException();
    }
    $result = $this->entity->save();
    // The same wording Settings uses, rendered by this form's own messages.
    $this->messenger()->addStatus($this->t('@type %label saved.', [
      '@type' => $this->entity->getEntityType()->getLabel(),
      '%label' => $this->entity->label() ?? $this->entity->id(),
    ]));
    $form_state->set('property_baseline', clone $this->entity);
    // The fields this save wrote. From now on the baseline lives here.
    $form_state->set('property_saved', $form_state->get('property_changed') ?? []);
    $form_state->setUserInput([]);
    // A later Save belongs to this same form, not a new editor's snapshot.
    // Core caches this successful POST continuation, never the opening GET.
    $form_state->addRebuildInfo('copy', ['#build_id' => TRUE]);
    $form_state->setRebuild();
    return $result;
  }

  /**
   * Binds a snapshot to its entity, operation, and the visitor's CSRF session.
   */
  private function baselineKey(string $payload, string $build_id): string {
    return $this->entity->getEntityTypeId() . '.' . $this->getOperation() . ':'
      . $this->entity->uuid() . ':' . $build_id . ':' . $payload;
  }

  /**
   * Serializes only configured properties whose values the visitor may read.
   *
   * URL-safe base64 of the JSON: the hidden input carries no markup or
   * entity characters a theme could filter, so the signed bytes come back.
   */
  private function baselinePayload(FormStateInterface $form_state): string {
    $snapshot = [];
    foreach (array_keys($this->getFormDisplay($form_state)->getComponents()) as $field) {
      if ($this->entity->hasField($field) && $this->entity->get($field)->access('view')) {
        $snapshot[$field] = $form_state->get('property_baseline')->get($field)->getValue();
      }
    }
    return strtr(base64_encode(json_encode($snapshot, JSON_THROW_ON_ERROR)), '+/', '-_');
  }

}
