'use strict';

function registerResources(server, client) {
  const defs = [
    { name: 'health', uri: 'twodrapes://health', path: '/api/health', desc: 'Server health status' },
    { name: 'globals', uri: 'twodrapes://globals', path: '/api/globals', desc: 'All global configuration values' },
    { name: 'fabrics', uri: 'twodrapes://fabrics', path: '/api/fabrics', desc: 'All fabric definitions' },
    { name: 'linings', uri: 'twodrapes://linings', path: '/api/linings', desc: 'All lining definitions' },
    { name: 'labor-rules', uri: 'twodrapes://labor-rules', path: '/api/labor-rules', desc: 'Labor cost rules' },
    { name: 'memory-rules', uri: 'twodrapes://memory-rules', path: '/api/memory-rules', desc: 'Memory training cost rules' },
    { name: 'tax-rates', uri: 'twodrapes://tax-rates', path: '/api/tax-rates', desc: 'US state tax rates' },
    { name: 'products', uri: 'twodrapes://products', path: '/api/products', desc: 'All products for current channel' },
  ];

  for (const def of defs) {
    server.resource(def.name, def.uri, async (uri) => {
      const data = await client.request('GET', def.path);
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

module.exports = { registerResources };
