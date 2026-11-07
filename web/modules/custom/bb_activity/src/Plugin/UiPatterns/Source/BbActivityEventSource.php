<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Language\LanguageManagerInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_activity\Activity\ActivityKindManager;
use Drupal\bb_activity\Activity\FeedMessage;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\bb_core\Time\BbDate;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * One persisted activity as a `bb_theme:event` row with a structured lead.
 *
 * Passes data only: subject, statement, facts and links, never markup. The
 * row's activity kind words its tag and statement; run, conductor and comment
 * details appear only when their field is viewable.
 */
#[Source(
  id: 'bb_activity_event',
  label: new TranslatableMarkup('[bakers.build] Activity event'),
  description: new TranslatableMarkup('Who, which event and its result with links for one activity row.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_activity', label: new TranslatableMarkup('Activity'), required: TRUE),
  ],
)]
final class BbActivityEventSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  use PersonIdentityTrait;

  /**
   * Formats the relative created stamp and the run duration.
   */
  protected BbDate $date;

  /**
   * Words each row through its activity kind.
   */
  protected ActivityKindManager $kinds;

  /**
   * The reader the kind words the line for.
   */
  protected AccountInterface $currentUser;

  /**
   * The reader's interface language.
   */
  protected LanguageManagerInterface $languageManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->date = $container->get(BbDate::class);
    $instance->kinds = $container->get('plugin.manager.bb_activity_kind');
    $instance->currentUser = $container->get('current_user');
    $instance->languageManager = $container->get('language_manager');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $activity = $this->activity();
    if ($activity === NULL || $activity->isNew() || !$activity->access('view')) {
      return [];
    }
    $cache = new CacheableMetadata();
    $cache->addCacheableDependency($activity)->addCacheContexts(['user']);
    $run = $this->related($activity, 'run_id', $cache);
    $run = $run instanceof BbRunInterface ? $run : NULL;
    $line = $this->line($activity);
    $face = $this->face($activity, $run, $cache);
    $props = [
      'author_name' => $face['name'],
      'author_initials' => $face['initials'],
      'author_color' => $face['color'],
      'tag' => $line['tag'],
      'statement' => $line['statement'],
      'detail' => $line['detail'] ?? '',
    ] + $this->when($activity, $cache) + $this->ticket($activity, $cache) + $this->runProps($activity, $line, $run, $cache);
    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:event',
      '#props' => array_filter($props, static fn (string|array $value): bool => $value !== '' && $value !== []),
    ];
    $cache->applyTo($build);
    return $build;
  }

  /**
   * The kind's own line, or the stored kind when its plugin is gone.
   *
   * @return array{tag: string, statement: string, role?: string, detail?: string, duration?: bool, comment_link?: string}
   *   The feed line.
   */
  private function line(BbActivity $activity): array {
    $langcode = $this->languageManager->getCurrentLanguage()->getId();
    foreach ($this->kinds->forActivity($activity)?->messages($activity, $this->currentUser, $langcode) ?? [] as $message) {
      if ($message instanceof FeedMessage) {
        return $message->toLine();
      }
    }
    $id = (string) ($activity->get('kind')->value ?? '');
    return ['tag' => $id, 'statement' => $id];
  }

  /**
   * Role, harness, conductor and duration facts, comment and run links.
   *
   * @param \Drupal\bb_activity\Entity\BbActivity $activity
   *   The row.
   * @param array{tag: string, statement: string, role?: string, detail?: string, duration?: bool, comment_link?: string} $line
   *   The kind's feed line.
   * @param \Drupal\bb_core\Entity\BbRunInterface|null $run
   *   The row's run when viewable.
   * @param \Drupal\Core\Cache\CacheableMetadata $cache
   *   Collects access metadata.
   *
   * @return array{role?: string, facts?: list<string>, links?: list<array{title: string, url: string}>}
   *   The props that apply.
   */
  private function runProps(BbActivity $activity, array $line, ?BbRunInterface $run, CacheableMetadata $cache): array {
    $props = [];
    // The role follows the stored reference, not the reader's run access.
    if (!$activity->get('run_id')->isEmpty()) {
      $props['role'] = 'agent';
    }
    elseif (isset($line['role'])) {
      $props['role'] = $line['role'];
    }
    $facts = $this->facts($activity, $line, $run, $cache);
    if ($facts !== []) {
      $props['facts'] = $facts;
    }
    $links = $this->links($activity, $line, $run, $cache);
    if ($links !== []) {
      $props['links'] = $links;
    }
    return $props;
  }

  /**
   * Harness, conductor and duration of the row.
   *
   * @param \Drupal\bb_activity\Entity\BbActivity $activity
   *   The row.
   * @param array{tag: string, statement: string, role?: string, detail?: string, duration?: bool, comment_link?: string} $line
   *   The kind's feed line.
   * @param \Drupal\bb_core\Entity\BbRunInterface|null $run
   *   The row's run when viewable.
   * @param \Drupal\Core\Cache\CacheableMetadata $cache
   *   Collects access metadata.
   *
   * @return list<string>
   *   The facts that apply.
   */
  private function facts(BbActivity $activity, array $line, ?BbRunInterface $run, CacheableMetadata $cache): array {
    $facts = [];
    $harness = trim((string) ($run?->get('harness')->value ?? ''));
    if ($harness !== '' && trim((string) $run->get('model')->value) !== '') {
      $facts[] = $harness;
    }
    $conductor = $this->related($activity, 'conductor_id', $cache);
    if ($conductor !== NULL) {
      $facts[] = (string) $conductor->label();
    }
    $duration = !empty($line['duration']) && $run !== NULL ? $this->duration($activity, $run) : '';
    if ($duration !== '') {
      $facts[] = $duration;
    }
    return $facts;
  }

  /**
   * The links to the row's comment and run.
   *
   * @param \Drupal\bb_activity\Entity\BbActivity $activity
   *   The row.
   * @param array{tag: string, statement: string, role?: string, detail?: string, duration?: bool, comment_link?: string} $line
   *   The kind's feed line.
   * @param \Drupal\bb_core\Entity\BbRunInterface|null $run
   *   The row's run when viewable.
   * @param \Drupal\Core\Cache\CacheableMetadata $cache
   *   Collects access metadata.
   *
   * @return list<array{title: string, url: string}>
   *   The links that apply.
   */
  private function links(BbActivity $activity, array $line, ?BbRunInterface $run, CacheableMetadata $cache): array {
    $links = [];
    $comment = $this->related($activity, 'comment_id', $cache);
    if ($comment !== NULL) {
      $links[] = [
        'title' => $line['comment_link'] ?? (string) $this->t('Summary'),
        'url' => $comment->toUrl()->toString(),
      ];
    }
    if ($run !== NULL) {
      $links[] = ['title' => (string) $this->t('Run'), 'url' => $run->toUrl()->toString()];
    }
    return $links;
  }

  /**
   * A related entity when its field is viewable, recording access metadata.
   */
  private function related(BbActivity $activity, string $field, CacheableMetadata $cache): ?EntityInterface {
    $items = $activity->get($field);
    if ($items->isEmpty()) {
      return NULL;
    }
    $access = $items->access('view', NULL, TRUE);
    $cache->addCacheableDependency($access);
    $entity = $access->isAllowed() ? $items->entity : NULL;
    if ($entity instanceof EntityInterface) {
      $cache->addCacheableDependency($entity);
    }
    return $entity;
  }

  /**
   * The row's face: the run's agent, else the actor, else System.
   *
   * @return array{name: string, initials: string, color: string}
   *   Author props.
   */
  private function face(BbActivity $activity, ?BbRunInterface $run, CacheableMetadata $cache): array {
    $agent = trim((string) ($run?->get('model')->value ?: $run?->get('harness')->value ?: $run?->get('agent')->value ?? ''));
    if ($agent !== '') {
      return ['name' => $agent, 'initials' => $this->personInitials($agent), 'color' => 'running'];
    }
    $actor = $this->related($activity, 'actor', $cache);
    if (!$actor instanceof UserInterface) {
      return ['name' => (string) $this->t('System'), 'initials' => 'SY', 'color' => 'offline'];
    }
    $name = $this->personDisplayName($actor);
    return [
      'name' => $name,
      'initials' => $this->personInitials($name),
      'color' => $this->personColor((int) $actor->id()),
    ];
  }

  /**
   * Ticket identifier and URL.
   *
   * @return array<string, string>
   *   The subject_label and, when viewable, subject_url props.
   */
  private function ticket(BbActivity $activity, CacheableMetadata $cache): array {
    $ticket = $activity->get('ticket_id')->entity;
    if (!$ticket instanceof BbTicketInterface) {
      return ['subject_label' => (string) $this->t('A ticket')];
    }
    $cache->addCacheableDependency($ticket);
    $label = $ticket->getIdentifier();
    return [
      'subject_label' => $label !== '' ? $label : (string) $this->t('A ticket'),
      'subject_url' => $ticket->access('view') ? $ticket->toUrl()->toString() : '',
    ];
  }

  /**
   * How long the row's run took, or empty when unknown.
   */
  private function duration(BbActivity $activity, BbRunInterface $run): string {
    $seconds = (int) ($run->get('duration_s')->value ?? 0);
    $started = (int) ($run->get('started_at')->value ?? 0);
    if ($seconds <= 0 && $started > 0) {
      $seconds = (int) $activity->getCreatedTime() - $started;
    }
    return $seconds > 0 ? $this->date->duration($seconds) : '';
  }

  /**
   * The created time props, or none when the stamp is missing.
   *
   * @return array{timestamp?: string, datetime?: string, timestamp_title?: string}
   *   The event's time props; a relative label's max-age joins $cache.
   */
  private function when(BbActivity $activity, CacheableMetadata $cache): array {
    $timestamp = (int) $activity->getCreatedTime();
    if ($timestamp <= 0) {
      return [];
    }
    $time = $this->date->time($timestamp);
    if (isset($time['#cache']['max-age'])) {
      $cache->mergeCacheMaxAge($time['#cache']['max-age']);
    }
    return [
      'timestamp' => $time['#props']['label'],
      'datetime' => $time['#props']['datetime'],
      'timestamp_title' => $time['#props']['title'],
    ];
  }

  /**
   * The activity context, if present.
   */
  private function activity(): ?BbActivity {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    return $entity instanceof BbActivity ? $entity : NULL;
  }

}
