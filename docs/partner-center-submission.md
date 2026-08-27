# Partner Center release handoff

## Repository preparation state (2026-08-27)

| Control | Observed state |
|---|---|
| GitHub repository | Source URL `AtlynCo/powerbi-profile-lens`; default branch `main` |
| Lowercase certification branch | **Not present on `origin`**; no branch was created or modified by this preparation |
| Partner Center | Previous submission **failed: repository access**; replacement is owner-controlled and not performed here |
| Microsoft certification | **Not claimed**; the reviewed commit and submitted package are not established here |
| GitHub visibility transition | **Not performed**; owner/admin action remains outstanding |

The public offer and the exact lowercase `certification` branch/package relationship are Microsoft
requirements. Do not infer either one from this document, create a guessed certification branch, or
change Partner Center visibility during repository preparation.

Nothing in this document claims Microsoft certification, approval, submission, or listing. The previous
Partner Center package, PBIX, and listing were OSM-enabled and must be replaced rather than reused.

| Requirement | Release value | Status |
|---|---|---|
| Visual | Atlyn Profile Lens, GUID `atlynProfileLens`, version `1.9.1.0` | Packaged |
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
| Genuine offline PBIX | `dist/release/AtlynProfileLensSample-1.9.1.0.pbix` | **Blocked: not produced** |
| Native evidence | No 1.9.1.0 native record | **Not run; 1.2.0.0 evidence is historical only** |

## Demographics & Community Profile Sample (v1.9.1.0)

The offline PBIP sample (`samples/AtlynProfileLensSample/AtlynProfileLensSample.pbip`) showcases 14 comprehensive pages, led by a large local-only World 50m focus-lens hero with Automatic/Fill home, center probe, period slider, and three synthetic demographic profiles. Every data-bearing page opens on a populated profile, proven by a packaged-Chromium demo-page audit that mounts each page configuration and fails the build on zero profile marks:
- **Demographic Indicators**: Residents, Median household income, Degree attainment rate, Health coverage rate, Labor force participation, and Housing cost burden, reported across five age bands and an urban/rural series.
- **Complete Key Coverage**: All 56 Census state and equivalent GEOIDs, a multi-hundred county subset spanning sixteen states and equivalents including every island area, and every country in the packaged 110m and 50m cartography, all read from the shipped context packs so every join is exact by construction.
- **Probe-driven Viewport Navigation**: Camera drag, wheel, pinch, and keyboard controls across Natural Earth 50m / 110m, US States, and US Counties with fixed-center probe interrogation and a data-bearing Home focus.
- **Bound Geographic Entities & Matrices**: WGS84 point coordinates with locator inset, custom WKT polygon geometries with focus lens, nongeographic grid and hex matrices, and progressive authoring.
- **Isolated Engineering Diagnostics**: Deliberately padded, unmatched, case-folded, and duplicate keys live on one clearly titled diagnostics page, so no customer-facing page carries rejection warnings.
- **Zero Runtime Dependencies**: The semantic model is five offline DAX `DATATABLE` calculated tables requiring zero external data sources, credentials, or network connections. Values are produced by a deterministic function of the key and reproduce no real statistical source.
- **Embedded Custom Visual**: Embeds the exact `atlynProfileLens.1.9.1.0.pbiviz` package payload with verified SHA-256 byte parity.

## Final source, package, PBIX, and notes process

1. Use the final source URL and reviewed commit from `https://github.com/AtlynCo/powerbi-profile-lens`.
2. Run `npm run validate:certification` from a clean checkout and retain the generated PBIVIZ path,
   byte count, SHA-256, GUID, version, API version, and release manifest.
3. Open the generated PBIP in Power BI Desktop, import the exact PBIVIZ, use Save As to create
   `dist/release/AtlynProfileLensSample-1.9.1.0.pbix`, close and reopen it offline, and record the
   PBIX hash plus the native pass/fail boundary. If UI Automation cannot safely complete Save As,
   the owner must perform that manual step; no OSM-enabled or fabricated artifact may be submitted.
4. Put the source commit, PBIVIZ/PBIX hashes, automated results, native limitations, and the
   zero-privilege/no-external-request statement in the certification notes. The owner then replaces
   the failed Partner Center materials; this repository does not upload or edit the offer.

## Source and artifact parity

After Microsoft identifies the reviewed commit and package, promote that exact commit to a lowercase
`certification` branch without rewriting it. Build from that reviewed commit with the committed
lockfile and run `npm run validate:certification`. The release manifest must name the same commit,
GUID, version, API version, PBIVIZ SHA-256, context-pack hashes, and sample resources used for native
validation. This preparation branch does not establish the reviewed commit or create that branch.
Two package builds under `Etc/GMT+12` and `Etc/GMT-14` must remain byte-identical.

Do not submit until Power BI Desktop has produced the versioned PBIX from the exact PBIP, the PBIX
has been closed and reopened offline, every page and critical interaction has been observed, bytes
remain stable when no save occurs, and its embedded custom-visual GUID/version/payload match the
release PBIVIZ. Record unavailable surfaces as unproven.

## Submission boundary

The offer remains a free distribution of the visual. Partner Center upload, replacement of the old
OSM-enabled listing materials, Microsoft review, certification, Service publication, and dashboard
pinning are owner-controlled steps and were not performed by this release-preparation work.
