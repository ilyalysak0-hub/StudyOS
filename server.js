const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

let meshStatus = "not_configured";
let meshError = null;
let meshClient = null;

async function connectMesh() {
  const login = process.env.MESH_LOGIN;
  const password = process.env.MESH_PASSWORD;

  console.log("=== Проверка МЭШ ===");
  console.log("Логин задан:", Boolean(login));
  console.log("Пароль задан:", Boolean(password));

  if (!login?.trim() || !password) {
    meshStatus = "not_configured";
    meshError = "Не заданы переменные MESH_LOGIN или MESH_PASSWORD";
    console.error(meshError);
    return;
  }

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

    const page = await browser.newPage();

    page.setDefaultNavigationTimeout(20000);

    try {
      console.log("Проверяем доступность school.mos.ru");

      const response = await page.goto("https://school.mos.ru", {
        waitUntil: "domcontentloaded",
        timeout: 20000
      });

      console.log("URL:", page.url());
      console.log("HTTP-статус:", response?.status() ?? "нет ответа");
      console.log("Сайт МЭШ открылся");

    } catch (error) {
      console.error("Не удалось открыть сайт МЭШ:", error.message);
      throw error;

    } finally {
      await page.close();
    }

    console.log("Передаём браузер библиотеке авторизации");

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

    const result = await auth.authenticate();

    if (!result) {
      throw new Error("Авторизация не подтверждена библиотекой");
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
    console.error("Критическая ошибка:", meshError);
  });
});
