(function () {
  'use strict';

  var APP_PATHS = {
    management: '/admin',
    shopify: '/ops/shopify',
    amazon: '/ops/amazon'
  };
  var PATH_CHANNELS = {
    '/admin': 'management',
    '/ops/shopify': 'shopify',
    '/ops/amazon': 'amazon'
  };
  var PORT_CHANNELS = {
    '8080': 'shopify',
    '8081': 'management',
    '8082': 'amazon'
  };

  function detectAppFromPath(pathname) {
    if (pathname === '/admin' || pathname.indexOf('/admin/') === 0) return 'management';
    if (pathname === '/ops/shopify' || pathname.indexOf('/ops/shopify/') === 0) return 'shopify';
    if (pathname === '/ops/amazon' || pathname.indexOf('/ops/amazon/') === 0) return 'amazon';
    if (pathname === '/' || pathname === '/login' || pathname === '/login.html') return 'login';
    return null;
  }

  function appPath(app) {
    return APP_PATHS[app] || '/';
  }

  var injected = window.__TWODRAPES_CONTEXT__ || {};
  var detectedApp = detectAppFromPath(location.pathname) || PORT_CHANNELS[String(location.port)] || 'management';
  var app = injected.app || detectedApp;
  var channel = Object.prototype.hasOwnProperty.call(injected, 'channel')
    ? injected.channel
    : (app === 'management' || app === 'login' ? null : PATH_CHANNELS[appPath(app)] || PORT_CHANNELS[String(location.port)] || 'shopify');
  var publicPort = String(injected.publicPort || '8080');
  var portalOrigin = injected.portalOrigin || (location.protocol + '//' + location.hostname + ':' + publicPort);
  var apiBase = injected.apiBase || location.origin;
  var basePath = injected.basePath || appPath(app);
  var loginPath = injected.loginPath || '/login';
  var loginUrl = portalOrigin + loginPath;
  var currentTheme = localStorage.getItem('twodrapes-theme');

  var context = {
    app: app,
    channel: channel,
    basePath: basePath,
    publicPort: publicPort,
    portalOrigin: portalOrigin,
    apiBase: apiBase,
    loginPath: loginPath,
    loginUrl: loginUrl,
    appPaths: APP_PATHS
  };

  document.documentElement.setAttribute('data-channel', channel || app || 'login');
  document.documentElement.setAttribute('data-app', app || 'login');

  if (currentTheme) {
    document.documentElement.setAttribute('data-theme', currentTheme);
  }

  window.TwodrapesAppContext = context;
  window.TwodrapesTheme = {
    channel: channel || 'management',
    app: app,
    context: context,
    toggleDark: function () {
      var root = document.documentElement;
      var isDark = root.getAttribute('data-theme') === 'dark';
      root.setAttribute('data-theme', isDark ? 'light' : 'dark');
      localStorage.setItem('twodrapes-theme', isDark ? 'light' : 'dark');
      return !isDark;
    },
    get: function () {
      return document.documentElement.getAttribute('data-theme') || 'light';
    },
    set: function (theme) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('twodrapes-theme', theme);
    }
  };
})();
