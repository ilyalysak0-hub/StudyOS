const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

let meshClient = null;
let meshStatus = "not_configured";
let meshError = null;

async function connectMesh() {
  const login = process.env.MESH_LOGIN;
  const password = process.env.MESH_PASSWORD;

  if (!login || !password) {
    meshStatus = "not_configured";
    console.log("МЭШ: логин или пароль не настроен");
    return;
  }

  let auth;

  try {
    const chromePath = puppeteer.executablePath();

    console.log("Chrome path:", chromePath);
    console.log("Chrome exists:", fs.existsSync(chromePath));

    if (!fs.existsSync(chromePath)) {
      throw new Error("Chrome не найден: " + chromePath);
    }

    const Dnevnik = require("dnevnik-mos-ru-api");

    auth = new Dnevnik.PuppeteerAuthenticator(
      login,
      password,
      {
        headless: true,
        sandbox: false,
        browserArgs: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage"
        ]
      }
    );

    console.log("Запускаем Chrome...");
    await auth.init();

    console.log("Chrome запущен. Начинаем авторизацию...");
    console.log("Переходим к диагностике авторизации.");

    await auth.authenticate();

    meshClient = new Dnevnik.DnevnikClient(auth);
    meshStatus = "connected";
    meshError = null;

    console.log("МЭШ успешно подключена");
  } catch (error) {
    meshStatus = "error";
    meshError = error.message;

    console.error("Ошибка подключения МЭШ:", error.message);

    try {
      const browser = auth?._browser;

      if (browser) {
        const pages = await browser.pages();

        for (const page of pages) {
          console.log("URL после ошибки:", page.url());

          try {
            console.log(
              "Заголовок страницы:",
              await page.title()
            );
          } catch (e) {
            console.log("Не удалось получить заголовок:", e.message);
          }
        }
      }
    } catch (debugError) {
      console.error("Ошибка диагностики:", debugError.message);
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

  res.end(JSON.stringify({ error: "Not found" }));
});

const PORT = process.env.PORT || 10000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`StudyOS server started on port ${PORT}`);

  connectMesh().catch(error => {
    console.error("Критическая ошибка МЭШ:", error.message);
  });
});
