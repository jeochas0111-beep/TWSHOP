const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>\"'`]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;", "`": "&#96;" }[m]));
const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0;
const fmt = (n, d = 2) => (Number(n || 0)).toFixed(d);
const usd = (n) => `$${fmt(n)}`;
const rmb = (n) => `¥${fmt(n)}`;

let paramsState = null;
let allOrdersCache = [];
let editingUserId = null;
let rates = { usdRmbRate: 6.8, paypalFeeRate: 0.044 };
let analyticsState = { shopify: null, amazon: null, products: [], productSort: { shopify: "income", amazon: "income" }, activeChannel: "shopify" };

async function json(url, options = {}) {
  const token = localStorage.getItem("twodrapes_token");
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    headers,
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    localStorage.removeItem("twodrapes_token");
    localStorage.removeItem("twodrapes_user");
    window.location.href = "/login.html";
    throw new Error("未授权");
  }
  if (!res.ok || (data.ok === false && !options.allowFalse)) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg, type = "") {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${type}`;
  setTimeout(() => el.classList.add("hidden"), 3200);
}

function renderTable(id, headers, rows) {
  const el = $(id);
  if (!el) return;
  const empty = `<tr><td colspan="${headers.length}" class="empty-cell">暂无数据</td></tr>`;
  el.innerHTML = `<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : empty}</tbody>`;
}

function input(value, attrs = "") {
  return `<input ${attrs} value="${esc(value ?? "")}">`;
}

function orderStatusLabel(status) {
  const labels = { draft: "草稿", production: "待发货", shipping: "已发货", completed: "完成" };
  return labels[status] || "未知";
}

function orderStatusCls(status) {
  const cls = { draft: "muted", production: "warn", shipping: "accent", completed: "good" };
  return cls[status] || "muted";
}

function channelLabel(ch) {
  return ch === "amazon" ? "亚马逊" : "独立站";
}

function pct(n) {
  return `${fmt((Number(n) || 0) * 100, 1)}%`;
}

function switchTab(tabName) {
  document.querySelectorAll(".tab-nav button").forEach((b) => {
    b.classList.remove("active");
    b.setAttribute("aria-selected", "false");
  });
  const btn = document.querySelector(`.tab-nav button[data-tab="${tabName}"]`);
  if (btn) {
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
  }
  document.querySelectorAll(".page").forEach((p) => {
    p.classList.remove("active");
    p.style.display = "none";
  });
  const target = $(`page-${tabName}`);
  if (target) {
    target.classList.add("active");
    target.style.display = "";
  }
  if (tabName === "summary") loadSummary();
  if (tabName === "analytics") loadAnalytics();
  if (tabName === "params") loadParams();
  if (tabName === "users") loadUsers($("userChannelFilter")?.value || "");
}
function activateTabFromHash() {
  const hash = location.hash.replace("#", "");
  const validTabs = ["summary", "analytics", "materials", "rules", "params", "users"];
  switchTab(validTabs.includes(hash) ? hash : "summary");
}
function initTabs() {
  document.querySelectorAll(".tab-nav button[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = btn.dataset.tab;
    });
  });
  window.addEventListener("hashchange", activateTabFromHash);
}

async function loadSummary() {
  try {
    const rows = await json("/api/orders");
    allOrdersCache = rows;
    renderSummaryStats(rows);
    renderSummaryTable(rows);
  } catch (e) {
    toast(e.message, "bad");
  }
}

function renderSummaryStats(orders) {
  const el = $("summaryStats");
  if (!el) return;
  const totalOrders = orders.length;
  const totalSales = orders.reduce((s, o) => s + (Number(o.total_net_sales_rmb) || 0), 0);
  const totalCost = orders.reduce((s, o) => s + (Number(o.total_cost_rmb) || 0), 0);
  const totalProfit = orders.reduce((s, o) => s + (Number(o.total_profit_rmb) || 0), 0);
  const avgRate = totalSales > 0 ? (totalProfit / totalSales * 100) : 0;
  el.innerHTML = `
    <div class="stat-card"><span class="stat-label">订单总数</span><span class="stat-value">${totalOrders}</span></div>
    <div class="stat-card"><span class="stat-label">总销售额</span><span class="stat-value">${rmb(totalSales)}</span></div>
    <div class="stat-card"><span class="stat-label">总成本</span><span class="stat-value">${rmb(totalCost)}</span></div>
    <div class="stat-card"><span class="stat-label">总利润</span><span class="stat-value">${rmb(totalProfit)}</span></div>
    <div class="stat-card"><span class="stat-label">平均利润率</span><span class="stat-value">${fmt(avgRate, 1)}%</span></div>
  `;
}

function summaryCurrentFilters() {
  return {
    q: ($("summarySearchInput")?.value || "").trim().toLowerCase(),
    from: $("summaryDateFrom")?.value || "",
    to: $("summaryDateTo")?.value || "",
    channel: $("summaryChannelFilter")?.value || "",
    status: $("summaryStatusFilter")?.value || ""
  };
}

function updateFilterFieldState(el) {
  const field = el.closest(".filter-field");
  if (!field) return;
  field.classList.toggle("has-value", !!el.value);
}

function initFilterFields() {
  document.querySelectorAll(".filter-field input, .filter-field select").forEach((el) => {
    updateFilterFieldState(el);
    el.closest(".filter-field")?.querySelector(".filter-clear")?.addEventListener("click", () => {
      el.value = "";
      updateFilterFieldState(el);
      el.dispatchEvent(new Event(el.type === "search" ? "input" : "change", { bubbles: true }));
    });
  });
}

function setPeriod(period) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  let from = "";
  let to = "";
  if (period === "month") {
    from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    to = `${y}-${String(m + 1).padStart(2, "0")}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, "0")}`;
  } else if (period === "lastMonth") {
    const lm = m === 0 ? 11 : m - 1;
    const ly = m === 0 ? y - 1 : y;
    from = `${ly}-${String(lm + 1).padStart(2, "0")}-01`;
    to = `${ly}-${String(lm + 1).padStart(2, "0")}-${String(new Date(ly, lm + 1, 0).getDate()).padStart(2, "0")}`;
  } else if (period === "3months") {
    const d = new Date(y, m - 2, 1);
    from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    to = `${y}-${String(m + 1).padStart(2, "0")}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, "0")}`;
  } else if (period === "6months") {
    const d = new Date(y, m - 5, 1);
    from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    to = `${y}-${String(m + 1).padStart(2, "0")}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, "0")}`;
  }
  const fromEl = $("summaryDateFrom");
  const toEl = $("summaryDateTo");
  if (fromEl) { fromEl.value = from; updateFilterFieldState(fromEl); }
  if (toEl) { toEl.value = to; updateFilterFieldState(toEl); }
}

function renderSummaryFilterChips() {
  const container = $("summaryFilterChips");
  if (!container) return;
  const chips = [];
  const f = summaryCurrentFilters();
  if (f.q) chips.push({ label: `搜索: ${f.q}`, clear: () => { $("summarySearchInput").value = ""; } });
  if (f.from) chips.push({ label: `从 ${f.from}`, clear: () => { $("summaryDateFrom").value = ""; } });
  if (f.to) chips.push({ label: `至 ${f.to}`, clear: () => { $("summaryDateTo").value = ""; } });
  if (f.channel) chips.push({ label: `渠道: ${$("summaryChannelFilter").selectedOptions[0]?.text}`, clear: () => { $("summaryChannelFilter").value = ""; } });
  if (f.status) chips.push({ label: `状态: ${$("summaryStatusFilter").selectedOptions[0]?.text}`, clear: () => { $("summaryStatusFilter").value = ""; } });
  if (!chips.length) { container.innerHTML = ""; return; }
  container.innerHTML = chips.map((c, i) =>
    `<span class="filter-chip">${esc(c.label)}<button class="filter-chip-remove" data-idx="${i}">&times;</button></span>`
  ).join("") + `<button class="filter-chips-clear">清除全部</button>`;
  container.querySelectorAll(".filter-chip-remove").forEach((btn, i) => {
    btn.addEventListener("click", () => { chips[i].clear(); renderSummaryTable(allOrdersCache); renderSummaryFilterChips(); });
  });
  container.querySelector(".filter-chips-clear")?.addEventListener("click", () => {
    ["summarySearchInput", "summaryDateFrom", "summaryDateTo", "summaryChannelFilter", "summaryStatusFilter"].forEach((id) => {
      const el = $(id); if (el) { el.value = ""; updateFilterFieldState(el); }
    });
    renderSummaryTable(allOrdersCache); renderSummaryFilterChips();
  });
}

function renderSummaryTable(orders) {
  const f = summaryCurrentFilters();
  let filtered = orders;
  if (f.channel) filtered = filtered.filter((o) => o.channel === f.channel);
  if (f.status) filtered = filtered.filter((o) => o.status === f.status);
  if (f.from) filtered = filtered.filter((o) => String(o.order_date || "") >= f.from);
  if (f.to) filtered = filtered.filter((o) => String(o.order_date || "") <= f.to);
  if (f.q) filtered = filtered.filter((o) => `${o.order_no || ""} ${o.customer_name || ""}`.toLowerCase().includes(f.q));
  renderTable(
    "summaryTable",
    ["订单号", "渠道", "客户", "交期", "状态", "售价", "成本", "利润", "利润率", "提醒"],
    filtered.map((o) => {
      const rate = Number(o.total_profit_rate) || 0;
      return `<tr>
        <td><strong class="order-no-link" data-view-order="${o.id}" style="cursor:pointer">${esc(o.order_no || "#" + o.id)}</strong></td>
        <td>${esc(channelLabel(o.channel))}</td>
        <td>${esc(o.customer_name || "-")}</td>
        <td>${esc(o.delivery_date || "-")}</td>
        <td><span class="pill ${orderStatusCls(o.status)}">${esc(orderStatusLabel(o.status))}</span></td>
        <td>${rmb(o.total_net_sales_rmb)}</td>
        <td>${rmb(o.total_cost_rmb)}</td>
        <td>${rmb(o.total_profit_rmb)}</td>
        <td>${fmt(rate * 100, 1)}%</td>
        <td><button class="btn tiny ${o.reminder ? 'reminder-active' : 'secondary'}" data-toggle-reminder="${o.id}" title="${esc(o.reminder_text || '设置提醒')}">${o.reminder ? '已提醒' : '提醒'}</button></td>
      </tr>`;
    })
  );
}

async function loadAnalyticsProducts() {
  if (analyticsState.products.length) return;
  try {
    const bootstrap = await json("/api/bootstrap");
    analyticsState.products = Array.isArray(bootstrap.products) ? bootstrap.products : [];
    const select = $("analyticsProductFilter");
    if (select) {
      const current = select.value;
      select.innerHTML = '<option value="">全部产品</option>' + analyticsState.products
        .map((product) => `<option value="${esc(product.id)}">${esc(product.name || product.id)}</option>`)
        .join("");
      select.value = current;
    }
  } catch (e) {
    toast(e.message, "bad");
  }
}

function analyticsParams(channel) {
  const params = new URLSearchParams();
  const pairs = [
    ["date_from", $("analyticsDateFrom")?.value || ""],
    ["date_to", $("analyticsDateTo")?.value || ""],
    ["channel", channel],
    ["product_id", $("analyticsProductFilter")?.value || ""]
  ];
  for (const [key, value] of pairs) if (value) params.set(key, value);
  return params.toString();
}

async function loadAnalytics() {
  await loadAnalyticsProducts();
  const status = $("analyticsStatus");
  if (status) {
    status.textContent = "正在加载分析数据...";
    status.classList.remove("hidden");
  }
  try {
    const [shopifyData, amazonData] = await Promise.all([
      json("/api/analytics/overview?" + analyticsParams("shopify")),
      json("/api/analytics/overview?" + analyticsParams("amazon"))
    ]);
    analyticsState.shopify = shopifyData;
    analyticsState.amazon = amazonData;
    renderChannelAnalytics("shopify");
    renderChannelAnalytics("amazon");
    if (status) status.classList.add("hidden");
  } catch (e) {
    if (status) {
      status.textContent = e.message;
      status.classList.remove("hidden");
    }
    toast(e.message, "bad");
  }
}

function analyticsMetric(label, value, hint = "") {
  return `<div class="analytics-metric-card">
    <span>${esc(label)}</span>
    <b>${esc(value)}</b>
    ${hint ? `<small>${esc(hint)}</small>` : ""}
  </div>`;
}

function renderChannelSummary(channel, summary = {}) {
  const el = $(channel === "shopify" ? "shopifyAnalyticsSummary" : "amazonAnalyticsSummary");
  if (!el) return;
  const cards = [
    analyticsMetric("订单数", String(summary.orderCount || 0)),
    analyticsMetric("收入 RMB", rmb(summary.incomeRmb)),
    analyticsMetric("生产成本", rmb(summary.productionCostRmb)),
    analyticsMetric("物流成本", rmb(summary.logisticsCostRmb)),
    analyticsMetric("利润", rmb(summary.profitRmb)),
    analyticsMetric("利润率", pct(summary.profitRate)),
    analyticsMetric("客单价", rmb(summary.averageOrderValueRmb))
  ];
  if (channel === "shopify") {
    cards.splice(4, 0, analyticsMetric("PayPal 手续费", rmb(summary.paypalFeeRmb)));
    cards.splice(5, 0, analyticsMetric("税费", rmb(summary.taxRmb)));
  } else {
    const commission = (summary.incomeRmb || 0) * 0.15;
    cards.splice(4, 0, analyticsMetric("平台佣金 (15%)", rmb(commission)));
  }
  el.innerHTML = cards.join("");
}

function renderChannelTrendChart(channel, rows = []) {
  const el = $(channel === "shopify" ? "shopifyTrendChart" : "amazonTrendChart");
  if (!el) return;
  if (!rows.length) {
    el.className = "analytics-chart empty";
    el.textContent = "暂无数据";
    return;
  }

  const sorted = [...rows].sort((a, b) => a.month < b.month ? -1 : 1);
  const maxValues = sorted.flatMap((row) => [num(row.incomeRmb), num(row.totalCostRmb), Math.abs(num(row.profitRmb))]);
  const max = Math.max(1, ...maxValues);

  el.className = "analytics-chart";
  el.innerHTML = sorted.map((row) => {
    const incomeH = Math.max(2, Math.round(num(row.incomeRmb) / max * 100));
    const costH = Math.max(2, Math.round(num(row.totalCostRmb) / max * 100));
    const profitH = Math.max(2, Math.round(Math.abs(num(row.profitRmb)) / max * 100));
    const bars = `<span class="trend-bar income" style="height:${incomeH}%"></span>
      <span class="trend-bar cost" style="height:${costH}%"></span>
      <span class="trend-bar profit" style="height:${profitH}%"></span>`;
    const tip = `${esc(row.month)} 收入 ${rmb(row.incomeRmb)} / 支出 ${rmb(row.totalCostRmb)} / 利润 ${rmb(row.profitRmb)}`;
    return `<div class="trend-month">
      <div class="trend-bars" title="${tip}">${bars}</div>
      <b>${esc(row.month)}</b>
    </div>`;
  }).join("");
}

function renderChannelExpenseChart(channel, expenseBreakdown = []) {
  const el = $(channel === "shopify" ? "shopifyExpenseChart" : "amazonExpenseChart");
  if (!el) return;

  let rows;
  if (channel === "shopify") {
    rows = expenseBreakdown.filter(r => r.key !== "amazon_commission");
  } else {
    // 亚马逊: 生产成本 + 物流成本 + 平台佣金 15%
    const income = analyticsState.amazon?.summary?.incomeRmb || 0;
    const commission = income * 0.15;
    rows = [
      { key: "production", label: "生产成本", amountRmb: expenseBreakdown.find(r => r.key === "production")?.amountRmb || 0 },
      { key: "logistics", label: "物流成本", amountRmb: expenseBreakdown.find(r => r.key === "logistics")?.amountRmb || 0 },
      { key: "commission", label: "平台佣金 (15%)", amountRmb: commission }
    ];
  }

  const total = rows.reduce((sum, row) => sum + num(row.amountRmb), 0);
  if (!rows.length || total <= 0) {
    el.className = "analytics-expense-chart empty";
    el.textContent = "暂无数据";
    return;
  }
  el.className = "analytics-expense-chart";
  el.innerHTML = rows.map((row) => {
    const percent = total > 0 ? num(row.amountRmb) / total : 0;
    return `<div class="expense-row">
      <div class="expense-row-head"><span>${esc(row.label)}</span><b>${rmb(row.amountRmb)}</b></div>
      <div class="expense-track"><span style="width:${Math.round(percent * 100)}%"></span></div>
      <small>${pct(percent)}</small>
    </div>`;
  }).join("");
}

function sortedChannelProducts(channel) {
  const data = analyticsState[channel];
  const rows = data?.productComparison || [];
  const sort = $(`.analytics-product-sort[data-channel="${channel}"]`)?.value || analyticsState.productSort[channel] || "income";
  analyticsState.productSort[channel] = sort;
  const keyMap = { income: "incomeRmb", profit: "profitRmb", rate: "profitRate", qty: "qty" };
  const key = keyMap[sort] || "incomeRmb";
  return [...rows].sort((a, b) => num(b[key]) - num(a[key]));
}

function renderChannelProductTable(channel) {
  const tableId = channel === "shopify" ? "shopifyProductTable" : "amazonProductTable";
  renderTable(tableId, ["产品", "订单", "项目", "销量", "收入", "成本", "利润", "利润率"], sortedChannelProducts(channel).map((row) => `
    <tr>
      <td><strong>${esc(row.productName)}</strong><small>${esc(row.productId || "")}</small></td>
      <td>${row.orderCount || 0}</td>
      <td>${row.itemCount || 0}</td>
      <td>${fmt(row.qty, 0)}</td>
      <td>${rmb(row.incomeRmb)}</td>
      <td>${rmb(row.costRmb)}</td>
      <td>${rmb(row.profitRmb)}</td>
      <td>${pct(row.profitRate)}</td>
    </tr>
  `));
}

function renderChannelAnalytics(channel) {
  const data = analyticsState[channel] || {};
  renderChannelSummary(channel, data.summary || {});
  renderChannelTrendChart(channel, data.monthlyTrend || []);
  renderChannelExpenseChart(channel, data.expenseBreakdown || []);
  renderChannelProductTable(channel);
}

function switchAnalyticsChannel(channel) {
  analyticsState.activeChannel = channel;
  document.querySelectorAll(".analytics-channel-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.analyticsChannel === channel);
  });
  $("analyticsShopifySection").style.display = channel === "shopify" ? "" : "none";
  $("analyticsAmazonSection").style.display = channel === "amazon" ? "" : "none";
}

function resetAnalyticsFilters() {
  ["analyticsDateFrom", "analyticsDateTo", "analyticsProductFilter"].forEach((id) => {
    const el = $(id);
    if (el) el.value = "";
  });
  loadAnalytics();
}

function pickGlobal(globals, keys, fallback = "") {
  for (const key of keys) {
    if (globals && Object.prototype.hasOwnProperty.call(globals, key) && globals[key] !== "" && globals[key] != null) {
      return globals[key];
    }
  }
  return fallback;
}

function materialId(prefix, name) {
  const base = String(name || "").trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_").replace(/^_+|_+$/g, "");
  return `${prefix}_${base || Date.now()}`;
}

function materialRow(row, type) {
  const metaField = type === "fabric" ? "series" : "color";
  const namePlaceholder = type === "fabric" ? "面料名称" : "内衬名称";
  const metaPlaceholder = type === "fabric" ? "系列" : "颜色";
  const canDelete = row.id !== "lining_none";
  return `<tr data-id="${esc(row.id || "")}" data-type="${type}">
    <td>${input(row.name || "", `data-field="name" placeholder="${namePlaceholder}"`)}</td>
    <td>${input(row[metaField] || "", `data-field="${metaField}" placeholder="${metaPlaceholder}"`)}</td>
    <td>${input(row.width_cm, 'type="number" step="0.01" data-field="width_cm"')}</td>
    <td>${input(row.price_per_m, 'type="number" step="0.01" data-field="price_per_m"')}</td>
    <td><button type="button" class="icon-btn danger" data-action="delete-material"${canDelete ? "" : " disabled"}>删除</button></td>
  </tr>`;
}

function nextMaterialName(type) {
  const tableId = type === "fabric" ? "fabricTable" : "liningTable";
  const prefix = type === "fabric" ? "新面料" : "新内衬";
  const table = $(tableId);
  if (!table) return `${prefix}${Date.now()}`;
  const names = [...table.querySelectorAll('tbody [data-field="name"]')].map((el) => String(el.value || "").trim());
  let idx = 1;
  while (names.includes(`${prefix}${idx}`)) idx++;
  return `${prefix}${idx}`;
}

function appendMaterialRow(type) {
  const tableId = type === "fabric" ? "fabricTable" : "liningTable";
  const table = $(tableId);
  if (!table) return false;
  const tbody = table.tBodies[0] || table.createTBody();
  const defaultName = nextMaterialName(type);
  tbody.insertAdjacentHTML(
    "beforeend",
    materialRow({ id: materialId(type, defaultName), name: defaultName, enabled: 1, width_cm: type === "fabric" ? 340 : 280, price_per_m: 0 }, type)
  );
  return true;
}

function renderParams(p) {
  paramsState = p;
  const labels = [
    { key: "topHemAllowanceCm", label: "顶部包边 cm" },
    { key: "bottomHemAllowanceCm", label: "底边包边 cm" },
    { key: "singleLayerLossCm", label: "单层裁损 cm" },
    { key: "doubleLayerLossCm", label: "双层裁损 cm" },
    { key: "factoryIssueBufferCm", label: "发料余量 cm" },
    { key: "singleLaborRmbPerM", label: "单层加工费 /m" },
    { key: "doubleLaborRmbPerM", label: "双层加工费 /m" },
    { key: "singleMemoryRmbPerM", label: "单层定型费 /m" },
    { key: "doubleMemoryRmbPerM", label: "双层定型费 /m" },
    { key: "costCoefficient", label: "成本系数" },
    { key: "defaultFullness", label: "默认褶皱倍率" },
    { key: "usdRmbRate", label: "汇率 USD/RMB" },
    { key: "paypalFeeRate", label: "PayPal 手续费率" }
  ];
  const summary = $("paramsSummary");
  if (summary) {
    summary.innerHTML = labels.map((field) => {
      const value = pickGlobal(p.globals, [field.key], "");
      return `<label class="param-field"><span>${esc(field.label)}</span>${input(value, `type="number" step="0.01" data-global="${field.key}"`)}</label>`;
    }).join("");
  }
  const content = $("paramsContent");
  if (content) {
    content.innerHTML = `
      <div class="params-section">
        <h3>面料</h3>
        <div class="toolbar"><button class="btn small secondary" data-action="add-material" data-type="fabric">+ 添加面料</button></div>
        <div class="table-wrap"><table id="fabricTable"></table></div>
      </div>
      <div class="params-section">
        <h3>内衬</h3>
        <div class="toolbar"><button class="btn small secondary" data-action="add-material" data-type="lining">+ 添加内衬</button></div>
        <div class="table-wrap"><table id="liningTable"></table></div>
      </div>
      <div class="params-section">
        <h3>加工费规则</h3>
        <div class="table-wrap"><table id="laborTable"></table></div>
      </div>
      <div class="params-section">
        <h3>定型费规则</h3>
        <div class="table-wrap"><table id="memoryTable"></table></div>
      </div>
    `;
  }
  if ($("fabricTable")) renderTable("fabricTable", ["面料", "系列", "门幅 cm", "单价", "操作"], p.fabrics.map((f) => materialRow(f, "fabric")));
  if ($("liningTable")) renderTable("liningTable", ["内衬", "颜色", "门幅 cm", "单价", "操作"], p.linings.map((l) => materialRow(l, "lining")));
  if ($("laborTable")) renderTable("laborTable", ["层数", "下限 m", "上限 m", "单价"], p.laborRules.map((r, i) => `<tr data-row-index="${i}"><td><select data-field="layer"><option value="single"${r.layer === "single" ? " selected" : ""}>single</option><option value="double"${r.layer === "double" ? " selected" : ""}>double</option></select></td><td>${input(r.min_m, 'type="number" step="0.01" data-field="min_m"')}</td><td>${input(r.max_m ?? "", 'type="number" step="0.01" data-field="max_m"')}</td><td>${input(r.rate_rmb_per_m, 'type="number" step="0.01" data-field="rate_rmb_per_m"')}</td></tr>`));
  if ($("memoryTable")) renderTable("memoryTable", ["下限 m", "上限 m", "单层价", "双层系数"], p.memoryRules.map((r, i) => `<tr data-row-index="${i}"><td>${input(r.min_m, 'type="number" step="0.01" data-field="min_m"')}</td><td>${input(r.max_m ?? "", 'type="number" step="0.01" data-field="max_m"')}</td><td>${input(r.single_rate_rmb, 'type="number" step="0.01" data-field="single_rate_rmb"')}</td><td>${input(r.double_coef, 'type="number" step="0.01" data-field="double_coef"')}</td></tr>`));
}

async function loadParams() {
  try {
    const p = await json("/api/factory/params");
    renderParams(p);
    if ($("paramsStatus")) {
      $("paramsStatus").textContent = "参数已加载。";
      $("paramsStatus").classList.remove("hidden");
    }
  } catch (e) {
    if ($("paramsStatus")) {
      $("paramsStatus").textContent = `加载失败：${e.message}`;
      $("paramsStatus").classList.remove("hidden");
    }
    toast(e.message, "bad");
  }
}

function collectMaterialRows(tableId, type) {
  const table = $(tableId);
  if (!table) return [];
  const source = type === "fabric" ? (paramsState?.fabrics || []) : (paramsState?.linings || []);
  return [...table.querySelectorAll("tbody tr")].map((tr) => {
    const name = tr.querySelector('[data-field="name"]').value.trim();
    const metaField = type === "fabric" ? "series" : "color";
    const id = tr.dataset.id || materialId(type, name);
    const original = source.find((row) => row.id === id);
    tr.dataset.id = id;
    return {
      id,
      name,
      [metaField]: tr.querySelector(`[data-field="${metaField}"]`).value.trim(),
      width_cm: tr.querySelector('[data-field="width_cm"]').value,
      price_per_m: tr.querySelector('[data-field="price_per_m"]').value,
      enabled: original?.enabled ?? 1
    };
  }).filter((row) => row.name);
}

function collectRuleRows(tableId) {
  const table = $(tableId);
  if (!table) return [];
  const source = tableId === "laborTable" ? (paramsState?.laborRules || []) : (paramsState?.memoryRules || []);
  return [...table.querySelectorAll("tbody tr")].map((tr) => {
    const idx = Number(tr.dataset.rowIndex);
    const original = Number.isFinite(idx) ? source[idx] : null;
    const row = {};
    tr.querySelectorAll("[data-field]").forEach((el) => { row[el.dataset.field] = el.value; });
    row.note = original?.note || "";
    if (tableId === "memoryTable") row.manual_quote = original?.manual_quote ?? 0;
    return row;
  });
}

async function saveParams() {
  if (!paramsState) return;
  if (!confirm("确定保存生产参数？")) return;
  try {
    const globals = {};
    document.querySelectorAll("[data-global]").forEach((el) => { globals[el.dataset.global] = el.value; });
    const body = {
      globals,
      fabrics: collectMaterialRows("fabricTable", "fabric"),
      linings: collectMaterialRows("liningTable", "lining"),
      laborRules: collectRuleRows("laborTable"),
      memoryRules: collectRuleRows("memoryTable")
    };
    const saved = await json("/api/factory/params", { method: "PUT", body: JSON.stringify(body) });
    renderParams(saved);
    if ($("paramsStatus")) {
      $("paramsStatus").textContent = "生产参数已保存。";
      $("paramsStatus").classList.remove("hidden");
    }
    toast("参数已保存");
  } catch (e) {
    toast(e.message, "bad");
  }
}

async function loadUsers(channelFilter) {
  try {
    const url = channelFilter ? `/api/users?channel=${channelFilter}` : "/api/users";
    const rows = await json(url);
    const body = rows.map((u) => `<tr>
      <td>${u.id}</td>
      <td>${channelLabel(u.channel)}</td>
      <td><strong class="user-name">${esc(u.username)}</strong></td>
      <td>${u.enabled ? '<span class="pill good">启用</span>' : '<span class="pill bad">停用</span>'}</td>
      <td class="users-action-cell">
        <div class="users-action-group">
          <button class="btn tiny secondary" data-action="edit" data-id="${u.id}" data-channel="${u.channel}" data-username="${esc(u.username)}">编辑</button>
          <button class="btn tiny danger" data-action="delete" data-id="${u.id}">删除</button>
        </div>
      </td>
    </tr>`);
    renderTable("usersTable", ["ID", "渠道", "用户名", "状态", "操作"], body);
  } catch (e) {
    toast(e.message, "bad");
  }
}

function showUserForm(channel = "shopify", username = "") {
  const form = $("userForm");
  if (!form) return;
  form.classList.remove("hidden");
  $("userFormChannel").value = channel;
  $("userFormChannel").disabled = Boolean(username);
  $("userFormUsername").value = username;
  $("userFormUsername").disabled = false;
  $("userFormPassword").value = "";
  $("userFormPassword").placeholder = username ? "留空则不修改" : "登录密码";
  if (!username) editingUserId = null;
}

function hideUserForm() {
  $("userForm")?.classList.add("hidden");
  editingUserId = null;
}

function initUsers() {
  $("userChannelFilter")?.addEventListener("change", () => loadUsers($("userChannelFilter").value));
  $("addUserBtn")?.addEventListener("click", () => {
    editingUserId = null;
    showUserForm("shopify", "");
  });
  $("userFormCancelBtn")?.addEventListener("click", hideUserForm);
  $("userFormSaveBtn")?.addEventListener("click", async () => {
    const channel = $("userFormChannel").value;
    const username = $("userFormUsername").value.trim();
    const password = $("userFormPassword").value;
    if (!username) return toast("请输入用户名", "bad");
    try {
      if (editingUserId) {
        const body = { username, display_name: username, role: "admin", enabled: 1 };
        if (password) body.password = password;
        await json(`/api/users/${editingUserId}`, { method: "PUT", body: JSON.stringify(body) });
        toast("用户已更新");
      } else {
        if (!password) return toast("请输入密码", "bad");
        await json("/api/users", { method: "POST", body: JSON.stringify({ channel, username, password, display_name: username, role: "operator" }) });
        toast("用户已创建");
      }
      hideUserForm();
      loadUsers($("userChannelFilter")?.value || "");
    } catch (e) {
      toast(e.message, "bad");
    }
  });

  $("usersTable")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const username = btn.dataset.username || "";
    if (action === "edit") {
      editingUserId = id;
      showUserForm(btn.dataset.channel, username);
      return;
    }
    if (action === "delete") {
      if (!confirm(`确定删除用户 ${username}？`)) return;
      try {
        await json(`/api/users/${id}`, { method: "DELETE" });
        toast("用户已删除");
        loadUsers($("userChannelFilter")?.value || "");
      } catch (err) {
        toast(err.message, "bad");
      }
    }
  });
}

function normalizeItemCode(code) {
  return String(code || "").replace(/^(定制-?|定制-)/, "定制-");
}

function optionDisplayRows(item) {
  const calc = item.calc_detail || {};
  const options = item.selected_options || {};
  const groups = calc.product?.options || [];
  const byKey = new Map(groups.map((g) => [g.option_key || g.key, g]));
  return Object.entries(options).map(([key, value]) => {
    const group = byKey.get(key) || {};
    const found = (group.values || []).find((v) => String(v.label) === String(value)) || {};
    return {
      itemId: item.id,
      key,
      label: group.label || key,
      value,
      priceUsd: found.price_usd ?? found.price ?? "",
      costRmb: found.cost_rmb ?? found.costRmb ?? ""
    };
  });
}

function optionListHtml(optRows) {
  if (!optRows.length) return "";
  return `<dl class="item-row-options">${optRows.map((r) => `
    <div class="item-option-row">
      <b>${esc(r.label)}</b>
      <span>${esc(r.value)}</span>
    </div>
  `).join("")}</dl>`;
}

function orderItemModulesHtml(order) {
  const items = order.items || [];
  if (!items.length) return '<div class="notice">暂无项目。</div>';

  // Group by product name
  const groups = new Map();
  for (const it of items) {
    const name = it.product_name || "产品";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(it);
  }

  const groupsHtml = Array.from(groups.entries()).map(([productName, groupItems]) => {
    const totalCount = groupItems.length;
    const totalQty = groupItems.reduce((s, it) => s + (Math.max(1, Number(it.qty) || 1)), 0);
    const headerLabel = totalCount === 1
      ? `${totalQty}条`
      : `${totalCount}项, 共${totalQty}条`;

    const rows = groupItems.map((it) => {
      const itemCode = esc(normalizeItemCode(it.item_code));
      const size = `${fmt(it.width_in, 0)}×${fmt(it.length_in, 0)}`;
      const qty = Math.max(1, Number(it.qty) || 1);
      const itemPrice = Number(it.sales_usd) || 0;
      const optRows = optionDisplayRows(it);
      return `<div class="item-group-row">
        <div class="item-row-main">
          <span class="item-row-code">${itemCode}</span>
          <span class="item-row-size">${size}</span>
          <span class="item-row-qty">×${qty}</span>
          <span class="item-row-price">$${fmt(itemPrice)}</span>
        </div>
        ${optionListHtml(optRows)}
      </div>`;
    }).join("");

    return `<div class="item-group-card">
      <div class="item-group-header">
        <span class="item-group-name">${esc(productName)}</span>
        <span class="item-group-count">${headerLabel}</span>
      </div>
      ${rows}
    </div>`;
  }).join("");

  return groupsHtml;
}

function orderFinancialSummaryHtml(order) {
  const profit = Number(order.total_profit_rmb) || 0;
  const profitRate = Number(order.total_profit_rate) || 0;
  const totalCost = Number(order.total_cost_rmb) || 0;
  const productionCost = order.production_cost_override_rmb != null
    ? Number(order.production_cost_override_rmb)
    : (order.items || []).reduce((sum, item) => sum + (Number(item.final_cost_rmb) || 0), 0);
  const rows = [
    ["订单销售额", usd(order.total_sales_usd), "strong"],
    ["税费", usd(order.total_tax_usd), ""],
    ["净销售 RMB", rmb(order.total_net_sales_rmb), ""],
    ["生产成本 RMB", rmb(productionCost), ""],
    ["物流成本 RMB", rmb(order.logistics_cost_rmb), ""],
    ["总成本 RMB", rmb(totalCost), ""],
    ["利润 RMB", rmb(profit), profit < 0 ? "bad strong" : "good strong"],
    ["利润率", `${fmt(profitRate * 100, 1)}%`, profitRate < 0 ? "bad strong" : "good strong"]
  ];
  if (Number(order.paypal_fee_usd) > 0) rows.splice(3, 0, ["PayPal 手续费", usd(order.paypal_fee_usd), ""]);
  if (Number(order.actual_income_usd) > 0) rows.splice(1, 0, ["实收金额", usd(order.actual_income_usd), "strong"]);

  return `<div class="detail-section detail-section-amounts">
    <div class="detail-section-title">
      <h4>金额汇总</h4>
      <span>金额右对齐，保留核心财务字段</span>
    </div>
    <div class="amount-summary-grid">
      ${rows.map(([label, value, cls]) => `<div class="amount-summary-row ${cls}">
        <span>${esc(label)}</span>
        <b>${esc(value)}</b>
      </div>`).join("")}
    </div>
  </div>`;
}

async function viewOrderModal(orderId) {
  try {
    const order = await json(`/api/orders/${orderId}`);
    const title = $("orderDetailTitle");
    const content = $("orderDetailContent");
    if (!title || !content) return;
    title.textContent = "订单 " + esc(order.order_no || "#" + order.id);

    // Header description
    const descParts = [esc(order.order_no || "#" + order.id)];
    if (order.channel) descParts.push(channelLabel(order.channel));
    if (order.order_date) descParts.push(order.order_date);
    const descEl = $("orderDetailDesc");
    if (descEl) descEl.textContent = descParts.join(" · ");

    // Status badge
    const badge = $("orderDetailStatusBadge");
    if (badge) {
      badge.textContent = orderStatusLabel(order.status);
      badge.className = "order-status " + orderStatusCls(order.status);
    }

    const logisticsCost = Number(order.logistics_cost_rmb) || 0;
    const field = (label, value, extraClass = "") => {
      const cls = extraClass ? ` class="${extraClass}"` : "";
      return `<div${cls}><label>${label}<span class="detail-value">${esc(String(value || ""))}</span></label></div>`;
    };
    content.innerHTML =
      '<div class="order-detail-stack">' +
      '<div class="detail-section detail-section-overview">' +
      '<div class="detail-section-title"><h4>订单概览</h4><span>' + esc(order.order_no || "#" + order.id) + '</span></div>' +
      '<div class="detail-grid">' +
      field("下单日期", order.order_date) +
      field("交期日期", order.delivery_date) +
      field("备注", order.remark, "detail-field-wide") +
      '</div></div>' +
      '<div class="detail-section">' +
      '<div class="detail-section-title"><h4>客户信息</h4><span>姓名 / 联系方式 / 地址</span></div>' +
      '<div class="detail-grid">' +
      field("客户姓名", order.customer_name) +
      field("邮箱", order.customer_email) +
      field("电话", order.customer_phone) +
      field("地址", order.customer_address, "detail-field-wide") +
      '</div>' +
      '</div>' +
      '<div class="detail-section">' +
      '<div class="detail-section-title"><h4>物流信息</h4><span>发货 / 追踪 / 签收</span></div>' +
      '<div class="detail-grid">' +
      field("货代", order.logistics_provider) +
      field("尾程派送渠道", order.delivery_channel) +
      field("尾程追踪编码", order.tracking_number) +
      field("重量 KG", order.weight_kg) +
      field("物流成本（RMB）", logisticsCost) +
      field("发货时间", order.shipping_date) +
      field("到货时间", order.delivered_date) +
      '</div>' +
      (order.delivery_screenshot
        ? '<div class="delivery-screenshot-section"><div class="delivery-screenshot-header"><h4>签收截图</h4></div><div class="delivery-screenshot-area"><div class="delivery-screenshot-preview"><img src="/api/orders/' + order.id + '/delivery-screenshot" alt="签收截图" onclick="window.open(this.src,\'_blank\')"></div></div></div>'
        : '') +
      '</div></div>' +
      orderFinancialSummaryHtml(order) +
      '<div class="detail-section detail-section-items"><div class="detail-section-title"><h4>商品明细</h4><span>' + (order.items || []).length + ' 项</span></div>' +
      orderItemModulesHtml(order) +
      '</div>' +
      '<div class="detail-section reminder-section"><div class="reminder-section-header"><h4>提醒设置</h4>' +
      (order.reminder ? '<span class="reminder-status-active">已启用</span>' : '') +
      '</div>' +
      '<div class="reminder-form">' +
      '<label class="checkline"><input type="checkbox" id="orderReminderToggle" ' + (order.reminder ? 'checked' : '') + '> 标记为需要更新</label>' +
      '<textarea id="orderReminderText" rows="2" placeholder="提醒内容（可选）">' + esc(order.reminder_text || '') + '</textarea>' +
      '</div></div>' +
      '</div>';

    // Footer — reminder save button
    const footer = $("orderDetailFooter");
    if (footer) {
      footer.innerHTML = '<button class="btn primary small" id="saveReminderBtn" type="button">保存提醒</button>';
    }

    $("orderDetailModal").classList.remove("hidden");
    $("saveReminderBtn").onclick = async () => {
      const reminder = $("orderReminderToggle").checked ? 1 : 0;
      const reminderText = $("orderReminderText").value.trim();
      await json(`/api/orders/${order.id}/reminder`, {
        method: 'PUT',
        body: JSON.stringify({ reminder, reminder_text: reminderText })
      });
      toast('提醒已保存');
      loadSummary();
      $("orderDetailModal").classList.add("hidden");
    };
    const closeHandler = () => $("orderDetailModal").classList.add("hidden");
    $("closeOrderDetailBtn").onclick = closeHandler;
    $("closeOrderDetailModal").onclick = closeHandler;
  } catch (e) {
    toast(e.message, "bad");
  }
}

function renderNotifyPanel() {
  const today = new Date().toISOString().slice(0, 10);
  const todayDate = new Date(today + 'T00:00:00');
  const orders = allOrdersCache || [];
  const logistics = orders.filter(o => {
    if (!o.order_date) return false;
    const deadline = new Date(o.order_date + 'T00:00:00');
    deadline.setDate(deadline.getDate() + 10);
    return deadline <= todayDate && !Number(o.logistics_cost_rmb);
  });
  const isEarlyMonth = todayDate.getDate() <= 7;
  let production = [];
  if (isEarlyMonth) {
    const lastMonth = todayDate.getMonth() === 0 ? 12 : todayDate.getMonth();
    const lastMonthYear = todayDate.getMonth() === 0 ? todayDate.getFullYear() - 1 : todayDate.getFullYear();
    production = orders.filter(o => {
      if (!o.order_date) return false;
      const d = new Date(o.order_date + 'T00:00:00');
      return d.getMonth() + 1 === lastMonth && d.getFullYear() === lastMonthYear && o.production_cost_override_rmb == null;
    });
  }
  const reminders = orders.filter(o => o.reminder);
  const total = logistics.length + production.length + reminders.length;
  const badge = $('notifyBadge');
  if (badge) {
    if (total > 0) { badge.textContent = total; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  }
  const countEl = $('notifyPanelCount');
  if (countEl) {
    if (total > 0) { countEl.textContent = total + ' 项待处理'; countEl.classList.remove('hidden'); }
    else countEl.classList.add('hidden');
  }
  let html = '';
  if (logistics.length) {
    html += `<div class="notify-section"><div class="notify-section-header"><span class="notify-section-dot warn"></span><h4>物流成本（${logistics.length}）</h4></div>`;
    html += logistics.map(o => `<div class="notify-row" data-goto-order="${o.id}"><span class="notify-order-no">${esc(o.order_no || '#' + o.id)}</span><span>${esc(o.customer_name || '')}</span><span class="notify-order-date">${o.order_date || ''}</span></div>`).join('');
    html += '</div>';
  }
  if (isEarlyMonth && production.length) {
    html += `<div class="notify-section"><div class="notify-section-header"><span class="notify-section-dot bad"></span><h4>生产成本（${production.length}）</h4></div>`;
    html += production.map(o => `<div class="notify-row" data-goto-order="${o.id}"><span class="notify-order-no">${esc(o.order_no || '#' + o.id)}</span><span>${esc(o.customer_name || '')}</span><span class="notify-order-date">${o.order_date || ''}</span></div>`).join('');
    html += '</div>';
  }
  if (reminders.length) {
    html += `<div class="notify-section"><div class="notify-section-header"><span class="notify-section-dot brand"></span><h4>管理端提醒（${reminders.length}）</h4></div>`;
    html += reminders.map(o => `<div class="notify-row"><span class="notify-order-no">${esc(o.order_no || '#' + o.id)}</span><span>${esc(o.reminder_text || '需要更新')}</span><span class="notify-order-date">${o.order_date || ''}</span><button class="notify-clear-btn" data-clear-reminder="${o.id}" title="标记已读">已读</button></div>`).join('');
    html += '</div>';
  }
  if (!html) html = '<div class="notify-empty"><svg class="notify-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>暂无待处理项</div>';
  const content = $('notifyContent');
  if (content) content.innerHTML = html;
}

document.addEventListener("DOMContentLoaded", async () => {
  const authReady = await window.TwodrapesAuthUI?.init({
    toast,
    verifyChannel: "management",
    currentApp: "management",
    allowAccess: (user) => user?.role === "admin",
    accessDeniedMessage: "仅管理员可进入管理端"
  });
  if (!authReady) return;

  initTabs();

  try {
    const boot = await json("/api/bootstrap");
    if (boot.rates) rates = boot.rates;
  } catch (e) {
    /* use defaults */
  }

  initFilterFields();
  ["summarySearchInput", "summaryDateFrom", "summaryDateTo", "summaryChannelFilter", "summaryStatusFilter"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener(id === "summarySearchInput" ? "input" : "change", () => {
      updateFilterFieldState(el);
      renderSummaryTable(allOrdersCache);
      renderSummaryFilterChips();
    });
  });
  renderSummaryFilterChips();
  document.querySelectorAll(".period-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".period-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      setPeriod(btn.dataset.period);
      renderSummaryTable(allOrdersCache);
      renderSummaryFilterChips();
    });
  });
  $("summaryRefreshBtn")?.addEventListener("click", () => loadSummary());
  $("summaryExportBtn")?.addEventListener("click", () => {
    const channel = $("summaryChannelFilter")?.value || "";
    const status = $("summaryStatusFilter")?.value || "";
    const params = new URLSearchParams();
    if (channel) params.set("channel", channel);
    if (status) params.set("status", status);
    location.href = "/api/export/summary-csv" + (params.toString() ? "?" + params : "");
  });
  $("summaryFullExportBtn")?.addEventListener("click", async () => {
    try {
      const res = await fetch('/api/export/orders-full-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [] })
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || '导出失败'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `订单全部信息-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast('已导出全部订单信息');
    } catch (e) { toast(e.message, 'bad'); }
  });
  $("summaryTable")?.addEventListener("click", async (e) => {
    const link = e.target.closest("[data-view-order]");
    if (link) return viewOrderModal(link.dataset.viewOrder);
    const reminderBtn = e.target.closest("[data-toggle-reminder]");
    if (reminderBtn) {
      const orderId = reminderBtn.dataset.toggleReminder;
      const order = allOrdersCache.find(o => String(o.id) === String(orderId));
      if (!order) return;
      const newReminder = order.reminder ? 0 : 1;
      await json(`/api/orders/${orderId}/reminder`, {
        method: 'PUT',
        body: JSON.stringify({ reminder: newReminder, reminder_text: order.reminder_text })
      });
      toast(newReminder ? '已标记提醒' : '已取消提醒');
      loadSummary();
    }
  });

  ["analyticsDateFrom", "analyticsDateTo", "analyticsProductFilter"].forEach((id) => {
    $(id)?.addEventListener("change", () => loadAnalytics());
  });
  document.querySelectorAll(".analytics-product-sort").forEach((sel) => {
    sel.addEventListener("change", () => renderChannelProductTable(sel.dataset.channel));
  });
  $("analyticsRefreshBtn")?.addEventListener("click", () => loadAnalytics());
  $("analyticsResetBtn")?.addEventListener("click", () => resetAnalyticsFilters());
  document.querySelectorAll(".analytics-channel-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchAnalyticsChannel(btn.dataset.analyticsChannel));
  });

  $("refreshParamsBtn")?.addEventListener("click", () => loadParams());
  $("saveParamsBtn")?.addEventListener("click", () => saveParams());
  document.addEventListener("click", (e) => {
    if (e.target?.dataset?.action === "add-material") appendMaterialRow(e.target.dataset.type);
    if (e.target?.dataset?.action === "delete-material") { if (confirm('确认删除此材料？')) e.target.closest("tr")?.remove(); }
  });

  initUsers();
  loadSummary().then(() => renderNotifyPanel());
  if ($("paramsStatus")) loadParams();
  activateTabFromHash();

  if ($('notifyBtn')) $('notifyBtn').onclick = () => {
    const panel = $('notifyPanel');
    if (panel.classList.contains('hidden')) { renderNotifyPanel(); panel.classList.remove('hidden'); }
    else panel.classList.add('hidden');
  };
  document.addEventListener('click', async e => {
    if (!e.target.closest('.notify-wrap')) $('notifyPanel')?.classList.add('hidden');
    const gotoOrder = e.target.closest('[data-goto-order]');
    if (gotoOrder) {
      const orderId = gotoOrder.dataset.gotoOrder;
      $('notifyPanel')?.classList.add('hidden');
      viewOrderModal(Number(orderId));
      return;
    }
    const clearBtn = e.target.closest('[data-clear-reminder]');
    if (clearBtn) {
      const orderId = clearBtn.dataset.clearReminder;
      try {
        await json(`/api/orders/${orderId}/reminder`, { method: 'PUT', body: JSON.stringify({ reminder: 0, reminder_text: null }) });
        renderNotifyPanel();
        loadSummary();
      } catch (err) { toast(err.message, 'bad'); }
    }
  });
});
