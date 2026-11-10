<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Mail;

use Drupal\Component\Render\MarkupInterface;
use Drupal\Core\Extension\ThemeExtensionList;
use Drupal\Core\Mail\Attribute\Mail;
use Drupal\Core\Mail\Plugin\Mail\SymfonyMailer;
use Drupal\Core\Render\RendererInterface;
use Drupal\Core\Routing\RequestContext;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Utility\Error;
use Drupal\bb_core\Mail\UnwrappedMailFormatHelper;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Mailer\MailerInterface;
use Symfony\Component\Mime\Email;

/**
 * Sends every application mail as branded HTML with a plain-text alternative.
 *
 * Extends core's Symfony mailer, so the `system.mail.mailer_dsn` transport is
 * unchanged. Both MIME parts come from the same formatted text body; the HTML
 * part is that text rendered through the `bb_email` template after every
 * hook_mail() and hook_mail_alter() has run.
 *
 * Core's plugin is @internal; this subclass relies on its constants,
 * constructor and getMailer() as shipped in the locked core version.
 */
#[Mail(
  id: 'bb_html_mail',
  label: new TranslatableMarkup('bakers.build HTML mail'),
)]
final class BbHtmlMail extends SymfonyMailer {

  /**
   * An absolute HTTP(S) URL, up to whitespace or a character that ends it.
   */
  private const URL_PATTERN = '~https?://[^\s<>"]+~i';

  /**
   * The content ID of the embedded header logo.
   */
  private const LOGO_CID = 'bakers-logo';

  public function __construct(
    LoggerInterface $logger,
    private readonly RendererInterface $renderer,
    private readonly ThemeExtensionList $themeList,
    private readonly RequestContext $requestContext,
    ?MailerInterface $mailer = NULL,
  ) {
    parent::__construct($logger, $mailer);
  }

  /**
   * {@inheritdoc}
   *
   * @param \Symfony\Component\DependencyInjection\ContainerInterface $container
   *   The service container.
   * @param array<string, mixed> $configuration
   *   The plugin configuration.
   * @param string $plugin_id
   *   The plugin ID.
   * @param mixed $plugin_definition
   *   The plugin definition.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    return new self(
      $container->get('logger.channel.mail'),
      $container->get('renderer'),
      $container->get('extension.list.theme'),
      $container->get('router.request_context'),
    );
  }

  /**
   * {@inheritdoc}
   *
   * Like core, but without soft wrapping: see UnwrappedMailFormatHelper.
   * A first line `# Headline` becomes the message's `headline`, kept in the
   * text part without its marker and set as the heading of the HTML part.
   *
   * @param array<string, mixed> $message
   *   The message to format.
   *
   * @return array<string, mixed>
   *   The message with a single string body.
   */
  public function format(array $message) {
    $parts = [];
    foreach ($message['body'] as $part) {
      $parts[] = $part instanceof MarkupInterface
        ? UnwrappedMailFormatHelper::htmlToText((string) $part)
        : str_replace("\r", '', (string) $part);
    }
    $message['body'] = implode("\n\n", $parts);
    if (preg_match('/^# ([^\n]+)/', $message['body'], $headline)) {
      $message['headline'] = trim($headline[1]);
      $message['body'] = $message['headline'] . substr($message['body'], strlen($headline[0]));
    }
    return $message;
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $message
   *   The formatted message.
   */
  public function mail(array $message) {
    try {
      $email = new Email();

      $headers = $email->getHeaders();
      foreach ($message['headers'] as $name => $value) {
        if (in_array(strtolower($name), self::SKIP_HEADERS, TRUE)) {
          continue;
        }
        if (in_array(strtolower($name), self::MAILBOX_LIST_HEADERS, TRUE)) {
          $value = str_getcsv($value, escape: '\\');
        }
        $headers->addHeader($name, $value);
      }

      $recipients = array_map(static fn (?string $recipient): string => trim((string) $recipient), str_getcsv($message['to'], escape: '\\'));
      $email
        ->to(...$recipients)
        ->subject($message['subject'])
        ->text($message['body'])
        ->html($this->renderHtml($message))
        ->embedFromPath($this->themeList->getPath('bb_theme') . '/logo-wordmark.png', self::LOGO_CID, 'image/png');

      $this->getMailer()->send($email);
      return TRUE;
    }
    catch (\Exception $e) {
      Error::logException($this->logger, $e);
      return FALSE;
    }
  }

  /**
   * Renders the HTML alternative of one formatted message.
   *
   * @param array<string, mixed> $message
   *   The formatted message.
   */
  private function renderHtml(array $message): string {
    $build = [
      '#theme' => 'bb_email',
      '#subject' => (string) ($message['headline'] ?? $message['subject']),
      '#paragraphs' => self::paragraphs(isset($message['headline'])
        ? substr((string) $message['body'], strlen((string) $message['headline']))
        : (string) $message['body'], $this->requestContext->getCompleteBaseUrl(), $message['bb_links'] ?? NULL),
      '#langcode' => (string) ($message['langcode'] ?? 'en'),
      '#logo_src' => 'cid:' . self::LOGO_CID,
    ];
    $html = (string) $this->renderer->renderInIsolation($build);
    // Twig debug output would put comments before the doctype, and a client
    // that then renders in quirks mode drops the centring.
    return (string) preg_replace('/^\s*(?:<!--.*?-->\s*)*/s', '', $html);
  }

  /**
   * Splits a text body into paragraphs of text and link segments.
   *
   * Each segment is `['text' => …]` or `['text' => …, 'url' => …]`; the URL
   * is the untouched source text. A paragraph that is nothing but a 4–8
   * digit code becomes one `['text' => …, 'code' => TRUE]` segment, so the
   * template can set it apart as the thing to copy. A URL that stands alone,
   * or ends its paragraph after a colon, becomes its own paragraph with
   * `'action' => TRUE`, rendered as a button. When the colon closes a short
   * one-line label (`Sign in: <url>`), that label names the button instead
   * of standing above it. The body carries user text such as ticket titles
   * and names, so a mail whose hook_mail() names its links in `bb_links`
   * links only those; any other mail links only the site's own origin.
   * Markup is left to the template.
   *
   * @param string $body
   *   The formatted text body.
   * @param string $siteUrl
   *   The site's base URL, whose scheme, host and port a link must share.
   * @param list<string>|null $links
   *   The only URLs to link, exactly as they appear, or NULL for the origin
   *   rule.
   *
   * @return list<list<array{text: string, url?: string, code?: true, action?: true, label?: string}>>
   *   The paragraphs, in order.
   */
  public static function paragraphs(string $body, string $siteUrl, ?array $links = NULL): array {
    $paragraphs = [];
    foreach (preg_split('/\n(?:[ \t]*\n)+/', trim($body)) ?: [] as $block) {
      $block = trim($block, "\n");
      if (trim($block) === '') {
        continue;
      }
      if (preg_match('/^\s*(\d{4,8})\s*$/', $block, $code)) {
        $paragraphs[] = [['text' => $code[1], 'code' => TRUE]];
        continue;
      }
      $segments = [];
      $offset = 0;
      preg_match_all(self::URL_PATTERN, $block, $matches, PREG_OFFSET_CAPTURE);
      foreach ($matches[0] as [$url, $position]) {
        $url = self::trimUrl($url);
        if ($links !== NULL ? !in_array($url, $links, TRUE) : !self::isSiteUrl($url, $siteUrl)) {
          continue;
        }
        if ($position > $offset) {
          $segments[] = ['text' => substr($block, $offset, $position - $offset)];
        }
        $segments[] = ['text' => $url, 'url' => $url];
        $offset = $position + strlen($url);
      }
      if ($offset < strlen($block)) {
        $segments[] = ['text' => substr($block, $offset)];
      }
      array_push($paragraphs, ...self::splitAction($segments));
    }
    return $paragraphs;
  }

  /**
   * Moves a paragraph's closing link into an action paragraph of its own.
   *
   * @param list<array{text: string, url?: string}> $segments
   *   One paragraph's segments.
   *
   * @return list<list<array{text: string, url?: string, action?: true, label?: string}>>
   *   The paragraph, or the lead-in text followed by the action.
   */
  private static function splitAction(array $segments): array {
    $last = array_pop($segments);
    if ($last === NULL || !isset($last['url'])) {
      return [array_merge($segments, $last === NULL ? [] : [$last])];
    }
    $action = [['text' => $last['text'], 'url' => $last['url'], 'action' => TRUE]];
    if ($segments === []) {
      return [$action];
    }
    $before = $segments[count($segments) - 1];
    if (isset($before['url']) || !str_ends_with(rtrim($before['text']), ':')) {
      return [[...$segments, $last]];
    }
    $label = rtrim(rtrim($before['text']), ':');
    if (count($segments) === 1 && !str_contains($before['text'], "\n") && mb_strlen($label) <= 40) {
      $action[0]['label'] = trim($label);
      return [$action];
    }
    $segments[count($segments) - 1]['text'] = rtrim($before['text']);
    return [$segments, $action];
  }

  /**
   * Whether a URL shares the site's scheme, host and port.
   *
   * A backslash or a user part is refused: browsers read `\` as `/`, so
   * parse_url() and the browser would disagree on the host.
   */
  private static function isSiteUrl(string $url, string $siteUrl): bool {
    $origin = static function (string $candidate): ?string {
      $parts = parse_url($candidate);
      return isset($parts['scheme'], $parts['host']) && !isset($parts['user']) && !isset($parts['pass']) && !str_contains($candidate, '\\')
        ? strtolower($parts['scheme'] . '://' . $parts['host'] . ':' . ($parts['port'] ?? ''))
        : NULL;
    };
    return $origin($url) !== NULL && $origin($url) === $origin($siteUrl);
  }

  /**
   * Detaches sentence punctuation and unbalanced closing brackets.
   */
  private static function trimUrl(string $url): string {
    while ($url !== '') {
      $last = substr($url, -1);
      $unbalanced = ($last === ')' && substr_count($url, '(') < substr_count($url, ')'))
        || ($last === ']' && substr_count($url, '[') < substr_count($url, ']'));
      if (!$unbalanced && !str_contains('.,;:!?\'', $last)) {
        return $url;
      }
      $url = substr($url, 0, -1);
    }
    return $url;
  }

}
