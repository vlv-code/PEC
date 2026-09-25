# Task 3 Report: 3x-ui Inbound Sync and Rotation by Tag

## Summary
Successfully implemented inbound lookup and password rotation by `tag` in `src/rotate.ts` with fallback to `remark`, supporting protocol mapping (`socks` -> `socks5`, `http` -> `http`, TLS security -> `https`), port, and account credentials extraction. Updated `test3xuiConnection` to search by `tag` first then `remark`. Updated `executeRotation` to support `inboundTag` and automatically synchronize rotated credentials to the active `3x-ui` proxy node in `src/proxies.ts`.

## Changes Made
1. **`src/types.ts`**:
   - Added optional `inboundTag?: string` to `RotationConfig`.
2. **`src/rotate.ts`**:
   - Implemented and exported `sync3xuiInboundByTag`:
     - SSRF validation via `validateSafeEndpointUrl`.
     - Panel authentication via `panelLogin` (CSRF token + session cookie).
     - Inbound list retrieval from `/panel/api/inbounds/list`.
     - Inbound lookup matching `i.tag === params.tag`, falling back to `i.remark === params.tag`.
     - Protocol resolution: checks `streamSettings.security === "tls"` for `"https"`, otherwise maps `"socks"` -> `"socks5"`, `"http"` -> `"http"`, defaulting to `"socks5"`.
     - Account credential parsing from `settings.accounts[0]`.
     - In password rotation mode (`rotatePassword: true`): verifies account exists, generates 24-character cryptographic random password (`base64url`), updates inbound via `POST /panel/api/inbounds/update/:id`.
     - In read-only mode (`rotatePassword: false`): returns extracted inbound details with current credentials.
   - Updated `test3xuiConnection`:
     - Added `inboundTag?: string` parameter support.
     - Looks up by `tag` first, then falls back to `remark`.
   - Updated `executeRotation`:
     - Delegates panel rotation to `sync3xuiInboundByTag`.
     - Uses `inboundTag` when specified (falling back to `inboundRemark`).
     - Updates active `3x-ui` proxy node in `src/proxies.ts` (`password` and `lastSync`) when active proxy node is of type `3x-ui`.
3. **`src/scheduler.ts`**:
   - Updated `DEFAULT_CONFIG` with `inboundTag: process.env.XUI_INBOUND_TAG || undefined`.
4. **`test/rotation.test.ts`**:
   - Followed TDD methodology:
     - RED phase: Added 5 comprehensive test cases covering read-only sync, TLS & socks protocol mapping, remark fallback, password rotation in panel, SSRF & missing inbound errors, `test3xuiConnection` with `inboundTag`, and `executeRotation` active proxy node update. Verified expected failures.
     - GREEN phase: Implemented logic in `src/rotate.ts`, `src/types.ts`, `src/scheduler.ts` and verified all tests pass.

## Verification
- `npm test`: 81 tests passing (0 failures).
- `npm run lint`: 0 errors (`tsc --noEmit`).
