# Atlyn Profile Lens 1.2.0.0 native validation

**Outcome: blocked; no native scenario is claimed as passed.**

The exact release candidate at source commit `15721d6b90b4793728d01c30b0ac582a9dffd3ef`
was packaged as `dist/atlynProfileLens.1.2.0.0.pbiviz` (472,353 bytes,
SHA-256 `83f85fcf44c5e1b49ea22f657bd980f7c408370d1267cd91291de81b2e30db56`).
Power BI Desktop `2.156.951.0 (26.07)+c9381f8e5efc99c8de04425f1572e841914690d8`
opened a PBIP at the intended logical sample path and exposed a responsive owned report window.
The generated project was not contemporaneously hashed before that blocked launch, so this record
does **not** claim that the current 12-page fixture tree was the exact opened bytes.

The execution context then reported foreground window handle `0`. The approved safety guard could
not prove that the owned report window was foreground, so it refused all UI Automation, keyboard,
pointer, Save As, and close/reopen input. The first bounded diagnostic established the actual stable
title used by this Desktop build; the second established the unavailable foreground desktop. No
blind retry or input to an unproven window occurred.

The current prepared fixture is now reproducibly bound by
`samples/AtlynProfileLensSample/sample-integrity.json` at source commit
`519aee9f5bcf1c64ebdb87f31b5601d85b0b0906`: project tree
`b287ce8bbd5c5192940c78ca653373abe9f2a99c02788c2efae4bae564818e3f`, report definition
`c7b5e4f05b4e86b2d7e3854ef7590ac0ce3570f37b46152c59a5fdae53e6b710`, model definition
`407a94d172ea8ef05797a2856a96dc49d9aa76046b5ade4210d5417e4518db9c`, generator
`66598035e64943289175d6e7aefb5b1ee8821ad8439c3607e99e6dcb3a003e6f`, PBIP entry point
`b8bd879c17924ff02f4a81e864b86f9fbb8668025e25747e34198f3fe024c4b9`, and embedded visual
resource `19bbf6ffbdfe10c67707dff348879570a7b0e9234fd00973a22bedc2e92c91f7`.
These hashes prepare a future run; they are not retroactive native evidence.

The guarded automation and every invoked observation, snapshot, integrity, sanitizer, finalizer,
PBIX-snapshot, publication-lock, and parity helper are bound as thirteen files at
`3a5346e40d89e2c71f627f41573c6cbe41fefca6715fc2b267fcebd260189a4b`.
The final PBIVIZ payload and the sample's one embedded custom-visual resource are byte-identical at
`19bbf6ffbdfe10c67707dff348879570a7b0e9234fd00973a22bedc2e92c91f7`.

Consequently, no genuine PBIX was produced. Field-well progression, profile and context behavior,
native selection, context menus, tooltips, keyboard interaction, lifecycle surfaces, Save As,
offline PBIX reopen, PBIX hash stability, and PBIX embedded-resource parity remain **unproven**.
PBIP structure and automated Chromium coverage are not substitutes for those observations.

The clean automated baseline passed 183 unit tests, 21 packaged-browser probes, four deterministic
context-pack validations and opposite-timezone rebuilds, and `npm audit` with zero vulnerabilities.
Those results prove only their documented automated boundary.

This record is not Microsoft certification, approval, Partner Center submission, or a validated
release candidate. Touch, Service publication, dashboard pinning, and Partner Center upload were
not attempted.
