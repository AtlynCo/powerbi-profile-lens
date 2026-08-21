# Power BI Desktop host-spike checklist

Automated checks do not replace the native host. Run this checklist against the exact release
candidate; record the package name and SHA-256 from `dist/release-manifest.json`.

## Install and bindings

1. Import the packaged visual into the target Desktop version.
2. Add and remove fields progressively: entity; entity/band; entity/period/band; one to six profiles;
   series; context value; latitude/longitude; geometry; tooltips.
3. Confirm invalid and incomplete bindings show guidance rather than a host error.
4. Verify band *Sort by column*, one/two series values, and the over-limit diagnostic.

## Context providers and preprocessing

1. Exercise `none`, `grid`, and `hex` with nongeographic community-district-like entities.
2. Bind complete WGS84 point pairs, then blanks, half-pairs, non-finite values, and coordinates outside
   latitude `[-90,90]` or longitude `[-180,180]`.
3. Bind strict GeoJSON Geometry and Feature plus strict WKT Point, MultiPoint, Polygon, MultiPolygon.
4. Confirm malformed input, unknown CRS, `GeometryCollection`, unsupported types, invalid rings, and
   out-of-range coordinates are rejected, not repaired or projected.
5. Confirm only the documented exact WGS84 CRS names are accepted; exercise arbitrary prefixes,
   suffixes, surrounding whitespace, unsupported URNs, and URL forms as visible rejections.
6. Exercise exact safety bounds: 32,000 UTF-16 characters/value, 2,000,000 characters/update, depth 12,
   256 rings/feature, 4,096 vertices/feature, 100,000 vertices/scene, 16,384 WKT tokens, 4,000
   entities/trusted pack features, and 1,000 untrusted bound features. Confirm visible diagnostics at
   each exceeded bound.
7. Use browser/proxy monitoring to confirm no upload, file access, network request, tile lookup, or
   geocoding.
8. Exercise world `USA`, `CAN`, `MEX`, and one manifest-listed `NE:` fallback; state/equivalent text
   keys `11`, `60`, `66`, `69`, `72`, and `78`; and five-digit county/equivalent text keys from
   CONUS, Puerto Rico, and every island area.
9. Confirm malformed whitespace, numeric Census columns, unmatched keys, and duplicate keys are
   visibly rejected. The visual must not trim, pad, coerce, or match names.
10. Switch pack and world detail while confirming report selection identities and profile values do
    not change. Inspect every territory inset, attribution, semantic source name, Canvas county
    picking, selected outline, tooltip, both context menus, and adjacency navigation.
11. Bind one exact pack key and confirm the complete pack remains visible/probeable. Distinguish
    loaded binding, unloaded binding, ordinary unbound backdrop, unmatched report key, and ocean/no
    feature. Hide no-data paint and confirm hidden features remain probeable and semantic.
12. Configure an exact bound text fallback and confirm it appears only over no feature with visible
    disclosure. Exercise case, whitespace, non-string, absent, ambiguous, and unloaded rejection.
13. Filter to zero Entity rows and verify complete world/state/county geometry, no-data semantics,
    navigation, and zero host selection. Restore rows and confirm camera/base/picking persistence.
14. In every no-cell state — no feature, unbound feature, unloaded detail, zero rows, and no
    renderable roles — confirm the chart draws no axis, no band labels, no metric captions, and no
    stray value labels, and that one centered card carries the state message and its guidance.
    Confirm the card stays inside the visual at 80x80 and at each intermediate size, that the header
    state, status line, accessible table, and probe announcement are unchanged, and that no host
    selection occurs.

## Layout and rendering

1. Test `split`, `focusLens`, `locatorInset`, and `profileOnly` in large, narrow, short, and minimum
   usable tiles, Focus mode, and Reading mode.
2. Verify SVG at 500 features and 20,000 vertices, then Canvas when either threshold is exceeded.
3. Compare SVG and Canvas labels, selection, focus, tooltip, context menu, and accessible descriptions.
4. Test one through six profile measures, both radial and stacked arrangements.
5. Confirm new/unset multi-feature scenes use Automatic navigation. Verify persisted legacy false and
   true values migrate to Off and On, respectively. Automatic must remain inert for one feature,
   profile-only layout, no context, and disabled host interactions.
6. Verify Home view Automatic resolves to Fill for world/state/county, points, and useful bound
   geometry, and to Fit for grid/hex and non-navigable contexts. Compare explicit Fit and Fill,
   confirm Minimum zoom still exposes the full extent, and confirm Home/reset returns to the
   configured home after pan, zoom, and resize.
6a. Verify Home focus Automatic opens the world, state, and county pages with the center probe over a
   bound feature that has data, so the profile is populated on first render with no interaction.
   Confirm Scene center restores the geometric center, that Home focus never selects, and that a
   deliberate pan or zoom is never overridden when later report data arrives.
7. From the unmodified hero Home view, perform a pure vertical primary-button drag with zero X
   movement on world, state, and county pages. Confirm material `panY`, stable `panX`, a north/south
   probe boundary transition, zero selection during movement, and exactly one settle on release.
8. Drag with the primary mouse button, use wheel/trackpad zoom, one-pointer touch pan where available,
   synthetic and physical two-pointer pinch, Shift+Arrow, `+`/`-`, Home, and the reset control.
9. Confirm cursor/midpoint zoom anchoring, bounded pan, fixed center probe, and viewed-center
   preservation on resize. Crossing a boundary must update title/profile/table/status/outline without
   click; remaining inside one effective state must not rerender the profile. At both zoom limits and
   scene edges, confirm pinch remains continuous after one pointer lifts and wheel input stays
   contained.
10. Start wheel input, then transfer ownership to drag, click, plain Arrow, pinch, Home, rebind,
   disabled interaction, cancel, and destroy. Confirm the stale wheel generation never adds another
   move-end or selection.
11. During multi-step world/state/county pan/zoom, confirm provider, scene/index, SVG geometry or
   Canvas base raster, picking-surface, and spatial-index build counts remain unchanged across probe
   transitions. Record camera, probe-resolution, partial-profile p95/max, and next-frame metrics.

## Loading and native capability spike

1. Exercise `auto`, `eager`, `segmented`, and `external` in Import, DirectQuery, and Direct Lake where
   available.
2. For segmented data, record host segment markers, request count, aggregation behavior, completion,
   and the four-request bound.
3. Confirm `matrixExpand` is unavailable and that no expand/collapse or drilldown affordance appears.
4. Separately capture real native host evidence before proposing capabilities `expandCollapse` or
   `drilldown`: API/Desktop version, DataView before/after, host calls, identities, filter state,
   keyboard/accessibility behavior, and Import/DirectQuery results. Do not enable either capability
   from mocks or documentation alone.

## Interaction and filters

1. Click a profile mark and context feature; verify bucket-level and entity-level identities,
   respectively, cross-filter other visuals.
2. Ctrl/Meta/Shift-click for multi-select and click empty space to clear.
3. Right-click a feature/mark and empty space; each native context menu appears once.
4. Verify native tooltip pointer tracking and bound tooltip fields.
5. Apply slicers, cross-filters, highlights, RLS, and a bookmark; verify host state remains
   authoritative after resize and refresh.
6. Exercise local-only and report-selection modes. Confirm no visual gesture writes an outward filter.
   During movement confirm zero SelectionManager calls. At settle, local-only remains zero and
   report-selection commits at most one final directly matched loaded Entity. No-data, unloaded,
   no-feature, and fallback states must not select.
7. Disable report interactions and confirm no selection, tooltip, focus mutation, or
   context-menu host call. Also confirm no camera mutation, pointer capture, wheel prevention,
   navigation control/focus chrome, or navigation host call while the current camera stays visible.
8. Start a drag over a feature and release over another feature. Confirm no entity activation,
   tooltip, or context menu occurs during the drag; report-selection may commit the final probe Entity
   once at release. Then perform one ordinary click and confirm exactly one additional activation.
9. Exercise deferred/out-of-order and rejected selection promises. Stale/rejected completion must not
   change local focus, retry, or produce a selection loop.
10. Rapidly activate Context A-B-A, profile then Context, and explicit multi-select while host
    promises are delayed. Confirm at most one local select promise is in flight, latest single intent
    wins, explicit multi-select is serialized, and external selection clears queued local work.
    Record that an already in-flight host selection cannot be cancelled and may remain the last writer.
11. While a local selection promise or wheel/drag/pinch settle is pending, apply an external
    selection/bookmark. Confirm queued local work is discarded, the older settle never commits,
    camera position is retained, and any stale successful host completion reconciles overlays from
    the host's actual selection without changing local probe/profile focus.

## Accessibility and semantic parity

1. Tab into each surface; use arrows, Home/End, Enter/Space, and Escape.
2. Verify focus restoration by stable entity key after resize, provider/layout change, and refresh.
3. With a screen reader, compare SVG and Canvas status, feature label/value/selection state, and the
   profile table.
4. Verify Windows high contrast, color-independent selected/focused states, RTL, reduced motion, and
   the smallest responsive layout.
5. Confirm the context is one Tab stop, the reset button is not another sequential stop, probe and
   gesture help are described, plain Arrow remains entity browsing, and RTL mirrors Shift+Left/Right.
6. Exercise both dark and light host high-contrast palettes. Confirm computed reset/help/attribution,
   context background, focus, disabled, selected, and probe colors use the host palette at large and
   small context sizes.
7. Confirm concise/detailed probe announcements cover loaded, no-data, unloaded, no-feature, and
   fallback states; rapid transitions keep at most one trailing announcement and no recurring timer.

## Persistence and service boundary

1. Open the generated PBIP sample and verify all fourteen pages offline, starting with the large
   Automatic/Fill local-only World 50m hero and then the report-selection and engineering pages.
2. Use Power BI Desktop to create a native offline PBIX that embeds the exact release-candidate
   PBIVIZ hash. Close and reopen it, repeat the checklist, and add that PBIX to the submission
   materials. This repository produces, fabricates, and claims no PBIX.
3. Test PDF/PowerPoint export, service publication, dashboard pinning, and bookmarks separately.
4. Record Desktop/service versions, modes tested, package SHA-256, pass/fail evidence, and deviations.

Native results establish only the tested host/package combination. They do not constitute Microsoft
certification. Until the exact native PBIX above exists and passes, the artifact is not Partner Center
submission-ready or certification-complete.

Packaged Chromium mouse/wheel and synthetic pinch evidence does not prove Power BI Desktop mouse,
trackpad, touch hardware, focus routing, export, or reopen behavior. Record those surfaces as unproven
unless they were exercised against the exact package hash and genuine reopened PBIX.
