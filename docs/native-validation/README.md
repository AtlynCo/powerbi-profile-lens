# Native validation evidence

`atlynProfileLens-1.2.0.0.*` is a historical blocked record only. It is not current fixture,
automation, package, or release evidence.

Atlyn Profile Lens 1.9.1.2 has no completed guarded native evidence record. The final owner-created
1191138-byte PBIX with SHA-256
`af5c8c588592013fe4e03ccfeb0af405bb5f9544a1064d59b09f41c424c01563` was saved and
reopened with unchanged bytes on 2026-09-09. Read-only inspection verified the exact current package
payload and two active canonical PBIR references. This is limited owner evidence, not a completed
full native checklist or automated native run. The earlier `d3e60d8b...d4e2bd` PBIX remains stale
and must not be used for submission.

Candidate 1.9.1.3 has no PBIX or native evidence. It changes the visual version and support URL only,
and no shared Power BI Desktop session was used to prepare it. A future 1.9.1.3 PBIX must be created
from the matching generated PBIP after the active 1.9.1.2 Microsoft review concludes.

The previous Partner Center submission failed because Microsoft could not access the repository. Its
older package, PBIX, and listing were OSM-enabled and must be replaced. No certification claim is
made here. The final owner handoff requires the exact source commit, deterministic PBIVIZ hash,
genuine Power BI Desktop Save As/reopen PBIX hash, and truthful automated/native notes; if the
pattern-gated UI Automation harness cannot complete Save As, the owner must perform that step
manually without editing PBIX internals or fabricating evidence.

The attempted Desktop 2.157.879.0 (26.08) run reached the owned Save As dialog and stopped with
`The owned Save As dialog exposes no safe bound Pane control for ''`; controls `1001` (file name)
and `1` (Save) had no safe ValuePattern/InvokePattern. The exact owner-manual fallback is to open
the generated PBIP, import `dist\atlynProfileLens.1.9.1.3.pbiviz`, use **File > Save as** to write
`dist\release\AtlynProfileLensSample-1.9.1.3.pbix`, close and reopen it offline, then record its
hash and embedded-resource parity. The existing 1.9.1.2 result is identified above as limited owner
evidence; that PBIX was not fabricated or edited and cannot serve as 1.9.1.3 evidence.
