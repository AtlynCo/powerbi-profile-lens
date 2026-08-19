# Built-in offline context packs

## Product boundary

Built-in packs are optional cartographic resources. They contain geometry,
exact stable source keys, names, source status, centroids, adjacency, vintage,
projection policy, and attribution. They contain no population, demographic,
economic, customer, or other analytical observations. Every analytical value,
profile, fill value, period, series, and analytical tooltip field comes from
the report semantic model.

The visual never downloads pack data at runtime. It has no tile service,
geocoder, file upload, shapefile reader, or network fallback. Generated pack
assets contain no download URL.

## Supported packs and keys

| Pack | Vintage/detail | Exact default key | Examples |
|---|---|---|---|
| World countries | Natural Earth 5.1.1, 110m default; 50m optional | Uppercase ISO alpha-3 or generated `NE:<ADM0_A3>` fallback | `USA`, `CAN`, `NE:KOS` |
| US states/equivalents | Census 2025, 5m | Two-digit GEOID text | `06`, `11`, `60`, `72` |
| US counties/equivalents | Census 2025, 5m | Five-digit GEOID text | `06037`, `72001` |

Store Census keys as text. The visual does not trim, parse numbers, add leading
zeroes, remove punctuation, or match names. Duplicate normalized keys are all
rejected because choosing one would attach the geometry to an arbitrary host
selection identity.

World `canonical` mode is case-sensitive. `isoAlpha3CaseFold` is an explicit
alternative that accepts exactly three ASCII letters and uppercases them. It
does not trim and does not accept Natural Earth fallback keys.

World key assignment prefers a valid unique `ISO_A3`. When that field is
invalid, the build accepts a valid `ISO_A3_EH` only when it does not collide
with a primary ISO assignment or another alternate candidate. Only entities
without an accepted ISO code receive `NE:<ADM0_A3>`. The build audits all three
fields and rejects final collisions.

For Natural Earth 5.1.1, `FRA` and `NOR` come from `ISO_A3_EH` and join as
ordinary ISO keys. The generated fallback sets are:

- 110m: `NE:CYN`, `NE:KOS`, `NE:SOL`;
- 50m: `NE:ATC`, `NE:CYN`, `NE:IOA`, `NE:KAS`, `NE:KOS`, `NE:SOL`.

At 50m, `ISO_A3_EH=AUS` on Ashmore and Cartier Islands and Indian Ocean
Territories is not accepted because it collides with Australia's primary
`ISO_A3=AUS`; those source entities therefore retain distinct prefixed Natural
Earth identifiers. Exact fallback and alternate-ISO sets are generated into
each manifest and verified against decoded features, not asserted from an
assumed record count.

## Boundary and territory policy

### World

The visual publishes the unmodified Natural Earth Admin-0 Countries feature
model and its de facto-control worldview. Source `TYPE` is retained as
cartographic status text. The visual does not merge disputed entities, apply a
country-specific point-of-view variant, or imply endorsement, sovereignty, or
legal recognition.

The default is Natural Earth 110m with `geoNaturalEarth1`. The 50m variant is a
separate author choice and is shipped only while source, size, projection,
parity, small-tile, and browser gates pass.

### United States

The state pack contains all 56 Census state/equivalent records: 50 states,
District of Columbia, Puerto Rico, American Samoa, Guam, Commonwealth of the
Northern Mariana Islands, and United States Virgin Islands. The county pack
contains all 3,235 2025 county/equivalent records, including island-area
equivalents.

District of Columbia is shown in the CONUS frame. Alaska, Hawaii, Puerto Rico,
American Samoa, Guam, Northern Mariana Islands, and US Virgin Islands use
explicit bounded non-overlapping insets. Inset location and relative scale are
cartographic, not a geographic distance or area comparison. No territory is
silently omitted.

## Reproducible build

Pinned inputs and hashes are in `context-packs/sources.json`. Source archives
are downloaded only by an explicit build command into the gitignored
`context-packs/cache` directory.

```powershell
npm run packs:fetch
npm run packs:build
npm run packs:validate
npm run packs:verify
npm run packs:repro
```

The build:

1. verifies archive byte length and SHA-256 before extraction;
2. parses the SHP/DBF pair;
3. allowlists only cartographic fields;
4. audits `ISO_A3`, `ISO_A3_EH`, and `ADM0_A3`, then assigns exact canonical
   keys and generated collision-free fallback keys;
5. sorts features by locale-independent UTF-16 key order;
6. calculates bounds, centroids, shared-arc adjacency, and territory region;
7. constructs, presimplifies, deterministically simplifies, and quantizes
   TopoJSON at 100,000;
8. emits fixed-order LF-only JSON with payload and source hashes;
9. validates feature counts, key uniqueness/width, county prefixes, expected
   state codes, finite geometry, symmetric adjacency, URLs, and size budgets;
10. rebuilds byte-identically under `Etc/GMT+12` and `Etc/GMT-14`.

Committed generated files are under `src/context/packs/generated`. Packaging and
runtime use only those committed files; they do not invoke the fetch/build
pipeline.

## Source catalog

| Input | URL | Archive SHA-256 |
|---|---|---|
| Natural Earth 5.1.1 Admin-0 110m | `https://naturalearth.s3.amazonaws.com/5.1.1/110m_cultural/ne_110m_admin_0_countries.zip` | `0f243aeac8ac6cf26f0417285b0bd33ac47f1b5bdb719fd3e0df37d03ea37110` |
| Natural Earth 5.1.1 Admin-0 50m | `https://naturalearth.s3.amazonaws.com/5.1.1/50m_cultural/ne_50m_admin_0_countries.zip` | `5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139` |
| Census 2025 states/equivalents 5m | `https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_state_5m.zip` | `8a45692bc532dbd38938a1924f445850cef2682ea67d750d7fd2f19cfe836903` |
| Census 2025 counties/equivalents 5m | `https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_county_5m.zip` | `faec522080681e79be5be435c981009a77891206ff8a7f1d142f3bf5da9ebd74` |

## Adding another pack

A third party can add a pack without changing the renderer:

1. add a pinned, license-clean source entry and hash;
2. add a generic source transform that emits the same manifest/topology
   artifact contract;
3. register the generated artifact in `ContextPackRegistry`;
4. add a pure named exact key normalizer;
5. add a projection policy that produces generic polygon scene geometry;
6. pass source, geometry, adjacency, package-size, provider, renderer parity,
   accessibility, no-network, and licensing gates.

Providers may not touch the DOM, host services, storage, files, or network.
Renderers continue to consume only `ContextScene`.

## Viewport navigation boundary

Viewport navigation uses migration-safe `auto`, `on`, and `off` behavior. Auto is the default for
new/unset reports and activates for interactive, non-profile-only scenes with multiple features.
Persisted legacy false/true values remain explicit off/on. The same generic camera and fixed-center
probe drive packs, points, strict geometry, grid, and hex; there is no provider-specific navigation
branch.

A built-in-pack scene always contains every declared feature. The provider caches one projected
backdrop and creates optional exact canonical-feature-to-report-Entity bindings for the current
DataView. Only those bindings carry analytical values, tooltips, highlights, and host identities.
Unbound features remain probeable cartographic backdrop and show `No data in current report context`;
they are not key errors. Hiding no-data paint leaves their picking, navigation, and semantics intact.

The fixed center probe resolves the backdrop feature while the camera moves and updates the local
profile only on effective state changes. A configured fallback is exact raw bound Entity text,
applies only over no feature, and is visibly disclosed; it never masks a known unbound feature or
silently invents `WLD`.

## Known limits and proof boundary

- Map labels are intentionally absent; exact source names are available through
  semantic options and native tooltips.
- Natural Earth and Census generalized geometry is for thematic display, not
  legal or measurement use.
- The report's data reduction and filter context determine which pack features receive report-bound
  Entities and which resident profiles can update immediately. Complete geometry does not imply
  complete analytical data.
- World/state preloading or bounded segmentation can be feasible. County profile-on-demand remains
  unavailable because the visual declares no expand/collapse or drill contract.
- Automated tests do not prove native Power BI Desktop/Service field wells,
  exports, dashboard pinning, DirectQuery/Direct Lake, or certification.
- No PBIX is produced or claimed. A native PBIX must be created, closed,
  reopened, and tested in Desktop against the exact PBIVIZ hash.
