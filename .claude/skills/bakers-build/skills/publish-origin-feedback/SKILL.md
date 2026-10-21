---
name: publish-origin-feedback
description: Best-effort publish a caller-authored progress note to a bakers.build ticket origin.
---

# Publish origin feedback

Accept the complete note body from the caller. Empty origin is a no-op. For GitLab, parse the
repository URL and issue IID and run `glab issue note <iid> -R <repo> --message <body>`.
Unknown adapters and failures warn and return success. Never infer the note's meaning or timing.
