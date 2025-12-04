// api/share.js
// ТЕСТОВАЯ версия — проверим деплой и API

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    res.status(200).json({ message: "Backend is working! 🚀" });
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
};
