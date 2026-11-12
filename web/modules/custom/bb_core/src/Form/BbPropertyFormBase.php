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
use Drupal\Core\Lock\LockBackendInterface;
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
 *
 * One object owns the snapshot, the refusal and the locked write: split up,
 * a check would sit apart from the write it guards.
 *
 * @SuppressWarnings("PHPMD.ExcessiveClassComplexity")
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
   * Serializes the autosaving check-and-write of one entity.
   */
  protected LockBackendInterface $lock;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->csrfToken = $container->get('csrf_token');
    $form->lock = $container->get('lock');
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
    $baseline = $this->comparedBaseline($entity, $form_state);
    $changed = [];
    $kept = [];
    foreach (array_keys($extracted) as $field) {
      if ($baseline !== NULL && $submitted->get($field)->equals($baseline->get($field))) {
        continue;
      }
      if (!$entity->access('update') || !$entity->get($field)->access('edit')) {
        throw new AccessDeniedHttpException();
      }
      // Stored already, by someone else: nothing to write, nothing to refuse.
      if ($submitted->get($field)->equals($entity->get($field))) {
        $kept[] = $field;
        continue;
      }
      if ($this->refusedAsStale($entity, $baseline, $field, $form_state)) {
        continue;
      }
      $entity->set($field, $submitted->get($field)->getValue());
      $changed[] = $field;
    }
    $form_state->set('property_changed', $changed);
    $form_state->set('property_kept', $kept);
    $form_state->setTemporaryValue('property_compared', $baseline);
  }

  /**
   * The values the submitted ones are compared with.
   *
   * The signed opening snapshot on a form's first POST; the baseline this
   * form state keeps from then on.
   */
  private function comparedBaseline(ContentEntityInterface $entity, FormStateInterface $form_state): ?ContentEntityInterface {
    if (!$this->getRequest()->isMethod('POST') || $form_state->has('property_saved')) {
      return $form_state->get('property_baseline');
    }
    $baseline = clone $entity;
    $components = $this->getFormDisplay($form_state)->getComponents();
    foreach (array_intersect_key($this->openingSnapshot($form_state), $components) as $field => $values) {
      $baseline->set($field, $values);
    }
    return $baseline;
  }

  /**
   * Whether validation refuses a field someone stored anew since the snapshot.
   *
   * After validation save() checks again under its lock, so this is false.
   */
  private function refusedAsStale(ContentEntityInterface $stored, ?ContentEntityInterface $baseline, string $field, FormStateInterface $form_state): bool {
    if ($form_state->isValidationComplete() || !$this->changedMeanwhile($stored, $baseline, $field)) {
      return FALSE;
    }
    $form_state->setErrorByName($field, $this->refusal());
    return TRUE;
  }

  /**
   * Whether an autosaving form's field was stored anew since its snapshot.
   */
  private function changedMeanwhile(ContentEntityInterface $stored, ?ContentEntityInterface $baseline, string $field): bool {
    return $this->autosaves() && $baseline !== NULL && !$stored->get($field)->equals($baseline->get($field));
  }

  /**
   * The copy of a pick refused because someone changed the field meanwhile.
   */
  private function refusal(): string {
    return (string) $this->t('Someone changed this meanwhile. The page shows their value.');
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
    assert($entity instanceof ContentEntityInterface);
    $this->validateProperties($entity, $form_state);
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
   * Further rules for the built entity; their errors refuse it like any other.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  protected function validateProperties(ContentEntityInterface $entity, FormStateInterface $form_state): void {
  }

  /**
   * {@inheritdoc}
   *
   * An autosaving form checks the changed fields again under a lock and
   * writes them onto the entity as stored now. A field someone saved after
   * validation is refused at the field and nothing is written; the answer
   * then shows the stored entity and returns 0.
   */
  public function save(array $form, FormStateInterface $form_state): int {
    if (!$this->entity->access('update')) {
      throw new AccessDeniedHttpException();
    }
    if (!$this->autosaves()) {
      return $this->write($form_state, TRUE);
    }
    $announce = !$this->getRequest()->headers->has('HX-Request');
    if (($form_state->get('property_changed') ?? []) === []) {
      // Nothing to write: no lock and no save. Save without JavaScript is
      // still confirmed.
      $this->confirm($announce);
      $this->answer($form_state, $form_state->get('property_kept') ?? [], []);
      return 0;
    }
    $type = $this->entity->getEntityTypeId();
    $lock = 'bb_property:' . $type . ':' . $this->entity->id();
    $locked = $this->lock->acquire($lock) || (!$this->lock->wait($lock) && $this->lock->acquire($lock));
    try {
      $stored = $this->entityTypeManager->getStorage($type)->loadUnchanged($this->entity->id());
      assert($stored instanceof ContentEntityInterface);
      $changed = $form_state->get('property_changed') ?? [];
      $baseline = $form_state->getTemporaryValue('property_compared');
      // Without the lock someone is saving this entity right now: refuse all.
      $stale = $locked ? array_filter($changed, fn (string $field): bool => $this->changedMeanwhile($stored, $baseline, $field)) : $changed;
      if ($stale !== []) {
        $this->entity = $stored;
        $this->answer($form_state, [], array_fill_keys($stale, $this->refusal()));
        return 0;
      }
      // Onto the entity as stored now, so another field saved meanwhile stays.
      foreach ($changed as $field) {
        $stored->set($field, $this->entity->get($field)->getValue());
      }
      $this->entity = $stored;
      return $this->write($form_state, $announce);
    }
    finally {
      if ($locked) {
        $this->lock->release($lock);
      }
    }
  }

  /**
   * Saves the entity and answers with the rebuilt form.
   *
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   * @param bool $announce
   *   Whether a status message confirms the save; an autosaving answer says
   *   "Saved" at the field instead.
   */
  private function write(FormStateInterface $form_state, bool $announce): int {
    $result = $this->entity->save();
    $this->confirm($announce);
    $saved = array_merge($form_state->get('property_changed') ?? [], $form_state->get('property_kept') ?? []);
    $this->answer($form_state, $saved, []);
    return $result;
  }

  /**
   * Confirms the save with a status message, when it is announced.
   */
  private function confirm(bool $announce): void {
    if ($announce) {
      // The same wording Settings uses, rendered by this form's own messages.
      $this->messenger()->addStatus($this->t('@type %label saved.', [
        '@type' => $this->entity->getEntityType()->getLabel(),
        '%label' => $this->entity->label() ?? $this->entity->id(),
      ]));
    }
  }

  /**
   * Rebuilds the form on the current entity as the answer to this POST.
   *
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   * @param array<string> $saved
   *   The fields that now hold what was picked.
   * @param array<string, string> $refused
   *   Messages of the fields refused after validation, keyed by field.
   */
  private function answer(FormStateInterface $form_state, array $saved, array $refused): void {
    $form_state->set('property_baseline', clone $this->entity);
    // From now on the baseline lives here.
    $form_state->set('property_saved', $saved);
    $form_state->set('property_refused', $refused);
    // The answer shows the entity, not the submitted values a refusal kept out.
    $form_state->setUserInput([]);
    $form_state->setValues([]);
    // A later Save belongs to this same form, not a new editor's snapshot.
    // Core caches this successful POST continuation, never the opening GET.
    $form_state->addRebuildInfo('copy', ['#build_id' => TRUE]);
    $form_state->setRebuild();
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
