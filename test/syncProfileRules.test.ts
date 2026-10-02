import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createCredsRouter } from "../src/routes/credsRoutes.js";

test("POST /api/sync returns profileRules with expanded domains and actions", async () => {
  const sharedToken = "test-sync-token-999";
  const app = express();
  app.use(express.json());
  app.use(createCredsRouter(() => sharedToken));

  const server = app.listen(0);
  const port = (server.address() as any).port;

  try {
    const postData = JSON.stringify({
      token: sharedToken,
      instanceId: "test-tab-badge-instance",
    });

    const response = await new Promise<{ status: number; json: any }>((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${port}/api/sync`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
            "x-ext-token": sharedToken,
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode || 0, json: JSON.parse(body) });
            } catch (err) {
              reject(err);
            }
          });
        }
      );
      req.on("error", reject);
      req.write(postData);
      req.end();
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.ok, true);
    assert.ok(Array.isArray(response.json.profileRules), "profileRules must be an array");
    assert.ok(response.json.profileRules.length > 0, "profileRules must not be empty");

    // Check that profileRules elements have action and domains
    const aiRule = response.json.profileRules.find((r: any) =>
      r.domains.includes("gemini.google.com")
    );
    assert.ok(aiRule, "profileRules must include AI services rule containing gemini.google.com");
    assert.equal(aiRule.action, "proxy");

    const ipCheckRule = response.json.profileRules.find((r: any) =>
      r.domains.includes("checkip.amazonaws.com")
    );
    assert.ok(ipCheckRule, "profileRules must include IP check rule containing checkip.amazonaws.com");
    assert.equal(ipCheckRule.action, "proxy");
  } finally {
    server.close();
  }
});
