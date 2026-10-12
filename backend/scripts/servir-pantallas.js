// Sirve las pantallas ya compiladas (frontend "npm run build") de la versión
// publicada, sin herramientas de desarrollo. Solo usa Node.
// Uso: node servir-pantallas.js <carpeta> <puerto>
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const carpeta = path.resolve(process.argv[2] || '.');
const puerto = Number(process.argv[3] || 5173);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

if (!fs.existsSync(path.join(carpeta, 'index.html'))) {
  console.error(`No están las pantallas en ${carpeta}. Vuelva a publicar.`);
  process.exit(1);
}

http
  .createServer((req, res) => {
    let ruta;
    try {
      ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    // Nunca se sale de la carpeta publicada.
    let archivo = path.join(carpeta, path.normalize(ruta));
    if (!archivo.startsWith(carpeta)) {
      res.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
      archivo = path.join(carpeta, 'index.html'); // la aplicación maneja sus pantallas
    }
    const ext = path.extname(archivo).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TIPOS[ext] || 'application/octet-stream',
      // index.html siempre fresco; los demás archivos llevan su versión en el nombre.
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    fs.createReadStream(archivo).pipe(res);
  })
  .listen(puerto, () => {
    console.log(`Pantallas de ${carpeta} en http://localhost:${puerto}`);
  });
