function twodrapesAppHeaders(existing = {}) {
  const context = window.TwodrapesAppContext || {};
  const headers = { ...existing };
  if (context.app) headers['X-Twodrapes-App'] = context.app;
  if (context.channel) headers['X-Twodrapes-Channel'] = context.channel;
  return headers;
}

function twodrapesLoginUrl() {
  const context = window.TwodrapesAppContext || {};
  return context.loginUrl || `${context.portalOrigin || ''}${context.loginPath || '/login'}` || '/login';
}

function redirectToUnifiedLogin() {
  const loginUrl = twodrapesLoginUrl();
  const currentPath = `${location.pathname}${location.hash || ''}`;
  if (loginUrl && currentPath !== '/login' && currentPath !== '/login.html') {
    window.location.href = loginUrl;
  }
}

async function parseApiJson(res, options = {}) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.ok === false && !options.allowFalse)) {
    throw new Error(data.error || `${res.status} ${res.statusText}`);
  }
  return data;
}

function clearAuthAndRedirect() {
  localStorage.removeItem('twodrapes_token');
  localStorage.removeItem('twodrapes_user');
  redirectToUnifiedLogin();
}

window.api = {
  async json(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const token = localStorage.getItem('twodrapes_token');
    const headers = twodrapesAppHeaders(options.headers || {});
    if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(url, { ...options, headers, signal: controller.signal });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('请求超时，请稍后重试');
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 401) {
      clearAuthAndRedirect();
      throw new Error('未授权');
    }
    return parseApiJson(res, options);
  },

  async upload(url, file, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const token = localStorage.getItem('twodrapes_token');
    const form = new FormData();
    form.append('file', file);
    const headers = twodrapesAppHeaders();
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: form, signal: controller.signal });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('请求超时，请稍后重试');
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 401) {
      clearAuthAndRedirect();
      throw new Error('未授权');
    }
    return parseApiJson(res, options);
  },

  async download(url, fallbackName = 'download.csv', options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const token = localStorage.getItem('twodrapes_token');
    const headers = twodrapesAppHeaders(options.headers || {});
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(url, { ...options, headers, signal: controller.signal });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('请求超时，请稍后重试');
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 401) {
      clearAuthAndRedirect();
      throw new Error('未授权');
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `${res.status} ${res.statusText}`);
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const utfName = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const plainName = disposition.match(/filename="?([^"]+)"?/i);
    const filename = decodeURIComponent(utfName?.[1] || plainName?.[1] || fallbackName);
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return { filename };
  }
};
