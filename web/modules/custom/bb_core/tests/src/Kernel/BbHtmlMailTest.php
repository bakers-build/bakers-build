<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Mail\Plugin\Mail\SymfonyMailer;
use Drupal\Core\Render\Markup;
use Drupal\Core\Render\RendererInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Plugin\Mail\BbHtmlMail;
use PHPUnit\Framework\Attributes\Group;
use Psr\Log\LoggerInterface;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mime\Email;

/**
 * Every application mail is sent as branded HTML with a text alternative.
 */
#[Group('bb_core')]
final class BbHtmlMailTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'file', 'image', 'bb_core', 'bb_login',
    'mail_html_test', 'mail_cancel_test',
  ];

  /**
   * Collects what the plugin hands to the transport.
   */
  private CollectingMailer $transport;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['system', 'user']);
    // KernelTestBase forces the collector backend through a settings
    // override; route through the production default instead.
    $GLOBALS['config']['system.mail']['interface']['default'] = 'bb_html_mail';
    $this->config('system.mail')->set('interface.default', 'bb_html_mail')->save();
    $this->config('system.site')
      ->set('name', 'Acme "Ops" & Co')
      ->set('mail', 'noreply@example.com')
      ->save();
    $this->container->get('config.factory')->reset();
    // The product's rewritten bodies carry the login code; mirror that.
    $this->config('user.mail')
      ->set('password_reset.body', "Enter this code:\n\n[bakers:login-code]\n\nOr open [user:one-time-login-url]")
      ->set('register_no_approval_required.body', "Enter this code:\n\n[bakers:login-code]\n\nOr open [bakers:login-url]")
      ->save();

    $this->transport = new CollectingMailer();
    $plugin = $this->container->get('plugin.manager.mail')
      ->getInstance(['module' => 'bb_core', 'key' => 'invite']);
    self::assertInstanceOf(BbHtmlMail::class, $plugin);
    $this->injectTransport($plugin);
  }

  /**
   * The invitation is branded HTML whose link is the exact join URL.
   */
  public function testInvitationIsBrandedHtmlWithItsExactLink(): void {
    $url = 'https://bakers.example.com/user/login?destination=%2Facme%2Fjoin%2F7&x=1&y=(2)#frag';
    $result = $this->container->get('plugin.manager.mail')->mail('bb_core', 'invite', 'Invitee <invitee@example.com>', 'en', [
      'workspace_label' => '<script>alert(1)</script> Acme',
      'inviter_label' => 'Eve',
      'validity_days' => 7,
      'join_url' => $url,
    ]);

    self::assertTrue($result['result']);
    $email = $this->onlySent();
    self::assertStringContainsString('multipart/alternative', $email->toString());
    self::assertStringContainsString('Accept invitation: ' . $url, (string) $email->getTextBody());
    self::assertStringContainsString('<script>alert(1)</script> Acme', (string) $email->getTextBody());

    $html = (string) $email->getHtmlBody();
    self::assertStringNotContainsString('<script>', $html);
    $dom = $this->dom($html);
    self::assertSame('en', $dom->documentElement->getAttribute('lang'));
    // The closing link becomes the button; only the text part spells it out.
    self::assertSame([$url], $this->hrefs($dom));
    self::assertStringContainsString('Accept invitation', $dom->textContent);
    // The `# ` line is the heading; the subject keeps the product name.
    self::assertSame("You're invited", trim((string) $dom->getElementsByTagName('h1')->item(0)?->textContent));
    self::assertStringStartsWith("You're invited\n\n", (string) $email->getTextBody());
    self::assertStringNotContainsString('# ', (string) $email->getTextBody());
    self::assertStringStartsWith('<!DOCTYPE html>', $html);
    $logo = $dom->getElementsByTagName('img')->item(0);
    self::assertInstanceOf(\DOMElement::class, $logo);
    self::assertSame('bakers.build', $logo->getAttribute('alt'));
    self::assertStringStartsWith('cid:', $logo->getAttribute('src'));
    self::assertSame(['bakers-lockup-invite.png'], $this->lockups($email));
    self::assertStringContainsString('multipart/related', $email->toString());
    self::assertStringContainsString('Need a hand? Contact your workspace administrator.', $dom->textContent);
    self::assertStringContainsString('<script>alert(1)</script> Acme', $dom->textContent);
    self::assertSame('Join <script>alert(1)</script> Acme on bakers.build', $email->getSubject());
    self::assertSame('invitee@example.com', $email->getTo()[0]->getAddress());
    self::assertSame('Acme "Ops" & Co', $email->getFrom()[0]->getName());
  }

  /**
   * An existing account's sign-in mail keeps its code and deep link.
   */
  public function testExistingAccountSignInKeepsCodeAndDestination(): void {
    $this->createUser([], 'ada', FALSE, ['mail' => 'ada@example.com']);
    $destination = '/acme/tickets?state=open&sort=-changed#top';
    $this->container->get('bb_login.email_login')->requestLoginLink('ada@example.com', $destination);

    $email = $this->onlySent();
    $text = (string) $email->getTextBody();
    self::assertMatchesRegularExpression('/Enter this code:\n\n\d{6}\n/', $text);
    preg_match('#https?://\S+/user/reset/\S+#', $text, $match);
    $link = $match[0] ?? '';
    self::assertStringEndsWith('/login?destination=' . rawurlencode($destination), $link);

    $dom = $this->dom((string) $email->getHtmlBody());
    self::assertSame([$link], $this->hrefs($dom));
    self::assertSame(['bakers-lockup-hi.png'], $this->lockups($email));
    preg_match('/Enter this code:\n\n(\d{6})/', $text, $code);
    $boxed = [];
    foreach ($dom->getElementsByTagName('td') as $cell) {
      if (trim($cell->textContent) === ($code[1] ?? 'missing')) {
        $boxed[] = $cell;
      }
    }
    self::assertCount(1, $boxed, 'The code is set apart in its own cell.');
  }

  /**
   * A new address's pending sign-up mail is sent through the envelope.
   */
  public function testPendingSignUpUsesTheEnvelope(): void {
    $this->container->get('bb_login.email_login')->requestLoginLink('new@example.com');

    $email = $this->onlySent();
    $text = (string) $email->getTextBody();
    self::assertMatchesRegularExpression('/Enter this code:\n\n\d{6}\n/', $text);
    preg_match('#https?://\S+#', $text, $match);
    self::assertSame([$match[0] ?? ''], $this->hrefs($this->dom((string) $email->getHtmlBody())));
  }

  /**
   * Every core account mail key is sent as HTML plus text.
   */
  public function testEveryAccountMailIsSentThroughTheEnvelope(): void {
    $account = $this->createUser([], 'grace', FALSE, ['mail' => 'grace@example.com']);
    $keys = array_keys(array_filter(
      $this->config('user.mail')->getRawData(),
      static fn ($value): bool => is_array($value) && isset($value['subject'], $value['body']),
    ));
    self::assertContains('status_blocked', $keys);

    $manager = $this->container->get('plugin.manager.mail');
    foreach ($keys as $key) {
      $manager->mail('user', $key, 'grace@example.com', 'en', ['account' => $account]);
    }

    self::assertCount(count($keys), $this->sent());
    foreach ($this->sent() as $index => $email) {
      self::assertNotSame('', trim((string) $email->getTextBody()), $keys[$index]);
      $dom = $this->dom((string) $email->getHtmlBody());
      self::assertStringContainsString((string) $email->getSubject(), $dom->textContent, $keys[$index]);
    }
  }

  /**
   * An unrelated module's trusted markup keeps its readable text and link.
   */
  public function testUnrelatedSenderMarkupKeepsTextAndLink(): void {
    $url = 'https://docs.example.com/a?b=1&c=2#part';
    $this->container->get('plugin.manager.mail')->mail('mail_html_test', 'render_from_message_param', 'reader@example.com', 'en', [
      'message' => ['#markup' => Markup::create('<p>Read the <a href="' . htmlspecialchars($url) . '">guide</a>.</p>')],
    ]);

    $email = $this->onlySent();
    $text = (string) $email->getTextBody();
    self::assertStringContainsString('guide [1]', $text);
    self::assertStringContainsString('[1] ' . $url, $text);
    self::assertSame([$url], $this->hrefs($this->dom((string) $email->getHtmlBody())));
    self::assertSame(['bakers-lockup-plain.png'], $this->lockups($email));
  }

  /**
   * A URL over 2,000 characters is never broken in either MIME part.
   */
  public function testLongUrlIsUnbrokenInBothParts(): void {
    $url = 'https://bakers.example.com/user/reset/1/2/' . str_repeat('a1b2c3', 350) . '/login?destination=%2Fx';
    $plugin = $this->plugin();
    $message = $plugin->format($this->message([
      'Plain: ' . $url,
      Markup::create('<p>Markup: <a href="' . $url . '">link</a></p>'),
    ]));
    self::assertTrue($plugin->mail($message));

    $email = $this->onlySent();
    $text = (string) $email->getTextBody();
    self::assertStringContainsString('Plain: ' . $url, $text);
    self::assertStringContainsString('[1] ' . $url, $text);
    self::assertSame([$url, $url], $this->hrefs($this->dom((string) $email->getHtmlBody())));
    $decoded = quoted_printable_decode($email->toString());
    self::assertStringContainsString('Plain: ' . $url, $decoded);
    self::assertStringContainsString('href="' . $url . '"', $decoded);
  }

  /**
   * Long Unicode content and an empty body both send.
   */
  public function testUnicodeAndEmptyBodiesSend(): void {
    $plugin = $this->plugin();
    $long = str_repeat('Grüße, 世界 — ', 400);
    self::assertTrue($plugin->mail($plugin->format($this->message([$long]))));
    self::assertTrue($plugin->mail($plugin->format($this->message([]))));

    [$unicode, $empty] = $this->sent();
    self::assertSame($long, $unicode->getTextBody());
    self::assertStringContainsString(trim($long), $this->dom((string) $unicode->getHtmlBody())->textContent);
    self::assertSame('', $empty->getTextBody());
    self::assertStringContainsString('bakers.build', (string) $empty->getHtmlBody());
  }

  /**
   * Text becomes links only for absolute HTTP(S) URLs, without punctuation.
   */
  public function testLinkRecognition(): void {
    self::assertSame([[
      ['text' => 'See '],
      ['text' => 'https://example.com/wiki/A_(b)', 'url' => 'https://example.com/wiki/A_(b)'],
      ['text' => ', ('],
      ['text' => 'http://example.com/x?y=1', 'url' => 'http://example.com/x?y=1'],
      ['text' => '). Not ftp://example.com or javascript:alert(1).'],
    ],
    ], BbHtmlMail::paragraphs('See https://example.com/wiki/A_(b), (http://example.com/x?y=1). Not ftp://example.com or javascript:alert(1).'));
    self::assertSame(
      [[['text' => "one\ntwo"]], [['text' => 'three']]],
      BbHtmlMail::paragraphs("one\ntwo\n\n  \nthree\n"),
    );
    self::assertSame([], BbHtmlMail::paragraphs(" \n "));
    self::assertSame(
      [
        [['text' => 'https://example.com/j', 'url' => 'https://example.com/j', 'action' => TRUE, 'label' => 'Join']],
        [['text' => 'Open the page below:']],
        [['text' => 'https://example.com/l', 'url' => 'https://example.com/l', 'action' => TRUE]],
        [['text' => 'https://example.com/k', 'url' => 'https://example.com/k', 'action' => TRUE]],
        [['text' => 'See '], ['text' => 'https://example.com/m', 'url' => 'https://example.com/m']],
      ],
      BbHtmlMail::paragraphs("Join: https://example.com/j\n\nOpen the page below:\nhttps://example.com/l\n\nhttps://example.com/k\n\nSee https://example.com/m"),
    );
    self::assertSame(
      [[['text' => 'Code:']], [['text' => '598701', 'code' => TRUE]], [['text' => 'Room 1234 is free']]],
      BbHtmlMail::paragraphs("Code:\n\n 598701 \n\nRoom 1234 is free"),
    );
  }

  /**
   * Headers keep core's mailbox handling; BCC is not serialized.
   */
  public function testHeadersKeepTheCoreContract(): void {
    $plugin = $this->plugin();
    $message = $this->message(['Hello']);
    $message['headers']['From'] = '"Ops, Acme" <noreply@example.com>';
    $message['headers']['Reply-to'] = '"Help, Desk" <help@example.com>';
    $message['headers']['Bcc'] = 'audit@example.com';
    self::assertTrue($plugin->mail($plugin->format($message)));

    $email = $this->onlySent();
    self::assertSame('Ops, Acme', $email->getFrom()[0]->getName());
    self::assertSame('Help, Desk', $email->getReplyTo()[0]->getName());
    self::assertSame('audit@example.com', $email->getBcc()[0]->getAddress());
    self::assertStringNotContainsString('audit@example.com', $email->toString());
    self::assertStringNotContainsString('format=flowed', $email->toString());
  }

  /**
   * One plugin instance carries nothing from one message into the next.
   */
  public function testSequentialSendsAreIsolated(): void {
    $plugin = $this->plugin();
    $first = $this->message(['Secret code 111111 for first']);
    $first['langcode'] = 'de';
    self::assertTrue($plugin->mail($plugin->format($first)));
    self::assertTrue($plugin->mail($plugin->format($this->message(['Second body']))));

    [$one, $two] = $this->sent();
    self::assertSame('de', $this->dom((string) $one->getHtmlBody())->documentElement->getAttribute('lang'));
    self::assertSame('en', $this->dom((string) $two->getHtmlBody())->documentElement->getAttribute('lang'));
    self::assertStringNotContainsString('111111', quoted_printable_decode($two->toString()));
  }

  /**
   * Cancelled and dry-run messages send nothing.
   */
  public function testCancelledAndDryRunMessagesSendNothing(): void {
    $manager = $this->container->get('plugin.manager.mail');
    $cancelled = $manager->mail('mail_cancel_test', 'cancel_test', 'a@example.com', 'en');
    $dry = $manager->mail('bb_core', 'invite', 'a@example.com', 'en', [
      'workspace_label' => 'Acme',
      'inviter_label' => '',
      'validity_days' => 7,
      'join_url' => 'https://bakers.example.com/join',
    ], NULL, FALSE);

    self::assertNull($cancelled['result']);
    self::assertArrayNotHasKey('result', $dry);
    self::assertSame(0, $this->attempts());
  }

  /**
   * A transport or renderer failure reports FALSE, logs, and sends once.
   */
  public function testFailuresReportFalseWithoutRetry(): void {
    $this->transport->failure = new TransportException('Connection refused');
    $logger = $this->createMock(LoggerInterface::class);
    $logger->expects(self::once())->method('log');
    $plugin = new BbHtmlMail(
      $logger,
      $this->container->get('renderer'),
      $this->transport,
    );
    self::assertFalse($plugin->mail($plugin->format($this->message(['Hello']))));
    self::assertSame(1, $this->attempts());

    $this->transport->failure = NULL;
    $renderer = $this->createMock(RendererInterface::class);
    $renderer->method('renderInIsolation')->willThrowException(new \RuntimeException('Template broke'));
    $logger = $this->createMock(LoggerInterface::class);
    $logger->expects(self::once())->method('log');
    $plugin = new BbHtmlMail($logger, $renderer, $this->transport);
    self::assertFalse($plugin->mail($plugin->format($this->message(['Hello']))));
    self::assertSame(1, $this->attempts());
    self::assertSame([], $this->sent());
  }

  /**
   * Points a plugin instance at the collecting transport.
   */
  private function injectTransport(SymfonyMailer $plugin): void {
    $transport = $this->transport;
    \Closure::bind(function () use ($transport): void {
      $this->mailer = $transport;
    }, $plugin, SymfonyMailer::class)();
  }

  /**
   * Returns the default plugin instance the mail manager uses.
   */
  private function plugin(): BbHtmlMail {
    $plugin = $this->container->get('plugin.manager.mail')
      ->getInstance(['module' => 'any', 'key' => 'any']);
    self::assertInstanceOf(BbHtmlMail::class, $plugin);
    return $plugin;
  }

  /**
   * Builds an unformatted message the way MailManager::doMail() does.
   *
   * @param array<int, string|\Drupal\Component\Render\MarkupInterface> $body
   *   The body parts.
   *
   * @return array<string, mixed>
   *   The message.
   */
  private function message(array $body): array {
    return [
      'to' => 'reader@example.com',
      'subject' => 'Synthetic message',
      'body' => $body,
      'langcode' => 'en',
      'headers' => [
        'MIME-Version' => '1.0',
        'Content-Type' => 'text/plain; charset=UTF-8; format=flowed; delsp=yes',
        'Content-Transfer-Encoding' => '8Bit',
        'From' => 'noreply@example.com',
      ],
    ];
  }

  /**
   * The messages handed to the transport.
   *
   * @return list<\Symfony\Component\Mime\Email>
   *   The sent messages.
   */
  private function sent(): array {
    return $this->transport->sent;
  }

  /**
   * The number of send attempts.
   */
  private function attempts(): int {
    return $this->transport->attempts;
  }

  /**
   * Asserts exactly one message was sent and returns it.
   */
  private function onlySent(): Email {
    self::assertCount(1, $this->sent());
    return $this->sent()[0];
  }

  /**
   * The lockup variant each attachment of a message carries.
   *
   * @return list<string>
   *   The variant file names, matched by content.
   */
  private function lockups(Email $email): array {
    $dir = $this->container->get('extension.list.module')->getPath('bb_core') . '/assets/email';
    $variants = [];
    foreach (glob($dir . '/bakers-lockup-*.png') ?: [] as $file) {
      $variants[(string) file_get_contents($file)] = basename($file);
    }
    return array_values(array_map(
      static fn ($part): string => $variants[$part->getBody()] ?? 'unknown',
      $email->getAttachments(),
    ));
  }

  /**
   * Parses an HTML document.
   */
  private function dom(string $html): \DOMDocument {
    $dom = new \DOMDocument();
    self::assertTrue(@$dom->loadHTML('<?xml encoding="utf-8"?>' . $html));
    return $dom;
  }

  /**
   * The decoded href of every anchor, in document order.
   *
   * @return list<string>
   *   The hrefs.
   */
  private function hrefs(\DOMDocument $dom): array {
    $hrefs = [];
    foreach ($dom->getElementsByTagName('a') as $anchor) {
      $hrefs[] = $anchor->getAttribute('href');
    }
    return $hrefs;
  }

}
