# Partner Center release handoff

## Repository preparation state (2026-09-17)

| Control | Observed state |
|---|---|
| GitHub repository | Public at <https://github.com/AtlynCo/powerbi-profile-lens>; current release source is `0c5caaa7abc244cc41fd484b27aa5d1157a50c18` |
| Lowercase certification branch | Public and matched to `main` at `0c5caaa7abc244cc41fd484b27aa5d1157a50c18` before this metadata follow-up |
| Partner Center | Latest report requires corrections for 100.14.1 Testing Instructions and 100.6.1 Privacy Policy; do not resubmit until the notes and privacy URL below are populated |
| Microsoft certification | **Not claimed**; no submission is performed here |
| GitHub visibility | **Public** |

The exact lowercase `certification` branch/package relationship remains a Microsoft submission
requirement. Promote only the reviewed metadata follow-up to both `main` and `certification`; the
PBIVIZ and PBIX bytes below must not change.

Nothing in this document claims Microsoft certification, approval, submission, or listing. The previous
Partner Center package, PBIX, and listing were OSM-enabled and must be replaced rather than reused.

| Requirement | Release value | Status |
|---|---|---|
| Visual | Atlyn Profile Lens, GUID `atlynProfileLens`, version `1.9.1.2` | Packaged |
| PBIVIZ | `dist/atlynProfileLens.1.9.1.2.pbiviz`; 725371 bytes; SHA-256 `447c985f36407fd044648605b688e0385ea37612c22cfaece4fa35242bd46c23` | Deterministic release artifact |
| API | `5.11.0` | Packaged |
| Listing price | Free | Owner decision |
| Support | <https://www.atlynco.com/docs/faq> | Recorded in `pbiviz.json` |
| Product privacy | <https://github.com/AtlynCo/powerbi-profile-lens/blob/certification/PRIVACY.md> | Use for the Partner Center Privacy policy link after the reviewed commit is on `certification` |
| Corporate privacy | <https://www.atlynco.com/legal/privacy> | Supplementary corporate website policy |
| Terms | <https://www.atlynco.com/legal/terms> | Use for the Partner Center form |
| EULA | `EULA.md` | Present |
| Third-party notices | `THIRD_PARTY_NOTICES.md` | Present and package-audited |
| Visualization icon | `assets/icon.png`, 20x20 PNG | Present and package-audited |
| Listing logo | `assets/partner-center-logo-300x300.png`, 300x300 PNG | Present |
| Screenshots | 1-5 native release screenshots | **Blocked: no safe native capture was completed** |
| Offline sample project | `samples/AtlynProfileLensSample/AtlynProfileLensSample.pbip` | Present (Demographics & Community Profile Demo) |
| Owner-created PBIX | `AtlynProfileLensSample.pbix`; 1191138 bytes; SHA-256 `af5c8c588592013fe4e03ccfeb0af405bb5f9544a1064d59b09f41c424c01563` | Saved/reopened with stable bytes; exact current payload and two active PBIR references verified |
| Embedded payload | 3318289 bytes; SHA-256 `50139e119669346310e0934cd7acd59cfcdb3fb7b047110053d515922fd75c25` | PBIP resource exactly matches the release PBIVIZ payload |
| Native evidence | Limited owner Save As/reopen evidence from 2026-09-09 | Stable bytes and two-page parity verified; not the full native checklist or Microsoft certification |

`package.json` remains the valid three-part npm/tooling version `1.9.1`; `pbiviz.json`, the embedded
sample metadata, the PBIVIZ filename, and Partner Center use the four-part Power BI visual version
`1.9.1.2`. This is intentional and is enforced by the certification audit.

## Demographics & Community Profile Sample (v1.9.1.2)

The offline PBIP sample (`samples/AtlynProfileLensSample/AtlynProfileLensSample.pbip`) showcases 10 comprehensive pages, led by a large local-only World 50m focus-lens hero with Automatic/Fill home, center probe, period slider, and three synthetic demographic profiles. Every data-bearing page opens on a populated profile, proven by a packaged-Chromium demo-page audit that mounts each page configuration and fails the build on zero profile marks. `npm run sample:focused` also creates a deterministic two-page native-review project under `dist/release`, led by that hero and followed by the USA Counties lens:
- **Demographic Indicators**: Residents, Median household income, Degree attainment rate, Health coverage rate, Labor force participation, and Housing cost burden, reported across five age bands and an urban/rural series.
- **Complete Key Coverage**: All 56 Census state and equivalent GEOIDs, all 3,235 packaged county and equivalent GEOIDs, and every country in the packaged 110m and 50m cartography, all read from the shipped context packs so every join is exact by construction.
- **Probe-driven Viewport Navigation**: Camera drag, wheel, pinch, and keyboard controls across Natural Earth 50m / 110m, US States, and US Counties with fixed-center probe interrogation and a data-bearing Home focus.
- **Bound Geographic Entities**: WGS84 point coordinates with locator inset plus complete offline world, state, and county context packs.
- **Isolated Engineering Diagnostics**: Deliberately padded, unmatched, case-folded, and duplicate keys live on one clearly titled diagnostics page, so no customer-facing page carries rejection warnings.
- **Zero Runtime Dependencies**: The semantic model is five offline DAX `DATATABLE` calculated tables requiring zero external data sources, credentials, or network connections. Values are produced by a deterministic function of the key and reproduce no real statistical source.
- **Embedded Custom Visual**: Embeds the exact `atlynProfileLens.1.9.1.2.pbiviz` package payload with verified SHA-256 byte parity.

## Final source, package, PBIX, and notes process

1. Use the final source URL and reviewed commit from `https://github.com/AtlynCo/powerbi-profile-lens`.
2. Run `npm run validate:certification` from a clean checkout and retain the generated PBIVIZ path,
   byte count, SHA-256, GUID, version, API version, and release manifest.
3. Use only the exact PBIX recorded above. Read-only inspection proves its embedded payload and two
   active canonical PBIR visual references match the PBIVIZ. It was closed and reopened with stable
   bytes. This does not claim the full native checklist or screenshots; the stale
   `d3e60d8b...d4e2bd` PBIX and all 1.9.1.0/1.9.1.1 files remain invalid for resubmission.
4. Paste [partner-center-testing-instructions.md](partner-center-testing-instructions.md) into the
   required Notes for certification field. Set the Privacy policy link to the product-specific public
   statement above. Do not substitute the corporate policy alone because it does not name Atlyn
   Profile Lens.

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
