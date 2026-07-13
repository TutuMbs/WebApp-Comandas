(function () {
  const realtimeTransport = window.__REALTIME_TRANSPORT__ || 'socket';
  const socket = realtimeTransport === 'socket' && typeof io === 'function' ? io() : null;
  const rowsById = new Map(
    Array.from(document.querySelectorAll('[data-order-row]')).map((row) => [row.dataset.orderId, row]),
  );
  const activeCountEl = document.querySelector('.stats-grid .stat-card strong');
  const visibleCountEl = document.querySelector('.pill');
  const searchParams = new URLSearchParams(window.location.search);
  let lastSignature = Array.from(rowsById.values())
    .map((row) => `${row.dataset.orderId}:${row.querySelector('[data-order-status]')?.dataset.status || ''}`)
    .join('|');

  function statusLabel(status) {
    const map = {
      awaiting: 'Aguardando',
      preparing: 'Em preparo',
      ready: 'Pronto',
      delivered: 'Entregue',
    };
    return map[status] || status;
  }

  function statusClass(status) {
    return `status-${status}`;
  }

  function updateStats() {
    if (visibleCountEl) {
      visibleCountEl.textContent = `${document.querySelectorAll('[data-order-row]').length} visíveis`;
    }

    const counts = {
      active: 0,
      preparing: 0,
      ready: 0,
    };

    document.querySelectorAll('[data-order-row]').forEach((row) => {
      const badge = row.querySelector('[data-order-status]');
      if (!badge) return;
      const status = badge.dataset.status;
      counts.active += 1;
      if (status === 'preparing') counts.preparing += 1;
      if (status === 'ready') counts.ready += 1;
    });

    const statCards = document.querySelectorAll('.stats-grid .stat-card strong');
    if (statCards[0]) statCards[0].textContent = counts.active;
    if (statCards[1]) statCards[1].textContent = counts.preparing;
    if (statCards[2]) statCards[2].textContent = counts.ready;
  }

  async function syncDashboard() {
    try {
      const query = searchParams.toString();
      const response = await fetch(`/api/dashboard${query ? `?${query}` : ''}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });

      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      const signature = (payload.orders || [])
        .map((order) => `${order.id}:${order.status}`)
        .join('|');

      if (signature !== lastSignature) {
        window.location.reload();
        return;
      }

      lastSignature = signature;
      updateStats();
    } catch {
      // keep dashboard usable if polling fails
    }
  }

  function refreshRow(order) {
    const row = rowsById.get(order.id);
    if (!row) {
      return;
    }

    if (order.status === 'delivered') {
      row.remove();
      rowsById.delete(order.id);
      updateStats();
      return;
    }

    const statusBadge = row.querySelector('[data-order-status]');
    if (statusBadge) {
      statusBadge.textContent = statusLabel(order.status);
      statusBadge.dataset.status = order.status;
      statusBadge.className = `status-badge ${statusClass(order.status)}`;
    }

    const statusCell = row.querySelector('[data-order-status]');
    if (statusCell) {
      statusCell.className = `status-badge ${statusClass(order.status)}`;
    }

    row.classList.remove('is-pulsing');
    void row.offsetWidth;
    row.classList.add('is-pulsing');
    updateStats();
  }

  if (socket) {
    socket.on('order:created', () => {
      window.location.reload();
    });

    socket.on('order:updated', (order) => {
      refreshRow(order);
    });
  } else {
    setInterval(syncDashboard, realtimeTransport === 'polling' ? 2000 : 5000);
    syncDashboard();
  }

  updateStats();
})();
