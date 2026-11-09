const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  try {
    res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.ttf':'font/ttf','.png':'image/png'})[path.extname(p)] || 'application/octet-stream');
    res.end(fs.readFileSync(p));
  } catch { res.statusCode = 404; res.end('Not found'); }
}).listen(4173, '127.0.0.1');
