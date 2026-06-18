window.api = {
  async json(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const token = localStorage.getItem('twodrapes_token');
    const headers = { ...(options.headers || {}) };
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
      localStorage.removeItem('twodrapes_token');
      localStorage.removeItem('twodrapes_user');
      if (location.pathname !== '/login.html') window.location.href = '/login.html';
      throw new Error('未授权');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data.ok === false && !options.allowFalse)) throw new Error(data.error || `${res.status} ${res.statusText}`);
    return data;
  },

  async upload(url, file, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const token = localStorage.getItem('twodrapes_token');
    const form = new FormData();
    form.append('file', file);
    const headers = {};
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
      localStorage.removeItem('twodrapes_token');
      localStorage.removeItem('twodrapes_user');
      if (location.pathname !== '/login.html') window.location.href = '/login.html';
      throw new Error('未授权');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data.ok === false && !options.allowFalse)) throw new Error(data.error || `${res.status} ${res.statusText}`);
    return data;
  }
};
