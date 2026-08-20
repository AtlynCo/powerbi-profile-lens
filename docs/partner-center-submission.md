# Partner Center release handoff

Nothing in this document claims Microsoft certification, approval, submission, or listing.

| Requirement | Release value | Status |
|---|---|---|
| Visual | Atlyn Profile Lens, GUID `atlynProfileLens`, version `1.4.0.0` | Packaged |
| API | `5.11.0` | Packaged |
| Listing price | Free | Owner decision |
| Support | <https://atlyn.io/contact> | Recorded in `pbiviz.json` |
| Privacy | <https://atlyn.io/legal/privacy> | Use for the Partner Center form |
| EULA | `EULA.md` | Present |
| Third-party notices | `THIRD_PARTY_NOTICES.md` | Present and package-audited |
| Visualization icon | `assets/icon.png`, 20x20 PNG | Present and package-audited |
| Listing logo | `assets/partner-center-logo-300x300.png`, 300x300 PNG | Present |
| Screenshots | 1-5 native release screenshots | **Blocked: no safe native capture was completed** |
| Offline sample project | `samples/AtlynProfileLensSample/AtlynProfileLensSample.pbip` | Present (Demographics & Community Profile Demo) |
| Genuine offline PBIX | `dist/release/AtlynProfileLensSample-1.4.0.0.pbix` | **Blocked: not produced** |
| Native evidence | No 1.4.0.0 native record | **Not run; 1.2.0.0 evidence is historical only** |

## Demographics & Community Profile Sample (v1.4.0.0)

The offline PBIP sample (`samples/AtlynProfileLensSample/AtlynProfileLensSample.pbip`) showcases 13 comprehensive pages exercising:
- **Demographic Metric Dimensions**: Population Distribution by Age Band, Household Income Brackets, Educational Attainment, Community Health Indicators, Labor Force Participation, and Housing & Infrastructure Index.
- **Probe-driven Viewport Navigation**: Camera drag, wheel, pinch, and keyboard controls across Natural Earth 50m / 110m, US States, and US Counties with fixed-center probe interrogation.
- **Bound Geographic Entities & Matrices**: WGS84 point coordinates with locator inset, custom WKT polygon geometries with focus lens, nongeographic grid and hex matrices, and progressive authoring.
- **Zero Runtime Dependencies**: The semantic model is an offline DAX `DATATABLE` calculated table requiring zero external data sources, credentials, or network connections.
- **Embedded Custom Visual**: Embeds the exact `atlynProfileLens.1.4.0.0.pbiviz` package payload with verified SHA-256 byte parity.

## Source and artifact parity

Build from the tagged release commit on the certification branch with the committed lockfile and
run `npm run validate:certification`. The release manifest must name the same commit, GUID, version,
API version, PBIVIZ SHA-256, context-pack hashes, and sample resources used for native validation.
Two package builds under `Etc/GMT+12` and `Etc/GMT-14` must remain byte-identical.

Do not submit until Power BI Desktop has produced the versioned PBIX from the exact PBIP, the PBIX
has been closed and reopened offline, every page and critical interaction has been observed, bytes
remain stable when no save occurs, and its embedded custom-visual GUID/version/payload match the
release PBIVIZ. Record unavailable surfaces as unproven.

## Submission boundary

The offer remains a free distribution of the visual. Partner Center upload, Microsoft review,
certification, Service publication, and dashboard pinning are owner-controlled steps and were not
performed by this release-preparation work.

