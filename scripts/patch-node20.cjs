// Polyfill Node 22+ APIs required by undici@8 / jsdom@30 when running on Node 20
const zlib = require("node:zlib");
const workerThreads = require("node:worker_threads");
const vm = require("node:vm");

if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

if (typeof globalThis.Iterator === "undefined") {
  globalThis.Iterator = class Iterator {
    constructor() {}
    [Symbol.iterator]() {
      return this;
    }
    static from(val) {
      if (val && typeof val[Symbol.iterator] === "function") {
        return val[Symbol.iterator]();
      }
      return val;
    }
  };
}

// In Node 20, JSDOM inspects `name in global` and attempts to run `vm.runInContext(globalName, window)`
// for each global in `jsGlobals`. Since `globalThis.Iterator` was added above, JSDOM runs
// `vm.runInContext("Iterator", window)` inside newly created VM contexts which don't natively have Iterator.
if (typeof vm.createContext === "function") {
  const origCreateContext = vm.createContext;
  vm.createContext = function (...args) {
    const ctx = origCreateContext.apply(this, args);
    if (ctx && typeof ctx === "object") {
      if (!("Iterator" in ctx)) {
        try {
          ctx.Iterator = globalThis.Iterator;
        } catch (_) {}
      }
      if (ctx.Promise && typeof ctx.Promise.withResolvers !== "function") {
        try {
          ctx.Promise.withResolvers = Promise.withResolvers;
        } catch (_) {}
      }
    }
    return ctx;
  };

  const origScriptRunInContext = vm.Script.prototype.runInContext;
  vm.Script.prototype.runInContext = function (contextifiedObject, options) {
    if (contextifiedObject && typeof contextifiedObject === "object") {
      if (!("Iterator" in contextifiedObject)) {
        try {
          contextifiedObject.Iterator = globalThis.Iterator;
        } catch (_) {}
      }
      if (
        contextifiedObject.Promise &&
        typeof contextifiedObject.Promise.withResolvers !== "function"
      ) {
        try {
          contextifiedObject.Promise.withResolvers = Promise.withResolvers;
        } catch (_) {}
      }
    }
    return origScriptRunInContext.call(this, contextifiedObject, options);
  };
}

if (typeof zlib.createZstdDecompress !== "function") {
  zlib.createZstdDecompress = function () {
    const stream = new (require("node:stream").Transform)();
    return stream;
  };
}

if (!zlib.constants) {
  zlib.constants = {};
}
if (zlib.constants.ZSTD_d_windowLogMax === undefined) {
  zlib.constants.ZSTD_d_windowLogMax = 0;
}

if (typeof zlib.zstdCompressSync !== "function") {
  zlib.zstdCompressSync = function () {
    throw new Error("zstd is not supported on this Node.js version");
  };
}

if (typeof zlib.zstdDecompressSync !== "function") {
  zlib.zstdDecompressSync = function () {
    throw new Error("zstd is not supported on this Node.js version");
  };
}

if (typeof workerThreads.markAsUncloneable !== "function") {
  workerThreads.markAsUncloneable = function (val) {
    return val;
  };
}
