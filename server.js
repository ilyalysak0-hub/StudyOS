const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

let meshClient = null;
let meshStatus = "not_configured";
let meshError = null;

async function connectMesh() {
  // Читаем переменные окружения
  const login = process.env.MESH_LOGIN;
  const password = process.env.MESH_PASSWORD;

  // Безопасная диагностика: секреты не выводим
  console.log("=== Проверка настроек МЭШ ===");
  console.log("MESH_LOGIN задан:", Boolean(login));
  console.log("MESH_PASSWORD задан:", Boolean(password));
  console.log("Длина логина:", login ? login.length : 0);
  console.log("Длина пароля:", password ? password.length : 0);

  if (!login?.trim() || !password) {
    meshStatus = "not_configured";
    meshError = "Не заданы MESH_LOGIN или MESH_PASSWORD в окружении сервера";
    console.error(meshError);
    return;
  }

  let browser = null;
  let auth = null;

  try {
    const chromePath = puppeteer.executablePath();

    console.log("Chrome path:", chromePath);
    console.log("Chrome существует:", fs.existsSync(chromePath));

    if (!fs.existsSync(chromePath)) {
      throw new Error("Chrome не найден по указанному пути");
    }

    const Dnevnik = require("dnevnik-mos-ru-api");

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

    // Проверяем доступность сайта МЭШ
    const testPage = await browser.newPage();

    try {
      console.log("Проверяем доступность school.mos.ru...");

      const response = await testPage.goto("https://school.mos.ru", {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      console.log("URL сайта МЭШ:", testPage.url());
      console.log("HTTP-статус:", response?.status());
      console.log("Заголовок страницы:", await testPage.title());
    } finally {
      await testPage.close();
    }

    console.log("Начинаем авторизацию МЭШ...");

    auth = new Dnevnik.PuppeteerAuthenticator(
      login,
      password,
      {
        browser,
        headless: true,
        sandbox: false
      }
    );

    const authenticated = await auth.authenticate();

    if (!authenticated) {
      throw new Error("Библиотека не подтвердила успешную авторизацию");
    }

    meshClient = new Dnevnik.DnevnikClient(auth);
    meshStatus = "connected";
    meshError = null;

    console.log("МЭШ успешно подключена");
  } catch (error) {
    meshStatus = "error";
    meshError = error?.message || "Неизвестная ошибка";

    console.error("Ошибка подключения МЭШ:", meshError);

    if (browser) {
      try {
        const pages = await browser.pages();

        for (const page of pages) {
          console.log("Диагностика URL:", page.url());

          try {
            console.log("Диагностика заголовка:", await page.title());
          } catch {}
        }
      } catch {}
    }
  } finally {
    // Не оставляем браузер работать после завершения попытки
    if (browser) {
      try {
        await browser.close();
        console.log("Chrome закрыт");
      } catch (error) {
        console.error("Не удалось закрыть Chrome:", error.message);
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
      error: meshError
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
    console.error("Критическая ошибка МЭШ:", meshError);
  });
});
