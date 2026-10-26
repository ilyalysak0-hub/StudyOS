const http = require("http");
const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const net = require("net");
const tls = require("tls");
const puppeteer = require("puppeteer");

let meshStatus = "checking";
let meshError = null;
let meshClient = null;

const diagnostics = {
  dns: "not_checked",
  tcp: "not_checked",
  tls: "not_checked",
  http: "not_checked",
  controlHttp: "not_checked",
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

function checkTcpAddress(address, port = 443, timeoutMs = 6000) {
  return new Promise(resolve => {
    const socket = net.createConnection({
      host: address,
      port
    });

    let finished = false;

    function finish(result) {
      if (finished) return;
      finished = true;

      socket.destroy();
      resolve({
        address,
        port,
        ...result
      });
    }

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      finish({
        success: true,
        message: "TCP-соединение установлено"
      });
    });

    socket.once("timeout", () => {
      finish({
        success: false,
        error: "TCP_TIMEOUT"
      });
    });

    socket.once("error", error => {
      finish({
        success: false,
        error: error.code || error.message
      });
    });
  });
}

function checkTlsAddress(address, timeoutMs = 6000) {
  return new Promise(resolve => {
    const socket = tls.connect({
      host: address,
      port: 443,
      servername: "school.mos.ru",
      rejectUnauthorized: true
    });

    let finished = false;

    function finish(result) {
      if (finished) return;
      finished = true;

      socket.destroy();

      resolve({
        address,
        ...result
      });
    }

    socket.setTimeout(timeoutMs);

    socket.once("secureConnect", () => {
      finish({
        success: true,
        message: "TLS-соединение установлено",
        protocol: socket.getProtocol(),
        authorized: socket.authorized,
        authorizationError: socket.authorizationError || null
      });
    });

    socket.once("timeout", () => {
      finish({
        success: false,
        error: "TLS_TIMEOUT"
      });
    });

    socket.once("error", error => {
      finish({
        success: false,
        error: error.code || error.message
      });
    });
  });
}

async function checkDns() {
  console.log("=== 1. ПРОВЕРКА DNS ===");

  try {
    const addresses = await dns.lookup("school.mos.ru", {
      all: true
    });

    diagnostics.dns = "success";
    diagnostics.details.dns = addresses;

    console.log("DNS работает:", addresses);

    return addresses;
  } catch (error) {
    diagnostics.dns = "failed";

    diagnostics.details.dns = {
      message: error.message,
      code: error.code
    };

    logErrorDetails("Ошибка DNS:", error);

    return [];
  }
}

async function checkTcpAccess(addresses) {
  console.log("=== 2. ПРОВЕРКА TCP ПОРТА 443 ===");

  if (!addresses.length) {
    diagnostics.tcp = "skipped";
    diagnostics.details.tcp = "Нет IP-адресов для проверки";
    return false;
  }

  const results = await Promise.all(
    addresses.map(item =>
      checkTcpAddress(item.address)
    )
  );

  diagnostics.details.tcp = results;

  const success = results.some(result => result.success);

  diagnostics.tcp = success ? "success" : "failed";

  for (const result of results) {
    console.log("TCP:", result);
  }

  return success;
}

async function checkTlsAccess(addresses) {
  console.log("=== 3. ПРОВЕРКА TLS ===");

  if (!addresses.length) {
    diagnostics.tls = "skipped";
    diagnostics.details.tls = "Нет IP-адресов для проверки";
    return false;
  }

  const results = await Promise.all(
    addresses.map(item =>
      checkTlsAddress(item.address)
    )
  );

  diagnostics.details.tls = results;

  const success = results.some(result => result.success);

  diagnostics.tls = success ? "success" : "failed";

  for (const result of results) {
    console.log("TLS:", result);
  }

  return success;
}

async function checkHttpAccess() {
  console.log("=== 4. ПРОВЕРКА HTTPS МЭШ ===");

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 10000);

  try {
    const response = await fetch("https://school.mos.ru/", {
      method: "GET",
      redirect: "follow",
      signal: controller.signal
    });

    diagnostics.http = "success";

    diagnostics.details.http = {
      status: response.status,
      url: response.url
    };

    console.log("HTTPS МЭШ:", {
      status: response.status,
      url: response.url
    });

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
            code: error.cause.code
          }
        : null
    };

    logErrorDetails("Ошибка HTTPS МЭШ:", error);

    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkControlHttp() {
  console.log("=== 5. КОНТРОЛЬНЫЙ HTTPS-ЗАПРОС ===");

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 8000);

  try {
    const response = await fetch("https://example.com/", {
      method: "GET",
      signal: controller.signal,
      redirect: "follow"
    });

    diagnostics.controlHttp = "success";

    diagnostics.details.controlHttp = {
      status: response.status,
      url: response.url
    };

    console.log("Контрольный HTTPS работает:", {
      status: response.status,
      url: response.url
    });

    await response.body?.cancel();

    return true;
  } catch (error) {
    diagnostics.controlHttp = "failed";

    diagnostics.details.controlHttp = {
      name: error.name,
      message: error.message,
      cause: error.cause
        ? {
            name: error.cause.name,
            message: error.cause.message,
            code: error.cause.code
          }
        : null
    };

    logErrorDetails("Ошибка контрольного HTTPS:", error);

    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkChromeAccess(browser) {
  console.log("=== 6. ПРОВЕРКА CHROME ===");

  let page;

  try {
    page = await browser.newPage();

    page.setDefaultNavigationTimeout(15000);

    page.on("requestfailed", request => {
      console.error("Запрос Chrome не удался:", {
        url: request.url(),
        error: request.failure()?.errorText
      });
    });

    const response = await page.goto(
      "https://school.mos.ru/",
      {
        waitUntil: "domcontentloaded",
        timeout: 15000
      }
    );

    diagnostics.chrome = "success";

    diagnostics.details.chrome = {
      url: page.url(),
      status: response?.status() ?? null
    };

    console.log("Chrome открыл МЭШ:", {
      url: page.url(),
      status: response?.status() ?? null
    });

    return true;
  } catch (error) {
    diagnostics.chrome = "failed";

    diagnostics.details.chrome = {
      name: error.name,
      message: error.message
    };

    logErrorDetails("Ошибка Chrome:", error);

    return false;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (error) {
        console.error(
          "Ошибка закрытия страницы:",
          error.message
        );
      }
    }
  }
}

async function authenticateWithTimeout(auth, timeoutMs = 45000) {
  let timer;

  try {
    return await Promise.race([
      auth.authenticate(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `Авторизация не завершилась за ${timeoutMs / 1000} секунд`
            )
          );
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function connectMesh() {
  const login = process.env.MESH_LOGIN;
  const password = process.env.MESH_PASSWORD;

  meshStatus = "checking";
  meshError = null;
  meshClient = null;

  console.log("==================================");
  console.log("ЗАПУСК ДИАГНОСТИКИ STUDYOS");
  console.log("==================================");

  console.log("Логин задан:", Boolean(login?.trim()));
  console.log("Пароль задан:", Boolean(password));

  if (!login?.trim() || !password) {
    meshStatus = "not_configured";
    meshError = "Не заданы MESH_LOGIN или MESH_PASSWORD";

    console.error(meshError);
    return;
  }

  let browser;

  try {
    const addresses = await checkDns();

    if (!addresses.length) {
      throw new Error(
        "Не удалось получить IP-адреса school.mos.ru"
      );
    }

    await checkTcpAccess(addresses);

    await checkTlsAccess(addresses);

    const httpWorks = await checkHttpAccess();

    await checkControlHttp();

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

    console.log("==================================");
    console.log("ИТОГ ДИАГНОСТИКИ");
    console.log("DNS:", diagnostics.dns);
    console.log("TCP:", diagnostics.tcp);
    console.log("TLS:", diagnostics.tls);
    console.log("МЭШ HTTPS:", diagnostics.http);
    console.log("Контрольный HTTPS:", diagnostics.controlHttp);
    console.log("Chrome:", diagnostics.chrome);
    console.log("==================================");

    if (!httpWorks && !chromeWorks) {
      throw new Error(
        "Не удалось открыть МЭШ через HTTPS и Chrome. " +
        "Смотри результаты TCP, TLS и контрольного HTTPS."
      );
    }

    if (!chromeWorks) {
      throw new Error(
        "HTTPS-запрос и Chrome работают по-разному. " +
        "Авторизация не запускалась."
      );
    }

    console.log("=== ЗАПУСК АВТОРИЗАЦИИ МЭШ ===");

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

    const result = await authenticateWithTimeout(auth);

    if (!result) {
      throw new Error(
        "Библиотека не подтвердила успешную авторизацию"
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
        console.error(
          "Ошибка закрытия Chrome:",
          error.message
        );
      }
    }
  }
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

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

  if (
    url.pathname === "/" ||
    url.pathname === "/index.html"
  ) {
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
      console.error(
        "Ошибка чтения index.html:",
        error.message
      );

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

  return res.end(JSON.stringify({
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
