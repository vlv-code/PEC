import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { renderDashboardHtml, DashboardViewOptions } from "../../src/views/dashboardView.js";

export interface MockFetchCall {
  url: string;
  method: string;
  body?: any;
  headers?: any;
}

export interface SetupDashboardDomOptions {
  htmlOptions?: DashboardViewOptions;
  autoEval?: boolean;
  authenticated?: boolean;
  customResponses?: Record<string, any>;
}

export interface DashboardDomEnv {
  dom: JSDOM;
  window: any;
  document: Document;
  fetchCalls: MockFetchCall[];
  loggedErrors: any[][];
  loggedWarnings: any[][];
  setMockResponse: (endpoint: string, response: any) => void;
  evaluateDashboardJs: () => void;
  teardown: () => void;
}

const DASHBOARD_JS_PATH = path.resolve("public/dashboard.js");
let cachedDashboardJs: string | null = null;

function getDashboardJsCode(): string {
  if (!cachedDashboardJs) {
    cachedDashboardJs = fs.readFileSync(DASHBOARD_JS_PATH, "utf8");
  }
  return cachedDashboardJs;
}

/**
 * Sets up a minimal DOM environment using JSDOM for testing dashboard.js.
 * Provides realistic mocks for fetch endpoints and intercepts console errors
 * to catch ReferenceErrors, TypeErrors, and runtime regressions.
 */
export function setupDashboardDom(options: SetupDashboardDomOptions = {}): DashboardDomEnv {
  const {
    htmlOptions,
    autoEval = true,
    authenticated = false,
    customResponses = {},
  } = options;

  const html = renderDashboardHtml(htmlOptions);
  const dom = new JSDOM(html, {
    url: "http://localhost:3000/dashboard",
    runScripts: "dangerously",
  });

  const win = dom.window as any;
  const loggedErrors: any[][] = [];
  const loggedWarnings: any[][] = [];
  const fetchCalls: MockFetchCall[] = [];

  // Capture console errors & warnings
  win.console.error = (...args: any[]) => {
    loggedErrors.push(args);
  };
  win.console.warn = (...args: any[]) => {
    loggedWarnings.push(args);
  };

  win.addEventListener("error", (event: any) => {
    loggedErrors.push([event.error || event.message]);
  });

  const responses: Record<string, any> = {
    "/api/auth/status": { authenticated, setupRequired: false },
    "/api/proxies": [
      { id: "proxy-corp-1", name: "Corp Proxy 1", host: "10.0.0.1", port: 10808, protocol: "socks5", isActive: true },
      { id: "proxy-corp-2", name: "Corp Proxy 2", host: "10.0.0.2", port: 10809, protocol: "http", isActive: false },
    ],
    "/api/instances": {
      online: 1,
      instances: [
        {
          instanceId: "inst-test-01",
          username: "operator@corp.local",
          ip: "10.0.1.100",
          version: "1.0.0",
          group: "Default Group",
          appliedProfileName: "Default PAC",
          syncCount: 10,
          status: "ONLINE",
          tokenHash: "token-hash-01",
          assignedProxyId: "proxy-corp-1",
        },
      ],
    },
    "/api/app/instances": {
      online: 1,
      instances: [
        {
          appInstanceId: "app-test-01",
          hostname: "OPERATOR-PC",
          username: "operator",
          ip: "10.0.1.100",
          version: "2.1.0",
          status: "ONLINE",
          assignedProxyId: "proxy-corp-1",
          lastSync: new Date().toISOString(),
        },
      ],
    },
    "/api/routing/profiles": [
      { id: "prof-default", name: "Default PAC", defaultPolicy: "direct" },
    ],
    "/api/routing/presets": [],
    "/api/rotation/config": {
      config: {
        panelUrl: "https://panel.corp:2053",
        adminUser: "admin",
        inboundRemark: "pec-node",
        intervalMinutes: 1440,
        enabled: false,
      },
    },
    "/api/status": { active: true },
    "/api/config": {},
    "/api/builder/config": {},
    "/api/app-builder/config": {},
    "/api/builder/files": {},
    "/api/extension/info": { version: "1.0.0" },
    "/api/3xui/panels": [],
    "/api/releases": { currentVersion: "1.0.0", releases: [] },
    "/api/instances/assign-proxy": { ok: true },
    "/api/instances/assign-profile": { ok: true },
    ...customResponses,
  };

  win.fetch = async (input: string | URL, init?: any) => {
    const rawUrl = typeof input === "string" ? input : input.toString();
    const urlPath = rawUrl.split("?")[0].replace(/^https?:\/\/[^/]+/, "");
    fetchCalls.push({
      url: urlPath,
      method: init?.method || "GET",
      body: init?.body,
      headers: init?.headers,
    });

    const data = responses[urlPath] ?? { ok: true };
    const status = (responses[`${urlPath}:status`] as number) || 200;
    const ok = status >= 200 && status < 300;

    return {
      ok,
      status,
      statusText: ok ? "OK" : "Error",
      json: async () => (typeof data === "function" ? data(init) : data),
      text: async () =>
        typeof data === "string" ? data : JSON.stringify(typeof data === "function" ? data(init) : data),
      headers: new Map([["content-type", "application/json"]]),
    };
  };

  const evaluateDashboardJs = () => {
    const code = getDashboardJsCode();
    win.eval(code);
  };

  if (autoEval) {
    evaluateDashboardJs();
  }

  const teardown = () => {
    try {
      win.stopDashboardTimers?.();
    } catch {}
    dom.window.close();
  };

  return {
    dom,
    window: win,
    document: win.document,
    fetchCalls,
    loggedErrors,
    loggedWarnings,
    setMockResponse: (endpoint: string, response: any) => {
      responses[endpoint] = response;
    },
    evaluateDashboardJs,
    teardown,
  };
}
