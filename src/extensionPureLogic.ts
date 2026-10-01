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
  proxyServer: string,
  proxyProtocol?: string
): string {
  if (!pacText || typeof pacText !== "string") return pacText;
  if (!Array.isArray(userRules) || userRules.length === 0) return pacText;

  const activeRules = userRules.filter((r) => r && r.enabled && r.pattern && typeof r.pattern === "string" && r.pattern.trim());
  if (activeRules.length === 0) return pacText;

  // Detect proxy protocol if specified or if pacText contains SOCKS5/HTTPS directives
  let proto = (proxyProtocol || "").toLowerCase();
  if (!proto) {
    if (pacText.includes("SOCKS5 ")) proto = "socks5";
    else if (pacText.includes("HTTPS ")) proto = "https";
  }

  // Find the proxy directive already in use in pacText (e.g. 'PROXY host:port; DIRECT' or 'SOCKS5 host:port; DIRECT')
  const pacDirMatch = pacText.match(/return\s+"((?:SOCKS5|HTTPS|PROXY)\s+(?!127\.0\.0\.1:0)[^"]+)";/i);
  let defaultProxyDirective = pacDirMatch ? pacDirMatch[1] : "";

  if (!defaultProxyDirective && proxyServer) {
    if (proto === "socks5") {
      defaultProxyDirective = `SOCKS5 ${proxyServer}; DIRECT`;
    } else if (proto === "https") {
      defaultProxyDirective = `HTTPS ${proxyServer}; DIRECT`;
    } else {
      defaultProxyDirective = `PROXY ${proxyServer}`;
    }
  } else if (!defaultProxyDirective) {
    defaultProxyDirective = "DIRECT";
  }

  let ruleLines = "  // === USER OVERRIDES BEGIN ===\n";
  ruleLines += "  host = (\"\" + host).toLowerCase();\n";
  for (const r of activeRules) {
    let rawPattern = r.pattern.trim().toLowerCase();
    // Strip protocol if user pasted full URL (e.g. https://site.com/abc -> site.com)
    if (rawPattern.includes("://")) {
      try {
        rawPattern = new URL(rawPattern).hostname.toLowerCase();
      } catch {
        rawPattern = rawPattern.replace(/^[a-z]+:\/\//i, "").split("/")[0].split(":")[0];
      }
    } else if (rawPattern.includes("/")) {
      rawPattern = rawPattern.split("/")[0].trim();
    }
    if (rawPattern.includes(":") && !rawPattern.includes("]")) {
      rawPattern = rawPattern.split(":")[0].trim();
    }
    // Sanitize pattern: strip newlines, quotes and backslashes
    let cleanPattern = rawPattern.replace(/["\\\r\n]/g, "");
    if (!cleanPattern) continue;

    // Support IDN / Punycode conversion if non-ASCII characters are present so Chrome 7-bit ASCII compliance is never violated
    let hasNonAscii = false;
    for (let j = 0; j < cleanPattern.length; j++) {
      if (cleanPattern.charCodeAt(j) > 127) {
        hasNonAscii = true;
        break;
      }
    }
    if (hasNonAscii) {
      try {
        if (cleanPattern.startsWith("*.")) {
          const ascii = new URL("http://" + cleanPattern.slice(2)).hostname;
          cleanPattern = "*." + ascii;
        } else if (cleanPattern.startsWith(".")) {
          const ascii = new URL("http://" + cleanPattern.slice(1)).hostname;
          cleanPattern = "." + ascii;
        } else if (!cleanPattern.includes("*") && !cleanPattern.includes("/")) {
          cleanPattern = new URL("http://" + cleanPattern).hostname;
        } else {
          cleanPattern = cleanPattern
            .split(".")
            .map((part) => {
              let partNonAscii = false;
              for (let k = 0; k < part.length; k++) {
                if (part.charCodeAt(k) > 127) {
                  partNonAscii = true;
                  break;
                }
              }
              if (partNonAscii && !part.includes("*")) {
                try {
                  const h = new URL("http://" + part + ".test").hostname;
                  return h.endsWith(".test") ? h.slice(0, -5) : h;
                } catch {
                  return part;
                }
              }
              return part;
            })
            .join(".");
        }
      } catch {}

      let asciiOnly = "";
      for (let m = 0; m < cleanPattern.length; m++) {
        if (cleanPattern.charCodeAt(m) <= 127) {
          asciiOnly += cleanPattern[m];
        }
      }
      cleanPattern = asciiOnly;
      if (!cleanPattern) continue;
    }

    const actionUpper = String(r.action || "PROXY").toUpperCase();
    let actionStr = defaultProxyDirective;
    if (actionUpper === "DIRECT") {
      actionStr = "DIRECT";
    } else if (actionUpper === "BLOCK") {
      actionStr = "PROXY 127.0.0.1:0";
    } else {
      actionStr = defaultProxyDirective;
    }

    let condition = "";
    if (cleanPattern.startsWith("*.")) {
      condition = `shExpMatch(host, "${cleanPattern}") || host === "${cleanPattern.slice(2)}"`;
    } else if (cleanPattern.startsWith(".")) {
      condition = `shExpMatch(host, "*.${cleanPattern.slice(1)}") || host === "${cleanPattern.slice(1)}"`;
    } else if (!cleanPattern.includes("*") && !cleanPattern.includes("/")) {
      condition = `host === "${cleanPattern}" || dnsDomainIs(host, ".${cleanPattern}") || shExpMatch(host, "*.${cleanPattern}")`;
    } else {
      condition = `shExpMatch(host, "${cleanPattern}")`;
    }

    ruleLines += `  if (${condition}) { return "${actionStr}"; }\n`;
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
