// State Management for PEC Dashboard

export interface LiveSimState {
  online: boolean;
  bypassActive: boolean;
  protocol: string;
  host: string;
  port: number;
  profileName: string;
  appliedProfileId: string;
  exitIp: string;
  ipLocation: string;
  lastSyncTime: string;
  status: string;
}

export const state = {
  globalGpo: null as any,
  globalKillSwitch: false,
  allProfiles: [] as any[],
  currentProfile: null as any,
  extensionFiles: {} as Record<string, string>,
  currentLang: 'ru',
  currentProxiesList: [] as any[],
  isDashboardAuthenticated: false,
  hasUnsavedRouting: false,
  isAppStudioDirty: false,

  // Sequences to prevent race conditions (WEB-02)
  loadInstancesSeq: 0,
  loadDesktopInstancesSeq: 0,
  fetchStatusSeq: 0,
  loadReleasesSeq: 0,
  lastInstancesSuccessTime: 0,

  // Timers
  pecTimerInstances: null as any,
  pecTimerStatus: null as any,

  // Fleet & instances
  lastLoadedInstances: [] as any[],
  selectedFleetInstances: new Set<string>(),
  fleetSortCol: 'lastSync',
  fleetSortAsc: false,
  fleetListenersInitialized: false,
  lastFleetFetchTime: 0,

  // Panels & rotation
  current3xuiPanels: [] as any[],
  currentRotationConfig: null as any,
  currentReleasesData: null as any,

  // Constructor Studio & Live Simulator
  liveSimState: {
    online: true,
    bypassActive: false,
    protocol: 'socks5',
    host: 'xray-gateway.corp.local',
    port: 10808,
    profileName: 'Corporate AI + Intranet Policy',
    appliedProfileId: 'prof_default',
    exitIp: '198.51.100.42',
    ipLocation: 'Frankfurt, DE (Corp Direct Egress)',
    lastSyncTime: new Date().toLocaleTimeString(),
    status: 'Active'
  } as LiveSimState,

  builderDebounceTimer: null as any,
  codeEditorDebounceTimer: null as any,
  activeTemplatePreset: 'self-service-pro',
  activeStylePreset: 'cyber-blue',
  activeStudioLayout: 'console',
  activeStudioPalette: 'cyber',
  activeStudioThemeMode: 'dark',

  // App Studio (Desktop Client)
  currentAppStudioConfig: null as any,
  currentAppStudioPreset: 'cyber-blue',
  currentAppThemeMode: 'dark',
  currentAppStudioLayout: 'console',
  currentAppIconType: 'shield',
  currentAppCustomIconDataUrl: '',
  appStudioDebounceTimer: null as any,
  isAppPackaging: false,

  // Global Brand Icon
  currentGlobalBrandCustomDataUrl: '',
  isGlobalBrandCustomUploaded: false,
  globalBrandIconDebounceTimer: null as any,

  // Routing Rule Editing
  editingRuleIndex: -1,
  pendingDeleteRuleIndex: -1,

  // Upstream Proxies Editing
  editingProxyId: null as string | null
};

export function startDashboardTimers(fetchStatusFn: () => void, loadInstancesFn: () => void) {
  stopDashboardTimers();
  state.pecTimerInstances = setInterval(loadInstancesFn, 5000);
  state.pecTimerStatus = setInterval(fetchStatusFn, 10000);
  (window as any).__pecTimers = state.pecTimerInstances;
}

export function stopDashboardTimers() {
  if (state.pecTimerInstances) {
    clearInterval(state.pecTimerInstances);
    state.pecTimerInstances = null;
  }
  if (state.pecTimerStatus) {
    clearInterval(state.pecTimerStatus);
    state.pecTimerStatus = null;
  }
  if ((window as any).__pecTimers) {
    clearInterval((window as any).__pecTimers);
    (window as any).__pecTimers = null;
  }
}
