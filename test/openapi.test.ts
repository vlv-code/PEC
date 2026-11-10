import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";

const REPO_ROOT = process.cwd();
const OPENAPI_PATH = path.join(REPO_ROOT, "docs", "openapi.yaml");

test("OpenAPI 3.1: docs/openapi.yaml exists and is valid YAML", () => {
  assert.ok(fs.existsSync(OPENAPI_PATH), "docs/openapi.yaml must exist");
  const raw = fs.readFileSync(OPENAPI_PATH, "utf-8");
  const doc = yaml.parse(raw);
  assert.ok(doc, "docs/openapi.yaml must parse as a valid YAML document");
  assert.equal(doc.openapi, "3.1.0", "Must specify OpenAPI 3.1.0");
  assert.ok(doc.info?.title, "Must define info.title");
  assert.ok(doc.info?.version, "Must define info.version");
});

test("OpenAPI 3.1: defines complete Two-Token Security Scheme model", () => {
  const doc = yaml.parse(fs.readFileSync(OPENAPI_PATH, "utf-8"));
  const schemes = doc.components?.securitySchemes;
  assert.ok(schemes, "components.securitySchemes must be defined");

  assert.ok(schemes.AdminBearer, "Must define AdminBearer HTTP bearer scheme");
  assert.equal(schemes.AdminBearer.type, "http");
  assert.equal(schemes.AdminBearer.scheme, "bearer");

  assert.ok(schemes.AdminHeader, "Must define AdminHeader API key scheme");
  assert.equal(schemes.AdminHeader.type, "apiKey");
  assert.equal(schemes.AdminHeader.name, "X-Admin-Token");

  assert.ok(schemes.FleetHeaderToken, "Must define FleetHeaderToken scheme");
  assert.equal(schemes.FleetHeaderToken.type, "apiKey");
  assert.equal(schemes.FleetHeaderToken.name, "X-Fleet-Token");

  assert.ok(schemes.ExtHeaderToken, "Must define ExtHeaderToken scheme");
  assert.equal(schemes.ExtHeaderToken.type, "apiKey");
  assert.equal(schemes.ExtHeaderToken.name, "X-Ext-Token");
});

test("OpenAPI 3.1: covers all required endpoints and operations", () => {
  const doc = yaml.parse(fs.readFileSync(OPENAPI_PATH, "utf-8"));
  const paths = doc.paths || {};

  const requiredEndpoints = [
    "/api/sync",
    "/api/app/sync",
    "/api/app/instances",
    "/api/routing/profiles",
    "/api/routing/presets",
    "/api/proxies",
    "/api/proxies/probe",
    "/api/builder/config",
    "/api/builder/build",
    "/api/builder/files",
    "/api/rotation/status",
    "/api/rotation/rotate",
    "/api/rotation/history",
    "/metrics",
  ];

  for (const ep of requiredEndpoints) {
    assert.ok(paths[ep], `Endpoint ${ep} must be documented in paths`);
  }
});

test("OpenAPI 3.1: all $ref references resolve cleanly without broken links", () => {
  const doc = yaml.parse(fs.readFileSync(OPENAPI_PATH, "utf-8"));

  const findRefs = (obj: any): string[] => {
    const refs: string[] = [];
    if (!obj || typeof obj !== "object") return refs;
    if (typeof obj.$ref === "string") refs.push(obj.$ref);
    for (const key of Object.keys(obj)) {
      refs.push(...findRefs(obj[key]));
    }
    return refs;
  };

  const refs = findRefs(doc);
  assert.ok(refs.length > 0, "Must contain component $ref references");

  for (const ref of refs) {
    assert.ok(ref.startsWith("#/"), `Reference ${ref} must be local fragment`);
    const parts = ref.slice(2).split("/");
    let cur: any = doc;
    for (const part of parts) {
      assert.ok(cur && Object.prototype.hasOwnProperty.call(cur, part), `Broken reference: ${ref} at part ${part}`);
      cur = cur[part];
    }
    assert.ok(cur !== undefined, `Target of ${ref} must not be undefined`);
  }
});
