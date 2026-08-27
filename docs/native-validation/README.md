# Native validation evidence

`atlynProfileLens-1.2.0.0.*` is a historical blocked record only. It is not current fixture,
automation, package, or release evidence.

Atlyn Profile Lens 1.9.1.2 has no prepared or validated native evidence record. No guarded run
opened the exact 1.9.1 package and fixture, and no 1.9.1 PBIX was created or reopened. Current
repository, package, sample, Chromium, and release-manifest checks remain automated evidence only.

The previous Partner Center submission failed because Microsoft could not access the repository. Its
older package, PBIX, and listing were OSM-enabled and must be replaced. No certification claim is
made here. The final owner handoff requires the exact source commit, deterministic PBIVIZ hash,
genuine Power BI Desktop Save As/reopen PBIX hash, and truthful automated/native notes; if the
pattern-gated UI Automation harness cannot complete Save As, the owner must perform that step
manually without editing PBIX internals or fabricating evidence.

The attempted Desktop 2.157.879.0 (26.08) run reached the owned Save As dialog and stopped with
`The owned Save As dialog exposes no safe bound Pane control for ''`; controls `1001` (file name)
and `1` (Save) had no safe ValuePattern/InvokePattern. The exact owner-manual fallback is to open
the generated PBIP, import `dist\atlynProfileLens.1.9.1.2.pbiviz`, use **File > Save as** to write
`dist\release\AtlynProfileLensSample-1.9.1.2.pbix`, close and reopen it offline, then record its
hash and embedded-resource parity. That manual result must remain clearly identified as owner
evidence and cannot be substituted with SendKeys, coordinate input, Win32 messages, or PBIX edits.
