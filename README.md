<p align="center">
  <img src="docs/assets/logo.svg" alt="bakers.build" width="380">
</p>

<p align="center">
  <strong>A ticket-driven orchestrator where every active ticket state is worked by a human or an AI.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bakers-build/bakers"><img src="https://img.shields.io/npm/v/@bakers-build/bakers?color=12B886&label=%40bakers-build%2Fbakers" alt="npm"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520.19-1FA97A" alt="node">
  <img src="https://img.shields.io/badge/license-GPL--2.0--or--later%20%7C%20MIT-0E7C63" alt="license: GPL-2.0-or-later (server), MIT (CLI and skills)">
</p>

<p align="center">
  <a href="https://bakers.build"><strong>Documentation: bakers.build</strong></a>
</p>

bakers.build is a standalone application: a Drupal control plane, a CLI and conductor on your
machine, and agent skills. It is not a module for arbitrary Drupal sites.

## Quick start

```sh
npm install -g @bakers-build/bakers
bakers init --base-url https://<your-server>
```

Everything else — connecting a chat client, machine and project setup, running the server — is in
[Get started](https://bakers.build/get-started/).

## Contributing, security, license

- [CONTRIBUTING](CONTRIBUTING.md): build from source, checks and pull requests.
- [SECURITY](SECURITY.md): report vulnerabilities privately.
- License: server GPL-2.0-or-later ([`LICENSE.txt`](LICENSE.txt)); CLI and skills MIT
  ([`bakers-cli/LICENSE`](bakers-cli/LICENSE)). See [licensing](docs/bakers/licensing.md).
