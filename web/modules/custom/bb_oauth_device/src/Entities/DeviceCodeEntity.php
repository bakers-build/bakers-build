<?php

declare(strict_types=1);

namespace Drupal\bb_oauth_device\Entities;

use League\OAuth2\Server\Entities\DeviceCodeEntityInterface;
use League\OAuth2\Server\Entities\Traits\DeviceCodeTrait;
use League\OAuth2\Server\Entities\Traits\EntityTrait;
use League\OAuth2\Server\Entities\Traits\TokenEntityTrait;

/**
 * The device code value object handed to and from league's grant.
 */
class DeviceCodeEntity implements DeviceCodeEntityInterface {

  use EntityTrait;
  use TokenEntityTrait;
  use DeviceCodeTrait;

}
