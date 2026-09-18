// background.js — MV3 service worker
//
// Отвечает на Basic-Auth challenge от Xray HTTP-инбаунда (details.isProxy === true).
// Креды не персистятся: только in-memory кэш процесса, TTL ниже. При рестарте
// service worker'а (Chrome выгружает его через ~30с простоя) кэш теряется —
// это осознанный компромисс в пользу "не хранить пароль дольше, чем нужно",
// см. обсуждение в PLAN.md.

const DEFAULT_CREDS_URL = "https://mini-server.ic.local/creds";
const TTL_MS = 5 * 60 * 1000; // подстроить под частоту ротации на сервере (rotate.py)
const MAX_AUTH_ATTEMPTS = 2;   // защита от бесконечного цикла 407 при невалидных credentials
const FETCH_TIMEOUT_MS = 5000; // таймаут запроса к мини-серверу

let cache = null; // { user, pass, fetchedAt }
let credsPromise = null; // активный промис запроса для дедупликации параллельных вызовов
const seenRequests = new Map(); // requestId -> число попыток за время жизни воркера

function isValidCredsUrl(url) {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

async function getManagedConfig() {
  try {
    const { extToken, credsUrl } = await chrome.storage.managed.get([
      "extToken",
      "credsUrl",
    ]);
    const validUrl = isValidCredsUrl(credsUrl) ? credsUrl : DEFAULT_CREDS_URL;
    return { token: extToken || null, url: validUrl };
  } catch (e) {
    console.error("managed storage read failed", e);
    return { token: null, url: DEFAULT_CREDS_URL };
  }
}

async function fetchCreds(forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && cache && now - cache.fetchedAt < TTL_MS) {
    return cache;
  }

  // Если уже выполняется сетевой запрос за кредами, переиспользуем его
  if (!forceRefresh && credsPromise) {
    return credsPromise;
  }

  if (forceRefresh) {
    cache = null;
  }

  credsPromise = (async () => {
    try {
      const { token, url } = await getManagedConfig();
      const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
      const res = await fetch(url, {
        headers: token ? { "X-Ext-Token": token } : {},
        signal,
      });
      if (!res.ok) {
        throw new Error(`creds fetch failed: ${res.status}`);
      }
      const data = await res.json();
      if (!data.user || !data.pass) {
        throw new Error("invalid creds response format");
      }
      cache = { user: data.user, pass: data.pass, fetchedAt: Date.now() };
      return cache;
    } finally {
      credsPromise = null;
    }
  })();

  return credsPromise;
}

chrome.webRequest.onAuthRequired.addListener(
  (details, asyncCallback) => {
    if (!details.isProxy) {
      // не наш случай — не встреваем в обычные сайтовые Basic-Auth формы
      asyncCallback({});
      return;
    }

    if (seenRequests.size > 1000) {
      seenRequests.clear();
    }
    const attempts = (seenRequests.get(details.requestId) || 0) + 1;
    seenRequests.set(details.requestId, attempts);

    // Защита от бесконечного цикла: если сервер отклонил даже обновленные креды,
    // прерываем запрос вместо зависания страницы
    if (attempts > MAX_AUTH_ATTEMPTS) {
      console.warn(`auth attempts exceeded (${attempts}) for requestId=${details.requestId}`);
      seenRequests.delete(details.requestId);
      asyncCallback({ cancel: true });
      return;
    }

    // повторный вызов (attempts > 1) означает, что прошлые creds браузер отклонил (407) —
    // форсируем обновление, сбрасывая кэш
    fetchCreds(attempts > 1)
      .then(({ user, pass }) => {
        asyncCallback({ authCredentials: { username: user, password: pass } });
      })
      .catch((e) => {
        console.error("auth failed", e);
        seenRequests.delete(details.requestId);
        asyncCallback({}); // отдать браузеру дефолтное поведение
      });
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);

// Очистка записей seenRequests по завершении запроса для предотвращения утечки памяти
chrome.webRequest.onCompleted.addListener(
  (details) => {
    seenRequests.delete(details.requestId);
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    seenRequests.delete(details.requestId);
  },
  { urls: ["<all_urls>"] }
);
