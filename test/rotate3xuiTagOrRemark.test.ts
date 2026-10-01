import test from "node:test";
import assert from "node:assert/strict";
import { findInboundByTagOrRemark } from "../src/rotate.js";
import { preservePasswordOnConfigUpdate } from "../src/routes/configRoutes.js";

test("findInboundByTagOrRemark matches by exact tag, trimmed tag, or remark", () => {
  const inbounds = [
    { id: 1, tag: "vless-inbound-1", remark: "US Office Primary" },
    { id: 2, tag: "vless-inbound-2", remark: "EU Failover" }
  ];

  assert.equal(findInboundByTagOrRemark(inbounds, "vless-inbound-1")?.id, 1);
  assert.equal(findInboundByTagOrRemark(inbounds, "  vless-inbound-1  ")?.id, 1);
  assert.equal(findInboundByTagOrRemark(inbounds, "VLESS-INBOUND-1")?.id, 1);
  assert.equal(findInboundByTagOrRemark(inbounds, "US Office Primary")?.id, 1);
  assert.equal(findInboundByTagOrRemark(inbounds, "  us office primary  ")?.id, 1);
  assert.equal(findInboundByTagOrRemark(inbounds, "eu failover")?.id, 2);
  assert.equal(findInboundByTagOrRemark(inbounds, "unknown"), undefined);
});

test("preservePasswordOnConfigUpdate preserves existing rotAdminPass when submitted empty or undefined", () => {
  const currentConfig = {
    panelUrl: "https://3xui.corp:2053",
    adminUser: "admin",
    adminPass: "stored-secret-password-123",
    rotAdminPass: "stored-secret-password-123",
  };

  // Case 1: Empty string rotAdminPass should preserve current password
  const res1 = preservePasswordOnConfigUpdate({ rotAdminPass: "" }, currentConfig);
  assert.equal(res1.adminPass, "stored-secret-password-123");
  assert.equal(res1.rotAdminPass, "stored-secret-password-123");

  // Case 2: Undefined rotAdminPass should preserve current password
  const res2 = preservePasswordOnConfigUpdate({ rotAdminPass: undefined }, currentConfig);
  assert.equal(res2.adminPass, "stored-secret-password-123");
  assert.equal(res2.rotAdminPass, "stored-secret-password-123");

  // Case 3: Empty string adminPass should also preserve current password
  const res3 = preservePasswordOnConfigUpdate({ adminPass: "" }, currentConfig);
  assert.equal(res3.adminPass, "stored-secret-password-123");

  // Case 4: Non-empty new password updates the password
  const res4 = preservePasswordOnConfigUpdate({ rotAdminPass: "brand-new-pass-456" }, currentConfig);
  assert.equal(res4.adminPass, "brand-new-pass-456");
  assert.equal(res4.rotAdminPass, "brand-new-pass-456");
});
