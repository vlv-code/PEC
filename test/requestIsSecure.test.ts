import { test } from "node:test";
import assert from "node:assert/strict";
import { requestIsSecure } from "../src/auth.js";

test("S-6: requestIsSecure relies strictly on req.secure (honoring Express trust proxy)", () => {
  // 1. req.secure is true -> returns true
  assert.equal(requestIsSecure({ secure: true, headers: {} }), true);

  // 2. req.secure is false, but malicious x-forwarded-proto: https is present -> returns false
  assert.equal(
    requestIsSecure({
      secure: false,
      headers: { "x-forwarded-proto": "https" },
    }),
    false,
    "Raw x-forwarded-proto header must not be blindly trusted without trust proxy"
  );

  // 3. req.secure is undefined, but malicious x-forwarded-proto: https is present -> returns false
  assert.equal(
    requestIsSecure({
      headers: { "x-forwarded-proto": "https, http" },
    }),
    false,
    "Raw spoofed x-forwarded-proto header must be ignored"
  );

  // 4. req.secure is false with empty headers -> returns false
  assert.equal(requestIsSecure({ secure: false, headers: {} }), false);

  // 5. req.secure is true even without headers -> returns true
  assert.equal(requestIsSecure({ secure: true, headers: {} }), true);

  // 6. req is null or undefined -> returns false safely without throwing TypeError
  assert.equal(requestIsSecure(undefined), false);
  assert.equal(requestIsSecure(null), false);
  assert.equal(requestIsSecure({}), false);

  // 7. req.secure is true with conflicting x-forwarded-proto -> returns true (Express trust-proxy decision is authoritative)
  assert.equal(
    requestIsSecure({
      secure: true,
      headers: { "x-forwarded-proto": "http" },
    }),
    true
  );
});
