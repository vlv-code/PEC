import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderPopupJs } from "../src/templates/popupJsTemplate.js";

test("renderPopupJs() output contains Promise.any parallel IP checking engine", () => {
  const code = renderPopupJs();
  assert.ok(
    code.includes("Promise.any"),
    "renderPopupJs() must use Promise.any for racing IP resolvers"
  );
  assert.ok(
    code.includes("AbortController"),
    "renderPopupJs() must use AbortController to abort slower requests"
  );
  assert.ok(
    code.includes('cache: "no-store"'),
    "renderPopupJs() must use cache: no-store to avoid stale IP caching"
  );
});

test("extension/popup.js static file matches Promise.any parallel check", () => {
  const popupJs = fs.readFileSync(path.resolve("extension/popup.js"), "utf8");
  assert.ok(
    popupJs.includes("Promise.any"),
    "extension/popup.js must use Promise.any"
  );
  assert.ok(
    popupJs.includes("AbortController"),
    "extension/popup.js must use AbortController"
  );
});

test("Parallel IP checking engine logic resolves with fastest valid IP and aborts pending queries", async () => {
  // Test the racing algorithm behavior
  const abortSignalsReceived: boolean[] = [];

  const mockFastEndpoint = async (signal: AbortSignal) => {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => resolve("198.51.100.42"), 20);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        abortSignalsReceived.push(true);
        reject(new Error("aborted"));
      });
    });
  };

  const mockSlowEndpoint = async (signal: AbortSignal) => {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => resolve("203.0.113.99"), 300);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        abortSignalsReceived.push(true);
        reject(new Error("aborted"));
      });
    });
  };

  const mockInvalidEndpoint = async (_signal: AbortSignal) => {
    // Returns invalid non-IP string (like HTML error or rate limit)
    return "<html>Error 429 Too Many Requests</html>";
  };

  function isIpAddress(str: string): boolean {
    if (!str || typeof str !== "string") return false;
    let s = str.trim();
    if (s.startsWith("::ffff:")) s = s.substring(7);
    if (/^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(s)) return true;
    if (/^[a-fA-F0-9:]{2,39}$/.test(s) && s.includes(":")) return true;
    return false;
  }

  async function resolveFastestIp(endpoints: Array<(signal: AbortSignal) => Promise<string>>): Promise<string> {
    const controller = new AbortController();
    try {
      const result = await Promise.any(
        endpoints.map(async (fn) => {
          const raw = await fn(controller.signal);
          if (!isIpAddress(raw)) {
            throw new Error("Invalid IP payload: " + raw);
          }
          return raw.trim();
        })
      );
      controller.abort();
      return result;
    } catch {
      controller.abort();
      throw new Error("All endpoints failed");
    }
  }

  const fastest = await resolveFastestIp([mockSlowEndpoint, mockFastEndpoint, mockInvalidEndpoint]);
  assert.equal(fastest, "198.51.100.42", "Must resolve to the fast valid endpoint");
  assert.ok(abortSignalsReceived.length > 0, "Slow endpoint must have received abort signal");
});
