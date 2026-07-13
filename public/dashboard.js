(function () {
  const realtimeTransport = window.__REALTIME_TRANSPORT__ || 'socket';
  const socket = realtimeTransport === 'socket' && typeof io === 'function' ? io() : null;
  const rowsById = new Map(
    Array.from(document.querySelectorAll('[data-order-row]')).map((row) => [row.dataset.orderId, row]),
  );
  const visibleCountEl = document.querySelector('.pill');
  const tableBody = document.querySelector('[data-orders-body]');
  const emptyState = document.querySelector('[data-empty-state]');
  const tableWrap = document.querySelector('[data-orders-table]');
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

  function setText(parent, selector, value) {
    const element = parent.querySelector(selector);
    if (element) {
      element.textContent = value || '';
    }
  }

  function createStatusForm(order, status, label, className) {
    const form = document.createElement('form');
    form.method = 'post';
    form.action = `/orders/${order.id}/status`;

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'status';
    input.value = status;

    const button = document.createElement('button');
    button.className = `btn ${className} btn-sm`;
    button.type = 'submit';
    button.textContent = label;

    form.append(input, button);
    return form;
  }

  function updateActions(row, order) {
    const actionRow = row.querySelector('[data-order-actions]');
    if (!actionRow) {
      return;
    }

    actionRow.replaceChildren();
    if (order.status !== 'preparing') {
      actionRow.appendChild(createStatusForm(order, 'preparing', 'Em preparo', 'btn-secondary'));
    }
    if (order.status !== 'ready') {
      actionRow.appendChild(createStatusForm(order, 'ready', 'Pronto', 'btn-primary'));
    }
    if (order.status !== 'delivered') {
      actionRow.appendChild(createStatusForm(order, 'delivered', 'Entregue', 'btn-ghost'));
    }
  }

  function createOrderRow(order) {
    const row = document.createElement('tr');
    row.dataset.orderRow = '';
    row.dataset.orderId = order.id;
    row.innerHTML = `
      <td><strong data-order-number></strong></td>
      <td><strong data-order-customer></strong></td>
      <td><span class="cell-muted" data-order-items></span></td>
      <td><span data-order-status></span></td>
      <td class="cell-muted" data-order-updated></td>
      <td><a class="btn btn-ghost btn-sm" data-order-qr>Abrir</a></td>
      <td><div class="action-row" data-order-actions></div></td>
    `;
    return row;
  }

  function updateEmptyState() {
    const hasRows = rowsById.size > 0;
    if (emptyState) {
      emptyState.hidden = hasRows;
    }
    if (tableWrap) {
      tableWrap.hidden = !hasRows;
    }
  }

  function updateStats() {
    if (visibleCountEl) {
      visibleCountEl.textContent = `${rowsById.size} visíveis`;
    }

    const counts = {
      active: 0,
      preparing: 0,
      ready: 0,
    };

    rowsById.forEach((row) => {
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
    updateEmptyState();
  }

  function refreshRow(order) {
    if (!order || !order.id) {
      return;
    }

    if (order.status === 'delivered') {
      const row = rowsById.get(order.id);
      if (!row) {
        return;
      }
      row.remove();
      rowsById.delete(order.id);
      updateStats();
      return;
    }

    let row = rowsById.get(order.id);
    if (!row) {
      if (!tableBody) {
        return;
      }
      row = createOrderRow(order);
      tableBody.prepend(row);
      rowsById.set(order.id, row);
    }

    setText(row, '[data-order-number]', order.numberLabel);
    setText(row, '[data-order-customer]', order.customerName);
    setText(row, '[data-order-items]', order.items);
    setText(row, '[data-order-updated]', order.updatedAtFormatted);

    const qrLink = row.querySelector('[data-order-qr]');
    if (qrLink) {
      qrLink.href = `/orders/${order.id}/qr`;
    }

    const statusBadge = row.querySelector('[data-order-status]');
    if (statusBadge) {
      statusBadge.textContent = statusLabel(order.status);
      statusBadge.dataset.status = order.status;
      statusBadge.className = `status-badge ${statusClass(order.status)}`;
    }

    updateActions(row, order);

    row.classList.remove('is-pulsing');
    void row.offsetWidth;
    row.classList.add('is-pulsing');
    updateStats();
  }

  function reconcileRows(orders) {
    const nextIds = new Set((orders || []).map((order) => order.id));
    rowsById.forEach((row, id) => {
      if (!nextIds.has(id)) {
        row.remove();
        rowsById.delete(id);
      }
    });
    (orders || []).forEach(refreshRow);
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
      const orders = payload.orders || [];
      const signature = orders.map((order) => `${order.id}:${order.status}:${order.updatedAt}`).join('|');

      if (signature !== lastSignature) {
        reconcileRows(orders);
        lastSignature = signature;
        return;
      }

      updateStats();
    } catch {
      // keep dashboard usable if polling fails
    }
  }

  if (socket) {
    socket.on('order:created', (order) => {
      refreshRow(order);
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
