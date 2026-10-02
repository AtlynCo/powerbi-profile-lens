# Certification runbook

Operational sequence for taking Atlyn Profile Lens from source to a Partner Center submission
candidate. This runbook encodes the gates that already exist in the repository; it claims nothing
about Microsoft certification, approval, submission, or listing. The submission boundary in
[partner-center-submission.md](partner-center-submission.md) remains authoritative.

## Current submission status (2026-09-17)

PR [#28](https://github.com/AtlynCo/powerbi-profile-lens/pull/28) was merged as
`0c5caaa7abc244cc41fd484b27aa5d1157a50c18`; `main` and the public lowercase
`certification` branch matched at that release source before this metadata follow-up. Version 1.9.1.2
published to Marketplace on 2026-09-29 after certification passed with notes. The
official report records a soft required fix under Policy 1180.2.3.1: include hints and tips in the
required sample file and resubmit with the next submission. The separate Power BI certification
badge has not been independently verified.

The published release uses the validated 1.9.1.2 package/PBIX pair and must not be changed.
This separate fallback candidate is **1.9.1.3**, GUID `atlynProfileLens`, API metadata `5.11.0`
from the `powerbi-visuals-api` 5.11.1 package. Its
deterministic package is `dist/atlynProfileLens.1.9.1.3.pbiviz` (725389 bytes, SHA-256
`1e680cbc09b5bbab7a5a00e9eab60a6688a3da7f6a65c482791caf0a2c8aff3c`), and its embedded
payload is 3318314 bytes with SHA-256
`11f7911749da859998d503b865ea26d924fadf6e76afb2d0e1c786164242aa98`.
The generated PBIP embeds that exact payload. No 1.9.1.3 PBIX or native evidence exists, and the
validated 1.9.1.2 PBIX must not be reused or relabeled. The full native checklist, screenshots,
and separate Power BI certification badge remain unclaimed.

Current unsubmitted fallback candidate: **1.9.1.3**, GUID `atlynProfileLens`, API metadata `5.11.0`
(`pbiviz.json`) with API package 5.11.1 (`package.json`). The package intentionally exports
major/minor metadata as `5.11.0`. API package 5.11.1 adds the BLEU sovereign-cloud enum; Profile
Lens does not use Authentication or licensing APIs, so it requires no cloud-specific runtime branch. The
official tools 7.2.2 release is not available from the configured npm registry/version list; retain
the reproducible installable 7.2.1 tool until Microsoft publishes an installable package.

## 0. Machine prerequisites

| Requirement | Why | Verified 2026-08-22 |
|---|---|---|
| Node.js >= 20.19 on PATH | required by Power BI Visual Tools 7.2.1 and used by every `scripts/*.cjs`, Vitest, Playwright, pbiviz, and the sealing calls inside the PowerShell harness | verify on the execution host |
| npm | `npm ci`, `validate:certification` chain (`package.json:39`) | **absent** |
| PowerShell 7 (`pwsh`) on PATH | `scripts/pbix-publication-lock.cjs:18` spawns `pwsh` by name; the harness also uses the .NET Core 3-argument `System.IO.File.Move(src, dst, $true)` overload (`run-desktop-validation.ps1:756,805`) that Windows PowerShell 5.1 (.NET Framework) does not have | **absent** |
| Power BI Desktop at `C:\Program Files\Microsoft Power BI Desktop\bin\PBIDesktop.exe` | hardcoded owned-process path (`desktop-guard.ps1:186`) | present, `2.157.879.0 (26.08)` |
| Exclusive interactive desktop session | guard refuses input unless the owned window is proven foreground (`desktop-guard.ps1:199-217`); no other app may steal focus mid-run | owner judgement |
| PBIDesktop not running | startup blocker (`run-desktop-validation.ps1:72-74`) | satisfied |

Install order on a fresh machine: Node LTS >= 20.19 → `npm ci` → PowerShell 7 →
`npm run validate:certification`.

## 1. Automated baseline

```
npm run validate:certification
```

Runs, in order: `audit:npm`, context-pack fetch/validate/verify/repro (including the
`Etc/GMT+12` / `Etc/GMT-14` byte-identical rebuild check), `lint`, `typecheck`, `package`
(certification-audited, reproducibility-normalized PBIVIZ), `sample:pbip` (re-embeds the exact
PBIVIZ into the sample report), unit tests, packaged-browser probes, `audit:certification`,
`audit:reproducible`, `release:manifest`. The release manifest at this stage records
`sampleReport.pbix = null` and refuses to run unlocked if a PBIX appears
(`scripts/release-manifest.cjs:45-52`). A prior-version PBIX does not change that field and is not
accepted as evidence.

Gate: exit code 0 and a `dist/release-manifest.json` naming the commit, GUID, version, API version,
and PBIVIZ SHA-256 intended for release.

## 2. Native controlled run (genuine PBIX)

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\native-validation\run-desktop-validation.ps1
```

What the harness does: verifies sample integrity and source binding, snapshots the exact PBIP
fixture to a content-addressed short root under `%LOCALAPPDATA%\AtlynPBI\<20-char token>`
(path-limit preflight: 248 dir / 260 file), opens it in a job-owned Desktop process, walks all
ten page tabs, performs Save As through bounded UI Automation (filename control automation ID
`1001`, Save control automation ID `1`), closes the writer, snapshots the PBIX, reopens the PBIX
offline, re-walks all pages, asserts byte stability across reopen, seals observations, sanitizes
evidence, and atomically persists success output to
`dist/release/native-evidence/native-run.json` (or `native-failure.json` on any block).

The guarded run on Desktop 2.157.879.0 (26.08) was blocked at Save As: `The owned Save As dialog
exposes no safe bound Pane control for ''`. The embedded common-file dialog exposes controls `1001`/`1`
as Pane elements with **no** ValuePattern or InvokePattern, so the pattern-required guards refuse to
set the path or invoke Save. The repo policy explicitly prohibits SendKeys, coordinate clicks, Win32
messages, and PBIX editing as workarounds.

1. Retry after a Desktop update that restores UIA patterns on those controls.
2. Do not reuse the stale `d3e60d8b...d4e2bd` PBIX; use only the final
   `af5c8c58...24c01563` PBIX paired with the package above.
3. Keep native claims limited to the recorded two-page Save As/reopen and parity evidence.

Do not fabricate, hand-edit, or post-hoc assemble `native-run.json`; every observation is hashed,
sequence-checked, commit-bound, and re-verified by the finalizer.

## 3. Finalize evidence

With a completed `native-run.json` and the release PBIVIZ built:

```
node scripts/finalize-native-evidence.cjs
```

Re-verifies snapshot identity, scenario outcomes (all seven required scenarios must derive
`passed`: fieldWells, profilesAndNormalization, contextModesAndJoins, selectionAndContextMenus,
tooltipsAndKeyboard, lifecycleAndStaticSurfaces, pbixOfflineReopen —
`scripts/native-observations.cjs:4-12`), source-commit binding, automation integrity, PBIX
snapshot/title-guard coupling, embedded visual payload parity, and reopen-hash equality; holds the
PBIX read lock through publication; writes `docs/native-validation/atlynProfileLens-<version>.json`
and removes the launch snapshot.

## 4. Release manifest with PBIX

```
npm run release:manifest
```

Acquires the PBIX publication lock (via `pwsh`), regenerates `dist/release-manifest.json` naming
the genuine PBIX, and verifies lock liveness before and after
(`scripts/release-manifest.cjs`). The produced PBIX stays uncommitted by design (`.gitignore`
excludes `*.pbix`).

## 5. Listing artwork

Screenshots remain the only artwork gap (`docs/partner-center-submission.md:16`). Produce 1–5
screenshots at exactly 1366×768, each ≤ 1024 KB, PNG, showing real rendered pages of the release
PBIX (hero world lens, profile split, county detail are the strongest candidates). Capture from the
native window after the run; do not submit Chromium mockups.

## 6. Submission mechanics (owner-controlled)

1. Confirm the exact reviewed commit and submitted `.pbiviz` in Microsoft's certification record.
2. Do not promote this candidate to `main` or lowercase `certification` without an explicit
   corrective-release decision. Promote only the exact source and matching artifacts selected for
   the next submission.
3. Confirm `docs/partner-center-submission.md` values: support
   `https://atlynco.github.io/atlyn-powerbi-support/docs/faq/`, product privacy
   `https://github.com/AtlynCo/powerbi-profile-lens/blob/certification/PRIVACY.md`, terms
   `https://www.atlynco.com/legal/terms`, EULA.md, THIRD_PARTY_NOTICES.md, and
   `assets/partner-center-logo-300x300.png`.
4. In Partner Center, replace the failed submission's OSM-enabled package, PBIX, and listing
   materials only if their hashes differ from the exact final pair. Paste
   `docs/partner-center-testing-instructions.md` into Notes for certification; do not leave it empty.
   Declare zero external network usage (empty privileges, audited). Do not claim certification before
   Microsoft completes its review.
5. Expect review within days-to-two-weeks; if certification fails on reviewer-side rendering, use
   the private `pbicvsupport` repository to share the package with Microsoft under NDA-friendly
   terms.

## Parity protocol

The submitted PBIVIZ, the sample-report-embedded resource, and the PBIX-embedded payload must be
byte-identical and eventually bound to one reviewed commit on `certification`:
`assertBoundSourceMatchesCommit` enforces clean bound paths at HEAD
(`scripts/native-source-integrity.cjs:97-111`); the audit compares the embedded sample resource
against the package (`scripts/certification-audit.cjs:236-243`); the finalizer compares the PBIX
payload and active report reference against the package
(`scripts/sample-resource-parity.cjs`). The PBIR proof reads only integrity-checked canonical visual
definition paths and retains guarded legacy `Report/Layout` support. Any change to bound sources
invalidates prior evidence — re-run phases 1–4.
