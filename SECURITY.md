# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's **Security → Report a vulnerability** on this repository. Include what you found, how to reproduce it, and the version (Settings → About). You will get an answer within a few days.

## What is in scope

- The local HTTP API (`src/basalt-api.js`): it must listen on `127.0.0.1` only and require its token.
- Vault encryption and sync (`src/vault-sync.js`, `src-app/n-g25-crypto.js`).
- Board sharing over WebRTC (`src/basalt-share.js`): room passwords and peer data.
- The plugin sandbox (WebAssembly plugins and their permissions).
- The installer and the updater.

## Supported versions

Only the latest release receives fixes.
