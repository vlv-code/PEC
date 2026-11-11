// Polyfill Node 22+ APIs required by undici@8 / jsdom@30 when running on Node 20
const zlib = require("node:zlib");
const workerThreads = require("node:worker_threads");

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
