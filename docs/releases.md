# Releases & auto-updates

The desktop app uses Tauri v2's updater plugin. Each published GitHub Release
ships signed installers and a `latest.json` manifest; running clients check
that manifest on launch and prompt to install if a newer version exists.

## One-time setup

### 1. Generate a signing keypair

Run on a trusted machine. Pick a strong password — Tauri encrypts the private
key with it.

```bash
pnpm tauri signer generate -w ~/.tauri/aoe4-almanac.key
```

This writes:
- `~/.tauri/aoe4-almanac.key` — the encrypted private key (keep secret, back
  up offline).
- `~/.tauri/aoe4-almanac.key.pub` — the public key (safe to commit).

### 2. Wire the public key into the app

Copy the contents of `~/.tauri/aoe4-almanac.key.pub` and paste it into
`src-tauri/tauri.conf.json` under `plugins.updater.pubkey`, replacing the
`REPLACE_WITH_PUBLIC_KEY_FROM_TAURI_SIGNER` placeholder.

### 3. Add the private key to GitHub Actions secrets

In the repo's *Settings → Secrets and variables → Actions*, add:

- `TAURI_SIGNING_PRIVATE_KEY` — the **contents** of
  `~/.tauri/aoe4-almanac.key` (not the path).
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password chosen in step 1.

Without these, the release workflow will still build installers but the
updater check will reject them as unsigned.

## Cutting a release

1. On github.com, *Releases → Draft a new release*.
2. Tag: a plain semver tag (`0.2.0` or `v0.2.0`). Pre-release tags
   (`0.2.0-rc.1`) are rejected — the Windows bundler can't encode them.
3. Write release notes; these end up in the in-app update prompt via
   `latest.json.notes`.
4. *Publish*.

The `release` workflow then:
- Builds installers on Linux (AppImage), macOS (dmg + .app.tar.gz),
  and Windows (NSIS) in parallel.
- Signs each updater artifact with the private key and uploads it.
- A final `publish-updater-manifest` job assembles a merged `latest.json`
  pointing at all three platforms and uploads it to the release.

## Client behaviour

On every app launch, `UpdateBanner` calls the updater, which fetches
`https://github.com/<owner>/aoe4-almanac/releases/latest/download/latest.json`.
If the manifest's `version` is newer than the running app, a non-blocking
bottom-right banner offers to install + relaunch.

## Platform notes

- **Linux**: only AppImage users get auto-updates. `.deb` is intentionally
  not built — Tauri's updater doesn't support it.
- **Windows**: NSIS only (no MSI). NSIS supports silent per-user installs,
  which the updater needs for a smooth restart-and-apply flow.
- **macOS**: only `aarch64` (Apple Silicon) is built. Add an `x86_64-apple-darwin`
  matrix entry to the release workflow if Intel support is needed.
