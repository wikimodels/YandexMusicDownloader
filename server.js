const http = require('http');
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');
const FILE = path.join(LOG_DIR, 'ymd.log');

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/append')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        fs.appendFileSync(FILE, body + '\n');
        res.writeHead(204);
      } catch (e) {
        res.writeHead(500);
      }
      res.end();
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(8976, () => {
  console.log('YMD log server: http://127.0.0.1:8976 -> ' + FILE);
  console.log('Press Ctrl+C to stop');
});