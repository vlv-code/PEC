import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createBuilderRouter } from "../src/routes/builderRoutes.js";

test("GPO API routes deliver pack, reg, and scripts", async () => {
  const app = express();
  app.use(express.json());
  const router = createBuilderRouter(
    () => "fleet-test-token-123",
    () => "admin-test-token-456"
  );
  app.use(router);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GPO Pack download
    const packRes = await fetch(`${baseUrl}/api/builder/gpo-pack`);
    assert.equal(packRes.status, 200);
    assert.ok(
      packRes.headers.get("content-type")?.includes("zip") ||
      packRes.headers.get("content-disposition")?.includes("pec-gpo-deployment-pack.zip"),
      "must return zip"
    );
    const packBuffer = Buffer.from(await packRes.arrayBuffer());
    assert.ok(packBuffer.length > 0);

    // 2. User Reg file download
    const regRes = await fetch(`${baseUrl}/api/builder/reg?scope=user`);
    assert.equal(regRes.status, 200);
    const regText = await regRes.text();
    assert.ok(regText.includes("HKEY_CURRENT_USER"), "reg file must be for HKCU");

    // 3. Machine Reg file download
    const regMachineRes = await fetch(`${baseUrl}/api/builder/reg?scope=machine`);
    assert.equal(regMachineRes.status, 200);
    const regMachineText = await regMachineRes.text();
    assert.ok(regMachineText.includes("HKEY_LOCAL_MACHINE"), "reg file must be for HKLM");

    // 4. Deploy script download
    const deployRes = await fetch(`${baseUrl}/api/builder/script/deploy.ps1`);
    assert.equal(deployRes.status, 200);
    const deployText = await deployRes.text();
    assert.ok(deployText.includes("ExtensionInstallForcelist"), "script must contain forcelist logic");

    // 5. Verify script download
    const verifyRes = await fetch(`${baseUrl}/api/builder/script/verify.ps1`);
    assert.equal(verifyRes.status, 200);
    const verifyText = await verifyRes.text();
    assert.ok(verifyText.includes("/healthz"), "script must contain healthz check");

    // 6. Extension info includes enhanced GPO metadata
    const infoRes = await fetch(`${baseUrl}/api/extension/info`);
    assert.equal(infoRes.status, 200);
    const infoJson = await infoRes.json() as any;
    assert.ok(infoJson.gpo.forcelistEntries.chrome);
    assert.ok(infoJson.gpo.regContentUser);
    assert.ok(infoJson.gpo.regContentMachine);
  } finally {
    server.close();
  }
});
