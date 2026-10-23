(function () {
  var booting = true;
  function showError(title, detail) {
    if (!booting) return;
    var panel = document.getElementById('boot-status');
    if (!panel) return;
    panel.className = 'error';
    var heading = document.createElement('h1');
    heading.textContent = title;
    var message = document.createElement('p');
    message.textContent = '請重新整理；若持續發生，請提供下方錯誤資訊。';
    var info = document.createElement('pre');
    info.textContent = String(detail || '');
    panel.replaceChildren(heading, message, info);
  }
  window.__hideBootStatus = function () {
    booting = false;
    var panel = document.getElementById('boot-status');
    if (panel) panel.style.display = 'none';
  };
  window.__showBootError = showError;
  window.addEventListener('error', function (event) {
    showError('系統啟動失敗', event.message || '資源載入失敗');
  });
  window.addEventListener('unhandledrejection', function (event) {
    showError('系統啟動失敗', event.reason instanceof Error ? event.reason.message : String(event.reason));
  });
  setTimeout(function () { showError('系統啟動逾時', '請確認網路連線，重新整理後再試。'); }, 10000);
})();
