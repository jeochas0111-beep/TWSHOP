(function () {
  const CHANNEL_LABELS = {
    management: '管理端',
    shopify: '独立站',
    amazon: '亚马逊',
    production: '生产端'
  };
  const APP_LABELS = {
    shopify: '独立站运营端',
    amazon: '亚马逊运营端',
    management: '管理端',
    production: '生产端'
  };
  const APP_PATHS = {
    shopify: '/ops/shopify',
    management: '/admin',
    amazon: '/ops/amazon',
    production: '/production'
  };

  function appContext() {
    return window.TwodrapesAppContext || {};
  }

  function portalOrigin() {
    return appContext().portalOrigin || '';
  }

  function loginUrl() {
    const context = appContext();
    return context.loginUrl || `${portalOrigin()}${context.loginPath || '/login'}`;
  }

  function appUrl(app) {
    const path = APP_PATHS[app] || '/';
    return `${portalOrigin()}${path}`;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"'`]/g, (match) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
      '`': '&#96;'
    }[match]));
  }

  function readUser() {
    try {
      return JSON.parse(localStorage.getItem('twodrapes_user') || 'null');
    } catch {
      return null;
    }
  }

  function writeUser(user) {
    localStorage.setItem('twodrapes_user', JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem('twodrapes_token');
    localStorage.removeItem('twodrapes_user');
  }

  function redirectToLogin() {
    if (location.pathname !== '/login' && location.pathname !== '/login.html') {
      window.location.href = loginUrl();
    }
  }

  function logout() {
    closeUserMenu();
    clearSession();
    redirectToLogin();
  }

  async function request(url, options = {}) {
    const token = localStorage.getItem('twodrapes_token');
    const context = appContext();
    const headers = { ...(options.headers || {}) };
    if (context.app) headers['X-Twodrapes-App'] = context.app;
    if (context.channel) headers['X-Twodrapes-Channel'] = context.channel;
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      clearSession();
      redirectToLogin();
      throw new Error('未授权');
    }
    return { ok: res.ok, status: res.status, data };
  }

  function initialsFor(user) {
    const base = String(user?.display_name || user?.username || 'U').trim();
    return base.slice(0, 2).toUpperCase();
  }

  function channelText(channel, role) {
    if (role === 'admin') return '全平台';
    return CHANNEL_LABELS[channel] || '-';
  }

  function appText(app) {
    return APP_LABELS[app] || APP_LABELS.shopify;
  }

  function appPathText(app) {
    const path = APP_PATHS[app] || '/';
    return `${appText(app)} ${path}`;
  }

  function buildChannelAccessItems(channels, currentApp) {
    if (currentApp !== 'management') return [];
    return channels.map((channel) => ({
      app: channel,
      label: APP_LABELS[channel],
      path: APP_PATHS[channel]
    }));
  }

  function renderUserPanel(user, currentApp, channels) {
    const panel = $('userMenuPanel');
    const label = $('userMenuLabel');
    const subLabel = $('userMenuSubLabel');
    const avatar = $('userMenuAvatar');
    if (!panel || !label || !subLabel || !avatar) return;

    const accessItems = user?.role === 'admin' ? buildChannelAccessItems(channels, currentApp) : [];
    const currentAppName = appContext().app || currentApp;
    label.textContent = user?.display_name || user?.username || '用户';
    subLabel.textContent = user?.role === 'admin' ? '平台管理员' : appText(currentApp);
    avatar.textContent = initialsFor(user);

    panel.innerHTML = `
      <div class="user-menu-header">
        <div class="user-menu-avatar">${esc(initialsFor(user))}</div>
        <div class="user-menu-meta">
          <strong>${esc(user?.display_name || user?.username || '用户')}</strong>
          <span>${esc(user?.username || '')}</span>
        </div>
      </div>
      <div class="user-menu-info">
        <span><b>角色</b>${esc(user?.role === 'admin' ? '管理员' : '运营')}</span>
        <span><b>渠道</b>${esc(channelText(user?.channel, user?.role))}</span>
        <span><b>当前端</b>${esc(appText(currentApp))}</span>
      </div>
      ${accessItems.length ? `
      <div class="user-menu-section">
        <div class="user-menu-section-title">快速查看运营端</div>
        <div class="user-menu-action-group">
          ${accessItems.map((item) => `
            <button class="user-menu-item ${String(item.app) === String(currentAppName) ? 'active' : ''}" type="button" data-switch-app="${esc(item.app)}">
              <span>${esc(item.label)}</span>
              <small>${esc(item.path)}</small>
            </button>
          `).join('')}
        </div>
      </div>` : ''}
      <div class="user-menu-section">
        <button class="user-menu-item" type="button" data-user-action="profile">个人信息</button>
        <button class="user-menu-item danger" type="button" data-user-action="logout">退出登录</button>
      </div>
    `;
  }

  function closeUserMenu() {
    $('userMenuPanel')?.classList.add('hidden');
    $('userMenuBtn')?.setAttribute('aria-expanded', 'false');
  }

  function openUserMenu() {
    $('userMenuPanel')?.classList.remove('hidden');
    $('userMenuBtn')?.setAttribute('aria-expanded', 'true');
  }

  function bindUserMenu(options, state) {
    const btn = $('userMenuBtn');
    const panel = $('userMenuPanel');
    if (!btn || !panel || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';

    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (panel.classList.contains('hidden')) openUserMenu();
      else closeUserMenu();
    });

    panel.addEventListener('click', async (event) => {
      const actionBtn = event.target.closest('[data-user-action]');
      const switchBtn = event.target.closest('[data-switch-app]');
      if (switchBtn) {
        const targetApp = switchBtn.dataset.switchApp;
        closeUserMenu();
        if (!targetApp || targetApp === (appContext().app || '')) return;
        window.location.href = appUrl(targetApp);
        return;
      }
      if (!actionBtn) return;
      const action = actionBtn.dataset.userAction;
      if (action === 'logout') {
        logout();
        return;
      }
      if (action === 'profile') {
        closeUserMenu();
        await openProfileModal(options, state);
      }
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.user-menu-wrap')) closeUserMenu();
      if (!event.target.closest('.modal-panel') && event.target.closest('.modal-backdrop')) {
        event.target.closest('.modal')?.classList.add('hidden');
      }
    });
  }

  function closeProfileModal() {
    $('profileModal')?.classList.add('hidden');
    $('profilePasswordForm')?.reset();
  }

  function fillProfileForm(user, currentApp) {
    $('profileIdentityName').textContent = user.display_name || user.username;
    $('profileIdentityMeta').textContent = `${user.username} · ${user.role === 'admin' ? '管理员' : '运营'}`;
    $('profileDisplayNameInput').value = user.display_name || user.username || '';
    $('profileUsernameInput').value = user.username || '';
    $('profileRoleInput').value = user.role === 'admin' ? '管理员' : '运营';
    $('profileChannelInput').value = channelText(user.channel, user.role);
    $('profilePortInput').value = appPathText(appContext().app || currentApp);
  }

  function defaultRouteForUser(user) {
    if (!user) return loginUrl();
    if (user.role === 'admin') return appUrl('management');
    if (user.channel === 'amazon') return appUrl('amazon');
    return appUrl('shopify');
  }

  async function refreshMe(options, state) {
    const result = await request('/api/auth/me');
    if (!result.ok || result.data.ok === false || !result.data.user) {
      throw new Error(result.data.error || '无法读取个人信息');
    }
    state.user = result.data.user;
    writeUser(state.user);
    renderUserPanel(state.user, options.currentApp, state.channels);
    fillProfileForm(state.user, options.currentApp);
    return state.user;
  }

  async function openProfileModal(options, state) {
    const modal = $('profileModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    try {
      await refreshMe(options, state);
    } catch (error) {
      options.toast?.(error.message || '读取个人信息失败', 'bad');
    }
  }

  function bindProfileModal(options, state) {
    if ($('profileModal')?.dataset.bound === '1') return;
    $('profileModal').dataset.bound = '1';

    $('closeProfileModal')?.addEventListener('click', closeProfileModal);
    $('closeProfileBtn')?.addEventListener('click', closeProfileModal);

    $('profileSaveBtn')?.addEventListener('click', async () => {
      const displayName = String($('profileDisplayNameInput')?.value || '').trim();
      const username = String($('profileUsernameInput')?.value || '').trim();
      if (!displayName) {
        options.toast?.('请输入显示名', 'bad');
        return;
      }
      const btn = $('profileSaveBtn');
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = '保存中...';
      try {
        const result = await request('/api/auth/me', {
          method: 'PUT',
          body: JSON.stringify({ display_name: displayName, username })
        });
        if (!result.ok || result.data.ok === false) {
          throw new Error(result.data.error || '保存失败');
        }
        state.user = result.data.user;
        writeUser(state.user);
        if (result.data.token) {
          localStorage.setItem('twodrapes_token', result.data.token);
        }
        renderUserPanel(state.user, options.currentApp, state.channels);
        fillProfileForm(state.user, options.currentApp);
        options.toast?.('个人信息已更新');
      } catch (error) {
        options.toast?.(error.message || '保存失败', 'bad');
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });

    $('profilePasswordBtn')?.addEventListener('click', async () => {
      const currentPassword = $('profileCurrentPassword')?.value || '';
      const newPassword = $('profileNewPassword')?.value || '';
      if (!currentPassword || !newPassword) {
        options.toast?.('请输入当前密码和新密码', 'bad');
        return;
      }
      const btn = $('profilePasswordBtn');
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = '更新中...';
      try {
        const result = await request('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword, newPassword })
        });
        if (!result.ok || result.data.ok === false) {
          throw new Error(result.data.error || '密码更新失败');
        }
        $('profilePasswordForm')?.reset();
        options.toast?.('密码已更新');
      } catch (error) {
        options.toast?.(error.message || '密码更新失败', 'bad');
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  }

  async function init(options = {}) {
    const state = {
      channels: [],
      user: null
    };
    const token = localStorage.getItem('twodrapes_token');
    if (!token) {
      clearSession();
      redirectToLogin();
      return false;
    }

    try {
      const verifyResult = await request('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ token, channel: options.verifyChannel })
      });
      if (!verifyResult.ok || verifyResult.data.ok === false || !verifyResult.data.user) {
        if (verifyResult.status === 403 && verifyResult.data?.redirectPath) {
          window.location.href = `${portalOrigin()}${verifyResult.data.redirectPath}`;
          return false;
        }
        clearSession();
        redirectToLogin();
        return false;
      }

      state.user = verifyResult.data.user;
      if (typeof options.allowAccess === 'function' && !options.allowAccess(state.user)) {
        clearSession();
        options.toast?.(options.accessDeniedMessage || '当前账号无法访问此端', 'bad');
        redirectToLogin();
        return false;
      }

      writeUser(state.user);

      const channelsResult = await request('/api/auth/channels');
      if (channelsResult.ok && channelsResult.data.ok) {
        state.channels = Array.isArray(channelsResult.data.channels) ? channelsResult.data.channels : [];
      }

      renderUserPanel(state.user, options.currentApp, state.channels);
      bindUserMenu(options, state);
      bindProfileModal(options, state);
      return true;
    } catch (error) {
      clearSession();
      redirectToLogin();
      return false;
    }
  }

  window.TwodrapesAuthUI = {
    init,
    logout,
    clearSession,
    redirectToLogin,
    appText,
    channelText,
    APP_PATHS,
    defaultRouteForUser
  };
})();
