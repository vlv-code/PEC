import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
process.env.PEC_EXTENSION_DIR = path.join(tmp, "extension");
process.env.PEC_UPDATES_DIR = path.join(tmp, "updates");
process.env.EXT_SHARED_TOKEN = "test-admin-token";
process.env.ADMIN_TOKEN = "test-root-admin-token";

export const TEST_TMP_DIR = tmp;
export const TEST_TOKEN = process.env.EXT_SHARED_TOKEN;
export const TEST_ADMIN_TOKEN = process.env.ADMIN_TOKEN;
