# Third-party notices

Atlyn Profile Lens is MIT licensed. Its optional built-in context packs and
geography build toolchain use the following third-party materials.

## Natural Earth

The world-country packs are derived from Natural Earth 5.1.1 Admin-0 Countries
at 1:110m and, when selected, 1:50m.

Natural Earth declares all raster and vector map data distributed from
naturalearthdata.com to be in the public domain. No permission or attribution is
required. Natural Earth's suggested short credit is:

> Made with Natural Earth.

The visual includes that credit. Natural Earth depicts Admin-0 boundaries
according to de facto control. See `docs/context-packs.md` for the published
product policy.

## U.S. Census Bureau

The US state/equivalent and county/equivalent packs are derived from the 2025
U.S. Census Bureau Cartographic Boundary Files at 1:5,000,000. United States
government works are public domain. The product uses this acknowledgement:

> U.S. Census Bureau, 2025 Cartographic Boundary Files.

Cartographic Boundary Files are generalized for small-scale thematic mapping.
They are not suitable for legal boundary determination, geocoding, surveying,
or precise geographic measurement.

## Software dependencies

| Component | Version | License | Use |
|---|---:|---|---|
| d3-geo | 3.1.1 | ISC | Runtime projection of bundled geometry |
| topojson-client | 3.1.0 | ISC | Runtime decoding of bundled topology |
| topojson-server | 3.0.1 | ISC | Build-time topology generation |
| topojson-simplify | 3.0.3 | ISC | Build-time deterministic simplification |
| shapefile | 0.6.6 | BSD-3-Clause | Build-time SHP/DBF parsing |
| JSZip | 3.10.1 | MIT | Build-time source archive extraction and package auditing |

Full dependency license text is available from each package in `node_modules`
after `npm ci` and from its linked upstream package metadata.

No VisQuill code, data, or assets are included.
