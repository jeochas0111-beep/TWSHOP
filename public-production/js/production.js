(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '`': '&#96;' }[m]));
  const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0;

  // ===== English-Chinese Mapping =====
  const COLOR_MAP = {
    'snow white': '雪白', 'natural': '本色', 'ivory': '象牙白',
    'light grey': '浅灰', 'dark grey': '深灰', 'black': '黑色',
    'beige': '米色', 'white': '白色', 'cream': '奶油色',
    'grey': '灰色', 'tan': '棕褐', 'navy': '藏蓝',
    'charcoal': '炭灰', 'sage': '鼠尾草绿', 'blush': ' blush粉',
    'dusty rose': '玫瑰粉', 'olive': '橄榄绿', 'rust': '铁锈红',
    'mustard': '芥末黄', 'burgundy': '酒红', 'forest': '森林绿',
    'slate': '石板灰', 'taupe': '灰褐', 'mauve': '淡紫',
    'coral': '珊瑚', 'teal': '青色', 'copper': '铜色',
  };

  const HEADER_STYLE_MAP = {
    'pinch pleat': '韩褶', '2x pinch pleat': '双层韩褶',
    'pinch pleat + curtain ring': '韩褶+打环',
    'pinch pleat (black rings)': '韩褶（黑环）',
    'pinch pleat (silver rings)': '韩褶（银环）',
    'pinch pleat (white rings)': '韩褶（白环）',
    '2x pinch pleat (black rings)': '双层韩褶（黑环）',
    '2x pinch pleat (silver rings)': '双层韩褶（银环）',
    'back tab': '暗袢', 'rod pocket': '穿杆', 'grommet': '打孔',
    'header tape': '顶部工艺带', 'eyelet': '鸡眼',
    'pleat': '褶皱', 'tab top': '挂耳',
  };

  const MEMORY_MAP = {
    'without memory training': '否', 'add memory training': '是',
    'no memory': '否', 'memory': '是',
  };

  const TIEBACK_MAP = {
    'no need': '否', 'need the matching tieback': '是',
    'yes need the matching tieback': '是', 'yes': '是', 'no': '否',
  };

  const LINING_MAP = {
    'unlined': '无衬里', 'lined': '有衬里',
    'blackout lining': '遮光衬', 'sheer lining': '纱衬',
  };

  function mapColor(en) { return COLOR_MAP[String(en).trim().toLowerCase()] || en; }
  function mapHeaderStyle(en) { return HEADER_STYLE_MAP[String(en).trim().toLowerCase()] || en; }
  function mapMemory(en) { return MEMORY_MAP[String(en).trim().toLowerCase()] || en; }
  function mapTieback(en) { return TIEBACK_MAP[String(en).trim().toLowerCase()] || en; }
  function mapLining(en) { return LINING_MAP[String(en).trim().toLowerCase()] || en; }

  function translateOption(key, value) {
    const k = String(key).trim().toLowerCase();
    if (k.includes('color') || k === 'colour') return mapColor(value);
    if (k.includes('header')) return mapHeaderStyle(value);
    if (k.includes('memory')) return mapMemory(value);
    if (k.includes('tieback')) return mapTieback(value);
    if (k.includes('lining')) return mapLining(value);
    return value;
  }

  // ===== API Helpers =====
  async function api(url, opts = {}) {
    const token = localStorage.getItem('production_token');
    const headers = { ...opts.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (opts.body && typeof opts.body === 'string') headers['Content-Type'] = 'application/json';
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401) { localStorage.removeItem('production_token'); location.reload(); throw new Error('未授权'); }
    const data = await res.json();
    if (!data.ok && data.error) throw new Error(data.error);
    return data;
  }

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 2500);
  }

  // ===== Auth =====
  async function login(username, password) {
    const data = await api('/api/auth/management/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    if (data.token) {
      localStorage.setItem('production_token', data.token);
      if (data.user) localStorage.setItem('production_user', JSON.stringify(data.user));
      return true;
    }
    throw new Error(data.error || '登录失败');
  }

  function checkAuth() {
    return !!localStorage.getItem('production_token');
  }

  function logout() {
    localStorage.removeItem('production_token');
    localStorage.removeItem('production_user');
    $('loginPage').classList.remove('hidden');
    $('appPage').classList.add('hidden');
  }

  // ===== Orders =====
  let allOrders = [];

  async function loadOrders() {
    try {
      const data = await api('/api/orders');
      allOrders = data.orders || data || [];
      renderOrders();
    } catch (e) {
      toast('加载订单失败: ' + e.message);
    }
  }

  function renderOrders() {
    const search = ($('searchInput')?.value || '').toLowerCase();
    const status = $('statusFilter')?.value || 'production';

    let filtered = allOrders;
    if (status !== 'all') {
      filtered = filtered.filter(o => o.status === status);
    }
    if (search) {
      filtered = filtered.filter(o =>
        (o.order_no || '').toLowerCase().includes(search) ||
        (o.customer_name || '').toLowerCase().includes(search)
      );
    }

    const grid = $('orderGrid');
    if (!filtered.length) {
      grid.innerHTML = '<div class="empty-state">暂无生产订单</div>';
      return;
    }

    grid.innerHTML = filtered.map(order => {
      const items = order.items || [];
      const statusClass = order.status === 'production' ? 'status-production' :
                         order.status === 'shipping' ? 'status-shipping' : 'status-completed';
      const statusText = order.status === 'production' ? '待生产' :
                        order.status === 'shipping' ? '已发货' : '已完成';

      return `<div class="order-card" data-order-id="${order.id}">
        <div class="order-card-header">
          <span class="order-card-no">${esc(order.order_no || '#' + order.id)}</span>
          <span class="order-card-date">${esc(order.order_date || '')}</span>
        </div>
        <div class="order-card-customer">${esc(order.customer_name || '')}</div>
        <div class="order-card-items">
          ${items.slice(0, 3).map(it => `
            <div class="order-item">
              <div>
                <div class="order-item-name">${esc(translateOption('product', it.product_name || ''))}</div>
                <div class="order-item-specs">${esc(it.width_in || '')} × ${esc(it.length_in || '')} inch × ${esc(it.qty || 1)}</div>
              </div>
              <span class="order-item-qty">×${esc(it.qty || 1)}</span>
            </div>
          `).join('')}
          ${items.length > 3 ? `<div style="text-align:center;font-size:12px;color:#86868b">还有 ${items.length - 3} 项...</div>` : ''}
        </div>
        <div class="order-card-footer">
          <span class="order-card-status ${statusClass}">${statusText}</span>
          <span class="photo-count">📷 ${order.photo_count || 0}</span>
        </div>
      </div>`;
    }).join('');

    // Bind click
    grid.querySelectorAll('.order-card').forEach(card => {
      card.addEventListener('click', () => openOrderDetail(Number(card.dataset.orderId)));
    });
  }

  // ===== Order Detail =====
  async function openOrderDetail(orderId) {
    const order = allOrders.find(o => o.id === orderId);
    if (!order) return;

    $('modalTitle').textContent = `订单详情 - ${order.order_no || '#' + orderId}`;

    const items = order.items || [];
    let html = '';

    // Order Info
    html += `<div class="detail-section">
      <h4>订单信息</h4>
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">订单号</div><div class="detail-value">${esc(order.order_no || '')}</div></div>
        <div class="detail-item"><div class="detail-label">下单日期</div><div class="detail-value">${esc(order.order_date || '')}</div></div>
        <div class="detail-item"><div class="detail-label">交期日期</div><div class="detail-value">${esc(order.delivery_date || '')}</div></div>
        <div class="detail-item"><div class="detail-label">客户</div><div class="detail-value">${esc(order.customer_name || '')}</div></div>
      </div>
    </div>`;

    // Items
    items.forEach((it, idx) => {
      const options = it.selected_options_json ? JSON.parse(it.selected_options_json) : {};
      html += `<div class="detail-section">
        <h4>产品 ${idx + 1}: ${esc(it.product_name || '')}</h4>
        <div class="detail-grid">
          <div class="detail-item"><div class="detail-label">产品名称</div><div class="detail-value">${esc(it.product_name || '')}</div></div>
          <div class="detail-item"><div class="detail-label">编码</div><div class="detail-value">${esc(it.item_code || '')}</div></div>
          <div class="detail-item"><div class="detail-label">尺寸</div><div class="detail-value">${esc(it.width_in || '')} × ${esc(it.length_in || '')} inch</div></div>
          <div class="detail-item"><div class="detail-label">数量</div><div class="detail-value">${esc(it.qty || 1)}</div></div>
          ${Object.entries(options).map(([k, v]) => `
            <div class="detail-item"><div class="detail-label">${esc(k)}</div><div class="detail-value">${esc(translateOption(k, v))}</div></div>
          `).join('')}
        </div>
      </div>`;
    });

    // Photos Section
    html += `<div class="detail-section photo-section">
      <div class="photo-header">
        <h4>生产照片</h4>
        <label class="btn-secondary" style="cursor:pointer">
          上传照片<input type="file" class="photo-file-input" data-order-id="${orderId}" accept="image/*" multiple style="display:none">
        </label>
      </div>
      <div class="photo-grid" id="photoGrid-${orderId}">
        <div class="photo-empty">加载中...</div>
      </div>
    </div>`;

    $('modalBody').innerHTML = html;
    $('orderModal').classList.remove('hidden');

    // Load photos
    loadPhotos(orderId);
  }

  // ===== Photos =====
  async function loadPhotos(orderId) {
    const grid = $(`photoGrid-${orderId}`);
    if (!grid) return;

    try {
      const data = await api(`/api/production-photos/${orderId}`);
      const photos = data.photos || data || [];

      if (!photos.length) {
        grid.innerHTML = '<div class="photo-empty">暂无照片，点击上传</div>';
        return;
      }

      grid.innerHTML = photos.map(p => `
        <div class="photo-thumb" data-photo-id="${p.id}">
          <img src="/api/production-photos/file/${encodeURIComponent(p.filename)}" alt="${esc(p.original_name || '')}" loading="lazy" onclick="window.open(this.src,'_blank')">
          <button class="photo-delete" data-delete-photo="${p.id}" title="删除">&times;</button>
        </div>
      `).join('');

      // Bind delete
      grid.querySelectorAll('[data-delete-photo]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('确认删除此照片？')) return;
          try {
            await api(`/api/production-photos/${btn.dataset.deletePhoto}`, { method: 'DELETE' });
            loadPhotos(orderId);
            toast('照片已删除');
          } catch (err) { toast(err.message); }
        });
      });
    } catch (e) {
      grid.innerHTML = '<div class="photo-empty">暂无照片</div>';
    }
  }

  async function uploadPhotos(orderId, files) {
    const fd = new FormData();
    for (const file of files) fd.append('photos', file);
    try {
      toast('正在上传...');
      await api(`/api/production-photos/${orderId}`, { method: 'POST', body: fd });
      toast('照片已上传');
      loadPhotos(orderId);
    } catch (e) {
      toast('上传失败: ' + e.message);
    }
  }

  // ===== Theme Toggle =====
  function updateThemeButtons(theme) {
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.themeValue === theme);
    });
  }

  // ===== Init =====
  document.addEventListener('DOMContentLoaded', () => {
    // Theme
    const currentTheme = localStorage.getItem('twodrapes-theme') || 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    updateThemeButtons(currentTheme);

    $('themeLightBtn')?.addEventListener('click', () => {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('twodrapes-theme', 'light');
      updateThemeButtons('light');
    });
    $('themeDarkBtn')?.addEventListener('click', () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('twodrapes-theme', 'dark');
      updateThemeButtons('dark');
    });

    // Auth
    if (checkAuth()) {
      $('loginPage').classList.add('hidden');
      $('appPage').classList.remove('hidden');
      loadOrders();
    }

    // Login form
    $('loginForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      const errEl = $('loginError');
      btn.disabled = true;
      errEl.classList.add('hidden');
      try {
        await login($('username').value, $('password').value);
        $('loginPage').classList.add('hidden');
        $('appPage').classList.remove('hidden');
        loadOrders();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
      }
    });

    // Logout
    $('logoutBtn')?.addEventListener('click', logout);

    // Filters
    $('searchInput')?.addEventListener('input', renderOrders);
    $('statusFilter')?.addEventListener('change', renderOrders);

    // Modal close
    $('closeModal')?.addEventListener('click', () => $('orderModal').classList.add('hidden'));
    $('closeModalBtn')?.addEventListener('click', () => $('orderModal').classList.add('hidden'));

    // Photo upload delegation
    document.addEventListener('change', (e) => {
      const fileInput = e.target.closest('.photo-file-input');
      if (!fileInput || !fileInput.files.length) return;
      const orderId = Number(fileInput.dataset.orderId);
      uploadPhotos(orderId, fileInput.files);
      fileInput.value = '';
    });

    // Escape closes modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') $('orderModal')?.classList.add('hidden');
    });
  });
})();
