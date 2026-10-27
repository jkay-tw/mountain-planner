# Mountain Planner — release and rollback workflow

## Branches
- `main`: production GitHub Pages source; no direct feature development.
- `feature/v0.6-reliability`: isolated work for v0.6 changes.
- `snapshot/v0.5.1-before-v0.6`: immutable-by-convention recovery reference at commit `b0ce20ae4ef51c359c870cca5ec55797206fec9b`. Do not commit to or delete this branch.

## Before editing
1. Confirm the intended base branch and latest commit.
2. Work only in a feature branch, with small descriptive commits.
3. Do not merge into `main` until functional testing and explicit owner approval.

## Validation before release
- Starting point and automatic official shortest route.
- Manual segment without minutes; don't treat missing as zero.
- Edit/delete/drag a node, notes, rest, peak and water flags.
- Two or more days, linked starts, and cross-day moves.
- Departure and arrival time arithmetic, day totals.
- Export/import JSON including invalid JSON and schema compatibility.
- Excel export and copy itinerary text.
- Mobile layout and browser console errors.

## Release
1. Review changes with a Pull Request into `main`.
2. Verify the preview or local build manually, including data preservation.
3. Make sure a known-good recovery reference exists.
4. Merge only with owner approval.
5. Create a version tag/release through GitHub when supported, and keep the rollback SHA.

## Rollback
Prefer a new revert commit or a new commit restoring the known-good tree; avoid force-pushing `main`.
For the original snapshot, use commit:
`b0ce20ae4ef51c359c870cca5ec55797206fec9b`.

## Local user data
Git tracks source code, NOT browser localStorage. Before deploying incompatible data changes, export an `.mplan.json` backup. Verify JSON validity and compatibility before replacing existing user plans.

## Preview deployment
A feature branch alone does NOT create a second GitHub Pages URL. Preview hosting requires a separately configured deployment (e.g., Actions to a preview path or external preview hosting). Until it is verified, do not claim the development branch is publicly previewable.
