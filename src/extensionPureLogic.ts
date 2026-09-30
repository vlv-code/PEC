/**
 * Pure functions extracted from the Chrome MV3 background service worker
 * and popup logic, allowing direct unit testing in Node.js without Chrome APIs.
 */

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: any;
}

export function appendLog(
  buffer: LogEntry[],
  entry: { level: string; message: string; data?: any },
  maxLogs: number = 50
): LogEntry {
  const item: LogEntry = {
    timestamp: new Date().toISOString(),
    level: entry.level || "info",
    message: String(entry.message),
    data: entry.data !== undefined ? entry.data : null,
  };
  buffer.push(item);
  if (buffer.length > maxLogs) {
    buffer.shift();
  }
  return item;
}

export function pacRevisionOf(pacText: string): string {
  if (!pacText) return "unknown rev";
  const m = pacText.match(/Generated:\s*([^\s*]+)/i) || pacText.match(/Revision:\s*([^\s*]+)/i);
  return m ? m[1] : "unknown rev";
}

/**
 * Injects user-defined routing rules (PROXY or DIRECT) ahead of corporate PAC rules
 * inside FindProxyForURL(url, host).
 */
export function injectUserRulesIntoPac(
  pacText: string,
  userRules: Array<{ pattern: string; action: string; enabled: boolean }>,
  proxyServer: string
): string {
  if (!pacText || typeof pacText !== "string") return pacText;
  if (!Array.isArray(userRules) || userRules.length === 0) return pacText;

  const activeRules = userRules.filter((r) => r && r.enabled && r.pattern && typeof r.pattern === "string" && r.pattern.trim());
  if (activeRules.length === 0) return pacText;

  let ruleLines = "  // === USER OVERRIDES BEGIN ===\n";
  for (const r of activeRules) {
    const rawPattern = r.pattern.trim();
    // Sanitize pattern: strip newlines, quotes and backslashes
    const cleanPattern = rawPattern.replace(/["\\\r\n]/g, "");
    if (!cleanPattern) continue;

    const actionStr = r.action === "PROXY"
      ? (proxyServer ? `PROXY ${proxyServer}` : "DIRECT")
      : "DIRECT";

    ruleLines += `  if (shExpMatch(host, "${cleanPattern}")) { return "${actionStr}"; }\n`;
  }
  ruleLines += "  // === USER OVERRIDES END ===\n";

  const targetIdx = pacText.indexOf("function FindProxyForURL(url, host) {");
  if (targetIdx !== -1) {
    const insertPos = targetIdx + "function FindProxyForURL(url, host) {".length;
    return pacText.slice(0, insertPos) + "\n" + ruleLines + pacText.slice(insertPos);
  }
  const match = pacText.match(/function\s+FindProxyForURL\s*\([^)]*\)\s*\{/);
  if (match && typeof match.index === "number") {
    const insertPos = match.index + match[0].length;
    return pacText.slice(0, insertPos) + "\n" + ruleLines + pacText.slice(insertPos);
  }
  return pacText;
}

/**
 * Chrome's pacScript.data API strictly requires 7-bit ASCII code.
 * If pacText contains any non-ASCII characters (e.g. Cyrillic comments or IDN domains),
 * sanitize them to ASCII (Punycode domains, ASCII comments) to avoid Chrome throwing:
 * "Error: 'pacScript.data' supports only ASCII code(encode URLs in Punycode format)".
 */
export function sanitizePacScript(pacText: string): string | null {
  if (typeof pacText !== "string") return null;
  if (pacText.indexOf("FindProxyForURL") === -1) return null;

  let hasNonAscii = false;
  for (let i = 0; i < pacText.length; i++) {
    if (pacText.charCodeAt(i) > 127) {
      hasNonAscii = true;
      break;
    }
  }

  if (!hasNonAscii) {
    return pacText;
  }

  // 1. Strip non-ASCII from comments
  const lines = pacText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const commentIdx = lines[i].indexOf("//");
    if (commentIdx !== -1) {
      let cleanComment = "";
      for (let c = commentIdx; c < lines[i].length; c++) {
        if (lines[i].charCodeAt(c) <= 127) cleanComment += lines[i][c];
      }
      lines[i] = lines[i].slice(0, commentIdx) + cleanComment;
    }
  }
  let sanitized = lines.join("\n");

  // 2. Punycode-encode domain literals inside strings: "domain.рф" -> "xn--...
  sanitized = sanitized.replace(/"([^"]*)"/g, (match, content) => {
    let contentNonAscii = false;
    for (let j = 0; j < content.length; j++) {
      if (content.charCodeAt(j) > 127) {
        contentNonAscii = true;
        break;
      }
    }
    if (contentNonAscii) {
      try {
        const isWild = content.startsWith("*.");
        const isDot = !isWild && content.startsWith(".");
        const raw = isWild ? content.slice(2) : isDot ? content.slice(1) : content;
        const host = new URL("http://" + raw).hostname;
        return '"' + (isWild ? "*." + host : isDot ? "." + host : host) + '"';
      } catch {
        let clean = "";
        for (let k = 0; k < content.length; k++) {
          if (content.charCodeAt(k) <= 127) clean += content[k];
        }
        return '"' + clean + '"';
      }
    }
    return match;
  });

  // 3. Final pass: strip any remaining non-ASCII characters
  let finalClean = "";
  for (let m = 0; m < sanitized.length; m++) {
    if (sanitized.charCodeAt(m) <= 127) finalClean += sanitized[m];
  }

  if (finalClean.indexOf("FindProxyForURL") !== -1) {
    return finalClean;
  }
  return null;
}

export function computeDescriptiveMode(options: {
  mode: string;
  defaultPolicy?: string;
  bypassActive?: boolean;
  host?: string;
  port?: number;
}): { label: string; tag: string; tooltip: string } {
  if (options.bypassActive) {
    return {
      label: "Обход (Bypass)",
      tag: "BYPASS",
      tooltip: "Прокси временно отключен пользователем. Весь трафик идет напрямую.",
    };
  }

  if (options.mode === "pac_script") {
    const isTunnel = options.defaultPolicy === "proxy";
    if (isTunnel) {
      return {
        label: "PAC (туннель)",
        tag: "PAC",
        tooltip: "Полный туннель: весь трафик туннелируется через прокси, исключения идут напрямую.",
      };
    }
    return {
      label: "PAC (селективный)",
      tag: "PAC",
      tooltip: "Выборочный режим: трафик идет напрямую, через прокси идут только совпавшие корпоративные правила.",
    };
  }

  if (options.mode === "fixed_servers") {
    const ep = options.host && options.port ? ` (${options.host}:${options.port})` : "";
    return {
      label: "Fixed" + ep,
      tag: "FIXED",
      tooltip: "Фиксированный прокси-сервер.",
    };
  }

  return {
    label: "Прямой (DIRECT)",
    tag: "DIRECT",
    tooltip: "Прямое подключение без прокси.",
  };
}
