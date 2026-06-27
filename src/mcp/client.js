'use strict';

class TwodrapesClient {
  constructor(baseUrl, channel) {
    this.baseUrl = (baseUrl || 'http://localhost:8080').replace(/\/$/, '');
    this.channel = channel || 'shopify';
    this.token = null;
    this.user = null;
  }

  setToken(token) {
    this.token = token;
  }

  async login(username, password) {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Login failed');
    this.token = data.token;
    this.user = data.user;
    return data;
  }

  _headers(extra) {
    const h = { 'X-Twodrapes-App': this.channel, ...extra };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  async request(method, path, { body, query, retries = 1 } = {}) {
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
      }
      const qs = params.toString();
      if (qs) url += '?' + qs;
    }

    const headers = this._headers({ 'Content-Type': 'application/json' });
    const opts = { method, headers };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(url, opts);
    } catch (err) {
      return { ok: false, error: `Network error: ${err.message}` };
    }

    if (res.status === 401 && retries > 0 && process.env.TWODRAPES_USER) {
      try {
        await this.login(process.env.TWODRAPES_USER, process.env.TWODRAPES_PASSWORD);
        return this.request(method, path, { body, query, retries: retries - 1 });
      } catch {
        return { ok: false, error: 'Re-authentication failed' };
      }
    }

    const ct = res.headers.get('content-type') || '';

    if (ct.includes('application/vnd.openxmlformats') ||
        ct.includes('application/octet-stream') ||
        ct.includes('image/') ||
        ct.includes('text/csv')) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const disposition = res.headers.get('content-disposition') || '';
      const filenameMatch = disposition.match(/filename="?([^";\n]+)"?/);
      const filename = filenameMatch ? filenameMatch[1] : 'download';
      return { _file: true, buffer, contentType: ct, filename };
    }

    const text = await res.text();
    try { return JSON.parse(text); } catch { return { _text: text }; }
  }

  async uploadFile(path, fieldName, filename, buffer, mimeType) {
    const boundary = '----MCPBoundary' + Date.now();
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([Buffer.from(header), buffer, Buffer.from(footer)]);

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this._headers({ 'Content-Type': `multipart/form-data; boundary=${boundary}` }),
      body
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { _text: text }; }
  }
}

module.exports = { TwodrapesClient };
