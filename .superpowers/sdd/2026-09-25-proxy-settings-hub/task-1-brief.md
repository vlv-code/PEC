# Task 1 Brief: Centralized Storage & Persistence (`src/storage.ts` & Docker)

## Goal
Implement `src/storage.ts` to provide centralized data directory management, ensuring all data files default to `./data` (in dev) or `/app/data` (in Docker container) so state is never lost on container rebuilds. Update `Dockerfile` to declare `VOLUME ["/app/data"]` and `ENV DATA_DIR=/app/data`.

## Files
- Create: `src/storage.ts`
- Modify: `Dockerfile`
- Test: `test/storage.test.ts`

## Requirements
1. `src/storage.ts` must export:
   - `getDataDir(): string` - returns `path.resolve(process.env.DATA_DIR || "./data")` and ensures the directory exists with `fs.mkdirSync(dir, { recursive: true })`.
   - `getProxiesStorePath(): string` - `process.env.PROXIES_STORE_PATH || path.join(getDataDir(), "proxies.json")`
   - `getCredsStorePath(): string` - `process.env.CREDS_STORE || path.join(getDataDir(), "current_creds.json")`
   - `getProxyConfigPath(): string` - `process.env.PROXY_CONFIG_PATH || path.join(getDataDir(), "proxy_config.json")`
   - `getRoutingProfilesPath(): string` - `process.env.ROUTING_PROFILES_PATH || path.join(getDataDir(), "routing_profiles.json")`
   - `getInstancesMetaPath(): string` - `process.env.INSTANCES_META_PATH || path.join(getDataDir(), "instances_meta.json")`
   - `getRotationConfigPath(): string` - `process.env.ROTATION_CONFIG_PATH || path.join(getDataDir(), "rotation_config.json")`
   - `getRotationHistoryPath(): string` - `process.env.ROTATION_HISTORY_PATH || path.join(getDataDir(), "rotation_history.json")`
   - `getDashboardAuthPath(): string` - `process.env.DASHBOARD_AUTH_PATH || path.join(getDataDir(), "dashboard_auth.json")`
   - `getBuilderConfigPath(): string` - `process.env.BUILDER_CONFIG || path.join(getDataDir(), "extension_build_config.json")`
2. Update existing callers in `src/instances.ts`, `src/rotate.ts`, `src/scheduler.ts`, `src/routing.ts`, `src/auth.ts`, `src/packager.ts` to import and use these path helpers so all stores reside in `DATA_DIR` by default!
3. `Dockerfile`:
   - In runner stage, add `ENV DATA_DIR=/app/data`.
   - Add `VOLUME ["/app/data"]`.
4. Test:
   - Create `test/storage.test.ts` testing `getDataDir()` and default store paths.
   - Run `npm test test/storage.test.ts`. All existing tests must also pass (`npm test`).
5. Commit:
   - Commit changes with message `feat: add centralized storage module with guaranteed persistence`.
