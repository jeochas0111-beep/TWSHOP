'use strict';

const fs = require('fs');
const path = require('path');
const { z } = require('zod');

/**
 * Generic API-to-MCP bridge engine.
 * Reads a JSON config file and auto-generates MCP tools and resources.
 *
 * Config format: see twodrapes.json for an example.
 */
class ApiMcpEngine {
  constructor(client, configPath, extraClients) {
    this.client = client;
    this.extraClients = extraClients || {};
    this.config = typeof configPath === 'string'
      ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      : configPath;
  }

  _getClient(method) {
    if (method.startsWith('SHOPIFY_')) return this.extraClients.shopify || this.client;
    return this.client;
  }

  registerTools(server) {
    const jsonResult = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
    const errResult = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });
    const fileResult = (result) => {
      if (result._file) {
        if (result.contentType && result.contentType.includes('text/')) {
          return { content: [{ type: 'text', text: result.buffer.toString('utf-8') }] };
        }
        return { content: [{ type: 'text', text: `File: ${result.filename}\nContent-Type: ${result.contentType}\nBase64: ${result.buffer.toString('base64')}` }] };
      }
      return jsonResult(result);
    };

    const typeMap = {
      string: z.string,
      number: z.number,
      boolean: z.boolean,
    };

    for (const group of this.config.groups || []) {
      for (const tool of group.tools || []) {
        const schema = this._buildSchema(tool.params);

        const method = tool.method || 'GET';
        const isFileOp = method === 'GET_FILE' || method === 'POST_FILE';
        const isShopify = method.startsWith('SHOPIFY_');
        const httpMethod = method.replace('_FILE', '').replace(/^SHOPIFY_/, '');

        server.tool(tool.name, tool.desc, schema, async (params) => {
          try {
            // Special handler for SHOPIFY_LOGIN
            if (method === 'SHOPIFY_LOGIN') {
              const { saveToken } = require('./shopify');
              const { shop_domain, access_token } = params;
              if (!shop_domain || !access_token) {
                return errResult('Both shop_domain and access_token are required');
              }
              saveToken(shop_domain, access_token);
              // Update the client's credentials
              const shopifyClient = this.extraClients.shopify;
              if (shopifyClient) {
                shopifyClient.setCredentials(shop_domain, access_token);
              }
              return jsonResult({ ok: true, message: `Shopify connected: ${shop_domain}`, saved_to: 'data/shopify-token.json' });
            }

            // Special handler for SHOPIFY_STATUS
            if (method === 'SHOPIFY_STATUS') {
              const shopifyClient = this.extraClients.shopify;
              if (!shopifyClient || !shopifyClient.isConfigured()) {
                return jsonResult({ configured: false, message: 'Shopify not configured. Run shopify_login first.' });
              }
              const result = await shopifyClient.get('/shop.json');
              if (result.shop) {
                return jsonResult({ configured: true, shop: result.shop.name, domain: result.shop.domain, plan: result.shop.plan_name });
              }
              return jsonResult({ configured: true, error: result.errors || 'Connection failed', shop_domain: shopifyClient.shopDomain });
            }

            const { _pathParams, bodyParams, queryParams } = this._splitParams(tool, params);
            const resolvedPath = this._resolvePath(tool.path, _pathParams);
            const client = this._getClient(method);

            if (isFileOp) {
              if (httpMethod === 'POST' && params.file_content) {
                const buffer = Buffer.from(params.file_content, 'base64');
                const ext = this._guessExt(params.filename, resolvedPath);
                const result = await client.uploadFile(resolvedPath, 'file', `upload${ext}`, buffer, 'application/octet-stream');
                return fileResult(result);
              }
              const result = await client.request(httpMethod, resolvedPath, { query: queryParams });
              return fileResult(result);
            }

            if (httpMethod === 'GET') {
              const result = await client.request('GET', resolvedPath, { query: queryParams });
              return jsonResult(result);
            }

            const result = await client.request(httpMethod, resolvedPath, { body: httpMethod !== 'DELETE' ? bodyParams : undefined });
            return jsonResult(result);
          } catch (e) {
            return errResult(e.message);
          }
        });
      }
    }
  }

  registerResources(server) {
    for (const res of this.config.resources || []) {
      server.resource(res.name, res.uri, async (uri) => {
        const data = await this.client.request('GET', res.path);
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2)
          }]
        };
      });
    }
  }

  _buildSchema(paramsDef) {
    if (!paramsDef || Object.keys(paramsDef).length === 0) return {};

    const shape = {};
    for (const [key, def] of Object.entries(paramsDef)) {
      let field = this._makeZodField(def);
      if (def.optional) field = field.optional();
      if (def.nullable) field = field.nullable();
      shape[key] = field;
    }
    return shape;
  }

  _makeZodField(def) {
    const desc = def.desc || '';
    switch (def.type) {
      case 'string': return desc ? z.string().describe(desc) : z.string();
      case 'number': return desc ? z.number().describe(desc) : z.number();
      case 'boolean': return desc ? z.boolean().describe(desc) : z.boolean();
      case 'object': {
        const field = desc ? z.object({}).describe(desc) : z.object({});
        return field;
      }
      case 'array': {
        let itemType;
        if (def.items) {
          itemType = def.items.type === 'object' ? z.object({}) : this._makeZodField(def.items);
        } else {
          itemType = z.unknown();
        }
        const field = desc ? z.array(itemType).describe(desc) : z.array(itemType);
        return field;
      }
      default: return desc ? z.unknown().describe(desc) : z.unknown();
    }
  }

  _splitParams(tool, params) {
    const _pathParams = {};
    const bodyParams = {};
    const queryParams = {};

    const pathParams = (tool.path.match(/\{(\w+)\}/g) || []).map(m => m.slice(1, -1));
    for (const [k, v] of Object.entries(params)) {
      if (pathParams.includes(k)) {
        _pathParams[k] = v;
      } else if (tool.method === 'GET' || tool.method === 'GET_FILE' || tool.method === 'SHOPIFY_GET') {
        queryParams[k] = v;
      } else {
        bodyParams[k] = v;
      }
    }
    return { _pathParams, bodyParams, queryParams };
  }

  _resolvePath(pathTemplate, params) {
    return pathTemplate.replace(/\{(\w+)\}/g, (_, key) => {
      return encodeURIComponent(params[key] ?? '');
    });
  }

  _guessExt(filename, urlPath) {
    if (filename) {
      const ext = path.extname(filename);
      if (ext) return ext;
    }
    if (urlPath.includes('.xlsx')) return '.xlsx';
    if (urlPath.includes('.csv')) return '.csv';
    if (urlPath.includes('.json')) return '.json';
    return '.bin';
  }
}

function loadEngine(client, configPath, extraClients) {
  return new ApiMcpEngine(client, configPath, extraClients);
}

module.exports = { ApiMcpEngine, loadEngine };
