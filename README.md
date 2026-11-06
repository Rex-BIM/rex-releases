# Re-X desktop downloads

Official preview installers for **Rex Architect**.

Download and installation instructions: **https://re-x.ai/download/**

## Windows preview

- 64-bit Windows 10 or 11; installs for your Windows user, no administrator rights needed
- Includes the Rex add-in for Revit 2025, 2026 and 2027
- Not code-signed yet: if Windows SmartScreen warns, choose More info, then Run anyway

Close Revit, run the installer and keep the defaults, then open Rex Architect from the Start menu, sign in and choose a sample project. The first time Revit starts with the add-in, choose Always Load for RexBridge.

## Mac preview

- Apple Silicon (M-series) Mac
- macOS 15 (Sequoia) or later; 0.9.8 passed packaged-app checks on macOS 15.8.2 and 26.7.2
- macOS 27 preview is not qualified: its sample-project launch check failed; see the [compatibility run](https://github.com/Rex-BIM/rex-releases/actions/runs/42306824177)
- Developer ID signed and Apple notarized

The current Mac release is [0.9.8](https://github.com/Rex-BIM/rex-releases/releases/tag/v0.9.8). Its public Terminal installer was used to install it into Applications, and the installed app passed a real ChatGPT reply and Rex model-tool read on macOS 26.5.1.

Extract the downloaded ZIP, drag Rex Architect to Applications, then open it, sign in to Rex and choose a sample project. You can also install from Terminal with `curl -fsSL https://re-x.ai/download/install-macos.sh | /bin/sh`. AI features require a Rex account. ChatGPT and Claude chat also need Node.js 22 or later and the chosen provider CLI/sign-in. Revit integration runs on Windows. Mac updates are installed by downloading a newer release.

Each release includes the installer, a SHA-256 checksum, and build provenance. This repository distributes release binaries; the product source is maintained separately.

Learn about Re-X at https://re-x.ai/.

## Public-package compatibility verification

The manually dispatched [Mac package workflow](https://github.com/Rex-BIM/rex-releases/actions/workflows/macos-package.yml) verifies a published release on Apple Silicon macOS 15, 26 and 27 (the `xcode-27` runner). It runs sequentially on standard public runners. It checks the exact ZIP checksum, app version/source revision, Developer ID, secure timestamp, hardened runtime, stapled ticket and Gatekeeper, then cold-starts the bundled drawing runtime, exercises Git History commands and opens the bundled sample in the actual app with software WebGL.

The account and DXF are synthetic; no real account, product source, signing key or developer profile is uploaded. Reports record the actual OS version, and a support target is not a claim that an unexecuted test passed. Only the small verification harness and dependency lockfile live here alongside this download README; application source remains separate.
