<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Activity;

use Drupal\Component\Render\MarkupInterface;

/**
 * What one channel says about an activity row.
 */
interface ActivityMessageInterface {

  /**
   * The headline: the feed statement or the mail subject sentence.
   */
  public function subject(): MarkupInterface|string;

  /**
   * The text below the headline, if any.
   */
  public function body(): MarkupInterface|string|null;

}
