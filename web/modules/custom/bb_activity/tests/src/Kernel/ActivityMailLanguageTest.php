<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\language\Entity\ConfigurableLanguage;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A mail is built in the recipient's preferred language.
 *
 * The product ships English only; this installs German to prove the mechanism.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class ActivityMailLanguageTest extends ActivityMailKernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'file', 'image', 'serialization', 'jsonapi',
    'language', 'locale',
    'bb_core', 'bb_activity', 'bb_activity_test',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installSchema('locale', ['locales_source', 'locales_target', 'locales_location', 'locale_file']);
    $this->installConfig(['language', 'locale']);
    ConfigurableLanguage::createFromLangcode('de')->save();
  }

  /**
   * A German recipient gets subject and body in German.
   */
  public function testGermanRecipientGetsGermanMail(): void {
    $this->translate('A test ticket event happened', 'Ein Testereignis ist eingetreten');
    $this->translate('Open the ticket: @url', 'Ticket öffnen: @url');

    $watcher = $this->recipient('a', 'watcher-de');
    $watcher->set('preferred_langcode', 'de')->save();
    $this->container->get('state')->set('bb_activity_test.ticket_event', TRUE);
    $this->tick($watcher, ['test_ticket_event']);

    $this->ticket('a')->set('state', 'plan')->save();

    $email = $this->mailsTo($watcher)[0];
    self::assertStringContainsString('Ein Testereignis ist eingetreten', (string) $email->getSubject());
    self::assertStringContainsString('Ticket öffnen: ', (string) $email->getTextBody());
  }

  /**
   * Stores one German translation.
   */
  private function translate(string $source, string $translation): void {
    $storage = $this->container->get('locale.storage');
    $string = $storage->createString(['source' => $source, 'context' => ''])->save();
    $storage->createTranslation([
      'lid' => $string->getId(),
      'language' => 'de',
      'translation' => $translation,
    ])->save();
  }

}
