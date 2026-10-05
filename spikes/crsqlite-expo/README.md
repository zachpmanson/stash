# CR-SQLite / Expo feasibility spike

This spike has two independent projects, each with its own `flake.nix`, Node dependencies, and lockfile:

- [`app/`](app/README.md) — disposable Expo Android client and native CR-SQLite test harness.
- [`server/`](server/README.md) — isolated Node 24 WebSocket service and lifecycle/backup tests.

Develop each project from its own directory with `nix develop`; neither depends on the Stash root flake or root pnpm workspace. The app and server share the same disposable candidate schema by convention only. No Stash production database, schema, or sync lifecycle is enabled by this spike.
