<?php

declare(strict_types=1);

namespace Drupal\bb_core\Run;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Component\Render\PlainTextOutput;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Time\BbDate;

/**
 * Explains a claimed or expired run in a sentence.
 */
final class RunExplanation {

  use StringTranslationTrait;

  public function __construct(
    private readonly BbDate $date,
    private readonly TimeInterface $time,
  ) {}

  /**
   * The explanation of a claimed or expired run, NULL for other states.
   *
   * Plain text, not markup: a renderer escapes it exactly once.
   */
  public function forRun(BbRunInterface $run): ?string {
    $text = $this->sentence($run);
    return $text === NULL ? NULL : PlainTextOutput::renderFromHtml((string) $text);
  }

  /**
   * The explanation as translated markup, NULL for other states.
   */
  private function sentence(BbRunInterface $run): ?TranslatableMarkup {
    $state = $run->getRunState();
    if ($state === 'expired') {
      return $this->t('The claim lapsed before the run started. The ticket can be claimed again.');
    }
    if ($state !== 'claimed') {
      return NULL;
    }
    $expires = $run->getClaimExpiresAt();
    if ($expires !== NULL && $expires <= $this->time->getRequestTime()) {
      return $this->t('The claim lapsed @ago before the run started. The run expires the next time a conductor asks for work, and the ticket can be claimed again.', [
        '@ago' => $this->date->label($expires),
      ]);
    }
    $conductor = $run->get('conductor_id')->entity;
    return $this->t('Claimed by @conductor @ago, not started yet. The claim lapses @at; after that the run expires and the ticket can be claimed again.', [
      '@conductor' => $conductor !== NULL ? (string) $conductor->label() : $this->t('a conductor'),
      '@ago' => $this->date->label($run->getCreatedTime()),
      '@at' => $expires !== NULL ? $this->date->label($expires) : $this->t('soon'),
    ]);
  }

}
