<?php

declare(strict_types=1);

namespace Drupal\bb_core\Mail;

use Drupal\Core\Mail\MailFormatHelper;

/**
 * Core's HTML-to-text conversion without RFC 3676 soft wrapping.
 *
 * The text body is also the source of the HTML alternative, so a URL split
 * at 77 or 996 characters would become a broken href. Symfony MIME encodes
 * long lines for transport; hard breaks and indentation are kept as written.
 */
final class UnwrappedMailFormatHelper extends MailFormatHelper {

  /**
   * {@inheritdoc}
   *
   * @param string $text
   *   The text to process.
   * @param string $indent
   *   The indentation of the first line; later lines get its clean form.
   *
   * @return string
   *   The text, with hard line breaks only.
   */
  public static function wrapMail($text, $indent = '') {
    $text = str_replace("\r", '', (string) $text);
    return $indent . str_replace("\n", "\n" . static::htmlToTextClean($indent), $text);
  }

  /**
   * {@inheritdoc}
   *
   * Core lists the raw attribute value, so `&amp;` in an href would reach
   * the footnote, and from there the HTML link, still encoded.
   *
   * @param array<int, string>|null $match
   *   The anchor match from htmlToText(), or NULL to read the list.
   * @param bool $reset
   *   Whether to reset the list; the parent's signature.
   *
   * @return string|array<int, string>
   *   The footnoted label, or the collected URLs.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected static function htmlToMailUrls($match = NULL, $reset = FALSE) {
    if (is_array($match) && isset($match[2])) {
      $match[2] = html_entity_decode($match[2], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
    return parent::htmlToMailUrls($match, $reset);
  }

}
