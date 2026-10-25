const http = require("http");

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.url === "/api/status") {
    res.writeHead(200);
    res.end(JSON.stringify({
      app: "StudyOS",
      status: "online",
      message: "Сервер работает!"
    }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Не найдено" }));
});

const port = process.env.PORT || 3000;

server.listen(port, "0.0.0.0", () => {
  console.log("StudyOS server started on port " + port);
});
