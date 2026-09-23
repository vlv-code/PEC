export interface DashboardViewOptions {
  isDefaultTokenInUse: boolean;
  port: number;
}

export function renderDashboardHtml(options: DashboardViewOptions): string {
  const { isDefaultTokenInUse, port } = options;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Corp Proxy Fleet & Extension Studio</title>
  <meta name="description" content="Central manager for selective proxy routing, GeoBases, extension constructor studio, and 3x-ui rotating authentication." />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root, body[data-theme="cyber"] {
      --bg: #090e1a;
      --card-bg: #111a2e;
      --card-inner: #0b1120;
      --border: #1e2c4a;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --purple: #c084fc;
      --mono: 'JetBrains Mono', monospace;
      --sans: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
    }
    body[data-theme="obsidian"] {
      --bg: #0d1117;
      --card-bg: #161b22;
      --card-inner: #0b0f14;
      --border: #30363d;
      --text: #f0f6fc;
      --text-muted: #8b949e;
      --primary: #58a6ff;
      --primary-hover: #1f6feb;
      --success: #3fb950;
      --warning: #d29922;
      --danger: #f85149;
      --purple: #bc8cff;
    }
    body[data-theme="nord"] {
      --bg: #242933;
      --card-bg: #2e3440;
      --card-inner: #1e222a;
      --border: #434c5e;
      --text: #eceff4;
      --text-muted: #d8dee9;
      --primary: #88c0d0;
      --primary-hover: #81a1c1;
      --success: #a3be8c;
      --warning: #ebcb8b;
      --danger: #bf616a;
      --purple: #b48ead;
    }
    body[data-theme="emerald"] {
      --bg: #06130d;
      --card-bg: #0b1f16;
      --card-inner: #040b07;
      --border: #133a2a;
      --text: #ecfdf5;
      --text-muted: #6ee7b7;
      --primary: #10b981;
      --primary-hover: #059669;
      --success: #34d399;
      --warning: #fbbf24;
      --danger: #f87171;
      --purple: #c084fc;
    }
    body[data-theme="light"] {
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --card-inner: #f1f5f9;
      --border: #cbd5e1;
      --text: #0f172a;
      --text-muted: #64748b;
      --primary: #0284c7;
      --primary-hover: #0369a1;
      --success: #059669;
      --warning: #d97706;
      --danger: #dc2626;
      --purple: #7c3aed;
    }

    /* ==================== UI LAYOUT ARCHETYPES ==================== */
    /* 1. Compact Console (Ultra-minimalist, flat hairline borders, 4px corners, dense scanning across ALL tabs) */
    body[data-layout="console"] {
      padding: 12px;
      font-size: 13px;
    }
    body[data-layout="console"] .container {
      max-width: 1400px;
    }
    body[data-layout="console"] header {
      margin-bottom: 12px;
      padding-bottom: 10px;
    }
    body[data-layout="console"] header h1 {
      font-size: 18px !important;
      font-weight: 700;
    }
    body[data-layout="console"] .banner {
      padding: 6px 12px;
      font-size: 12px;
      margin-bottom: 12px;
      border-radius: 4px;
    }
    body[data-layout="console"] .card {
      padding: 12px 14px;
      border-radius: 4px;
      margin-bottom: 12px;
      box-shadow: none !important;
      border: 1px solid var(--border);
    }
    body[data-layout="console"] .card h2 {
      font-size: 13.5px;
      margin-bottom: 8px;
      padding-bottom: 5px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    body[data-layout="console"] .card > div[style*="background: var(--card-inner)"] {
      padding: 10px 12px !important;
      border-radius: 4px !important;
      margin-bottom: 10px !important;
      border: 1px solid var(--border) !important;
    }
    body[data-layout="console"] .tabs-nav {
      gap: 4px;
      margin-bottom: 12px;
      padding-bottom: 4px;
    }
    body[data-layout="console"] .tab-btn {
      padding: 5px 10px;
      font-size: 11.5px;
      border-radius: 4px;
      border: 1px solid transparent;
    }
    body[data-layout="console"] .tab-btn.active {
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--primary);
    }
    body[data-layout="console"] input[type="text"], 
    body[data-layout="console"] input[type="password"],
    body[data-layout="console"] select, 
    body[data-layout="console"] button,
    body[data-layout="console"] .btn,
    body[data-layout="console"] .btn-secondary,
    body[data-layout="console"] .btn-danger,
    body[data-layout="console"] .btn-success {
      padding: 4px 8px;
      font-size: 12px;
      border-radius: 4px;
      height: 32px;
    }
    body[data-layout="console"] textarea {
      border-radius: 4px;
      font-size: 11.5px;
    }
    body[data-layout="console"] th, body[data-layout="console"] td {
      padding: 5px 8px;
      font-size: 11.5px;
    }
    body[data-layout="console"] .table-container table {
      border: 1px solid var(--border);
    }
    body[data-layout="console"] pre {
      padding: 8px 10px;
      border-radius: 4px;
      font-size: 11px;
    }
    body[data-layout="console"] .preset-card {
      padding: 8px 10px;
      border-radius: 4px;
    }
    body[data-layout="console"] .preset-chip {
      padding: 4px 8px !important;
      border-radius: 4px !important;
      font-size: 11px !important;
    }
    body[data-layout="console"] .browser-mock {
      border-radius: 4px;
      box-shadow: none;
    }
    body[data-layout="console"] .popup-frame-box {
      border-radius: 4px;
      box-shadow: none;
    }
    body[data-layout="console"] .badge {
      border-radius: 3px;
      padding: 1px 6px;
      font-size: 10px;
    }
    body[data-layout="console"] .stat-row {
      padding: 5px 0;
      font-size: 12px;
    }
    body[data-layout="console"] .grid-2, body[data-layout="console"] .grid-3 {
      gap: 10px;
      margin-bottom: 12px;
    }
    body[data-layout="console"] label {
      font-size: 10.5px;
      letter-spacing: 0.2px;
      margin-bottom: 3px;
    }

    /* 2. Cyber Terminal (Monospace SecOps terminal, 0px sharp corners, glowing neon borders across ALL tabs) */
    body[data-layout="terminal"] {
      font-family: var(--mono) !important;
      letter-spacing: -0.2px;
      background-image: radial-gradient(rgba(56, 189, 248, 0.05) 1px, transparent 0);
      background-size: 24px 24px;
    }
    body[data-layout="terminal"] * {
      border-radius: 0px !important;
      font-family: var(--mono) !important;
    }
    body[data-layout="terminal"] .card {
      border: 1px solid var(--primary);
      box-shadow: 0 0 12px rgba(56, 189, 248, 0.12);
      background: rgba(10, 15, 28, 0.95);
    }
    body[data-layout="terminal"] .card h2::before {
      content: '> ';
      color: var(--primary);
    }
    body[data-layout="terminal"] .card > div[style*="background: var(--card-inner)"] {
      border: 1px solid rgba(56, 189, 248, 0.2) !important;
      background: #040812 !important;
      border-radius: 0px !important;
    }
    body[data-layout="terminal"] .tab-btn {
      font-size: 11px;
      border: 1px solid var(--border);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    body[data-layout="terminal"] .tab-btn.active {
      border-color: var(--primary);
      background: rgba(56, 189, 248, 0.18);
      color: var(--primary);
      box-shadow: 0 0 8px rgba(56, 189, 248, 0.2);
    }
    body[data-layout="terminal"] input, 
    body[data-layout="terminal"] select, 
    body[data-layout="terminal"] textarea {
      border: 1px solid var(--border);
      background: #040812;
      color: var(--text);
    }
    body[data-layout="terminal"] input:focus, 
    body[data-layout="terminal"] select:focus, 
    body[data-layout="terminal"] textarea:focus {
      border-color: var(--primary);
      box-shadow: 0 0 8px rgba(56, 189, 248, 0.3);
    }
    body[data-layout="terminal"] button,
    body[data-layout="terminal"] .btn {
      border: 1px solid var(--primary) !important;
      background: rgba(56, 189, 248, 0.05) !important;
      color: var(--primary) !important;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
    }
    body[data-layout="terminal"] button:hover,
    body[data-layout="terminal"] .btn:hover {
      background: var(--primary) !important;
      color: #030712 !important;
      box-shadow: 0 0 14px var(--primary);
    }
    body[data-layout="terminal"] button.btn-danger,
    body[data-layout="terminal"] .btn-danger {
      border-color: #ef4444 !important;
      color: #ef4444 !important;
      background: rgba(239, 68, 68, 0.05) !important;
    }
    body[data-layout="terminal"] button.btn-danger:hover,
    body[data-layout="terminal"] .btn-danger:hover {
      background: #ef4444 !important;
      color: #030712 !important;
      box-shadow: 0 0 14px #ef4444;
    }
    body[data-layout="terminal"] button.btn-secondary,
    body[data-layout="terminal"] .btn-secondary {
      border-color: rgba(255, 255, 255, 0.2) !important;
      color: var(--text) !important;
      background: transparent !important;
    }
    body[data-layout="terminal"] button.btn-secondary:hover,
    body[data-layout="terminal"] .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.15) !important;
      color: #fff !important;
    }
    body[data-layout="terminal"] button.btn-success,
    body[data-layout="terminal"] .btn-success {
      border-color: #10b981 !important;
      color: #10b981 !important;
      background: rgba(16, 185, 129, 0.05) !important;
    }
    body[data-layout="terminal"] button.btn-success:hover,
    body[data-layout="terminal"] .btn-success:hover {
      background: #10b981 !important;
      color: #030712 !important;
      box-shadow: 0 0 14px #10b981;
    }
    body[data-layout="terminal"] .badge {
      border: 1px solid currentColor;
      text-transform: uppercase;
      font-weight: 700;
    }
    body[data-layout="terminal"] .banner {
      border: 1px solid var(--border);
      border-left: 4px solid var(--primary);
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.08);
    }
    body[data-layout="terminal"] .preset-card {
      border: 1px solid var(--border);
      background: #060b16;
    }
    body[data-layout="terminal"] .preset-card:hover {
      border-color: var(--primary);
    }
    body[data-layout="terminal"] .preset-chip {
      border: 1px solid var(--border);
      background: #050a14;
      border-radius: 0px !important;
    }
    body[data-layout="terminal"] .preset-chip.active {
      border-color: var(--primary);
      background: rgba(56, 189, 248, 0.2);
      box-shadow: 0 0 8px rgba(56, 189, 248, 0.3);
    }
    body[data-layout="terminal"] .table-container table {
      border: 1px solid var(--border);
    }
    body[data-layout="terminal"] th {
      border-bottom: 2px solid var(--primary);
      color: var(--primary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    body[data-layout="terminal"] td {
      border-bottom: 1px dashed rgba(255, 255, 255, 0.1);
    }
    body[data-layout="terminal"] .browser-mock {
      border: 1px solid var(--primary);
      box-shadow: 0 0 20px rgba(56, 189, 248, 0.15);
    }
    body[data-layout="terminal"] pre {
      border: 1px solid rgba(56, 189, 248, 0.2);
      background: #03060d !important;
    }

    /* Compact Icon Buttons & Unfolding Customization Popover */
    .btn-icon {
      background: var(--card-inner);
      border: 1px solid var(--border);
      color: var(--text-muted);
      width: 30px;
      height: 30px;
      padding: 0;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s ease;
      line-height: 1;
    }
    .btn-icon:hover {
      background: rgba(255, 255, 255, 0.08);
      color: var(--primary);
      border-color: var(--primary);
    }
    .btn-icon.active {
      background: rgba(56, 189, 248, 0.12);
      color: var(--primary);
      border-color: var(--primary);
    }
    .customization-popover {
      position: absolute;
      right: 0;
      top: calc(100% + 6px);
      width: 250px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
      padding: 12px;
      z-index: 1000;
      transform-origin: top right;
      animation: popoverFadeIn 0.15s ease-out;
    }
    @keyframes popoverFadeIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
    .popover-layout-btn {
      background: var(--card-inner);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 8px;
      border-radius: 5px;
      cursor: pointer;
      text-align: center;
      transition: all 0.12s ease;
      font-size: 11px;
      font-weight: 600;
    }
    .popover-layout-btn:hover {
      border-color: var(--primary);
    }
    .popover-layout-btn.active {
      background: rgba(56, 189, 248, 0.15);
      border-color: var(--primary);
      color: var(--primary);
    }
    .popover-theme-dot {
      background: transparent;
      border: 2px solid transparent;
      padding: 2px;
      border-radius: 50%;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.12s ease;
    }
    .popover-theme-dot span {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      display: block;
    }
    .popover-theme-dot:hover {
      border-color: var(--border);
    }
    .popover-theme-dot.active {
      border-color: var(--primary);
    }

    /* Layout overrides for popover */
    body[data-layout="terminal"] .customization-popover {
      border-radius: 0px !important;
      font-family: var(--mono);
      border-color: var(--primary);
      box-shadow: 0 0 20px rgba(56, 189, 248, 0.2);
    }
    body[data-layout="terminal"] .popover-layout-btn,
    body[data-layout="terminal"] .btn-icon {
      border-radius: 0px !important;
      font-family: var(--mono);
    }
    body[data-layout="console"] .customization-popover,
    body[data-layout="console"] .popover-layout-btn,
    body[data-layout="console"] .btn-icon {
      border-radius: 4px;
    }

    /* Universal Modern Scrollbar (removes Windows retro scrollbar) */
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: var(--border);
      border-radius: 9999px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: var(--text-muted);
    }
    * {
      scrollbar-width: thin;
      scrollbar-color: var(--border) transparent;
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      line-height: 1.5;
      padding: 20px;
      min-height: 100vh;
      transition: background-color 0.2s ease, color 0.2s ease;
    }
    .container { max-width: 1280px; margin: 0 auto; }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 18px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
      gap: 12px;
    }
    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(16, 185, 129, 0.15);
      color: var(--success);
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .badge-status .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    /* Tabs - Responsive with no ugly scrollbars */
    .tabs-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
      overflow: visible;
    }
    .tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .tab-btn:hover { color: var(--text); background: rgba(255, 255, 255, 0.05); }
    .tab-btn.active {
      color: var(--primary);
      background: var(--card-bg);
      border-color: var(--border);
    }

    .tab-pane { display: none; }
    .tab-pane.active { display: block; }

    /* Layout & Cards */
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 20px;
      margin-bottom: 20px;
    }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .card h2 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--primary);
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 13px;
    }
    .stat-row:last-child { border-bottom: none; }
    .stat-label { color: var(--text-muted); }
    .stat-value { font-family: var(--mono); font-size: 13px; }

    code, pre {
      font-family: var(--mono);
      background: var(--card-inner);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
    }
    pre {
      padding: 12px;
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
      margin: 8px 0;
    }

    /* Form Controls */
    label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 5px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    input[type="text"], input[type="password"], input[type="number"], select, textarea {
      width: 100%;
      background: var(--card-inner);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 9px 12px;
      border-radius: 8px;
      font-family: var(--mono);
      font-size: 13px;
      margin-bottom: 14px;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--primary);
    }

    button, .btn {
      background: var(--primary);
      color: #090e1a;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
      text-decoration: none;
    }
    button:hover, .btn:hover { background: var(--primary-hover); color: white; }
    button.btn-secondary, .btn-secondary { background: #1e293b; color: var(--text); border: 1px solid var(--border); }
    button.btn-secondary:hover { background: #334155; }
    button.btn-danger, .btn-danger { background: #dc2626; color: white; }
    button.btn-danger:hover { background: #b91c1c; }
    button.btn-success, .btn-success { background: #10b981; color: #0b1120; }
    button.btn-success:hover { background: #059669; color: white; }

    /* Tables */
    .table-container { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 9px 12px; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--text-muted); font-weight: 600; font-size: 12px; }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      font-family: var(--mono);
    }
    .badge-online { background: rgba(16, 185, 129, 0.2); color: var(--success); }
    .badge-stale { background: rgba(245, 158, 11, 0.2); color: var(--warning); }
    .badge-offline { background: rgba(239, 68, 68, 0.2); color: var(--danger); }
    .badge-action-proxy { background: rgba(56, 189, 248, 0.2); color: var(--primary); }
    .badge-action-direct { background: rgba(16, 185, 129, 0.2); color: var(--success); }
    .badge-action-block { background: rgba(239, 68, 68, 0.2); color: var(--danger); }

    .banner {
      background: rgba(56, 189, 248, 0.08);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 10px;
      padding: 12px 18px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    .preset-card {
      background: var(--card-inner);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .preset-card h4 { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px; }
    .preset-card p { font-size: 11px; color: var(--text-muted); margin-bottom: 8px; }

    /* Chrome Mockup & Live Extension Sandbox */
    .browser-mock {
      background: #1e293b;
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45);
    }
    .browser-top {
      background: #0f172a;
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid var(--border);
    }
    .browser-dots { display: flex; gap: 6px; }
    .browser-dot { width: 10px; height: 10px; border-radius: 50%; }
    .dot-red { background: #ef4444; }
    .dot-yellow { background: #f59e0b; }
    .dot-green { background: #10b981; }
    .browser-address-bar {
      flex: 1;
      background: #1e293b;
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 11px;
      font-family: var(--mono);
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .browser-ext-icon {
      position: relative;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.1);
      transition: all 0.15s;
    }
    .browser-ext-icon:hover { background: rgba(255, 255, 255, 0.15); }
    .browser-ext-badge {
      position: absolute;
      bottom: -3px;
      right: -3px;
      background: #10b981;
      color: #0b1120;
      font-size: 8px;
      font-weight: 800;
      padding: 1px 3px;
      border-radius: 3px;
      line-height: 1;
      font-family: var(--mono);
    }
    .preview-canvas {
      background: radial-gradient(circle at 50% 20%, #1e293b, #090e1a);
      min-height: 530px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      position: relative;
    }
    .popup-frame-box {
      width: 350px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: #0b1120;
      overflow: hidden;
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.7);
      transition: all 0.2s ease;
    }
    .popup-frame-box iframe {
      width: 100%;
      height: 470px;
      border: none;
      display: block;
    }
    .preset-chip {
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid var(--border);
      background: var(--card-inner);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
      color: var(--text);
    }
    .preset-chip:hover { border-color: var(--primary); background: rgba(56, 189, 248, 0.1); }
    .preset-chip.active { border-color: var(--primary); background: rgba(56, 189, 248, 0.2); color: var(--primary); }
    .color-swatch {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      display: inline-block;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1 id="appTitle" style="font-size: 22px; font-weight: 700;" data-i18n="appTitle">PEC - Proxy Extension Corp</h1>
        <p id="appSubtitle" style="font-size: 14px; color: var(--text-muted);" data-i18n="appSubtitle">Enterprise Proxy Synchronization</p>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <!-- GitHub Version Release Badge -->
        <span id="versionReleaseBadge" class="badge badge-action-proxy" style="cursor: pointer; font-size: 11px; padding: 4px 8px;" onclick="toggleCustomizationPopover(event)" title="GitHub Releases & Version Control">v1.3.0</span>

        <!-- Server Customization Popover Trigger (Palette Icon) -->
        <div style="position: relative; display: inline-block;">
          <button type="button" id="btnCustomization" onclick="toggleCustomizationPopover(event)" class="btn-icon" data-i18n-title="btnCustomizationTitle" title="Кастомизация оформления">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
              <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
              <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
              <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
            </svg>
          </button>

          <!-- Compact Floating Customization Popover -->
          <div id="popoverCustomization" class="customization-popover" style="display: none;" onclick="event.stopPropagation()">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--border);">
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);" data-i18n="popoverTitle">Внешний вид</span>
              <button type="button" onclick="closeCustomizationPopover()" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; padding: 0 4px; line-height: 1;">&times;</button>
            </div>

            <!-- 1. Layout switcher (Compact Console & Cyber Terminal) -->
            <div style="margin-bottom: 10px;">
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;" data-i18n="lblSettingsLayout">Макет панели:</div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                <button type="button" id="optLayoutConsoleCard" class="popover-layout-btn" onclick="setServerLayout('console')">
                  <span style="font-size: 11px; font-weight: 600;">Console</span>
                </button>
                <button type="button" id="optLayoutTerminalCard" class="popover-layout-btn" onclick="setServerLayout('terminal')">
                  <span style="font-size: 11px; font-weight: 600;">Terminal</span>
                </button>
              </div>
            </div>

            <!-- 2. Color palettes -->
            <div>
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;" data-i18n="lblSettingsTheme">Цветовая гамма:</div>
              <div style="display: flex; gap: 6px; justify-content: space-between;">
                <button type="button" class="popover-theme-dot" id="btnThemeCyber" onclick="setServerTheme('cyber')" title="Cyber Blue">
                  <span style="background: #38bdf8;"></span>
                </button>
                <button type="button" class="popover-theme-dot" id="btnThemeObsidian" onclick="setServerTheme('obsidian')" title="Obsidian Minimal">
                  <span style="background: #c084fc;"></span>
                </button>
                <button type="button" class="popover-theme-dot" id="btnThemeNord" onclick="setServerTheme('nord')" title="Nordic Arctic">
                  <span style="background: #88c0d0;"></span>
                </button>
                <button type="button" class="popover-theme-dot" id="btnThemeEmerald" onclick="setServerTheme('emerald')" title="Emerald SecOps">
                  <span style="background: #34d399;"></span>
                </button>
                <button type="button" class="popover-theme-dot" id="btnThemeLight" onclick="setServerTheme('light')" title="Enterprise Light">
                  <span style="background: #2563eb; border: 1px solid #cbd5e1;"></span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Quick Language Switcher -->
        <div style="display: flex; align-items: center; background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; overflow: hidden;">
          <button type="button" id="btnLangEn" onclick="setLanguage('en')" style="background: transparent; border: none; padding: 5px 10px; font-size: 12px; font-weight: 700; color: var(--text-muted); cursor: pointer;">EN</button>
          <div style="width: 1px; height: 16px; background: var(--border);"></div>
          <button type="button" id="btnLangRu" onclick="setLanguage('ru')" style="background: var(--primary); border: none; padding: 5px 10px; font-size: 12px; font-weight: 700; color: #fff; cursor: pointer;">RU</button>
        </div>

        <span class="badge-status">
          <span class="dot"></span>
          <span id="lblGatewayStatus" data-i18n="statusGatewayActive">Шлюз активен</span>
        </span>
        
        <!-- Refresh All (Icon Only) -->
        <button id="btnRefreshAll" onclick="refreshAll()" class="btn-icon" data-i18n-title="btnRefreshAllTitle" title="Обновить всё">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
        </button>
      </div>
    </header>
    \${isDefaultTokenInUse ? \`
    <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid #ef4444; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 16px;">⚠️</span>
        <span style="font-size: 12px; color: #fca5a5;">
          <strong>Security Warning:</strong> The server is running with the default shared token (see <code>EXT_SHARED_TOKEN</code> in <code>.env.example</code>). Please set a unique, secure <strong>EXT_SHARED_TOKEN</strong> in your <strong>.env</strong> file.
        </span>
      </div>
      <span class="badge badge-action-block" style="font-size: 10px;">DEFAULT TOKEN IN USE</span>
    </div>
    \` : ""}

    <!-- Top quick overview banner -->
    <div class="banner">
      <div>
        <strong id="lblHdrFleet" data-i18n="lblHdrFleet">Подключенный флот:</strong> <span id="hdrFleetCount">0 активных</span> &bull; 
        <strong id="lblHdrUser" data-i18n="lblHdrUser">Текущий пользователь:</strong> <code id="hdrUser">corp-user</code> &bull; 
        <strong id="lblHdrProfile" data-i18n="lblHdrProfile">Активный PAC профиль:</strong> <span id="hdrActiveProfile" style="color: var(--primary);">Direct Default</span> &bull;
        <strong id="lblHdrRot" data-i18n="lblHdrRot">Следующая ротация:</strong> <span id="hdrNextRot">Расчет...</span>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button id="btnRotateNow" onclick="manualRotate()" style="font-size: 12px; padding: 6px 12px;" data-i18n="btnRotateNow">Ротировать пароль сейчас</button>
        <button id="btnKillSwitch" onclick="toggleKillSwitch()" class="btn-secondary" style="font-size: 12px; padding: 6px 12px;" data-i18n="btnKillSwitchOff">Kill-Switch: ВЫКЛ</button>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="tabs-nav">
      <button id="tabBtnRouting" class="tab-btn active" onclick="switchTab('routing')" data-i18n="tabBtnRouting">Routing & GeoBases</button>
      <button id="tabBtnBuilder" class="tab-btn" onclick="switchTab('builder')" data-i18n="tabBtnBuilder">Extension Constructor Studio</button>
      <button id="tabBtnFleet" class="tab-btn" onclick="switchTab('fleet')" data-i18n="tabBtnFleet">Fleet & Target Assignment</button>
      <button id="tabBtnGpo" class="tab-btn" onclick="switchTab('gpo')" data-i18n="tabBtnGpo">GPO Deployment</button>
      <button id="tabBtnRotation" class="tab-btn" onclick="switchTab('rotation')" data-i18n="tabBtnRotation">3x-ui API & Scheduler</button>
      <button id="tabBtnLogs" class="tab-btn" onclick="switchTab('logs')" data-i18n="tabBtnLogs">Audit & Tester</button>
    </div>

    <!-- ==================== TAB 1: ROUTING & GEOBASES ==================== -->
    <div id="tab-routing" class="tab-pane active">
      <div class="card">
        <h2>
          <span data-i18n="titleRoutingMatrix">Routing Profiles & Geo-Rules Matrix</span>
          <div style="display: flex; gap: 8px;">
            <select id="profileSelect" onchange="loadSelectedProfile()" style="margin-bottom: 0; font-size: 13px; width: auto;">
              <option value="">Loading profiles...</option>
            </select>
            <button onclick="createNewProfile()" class="btn-secondary" style="font-size: 12px;" data-i18n="btnNewProfile">+ New Profile</button>
          </div>
        </h2>

        <!-- Profile Metadata & Default Policy -->
        <div style="background: var(--card-inner); padding: 16px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 16px;">
          <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 14px; margin-bottom: 12px;">
            <div>
              <label data-i18n="lblProfName">Profile Name</label>
              <input type="text" id="profName" style="margin-bottom: 0;" />
            </div>
            <div>
              <label data-i18n="lblDefaultPolicy">Default Traffic Policy</label>
              <select id="profDefaultPolicy" style="margin-bottom: 0;">
                <option value="direct" data-i18n="optPolicyDirect">DIRECT by Default (Selective Proxy)</option>
                <option value="proxy" data-i18n="optPolicyProxy">PROXY by Default (Full Tunnel)</option>
              </select>
            </div>
            <div>
              <label data-i18n="lblTargetScope">Deployment Target Scope</label>
              <select id="profTargetScope" style="margin-bottom: 0;">
                <option value="all" data-i18n="optScopeAll">All Fleet (Global Default)</option>
                <option value="group" data-i18n="optScopeGroup">Target AD / Fleet Group</option>
                <option value="instances" data-i18n="optScopeInstances">Specific Selected Instances</option>
              </select>
            </div>
          </div>

          <div id="groupTargetRow" style="display: none; margin-bottom: 10px;">
            <label data-i18n="lblTargetGroup">Target Group Name</label>
            <input type="text" id="profTargetGroup" placeholder="e.g. SEC-Proxy-VPN-VIP or Dev-Team" data-i18n-ph="phTargetGroup" style="margin-bottom: 0;" />
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
            <p style="font-size: 12px; color: var(--text-muted);" id="profDesc" data-i18n="profDescDefault">
              Routing policy applied to matching browser instances.
            </p>
            <div style="display: flex; gap: 8px;">
              <button onclick="saveCurrentProfile()" data-i18n="btnSaveProfile">Save Routing Profile</button>
              <button onclick="deleteCurrentProfile()" class="btn-danger" style="font-size: 12px;" data-i18n="btnDeleteProfile">Delete Profile</button>
              <a id="btnPacPreview" href="/proxy.pac" target="_blank" class="btn-secondary" style="font-size: 12px;" data-i18n="btnPacPreview">View PAC Script</a>
            </div>
          </div>
        </div>

        <!-- Quick Add GeoBase Presets -->
        <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 10px; color: var(--text);" data-i18n="titleGeoPresets">
          Quick Add GeoBase & Domain Bundles
        </h3>
        <div class="grid-3" id="presetsContainer">
          <!-- Dynamically populated -->
        </div>

        <!-- Custom Rule Adder -->
        <div style="background: var(--card-inner); padding: 14px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 16px;">
          <h4 style="font-size: 13px; font-weight: 600; margin-bottom: 10px;" data-i18n="titleCustomRule">Add Custom Domain / Subnet Rule</h4>
          <div style="display: grid; grid-template-columns: 2fr 3fr 1fr auto; gap: 10px; align-items: flex-end;">
            <div>
              <label data-i18n="lblRuleName">Rule Name</label>
              <input type="text" id="newRuleName" placeholder="My Custom Rule" data-i18n-ph="phRuleName" style="margin-bottom: 0;" />
            </div>
            <div>
              <label data-i18n="lblRulePattern">Pattern (comma separated domains or CIDRs)</label>
              <input type="text" id="newRulePattern" placeholder="*.example.com, target-domain.org, 10.50.0.0/16" data-i18n-ph="phRulePattern" style="margin-bottom: 0;" />
            </div>
            <div>
              <label data-i18n="lblRuleAction">Action</label>
              <select id="newRuleAction" style="margin-bottom: 0;">
                <option value="proxy" data-i18n="optActionProxy">PROXY</option>
                <option value="direct" data-i18n="optActionDirect">DIRECT</option>
                <option value="block" data-i18n="optActionBlock">BLOCK (Sinkhole)</option>
              </select>
            </div>
            <div>
              <button onclick="addCustomRule()" style="height: 38px;" data-i18n="btnAddRule">+ Add Rule</button>
            </div>
          </div>
        </div>

        <!-- Active Rules Table -->
        <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 10px; color: var(--text);" data-i18n="titleActiveRules">
          Active Profile Rules Hierarchy (Evaluated Top-to-Bottom)
        </h3>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th data-i18n="thStatus">Status</th>
                <th data-i18n="thRuleName">Rule Name</th>
                <th data-i18n="thPattern">Pattern / Preset</th>
                <th data-i18n="thAction">Action</th>
                <th data-i18n="thActions">Actions</th>
              </tr>
            </thead>
            <tbody id="rulesTableBody">
              <tr><td colspan="5" style="text-align: center; color: var(--text-muted);" data-i18n="txtNoRules">No rules defined for this profile.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 2: EXTENSION CONSTRUCTOR STUDIO ==================== -->
    <div id="tab-builder" class="tab-pane">
      <div style="display: grid; grid-template-columns: 1.25fr 1fr; gap: 16px; margin-bottom: 16px;">
        
        <!-- Left Column: Visual, Preset & Feature Customizer -->
        <div class="card" style="margin-bottom: 0;">
          <h2>
            <span data-i18n="titleBuilder">Extension Constructor & Customizer</span>
            <span class="badge badge-action-proxy" id="bldPresetBadge">Self-Service Pro</span>
          </h2>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;" data-i18n="subBuilder">
            Configure functional archetypes, visual styles, security leak guards, and user capabilities:
          </p>

          <!-- 1. Archetype Presets -->
          <div style="background: var(--card-inner); padding: 12px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 14px;">
            <label style="margin-bottom: 8px;" data-i18n="lblArchetypePresets">1. Functional Archetype Presets</label>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button type="button" class="preset-chip active" id="chip-self-service" onclick="applyTemplatePreset('self-service-pro')">
                <span>👤</span>
                <span data-i18n="chipSelfService">Self-Service Pro</span>
              </button>
              <button type="button" class="preset-chip" id="chip-kiosk" onclick="applyTemplatePreset('kiosk-restricted')">
                <span>🔒</span>
                <span data-i18n="chipKiosk">Kiosk / Restricted</span>
              </button>
              <button type="button" class="preset-chip" id="chip-stealth" onclick="applyTemplatePreset('enterprise-invisible')">
                <span>👻</span>
                <span data-i18n="chipStealth">Stealth Agent</span>
              </button>
            </div>
            <p id="presetDescText" style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">
              Self-Service Pro: Interactive popup with connection details, routing overview, manual sync, and temporary user bypass.
            </p>
          </div>

          <!-- 2. Theme & Visual Style Presets -->
          <div style="background: var(--card-inner); padding: 12px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 14px;">
            <label style="margin-bottom: 8px;" data-i18n="lblThemePalettes">2. Theme & Color Palettes</label>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button type="button" class="preset-chip active" id="chip-style-cyber-blue" onclick="applyStylePreset('cyber-blue')">
                <span class="color-swatch" style="background: #0284c7;"></span>
                <span>Cyber Blue</span>
              </button>
              <button type="button" class="preset-chip" id="chip-style-dark-obsidian" onclick="applyStylePreset('dark-obsidian')">
                <span class="color-swatch" style="background: #a855f7;"></span>
                <span>Dark Obsidian</span>
              </button>
              <button type="button" class="preset-chip" id="chip-style-emerald-sentinel" onclick="applyStylePreset('emerald-sentinel')">
                <span class="color-swatch" style="background: #10b981;"></span>
                <span>Emerald Sentinel</span>
              </button>
              <button type="button" class="preset-chip" id="chip-style-sunset-amber" onclick="applyStylePreset('sunset-amber')">
                <span class="color-swatch" style="background: #f59e0b;"></span>
                <span>Sunset Amber</span>
              </button>
              <button type="button" class="preset-chip" id="chip-style-minimal-light" onclick="applyStylePreset('minimal-light')">
                <span class="color-swatch" style="background: #2563eb;"></span>
                <span>Minimal Light</span>
              </button>
            </div>
          </div>

          <!-- 3. Identity & Branding -->
          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 10px;">
            <div>
              <label data-i18n="lblExtName">Extension Name</label>
              <input type="text" id="bldName" oninput="onConfigChangeLive()" placeholder="Corp Proxy Auth & Sync" data-i18n-ph="phExtName" />
            </div>
            <div>
              <label data-i18n="lblShortName">Short Name</label>
              <input type="text" id="bldShortName" oninput="onConfigChangeLive()" placeholder="CorpProxy" data-i18n-ph="phShortName" />
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
            <div>
              <label data-i18n="lblVersion">Version</label>
              <input type="text" id="bldVersion" oninput="onConfigChangeLive()" placeholder="1.2.0" />
            </div>
            <div>
              <label data-i18n="lblUiMode">UI Mode</label>
              <select id="bldUiMode" onchange="onConfigChangeLive()">
                <option value="popup" data-i18n="optUiPopup">Interactive Popup UI</option>
                <option value="stealth" data-i18n="optUiStealth">Silent / Stealth Enterprise Worker</option>
              </select>
            </div>
            <div>
              <label data-i18n="lblIconType">Vector Icon Type</label>
              <select id="bldIconType" onchange="onConfigChangeLive()">
                <option value="shield">🛡️ Shield Security</option>
                <option value="lock">🔒 Lock Encrypted</option>
                <option value="globe">🌐 Global Network</option>
                <option value="bolt">⚡ Lightning Bolt</option>
                <option value="server">🖥️ Gateway Server</option>
                <option value="key">🔑 Auth Token Key</option>
              </select>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
            <div>
              <label data-i18n="lblBrandColor">Brand Theme Color</label>
              <input type="text" id="bldThemeColor" oninput="onConfigChangeLive()" placeholder="#0284c7" />
            </div>
            <div>
              <label data-i18n="lblIconEmoji">Icon Emoji</label>
              <input type="text" id="bldEmoji" oninput="onConfigChangeLive()" placeholder="🛡️" />
            </div>
            <div>
              <label data-i18n="lblSyncInterval">Sync Interval</label>
              <select id="bldSyncInterval" onchange="onConfigChangeLive()">
                <option value="5" data-i18n="optSync5">Every 5 minutes</option>
                <option value="15" selected data-i18n="optSync15">Every 15 minutes</option>
                <option value="30" data-i18n="optSync30">Every 30 minutes</option>
                <option value="60" data-i18n="optSync60">Every 1 hour</option>
              </select>
            </div>
          </div>

          <label data-i18n="lblExtDesc">Enterprise Description</label>
          <input type="text" id="bldDesc" oninput="onConfigChangeLive()" placeholder="Enterprise Chrome extension for automatic proxy synchronization" data-i18n-ph="phExtDesc" />

          <!-- 4. Security & User Feature Policies -->
          <div style="background: var(--card-inner); padding: 12px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 14px;">
            <label style="margin-bottom: 8px;" data-i18n="lblSecPolicies">Security & Leak Prevention Policies</label>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px;">
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldWebRtc" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span data-i18n="lblWebrtcShield">WebRTC IP Shield (no UDP leak)</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldDnsGuard" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span data-i18n="lblDnsGuard">DNS Leak Guard</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldBadge" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span data-i18n="lblBadgeIcon">Live Status Badge on Icon</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldAutoProxy" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span data-i18n="lblAutoProxy">Dynamic Proxy Enforcement</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldAllowBypass" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span data-i18n="lblAllowBypass">Allow Temporary User Bypass</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldIpGeo" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span data-i18n="lblIpGeo">Show Egress IP / Geo Verifier</span>
              </label>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 10px; margin-top: 10px;">
              <div>
                <label style="font-size: 11px;" data-i18n="lblBypassTimeout">Bypass Auto-Timeout</label>
                <select id="bldBypassTimeout" onchange="onConfigChangeLive()" style="margin-bottom: 0; font-size: 12px;">
                  <option value="10">10 minutes</option>
                  <option value="15" selected>15 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="60">60 minutes</option>
                </select>
              </div>
              <div>
                <label style="font-size: 11px;" data-i18n="lblSupportUrl">IT Helpdesk Contact</label>
                <input type="text" id="bldSupportUrl" oninput="onConfigChangeLive()" placeholder="mailto:it-support@corp.local" data-i18n-ph="phSupportUrl" style="margin-bottom: 0; font-size: 12px;" />
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <button onclick="buildAndPackExtension()" class="btn-success" data-i18n="btnBuildCrx">Compile, Sign & Pack CRX</button>
            <button onclick="saveBuilderConfigOnly(true)" class="btn-secondary" data-i18n="btnSaveConfig">Save Config Only</button>
            <button onclick="regenerateTemplatesFromConfig()" class="btn-secondary" style="margin-left: auto;" data-i18n="btnResetTemplate">Reset to Clean Template</button>
          </div>
        </div>

        <!-- Right Column: Live Interactive Chrome Extension Preview Sandbox -->
        <div class="card" style="margin-bottom: 0; display: flex; flex-direction: column;">
          <h2>
            <span data-i18n="titleLivePreview">Live Extension Interactive Preview</span>
            <span class="badge badge-online" id="previewSyncStatus" data-i18n="badgeSynced">Synced</span>
          </h2>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;" data-i18n="subLivePreview">
            Full runtime sandbox mirroring real Chrome popup, icons, badge states, and events in real time:
          </p>

          <!-- Browser Mockup Frame -->
          <div class="browser-mock">
            <div class="browser-top">
              <div class="browser-dots">
                <span class="browser-dot dot-red"></span>
                <span class="browser-dot dot-yellow"></span>
                <span class="browser-dot dot-green"></span>
              </div>
              <div class="browser-address-bar">
                <span>🔒</span>
                <span>https://company-intranet.corp/internal-app</span>
              </div>
              <!-- Chrome extension icon with live badge -->
              <div class="browser-ext-icon" id="browserExtIcon" onclick="togglePopupPreviewVisibility()" title="Click to inspect extension popup">
                <span id="browserIconGlyph">🛡️</span>
                <span class="browser-ext-badge" id="browserBadge">PRX</span>
              </div>
            </div>

            <!-- Preview Canvas -->
            <div class="preview-canvas">
              <!-- Popup Window Box -->
              <div class="popup-frame-box" id="popupFrameBox">
                <iframe id="previewFrame" style="width: 100%; height: 100%; border: none;"></iframe>
              </div>

              <!-- Stealth Mode Fallback Card -->
              <div id="stealthNotice" style="display: none; background: #0f172a; border: 1px solid var(--border); border-radius: 8px; padding: 24px; text-align: center; max-width: 320px;">
                <div style="font-size: 38px; margin-bottom: 10px;">👻</div>
                <h4 style="font-size: 15px; margin-bottom: 6px;" data-i18n="titleStealthNotice">Stealth Mode Enabled</h4>
                <p style="font-size: 12px; color: var(--text-muted); line-height: 1.5;" data-i18n="subStealthNotice">
                  The extension runs silently as an enterprise background service worker without a popup window. Traffic is routed dynamically via PAC policy.
                </p>
                <div style="margin-top: 14px;">
                  <span class="badge badge-action-proxy" data-i18n="badgeStealthActive">Icon Badge: Active</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Interactive Simulator Controls -->
          <div style="background: var(--card-inner); padding: 10px; border-radius: 8px; border: 1px solid var(--border); margin-top: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;" data-i18n="lblSimState">Simulated Extension State</span>
              <span id="simStateLabel" style="font-size: 11px; color: var(--success); font-weight: 600;">State: Online / Routing Active</span>
            </div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button type="button" class="btn-secondary" onclick="simulateState('active')" style="font-size: 11px; padding: 4px 8px;" data-i18n="btnSimOnline">Online Proxy</button>
              <button type="button" class="btn-secondary" onclick="simulateState('bypass')" style="font-size: 11px; padding: 4px 8px;" data-i18n="btnSimBypass">Bypassed</button>
              <button type="button" class="btn-secondary" onclick="simulateState('offline')" style="font-size: 11px; padding: 4px 8px;" data-i18n="btnSimOffline">Offline Fallback</button>
              <button type="button" class="btn-secondary" onclick="simulateState('error407')" style="font-size: 11px; padding: 4px 8px;" data-i18n="btnSimError">Re-Authenticating</button>
            </div>
          </div>

        </div>
      </div>

      <!-- Bottom Full-Width Section: Source Code Internals Editor -->
      <div class="card">
        <h2>
          <span data-i18n="titleCodeInternals">Extension Source Code Internals</span>
          <div style="display: flex; gap: 10px; align-items: center;">
            <span style="font-size: 12px; color: var(--text-muted);" data-i18n="lblActiveFile">Active File:</span>
            <select id="codeFileSelect" onchange="loadFileContent()" style="margin-bottom: 0; font-size: 12px; width: auto;">
              <option value="popup.html">popup.html (Popup Markup & CSS)</option>
              <option value="popup.js">popup.js (Popup Script & Events)</option>
              <option value="manifest.json">manifest.json (Permissions & Actions)</option>
              <option value="background.js">background.js (Proxy Service Worker)</option>
              <option value="icon.svg">icon.svg (Vector Icon)</option>
              <option value="managed_schema.json">managed_schema.json (GPO Policy Schema)</option>
            </select>
          </div>
        </h2>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 10px;" data-i18n="subCodeInternals">
          Live Code Editor: Edits in <code>popup.html</code> or <code>popup.js</code> update the Interactive Preview instantly.
        </p>

        <textarea id="codeEditor" oninput="onCodeEditorLiveChange()" style="width: 100%; height: 320px; font-family: var(--mono); font-size: 12px; margin-bottom: 10px; white-space: pre; line-height: 1.4;"></textarea>

        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <span id="codeStatus" style="font-size: 12px; color: var(--text-muted);" data-i18n="lblCodeReady">Ready</span>
          <div style="display: flex; gap: 8px;">
            <button onclick="saveCurrentCodeFile()" class="btn-secondary" style="font-size: 12px;" data-i18n="btnSaveCode">Save File Edits & Apply</button>
            <a href="/updates/extension.crx" class="btn" style="font-size: 12px;" data-i18n="btnDownloadCrx">Download .CRX</a>
            <a href="/api/extension/download-zip" class="btn-secondary" style="font-size: 12px;" data-i18n="btnDownloadZip">Download .ZIP</a>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 3: FLEET & TARGET ASSIGNMENT ==================== -->
    <div id="tab-fleet" class="tab-pane">
      <div class="card">
        <h2>
          <span data-i18n="titleFleetInstances">Connected Extension Instances</span>
          <span id="badgeFleetOnline" class="badge badge-online">0 online</span>
        </h2>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;" data-i18n="subFleetInstances">
          Assign specific profiles or groups to instances, or monitor live sync activity:
        </p>

        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th data-i18n="thInstId">Instance ID</th>
                <th data-i18n="thInstIp">IP Address</th>
                <th data-i18n="thInstVer">Version</th>
                <th data-i18n="thInstGroup">Fleet Group</th>
                <th data-i18n="thInstProfile">Assigned Profile</th>
                <th data-i18n="thInstSyncs">Syncs</th>
                <th data-i18n="thInstStatus">Status</th>
                <th data-i18n="thInstAssign">Assign</th>
              </tr>
            </thead>
            <tbody id="fleetTableBody">
              <tr><td colspan="8" style="text-align: center; color: var(--text-muted);" data-i18n="txtNoFleet">No active instances connected yet.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 4: GPO DEPLOYMENT ==================== -->
    <div id="tab-gpo" class="tab-pane">
      <div class="grid-2">
        <div class="card">
          <h2 data-i18n="titleExtPackageInfo">Extension Identifiers & Package Info</h2>
          <div class="stat-row">
            <span class="stat-label" data-i18n="lblCalcExtId">Calculated Extension ID</span>
            <span class="stat-value" id="dispExtId" style="color: var(--primary);">Loading...</span>
          </div>
          <div class="stat-row">
            <span class="stat-label" data-i18n="lblManifestVer">Manifest Version</span>
            <span class="stat-value" id="dispExtVer">1.2.0</span>
          </div>
          <div class="stat-row">
            <span class="stat-label" data-i18n="lblRsaKey">RSA Private Key</span>
            <span class="stat-value" style="color: var(--success);">2048-bit RSA (extension/key.pem)</span>
          </div>
          <div class="stat-row">
            <span class="stat-label" data-i18n="lblUpdateManifest">Auto-Update Manifest</span>
            <span class="stat-value"><a href="/updates/updates.xml" target="_blank" style="color: var(--primary);">/updates/updates.xml</a></span>
          </div>
          <div style="margin-top: 16px;">
            <a href="/updates/extension.crx" class="btn" style="font-size: 13px;" data-i18n="btnDownloadCrxPkg">Download .CRX Package</a>
            <a href="/api/extension/download-zip" class="btn-secondary" style="font-size: 13px; margin-left: 8px;" data-i18n="btnDownloadZipPkg">Download .ZIP</a>
          </div>
        </div>

        <div class="card">
          <h2 data-i18n="titleAdGpoSettings">Active Directory GPO Settings</h2>
          <label data-i18n="lblGpoForcelist">1. ExtensionInstallForcelist Entry</label>
          <pre id="gpoForcelist">Loading...</pre>

          <label style="margin-top: 10px;" data-i18n="lblGpoSettings">2. ExtensionSettings (JSON)</label>
          <pre id="gpoSettings" style="max-height: 140px;">Loading...</pre>

          <div style="margin-top: 10px;">
            <button onclick="downloadRegFile()" class="btn-secondary" style="font-size: 12px;" data-i18n="btnDownloadReg">Download Windows .REG Policy File</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 5: 3X-UI ROTATION ==================== -->
    <div id="tab-rotation" class="tab-pane">
      <div class="grid-2">
        <div class="card">
          <h2 data-i18n="title3xuiCreds">3x-ui API Credentials & Timing Scheduler</h2>
          <label data-i18n="lbl3xuiPanelUrl">3x-ui Panel URL</label>
          <input type="text" id="rotPanelUrl" placeholder="https://3xui-host:2053/basepath" data-i18n-ph="phRotPanelUrl" />

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label data-i18n="lblAdminUser">Admin Username</label>
              <input type="text" id="rotAdminUser" placeholder="admin" data-i18n-ph="phRotAdminUser" />
            </div>
            <div>
              <label data-i18n="lblAdminPass">Admin Password</label>
              <input type="password" id="rotAdminPass" placeholder="••••••••" />
            </div>
          </div>

          <label data-i18n="lblInboundRemark">Target Inbound Remark</label>
          <input type="text" id="rotRemark" placeholder="squid-in" data-i18n-ph="phRotRemark" />

          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 10px;">
            <div>
              <label data-i18n="lblRotInterval">Rotation Interval</label>
              <select id="rotInterval">
                <option value="15" data-i18n="optRot15">Every 15 minutes</option>
                <option value="60" data-i18n="optRot60">Every 1 hour</option>
                <option value="360" data-i18n="optRot360">Every 6 hours</option>
                <option value="720" data-i18n="optRot720">Every 12 hours</option>
                <option value="1440" selected data-i18n="optRot1440">Every 24 hours (Daily)</option>
              </select>
            </div>
            <div>
              <label data-i18n="lblScheduler">Scheduler</label>
              <select id="rotEnabled">
                <option value="true" data-i18n="optSchedEnabled">Enabled (Auto)</option>
                <option value="false" data-i18n="optSchedDisabled">Disabled</option>
              </select>
            </div>
          </div>

          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <button onclick="saveRotationConfig()" data-i18n="btnSaveScheduler">Save Scheduler Settings</button>
            <button onclick="test3xui()" class="btn-secondary" data-i18n="btnTest3xui">Test 3x-ui Connection</button>
          </div>
          <div id="test3xuiResult" style="margin-top: 10px; font-size: 12px; font-family: var(--mono); color: var(--text-muted);"></div>
        </div>

        <div class="card">
          <h2 data-i18n="titleRotStatus">Rotation Status & History</h2>
          <div class="stat-row">
            <span class="stat-label" data-i18n="lblSchedStatus">Scheduler Status</span>
            <span class="stat-value" id="rotStatusText">Idle</span>
          </div>
          <div class="stat-row">
            <span class="stat-label" data-i18n="lblNextRun">Next Scheduled Run</span>
            <span class="stat-value" id="rotNextRun">-</span>
          </div>
          <div class="stat-row">
            <span class="stat-label" data-i18n="lblLastRot">Last Rotated At</span>
            <span class="stat-value" id="rotLastRun">-</span>
          </div>

          <div style="margin-top: 16px;">
            <label data-i18n="lblRecentRot">Recent Password Rotations</label>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th data-i18n="thRotTime">Time</th>
                    <th data-i18n="thRotSource">Source</th>
                    <th data-i18n="thRotUser">User</th>
                    <th data-i18n="thRotResult">Result</th>
                  </tr>
                </thead>
                <tbody id="rotHistoryTable">
                  <tr><td colspan="4" style="color: var(--text-muted); text-align: center;" data-i18n="txtNoRotEvents">No rotation events yet</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 6: AUDIT & TESTER ==================== -->
    <div id="tab-logs" class="tab-pane">
      <div class="grid-2">
        <div class="card">
          <h2 data-i18n="titleCredsTester">Interactive /creds Tester</h2>
          <label data-i18n="lblTestToken">X-Ext-Token Header Value</label>
          <input type="password" id="testTokenInput" value="" placeholder="paste token to test" autocomplete="off" />
          <div style="display: flex; gap: 8px; margin-bottom: 12px;">
            <button onclick="testCredsEndpoint()" data-i18n="btnSendCreds">Send GET /creds</button>
            <button class="btn-secondary" onclick="document.getElementById('testTokenInput').value = 'wrong-token'; testCredsEndpoint();" data-i18n="btnTestInvalidToken">Test Invalid Token</button>
          </div>
          <pre id="testCredsOutput" style="min-height: 100px;">// Click to test /creds</pre>
        </div>

        <div class="card">
          <h2 data-i18n="titleSyncTester">Interactive /api/sync Tester</h2>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 10px;" data-i18n="subSyncTester">
            Simulate a Chrome extension heartbeat sync:
          </p>
          <button onclick="testSyncEndpoint()" data-i18n="btnSendSync">Send POST /api/sync</button>
          <pre id="testSyncOutput" style="min-height: 100px; margin-top: 12px;">// Click to test sync</pre>
        </div>
      </div>

      <div class="card">
        <h2 data-i18n="titleAuditLogs">Access & Security Audit Logs</h2>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th data-i18n="thLogTime">Timestamp</th>
                <th data-i18n="thLogIp">IP Address</th>
                <th data-i18n="thLogEndpoint">Endpoint</th>
                <th data-i18n="thLogStatus">Status</th>
                <th data-i18n="thLogResult">Result</th>
                <th data-i18n="thLogDetails">Details</th>
              </tr>
            </thead>
            <tbody id="auditTableBody">
              <tr><td colspan="6" style="text-align: center; color: var(--text-muted);" data-i18n="txtLoadingLogs">Loading logs...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

  </div>

  <div id="loginModal" style="display: none; position: fixed; inset: 0; z-index: 9999; background: rgba(3, 7, 18, 0.94); align-items: center; justify-content: center;">
    <div style="max-width: 420px; width: 90%; background: #131d36; border: 1px solid #22345c; border-radius: 12px; padding: 28px; text-align: center;">
      <div style="font-size: 28px; margin-bottom: 8px;">🔐</div>
      <h2 style="margin: 0 0 8px 0; font-size: 18px;">Authentication Required</h2>
      <p style="color: #94a3b8; font-size: 12.5px; margin: 0 0 16px 0;">Введите административный токен (EXT_SHARED_TOKEN) для доступа к консоли управления PEC.</p>
      <input type="password" id="loginTokenInput" placeholder="EXT_SHARED_TOKEN" autocomplete="off" style="width: 100%; box-sizing: border-box; margin-bottom: 14px;" />
      <button id="loginSubmitBtn" style="width: 100%;">Войти</button>
    </div>
  </div>

  <script>
    window.addEventListener('unhandledrejection', function(event) {
      if (event.reason && (event.reason.name === 'TypeError' || String(event.reason).includes('fetch') || String(event.reason).includes('Failed to fetch'))) {
        console.warn('Network request error safely handled:', event.reason);
        event.preventDefault();
      }
    });

    let globalGpo = null;
    let globalKillSwitch = false;
    let allProfiles = [];
    let currentProfile = null;
    let extensionFiles = {};

    // ----------------- Admin Authentication -----------------
    // The dashboard ships without any embedded token. The operator enters the
    // shared admin token once; it is kept in sessionStorage and attached to
    // every management API call via adminFetch().
    const ADMIN_TOKEN_KEY = 'pec_admin_token';
    function getAdminToken() {
      try { return sessionStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch (e) { return ''; }
    }
    function setAdminToken(t) {
      try { if (t) { sessionStorage.setItem(ADMIN_TOKEN_KEY, t); } else { sessionStorage.removeItem(ADMIN_TOKEN_KEY); } } catch (e) {}
    }
    function showLoginModal() {
      const m = document.getElementById('loginModal');
      if (m) m.style.display = 'flex';
      const i = document.getElementById('loginTokenInput');
      if (i) i.focus();
    }
    function hideLoginModal() {
      const m = document.getElementById('loginModal');
      if (m) m.style.display = 'none';
    }
    let loginPendingRetry = null;
    async function adminFetch(url, opts) {
      opts = opts || {};
      const token = getAdminToken();
      if (token) {
        opts.headers = Object.assign({}, opts.headers || {}, { 'X-Ext-Token': token });
      }
      const res = await fetch(url, opts);
      if (res.status === 401) {
        setAdminToken('');
        loginPendingRetry = { url: url, opts: opts };
        showLoginModal();
      }
      return res;
    }
    function handleLoginSubmit() {
      const input = document.getElementById('loginTokenInput');
      const v = ((input && input.value) || '').trim();
      if (!v) { if (input) input.focus(); return; }
      setAdminToken(v);
      const ti = document.getElementById('testTokenInput');
      if (ti && !ti.value) ti.value = v;
      hideLoginModal();
      if (loginPendingRetry) {
        const r = loginPendingRetry;
        loginPendingRetry = null;
        adminFetch(r.url, r.opts).catch(function (e) { console.warn('Retry after login failed:', e); });
      } else {
        bootDashboard();
      }
    }
    function bootDashboard() {
      if (window.__pecBooted) return;
      window.__pecBooted = true;
      refreshAll();
      setInterval(fetchFleet, 5000);
      setInterval(fetchStatus, 10000);
    }

    // ----------------- Layout & Theme Switchers -----------------
    function setServerLayout(layout) {
      if (layout !== 'terminal' && layout !== 'console') {
        layout = 'console';
      }
      document.body.setAttribute('data-layout', layout);
      try { localStorage.setItem('pec_server_layout', layout); } catch(e){}
      updateModalActiveState();
    }

    function setServerTheme(theme) {
      if (!theme) theme = 'cyber';
      document.body.setAttribute('data-theme', theme);
      try { localStorage.setItem('pec_server_theme', theme); } catch(e){}
      updateModalActiveState();
    }

    function toggleCustomizationPopover(e) {
      if (e && e.stopPropagation) e.stopPropagation();
      const popover = document.getElementById('popoverCustomization');
      const btn = document.getElementById('btnCustomization');
      if (!popover) return;
      const isOpen = popover.style.display !== 'none';
      if (isOpen) {
        closeCustomizationPopover();
      } else {
        popover.style.display = 'block';
        if (btn) btn.classList.add('active');
        updateModalActiveState();
      }
    }

    function closeCustomizationPopover() {
      const popover = document.getElementById('popoverCustomization');
      const btn = document.getElementById('btnCustomization');
      if (popover) popover.style.display = 'none';
      if (btn) btn.classList.remove('active');
    }

    function openCustomizationModal() { toggleCustomizationPopover(); }
    function closeCustomizationModal() { closeCustomizationPopover(); }

    document.addEventListener('click', function(e) {
      const popover = document.getElementById('popoverCustomization');
      const btn = document.getElementById('btnCustomization');
      if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && (!btn || !btn.contains(e.target))) {
          closeCustomizationPopover();
        }
      }
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeCustomizationPopover();
      }
    });

    function updateModalActiveState() {
      const currentLayout = document.body.getAttribute('data-layout') || 'console';
      const currentTheme = document.body.getAttribute('data-theme') || 'cyber';
      
      const consoleCard = document.getElementById('optLayoutConsoleCard');
      const terminalCard = document.getElementById('optLayoutTerminalCard');

      if (consoleCard && terminalCard) {
        if (currentLayout === 'console') {
          consoleCard.classList.add('active');
          terminalCard.classList.remove('active');
        } else {
          terminalCard.classList.add('active');
          consoleCard.classList.remove('active');
        }
      }

      const themeBtns = {
        cyber: document.getElementById('btnThemeCyber'),
        obsidian: document.getElementById('btnThemeObsidian'),
        nord: document.getElementById('btnThemeNord'),
        emerald: document.getElementById('btnThemeEmerald'),
        light: document.getElementById('btnThemeLight'),
      };
      Object.keys(themeBtns).forEach(k => {
        const btn = themeBtns[k];
        if (btn) {
          if (k === currentTheme) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      });
    }

    // ----------------- GitHub Releases & Version Control -----------------
    let cachedReleases = null;
    async function checkGitHubReleases(forceRefresh = false) {
      const container = document.getElementById('ghReleaseContent');
      const badge = document.getElementById('versionReleaseBadge');
      if (!container) return;

      if (!forceRefresh && cachedReleases) {
        renderGitHubReleases(cachedReleases);
        return;
      }

      container.innerHTML = \`<span style="color: var(--text-muted);">\${currentLang === 'ru' ? 'Запрос к GitHub Releases API...' : 'Fetching GitHub Releases API...'}</span>\`;

      try {
        const res = await adminFetch('/api/github/releases');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        cachedReleases = data;
        renderGitHubReleases(data);
        if (badge && data.currentVersion) {
          badge.textContent = 'v' + data.currentVersion;
          if (data.updateAvailable) {
            badge.className = 'badge badge-action-direct';
            badge.title = (currentLang === 'ru' ? 'Доступна новая версия: v' : 'New version available: v') + data.latestRelease.version;
          } else {
            badge.className = 'badge badge-online';
            badge.title = currentLang === 'ru' ? 'Актуальная версия' : 'Latest version installed';
          }
        }
      } catch (err) {
        container.innerHTML = \`<div style="color: var(--danger); font-size: 11.5px;">\${currentLang === 'ru' ? 'Не удалось загрузить данные релизов GitHub (автономный режим).' : 'Unable to query GitHub releases (offline mode).'}<br><code style="color: var(--text-muted); font-size: 11px;">\${err.message}</code></div>\`;
      }
    }

    function renderGitHubReleases(data) {
      const container = document.getElementById('ghReleaseContent');
      if (!container || !data) return;

      const isRu = currentLang === 'ru';
      let html = \`<div style="display: flex; gap: 16px; align-items: center; margin-bottom: 8px; flex-wrap: wrap;">
        <div>
          <span style="color: var(--text-muted); font-size: 11px;">\${isRu ? 'Установленная версия:' : 'Installed version:'}</span>
          <strong style="color: var(--primary); font-family: var(--mono); font-size: 13px; margin-left: 6px;">v\${data.currentVersion || '1.3.0'}</strong>
        </div>\`;

      if (data.latestRelease) {
        html += \`<div>
          <span style="color: var(--text-muted); font-size: 11px;">\${isRu ? 'Последний релиз:' : 'Latest release:'}</span>
          <strong style="color: \${data.updateAvailable ? 'var(--warning)' : 'var(--success)'}; font-family: var(--mono); font-size: 13px; margin-left: 6px;">\${data.latestRelease.name || ('v' + data.latestRelease.version)}</strong>
        </div>\`;
      }

      if (data.updateAvailable) {
        html += \`<span class="badge badge-action-direct">\${isRu ? 'Доступно обновление' : 'Update Available'}</span>\`;
      } else if (data.latestRelease) {
        html += \`<span class="badge badge-online">\${isRu ? 'Актуальная версия' : 'Up to date'}</span>\`;
      }

      html += \`</div>\`;

      if (data.releases && data.releases.length > 0) {
        html += \`<div style="max-height: 140px; overflow-y: auto; background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px;">\`;
        html += data.releases.slice(0, 5).map(r => \`
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 11.5px;">
            <div>
              <a href="\${r.htmlUrl}" target="_blank" style="color: var(--primary); font-weight: 600; text-decoration: none;">\${r.name || r.tag}</a>
              <span style="color: var(--text-muted); font-size: 10px; margin-left: 6px;">\${r.publishedAt ? new Date(r.publishedAt).toLocaleDateString() : ''}</span>
            </div>
            <a href="\${r.htmlUrl}" target="_blank" class="btn-secondary" style="font-size: 10px; padding: 2px 6px;">GitHub</a>
          </div>
        \`).join('');
        html += \`</div>\`;
      } else {
        html += \`<div style="color: var(--text-muted); font-size: 11.5px;">\${isRu ? 'Релизы в репозитории пока не опубликованы.' : 'No published releases in repository yet.'}</div>\`;
      }

      container.innerHTML = html;
    }

    // ----------------- Comprehensive Language Switcher (EN / RU) -----------------
    const I18N = {
      en: {
        appTitle: 'PEC - Proxy Extension Corp',
        appSubtitle: 'Enterprise Proxy Synchronization',
        statusGatewayActive: 'Gateway Active',
        lblGatewayStatus: 'Gateway Active',
        btnRefreshAllTitle: 'Refresh All',
        btnCustomizationTitle: 'Appearance & Themes',
        popoverTitle: 'Appearance',
        lblHdrFleet: 'Connected Fleet:',
        lblHdrUser: 'Current User:',
        lblHdrProfile: 'Active PAC Profile:',
        lblHdrRot: 'Next Rotation:',
        btnRotateNow: 'Rotate Password Now',
        btnKillSwitchOff: 'Kill-Switch: OFF',
        btnKillSwitchOn: 'Kill-Switch: ON (Active)',
        tabBtnRouting: 'Routing & GeoBases',
        tabBtnBuilder: 'Extension Constructor Studio',
        tabBtnFleet: 'Fleet & Target Assignment',
        tabBtnGpo: 'GPO Deployment',
        tabBtnRotation: '3x-ui API & Scheduler',
        tabBtnLogs: 'Audit & Tester',
        activeFleetSuffix: ' active',

        // Modal
        modalSettingsTitle: 'Server Customization & GitHub Releases',
        lblSettingsLayout: '1. Dashboard Layout Style',
        subSettingsLayout: 'Choose the structural layout archetype for all dashboard tabs:',
        optLayoutConsole: '🖥️ Compact Console',
        descLayoutConsole: 'Ultra-minimalist compact layout with flat borders, 4px corners, and maximum information density across all tabs.',
        optLayoutTerminal: '⚡ Cyber Terminal',
        descLayoutTerminal: 'Monospace SecOps cyber-terminal with sharp 0px corners, neon highlights, and glowing cards.',
        badgeSelected: 'Active',
        lblSettingsTheme: '2. Color Palette Scheme',
        subSettingsTheme: 'All color themes are preserved and automatically adapt to the chosen layout:',
        lblSettingsLang: '3. Dashboard Language',
        titleGhVersionControl: 'GitHub Releases & Version Control',
        subGhVersionControl: 'Live sync with GitHub repository to view installed version, release notes, and updates:',
        btnCheckGhReleases: 'Check for Updates',
        txtGhChecking: 'Checking GitHub releases...',
        btnCloseModal: 'Close',

        // Tab 1: Routing & GeoBases
        titleRoutingMatrix: 'Routing Profiles & Geo-Rules Matrix',
        btnNewProfile: '+ New Profile',
        lblProfName: 'Profile Name',
        lblDefaultPolicy: 'Default Traffic Policy',
        optPolicyDirect: 'DIRECT by Default (Selective Proxy)',
        optPolicyProxy: 'PROXY by Default (Full Tunnel)',
        lblTargetScope: 'Deployment Target Scope',
        optScopeAll: 'All Fleet (Global Default)',
        optScopeGroup: 'Target AD / Fleet Group',
        optScopeInstances: 'Specific Selected Instances',
        lblTargetGroup: 'Target Group Name',
        phTargetGroup: 'e.g. SEC-Proxy-VPN-VIP or Dev-Team',
        profDescDefault: 'Routing policy applied to matching browser instances.',
        btnSaveProfile: 'Save Routing Profile',
        btnDeleteProfile: 'Delete Profile',
        btnPacPreview: 'View PAC Script',
        titleGeoPresets: 'Quick Add GeoBase & Domain Bundles',
        titleCustomRule: 'Add Custom Domain / Subnet Rule',
        lblRuleName: 'Rule Name',
        phRuleName: 'My Custom Rule',
        lblRulePattern: 'Pattern (comma separated domains or CIDRs)',
        phRulePattern: '*.example.com, target-domain.org, 10.50.0.0/16',
        lblRuleAction: 'Action',
        optActionProxy: 'PROXY',
        optActionDirect: 'DIRECT',
        optActionBlock: 'BLOCK (Sinkhole)',
        btnAddRule: '+ Add Rule',
        titleActiveRules: 'Active Profile Rules Hierarchy (Evaluated Top-to-Bottom)',
        thStatus: 'Status',
        thRuleName: 'Rule Name',
        thPattern: 'Pattern / Preset',
        thAction: 'Action',
        thActions: 'Actions',
        txtNoRules: 'No rules defined for this profile.',

        // Tab 2: Extension Constructor Studio
        titleBuilder: 'Extension Constructor & Customizer',
        subBuilder: 'Configure functional archetypes, visual styles, security leak guards, and user capabilities:',
        lblArchetypePresets: '1. Functional Archetype Presets',
        chipSelfService: 'Self-Service Pro',
        chipKiosk: 'Kiosk / Restricted',
        chipStealth: 'Stealth Agent',
        lblThemePalettes: '2. Theme & Color Palettes',
        lblExtName: 'Extension Name',
        phExtName: 'Corp Proxy Auth & Sync',
        lblShortName: 'Short Name',
        phShortName: 'CorpProxy',
        lblVersion: 'Version',
        lblUiMode: 'UI Mode',
        optUiPopup: 'Interactive Popup UI',
        optUiStealth: 'Silent / Stealth Enterprise Worker',
        lblIconType: 'Vector Icon Type',
        lblBrandColor: 'Brand Theme Color',
        lblIconEmoji: 'Icon Emoji',
        lblSyncInterval: 'Sync Interval',
        optSync5: 'Every 5 minutes',
        optSync15: 'Every 15 minutes',
        optSync30: 'Every 30 minutes',
        optSync60: 'Every 1 hour',
        lblExtDesc: 'Enterprise Description',
        phExtDesc: 'Enterprise Chrome extension for automatic proxy synchronization',
        lblSecPolicies: 'Security & Leak Prevention Policies',
        lblWebrtcShield: 'WebRTC IP Shield (no UDP leak)',
        lblDnsGuard: 'DNS Leak Guard',
        lblBadgeIcon: 'Live Status Badge on Icon',
        lblAutoProxy: 'Dynamic Proxy Enforcement',
        lblAllowBypass: 'Allow Temporary User Bypass',
        lblIpGeo: 'Show Egress IP / Geo Verifier',
        lblBypassTimeout: 'Bypass Auto-Timeout',
        lblSupportUrl: 'IT Helpdesk Contact',
        phSupportUrl: 'mailto:it-support@corp.local',
        btnBuildCrx: 'Compile, Sign & Pack CRX',
        btnSaveConfig: 'Save Config Only',
        btnResetTemplate: 'Reset to Clean Template',
        titleLivePreview: 'Live Extension Interactive Preview',
        badgeSynced: 'Synced',
        subLivePreview: 'Full runtime sandbox mirroring real Chrome popup, icons, badge states, and events in real time:',
        titleStealthNotice: 'Stealth Mode Enabled',
        subStealthNotice: 'The extension runs silently as an enterprise background service worker without a popup window. Traffic is routed dynamically via PAC policy.',
        badgeStealthActive: 'Icon Badge: Active',
        lblSimState: 'Simulated Extension State',
        btnSimOnline: 'Online Proxy',
        btnSimBypass: 'Bypassed',
        btnSimOffline: 'Offline Fallback',
        btnSimError: 'Re-Authenticating',
        titleCodeInternals: 'Extension Source Code Internals',
        lblActiveFile: 'Active File:',
        subCodeInternals: 'Live Code Editor: Edits in popup.html or popup.js update the Interactive Preview instantly.',
        lblCodeReady: 'Ready',
        btnSaveCode: 'Save File Edits & Apply',
        btnDownloadCrx: 'Download .CRX',
        btnDownloadZip: 'Download .ZIP',

        // Tab 3: Fleet
        titleFleetInstances: 'Connected Extension Instances',
        subFleetInstances: 'Assign specific profiles or groups to instances, or monitor live sync activity:',
        thInstId: 'Instance ID',
        thInstIp: 'IP Address',
        thInstVer: 'Version',
        thInstGroup: 'Fleet Group',
        thInstProfile: 'Assigned Profile',
        thInstSyncs: 'Syncs',
        thInstStatus: 'Status',
        thInstAssign: 'Assign',
        txtNoFleet: 'No active instances connected yet.',

        // Tab 4: GPO
        titleExtPackageInfo: 'Extension Identifiers & Package Info',
        lblCalcExtId: 'Calculated Extension ID',
        lblManifestVer: 'Manifest Version',
        lblRsaKey: 'RSA Private Key',
        lblUpdateManifest: 'Auto-Update Manifest',
        btnDownloadCrxPkg: 'Download .CRX Package',
        btnDownloadZipPkg: 'Download .ZIP',
        titleAdGpoSettings: 'Active Directory GPO Settings',
        lblGpoForcelist: '1. ExtensionInstallForcelist Entry',
        lblGpoSettings: '2. ExtensionSettings (JSON)',
        btnDownloadReg: 'Download Windows .REG Policy File',

        // Tab 5: 3x-ui Rotation
        title3xuiCreds: '3x-ui API Credentials & Timing Scheduler',
        lbl3xuiPanelUrl: '3x-ui Panel URL',
        phRotPanelUrl: 'https://3xui-host:2053/basepath',
        lblAdminUser: 'Admin Username',
        phRotAdminUser: 'admin',
        lblAdminPass: 'Admin Password',
        lblInboundRemark: 'Target Inbound Remark',
        phRotRemark: 'squid-in',
        lblRotInterval: 'Rotation Interval',
        optRot15: 'Every 15 minutes',
        optRot60: 'Every 1 hour',
        optRot360: 'Every 6 hours',
        optRot720: 'Every 12 hours',
        optRot1440: 'Every 24 hours (Daily)',
        lblScheduler: 'Scheduler',
        optSchedEnabled: 'Enabled (Auto)',
        optSchedDisabled: 'Disabled',
        btnSaveScheduler: 'Save Scheduler Settings',
        btnTest3xui: 'Test 3x-ui Connection',
        titleRotStatus: 'Rotation Status & History',
        lblSchedStatus: 'Scheduler Status',
        lblNextRun: 'Next Scheduled Run',
        lblLastRot: 'Last Rotated At',
        lblRecentRot: 'Recent Password Rotations',
        thRotTime: 'Time',
        thRotSource: 'Source',
        thRotUser: 'User',
        thRotResult: 'Result',
        txtNoRotEvents: 'No rotation events yet',

        // Tab 6: Deploy
        titleDeployScenarios: 'Server Deployment & Container Scenarios',
        badgeProdReady: 'Production Ready',
        subDeployScenarios: 'Choose the best installation option for your corporate infrastructure: from isolated Docker containers to Linux systemd services or Nginx SSL reverse-proxy.',
        btnScenDocker: '🐳 Docker & Compose',
        btnScenSystemd: '🐧 Linux Systemd Service',
        btnScenNginx: '🛡️ Nginx + SSL (HTTPS)',
        btnScenStandalone: '⚡ Standalone / PM2',
        btnScenGpo: '🏢 Active Directory / GPO',
        scen1Title: 'Option 1: Docker & Docker Compose (Recommended)',
        scen1Desc: 'Fully isolated multi-stage container based on Alpine Linux. Automatically persists rotated passwords, compiled .CRX extensions and PAC scripts in Docker volumes.',
        scen1Quick: 'Quick single-command launch:',
        scen1Config: 'Configuration file docker-compose.yml:',
        btnDownloadDockerfile: 'Download Dockerfile',
        btnDownloadCompose: 'Download docker-compose.yml',
        scen2Title: 'Option 2: Linux System Service (systemd)',
        scen2Desc: 'Ideal for dedicated virtual machines (Ubuntu, Debian, RHEL). Sets up unprivileged user pecuser, automated startup, and journald logging.',
        scen2Auto: 'Automated installation script:',
        scen2File: 'Service unit /etc/systemd/system/pec-server.service:',
        scen2Commands: 'Service management commands:',
        scen3Title: 'Option 3: Nginx Reverse-Proxy + SSL + Rate Limiting',
        scen3Desc: 'Provides HTTPS encryption (required for secure credential delivery to extensions), PAC file caching, and rate limiting for authentication endpoints.',
        scen3Config: 'Nginx configuration (/etc/nginx/sites-available/pec-proxy.conf):',
        scen4Title: 'Option 4: Standalone Run via Node.js and PM2',
        scen4Desc: 'Fast start for development, testing, or lightweight environments without Docker.',
        scen5Title: 'Option 5: Extension Deployment via Active Directory GPO',
        scen5Desc: 'The ExtensionInstallForcelist policy automatically forces installation of the compiled .CRX onto Windows domain workstations without allowing uninstallation by users.',
        scen5RegKey: 'Windows Registry Key (HKLM\\SOFTWARE\\Policies\\Google\\Chrome\\ExtensionInstallForcelist):',
        btnDownloadRegGpo: 'Download Registry File (.REG)',

        // Tab 7: Audit & Tester
        titleCredsTester: 'Interactive /creds Tester',
        lblTestToken: 'X-Ext-Token Header Value',
        btnSendCreds: 'Send GET /creds',
        btnTestInvalidToken: 'Test Invalid Token',
        titleSyncTester: 'Interactive /api/sync Tester',
        subSyncTester: 'Simulate a Chrome extension heartbeat sync:',
        btnSendSync: 'Send POST /api/sync',
        titleAuditLogs: 'Access & Security Audit Logs',
        thLogTime: 'Timestamp',
        thLogIp: 'IP Address',
        thLogEndpoint: 'Endpoint',
        thLogStatus: 'Status',
        thLogResult: 'Result',
        thLogDetails: 'Details',
        txtLoadingLogs: 'Loading logs...'
      },
      ru: {
        appTitle: 'PEC - Proxy Extension Corp',
        appSubtitle: 'Корпоративная синхронизация прокси',
        statusGatewayActive: 'Шлюз активен',
        lblGatewayStatus: 'Шлюз активен',
        btnRefreshAllTitle: 'Обновить всё',
        btnCustomizationTitle: 'Внешний вид и темы',
        popoverTitle: 'Внешний вид',
        lblHdrFleet: 'Подключенный флот:',
        lblHdrUser: 'Текущий пользователь:',
        lblHdrProfile: 'Активный PAC профиль:',
        lblHdrRot: 'Следующая ротация:',
        btnRotateNow: 'Ротировать пароль сейчас',
        btnKillSwitchOff: 'Kill-Switch: ВЫКЛ',
        btnKillSwitchOn: 'Kill-Switch: ВКЛ (Авария)',
        tabBtnRouting: 'Маршрутизация и Гео-базы',
        tabBtnBuilder: 'Конструктор расширения',
        tabBtnFleet: 'Флот и устройства',
        tabBtnGpo: 'GPO & Реестр Windows',
        tabBtnRotation: 'Ротация паролей 3x-ui',
        tabBtnLogs: 'Аудит и Тестер API',
        activeFleetSuffix: ' активных',

        // Modal
        modalSettingsTitle: 'Кастомизация сервера и Релизы',
        lblSettingsLayout: '1. Стиль интерфейса сервера (Layout)',
        subSettingsLayout: 'Выберите структурный шаблон для всех вкладок панели:',
        optLayoutConsole: '🖥️ Compact Console',
        descLayoutConsole: 'Ультра-минималистичный компактный интерфейс с плоскими границами, 4px скруглениями и максимальной плотностью информации во всех вкладках.',
        optLayoutTerminal: '⚡ Cyber Terminal',
        descLayoutTerminal: 'Моноширинный киберпанк/SecOps терминал со строгими 0px углами, неоновой сеткой и подсвеченными карточками.',
        badgeSelected: 'Активно',
        lblSettingsTheme: '2. Цветовая палитра (Color Scheme)',
        subSettingsTheme: 'Все цветовые схемы сохранены и адаптируются под выбранный макет:',
        lblSettingsLang: '3. Язык интерфейса (Language)',
        titleGhVersionControl: 'Версии и релизы GitHub',
        subGhVersionControl: 'Синхронизация с официальным репозиторием GitHub (показывает установленную версию и доступные релизы):',
        btnCheckGhReleases: 'Проверить обновления',
        txtGhChecking: 'Проверка релизов на GitHub...',
        btnCloseModal: 'Закрыть',

        // Tab 1: Routing & GeoBases
        titleRoutingMatrix: 'Профили маршрутизации и матрица гео-правил',
        btnNewProfile: '+ Новый профиль',
        lblProfName: 'Название профиля',
        lblDefaultPolicy: 'Политика по умолчанию (Fallback)',
        optPolicyDirect: 'DIRECT по умолчанию (Выборочный прокси)',
        optPolicyProxy: 'PROXY по умолчанию (Полный туннель)',
        lblTargetScope: 'Целевая область применения',
        optScopeAll: 'Весь флот (Глобально по умолчанию)',
        optScopeGroup: 'Целевая группа AD / Флота',
        optScopeInstances: 'Отдельные выбранные устройства',
        lblTargetGroup: 'Имя целевой группы',
        phTargetGroup: 'напр. SEC-Proxy-VPN-VIP или Dev-Team',
        profDescDefault: 'Политика маршрутизации, применяемая к соответствующим браузерам.',
        btnSaveProfile: 'Сохранить профиль',
        btnDeleteProfile: 'Удалить профиль',
        btnPacPreview: 'Открыть PAC-скрипт',
        titleGeoPresets: 'Быстрое добавление гео-баз и наборов доменов',
        titleCustomRule: 'Добавить пользовательское правило для домена / подсети',
        lblRuleName: 'Название правила',
        phRuleName: 'Мое правило',
        lblRulePattern: 'Шаблон (домены через запятую или CIDR подсети)',
        phRulePattern: '*.example.com, target-domain.org, 10.50.0.0/16',
        lblRuleAction: 'Действие',
        optActionProxy: 'PROXY',
        optActionDirect: 'DIRECT',
        optActionBlock: 'BLOCK (Блокировать)',
        btnAddRule: '+ Добавить правило',
        titleActiveRules: 'Иерархия правил профиля (Обработка сверху вниз)',
        thStatus: 'Статус',
        thRuleName: 'Имя правила',
        thPattern: 'Шаблон / Пресет',
        thAction: 'Действие',
        thActions: 'Действия',
        txtNoRules: 'Правила для этого профиля пока не заданы.',

        // Tab 2: Extension Constructor Studio
        titleBuilder: 'Конструктор и кастомизатор расширения',
        subBuilder: 'Настройка функциональных архетипов, визуального стиля, защиты от утечек и возможностей пользователя:',
        lblArchetypePresets: '1. Функциональные конфигурационные архетипы',
        chipSelfService: 'Self-Service Pro',
        chipKiosk: 'Киоск / Ограниченный',
        chipStealth: 'Скрытый агент (Stealth)',
        lblThemePalettes: '2. Темы и цветовые палитры',
        lblExtName: 'Название расширения',
        phExtName: 'Corp Proxy Auth & Sync',
        lblShortName: 'Короткое имя',
        phShortName: 'CorpProxy',
        lblVersion: 'Версия',
        lblUiMode: 'Режим интерфейса',
        optUiPopup: 'Интерактивное всплывающее окно (Popup)',
        optUiStealth: 'Скрытый фоновый агент (Stealth Worker)',
        lblIconType: 'Тип векторной иконки',
        lblBrandColor: 'Фирменный акцентный цвет',
        lblIconEmoji: 'Эмодзи иконки',
        lblSyncInterval: 'Интервал синхронизации',
        optSync5: 'Каждые 5 минут',
        optSync15: 'Каждые 15 минут',
        optSync30: 'Каждые 30 минут',
        optSync60: 'Каждый 1 час',
        lblExtDesc: 'Корпоративное описание',
        phExtDesc: 'Корпоративное расширение Chrome для автоматической синхронизации прокси',
        lblSecPolicies: 'Политики безопасности и защита от утечек',
        lblWebrtcShield: 'Защита WebRTC (предотвращение утечки IP)',
        lblDnsGuard: 'Защита DNS (резолв через прокси)',
        lblBadgeIcon: 'Индикатор состояния на иконке (бейдж)',
        lblAutoProxy: 'Принудительное применение PAC при старте',
        lblAllowBypass: 'Разрешить временный ручной обход',
        lblIpGeo: 'Отображать выходной IP и проверку гео',
        lblBypassTimeout: 'Таймаут ручного обхода',
        lblSupportUrl: 'Контакт службы поддержки',
        phSupportUrl: 'mailto:it-support@corp.local',
        btnBuildCrx: 'Скомпилировать, подписать и собрать CRX',
        btnSaveConfig: 'Сохранить только конфиг',
        btnResetTemplate: 'Сбросить к исходному шаблону',
        titleLivePreview: 'Интерактивный предпросмотр расширения',
        badgeSynced: 'Синхронизировано',
        subLivePreview: 'Живая песочница, отображающая popup Chrome, иконки, бейджи и события в реальном времени:',
        titleStealthNotice: 'Включен скрытый режим (Stealth Mode)',
        subStealthNotice: 'Расширение работает в фоновом режиме без всплывающего окна. Трафик маршрутизируется динамически через PAC-скрипт.',
        badgeStealthActive: 'Бейдж иконки: Активен',
        lblSimState: 'Состояние симуляции расширения',
        btnSimOnline: '🟢 Онлайн прокси',
        btnSimBypass: '🟡 Прямой обход',
        btnSimOffline: '🔴 Офлайн',
        btnSimError: '🔄 407 Ре-аутентификация',
        titleCodeInternals: 'Исходный код и внутренние файлы расширения',
        lblActiveFile: 'Активный файл:',
        subCodeInternals: 'Редактор кода: изменения в popup.html или popup.js мгновенно обновляют интерактивный предпросмотр.',
        lblCodeReady: 'Готов',
        btnSaveCode: 'Сохранить изменения и применить',
        btnDownloadCrx: 'Скачать .CRX',
        btnDownloadZip: 'Скачать .ZIP',

        // Tab 3: Fleet
        titleFleetInstances: 'Подключенные экземпляры расширения',
        subFleetInstances: 'Назначайте профили или группы устройствам, отслеживайте статус синхронизации:',
        thInstId: 'ID экземпляра',
        thInstIp: 'IP адрес',
        thInstVer: 'Версия',
        thInstGroup: 'Группа флота',
        thInstProfile: 'Назначенный профиль',
        thInstSyncs: 'Синхронизаций',
        thInstStatus: 'Статус',
        thInstAssign: 'Назначить',
        txtNoFleet: 'Пока нет подключенных активных устройств.',

        // Tab 4: GPO
        titleExtPackageInfo: 'Идентификаторы расширения и сведения о пакете',
        lblCalcExtId: 'Вычисленный Extension ID',
        lblManifestVer: 'Версия Manifest',
        lblRsaKey: 'Приватный RSA-ключ',
        lblUpdateManifest: 'Манифест автообновлений',
        btnDownloadCrxPkg: 'Скачать пакет .CRX',
        btnDownloadZipPkg: 'Скачать .ZIP',
        titleAdGpoSettings: 'Параметры Active Directory GPO',
        lblGpoForcelist: '1. Запись ExtensionInstallForcelist',
        lblGpoSettings: '2. ExtensionSettings (JSON)',
        btnDownloadReg: 'Скачать файл реестра Windows (.REG)',

        // Tab 5: 3x-ui Rotation
        title3xuiCreds: 'Учетные данные 3x-ui API и планировщик',
        lbl3xuiPanelUrl: 'URL панели 3x-ui',
        phRotPanelUrl: 'https://3xui-host:2053/basepath',
        lblAdminUser: 'Логин администратора',
        phRotAdminUser: 'admin',
        lblAdminPass: 'Пароль администратора',
        lblInboundRemark: 'Примечание входящего (Remark)',
        phRotRemark: 'squid-in',
        lblRotInterval: 'Интервал ротации',
        optRot15: 'Каждые 15 минут',
        optRot60: 'Каждый 1 час',
        optRot360: 'Каждые 6 часов',
        optRot720: 'Каждые 12 часов',
        optRot1440: 'Каждые 24 часа (Раз в сутки)',
        lblScheduler: 'Планировщик',
        optSchedEnabled: 'Включен (Авто)',
        optSchedDisabled: 'Отключен',
        btnSaveScheduler: 'Сохранить настройки планировщика',
        btnTest3xui: 'Проверить подключение к 3x-ui',
        titleRotStatus: 'Статус ротации и история',
        lblSchedStatus: 'Статус планировщика',
        lblNextRun: 'Следующий запуск',
        lblLastRot: 'Последняя ротация',
        lblRecentRot: 'Недавние ротации паролей',
        thRotTime: 'Время',
        thRotSource: 'Источник',
        thRotUser: 'Пользователь',
        thRotResult: 'Результат',
        txtNoRotEvents: 'Событий ротации пока нет',

        // Tab 6: Deploy
        titleDeployScenarios: 'Сценарии установки и развертывания сервера',
        badgeProdReady: 'Готово к Production',
        subDeployScenarios: 'Выберите подходящий вариант для вашей инфраструктуры: от изолированного контейнера Docker до службы Linux systemd или Nginx с SSL.',
        btnScenDocker: '🐳 Docker и Compose',
        btnScenSystemd: '🐧 Служба Linux Systemd',
        btnScenNginx: '🛡️ Nginx + SSL (HTTPS)',
        btnScenStandalone: '⚡ Standalone / PM2',
        btnScenGpo: '🏢 Active Directory / GPO',
        scen1Title: 'Вариант 1: Запуск через Docker и Docker Compose (Рекомендуемый)',
        scen1Desc: 'Полностью изолированный multi-stage контейнер на базе Alpine Linux. Автоматически сохраняет ротируемые пароли, скомпилированные .CRX расширения и PAC-скрипты в томах Docker.',
        scen1Quick: 'Быстрый запуск одной командой:',
        scen1Config: 'Конфигурационный файл docker-compose.yml:',
        btnDownloadDockerfile: 'Скачать Dockerfile',
        btnDownloadCompose: 'Скачать docker-compose.yml',
        scen2Title: 'Вариант 2: Установка как системная служба Linux (systemd)',
        scen2Desc: 'Идеально для выделенных виртуальных машин (Ubuntu, Debian, RHEL). Создает системного пользователя pecuser, настраивает автозапуск и журналирование через journald.',
        scen2Auto: 'Автоматическая установка через скрипт:',
        scen2File: 'Файл службы /etc/systemd/system/pec-server.service:',
        scen2Commands: 'Команды управления службой:',
        scen3Title: 'Вариант 3: Реверс-прокси Nginx с SSL и защитой от перебора',
        scen3Desc: 'Обеспечивает шифрование трафика по HTTPS (требуется для безопасной доставки учетных данных в расширения), кеширование PAC-файлов и ограничение запросов (Rate Limiting).',
        scen3Config: 'Конфигурация Nginx (/etc/nginx/sites-available/pec-proxy.conf):',
        scen4Title: 'Вариант 4: Автономный запуск через Node.js и PM2',
        scen4Desc: 'Быстрый запуск для тестирования, разработки или легких окружений без Docker.',
        scen5Title: 'Вариант 5: Развертывание расширения через Active Directory GPO',
        scen5Desc: 'Политика ExtensionInstallForcelist автоматически принудительно устанавливает скомпилированный .CRX на компьютеры пользователей домена Windows без возможности ручного удаления сотрудником.',
        scen5RegKey: 'Ключ реестра Windows (HKLM\\SOFTWARE\\Policies\\Google\\Chrome\\ExtensionInstallForcelist):',
        btnDownloadRegGpo: 'Скачать файл реестра (.REG)',

        // Tab 7: Audit & Tester
        titleCredsTester: 'Интерактивный тестер /creds',
        lblTestToken: 'Значение заголовка X-Ext-Token',
        btnSendCreds: 'Отправить GET /creds',
        btnTestInvalidToken: 'Проверить неверный токен',
        titleSyncTester: 'Интерактивный тестер /api/sync',
        subSyncTester: 'Симуляция отправки пульса синхронизации расширения:',
        btnSendSync: 'Отправить POST /api/sync',
        titleAuditLogs: 'Журнал аудита доступа и безопасности',
        thLogTime: 'Время',
        thLogIp: 'IP адрес',
        thLogEndpoint: 'Эндпоинт',
        thLogStatus: 'Статус',
        thLogResult: 'Результат',
        thLogDetails: 'Детали',
        txtLoadingLogs: 'Загрузка журнала...'
      }
    };

    let currentLang = 'ru';

    function setLanguage(lang) {
      currentLang = (lang === 'en' || lang === 'ru') ? lang : 'ru';
      try { localStorage.setItem('pec_lang', currentLang); } catch(e){}
      
      const btnEn = document.getElementById('btnLangEn');
      const btnRu = document.getElementById('btnLangRu');
      if (btnEn && btnRu) {
        if (currentLang === 'en') {
          btnEn.style.background = 'var(--primary)';
          btnEn.style.color = '#fff';
          btnRu.style.background = 'transparent';
          btnRu.style.color = 'var(--text-muted)';
        } else {
          btnRu.style.background = 'var(--primary)';
          btnRu.style.color = '#fff';
          btnEn.style.background = 'transparent';
          btnEn.style.color = 'var(--text-muted)';
        }
      }

      const modalRu = document.getElementById('modalLangRu');
      const modalEn = document.getElementById('modalLangEn');
      if (modalRu && modalEn) {
        if (currentLang === 'ru') {
          modalRu.className = 'btn';
          modalEn.className = 'btn-secondary';
        } else {
          modalEn.className = 'btn';
          modalRu.className = 'btn-secondary';
        }
      }

      const dict = I18N[currentLang];
      
      // Update all elements with data-i18n attributes
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
          el.textContent = dict[key];
        }
      });

      // Update placeholders with data-i18n-ph attributes
      document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        const key = el.getAttribute('data-i18n-ph');
        if (dict[key]) {
          el.setAttribute('placeholder', dict[key]);
        }
      });

      // Update titles with data-i18n-title attributes
      document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (dict[key]) {
          el.setAttribute('title', dict[key]);
        }
      });

      // Update elements by ID if present in dictionary
      for (const key in dict) {
        const el = document.getElementById(key);
        if (el && !el.hasAttribute('data-i18n')) {
          el.textContent = dict[key];
        }
      }

      const btnKill = document.getElementById('btnKillSwitch');
      if (btnKill) {
        btnKill.textContent = globalKillSwitch ? dict.btnKillSwitchOn : dict.btnKillSwitchOff;
      }

      if (cachedReleases) {
        renderGitHubReleases(cachedReleases);
      }

      if (typeof loadPresets === 'function') loadPresets();
      if (typeof fetchFleet === 'function') fetchFleet();
      if (typeof fetchStatus === 'function') fetchStatus();
    }

    function switchTab(name) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      
      const pane = document.getElementById('tab-' + name);
      if (pane) pane.classList.add('active');
      
      const btn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(name));
      if (btn) btn.classList.add('active');
    }

    // ----------------- Routing & Profiles -----------------
    async function loadPresets() {
      try {
        const res = await adminFetch('/api/routing/presets');
        const presets = await res.json();
        const container = document.getElementById('presetsContainer');
        
        const isRu = currentLang === 'ru';
        container.innerHTML = presets.map(p => \`
          <div class="preset-card">
            <div>
              <h4>\${p.name}</h4>
              <p>\${p.description} (\${p.domains.length} patterns)</p>
            </div>
            <div style="display: flex; gap: 6px; margin-top: 6px;">
              <button onclick="addPresetRule('\${p.id}', '\${p.name}', 'proxy')" class="btn-secondary" style="font-size: 11px; padding: 4px 8px;">+ \${isRu ? 'Прокси' : 'Proxy'}</button>
              <button onclick="addPresetRule('\${p.id}', '\${p.name}', 'direct')" class="btn-secondary" style="font-size: 11px; padding: 4px 8px;">+ \${isRu ? 'Напрямую' : 'Direct'}</button>
              <button onclick="addPresetRule('\${p.id}', '\${p.name}', 'block')" class="btn-danger" style="font-size: 11px; padding: 4px 8px;">+ \${isRu ? 'Блок' : 'Block'}</button>
            </div>
          </div>
        \`).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function loadProfiles() {
      try {
        const res = await adminFetch('/api/routing/profiles');
        allProfiles = await res.json();
        const sel = document.getElementById('profileSelect');
        
        sel.innerHTML = allProfiles.map(p => 
          \`<option value="\${p.id}">\${p.name} (\${p.defaultPolicy.toUpperCase()} default)\${p.isDefault ? ' [DEFAULT]' : ''}</option>\`
        ).join('');

        if (allProfiles.length > 0) {
          currentProfile = allProfiles[0];
          renderProfile(currentProfile);
          document.getElementById('hdrActiveProfile').textContent = currentProfile.name;
        }
      } catch (e) {
        console.error(e);
      }
    }

    function loadSelectedProfile() {
      const id = document.getElementById('profileSelect').value;
      const found = allProfiles.find(p => p.id === id);
      if (found) {
        currentProfile = found;
        renderProfile(currentProfile);
      }
    }

    function renderProfile(p) {
      document.getElementById('profName').value = p.name || '';
      document.getElementById('profDefaultPolicy').value = p.defaultPolicy || 'direct';
      document.getElementById('profTargetScope').value = p.targetScope || 'all';
      document.getElementById('profTargetGroup').value = p.targetGroup || '';
      document.getElementById('profDesc').textContent = p.description || 'Configured routing rules.';
      
      const groupRow = document.getElementById('groupTargetRow');
      groupRow.style.display = p.targetScope === 'group' ? 'block' : 'none';

      document.getElementById('btnPacPreview').href = '/proxy.pac?profileId=' + p.id;
      renderRules(p.rules || []);
    }

    document.getElementById('profTargetScope').addEventListener('change', (e) => {
      document.getElementById('groupTargetRow').style.display = e.target.value === 'group' ? 'block' : 'none';
    });

    function renderRules(rules) {
      const tbody = document.getElementById('rulesTableBody');
      const isRu = currentLang === 'ru';
      if (!rules || !rules.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">' + (isRu ? 'В этом профиле нет правил. Используйте кнопки выше для добавления пресетов или кастомных правил.' : 'No rules defined for this profile. Use buttons above to add presets or custom rules.') + '</td></tr>';
        return;
      }

      tbody.innerHTML = rules.map((r, idx) => {
        let badge = 'badge-action-proxy';
        if (r.action === 'direct') badge = 'badge-action-direct';
        else if (r.action === 'block') badge = 'badge-action-block';
        const actionLabel = isRu ? (r.action === 'proxy' ? 'ПРОКСИ' : (r.action === 'direct' ? 'НАПРЯМУЮ' : 'БЛОК')) : r.action.toUpperCase();

        return \`<tr>
          <td>
            <input type="checkbox" \${r.enabled ? 'checked' : ''} onchange="toggleRuleEnabled(\${idx})" style="margin: 0;" />
          </td>
          <td><strong>\${r.name}</strong></td>
          <td><code>\${r.pattern}</code></td>
          <td><span class="badge \${badge}">\${actionLabel}</span></td>
          <td>
            <button onclick="removeRule(\${idx})" class="btn-danger" style="font-size: 11px; padding: 3px 8px;">\${isRu ? 'Удалить' : 'Delete'}</button>
          </td>
        </tr>\`;
      }).join('');
    }

    function toggleRuleEnabled(idx) {
      if (currentProfile && currentProfile.rules[idx]) {
        currentProfile.rules[idx].enabled = !currentProfile.rules[idx].enabled;
        renderRules(currentProfile.rules);
      }
    }

    function removeRule(idx) {
      if (currentProfile && currentProfile.rules[idx]) {
        currentProfile.rules.splice(idx, 1);
        renderRules(currentProfile.rules);
      }
    }

    function addPresetRule(presetId, presetName, action) {
      if (!currentProfile) return;
      currentProfile.rules.push({
        id: 'r_' + Math.random().toString(36).substring(2, 8),
        name: presetName,
        targetType: 'preset',
        pattern: presetId,
        action: action,
        enabled: true
      });
      renderRules(currentProfile.rules);
    }

    function addCustomRule() {
      if (!currentProfile) return;
      const name = document.getElementById('newRuleName').value.trim();
      const pattern = document.getElementById('newRulePattern').value.trim();
      const action = document.getElementById('newRuleAction').value;

      if (!name || !pattern) {
        alert('Please specify rule name and pattern');
        return;
      }

      currentProfile.rules.push({
        id: 'r_' + Math.random().toString(36).substring(2, 8),
        name: name,
        targetType: pattern.includes('/') ? 'cidr' : 'wildcard',
        pattern: pattern,
        action: action,
        enabled: true
      });

      document.getElementById('newRuleName').value = '';
      document.getElementById('newRulePattern').value = '';
      renderRules(currentProfile.rules);
    }

    async function saveCurrentProfile() {
      if (!currentProfile) return;
      currentProfile.name = document.getElementById('profName').value.trim();
      currentProfile.defaultPolicy = document.getElementById('profDefaultPolicy').value;
      currentProfile.targetScope = document.getElementById('profTargetScope').value;
      currentProfile.targetGroup = document.getElementById('profTargetGroup').value.trim();

      try {
        const res = await adminFetch('/api/routing/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(currentProfile)
        });
        if (res.ok) {
          alert('Routing profile saved! Deployed to matching fleet instances.');
          loadProfiles();
        }
      } catch (e) {
        alert('Error saving profile: ' + e);
      }
    }

    function createNewProfile() {
      const name = prompt('Enter name for the new Routing Profile:', 'New Department Profile');
      if (!name) return;
      const newP = {
        id: 'prof_' + Math.random().toString(36).substring(2, 8),
        name: name,
        description: 'Custom routing profile',
        defaultPolicy: 'direct',
        targetScope: 'all',
        rules: []
      };
      allProfiles.push(newP);
      currentProfile = newP;
      
      const sel = document.getElementById('profileSelect');
      const opt = document.createElement('option');
      opt.value = newP.id;
      opt.textContent = newP.name;
      opt.selected = true;
      sel.appendChild(opt);

      renderProfile(newP);
    }

    async function deleteCurrentProfile() {
      if (!currentProfile) return;
      if (!confirm('Are you sure you want to delete profile "' + currentProfile.name + '"?')) return;
      try {
        const res = await adminFetch('/api/routing/profiles/' + currentProfile.id, { method: 'DELETE' });
        const data = await res.json();
        if (data.ok) {
          alert('Profile deleted');
          loadProfiles();
        } else {
          alert('Delete error: ' + (data.error || 'Failed'));
        }
      } catch (e) {
        alert('Error: ' + e);
      }
    }

    // ----------------- Extension Constructor Studio & Live Sandbox -----------------
    let liveSimState = {
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
    };

    let builderDebounceTimer = null;
    let codeEditorDebounceTimer = null;
    let activeTemplatePreset = 'self-service-pro';
    let activeStylePreset = 'cyber-blue';

    async function loadBuilderConfig() {
      try {
        const res = await adminFetch('/api/builder/config');
        const cfg = await res.json();
        
        document.getElementById('bldName').value = cfg.name || 'Corp Proxy Auth & Sync';
        document.getElementById('bldShortName').value = cfg.shortName || 'CorpProxy';
        document.getElementById('bldVersion').value = cfg.version || '1.2.0';
        document.getElementById('bldUiMode').value = cfg.uiMode || 'popup';
        document.getElementById('bldIconType').value = cfg.iconType || 'shield';
        document.getElementById('bldThemeColor').value = cfg.themeColor || '#0284c7';
        document.getElementById('bldEmoji').value = cfg.iconEmoji || '🛡️';
        document.getElementById('bldDesc').value = cfg.description || 'Enterprise Chrome extension for automatic proxy synchronization';
        document.getElementById('bldSyncInterval').value = cfg.syncIntervalMinutes || 15;
        document.getElementById('bldWebRtc').checked = cfg.webRtcProtection !== false;
        document.getElementById('bldDnsGuard').checked = cfg.dnsLeakProtection !== false;
        document.getElementById('bldBadge').checked = cfg.badgeIndicator !== false;
        document.getElementById('bldAutoProxy').checked = cfg.autoConfigureProxy !== false;
        document.getElementById('bldAllowBypass').checked = cfg.allowUserBypass !== false;
        document.getElementById('bldIpGeo').checked = cfg.showIpGeoCheck !== false;
        document.getElementById('bldBypassTimeout').value = cfg.bypassTimeoutMinutes || 15;
        document.getElementById('bldSupportUrl').value = cfg.supportUrl || 'mailto:it-support@corp.local';

        if (cfg.presetTemplate) {
          highlightTemplateChip(cfg.presetTemplate);
        }
        if (cfg.presetStyle) {
          highlightStyleChip(cfg.presetStyle);
        }

        updateLivePreview();
      } catch (e) {
        console.error(e);
      }
    }

    function highlightTemplateChip(preset) {
      activeTemplatePreset = preset;
      ['chip-self-service', 'chip-kiosk', 'chip-stealth'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
      });
      const badge = document.getElementById('bldPresetBadge');
      const desc = document.getElementById('presetDescText');

      if (preset === 'self-service-pro') {
        const el = document.getElementById('chip-self-service');
        if (el) el.classList.add('active');
        if (badge) badge.textContent = 'Self-Service Pro';
        if (desc) desc.textContent = 'Self-Service Pro: Interactive popup with full connection metrics, routing inspection, manual force sync, and user temporary bypass.';
      } else if (preset === 'kiosk-restricted') {
        const el = document.getElementById('chip-kiosk');
        if (el) el.classList.add('active');
        if (badge) badge.textContent = 'Kiosk / Restricted';
        if (desc) desc.textContent = 'Kiosk / Restricted: Read-only popup view without bypass controls or sensitive host exposure. Locked for managed kiosks and students.';
      } else if (preset === 'enterprise-invisible') {
        const el = document.getElementById('chip-stealth');
        if (el) el.classList.add('active');
        if (badge) badge.textContent = 'Stealth Agent';
        if (desc) desc.textContent = 'Stealth Agent: Runs silently in the background without any popup UI, enforcing corporate PAC policies quietly.';
      }
    }

    function highlightStyleChip(style) {
      activeStylePreset = style;
      ['chip-style-cyber-blue', 'chip-style-dark-obsidian', 'chip-style-emerald-sentinel', 'chip-style-sunset-amber', 'chip-style-minimal-light'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
      });
      const target = document.getElementById('chip-style-' + style);
      if (target) target.classList.add('active');
    }

    async function applyTemplatePreset(preset) {
      highlightTemplateChip(preset);

      if (preset === 'self-service-pro') {
        document.getElementById('bldUiMode').value = 'popup';
        document.getElementById('bldAllowBypass').checked = true;
        document.getElementById('bldIpGeo').checked = true;
        document.getElementById('bldBadge').checked = true;
      } else if (preset === 'kiosk-restricted') {
        document.getElementById('bldUiMode').value = 'popup';
        document.getElementById('bldAllowBypass').checked = false;
        document.getElementById('bldIpGeo').checked = false;
        document.getElementById('bldBadge').checked = true;
      } else if (preset === 'enterprise-invisible') {
        document.getElementById('bldUiMode').value = 'stealth';
        document.getElementById('bldAllowBypass').checked = false;
        document.getElementById('bldBadge').checked = true;
      }

      await saveBuilderConfigOnly(false);
      await regenerateTemplatesFromConfig();
    }

    async function applyStylePreset(style) {
      highlightStyleChip(style);
      const colorMap = {
        'cyber-blue': '#0284c7',
        'dark-obsidian': '#a855f7',
        'emerald-sentinel': '#10b981',
        'sunset-amber': '#f59e0b',
        'minimal-light': '#2563eb'
      };
      if (colorMap[style]) {
        document.getElementById('bldThemeColor').value = colorMap[style];
      }
      await saveBuilderConfigOnly(false);
      await regenerateTemplatesFromConfig();
    }

    function onConfigChangeLive() {
      clearTimeout(builderDebounceTimer);
      builderDebounceTimer = setTimeout(async () => {
        await saveBuilderConfigOnly(false);
        await regenerateTemplatesFromConfig();
      }, 500);
    }

    async function regenerateTemplatesFromConfig() {
      try {
        const res = await adminFetch('/api/builder/regenerate', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          await loadExtensionFiles();
          updateLivePreview();
        }
      } catch (e) {
        console.error('Regenerate error:', e);
      }
    }

    function onCodeEditorLiveChange() {
      const fileName = document.getElementById('codeFileSelect').value;
      const content = document.getElementById('codeEditor').value;
      extensionFiles[fileName] = content;
      
      clearTimeout(codeEditorDebounceTimer);
      codeEditorDebounceTimer = setTimeout(() => {
        updateLivePreview();
      }, 250);
    }

    function pushSimStateToIframe() {
      const iframe = document.getElementById('previewFrame');
      if (iframe && iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage({ type: 'UPDATE_SIM_STATE', state: liveSimState }, '*');
        } catch (e) {}
      }
    }

    function simulateState(stateType) {
      const label = document.getElementById('simStateLabel');
      const isRu = currentLang === 'ru';
      if (stateType === 'active') {
        liveSimState.online = true;
        liveSimState.bypassActive = false;
        liveSimState.status = 'Active';
        if (label) {
          label.textContent = isRu ? 'Состояние: Активен / Прокси работает' : 'State: Online / Routing Active';
          label.style.color = 'var(--success)';
        }
      } else if (stateType === 'bypass') {
        liveSimState.online = true;
        liveSimState.bypassActive = true;
        liveSimState.status = 'Bypassed';
        if (label) {
          label.textContent = isRu ? 'Состояние: Временный прямой обход' : 'State: Bypassed / Direct Fallback';
          label.style.color = 'var(--warning)';
        }
      } else if (stateType === 'offline') {
        liveSimState.online = false;
        liveSimState.bypassActive = false;
        liveSimState.status = 'Direct Fallback';
        if (label) {
          label.textContent = isRu ? 'Состояние: Офлайн / Прямой трафик' : 'State: Offline / Direct Fallback';
          label.style.color = 'var(--danger)';
        }
      } else if (stateType === 'error407') {
        liveSimState.online = true;
        liveSimState.bypassActive = false;
        liveSimState.status = 'Syncing...';
        if (label) {
          label.textContent = isRu ? 'Состояние: Переаутентификация / Синхронизация' : 'State: Re-Authenticating / Syncing';
          label.style.color = 'var(--primary)';
        }
      }

      const badgeEl = document.getElementById('browserBadge');
      if (badgeEl) {
        if (liveSimState.bypassActive) {
          badgeEl.textContent = 'BYP';
          badgeEl.style.background = '#f59e0b';
          badgeEl.style.color = '#000';
        } else if (!liveSimState.online) {
          badgeEl.textContent = 'OFF';
          badgeEl.style.background = '#ef4444';
          badgeEl.style.color = '#fff';
        } else {
          badgeEl.textContent = 'PRX';
          badgeEl.style.background = '#10b981';
          badgeEl.style.color = '#000';
        }
      }

      pushSimStateToIframe();
    }

    function toggleSimBypass() {
      liveSimState.bypassActive = !liveSimState.bypassActive;
      liveSimState.status = liveSimState.bypassActive ? 'Bypassed' : 'Active';
      const label = document.getElementById('simStateLabel');
      const isRu = currentLang === 'ru';
      if (label) {
        if (liveSimState.bypassActive) {
          label.textContent = isRu ? 'Состояние: Временный прямой обход' : 'State: Bypassed / Direct Fallback';
          label.style.color = 'var(--warning)';
        } else {
          label.textContent = isRu ? 'Состояние: Активен / Прокси работает' : 'State: Online / Routing Active';
          label.style.color = 'var(--success)';
        }
      }
      const badgeEl = document.getElementById('browserBadge');
      if (badgeEl) {
        if (liveSimState.bypassActive) {
          badgeEl.textContent = 'BYP';
          badgeEl.style.background = '#f59e0b';
          badgeEl.style.color = '#000';
        } else if (!liveSimState.online) {
          badgeEl.textContent = 'OFF';
          badgeEl.style.background = '#ef4444';
          badgeEl.style.color = '#fff';
        } else {
          badgeEl.textContent = 'PRX';
          badgeEl.style.background = '#10b981';
          badgeEl.style.color = '#000';
        }
      }
      pushSimStateToIframe();
    }

    function togglePopupPreviewVisibility() {
      const popupBox = document.getElementById('popupFrameBox');
      if (popupBox.style.display === 'none') {
        popupBox.style.display = 'block';
      } else {
        popupBox.style.display = 'none';
      }
    }

    function updateLivePreview() {
      const uiMode = document.getElementById('bldUiMode').value;
      const previewBox = document.getElementById('popupFrameBox');
      const stealthNotice = document.getElementById('stealthNotice');
      const badgeEl = document.getElementById('browserBadge');
      const iconGlyphEl = document.getElementById('browserIconGlyph');
      const themeColor = document.getElementById('bldThemeColor').value || '#0284c7';
      const iconEmoji = document.getElementById('bldEmoji').value || '🛡️';

      if (iconGlyphEl) iconGlyphEl.textContent = iconEmoji;

      if (badgeEl) {
        if (liveSimState.bypassActive) {
          badgeEl.textContent = 'BYP';
          badgeEl.style.background = '#f59e0b';
          badgeEl.style.color = '#000';
        } else if (!liveSimState.online) {
          badgeEl.textContent = 'OFF';
          badgeEl.style.background = '#ef4444';
          badgeEl.style.color = '#fff';
        } else {
          badgeEl.textContent = 'PRX';
          badgeEl.style.background = '#10b981';
          badgeEl.style.color = '#000';
        }
      }

      if (uiMode === 'stealth') {
        if (previewBox) previewBox.style.display = 'none';
        if (stealthNotice) stealthNotice.style.display = 'block';
        return;
      } else {
        if (previewBox) previewBox.style.display = 'block';
        if (stealthNotice) stealthNotice.style.display = 'none';
      }

      let htmlContent = extensionFiles['popup.html'] || '<div style="color:#fff;padding:20px;">No popup.html generated</div>';
      let jsContent = extensionFiles['popup.js'] || '';

      const currentFileName = document.getElementById('codeFileSelect').value;
      if (currentFileName === 'popup.html') {
        htmlContent = document.getElementById('codeEditor').value;
      } else if (currentFileName === 'popup.js') {
        jsContent = document.getElementById('codeEditor').value;
      }

      const scriptOpen = '<' + 'script>';
      const scriptClose = '<' + '/script>';

      const mockScript = scriptOpen +
        'window.__simState = ' + JSON.stringify(liveSimState) + ';' +
        'window.switchPopupTab = function(tabId) {' +
          'if (!tabId) return;' +
          'var tabs = document.querySelectorAll(".tab-btn");' +
          'for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove("active");' +
          'var contents = document.querySelectorAll(".tab-content");' +
          'for (var j = 0; j < contents.length; j++) contents[j].classList.remove("active");' +
          'var btn = document.querySelector(".tab-btn[data-tab=" + JSON.stringify(tabId) + "]");' +
          'if (btn) btn.classList.add("active");' +
          'var tgt = document.getElementById(tabId);' +
          'if (tgt) tgt.classList.add("active");' +
        '};' +
        'window.chrome = {' +
          'runtime: {' +
            'lastError: null,' +
            'sendMessage: function(msg, cb) {' +
              'if (!msg) return;' +
              'if (msg.action === "GET_STATUS") {' +
                'if (cb) cb(window.__simState || ' + JSON.stringify(liveSimState) + ');' +
              '} else if (msg.action === "FORCE_SYNC") {' +
                'setTimeout(function() {' +
                  'if (cb) cb({ ok: true, syncedAt: new Date().toLocaleTimeString() });' +
                '}, 400);' +
              '} else if (msg.action === "TOGGLE_BYPASS") {' +
                'window.parent.postMessage({ type: "SIM_TOGGLE_BYPASS" }, "*");' +
                'if (cb) cb({ ok: true });' +
              '}' +
            '}' +
          '}' +
        '};' +
        'window.addEventListener("message", function(e) {' +
          'if (e.data && e.data.type === "UPDATE_SIM_STATE") {' +
            'window.__simState = e.data.state;' +
            'if (typeof window.applyPopupState === "function") {' +
              'window.applyPopupState(e.data.state);' +
            '} else {' +
              'var st = document.getElementById("statusText");' +
              'var bg = document.getElementById("badge");' +
              'var btn = document.getElementById("btnToggleBypass");' +
              'if (st) st.textContent = e.data.state.bypassActive ? "Обход" : (e.data.state.online ? "Активен" : "Отключен");' +
              'if (bg) bg.className = e.data.state.bypassActive ? "status-badge bypass" : (e.data.state.online ? "status-badge" : "status-badge offline");' +
              'if (btn) btn.textContent = e.data.state.bypassActive ? "Включить прокси" : "Временно отключить";' +
            '}' +
          '}' +
        '});' +
        'document.addEventListener("click", function(ev) {' +
          'var tab = ev.target.closest(".tab-btn");' +
          'if (tab && tab.dataset && tab.dataset.tab) {' +
            'ev.preventDefault();' +
            'window.switchPopupTab(tab.dataset.tab);' +
          '}' +
        '});' +
        'window.addEventListener("unhandledrejection", function(e) { e.preventDefault(); });' +
        'var _origFetch = window.fetch;' +
        'window.fetch = function(url, opts) {' +
          'if (typeof url === "string" && url.includes("/api/ip-echo")) {' +
            'return Promise.resolve(new Response(JSON.stringify({' +
              'ip: (window.__simState && window.__simState.exitIp) || "198.51.100.42",' +
              'country: (window.__simState && window.__simState.ipLocation) || "Frankfurt, DE",' +
              'city: "Direct Egress",' +
              'protocol: "HTTPS"' +
            '}), { status: 200, headers: { "Content-Type": "application/json" } }));' +
          '}' +
          'return _origFetch ? _origFetch(url, opts).catch(function() { return new Response("{}", { status: 200 }); }) : Promise.resolve(new Response("{}", { status: 200 }));' +
        '};' +
        scriptClose;

      let doc = htmlContent;
      const popupScriptRegex = new RegExp('<' + 'script\\s+src="popup\\.js">' + '<' + '/script>', 'i');
      if (doc.includes('popup.js')) {
        doc = doc.replace(popupScriptRegex, mockScript + scriptOpen + jsContent + scriptClose);
      } else {
        doc = mockScript + doc + scriptOpen + jsContent + scriptClose;
      }

      const iframe = document.getElementById('previewFrame');
      if (iframe) {
        iframe.onload = function() {
          pushSimStateToIframe();
        };
        iframe.srcdoc = doc;
      }
    }

    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'SIM_TOGGLE_BYPASS') {
        toggleSimBypass();
      }
    });

    async function loadExtensionFiles() {
      try {
        const res = await adminFetch('/api/builder/files');
        extensionFiles = await res.json();
        loadFileContent();
        updateLivePreview();
      } catch (e) {
        console.error(e);
      }
    }

    function loadFileContent() {
      const fileName = document.getElementById('codeFileSelect').value;
      const editor = document.getElementById('codeEditor');
      editor.value = extensionFiles[fileName] || '// File not found or empty';
      document.getElementById('codeStatus').textContent = 'Viewing ' + fileName;
      updateLivePreview();
    }

    async function saveCurrentCodeFile() {
      const fileName = document.getElementById('codeFileSelect').value;
      const content = document.getElementById('codeEditor').value;
      try {
        const res = await adminFetch('/api/builder/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName, content })
        });
        if (res.ok) {
          extensionFiles[fileName] = content;
          document.getElementById('codeStatus').textContent = 'Saved ' + fileName + ' at ' + new Date().toLocaleTimeString();
          updateLivePreview();
        }
      } catch (e) {
        alert('Error saving file: ' + e);
      }
    }

    async function saveBuilderConfigOnly(showAlert = true) {
      const payload = {
        name: document.getElementById('bldName').value.trim(),
        shortName: document.getElementById('bldShortName').value.trim(),
        version: document.getElementById('bldVersion').value.trim(),
        uiMode: document.getElementById('bldUiMode').value,
        iconType: document.getElementById('bldIconType').value,
        themeColor: document.getElementById('bldThemeColor').value.trim(),
        iconEmoji: document.getElementById('bldEmoji').value.trim(),
        description: document.getElementById('bldDesc').value.trim(),
        syncIntervalMinutes: parseInt(document.getElementById('bldSyncInterval').value, 10) || 15,
        webRtcProtection: document.getElementById('bldWebRtc').checked,
        dnsLeakProtection: document.getElementById('bldDnsGuard').checked,
        badgeIndicator: document.getElementById('bldBadge').checked,
        autoConfigureProxy: document.getElementById('bldAutoProxy').checked,
        allowUserBypass: document.getElementById('bldAllowBypass').checked,
        showIpGeoCheck: document.getElementById('bldIpGeo').checked,
        bypassTimeoutMinutes: parseInt(document.getElementById('bldBypassTimeout').value, 10) || 15,
        supportUrl: document.getElementById('bldSupportUrl').value.trim(),
        presetTemplate: activeTemplatePreset,
        presetStyle: activeStylePreset,
      };

      try {
        const res = await adminFetch('/api/builder/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          if (showAlert) alert('Constructor configuration saved and extension files re-rendered!');
        }
      } catch (e) {
        if (showAlert) alert('Error saving config: ' + e);
      }
    }

    async function buildAndPackExtension() {
      await saveBuilderConfigOnly(false);
      try {
        const res = await adminFetch('/api/builder/build', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          alert('Extension package built successfully! .CRX signed, .ZIP created, and updates.xml regenerated.');
          fetchExtensionInfo();
          await loadExtensionFiles();
        } else {
          alert('Build error: ' + (data.error || 'Failed'));
        }
      } catch (e) {
        alert('Error building extension: ' + e);
      }
    }

    // ----------------- Fleet & Instances -----------------
    async function fetchFleet() {
      try {
        const res = await adminFetch('/api/instances');
        const data = await res.json();
        const isRu = currentLang === 'ru';
        document.getElementById('badgeFleetOnline').textContent = data.online + (isRu ? ' онлайн' : ' online');

        const tbody = document.getElementById('fleetTableBody');
        if (!data.instances || !data.instances.length) {
          tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">' + (isRu ? 'Пока нет подключенных устройств. Расширения синхронизируются через <code>/api/sync</code> каждые 5 мин.' : 'No instances connected yet. Extensions sync via <code>/api/sync</code> every 5 min.') + '</td></tr>';
          return;
        }

        const profileOptions = allProfiles.map(p => \`<option value="\${p.id}">\${p.name}</option>\`).join('');

        tbody.innerHTML = data.instances.map(inst => {
          let badge = 'badge-online';
          if (inst.status === 'STALE') badge = 'badge-stale';
          else if (inst.status === 'OFFLINE') badge = 'badge-offline';

          return \`<tr>
            <td><code>\${inst.instanceId}</code></td>
            <td style="font-family: var(--mono);">\${inst.ip}</td>
            <td>v\${inst.version}</td>
            <td><code>\${inst.group || (isRu ? 'Основной флот' : 'Default Fleet')}</code></td>
            <td><span class="badge badge-action-proxy">\${inst.appliedProfileName || (isRu ? 'По умолчанию' : 'Default')}</span></td>
            <td>\${inst.syncCount}</td>
            <td><span class="badge \${badge}">\${inst.status}</span></td>
            <td>
              <select onchange="assignProfileToInstance('\${inst.instanceId}', this.value)" style="margin-bottom: 0; font-size: 11px; padding: 3px 6px;">
                <option value="">\${isRu ? 'По умолчанию (Авто)' : 'Default (Auto)'}</option>
                \${profileOptions}
              </select>
            </td>
          </tr>\`;
        }).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function assignProfileToInstance(instanceId, profileId) {
      try {
        await adminFetch('/api/instances/assign-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instanceId, profileId })
        });
        fetchFleet();
      } catch (e) {
        alert('Assignment error: ' + e);
      }
    }

    // ----------------- Extension Info & GPO -----------------
    async function fetchExtensionInfo() {
      try {
        const res = await adminFetch('/api/extension/info');
        const data = await res.json();
        document.getElementById('dispExtId').textContent = data.extensionId;
        document.getElementById('dispExtVer').textContent = data.version;

        globalGpo = data.gpo;
        if (data.gpo) {
          document.getElementById('gpoForcelist').textContent = data.gpo.forcelistEntry;
          document.getElementById('gpoSettings').textContent = JSON.stringify(data.gpo.extensionSettingsJson, null, 2);
          const scenGpo = document.getElementById('scenGpoForcelistText');
          if (scenGpo) scenGpo.textContent = data.gpo.forcelistEntry;
        }
      } catch (e) {
        console.error(e);
      }
    }

    function downloadRegFile() {
      if (!globalGpo || !globalGpo.regContent) return;
      const blob = new Blob([globalGpo.regContent], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'corp-proxy-policy.reg';
      a.click();
    }

    // ----------------- System Status & Kill-Switch -----------------
    async function fetchStatus() {
      try {
        const res = await adminFetch('/api/status');
        const data = await res.json();
        const isRu = currentLang === 'ru';
        
        document.getElementById('hdrUser').textContent = data.currentUser || (isRu ? 'нет' : 'none');
        document.getElementById('hdrFleetCount').textContent = data.activeInstancesCount + (isRu ? ' активных (' : ' active (') + data.totalInstancesCount + (isRu ? ' всего)' : ' total)');
        
        if (data.nextRotationAt) {
          const diffMin = Math.round((new Date(data.nextRotationAt).getTime() - Date.now()) / 60000);
          document.getElementById('hdrNextRot').textContent = (diffMin > 0 ? (isRu ? 'через ' + diffMin + ' мин' : 'in ' + diffMin + 'm') : (isRu ? 'сейчас' : 'imminent')) + ' (' + new Date(data.nextRotationAt).toLocaleTimeString() + ')';
        } else {
          document.getElementById('hdrNextRot').textContent = isRu ? 'Отключено' : 'Disabled';
        }

        renderAuditLogs(data.auditLogs || []);
      } catch (err) {
        console.error(err);
      }
    }

    async function toggleKillSwitch() {
      globalKillSwitch = !globalKillSwitch;
      try {
        await adminFetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ killSwitch: globalKillSwitch })
        });
        const ksBtn = document.getElementById('btnKillSwitch');
        const dict = I18N[currentLang] || I18N.ru;
        if (globalKillSwitch) {
          ksBtn.textContent = dict.btnKillSwitchOn;
          ksBtn.classList.remove('btn-secondary');
          ksBtn.classList.add('btn-danger');
        } else {
          ksBtn.textContent = dict.btnKillSwitchOff;
          ksBtn.classList.remove('btn-danger');
          ksBtn.classList.add('btn-secondary');
        }
      } catch (e) {
        alert('Kill-switch error: ' + e);
      }
    }

    // ----------------- 3x-ui Rotation -----------------
    async function fetchRotationConfig() {
      try {
        const res = await adminFetch('/api/rotation/config');
        const data = await res.json();
        const cfg = data.config;
        
        document.getElementById('rotPanelUrl').value = cfg.panelUrl || '';
        document.getElementById('rotAdminUser').value = cfg.adminUser || '';
        document.getElementById('rotRemark').value = cfg.inboundRemark || '';
        document.getElementById('rotInterval').value = String(cfg.intervalMinutes || 1440);
        document.getElementById('rotEnabled').value = String(cfg.enabled);
        
        document.getElementById('rotStatusText').textContent = cfg.lastStatus || 'Idle';
        document.getElementById('rotNextRun').textContent = cfg.nextRotationAt ? new Date(cfg.nextRotationAt).toLocaleString() : 'Disabled';
        document.getElementById('rotLastRun').textContent = cfg.lastRotatedAt ? new Date(cfg.lastRotatedAt).toLocaleString() : 'None';

        renderRotationHistory(data.history || []);
      } catch (e) {
        console.error(e);
      }
    }

    async function saveRotationConfig() {
      const payload = {
        panelUrl: document.getElementById('rotPanelUrl').value.trim(),
        adminUser: document.getElementById('rotAdminUser').value.trim(),
        inboundRemark: document.getElementById('rotRemark').value.trim(),
        intervalMinutes: parseInt(document.getElementById('rotInterval').value, 10),
        enabled: document.getElementById('rotEnabled').value === 'true',
      };
      const pass = document.getElementById('rotAdminPass').value;
      if (pass) payload.adminPass = pass;

      try {
        const res = await adminFetch('/api/rotation/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          alert('Rotation schedule updated!');
          fetchRotationConfig();
          fetchStatus();
        }
      } catch (e) {
        alert('Error saving rotation settings: ' + e);
      }
    }

    async function test3xui() {
      const out = document.getElementById('test3xuiResult');
      out.textContent = 'Testing connection to 3x-ui API...';
      const payload = {
        panelUrl: document.getElementById('rotPanelUrl').value.trim(),
        adminUser: document.getElementById('rotAdminUser').value.trim(),
        adminPass: document.getElementById('rotAdminPass').value,
        inboundRemark: document.getElementById('rotRemark').value.trim()
      };

      try {
        const res = await adminFetch('/api/3xui/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        out.textContent = (data.ok ? '✅ ' : '❌ ') + data.message;
        out.style.color = data.ok ? 'var(--success)' : 'var(--danger)';
      } catch (e) {
        out.textContent = 'Connection test failed: ' + e;
        out.style.color = 'var(--danger)';
      }
    }

    async function manualRotate() {
      if (!confirm('Rotate proxy credentials immediately?')) return;
      try {
        const res = await adminFetch('/api/rotation/rotate-now', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          alert('Rotated! New user: ' + data.result.user + ' (source: ' + data.result.source + ')');
          refreshAll();
        } else {
          alert('Rotation error: ' + data.error);
        }
      } catch (e) {
        alert('Failed: ' + e);
      }
    }

    function renderRotationHistory(history) {
      const tbody = document.getElementById('rotHistoryTable');
      if (!history.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="color: var(--text-muted); text-align: center;">No rotation events yet</td></tr>';
        return;
      }
      tbody.innerHTML = history.map(item => \`<tr>
        <td style="font-family: var(--mono); font-size: 12px;">\${new Date(item.timestamp).toLocaleTimeString()}</td>
        <td><code>\${item.source}</code></td>
        <td>\${item.user}</td>
        <td><span class="badge \${item.success ? 'badge-online' : 'badge-offline'}">\${item.success ? 'SUCCESS' : 'FAILED'}</span></td>
      </tr>\`).join('');
    }

    function renderAuditLogs(logs) {
      const tbody = document.getElementById('auditTableBody');
      if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No requests recorded</td></tr>';
        return;
      }
      tbody.innerHTML = logs.map(l => {
        let badge = 'badge-online';
        if (l.result === 'REJECTED_TOKEN' || l.result === 'STORE_ERROR') badge = 'badge-offline';
        else if (l.result === 'HEALTH_CHECK') badge = 'badge-action-proxy';
        
        return \`<tr>
          <td style="font-family: var(--mono); font-size: 12px;">\${new Date(l.timestamp).toLocaleTimeString()}</td>
          <td style="font-family: var(--mono);">\${l.ip}</td>
          <td><code>\${l.endpoint}</code></td>
          <td style="font-family: var(--mono);">\${l.status}</td>
          <td><span class="badge \${badge}">\${l.result}</span></td>
          <td style="color: var(--text-muted); font-size: 12px;">\${l.details || '-'}</td>
        </tr>\`;
      }).join('');
    }

    async function testCredsEndpoint() {
      const token = document.getElementById('testTokenInput').value;
      const out = document.getElementById('testCredsOutput');
      out.textContent = 'Executing GET /creds...';
      try {
        const start = performance.now();
        const res = await fetch('/creds', {
          headers: token ? { 'X-Ext-Token': token } : {}
        });
        const elapsed = Math.round(performance.now() - start);
        const json = await res.json().catch(() => ({}));
        out.textContent = \`HTTP \${res.status} \${res.statusText} (\${elapsed}ms)\n\n\${JSON.stringify(json, null, 2)}\`;
        fetchStatus();
      } catch (e) {
        out.textContent = 'Request failed: ' + e;
      }
    }

    async function testSyncEndpoint() {
      const out = document.getElementById('testSyncOutput');
      out.textContent = 'Executing POST /api/sync...';
      const token = document.getElementById('testTokenInput').value;
      try {
        const res = await fetch('/api/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'X-Ext-Token': token } : {})
          },
          body: JSON.stringify({
            instanceId: 'test-simulated-worker',
            version: '1.2.0',
            activeProxyMode: 'http'
          })
        });
        const json = await res.json();
        out.textContent = JSON.stringify(json, null, 2);
        fetchFleet();
        fetchStatus();
      } catch (e) {
        out.textContent = 'Sync test failed: ' + e;
      }
    }

    function refreshAll() {
      try {
        const savedLayout = localStorage.getItem('pec_server_layout') || 'modern';
        setServerLayout(savedLayout);
        const savedTheme = localStorage.getItem('pec_server_theme') || 'cyber';
        setServerTheme(savedTheme);
        const savedLang = localStorage.getItem('pec_lang') || 'ru';
        setLanguage(savedLang);
      } catch (e) {}

      fetchStatus();
      loadPresets();
      loadProfiles();
      loadBuilderConfig();
      loadExtensionFiles();
      fetchFleet();
      fetchExtensionInfo();
      fetchRotationConfig();
    }

    (function () {
      const loginBtn = document.getElementById('loginSubmitBtn');
      const loginInput = document.getElementById('loginTokenInput');
      if (loginBtn) loginBtn.addEventListener('click', handleLoginSubmit);
      if (loginInput) loginInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') handleLoginSubmit(); });

      const tok = getAdminToken();
      if (tok) {
        const ti = document.getElementById('testTokenInput');
        if (ti) ti.value = tok;
        bootDashboard();
      } else {
        showLoginModal();
      }
    })();
  </script>
</body>
</html>`;
}
