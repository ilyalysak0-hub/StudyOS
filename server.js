const http = require("http");

let meshClient = null;
let meshStatus = "not_configured";

async function connectMesh() {
  const login = process.env.MESH_LOGIN;
  const password = process.env.MESH_PASSWORD;

  if (!login || !password) {
    meshStatus = "not_configured";
    return;
  }

  try {
    const Dnevnik = require("dnevnik-mos-ru-api");

    const auth = new Dnevnik.PuppeteerAuthenticator(
      login,
      password,
      { headless: true }
    );

    await auth.init();
    await auth.authenticate();

    meshClient = new Dnevnik.DnevnikClient(auth);
    meshStatus = "connected";
  } catch (error) {
    meshStatus = "error";
    console.error("Не удалось подключить МЭШ:", error.message);
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const path = new URL(req.url, "http://localhost").pathname;

  if (path === "/api/status") {
    res.writeHead(200);
    res.end(JSON.stringify({
      app: "StudyOS",
      status: "online",
      mesh: meshStatus
    }));
    return;
  }

  if (path === "/api/mesh/status") {
    res.writeHead(200);
    res.end(JSON.stringify({
      connected: Boolean(meshClient),
      status: meshStatus
    }));
    return;
  }

  if (["/api/schedule", "/api/homework", "/api/grades"].includes(path)) {
    if (!meshClient) {
      res.writeHead(503);
      res.end(JSON.stringify({
        error: "МЭШ пока не подключена",
        status: meshStatus
      }));
      return;
    }

    try {
      const Dnevnik = require("dnevnik-mos-ru-api");
      const { DateTime } = require("luxon");
      const from = DateTime.now().minus({ days: 7 });

      let data;

      if (path === "/api/schedule") {
        data = await meshClient.getSchedule(from);
      } else if (path === "/api/homework") {
        data = await meshClient.getHomework(from);
      } else {
        data = await meshClient.getMarks(from);
      }

      res.writeHead(200);
      res.end(JSON.stringify({ data }));
    } catch (error) {
      console.error("Ошибка получения данных МЭШ:", error.message);
      res.writeHead(502);
      res.end(JSON.stringify({
        error: "Не удалось получить данные из МЭШ"
      }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Маршрут не найден" }));
});

const port = process.env.PORT || 3000;

server.listen(port, "0.0.0.0", () => {
  console.log("StudyOS server started on port " + port);
  connectMesh();
});
