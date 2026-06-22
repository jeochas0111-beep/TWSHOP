const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>\"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[m]));

function setStatus(text) {
  $("taxRatesStatus").textContent = text;
}

function renderRows(rows) {
  const body = rows.map((r) => `
    <tr>
      <td><input value="${esc(r.code || "")}" placeholder="CA"></td>
      <td><input value="${esc(r.state || "")}" placeholder="California"></td>
      <td><input type="number" min="0" step="0.01" value="${esc(r.rate ?? "")}" placeholder="7.25"></td>
      <td><input value="${esc(r.note || "")}" placeholder="备注（可选）"></td>
      <td><button class="btn small danger" type="button" onclick="this.closest('tr').remove()">删除</button></td>
    </tr>
  `).join("");

  $("taxRatesTable").innerHTML = `
    <thead>
      <tr>
        <th>州缩写</th>
        <th>州名</th>
        <th>税率 %</th>
        <th>备注</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  `;
}

function collectRows() {
  return [...$("taxRatesTable").querySelectorAll("tbody tr")]
    .map((tr) => {
      const code = tr.children[0].querySelector("input").value.trim().toUpperCase();
      const state = tr.children[1].querySelector("input").value.trim();
      const rate = tr.children[2].querySelector("input").value;
      const note = tr.children[3].querySelector("input").value.trim();
      return { code, state, rate, note };
    })
    .filter((row) => row.code || row.state || row.rate);
}

async function loadTaxRates() {
  const rows = await api.json("/api/tax-rates");
  renderRows(rows);
  setStatus(`已加载 ${rows.length} 条州税率。`);
}

async function saveTaxRates() {
  const rates = collectRows();
  await api.json("/api/tax-rates", {
    method: "PUT",
    body: JSON.stringify({ rates })
  });
  await loadTaxRates();
  setStatus(`保存完成，共 ${rates.length} 条。`);
}

function addRow() {
  const tbody = $("taxRatesTable").querySelector("tbody");
  tbody.insertAdjacentHTML("beforeend", `
    <tr>
      <td><input placeholder="CA"></td>
      <td><input placeholder="California"></td>
      <td><input type="number" min="0" step="0.01" placeholder="7.25"></td>
      <td><input placeholder="备注（可选）"></td>
      <td><button class="btn small danger" type="button" onclick="this.closest('tr').remove()">删除</button></td>
    </tr>
  `);
}

document.addEventListener("DOMContentLoaded", () => {
  $("refreshTaxRatesBtn").onclick = () => loadTaxRates().catch((e) => setStatus(`加载失败：${e.message}`));
  $("saveTaxRatesBtn").onclick = () => saveTaxRates().catch((e) => setStatus(`保存失败：${e.message}`));
  $("addTaxRateRowBtn").onclick = addRow;
  loadTaxRates().catch((e) => setStatus(`加载失败：${e.message}`));
});
