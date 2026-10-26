const http = require("http");
const fs = require("fs");
const path = require("path");
const { setTimeout: delay } = require("timers/promises");
const puppeteer = require("puppeteer");

let meshStatus = "checking";
let meshError = null;
let meshClient = null;
let diagnostics = {
  http: "not_checked",
  chrome: "not_checked"
};

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

    console.log("HTTP-доступ работает");
    console.log("HTTP-статус:", response.status);
    console.log("Итоговый URL:", response.url);

    await response.body?.cancel();

    return true;
  } catch (error) {
    diagnostics.http = "failed";

    console.error(
      "Ошибка HTTP-доступа:",
      error.name === "AbortError" ? "Тайм-аут 12 секунд" : error.message
    );

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

    page.setDefaultNavigationTimeout(12000);

    const response = await page.goto("https://school.mos.ru", {
      waitUntil: "domcontentloaded",
      timeout: 12000
    });

    diagnostics.chrome = "success";

    console.log("Chrome открыл сайт МЭШ");
    console.log("URL:", page.url());
    console.log("HTTP-статус:", response?.status() ?? "нет ответа");

    return true;
  } catch (error) {
    diagnostics.chrome = "failed";

    console.error(
      "Ошибка Chrome:",
      error.name === "TimeoutError"
        ? "Тайм-аут 12 секунд"
        : error.message
    );

    return false;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {}
    }
  }
}

async function connectMesh() {
  const login = process.env.MESH_LOGIN;
  const password = process.env.MESH_PASSWORD;

  console.log("=== Запуск диагностики МЭШ ===");
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

    console.log("=== Результаты диагностики ===");
    console.log("HTTP:", diagnostics.http);
    console.log("Chrome:", diagnostics.chrome);

    if (!httpWorks && !chromeWorks) {
      throw new Error(
        "МЭШ недоступна и через HTTP, и через Chrome. " +
        "Проверьте сетевой доступ Render к school.mos.ru."
      );
    }

    if (!chromeWorks) {
      throw new Error(
        "HTTP-запрос к МЭШ работает, но Chrome не смог открыть сайт."
      );
    }

    console.log("Пробуем авторизацию через библиотеку МЭШ");

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

    const authTimeout = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("Авторизация МЭШ не завершилась за 45 секунд"));
      }, 45000);
    });

    const result = await Promise.race([
      auth.authenticate(),
      authTimeout
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

    console.error("Ошибка МЭШ:", meshError);

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

    return fs.createReadStream(indexPath).pipe(res);
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
    console.error("Критическая ошибка:", meshError);
  });
});
