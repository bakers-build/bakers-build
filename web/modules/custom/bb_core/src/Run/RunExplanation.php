<?php

declare(strict_types=1);

namespace Drupal\bb_core\Run;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
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
   */
  public function forRun(BbRunInterface $run): ?string {
    $state = $run->getRunState();
    if ($state === 'expired') {
      return (string) $this->t('The claim lapsed before the run started. The ticket can be claimed again.');
    }
    if ($state !== 'claimed') {
      return NULL;
    }
    $expires = $run->getClaimExpiresAt();
    if ($expires !== NULL && $expires <= $this->time->getRequestTime()) {
      return (string) $this->t('The claim lapsed @ago before the run started. The run expires the next time a conductor asks for work, and the ticket can be claimed again.', [
        '@ago' => $this->date->label($expires),
      ]);
    }
    $conductor = $run->get('conductor_id')->entity;
    return (string) $this->t('Claimed by @conductor @ago, not started yet. The claim lapses @at; after that the run expires and the ticket can be claimed again.', [
      '@conductor' => $conductor !== NULL ? (string) $conductor->label() : $this->t('a conductor'),
      '@ago' => $this->date->label($run->getCreatedTime()),
      '@at' => $expires !== NULL ? $this->date->label($expires) : $this->t('soon'),
    ]);
  }

}
