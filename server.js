const http = require("http");
const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const puppeteer = require("puppeteer");

let meshStatus = "checking";
let meshError = null;
let meshClient = null;

const diagnostics = {
  dns: "not_checked",
  http: "not_checked",
  chrome: "not_checked",
  details: {}
};

function logErrorDetails(label, error) {
  console.error(label);

  let current = error;
  let level = 0;

  while (current && level < 5) {
    console.error(`Уровень ${level}:`, {
      name: current.name,
      message: current.message,
      code: current.code,
      errno: current.errno,
      syscall: current.syscall,
      hostname: current.hostname,
      address: current.address,
      port: current.port
    });

    current = current.cause;
    level++;
  }
}

async function checkDns() {
  console.log("=== Проверка DNS ===");

  try {
    const addresses = await dns.lookup("school.mos.ru", {
      all: true
    });

    diagnostics.dns = "success";
    diagnostics.details.dns = addresses;

    console.log("DNS работает. Адреса:", addresses);

    return true;
  } catch (error) {
    diagnostics.dns = "failed";
    diagnostics.details.dns = {
      message: error.message,
      code: error.code
    };

    logErrorDetails("Ошибка DNS:", error);

    return false;
  }
}

async function checkHttpAccess() {
  console.log("=== Проверка HTTP-доступа к МЭШ ===");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch("https://school.mos.ru", {
      method: "GET",
      redirect: "follow",
      signal: controller.signal
    });

    diagnostics.http = "success";
    diagnostics.details.http = {
      status: response.status,
      url: response.url
    };

    console.log("HTTP-запрос успешен");
    console.log("HTTP-статус:", response.status);
    console.log("Итоговый URL:", response.url);

    await response.body?.cancel();

    return true;
  } catch (error) {
    diagnostics.http = "failed";
    diagnostics.details.http = {
      name: error.name,
      message: error.message,
      cause: error.cause
        ? {
            name: error.cause.name,
            message: error.cause.message,
            code: error.cause.code,
            errno: error.cause.errno,
            syscall: error.cause.syscall,
            hostname: error.cause.hostname,
            address: error.cause.address,
            port: error.cause.port
          }
        : null
    };

    logErrorDetails("Подробная ошибка HTTP:", error);

    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkChromeAccess(browser) {
  console.log("=== Проверка доступа через Chrome ===");

  let page;

  try {
    page = await browser.newPage();

    page.setDefaultNavigationTimeout(15000);

    page.on("requestfailed", request => {
      console.error("Неудачный запрос Chrome:", {
        url: request.url(),
        error: request.failure()?.errorText
      });
    });

    page.on("request", request => {
      if (
        request.url().startsWith("https://school.mos.ru") ||
        request.url().startsWith("http://school.mos.ru")
      ) {
        console.log("Запрос Chrome:", request.url());
      }
    });

    const response = await page.goto("https://school.mos.ru", {
      waitUntil: "domcontentloaded",
      timeout: 15000
    });

    diagnostics.chrome = "success";
    diagnostics.details.chrome = {
      url: page.url(),
      status: response?.status() ?? null
    };

    console.log("Chrome открыл сайт");
    console.log("URL:", page.url());
    console.log("HTTP-статус:", response?.status() ?? "нет ответа");

    return true;
  } catch (error) {
    diagnostics.chrome = "failed";
    diagnostics.details.chrome = {
      name: error.name,
      message: error.message
    };

    logErrorDetails("Подробная ошибка Chrome:", error);

    return false;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (error) {
        console.error("Не удалось закрыть страницу:", error.message);
      }
    }
  }
}

async function connectMesh() {
  const login = process.env.MESH_LOGIN;
  const password = process.env.MESH_PASSWORD;

  console.log("=== Диагностика МЭШ ===");
  console.log("Логин задан:", Boolean(login?.trim()));
  console.log("Пароль задан:", Boolean(password));

  meshStatus = "checking";
  meshError = null;

  if (!login?.trim() || !password) {
    meshStatus = "not_configured";
    meshError = "Не заданы MESH_LOGIN или MESH_PASSWORD";

    console.error(meshError);
    return;
  }

  const dnsWorks = await checkDns();
  const httpWorks = await checkHttpAccess();

  let browser;

  try {
    const chromePath = puppeteer.executablePath();

    if (!fs.existsSync(chromePath)) {
      throw new Error("Chrome не найден: " + chromePath);
    }

    console.log("Chrome найден:", chromePath);

    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled"
      ]
    });

    console.log("Chrome запущен");

    const chromeWorks = await checkChromeAccess(browser);

    console.log("=== ИТОГ ДИАГНОСТИКИ ===");
    console.log("DNS:", diagnostics.dns);
    console.log("HTTP:", diagnostics.http);
    console.log("Chrome:", diagnostics.chrome);

    if (!httpWorks && !chromeWorks) {
      throw new Error(
        "HTTP и Chrome не смогли открыть school.mos.ru. " +
        "Смотри подробные сетевые ошибки в Runtime Logs. " +
        "DNS: " + (dnsWorks ? "работает" : "не работает")
      );
    }

    if (!chromeWorks) {
      throw new Error(
        "HTTP-запрос работает, но Chrome не смог открыть сайт МЭШ."
      );
    }

    console.log("=== Запуск авторизации МЭШ ===");

    const Dnevnik = require("dnevnik-mos-ru-api");

    const auth = new Dnevnik.PuppeteerAuthenticator(
      login,
      password,
      {
        browser,
        headless: true,
        sandbox: false
      }
    );

    const result = await Promise.race([
      auth.authenticate(),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error("Авторизация МЭШ не завершилась за 45 секунд")
          );
        }, 45000);
      })
    ]);

    if (!result) {
      throw new Error(
        "Библиотека не подтвердила успешную авторизацию."
      );
    }

    meshClient = new Dnevnik.DnevnikClient(auth);

    meshStatus = "connected";
    meshError = null;

    console.log("МЭШ подключена успешно");

  } catch (error) {
    meshStatus = "error";
    meshError = error?.message || "Неизвестная ошибка";

    logErrorDetails("Ошибка подключения МЭШ:", error);

  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log("Chrome закрыт");
      } catch (error) {
        console.error("Ошибка закрытия Chrome:", error.message);
      }
    }
  }
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/status") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8"
    });

    return res.end(JSON.stringify({
      status: "online",
      mesh: meshStatus
    }));
  }

  if (url.pathname === "/api/mesh/status") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8"
    });

    return res.end(JSON.stringify({
      status: meshStatus,
      connected: meshStatus === "connected",
      error: meshError,
      diagnostics
    }));
  }

  if (
    url.pathname === "/api/schedule" ||
    url.pathname === "/api/homework" ||
    url.pathname === "/api/grades"
  ) {
    res.writeHead(503, {
      "Content-Type": "application/json; charset=utf-8"
    });

    return res.end(JSON.stringify({
      error: "Получение данных пока недоступно",
      meshStatus
    }));
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    const indexPath = path.join(__dirname, "index.html");

    if (!fs.existsSync(indexPath)) {
      res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8"
      });

      return res.end("Файл index.html не найден");
    }

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });

    const stream = fs.createReadStream(indexPath);

    stream.on("error", error => {
      console.error("Ошибка чтения index.html:", error.message);

      if (!res.headersSent) {
        res.writeHead(500, {
          "Content-Type": "text/plain; charset=utf-8"
        });
      }

      res.end("Ошибка чтения главной страницы");
    });

    return stream.pipe(res);
  }

  res.writeHead(404, {
    "Content-Type": "application/json; charset=utf-8"
  });

  res.end(JSON.stringify({
    error: "Not found"
  }));
});

const PORT = process.env.PORT || 10000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`StudyOS server started on port ${PORT}`);

  connectMesh().catch(error => {
    meshStatus = "error";
    meshError = error?.message || "Неизвестная ошибка";

    logErrorDetails("Критическая ошибка:", error);
  });
});
