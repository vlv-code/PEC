/**
 * Managed storage schema. Declares every key background.js actually reads -
 * previously `targetGroup` was read at runtime but never declared, so
 * group-based routing silently failed on GPO deployments.
 */
export const MANAGED_SCHEMA_TEMPLATE = `{
  "type": "object",
  "properties": {
    "extToken": {
      "type": "string",
      "description": "Shared corporate token for authentication on the mini-server (via X-Ext-Token header)."
    },
    "credsUrl": {
      "type": "string",
      "description": "Direct URL for /creds endpoint. Defaults to the build-configured server URL + /creds."
    },
    "syncUrl": {
      "type": "string",
      "description": "URL for /api/sync endpoint to receive dynamic proxy configuration and send heartbeat."
    },
    "autoConfigureProxy": {
      "type": "boolean",
      "description": "If true, extension manages chrome.proxy.settings dynamically according to the mini-server config."
    },
    "targetGroup": {
      "type": "string",
      "description": "Fleet group this device belongs to (used for group-scoped routing profiles)."
    }
  }
}
`;
