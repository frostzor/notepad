// api/share.js
// Продакшен-обработчик share-ссылок с TTL на базе KV (Upstash / Redis)

const crypto = require("crypto");

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// Обёртка над Upstash REST API
async function upstash(commandArray) {
  if (!KV_URL || !KV_TOKEN) {
    throw new Error("KV_REST_API_URL или KV_REST_API_TOKEN не заданы в env");
  }

  const res = await fetch(KV_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${KV_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commandArray), // пример: ["SET","key","value","EX",600]
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `Upstash error (${res.status})`);
  }
  return data.result;
}

// Получить значение по ключу
async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) {
    throw new Error("KV_REST_API_URL или KV_REST_API_TOKEN не заданы в env");
  }

  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${KV_TOKEN}`,
    },
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `Upstash error (${res.status})`);
  }
  return data.result; // может быть null, если ключ протух
}

module.exports = async (req, res) => {
  // Общие заголовки
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  // Preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  // Проверка env
  if (!KV_URL || !KV_TOKEN) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        error:
          "KV не настроен. Подключи Redis/KV в Vercel и задай KV_REST_API_URL / KV_REST_API_TOKEN.",
      })
    );
    return;
  }

  // Разбираем URL и query-параметры
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST") {
    // ----- СОЗДАНИЕ SHARE-ССЫЛКИ -----
    try {
      let rawBody = "";
      await new Promise((resolve, reject) => {
        req.on("data", (chunk) => {
          rawBody += chunk;
          if (rawBody.length > 5 * 1024 * 1024) {
            // 5 МБ на всякий случай
            req.destroy();
            reject(new Error("Body too large"));
          }
        });
        req.on("end", resolve);
        req.on("error", reject);
      });

      let body = {};
      try {
        body = rawBody ? JSON.parse(rawBody) : {};
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Неверный JSON в теле запроса" }));
        return;
      }

      const { content, ttlMinutes } = body;

      if (typeof content !== "string" || !content.trim()) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Поле 'content' обязательно" }));
        return;
      }

      let ttl = Number(ttlMinutes) || 60; // по умолчанию 60 минут
      if (ttl < 1) ttl = 1;
      if (ttl > 60 * 24 * 7) ttl = 60 * 24 * 7; // максимум 7 дней

      // Генерируем id и ключ
      const id = crypto.randomBytes(8).toString("hex");
      const key = `note:${id}`;

      // Сохраняем HTML-строку в KV с EX=ttl*60
      await upstash(["SET", key, content, "EX", ttl * 60]);

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          id,
          ttlMinutes: ttl,
        })
      );
    } catch (error) {
      console.error("POST /api/share error:", error);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "Server error" }));
    }
    return;
  }

  if (req.method === "GET") {
    // ----- ПОЛУЧЕНИЕ ТЕКСТА ПО ID -----
    try {
      const id = url.searchParams.get("id");
      if (!id) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Параметр 'id' обязателен" }));
        return;
      }

      const key = `note:${id}`;
      const content = await kvGet(key);

      if (content == null) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Ссылка не найдена или истекла" }));
        return;
      }

      res.statusCode = 200;
      res.end(JSON.stringify({ id, content }));
    } catch (error) {
      console.error("GET /api/share error:", error);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "Server error" }));
    }
    return;
  }

  // Всё остальное – не разрешаем
  res.statusCode = 405;
  res.end(JSON.stringify({ error: "Method not allowed" }));
};
