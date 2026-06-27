'use strict';

const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.join(__dirname, '../../data/shopify-token.json');

class ShopifyClient {
  constructor(shopDomain, accessToken, apiVersion) {
    this.shopDomain = shopDomain;
    this.accessToken = accessToken;
    this.apiVersion = apiVersion || '2024-10';
    this.baseUrl = `https://${shopDomain}/admin/api/${this.apiVersion}`;
  }

  setCredentials(shopDomain, accessToken) {
    this.shopDomain = shopDomain;
    this.accessToken = accessToken;
    this.baseUrl = `https://${shopDomain}/admin/api/${this.apiVersion}`;
  }

  _headers() {
    return {
      'X-Shopify-Access-Token': this.accessToken,
      'Content-Type': 'application/json'
    };
  }

  isConfigured() {
    return !!(this.shopDomain && this.accessToken);
  }

  async request(method, path, { body, query } = {}) {
    if (!this.isConfigured()) {
      return { ok: false, error: 'Shopify not configured. Run shopify_login first.' };
    }

    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
      }
      const qs = params.toString();
      if (qs) url += '?' + qs;
    }

    const opts = { method, headers: this._headers() };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(url, opts);
    } catch (err) {
      return { ok: false, error: `Network error: ${err.message}` };
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After') || '2';
      return { ok: false, error: `Rate limited. Retry after ${retryAfter}s`, retryAfter: parseInt(retryAfter) };
    }

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (!res.ok) {
        return { ok: false, status: res.status, errors: data.errors || data };
      }
      return data;
    } catch {
      return { ok: false, status: res.status, _text: text };
    }
  }

  async get(path, query) { return this.request('GET', path, { query }); }
  async post(path, body) { return this.request('POST', path, { body }); }
  async put(path, body) { return this.request('PUT', path, { body }); }
  async del(path) { return this.request('DELETE', path); }
}

function loadStoredToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
      if (data.shopDomain && data.accessToken) {
        return data;
      }
    }
  } catch {}
  return null;
}

function saveToken(shopDomain, accessToken) {
  const dir = path.dirname(TOKEN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({
    shopDomain,
    accessToken,
    savedAt: new Date().toISOString()
  }, null, 2));
}

function createShopifyClient() {
  // Priority: env vars > stored token file
  let shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  let accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2024-10';

  if (!shopDomain || !accessToken) {
    const stored = loadStoredToken();
    if (stored) {
      shopDomain = stored.shopDomain;
      accessToken = stored.accessToken;
      console.error(`[MCP] Loaded Shopify token from ${TOKEN_FILE}`);
    }
  }

  if (!shopDomain || !accessToken) return null;
  return new ShopifyClient(shopDomain, accessToken, apiVersion);
}

module.exports = { ShopifyClient, createShopifyClient, loadStoredToken, saveToken };
