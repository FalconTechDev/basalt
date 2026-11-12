---
tags: [basalt, sync]
---

# Sync with git

Basalt can keep a vault in sync between computers through a git repository.

1. Open the settings and choose **Sync**.
2. Connect a repository (a GitHub address, or a local bare repository).
3. Basalt commits your edits, pulls the others and pushes yours.

If both sides changed the same lines, syncing stops and shows the conflict. Edit the files, then press **I fixed it**.

Before anything is overwritten, a backup branch is made, so nothing is lost.

The **action log** is separate: it records edits on this computer, even without git, and lets you undo one action or return to a moment.

Back to [[Start here]].
