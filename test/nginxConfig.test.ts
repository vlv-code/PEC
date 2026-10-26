import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

test("Nginx Config (H-4): upstream points to pec-server:3000 and SSL block is configured", () => {
  const confPath = path.resolve("deploy/nginx-proxy.conf");
  assert.strictEqual(fs.existsSync(confPath), true, "deploy/nginx-proxy.conf must exist");
  const content = fs.readFileSync(confPath, "utf-8");

  // Upstream must point to pec-server:3000, not 127.0.0.1:3000
  assert.match(content, /upstream\s+pec_backend\s*\{[^}]*server\s+pec-server:3000;/s);
  assert.doesNotMatch(content, /upstream\s+pec_backend\s*\{[^}]*server\s+127\.0\.0\.1:3000;/s);

  // Must have HTTP server on port 80 serving /proxy.pac and redirecting other routes
  assert.match(content, /listen\s+80;/);
  assert.match(content, /location\s+\/proxy\.pac\s*\{/);
  assert.match(content, /return\s+301\s+https:\/\/\$host\$request_uri;/);

  // Must have HTTPS server on port 443 with correct SSL certificate paths
  assert.match(content, /listen\s+443\s+ssl/);
  assert.match(content, /ssl_certificate\s+\/etc\/nginx\/ssl\/cert\.pem;/);
  assert.match(content, /ssl_certificate_key\s+\/etc\/nginx\/ssl\/key\.pem;/);
});
