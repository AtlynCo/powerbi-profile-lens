# Atlyn Profile Lens

A Power BI custom visual for comparing one to six report-bound measures across ordered bands, with
optional entity context. All values and labels come from the report semantic model.

## Context and layouts

`Context > Provider` supports:

| Mode | Input |
|---|---|
| `none` | No context surface |
| `points` | Bound WGS84 `Latitude` and `Longitude` measures |
| `boundGeometry` | Strict GeoJSON Geometry/Feature or WKT Point, MultiPoint, Polygon, MultiPolygon |
| `grid` | Deterministic nongeographic cells generated from entities |
| `hex` | Deterministic nongeographic hexagons generated from entities |

GeoJSON `GeometryCollection`, unknown CRS, unrecognized geometry, and coordinates outside WGS84
ranges are rejected. A GeoJSON `crs` name, when present, must exactly match `CRS84`, `EPSG:4326`,
`EPSG::4326`, `urn:ogc:def:crs:OGC:1.3:CRS84`, or `urn:ogc:def:crs:EPSG::4326`
(case-insensitive, with no added prefix, suffix, or whitespace). The visual contains no geography
packs or domain-specific interpretation.
Layouts are `split`, `focusLens`, `locatorInset`, and `profileOnly`, with deterministic responsive
fallbacks at small sizes.

Rendering is adaptive: SVG is used only when a scene has at most 500 features **and** at most 20,000
vertices; larger accepted scenes use Canvas. Both renderers expose the same selection identities,
tooltips, focus state, labels, and semantic descriptions.

## Field wells

One matrix mapping is used:

| Well | Kind | Limit | Meaning |
|---|---|---:|---|
| `Entity > Period > Band` | Grouping | 3 | Entity, optional period, ordered band |
| `Series` | Grouping | 1 | Optional split; at most two values render |
| `Profile measures` | Measure | 6 | Nonnegative measures rendered as profile arms |
| `Context value` | Measure | 1 | Optional entity value for context and tooltip text |
| `Latitude` / `Longitude` | Measure | 1 each | WGS84 point pair |
| `Custom geometry text` | Measure | 1 | Strict GeoJSON or WKT |
| `Tooltips` | Grouping or measure | 10 | Native tooltip fields |

No condition requires a role, so progressive field assignment remains possible. Hierarchy order is
fixed; model *Sort by column* controls band order.

## Preprocessing and limits

Each update validates finite numeric values, coordinate pairs, geometry grammar, nesting, rings, and
vertices before producing a bounded context scene. Invalid features are diagnosed and excluded;
valid input is never repaired, guessed, reprojected, or silently reinterpreted.

| Bound | Value |
|---|---:|
| UTF-16 characters per geometry value | 32,000 |
| Geometry characters per update | 2,000,000 |
| JSON nesting depth | 12 |
| Rings per feature | 256 |
| Vertices per feature | 4,096 |
| Vertices per scene | 100,000 |
| WKT tokens | 16,384 |
| Entities / context features | 1,000 |
| Profile measures / series values | 6 / 2 |
| Periods / bands / tooltip fields | 100 / 100 / 10 |
| Retained matrix cells / segment requests | 120,000 / 4 |

The 32,000-character value bound is tied to Power BI text-value constraints. The 2,000,000-character
budget is an additional per-update safety bound.

The visual reads report data only. It performs no file access, upload, external request, tile lookup,
geocoding, or other network operation; privileges are `[]`. It contains no `eval` or `Function`
construction.

## Loading modes

Detail strategies `auto`, `eager`, `segmented`, and `external` are shipped. `auto` selects segmented
loading when the host supplies a segment marker and otherwise uses eager loading. Segmented requests
are bounded. `external` treats report filtering as authoritative.

The internal `matrixExpand` interface reports unavailable. Capabilities intentionally omit
`expandCollapse` and `drilldown` until a real native Power BI host spike proves the contract.

## Interaction and accessibility

Context features use entity-level matrix identities; profile marks retain bucket-level identities.
The default entity activation mode focuses locally and selects through the host. Authors can choose
local-only or explicit report-filter behavior; the latter writes only `general.filter` and restores
focus from `jsonFilters`. Right-click invokes either the data-point or empty-space native context menu
once, and native tooltips follow the pointer. Slicers, cross-filters, highlights, RLS, and host
selection state remain authoritative. When the host disables interactions, no selection, filter,
tooltip, focus mutation, or context-menu call is made.

Keyboard focus is roving and restored by stable key. Arrow keys navigate, Enter/Space select, and
Escape returns focus to the visual. SVG and Canvas provide semantic parity through the same accessible
status, feature descriptions, and profile table. High contrast, RTL, and reduced motion are supported;
information is not conveyed by color alone.

## Provider extension contract

A provider declares an ID and supported modes, checks whether it can handle a bounded
`ContextProviderInput`, and returns a `ContextScene` of features, metrics, diagnostics, and partial
state. Features carry entity identity, geometry, context value, and tooltip data. Renderers consume
only that scene contract; providers do not access the DOM or host services. See
[docs/architecture.md](docs/architecture.md).

## Sample project

`samples/AtlynProfileLensSample` is an offline PBIP project generated by `npm run sample:pbip`. It
keeps the original two profile pages and adds three pages for nongeographic grid/hex entities, bound
WGS84 points, and simple bound polygons. Its semantic model is only a synthetic DAX `DATATABLE` with
generic product, team, facility, seat, period, band, series, and metric labels. It has no data source,
credentials, refresh, upload, or network dependency.

If `dist` exists, generation embeds the exact packaged visual resource; otherwise it warns and still
writes the source project. **No PBIX is produced or claimed.**

This artifact is not Partner Center submission-ready or certification-complete. Before submission, a
native offline PBIX must be created from the PBIP in Power BI Desktop, must embed this exact PBIVIZ
hash, and must be closed, reopened, and validated with the native checklist. That PBIX must then be
added to the submission materials. The repository never fabricates a PBIX.

## Development

```powershell
npm install
npm run checks
npm run typecheck
npm run lint
npm test
npm run package
npm run audit:certification
npm run probe:browser
npm run audit:npm
npm run audit:reproducible
npm run release:manifest
npm run sample:pbip
npm run validate:certification
```

`npm run package` preserves the deterministic release convention: sorted ZIP entries, fixed
UTC-anchored timestamp, DEFLATE level 9, and normalized platform metadata. The release manifest
records the package SHA-256 and proof boundary.

## Proof boundary

Repository checks cover deterministic parsing and bounds, SVG/Canvas policy, provider/layout logic,
interaction call counts, accessibility semantics, lifecycle, package reproducibility, and absence of
network requests from the packaged bundle in Chromium.

They do not prove native Desktop field-well behavior, segmentation, bookmarks, service behavior,
exports, dashboard pinning, DirectQuery/Direct Lake behavior, or native expand/collapse/drilldown.
Run [docs/desktop-validation.md](docs/desktop-validation.md) against the exact package hash.

Certification and Partner Center submission readiness are not claimed; Microsoft review is separate.

## License

MIT. See [LICENSE](LICENSE).
