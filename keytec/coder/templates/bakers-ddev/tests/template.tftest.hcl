# terraform test: a template push needs the image and PM bot by digest (AC-8). Mocked providers,
# so it plans without a Coder server or Docker host. Run through tests/template.test.sh.

mock_provider "coder" {}
mock_provider "docker" {}

variables {
  image = "git.key-tec.de:5050/keytec/infra/coder-bakers-ddev:1.0.0@sha256:0000000000000000000000000000000000000000000000000000000000000000"
}

run "image_by_digest_plans" {
  command = plan
}

run "image_by_tag_only_is_rejected" {
  command = plan
  variables {
    image = "git.key-tec.de:5050/keytec/infra/coder-bakers-ddev:1.0.0"
  }
  expect_failures = [var.image]
}

run "pm_bot_by_digest_plans" {
  command = plan
  variables {
    pm_bot_image = "ghcr.io/bakers-build/bakers-build/pm-bot:1.0.0@sha256:1111111111111111111111111111111111111111111111111111111111111111"
  }
}

run "pm_bot_by_tag_only_is_rejected" {
  command = plan
  variables {
    pm_bot_image = "ghcr.io/bakers-build/bakers-build/pm-bot:1.0.0"
  }
  expect_failures = [var.pm_bot_image]
}
