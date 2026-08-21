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
| `builtInPack` | Exact-key offline world countries, US states/equivalents, or US counties/equivalents |

GeoJSON `GeometryCollection`, unknown CRS, unrecognized geometry, and coordinates outside WGS84
ranges are rejected. A GeoJSON `crs` name, when present, must exactly match `CRS84`, `EPSG:4326`,
`EPSG::4326`, `urn:ogc:def:crs:OGC:1.3:CRS84`, or `urn:ogc:def:crs:EPSG::4326`
(case-insensitive, with no added prefix, suffix, or whitespace).

Built-in packs are optional cartographic resources only:

- Natural Earth 5.1.1 Admin-0 countries and professional offline land, lake,
  coastline, boundary, graticule, and bounded label reference layers at 110m by
  default, with a 50m detail choice;
- 2025 Census 5m states/equivalents with derived land/coast, fixed-width state
  hierarchy, bounded abbreviations, and labeled inset frames for every territory;
- 2025 Census 5m counties/equivalents with county boundaries revealed above
  useful zoom, state outlines derived from county `STATEFP` topology, and bounded
  county labels, including all island-area equivalents.

World keys are exact uppercase ISO alpha-3 or documented generated `NE:` fallbacks. Valid,
collision-free `ISO_A3_EH` values supply ordinary ISO keys when `ISO_A3` is invalid, including
`FRA` and `NOR`; `NE:` is reserved for entities without an accepted ISO key. State keys are
exact two-digit GEOID text; county keys are exact five-digit GEOID text. No mode trims, pads,
coerces numbers, or fuzzy-matches names. See [built-in context packs](docs/context-packs.md).
Layouts are `split`, `focusLens`, `locatorInset`, and `profileOnly`, with deterministic responsive
fallbacks at small sizes.

Rendering is adaptive: SVG is used only when a scene has at most 500 features **and** at most 20,000
vertices; larger accepted scenes use Canvas. Both renderers expose the same selection identities,
tooltips, focus state, labels, and semantic descriptions.

`Navigation > Viewport navigation` is `Automatic` by default. Automatic mode activates for an
interactive, non-profile-only Context scene with multiple navigable features. Persisted legacy
`false`/`true` values migrate to explicit `Off`/`On`, so reports that explicitly disabled navigation
remain static. When active, left-drag and one-finger drag pan; wheel, trackpad, and two-pointer pinch zoom;
Shift+Arrow pans; and `+`/`-` zooms. `Navigation > Home view` defaults to `Automatic`: multi-feature
built-in maps, points, and bound geometry start and reset to `Fill`, while grid, hex, and
non-navigable contexts use `Fit`. Explicit `Fit` and `Fill` remain author-controlled.
`Navigation > Home focus` also defaults to `Automatic`, which centers Home on a bound Entity that has
loaded profile detail whenever a built-in pack paints a complete backdrop over a partially bound
report, so the fixed center probe opens on a populated profile instead of the geometric center of the
whole map. Generated and bound scenes derive their bounds from the bound Entities themselves and keep
the geometric center, and `Scene center` restores it everywhere. The anchor is the bound candidate
nearest the centroid of all bound candidates, so it is deterministic, and it degrades to the geometric
center when nothing is bound. Home focus is a local camera placement only: it never selects, it moves
the camera only on a fresh scene or while the camera is still at Home, and it never overrides a
deliberate pan or zoom. Home or the
reset control returns to this resolved home camera; the configured minimum zoom remains reachable
for the complete fitted extent. Zoom is anchored under the cursor or pinch midpoint. The default
range is 1 through 8, bounded pan keeps the scene from being lost, and valid resize preserves the
viewed scene center unless the camera is still at Home, in which case the resized Home view is
recomputed.

Pinch uses one gesture-start camera snapshot: zoom and midpoint translation are solved together and
clamped once, so reaching an edge or zoom limit does not introduce an incremental jump. While
navigation is active, finite nonzero wheel input is contained inside the viewport even when the camera
is already at minimum or maximum zoom; zero, invalid, disabled, and navigation-off input is left to the
host. A pending wheel settle is generation-checked and cancelled when pointer, pinch, click, spatial
keyboard, reset, rebind, disable, or destroy takes ownership, so a stale timer cannot refocus or
select. A host-authoritative external selection also cancels pending wheel and current drag/pinch
settle ownership without rolling back the camera. High-contrast probe, help, focus, and reset chrome use the host foreground, background, and
selected colors through resolved theme variables.

The fixed center probe is the local profile source while navigation is active. The viewport moves
beneath it; crossing a feature boundary updates the focused outline, connector, Entity title, profile,
accessible table, and status without a click. Built-in packs always keep their complete declared
backdrop (177/242 world, 56 state/equivalent, or 3,235 county/equivalent features), while only exact
report matches carry analytical values, tooltips, highlights, and Power BI identities. Known unbound
features show `No data in current report context`; unloaded detail and no-feature states are distinct
and never retain the prior profile. A selected built-in pack remains a navigable, semantic backdrop
even when the current DataView has zero Entity rows or no renderable profile fields.

When a frame carries no cells at all — no feature, an unbound feature, unloaded detail, zero rows, or
no renderable roles — the chart draws no skeleton. The axis, band labels, metric captions, and value
labels are suppressed together, and one centered, bounded card carries the current state message and
the single action that resolves it. The card is decorative and `aria-hidden`, because the same text
is already announced by the header state, the status line, and the accessible table, all of which are
unchanged. The card degrades with the density tiers and stays inside an 80x80 tile, and no-data states
still make no host selection.

In `focusLens` the chart is contained: a translucent scrim dims the cartography around a clear
circular aperture on the fixed center probe, and every arm is anchored outside that aperture, so the
chart reads as one instrument over a dimmed map rather than loose marks over a live one. The scrim
and aperture are decorative and never participate in picking, selection, tooltips, or semantics; they
are inert for `split`, `locatorInset`, and `profileOnly`, inert in high contrast where the host owns
both colors, and can be switched off with **Profiles > Dim map around lens**.

Band labels are drawn on every arm, anchored to the band they describe. A mirrored arm carries them
in a gutter on its own axis, exactly where a population pyramid carries its age scale; an unmirrored
arm carries them against the baseline. Every chart label goes through one deterministic, capped
placement pass: labels are placed in priority order, a colliding label is staggered and then skipped
rather than drawn on top of another, and an explicit per-tier cap bounds the visible count. Value
labels are on by default at the largest size tier and each arm carries a scale annotation naming its
axis maximum and, for proportional modes, the normalization that defines the unit. Reports that
explicitly turned value labels off keep them off.

An optional fallback Entity key is exact raw bound text. It applies only over no feature, is visibly
disclosed, and is never silently inferred as `WLD`; it never masks a known no-data feature. Authors can
hide unbound base paint while keeping the complete backdrop probeable, navigable, and semantic.

Camera movement is local. `localOnly` never calls the host. In `reportSelection`, a user movement
settle commits at most one final directly matched, loaded Entity with an identity; no-data,
unloaded, no-feature, and fallback states are not selected. Explicit click/Enter/Space remains one
activation call. Every visual-owned profile/context selection is serialized through one coordinator:
one host promise is in flight, superseded single-select intent is coalesced, explicit multi-select is
queued in order, and an external callback invalidates queued local work. An already in-flight host
call cannot be cancelled and may remain the unavoidable last writer; when it completes, the visual
reconciles overlays from the manager's actual selection without changing local probe/profile focus.
SVG changes one camera group transform. Canvas reuses a bounded base raster and
inverse-transformed picking surface; neither renderer rebuilds geometry or picking on probe changes.
Reference land, coast/exterior, state/county hierarchy, inset frames, and
screen-space labels never enter picking, tooltips, semantic options, or host selection.
Inertia, rotation, double-click zoom, and live tiles remain absent.

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
| Entities / built-in pack features / untrusted context features | 4,000 / 4,000 / 1,000 |
| Profile measures / series values | 6 / 2 |
| Periods / bands / tooltip fields | 100 / 100 / 10 |
| Retained matrix cells / segment requests | 120,000 / 4 |

The 32,000-character value bound is tied to Power BI text-value constraints. The 2,000,000-character
budget is an additional per-update safety bound.

The visual reads report data and bundled offline cartographic assets only. It performs no file access,
upload, external request, tile lookup, geocoding, or other network operation; privileges are `[]`.
It contains no `eval` or `Function` construction. Built-in packs contain geometry, exact keys, names,
source status, centroids, adjacency, vintage, and attribution, never analytical observations.

## Loading modes

Detail strategies `auto`, `eager`, `segmented`, and `external` are shipped. `auto` selects segmented
loading when the host supplies a segment marker and otherwise uses eager loading. Segmented requests
are bounded. `external` treats report filtering as authoritative.

The internal `matrixExpand` interface reports unavailable. Capabilities intentionally omit
`expandCollapse` and `drilldown` until a real native Power BI host spike proves the contract.

## Interaction and accessibility

Context Entity bindings use entity-level matrix identities; profile marks retain bucket-level identities.
The default entity activation mode focuses locally and selects through the host. Authors can choose
local-only behavior instead. Right-click invokes either the data-point or empty-space native context
menu once, and native tooltips follow the pointer. External slicers, cross-filters, highlights, RLS,
and host selection state remain authoritative read-only inputs. The visual never writes an outward
filter. When the host disables interactions, no selection, tooltip, focus or camera mutation,
gesture capture, wheel prevention, context-menu call, or navigation host call is made; the current
camera remains rendered statically.

Keyboard focus is roving and restored by stable key. Plain Arrow keys browse backdrop features,
Shift+Arrow pans the viewport, `+`/`-` zooms, Home resets, Enter/Space selects, and Escape returns
focus to the visual. The context remains one Tab stop; the pointer reset control is not a second
sequential stop. SVG and Canvas provide semantic parity through the same accessible status, probe
announcements, data-bearing/no-data/unloaded feature descriptions, and profile table. Announcements
are concise or detailed, deduplicated, and bounded to one trailing update. High contrast, RTL, and
reduced motion are supported; information is not conveyed by color alone.

Arrow navigation changes local focus only; it never selects or filters by itself. Pointer click or
Enter/Space is activation: local-only mode performs no host mutation, report-selection mode selects
the entity identity. Outward report filtering is not a v1 feature.

## Provider extension contract

A provider declares an ID and supported modes, checks whether it can handle a bounded
`ContextProviderInput`, and returns a `ContextScene` containing one complete geometry backdrop plus
optional feature-to-Entity bindings. Geometry is stored once; bindings carry Entity identity,
context value, and tooltip data. Renderers consume only that scene contract; providers do not access
the DOM or host services. See
[docs/architecture.md](docs/architecture.md).

## Sample project

`samples/AtlynProfileLensSample` is an offline PBIP project generated by `npm run sample:pbip`. It
opens on a large local-only World 50m `focusLens` hero with Automatic/Fill home, a fixed center
probe, period slider, and three synthetic demographic profiles. The remaining engineering pages
cover nongeographic grid/hex entities, bound WGS84 points, simple bound polygons, world countries,
polished US state and county hierarchy pages with explicit inset instructions, report-selection integration, normalization, and
progressive authoring. Its semantic model is only a synthetic DAX
`DATATABLE`; every metric is openly synthetic. It has no data source, credentials, refresh, upload,
or network dependency.

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
npm run packs:fetch
npm run packs:build
npm run packs:validate
npm run packs:verify
npm run packs:repro
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

Repository checks cover deterministic source and generated pack hashes, exact joins, complete declared
pack coverage, finite geometry and insets, parsing and bounds, SVG/Canvas policy, provider/layout
logic, physical drag/wheel/synthetic-pinch camera behavior, inverse Canvas picking, probe transitions,
zero provider/scene/base/picking rebuild deltas, partial-profile p95/max, interaction call counts,
accessibility semantics, lifecycle, package reproducibility, and
absence of network requests from the packaged bundle in Chromium.

A packaged-Chromium demo-page audit mounts every data-bearing configuration of the generated PBIP
sample on the packaged bundle and asserts, per page, that the profile renders at least one mark, that
a frame with zero cells paints no orphan skeleton, that the designed empty state appears exactly when
it is expected, that every arm carries band labels, that no two chart labels overlap and none escapes
the chart at the authored size or when scaled down, and that no external request is made. The audit
imports the same side-effect-free definition module the sample generator uses, so it cannot drift from
the shipped sample.

They do not prove native Desktop field-well behavior, segmentation, bookmarks, service behavior,
exports, dashboard pinning, DirectQuery/Direct Lake behavior, or native expand/collapse/drilldown.
They also do not prove native Desktop mouse, trackpad, touch, or packaged-camera behavior.
Run [docs/desktop-validation.md](docs/desktop-validation.md) against the exact package hash.

Certification and Partner Center submission readiness are not claimed; Microsoft review is separate.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
