# Partner Center release handoff

## Repository preparation state

| Control | Observed state |
|---|---|
| GitHub repository | Public at <https://github.com/AtlynCo/powerbi-profile-lens>; this 1.9.1.3 work is an isolated candidate branch |
| Lowercase certification branch | Public and frozen with `main` at `81c5f6ee00c8c550eda3341414076be17dceddd1` for published 1.9.1.2 |
| Partner Center | 1.9.1.2 published to Marketplace on 2026-09-29 after certification passed with notes; do not alter it from this candidate |
| Certification report | Policy 1180.2.3.1 is a soft required fix for the next submission: include sample-file hints and tips |
| Power BI certification badge | **Not independently verified**; Marketplace publication does not prove the separate badge |
| GitHub visibility | **Public** |

The exact lowercase `certification` branch/package relationship remains a Microsoft submission
requirement. Do not promote this candidate or change the published 1.9.1.2 PBIVIZ/PBIX bytes without
an explicit corrective-release decision.

Nothing in this document claims Microsoft certification, approval, submission, or listing.

| Requirement | Release value | Status |
|---|---|---|
| Visual | Atlyn Profile Lens, GUID `atlynProfileLens`, version `1.9.1.3` | Unsubmitted fallback candidate |
| PBIVIZ | `dist/atlynProfileLens.1.9.1.3.pbiviz`; 725387 bytes; SHA-256 `95376bade4423d9f022419945389554cff049ac082da51165a9f2c2a4d36d724` | Deterministic candidate artifact |
| API | `5.11.0` | Packaged |
| Listing price | Free | Owner decision |
| Support | <https://atlynco.github.io/atlyn-powerbi-support/docs/faq/> | Public first-party fallback recorded in `pbiviz.json`; no Profile-specific support page was found |
| Product privacy | <https://github.com/AtlynCo/powerbi-profile-lens/blob/certification/PRIVACY.md> | Use for the Partner Center Privacy policy link after the reviewed commit is on `certification` |
| Corporate privacy | <https://www.atlynco.com/legal/privacy> | Supplementary corporate website policy |
| Terms | <https://www.atlynco.com/legal/terms> | Use for the Partner Center form |
| EULA | `EULA.md` | Present |
| Third-party notices | `THIRD_PARTY_NOTICES.md` | Present and package-audited |
| Visualization icon | `assets/icon.png`, 20x20 PNG | Present and package-audited |
| Listing logo | `assets/partner-center-logo-300x300.png`, 300x300 PNG | Present |
| Screenshots | 1-5 native release screenshots | **Blocked: no safe native capture was completed** |
| Offline sample project | `samples/AtlynProfileLensSample/AtlynProfileLensSample.pbip` | Present (Demographics & Community Profile Demo) |
| Sample hints and tips | Visible textboxes on the focused World Lens and USA Counties pages | Source/PBIP candidate complete; native PBIX remains pending |
| Owner-created PBIX | None for 1.9.1.3 | Required before any future submission; never reuse or relabel the 1.9.1.2 PBIX |
| Embedded payload | 3318314 bytes; SHA-256 `bda677602bee6649dca7bb25fe19e556a028c7e398c64534f3075ed04c93a676` | PBIP resource exactly matches the candidate PBIVIZ payload |
| Native evidence | None for 1.9.1.3 | Shared Power BI Desktop was not used for this candidate |

`package.json` remains the valid three-part npm/tooling version `1.9.1`; `pbiviz.json`, the embedded
sample metadata, the PBIVIZ filename, and Partner Center use the four-part Power BI visual version
`1.9.1.3`. This is intentional and is enforced by the certification audit.

The published 1.9.1.2 release remains bound to PBIVIZ SHA-256
`447c985f36407fd044648605b688e0385ea37612c22cfaece4fa35242bd46c23` and PBIX SHA-256
`af5c8c588592013fe4e03ccfeb0af405bb5f9544a1064d59b09f41c424c01563`.
Those artifacts are historical evidence for the published release, not 1.9.1.3 candidate inputs.

## Demographics & Community Profile Sample (v1.9.1.3)

The offline PBIP sample (`samples/AtlynProfileLensSample/AtlynProfileLensSample.pbip`) showcases 10 comprehensive pages, led by a large local-only World 50m focus-lens hero with Automatic/Fill home, center probe, period slider, and three synthetic demographic profiles. Every data-bearing page opens on a populated profile, proven by a packaged-Chromium demo-page audit that mounts each page configuration and fails the build on zero profile marks. `npm run sample:focused` also creates a deterministic two-page native-review project under `dist/release`, led by that hero and followed by the USA Counties lens:
- **Demographic Indicators**: Residents, Median household income, Degree attainment rate, Health coverage rate, Labor force participation, and Housing cost burden, reported across five age bands and an urban/rural series.
- **Complete Key Coverage**: All 56 Census state and equivalent GEOIDs, all 3,235 packaged county and equivalent GEOIDs, and every country in the packaged 110m and 50m cartography, all read from the shipped context packs so every join is exact by construction.
- **Probe-driven Viewport Navigation**: Camera drag, wheel, pinch, and keyboard controls across Natural Earth 50m / 110m, US States, and US Counties with fixed-center probe interrogation and a data-bearing Home focus.
- **Bound Geographic Entities**: WGS84 point coordinates with locator inset plus complete offline world, state, and county context packs.
- **Isolated Engineering Diagnostics**: Deliberately padded, unmatched, case-folded, and duplicate keys live on one clearly titled diagnostics page, so no customer-facing page carries rejection warnings.
- **Zero Runtime Dependencies**: The semantic model is five offline DAX `DATATABLE` calculated tables requiring zero external data sources, credentials, or network connections. Values are produced by a deterministic function of the key and reproduce no real statistical source.
- **Embedded Custom Visual**: Embeds the exact `atlynProfileLens.1.9.1.3.pbiviz` package payload with verified SHA-256 byte parity.
- **Visible Guidance**: Both focused pages contain product-specific Hints & tips textboxes for probe
  navigation, zoom, profile reading, and Home/Reset behavior, addressing the Policy 1180.2.3.1 note.

## Final source, package, PBIX, and notes process

1. Use the final source URL and reviewed commit from `https://github.com/AtlynCo/powerbi-profile-lens`.
2. Run `npm run validate:certification` from a clean checkout and retain the generated PBIVIZ path,
   byte count, SHA-256, GUID, version, API version, and release manifest.
3. Create a genuine 1.9.1.3 PBIX from the matching focused PBIP after the 1.9.1.2 review concludes,
   then verify its GUID, version, embedded payload, active references, reopen stability, and hash.
4. Only after those checks, finalize
   [partner-center-testing-instructions.md](partner-center-testing-instructions.md) with the PBIX
   bytes and hash. Set the Privacy policy link to the product-specific public statement above and
   replace the separate Partner Center Support property with the verified FAQ URL.

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

The offer remains a free distribution of the visual. Version 1.9.1.2 is published to Marketplace;
this 1.9.1.3 fallback candidate has not been uploaded or submitted. The separate Power BI
certification badge remains unverified and unclaimed.
