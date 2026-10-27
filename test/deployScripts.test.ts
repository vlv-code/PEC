import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

test("docker-compose.yml: binds port to 127.0.0.1 by default (H-9)", () => {
  const composePath = path.resolve("docker-compose.yml");
  assert.strictEqual(fs.existsSync(composePath), true, "docker-compose.yml must exist");
  const content = fs.readFileSync(composePath, "utf-8");

  // Must bind to 127.0.0.1
  assert.match(
    content,
    /["']?127\.0\.0\.1:\$\{PORT:-3000\}:3000["']?/,
    "docker-compose.yml should bind port to 127.0.0.1"
  );
  assert.doesNotMatch(
    content,
    /-\s+["']\$\{PORT:-3000\}:3000["']/,
    "docker-compose.yml must not expose port globally on 0.0.0.0"
  );
});

test("deploy/install-docker.sh: checks docker & curl, warns on 3rd-party script, no raw tokens in echo/printf, warns on HTTP without TLS (H-7, H-9, M-23)", () => {
  const scriptPath = path.resolve("deploy/install-docker.sh");
  assert.strictEqual(fs.existsSync(scriptPath), true, "deploy/install-docker.sh must exist");
  const content = fs.readFileSync(scriptPath, "utf-8");

  // Must check if docker command exists
  assert.match(content, /command\s+-v\s+docker/);

  // Must check curl existence
  assert.match(content, /command\s+-v\s+curl/);

  // Must warn about third-party script execution if docker is missing
  assert.match(content, /(warning|предупреждение|сторонн|get\.docker\.com)/i);

  // Must NOT print raw ADMIN_TOKEN or SECURE_TOKEN to stdout via echo or printf
  assert.doesNotMatch(
    content,
    /(?:echo|printf)[^;\n]*\$(ADMIN_SEC_TOKEN|\{ADMIN_SEC_TOKEN\}|ADMIN_TOKEN|\{ADMIN_TOKEN\})/,
    "install-docker.sh must not echo or printf raw admin tokens"
  );
  assert.doesNotMatch(
    content,
    /(?:echo|printf)[^;\n]*\$(SECURE_TOKEN|\{SECURE_TOKEN\}|EXT_SHARED_TOKEN|\{EXT_SHARED_TOKEN\})/,
    "install-docker.sh must not echo or printf raw extension tokens"
  );

  // Must refer to .env and secure reading / chmod 0600
  assert.match(content, /\.env/);
  assert.match(content, /0600/);

  // Must handle existing .env with 0600 permissions
  assert.match(content, /chmod\s+0600\s+"\$INSTALL_DIR\/\.env"/);

  // Must warn about accessing dashboard over plain HTTP without TLS
  assert.match(content, /(TLS|HTTPS|HTTP[^\n]*(небезопасн|warning|без\s+TLS))/i);
});

test("deploy/install-systemd.sh: checks node & curl, warns on 3rd-party script, no raw tokens in echo/printf, full hardening directives & safe user/group (H-7, H-8, M-23)", () => {
  const scriptPath = path.resolve("deploy/install-systemd.sh");
  assert.strictEqual(fs.existsSync(scriptPath), true, "deploy/install-systemd.sh must exist");
  const content = fs.readFileSync(scriptPath, "utf-8");

  // Must check if node command exists
  assert.match(content, /command\s+-v\s+node/);

  // Must check curl existence
  assert.match(content, /command\s+-v\s+curl/);

  // Must warn about third-party script execution if node is missing
  assert.match(content, /(warning|предупреждение|сторонн|внешн|nodesource)/i);

  // Multi-distro support (rpm and deb)
  assert.match(content, /deb\.nodesource\.com/);
  assert.match(content, /rpm\.nodesource\.com/);

  // Must safely create group before user
  assert.match(content, /groupadd\s+-r\s+pecuser/);
  assert.match(content, /useradd\s+-r\s+-g\s+pecuser/);

  // Must NOT print raw ADMIN_TOKEN or SECURE_TOKEN to stdout via echo or printf
  assert.doesNotMatch(
    content,
    /(?:echo|printf)[^;\n]*\$(ADMIN_SEC_TOKEN|\{ADMIN_SEC_TOKEN\}|ADMIN_TOKEN|\{ADMIN_TOKEN\})/,
    "install-systemd.sh must not echo or printf raw admin tokens"
  );
  assert.doesNotMatch(
    content,
    /(?:echo|printf)[^;\n]*\$(SECURE_TOKEN|\{SECURE_TOKEN\}|EXT_SHARED_TOKEN|\{EXT_SHARED_TOKEN\})/,
    "install-systemd.sh must not echo or printf raw extension tokens"
  );

  // Must refer to /etc/pec-server/pec-server.env
  assert.match(content, /\/etc\/pec-server\/pec-server\.env/);
  assert.match(content, /0600/);

  // Systemd service heredoc hardening directives
  assert.match(content, /NoNewPrivileges=true/);
  assert.match(content, /ProtectSystem=full/);
  assert.match(content, /ProtectHome=true/);
  assert.match(content, /PrivateTmp=true/);
  assert.match(content, /ReadWritePaths=\$INSTALL_DIR\/data\s+\$INSTALL_DIR\/extension\s+\$INSTALL_DIR\/dist\/updates\s+\$INSTALL_DIR\/dist\/releases/);

  // Systemd unit metadata
  assert.match(content, /Documentation=https:\/\/github\.com\/corp\/pec-proxy-extension-corp/);
  assert.match(content, /User=pecuser/);
  assert.match(content, /Group=pecuser/);
  assert.match(content, /EnvironmentFile=\/etc\/pec-server\/pec-server\.env/);

  // Must avoid crash from missing 'which' command by using command -v npm
  assert.match(content, /command\s+-v\s+npm/);
  assert.doesNotMatch(content, /\$\(which\s+npm\)/, "Must not use bare $(which npm) inside heredoc");
});

test("deploy/pec-server.service: aligned with install-systemd hardening directives (H-8)", () => {
  const servicePath = path.resolve("deploy/pec-server.service");
  assert.strictEqual(fs.existsSync(servicePath), true, "deploy/pec-server.service must exist");
  const content = fs.readFileSync(servicePath, "utf-8");

  assert.match(content, /NoNewPrivileges=true/);
  assert.match(content, /ProtectSystem=full/);
  assert.match(content, /ProtectHome=true/);
  assert.match(content, /PrivateTmp=true/);
  assert.match(
    content,
    /ReadWritePaths=\/opt\/pec-proxy-server\/data\s+\/opt\/pec-proxy-server\/extension\s+\/opt\/pec-proxy-server\/dist\/updates\s+\/opt\/pec-proxy-server\/dist\/releases/
  );
  assert.match(content, /User=pecuser/);
  assert.match(content, /Group=pecuser/);
  assert.match(content, /EnvironmentFile=\/etc\/pec-server\/pec-server\.env/);
  assert.match(content, /Documentation=https:\/\/github\.com\/corp\/pec-proxy-extension-corp/);
});

test("deploy/install-standalone.sh: generates .env with openssl rand -hex 32, uses npm ci, binds 127.0.0.1 default (M-28)", () => {
  const scriptPath = path.resolve("deploy/install-standalone.sh");
  assert.strictEqual(fs.existsSync(scriptPath), true, "deploy/install-standalone.sh must exist");
  const content = fs.readFileSync(scriptPath, "utf-8");

  // Must use openssl rand -hex 32
  assert.match(content, /openssl\s+rand\s+-hex\s+32/);

  // Must set chmod 0600 on .env
  assert.match(content, /chmod\s+0600\s+\.env/);

  // Must use npm ci instead of npm install
  assert.match(content, /npm\s+ci/);
  assert.doesNotMatch(
    content,
    /^\s*npm\s+install\s*$/m,
    "install-standalone.sh must not use bare npm install"
  );

  // Must bind 127.0.0.1 by default
  assert.match(content, /HOST=\$\{HOST:-127\.0\.0\.1\}/);
});

test("deploy/nginx-proxy.conf: limits client_max_body_size to 1m on port 80 and 150m on port 443 (L-36)", () => {
  const confPath = path.resolve("deploy/nginx-proxy.conf");
  assert.strictEqual(fs.existsSync(confPath), true, "deploy/nginx-proxy.conf must exist");
  const content = fs.readFileSync(confPath, "utf-8");

  // Split into server blocks
  const serverBlocks = content.split(/server\s*\{/);
  const http80Block = serverBlocks.find((b) => b.includes("listen 80;") || b.includes("listen [::]:80;"));
  const https443Block = serverBlocks.find((b) => b.includes("listen 443"));

  assert.ok(http80Block, "Server block for port 80 must exist");
  assert.ok(https443Block, "Server block for port 443 must exist");

  // Port 80 must limit client_max_body_size to 1m
  assert.match(http80Block, /client_max_body_size\s+1[mM];/);
  assert.doesNotMatch(http80Block, /client_max_body_size\s+150[mM];/);

  // Port 443 must allow 150m
  assert.match(https443Block, /client_max_body_size\s+150[mM];/);
});
