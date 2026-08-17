# Atlyn Profile Lens

A Power BI custom visual that compares **one to six report-bound measures across an ordered set of
bands** for a selected entity, with an optional period level and an optional two-value series split.

**All data comes from the report.** The package contains no bundled observations of any kind, no
demographic or business data, no geography, and no sample values that could override what an author
binds. Every value, label, band, period, series and tooltip is read from the fields in the field
wells, so Power BI filters, row-level security, bookmarks, highlighting and report interactions stay
authoritative.

**This release is profile-only.** It renders profiles and never draws a map. The map-oriented field
wells below are exposed on purpose so a report can bind them today; the visual validates them into a
typed extension payload and shows an explicit limitation diagnostic. It never parses geometry, never
projects coordinates, and never requests anything from the network.

- Privileges: `[]` (declared and enforced by an audit script)
- External requests: none (`fetch`, `XMLHttpRequest`, `WebSocket`, tile servers, geocoders)
- Dynamic code: none (`eval`, `new Function`)
- Browser storage of report data: none
- On-object formatting: not claimed
- API version: exactly `5.11.0`; tooling `powerbi-visuals-tools` `7.2.1`

## Field wells

One matrix mapping, in this order:

| Well | Kind | Fields | Meaning |
|---|---|---:|---|
| `Entity > Period > Band` | Grouping | 0-3 | Entity first, an optional period second, the ordered band last |
| `Series` | Grouping | 0-1 | Optional split; at most two values are rendered |
| `Profile measures` | Measure (numeric) | 0-6 | Each measure becomes one profile arm |
| `Context value (future map value)` | Measure (numeric) | 0-1 | Entity-level value for a future map or context extension |
| `Latitude (future map role)` | Measure (numeric) | 0-1 | Reserved for a future point extension |
| `Longitude (future map role)` | Measure (numeric) | 0-1 | Reserved for a future point extension |
| `Custom geometry text (future map role)` | Measure (text) | 0-1 | Reserved for a future custom geometry extension |
| `Tooltips` | Grouping or measure | 0-10 | Extra fields for the native tooltip |

No condition requires a role, which is deliberate: Microsoft documents that only one role per
condition may have `min >= 1`, and a stricter contract makes the field wells reject the first drop.
`npm run check:capabilities` enumerates all 9,856 reachable role-count combinations and fails if any
of them is rejected.

### Hierarchy shapes

```text
Entity > Band                  two fields, one profile per entity
Entity > Period > Band         three fields, one profile per entity and period
```

The order is fixed. A single hierarchy field is treated as the entity and the visual asks for a band.

### Progressive authoring

1. Add an entity field to `Entity > Period > Band`.
2. Optionally add a period field as the second hierarchy field.
3. Add the ordered band field as the last hierarchy field.
4. Add one to six numeric measures to `Profile measures`.
5. Optionally add `Series`, `Tooltips`, or the context fields.

The landing page shows these steps and marks the completed ones at every stage.

## Layouts

| Profile measures | Layout |
|---:|---|
| 1 | bilateral, centred on one axis |
| 2 | opposing arms |
| 3 | three arms at 90, 210 and 330 degrees |
| 4 | cardinal cross |
| 5-6 | evenly spaced radial arms |

Bands advance **along** each arm and values grow **perpendicular** to it, so every arm stays inside
its own angular sector and arms never overlap. With a series bound, the two series are mirrored on
opposite sides of the arm axis. `Layout > Arrangement > Stacked panels` replaces the radial layout
with one horizontal panel per profile.

Responsive behaviour is deterministic and is verified against the packaged bundle in Chromium at
1280x620, 398x298, 258x198, 178x138 and 80x80:

| Tile | Behaviour |
|---|---|
| `>= 420px` smallest side | full chrome: header, entity list (>= 520px wide), legend, period control, band and value labels |
| `240-419px` | value labels off, band labels on, header and period control kept |
| `130-239px` | band labels off, legend off |
| `< 130px` | chart only: no header, legend, period control, labels or axis; the semantic table and status stay in the accessibility tree |

## Normalization

Explicit modes only. There is no heuristic auto-detection, because a plausible-looking but wrongly
normalized profile is worse than a visible error.

| Mode | Formula |
|---|---|
| Raw value | the bound value |
| Share of profile | value / sum of all bands and series for that profile |
| Share within series | value / sum of all bands for that profile and series |
| Index to maximum | value / largest absolute band value in that profile |
| Already a percentage | the bound value, read as `0-1` or `0-100` per `Bound percentage scale` |

Denominators use positive contributions only. A zero or non-positive denominator produces a missing
mark plus the `zeroDenominator` diagnostic, never a fabricated value. Blank values are drawn as
missing unless `Data > Blank values` is set to `Treat as zero`.

## Series, bands and periods

- No series field: one bar per band per profile.
- One series field with two values: mirrored around each arm's axis.
- More than two values: the first two in host order are rendered and a diagnostic reports the
  received and retained counts. Nothing is silently dropped.
- Band order is the host's order, which respects the semantic model's *Sort by column*. Labels are
  never sorted lexically, so `100+`, `20-24` and `5-9` keep their model order.
- Periods are navigated locally with the period slider (Left/Right/Up/Down, Home, End). The visual
  does not write a filter back to the report in this release.

## Future map roles

Binding `Context value`, `Latitude`, `Longitude` or `Custom geometry text` is accepted and produces:

- a typed payload for extension consumers: context values per entity, validated coordinate pairs
  (latitude `[-90, 90]`, longitude `[-180, 180]`, conflicting or half-bound pairs rejected and
  counted), and geometry captured as text with its character count and a format hint;
- a localized diagnostic stating that this package is profile-only and draws no geography.

Geometry text is measured and classified (`geoJsonCandidate`, `wktCandidate`, `unrecognized`) but is
never parsed: there is no GeoJSON or WKT parser, no projection, and no dormant map code path in the
bundle. Strings longer than 32,000 characters are reported as oversized, which is the documented
practical limit of a Power BI text value.

## Formatting cards

`Data`, `Layout`, `Profiles`, `Series`, `Period`, `Header`, `Diagnostics`, `Accessibility`, all
built with the modern formatting model (`getFormattingModel`). Every capability property has a
matching slice and every slice has a matching capability property; `npm run check:metadata` fails if
they drift apart.

## Accessibility

- Roving keyboard focus across every rendered profile target: arrows move, Home and End jump,
  Enter and Space select, Escape returns focus to the visual root.
- Focus is restored by a stable target key after a rerender.
- A semantic table whose rows are bands and whose columns are profile x series, with the entity and
  period in the caption and both displayed and raw values in each cell. It stays in the
  accessibility tree even when it is visually hidden (`Accessibility > Profile table`).
- `role="status"` with `aria-live="polite"` and `aria-busy` while partial data is loading.
- High contrast support from `host.colorPalette`, with pattern fills and outlines so nothing is
  conveyed by colour alone.
- RTL layout for right-to-left locales, or forced with `Layout > Text direction`.
- Reduced motion setting; the visual renders one deterministic frame per update and never animates
  continuously.
- When the host sets `allowInteractions = false`, the visual still renders and still describes
  itself, but performs no selection, tooltip or context-menu call.

## Diagnostics and limits

Diagnostics are localized, deduplicated and ordered deterministically (errors, then warnings, then
information). They report received, retained and rejected counts instead of hiding a problem:

`needsEntity`, `needsBand`, `needsProfile`, `hierarchyDepthUnsupported`, `profilesOverLimit`,
`seriesOverLimit`, `entitiesOverLimit`, `periodsOverLimit`, `bandsOverLimit`,
`tooltipFieldsOverLimit`, `cellsOverLimit`, `duplicateCells`, `blankValues`, `nonNumericValues`,
`nonFiniteValues`, `zeroDenominator`, `partialData`, `segmentLimitReached`, `highlightActive`,
`interactionsDisabled`, `extensionRolesProfileOnly`, `invalidCoordinates`,
`conflictingCoordinates`, `incompleteCoordinates`, `oversizedGeometry`, `emptyGeometry`,
`nonFiniteContextValue`.

| Bound | Value |
|---|---:|
| Profile measures | 6 |
| Rendered series values | 2 |
| Hierarchy fields | 3 |
| Entities | 1,000 |
| Periods per entity | 100 |
| Bands | 100 |
| Tooltip fields | 10 |
| Retained cells | 120,000 |
| Segment requests | 4 |
| Geometry characters | 32,000 |

Duplicate entity/period/band/series/profile cells are rejected and counted rather than overwritten.

## Examples

All examples are generic. The visual does not know or care what a measure means.

**Non-geographic entities**

```text
Entity > Period > Band : Unit[UnitKey], Calendar[Period], Bucket[BucketLabel]
Series                 : Split[SplitLabel]
Profile measures       : [Metric A], [Metric B], [Metric C]
```

**Geographic entity keys, still profile-only**

```text
Entity > Period > Band : Location[LocationKey], Calendar[Period], Bucket[BucketLabel]
Profile measures       : [Metric A], [Metric B]
Context value          : [Metric A total]
Latitude / Longitude   : [Selected latitude], [Selected longitude]
```

The second example renders the same profiles and adds the profile-only limitation diagnostic; the
coordinates are validated and carried as an extension payload, not drawn.

Store location keys as **text** so leading zeroes survive, and set the band column's *Sort by
column* to its order column.

## Sample project

`samples/AtlynProfileLensSample` is a **PBIP project**, generated by `npm run sample:pbip`. Its
semantic model is a DAX `DATATABLE` calculated table with 60 synthetic rows using deliberately
generic labels (`Entity A`, `Band 1`, `Metric A`, `Series X`), so it has no data source, no
credentials and no refresh. The report embeds the exact packaged visual resource, and the
certification audit fails if that copy drifts from the current package.

**No `.pbix` is produced or claimed.** Producing one requires opening the PBIP in Power BI Desktop
and using *Save As*, which is a manual step this repository does not perform.

## Development

```powershell
npm install                    # or: npm run install:clean   (npm ci from the lockfile)
npm run checks                 # capabilities conditions, certification metadata, forbidden calls
npm run typecheck              # tsc --noEmit over src and test
npm run lint                   # eslint with eslint-plugin-powerbi-visuals
npm test                       # vitest: model, normalization, layout, diagnostics, DOM lifecycle
npm run package                # clean, pbiviz package --certification-audit, deterministic ZIP
npm run audit:certification    # audits the freshly generated .pbiviz
npm run probe:browser          # packages, extracts the bundle, runs the Chromium probes
npm run audit:npm              # npm audit --audit-level=moderate
npm run audit:reproducible     # packages twice under opposite timezones and compares bytes
npm run release:manifest       # dist/release-manifest.json with the package SHA-256
npm run sample:pbip            # regenerates the PBIP sample and re-embeds the package
npm run assets:brand           # regenerates assets/icon.png and the 300x300 Partner Center logo
npm run validate:certification # the whole gate in order
npm start                      # pbiviz start for the Power BI Desktop developer visual
```

The browser probe runs the **packaged** JavaScript and CSS extracted from `dist/*.pbiviz`, not a
test-only build, so layout, focus, high contrast, tooltip and context-menu call counts, and the
absence of network requests are proven on the artifact that would be submitted.

Brand assets are generated from code (`scripts/generate-brand-assets.cjs`) so no unreproducible
binary is committed.

## Release and reproducibility

`npm run package` normalizes the ZIP: entries are sorted and rewritten with a fixed UTC-anchored DOS
timestamp, DEFLATE level 9 and DOS platform metadata. The package hash therefore depends only on
content, which `npm run audit:reproducible` proves by packaging under `Etc/GMT+12` and `Etc/GMT-14`
and comparing bytes. `npm run release:manifest` records the source commit, the visual identity, the
package name, size and SHA-256, the asset hashes, the role contract and the proof boundary.

## Proof status

Proven here, by automated checks in this repository:

- capabilities accepted by `pbiviz package`, one matrix mapping, no over-required condition, and
  every progressive field assignment accepted;
- deterministic parsing, ordering, bounding and diagnostics;
- exactly one `renderingStarted` and exactly one `renderingFinished` or `renderingFailed` per update,
  including empty, partial, cached lifecycle-only and failed updates;
- selection, bookmark callback, native tooltip lifecycle and both context-menu modes with exact call
  counts, and no host mutation when interactions are disabled;
- keyboard focus, focus restoration, semantic table, high contrast, RTL and 80x80 layout;
- no external request from the packaged bundle in a real browser.

Still requires Power BI Desktop and the Power BI service, and is **not** claimed here:

- field-well drop behaviour for every order of assignment in the real host;
- matrix expand/collapse, drilldown and host segmentation behaviour;
- parent-node values for the context role in Import, DirectQuery and Direct Lake;
- bookmarks, cross-report interactions, export, subscriptions and dashboard pinning;
- native tooltip rendering and touch long-press behaviour;
- opening, saving and reopening a `.pbix` built from the PBIP sample.

See [docs/desktop-validation.md](docs/desktop-validation.md) for the manual checklist.

Certification is not claimed. Microsoft has to complete its own review.

## License

MIT. See [LICENSE](LICENSE).
