import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import workerThreads from "node:worker_threads";
import vm from "node:vm";

// Node 20 compatibility: polyfill Promise.withResolvers, global Iterator, zlib and worker_threads APIs required by undici/jsdom
if (typeof (Promise as any).withResolvers !== "function") {
  (Promise as any).withResolvers = function () {
    let resolve: any, reject: any;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

if (typeof (globalThis as any).Iterator === "undefined") {
  (globalThis as any).Iterator = class Iterator {
    constructor() {}
    [Symbol.iterator]() {
      return this;
    }
    find(predicate: any) {
      let index = 0;
      for (const item of (this as any)) {
        if (predicate(item, index++)) return item;
      }
      return undefined;
    }
    some(predicate: any) {
      let index = 0;
      for (const item of (this as any)) {
        if (predicate(item, index++)) return true;
      }
      return false;
    }
    every(predicate: any) {
      let index = 0;
      for (const item of (this as any)) {
        if (!predicate(item, index++)) return false;
      }
      return true;
    }
    forEach(fn: any) {
      let index = 0;
      for (const item of (this as any)) {
        fn(item, index++);
      }
    }
    toArray() {
      const arr = [];
      for (const item of (this as any)) {
        arr.push(item);
      }
      return arr;
    }
    reduce(fn: any, initialValue: any) {
      let acc = initialValue;
      let hasAcc = arguments.length >= 2;
      let index = 0;
      for (const item of (this as any)) {
        if (!hasAcc) {
          acc = item;
          hasAcc = true;
        } else {
          acc = fn(acc, item, index);
        }
        index++;
      }
      if (!hasAcc) throw new TypeError("Reduce of empty iterator with no initial value");
      return acc;
    }
    static from(val: any) {
      if (val && typeof val[Symbol.iterator] === "function") {
        return val[Symbol.iterator]();
      }
      return val;
    }
  };
}

if (typeof vm.createContext === "function") {
  const origCreateContext = vm.createContext;
  vm.createContext = function (...args: any[]) {
    const ctx = origCreateContext.apply(this, args as any);
    if (ctx && typeof ctx === "object") {
      if (!("Iterator" in ctx)) {
        try {
          ctx.Iterator = (globalThis as any).Iterator;
        } catch (_) {}
      }
      if (ctx.Promise && typeof ctx.Promise.withResolvers !== "function") {
        try {
          ctx.Promise.withResolvers = (Promise as any).withResolvers;
        } catch (_) {}
      }
    }
    return ctx;
  };

  const origScriptRunInContext = vm.Script.prototype.runInContext;
  vm.Script.prototype.runInContext = function (contextifiedObject: any, options: any) {
    if (contextifiedObject && typeof contextifiedObject === "object") {
      if (!("Iterator" in contextifiedObject)) {
        try {
          contextifiedObject.Iterator = (globalThis as any).Iterator;
        } catch (_) {}
      }
      if (
        contextifiedObject.Promise &&
        typeof contextifiedObject.Promise.withResolvers !== "function"
      ) {
        try {
          contextifiedObject.Promise.withResolvers = (Promise as any).withResolvers;
        } catch (_) {}
      }
    }
    return origScriptRunInContext.call(this, contextifiedObject, options);
  };
}
if (typeof (zlib as any).createZstdDecompress !== "function") {
  (zlib as any).createZstdDecompress = () => {
    const stream = new (require("node:stream").Transform)();
    return stream;
  };
}
if (!(zlib as any).constants) {
  (zlib as any).constants = {};
}
if ((zlib as any).constants.ZSTD_d_windowLogMax === undefined) {
  (zlib as any).constants.ZSTD_d_windowLogMax = 0;
}
if (typeof (zlib as any).zstdCompressSync !== "function") {
  (zlib as any).zstdCompressSync = () => {
    throw new Error("zstd is not supported on this Node.js version");
  };
}
if (typeof (zlib as any).zstdDecompressSync !== "function") {
  (zlib as any).zstdDecompressSync = () => {
    throw new Error("zstd is not supported on this Node.js version");
  };
}
if (typeof (workerThreads as any).markAsUncloneable !== "function") {
  (workerThreads as any).markAsUncloneable = (val: any) => val;
}

/**
 * Test isolation: every state store is redirected into a per-run temp
 * directory BEFORE any module under test is imported (modules resolve their
 * paths at import time). This file must be the first import of every test
 * file. Previously tests ran against the repository working directory and
 * permanently polluted routing_profiles.json / proxy_config.json - the repo
 * even had 11 duplicated "Test Split Tunnel" profiles committed in git.
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pec-test-"));

process.env.DATA_DIR = path.join(tmp, "data");
process.env.PROXIES_STORE_PATH = path.join(tmp, "proxies.json");
process.env.CREDS_STORE = path.join(tmp, "current_creds.json");
process.env.DASHBOARD_AUTH_PATH = path.join(tmp, "dashboard_auth.json");
process.env.PROXY_CONFIG_PATH = path.join(tmp, "proxy_config.json");
process.env.ROUTING_PROFILES_PATH = path.join(tmp, "routing_profiles.json");
process.env.INSTANCES_META_PATH = path.join(tmp, "instances_meta.json");
process.env.ROTATION_CONFIG_PATH = path.join(tmp, "rotation_config.json");
process.env.ROTATION_HISTORY_PATH = path.join(tmp, "rotation_history.json");
process.env.BUILDER_CONFIG = path.join(tmp, "extension_build_config.json");
process.env.APP_BUILD_CONFIG = path.join(tmp, "app_build_config.json");
process.env.APP_BUILD_INFO = path.join(tmp, "app_build_info.json");
process.env.RELEASES_META_PATH = path.join(tmp, "releases_meta.json");
process.env.PEC_RELEASES_DIR = path.join(tmp, "releases");
process.env.PEC_EXTENSION_DIR = path.join(tmp, "extension");
process.env.PEC_UPDATES_DIR = path.join(tmp, "updates");
const testTemplatesApp = path.join(tmp, "templates", "app");
if (fs.existsSync(path.resolve("./templates/app"))) {
  fs.cpSync(path.resolve("./templates/app"), testTemplatesApp, { recursive: true });
}
process.env.PEC_TEMPLATES_DIR = testTemplatesApp;
process.env.EXT_SHARED_TOKEN = "test-admin-token";
process.env.ADMIN_TOKEN = "test-root-admin-token";
process.env.PEC_DISABLE_LISTEN = "true";
process.env.ALLOW_INTERNAL_PANEL = "true";
process.env.SKIP_NATIVE_REBUILD = "true";

export const TEST_TMP_DIR = tmp;
export const TEST_TOKEN = process.env.EXT_SHARED_TOKEN;
export const TEST_ADMIN_TOKEN = process.env.ADMIN_TOKEN;
