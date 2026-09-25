import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import {
  getAllProxies,
  getProxyById,
  getActiveProxy,
  createProxy,
  updateProxy,
  deleteProxy,
  setActiveProxy,
  initDefaultProxyIfNeeded,
} from "../src/proxies.js";
import { getProxyConfig } from "../src/instances.js";
import { getProxiesStorePath, getCredsStorePath, getProxyConfigPath } from "../src/storage.js";

test("Proxy Repository: CRUD lifecycle and atomic persistence", () => {
  // Initially, clean store
  const storePath = getProxiesStorePath();
  if (fs.existsSync(storePath)) {
    fs.unlinkSync(storePath);
  }

  // 1. Create first proxy (should auto-activate as it's the first proxy)
  const node1 = createProxy({
    tag: "inbound-socks-01",
    name: "Primary SOCKS5",
    type: "manual",
    protocol: "socks5",
    host: "192.168.1.100",
    port: 10808,
    username: "user1",
    password: "secretpassword123",
    isActive: false, // Should be forced to true because it's the first proxy
  });

  assert.ok(node1.id, "ProxyNode id should be defined");
  assert.strictEqual(node1.tag, "inbound-socks-01");
  assert.strictEqual(node1.isActive, true, "First proxy must automatically become active");
  assert.ok(node1.createdAt, "createdAt should be set");
  assert.ok(node1.updatedAt, "updatedAt should be set");

  // Verify proxy_config.json and creds were updated
  const config = getProxyConfig();
  assert.strictEqual(config.protocol, "socks5");
  assert.strictEqual(config.host, "192.168.1.100");
  assert.strictEqual(config.port, 10808);

  const credsRaw = fs.readFileSync(getCredsStorePath(), "utf-8");
  const creds = JSON.parse(credsRaw);
  assert.strictEqual(creds.user, "user1");
  assert.strictEqual(creds.pass, "secretpassword123");

  // 2. Create second proxy (not active)
  const node2 = createProxy({
    tag: "inbound-http-02",
    name: "Secondary HTTP",
    type: "manual",
    protocol: "http",
    host: "10.0.0.50",
    port: 8080,
    username: "user2",
    password: "httppassword456",
    isActive: false,
  });

  assert.strictEqual(node2.isActive, false);
  const activeAfter2 = getActiveProxy();
  assert.strictEqual(activeAfter2?.id, node1.id);

  // 3. Retrieve all proxies
  const all = getAllProxies();
  assert.strictEqual(all.length, 2);

  // 4. Password masking
  const maskedList = getAllProxies(true);
  const maskedNode1 = maskedList.find((p) => p.id === node1.id);
  const maskedNode2 = maskedList.find((p) => p.id === node2.id);
  assert.strictEqual(maskedNode1?.password, "********");
  assert.strictEqual(maskedNode2?.password, "********");

  // Unmasked remains intact in store
  const freshNode1 = getProxyById(node1.id);
  assert.strictEqual(freshNode1?.password, "secretpassword123");

  // 5. Set active proxy to node2
  const activated = setActiveProxy(node2.id);
  assert.strictEqual(activated.isActive, true);
  assert.strictEqual(getActiveProxy()?.id, node2.id);
  assert.strictEqual(getProxyById(node1.id)?.isActive, false);

  // Verify config and creds synchronized to node2
  const updatedConfig = getProxyConfig();
  assert.strictEqual(updatedConfig.protocol, "http");
  assert.strictEqual(updatedConfig.host, "10.0.0.50");
  assert.strictEqual(updatedConfig.port, 8080);

  const updatedCreds = JSON.parse(fs.readFileSync(getCredsStorePath(), "utf-8"));
  assert.strictEqual(updatedCreds.user, "user2");
  assert.strictEqual(updatedCreds.pass, "httppassword456");

  // 6. Update proxy
  const updatedNode2 = updateProxy(node2.id, {
    name: "Secondary HTTP Updated",
    port: 8081,
  });
  assert.strictEqual(updatedNode2.name, "Secondary HTTP Updated");
  assert.strictEqual(updatedNode2.port, 8081);
  assert.strictEqual(getProxyConfig().port, 8081);

  // 7. Delete proxy
  // Deleting active node2 should make node1 active
  const deleted = deleteProxy(node2.id);
  assert.strictEqual(deleted, true);
  assert.strictEqual(getAllProxies().length, 1);
  assert.strictEqual(getActiveProxy()?.id, node1.id);
  assert.strictEqual(getProxyConfig().host, "192.168.1.100");

  // Deleting last remaining proxy
  const deletedLast = deleteProxy(node1.id);
  assert.strictEqual(deletedLast, true);
  assert.strictEqual(getAllProxies().length, 0);
  assert.strictEqual(getActiveProxy(), undefined);

  // Deleting non-existent returns false
  assert.strictEqual(deleteProxy("non-existent-id"), false);
});

test("Proxy Repository: Validation of host and port", () => {
  // Invalid host
  assert.throws(() => {
    createProxy({
      tag: "bad-host",
      name: "Bad Host",
      type: "manual",
      protocol: "socks5",
      host: "host with spaces",
      port: 10808,
      isActive: false,
    });
  }, /Invalid host format/);

  assert.throws(() => {
    createProxy({
      tag: "bad-host-injection",
      name: "Bad Host",
      type: "manual",
      protocol: "socks5",
      host: "evil.com;rm -rf /",
      port: 10808,
      isActive: false,
    });
  }, /Invalid host format/);

  // Invalid port
  assert.throws(() => {
    createProxy({
      tag: "bad-port",
      name: "Bad Port",
      type: "manual",
      protocol: "socks5",
      host: "127.0.0.1",
      port: 70000,
      isActive: false,
    });
  }, /Invalid port number/);

  assert.throws(() => {
    createProxy({
      tag: "bad-port-zero",
      name: "Bad Port",
      type: "manual",
      protocol: "socks5",
      host: "127.0.0.1",
      port: 0,
      isActive: false,
    });
  }, /Invalid port number/);
});

test("Proxy Repository: initDefaultProxyIfNeeded migrates existing setup", () => {
  const storePath = getProxiesStorePath();
  if (fs.existsSync(storePath)) {
    fs.unlinkSync(storePath);
  }

  initDefaultProxyIfNeeded();

  const proxies = getAllProxies();
  assert.strictEqual(proxies.length, 1);
  const def = proxies[0];
  assert.strictEqual(def.isActive, true);
  assert.ok(def.name);
  assert.ok(def.tag);
  assert.strictEqual(def.host, getProxyConfig().host);
  assert.strictEqual(def.port, getProxyConfig().port);

  // Running it again does not duplicate
  initDefaultProxyIfNeeded();
  assert.strictEqual(getAllProxies().length, 1);
});

test("Proxy Repository: edge cases and error handling", () => {
  const storePath = getProxiesStorePath();
  if (fs.existsSync(storePath)) {
    fs.unlinkSync(storePath);
  }

  // 1. getProxyById non-existent returns undefined
  assert.strictEqual(getProxyById("missing"), undefined);

  // 2. create proxy A (becomes active)
  const a = createProxy({
    tag: "proxy-a",
    name: "Proxy A",
    type: "manual",
    protocol: "socks5",
    host: "1.1.1.1",
    port: 1080,
    isActive: true,
  });
  assert.strictEqual(a.isActive, true);

  // 3. create proxy B with explicit isActive: true -> A should be deactivated
  const b = createProxy({
    tag: "proxy-b",
    name: "Proxy B",
    type: "manual",
    protocol: "http",
    host: "2.2.2.2",
    port: 8080,
    isActive: true,
  });
  assert.strictEqual(b.isActive, true);
  assert.strictEqual(getProxyById(a.id)?.isActive, false);
  assert.strictEqual(getActiveProxy()?.id, b.id);

  // 4. delete inactive proxy A -> B remains active
  const deletedA = deleteProxy(a.id);
  assert.strictEqual(deletedA, true);
  assert.strictEqual(getActiveProxy()?.id, b.id);

  // 5. updateProxy validation and errors
  assert.throws(() => {
    updateProxy("non-existent-id", { name: "New Name" });
  }, /Proxy not found/);

  assert.throws(() => {
    updateProxy(b.id, { host: "invalid host!@" });
  }, /Invalid host format/);

  assert.throws(() => {
    updateProxy(b.id, { port: 999999 });
  }, /Invalid port number/);

  assert.throws(() => {
    setActiveProxy("missing-id");
  }, /Proxy not found/);

  // 6. password masking when password is empty or undefined
  const c = createProxy({
    tag: "proxy-c",
    name: "Proxy C",
    type: "manual",
    protocol: "socks5",
    host: "3.3.3.3",
    port: 1080,
    // no username or password
  });
  const masked = getAllProxies(true);
  const maskedC = masked.find((p) => p.id === c.id);
  assert.strictEqual(maskedC?.password, "");
});
