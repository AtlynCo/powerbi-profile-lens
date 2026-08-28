# Private Repository Operations

The GitHub source for Atlyn Profile Lens may become private without making its public Marketplace
offer private. Changing GitHub visibility is an owner/admin operation; it is not implemented in
source code and must not be simulated by changing Partner Center plan visibility.

## Invariants

- Keep the public Marketplace offer published and discoverable. The current Partner Center state was
  observed by the owner as **publish-in-progress**; repository files do not independently verify that
  state and make no certification claim.
- Preserve the display name, GUID, four-part version, API version, and package contents for a
  privacy-only transition: Atlyn Profile Lens, `atlynProfileLens`, `1.9.1.2`, and API `5.11.0`.
- Microsoft requires a public offer and an exact lowercase `certification` branch matching the
  submitted `.pbiviz`. No remote `certification` branch was present when this checklist was prepared.
  Do not invent, rewrite, force-push, or update that branch as part of this preparation.
- Do not claim certification from repository files alone. Confirm the exact reviewed commit, package,
  and version in the Microsoft certification record.
- Never commit passwords, tokens, recovery codes, collaborator credentials, or other access secrets.

## Owner checklist before changing visibility

- [ ] Confirm the exact source commit and submitted `.pbiviz` artifact associated with Microsoft's
      review. Record the artifact hash outside the repository.
- [ ] Confirm that the lowercase `certification` branch contains the exact reviewed source and package
      state required by Microsoft. If it does not exist, create it only as an owner-controlled
      promotion of the exact reviewed commit; do not derive it from this preparation branch.
- [ ] Add Microsoft's requested validation account or read-only collaborator to the private repository
      using least privilege. Verify access to the exact `certification` branch and any private
      dependencies. This repository currently shows only the owner as a collaborator.
- [ ] Keep all package dependencies available to the validation account. The committed lockfile
      resolves the visual's packages from the public npm registry; obtain explicit access for any
      future private dependency.
- [ ] In Partner Center, verify that these public endpoints are reachable without GitHub
      authentication:
      `https://www.atlynco.com/docs/faq`,
      `https://www.atlynco.com/legal/privacy`, and
      `https://www.atlynco.com/legal/terms`.
- [ ] Test those endpoints from a signed-out or private browser window and confirm that the public
      Marketplace offer remains published after the visibility change.

## Visibility change and follow-up

1. The owner changes GitHub repository visibility to private in repository settings. No code,
   package, or Partner Center plan change is required.
2. Using the Microsoft validation account, verify access to the exact lowercase `certification`
   branch, manifest files, and reviewed artifact.
3. From a clean checkout of the reviewed source, run `npm ci` and
   `npm run validate:certification`. Keep generated `dist/` output out of commits.
4. Recheck the public Marketplace listing and support/legal endpoints after the visibility change.
   Do not rely on a private GitHub URL for listing support or legal notices.

## Future releases

A functional or package-content change is a separate release decision. Bump the four-part version
consistently in `package.json`, `pbiviz.json`, documentation, and version assertions, then promote
the exact reviewed source and package state to `certification` only when Microsoft requires it. A
privacy-only transition must not regenerate a package or rewrite the certification branch.
