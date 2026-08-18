# Atlyn Profile Lens 1.2.0.0 native validation

**Outcome: blocked; no native scenario is claimed as passed.**

The exact release candidate at source commit `15721d6b90b4793728d01c30b0ac582a9dffd3ef`
was packaged as `dist/atlynProfileLens.1.2.0.0.pbiviz` (472,353 bytes,
SHA-256 `83f85fcf44c5e1b49ea22f657bd980f7c408370d1267cd91291de81b2e30db56`).
Power BI Desktop `2.156.951.0 (26.07)+c9381f8e5efc99c8de04425f1572e841914690d8`
opened the exact generated PBIP and exposed a responsive owned window titled
`AtlynProfileLensSample`.

The execution context then reported foreground window handle `0`. The approved safety guard could
not prove that the owned report window was foreground, so it refused all UI Automation, keyboard,
pointer, Save As, and close/reopen input. The first bounded diagnostic established the actual stable
title used by this Desktop build; the second established the unavailable foreground desktop. No
blind retry or input to an unproven window occurred.

Consequently, no genuine PBIX was produced. Field-well progression, profile and context behavior,
native selection, context menus, tooltips, keyboard interaction, lifecycle surfaces, Save As,
offline PBIX reopen, PBIX hash stability, and PBIX embedded-resource parity remain **unproven**.
PBIP structure and automated Chromium coverage are not substitutes for those observations.

The clean automated baseline passed 180 unit tests, 21 packaged-browser probes, four deterministic
context-pack validations and opposite-timezone rebuilds, and `npm audit` with zero vulnerabilities.
Those results prove only their documented automated boundary.

This record is not Microsoft certification, approval, Partner Center submission, or a validated
release candidate. Touch, Service publication, dashboard pinning, and Partner Center upload were
not attempted.
