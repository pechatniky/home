// Хранилище сессий в файле data/sessions.json — сессии переживают
// перезапуск сервера (раньше был MemoryStore: после рестарта все клиенты и
// админ «вылетали»). Данные держим в памяти (быстро) и сбрасываем на диск
// с задержкой (debounce) атомарной записью. Просроченные сессии чистятся.

const session = require('express-session');
const fs = require('fs');
const path = require('path');

class FileSessionStore extends session.Store {
  constructor({ file, ttlMs = 1000 * 60 * 60 * 24 * 30 }) {
    super();
    this.file = file;
    this.ttlMs = ttlMs;
    this.sesiones = new Map(); // sid -> { data, exp }
    this.timer = null;
    this.sucio = false;
    this.escribiendo = false;
    this._cargar();
    this._limpiador = setInterval(() => this._limpiar(), 10 * 60 * 1000);
    this._limpiador.unref();
  }

  _cargar() {
    try {
      const crudo = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      const ahora = Date.now();
      Object.entries(crudo).forEach(([sid, s]) => {
        if (s && s.exp > ahora && s.data) this.sesiones.set(sid, s);
      });
    } catch (_) { /* primer arranque o archivo dañado: empezamos vacío */ }
  }

  _limpiar() {
    const ahora = Date.now();
    let cambio = false;
    for (const [sid, s] of this.sesiones) {
      if (s.exp <= ahora) { this.sesiones.delete(sid); cambio = true; }
    }
    if (cambio) this._programar();
  }

  _programar() {
    this.sucio = true;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 1500);
    this.timer.unref();
  }

  // Escritura atómica (tmp + rename). Síncrona a propósito en flush final
  // (al apagar) y asíncrona en el uso normal.
  flush(sincrono = false) {
    if (!this.sucio) return;
    if (this.escribiendo && !sincrono) { this._programar(); return; }
    this.sucio = false;
    const obj = {};
    for (const [sid, s] of this.sesiones) obj[sid] = s;
    const texto = JSON.stringify(obj);
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      if (sincrono) {
        fs.writeFileSync(tmp, texto);
        fs.renameSync(tmp, this.file);
      } else {
        this.escribiendo = true;
        fs.writeFile(tmp, texto, (err) => {
          if (err) { this.escribiendo = false; this.sucio = true; return; }
          fs.rename(tmp, this.file, () => { this.escribiendo = false; });
        });
      }
    } catch (err) {
      console.error('No se pudo guardar sessions.json:', err.message);
    }
  }

  _exp(sess) {
    const cookieExp = sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : 0;
    return cookieExp || Date.now() + this.ttlMs;
  }

  get(sid, cb) {
    const s = this.sesiones.get(sid);
    if (!s) return cb(null, null);
    if (s.exp <= Date.now()) { this.sesiones.delete(sid); return cb(null, null); }
    cb(null, JSON.parse(JSON.stringify(s.data)));
  }

  set(sid, sess, cb) {
    this.sesiones.set(sid, { data: sess, exp: this._exp(sess) });
    this._programar();
    if (cb) cb(null);
  }

  destroy(sid, cb) {
    this.sesiones.delete(sid);
    this._programar();
    if (cb) cb(null);
  }

  touch(sid, sess, cb) {
    const s = this.sesiones.get(sid);
    if (s) { s.exp = this._exp(sess); s.data = sess; this._programar(); }
    if (cb) cb(null);
  }
}

module.exports = FileSessionStore;
