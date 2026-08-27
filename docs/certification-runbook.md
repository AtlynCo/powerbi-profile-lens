# Certification runbook

Operational sequence for taking Atlyn Profile Lens from source to a Partner Center submission
candidate. This runbook encodes the gates that already exist in the repository; it claims nothing
about Microsoft certification, approval, submission, or listing. The submission boundary in
[partner-center-submission.md](partner-center-submission.md) remains authoritative.

## Current submission status (2026-08-27)

PR [#27](https://github.com/AtlynCo/powerbi-profile-lens/pull/27) was merged as
`eeb191325ac67de8db281fbb777bffcae1116846`, the repository is public at
<https://github.com/AtlynCo/powerbi-profile-lens>, and this release increments only the certification
version required by Partner Center. The older package and its owner-created PBIX are version
1.9.1.0 and 1.9.1.1 artifacts that must not be reused or represented as 1.9.1.2 evidence. This
repository makes no certification claim and does not touch Partner Center.

The deterministic 1.9.1.2 package is `dist/atlynProfileLens.1.9.1.2.pbiviz` (725242 bytes,
SHA-256 `f19ca452c28a8e6aa3e42b27f24b8939938f1350aa58dd46de2936034c6b89c3`).
Its embedded `atlynProfileLens` payload is 3317638 bytes with SHA-256
`b1e574a2eb3afa41f0672082d8169074d2f5ff4f486d197fe9d407bab043451c`.
The generated PBIP embeds that exact payload and resolves active visual references through canonical
PBIR `Report/definition/pages/**/visuals/**/visual.json` definitions. No matching 1.9.1.2 PBIX,
offline-reopen observation, native checklist, screenshots, Microsoft certification, or Partner Center
submission is claimed.

Current release candidate: **1.9.1.2**, GUID `atlynProfileLens`, API `5.11.0`
(`package.json`, `pbiviz.json`). Latest published API is 5.11.1 (BLEU cloud enum addition only);
the audit pins `5.11.0` exactly (`scripts/certification-audit.cjs:82,165`), so do not bump the API
without coordinated changes to `package.json`, `package-lock.json`, `src/runtimeLicenses.ts`, and
both audit assertions.

## 0. Machine prerequisites

| Requirement | Why | Verified 2026-08-22 |
|---|---|---|
| Node.js >= 20.10 on PATH | every `scripts/*.cjs`, vitest, Playwright, pbiviz, and the sealing calls inside the PowerShell harness (`scripts/native-validation/run-desktop-validation.ps1:99,111,117,144,149,270,464,…`) | **absent** |
| npm | `npm ci`, `validate:certification` chain (`package.json:39`) | **absent** |
| PowerShell 7 (`pwsh`) on PATH | `scripts/pbix-publication-lock.cjs:18` spawns `pwsh` by name; the harness also uses the .NET Core 3-argument `System.IO.File.Move(src, dst, $true)` overload (`run-desktop-validation.ps1:756,805`) that Windows PowerShell 5.1 (.NET Framework) does not have | **absent** |
| Power BI Desktop at `C:\Program Files\Microsoft Power BI Desktop\bin\PBIDesktop.exe` | hardcoded owned-process path (`desktop-guard.ps1:186`) | present, `2.157.879.0 (26.08)` |
| Exclusive interactive desktop session | guard refuses input unless the owned window is proven foreground (`desktop-guard.ps1:199-217`); no other app may steal focus mid-run | owner judgement |
| PBIDesktop not running | startup blocker (`run-desktop-validation.ps1:72-74`) | satisfied |

Install order on a fresh machine: Node LTS >= 20.10 → `npm ci` → PowerShell 7 →
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
fourteen page tabs, performs Save As through bounded UI Automation (filename control automation ID
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
2. Do not reuse a prior-version PBIX; it does not match the 1.9.1.2 package.
3. Ship without native evidence and keep the listing claims limited to the automated boundary
   (current documented posture).

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
2. Push the reviewed follow-up to `main` only after review. The lowercase `certification` branch
   remains at the public `7b7bebbc52eab6fbf18d55403ab6e90736d30c39` baseline unless an
   owner later promotes an exact reviewed release commit; do not modify it as part of this follow-up.
3. Confirm `docs/partner-center-submission.md` values: support
   `https://www.atlynco.com/docs/faq`, privacy `https://www.atlynco.com/legal/privacy`, terms
   `https://www.atlynco.com/legal/terms`, EULA.md, THIRD_PARTY_NOTICES.md,
   `assets/partner-center-logo-300x300.png`.
4. In Partner Center, replace the failed submission's OSM-enabled package, PBIX, and listing
   materials with the exact final PBIVIZ and genuinely reopened offline PBIX. Paste the package and
   PBIX SHA-256 values, source commit, API/GUID/version, and the automated/native evidence boundary
   into the owner-controlled certification notes; declare zero external network usage (empty
   privileges, audited). Do not claim certification before Microsoft completes its review.
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
