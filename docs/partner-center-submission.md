# Partner Center release handoff

## Repository preparation state (2026-08-27)

| Control | Observed state |
|---|---|
| GitHub repository | Public at <https://github.com/AtlynCo/powerbi-profile-lens>; release base is merge commit `7f7b68135fc53762bbbe6c5956b256ce43ca6f30` (tree `f14534a751bb05cce789379ad4bc37aa2541852c`) |
| Lowercase certification branch | Public and fixed at `7b7bebbc52eab6fbf18d55403ab6e90736d30c39` before this follow-up; not modified here |
| Partner Center | Owner uploaded and hash-verified replacement files separately; submission is paused pending review of this parity follow-up |
| Microsoft certification | **Not claimed**; no submission is performed here |
| GitHub visibility | **Public** |

The exact lowercase `certification` branch/package relationship remains a Microsoft submission
requirement. The existing branch records the public-source baseline, not this unreviewed follow-up.
Do not modify it or change Partner Center during this work.

Nothing in this document claims Microsoft certification, approval, submission, or listing. The previous
Partner Center package, PBIX, and listing were OSM-enabled and must be replaced rather than reused.

| Requirement | Release value | Status |
|---|---|---|
| Visual | Atlyn Profile Lens, GUID `atlynProfileLens`, version `1.9.1.1` | Packaged |
| PBIVIZ | `dist/atlynProfileLens.1.9.1.1.pbiviz`; 725104 bytes; SHA-256 `6fbf09d949b00ecc2c46b1ca09d6ab2ca691dac9e871a4a6f50eb0998d00d228` | Deterministic release artifact |
| API | `5.11.0` | Packaged |
| Listing price | Free | Owner decision |
| Support | <https://www.atlynco.com/docs/faq> | Recorded in `pbiviz.json` |
| Privacy | <https://www.atlynco.com/legal/privacy> | Use for the Partner Center form |
| Terms | <https://www.atlynco.com/legal/terms> | Use for the Partner Center form |
| EULA | `EULA.md` | Present |
| Third-party notices | `THIRD_PARTY_NOTICES.md` | Present and package-audited |
| Visualization icon | `assets/icon.png`, 20x20 PNG | Present and package-audited |
| Listing logo | `assets/partner-center-logo-300x300.png`, 300x300 PNG | Present |
| Screenshots | 1-5 native release screenshots | **Blocked: no safe native capture was completed** |
| Offline sample project | `samples/AtlynProfileLensSample/AtlynProfileLensSample.pbip` | Present (Demographics & Community Profile Demo) |
| Owner-created PBIX | No matching 1.9.1.1 PBIX | Prior-version PBIX must not be reused or relabeled |
| Embedded payload | 3316936 bytes; SHA-256 `870994f4d7bacb612212415772353ef0497b392eb1b818174357ce27309b4060` | PBIP resource exactly matches the release PBIVIZ payload |
| Native evidence | No 1.9.1.1 native record | **Unavailable; manual Save As is not native checklist or offline-reopen evidence** |

## Demographics & Community Profile Sample (v1.9.1.1)

The offline PBIP sample (`samples/AtlynProfileLensSample/AtlynProfileLensSample.pbip`) showcases 14 comprehensive pages, led by a large local-only World 50m focus-lens hero with Automatic/Fill home, center probe, period slider, and three synthetic demographic profiles. Every data-bearing page opens on a populated profile, proven by a packaged-Chromium demo-page audit that mounts each page configuration and fails the build on zero profile marks:
- **Demographic Indicators**: Residents, Median household income, Degree attainment rate, Health coverage rate, Labor force participation, and Housing cost burden, reported across five age bands and an urban/rural series.
- **Complete Key Coverage**: All 56 Census state and equivalent GEOIDs, a multi-hundred county subset spanning sixteen states and equivalents including every island area, and every country in the packaged 110m and 50m cartography, all read from the shipped context packs so every join is exact by construction.
- **Probe-driven Viewport Navigation**: Camera drag, wheel, pinch, and keyboard controls across Natural Earth 50m / 110m, US States, and US Counties with fixed-center probe interrogation and a data-bearing Home focus.
- **Bound Geographic Entities & Matrices**: WGS84 point coordinates with locator inset, custom WKT polygon geometries with focus lens, nongeographic grid and hex matrices, and progressive authoring.
- **Isolated Engineering Diagnostics**: Deliberately padded, unmatched, case-folded, and duplicate keys live on one clearly titled diagnostics page, so no customer-facing page carries rejection warnings.
- **Zero Runtime Dependencies**: The semantic model is five offline DAX `DATATABLE` calculated tables requiring zero external data sources, credentials, or network connections. Values are produced by a deterministic function of the key and reproduce no real statistical source.
- **Embedded Custom Visual**: Embeds the exact `atlynProfileLens.1.9.1.1.pbiviz` package payload with verified SHA-256 byte parity.

## Final source, package, PBIX, and notes process

1. Use the final source URL and reviewed commit from `https://github.com/AtlynCo/powerbi-profile-lens`.
2. Run `npm run validate:certification` from a clean checkout and retain the generated PBIVIZ path,
   byte count, SHA-256, GUID, version, API version, and release manifest.
3. Create a new matching PBIX from the exact 1.9.1.1 PBIP/package. Its embedded payload and active
   canonical PBIR visual references must be proven by `scripts/sample-resource-parity.cjs`. The prior guarded
   run on Desktop 2.157.879.0 was blocked because Save As controls `1001` and `1` exposed no safe UI
   Automation patterns. No offline reopen, native checklist, or screenshots were recorded, so the
   1.9.1.0 PBIX is not evidence for this release.
4. Put the source commit, PBIVIZ/PBIX hashes, automated results, native limitations, and the
   zero-privilege/no-external-request statement in the certification notes. The owner then replaces
   the failed Partner Center materials; this repository does not upload or edit the offer.

## Source and artifact parity

After Microsoft identifies the reviewed commit and package, promote that exact commit to the existing
lowercase `certification` branch without rewriting unrelated history. Build from that reviewed commit
with the committed lockfile and run `npm run validate:certification`. The release manifest must name
the same commit, GUID, version, API version, PBIVIZ SHA-256, context-pack hashes, and sample resources
used for validation. This follow-up does not move the existing baseline branch.
Two package builds under `Etc/GMT+12` and `Etc/GMT-14` must remain byte-identical.

Do not submit until Power BI Desktop has produced the versioned PBIX from the exact PBIP, the PBIX
has been closed and reopened offline, every page and critical interaction has been observed, bytes
remain stable when no save occurs, and its embedded custom-visual GUID/version/payload match the
release PBIVIZ. Record unavailable surfaces as unproven.

## Submission boundary

The offer remains a free distribution of the visual. The owner uploaded replacement files separately,
but did not submit. Microsoft review, certification, Service publication, and dashboard pinning remain
unperformed and unclaimed.
