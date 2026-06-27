(function () {
  let booted = false;

  function fallbackToast(message, type) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = String(message || '');
    el.className = `toast show ${type || ''}`.trim();
    clearTimeout(fallbackToast._timer);
    fallbackToast._timer = setTimeout(() => {
      el.className = 'toast';
    }, 2200);
  }

  async function bootAuth() {
    if (booted) return;
    if (!window.TwodrapesAuthUI?.init) return;
    booted = true;
    try {
      const context = window.TwodrapesAppContext || {};
      const verifyChannel = context.channel === 'amazon' ? 'amazon' : 'shopify';
      await window.TwodrapesAuthUI.init({
        toast: fallbackToast,
        verifyChannel,
        currentApp: context.app || verifyChannel,
        allowAccess: () => true
      });
    } catch (_) {
      booted = false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootAuth, { once: true });
  } else {
    bootAuth();
  }
})();
