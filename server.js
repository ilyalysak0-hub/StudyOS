const http = require("http");

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const path = new URL(req.url, "http://localhost").pathname;

  const routes = {
    "/api/status": {
      app: "StudyOS",
      status: "online",
      message: "Сервер работает!"
    },
    "/api/schedule": {
      schedule: [],
      message: "Расписание пока не подключено"
    },
    "/api/homework": {
      homework: [],
      message: "Домашние задания пока не подключены"
    },
    "/api/grades": {
      grades: [],
      message: "Оценки пока не подключены"
    }
  };

  if (path === "/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.writeHead(200);
    res.end(`
      <!DOCTYPE html>
      <html lang="ru">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>StudyOS Server</title>
      </head>
      <body style="font-family:Arial;background:#10131b;color:white;padding:30px">
        <h1 style="color:#9b8cff">StudyOS 🚀</h1>
        <p>Сервер работает!</p>
        <p><a style="color:#b4a7ff" href="/api/status">Проверить API</a></p>
      </body>
      </html>
    `);
    return;
  }

  if (routes[path]) {
    res.writeHead(200);
    res.end(JSON.stringify(routes[path]));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Маршрут не найден" }));
});

const port = process.env.PORT || 3000;

server.listen(port, "0.0.0.0", () => {
  console.log("StudyOS server started on port " + port);
});
