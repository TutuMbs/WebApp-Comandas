(function () {
  const lists = {
    preparing: document.querySelector('[data-call-list="preparing"]'),
    ready: document.querySelector('[data-call-list="ready"]'),
  };
  const countEls = {
    preparing: document.querySelector('[data-preparing-count]'),
    ready: document.querySelector('[data-ready-count]'),
  };
  const clockEl = document.querySelector('[data-call-clock]');
  const durationInput = document.querySelector('[data-alert-duration]');
  const overlay = document.querySelector('[data-ready-overlay]');
  const overlayName = document.querySelector('[data-ready-overlay-name]');
  const overlayNumber = document.querySelector('[data-ready-overlay-number]');
  const saveState = document.querySelector('[data-settings-save-state]');
  const fullscreenLinks = document.querySelectorAll('[data-open-fullscreen]');
  const STORAGE_KEY = 'callPanelAlertDurationSeconds';
  const DEFAULT_ALERT_SECONDS = 3;
  const hasPanel = Boolean(lists.preparing || lists.ready);

  let knownReadyIds = new Set(
    Array.from(document.querySelectorAll('[data-call-list="ready"] [data-call-ticket]')).map(
      (ticket) => ticket.dataset.orderId,
    ),
  );
  let overlayTimer = null;
  let firstSync = true;

  function getAlertDurationMs() {
    const storedValue = Number(window.localStorage.getItem(STORAGE_KEY));
    const inputValue = Number(durationInput?.value || storedValue || DEFAULT_ALERT_SECONDS);
    const seconds = Number.isFinite(inputValue) ? Math.min(Math.max(inputValue, 1), 30) : DEFAULT_ALERT_SECONDS;
    return seconds * 1000;
  }

  function createTicket(order) {
    const ticket = document.createElement('article');
    ticket.className = 'call-ticket';
    ticket.dataset.callTicket = '';
    ticket.dataset.orderId = order.id;

    const number = document.createElement('span');
    number.textContent = order.numberLabel;

    const customer = document.createElement('strong');
    customer.textContent = order.customerName || 'Sem nome';

    const times = document.createElement('div');
    times.className = 'call-ticket-times';
    [
      ['Pedido', order.createdAtTime],
      ['Preparo', order.preparingAtTime],
      ['Pronto', order.readyAtTime],
    ].forEach(([label, value]) => {
      const item = document.createElement('small');
      const time = document.createElement('b');
      item.append(`${label} `, time);
      time.textContent = value || '-';
      times.appendChild(item);
    });

    ticket.append(number, customer, times);
    return ticket;
  }

  function renderList(status, orders) {
    const list = lists[status];
    if (!list) {
      return;
    }

    list.replaceChildren();
    if (orders.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'call-list-empty';
      empty.textContent = 'Nenhum pedido';
      list.appendChild(empty);
    } else {
      orders.forEach((order) => {
        list.appendChild(createTicket(order));
      });
    }

    if (countEls[status]) {
      countEls[status].textContent = orders.length;
    }
  }

  function showReadyOverlay(order) {
    if (!overlay || !overlayName || !overlayNumber) {
      return;
    }

    window.clearTimeout(overlayTimer);
    overlayName.textContent = order.customerName || 'Sem nome';
    overlayNumber.textContent = order.numberLabel || '';
    overlay.hidden = false;
    overlay.classList.remove('is-showing');
    void overlay.offsetWidth;
    overlay.classList.add('is-showing');

    overlayTimer = window.setTimeout(() => {
      overlay.hidden = true;
      overlay.classList.remove('is-showing');
    }, getAlertDurationMs());
  }

  function reconcile(orders) {
    const preparingOrders = orders.filter((order) => order.status === 'preparing');
    const readyOrders = orders.filter((order) => order.status === 'ready');
    const nextReadyIds = new Set(readyOrders.map((order) => order.id));

    if (!firstSync) {
      const newlyReady = readyOrders.find((order) => !knownReadyIds.has(order.id));
      if (newlyReady) {
        showReadyOverlay(newlyReady);
      }
    }

    renderList('preparing', preparingOrders);
    renderList('ready', readyOrders);
    knownReadyIds = nextReadyIds;
    firstSync = false;
  }

  function updateClock() {
    if (!clockEl) {
      return;
    }

    clockEl.textContent = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }).format(new Date());
  }

  async function syncPanel() {
    try {
      const response = await fetch('/api/painel', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });

      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      reconcile(payload.orders || []);
    } catch {
      // the next one-second tick will try again
    }
  }

  if (durationInput) {
    const storedValue = Number(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(storedValue) && storedValue >= 1 && storedValue <= 30) {
      durationInput.value = String(storedValue);
    }

    durationInput.addEventListener('change', () => {
      const seconds = getAlertDurationMs() / 1000;
      durationInput.value = String(seconds);
      window.localStorage.setItem(STORAGE_KEY, String(seconds));
      if (saveState) {
        saveState.textContent = `Salvo: ${seconds}s`;
      }
    });
  }

  fullscreenLinks.forEach((link) => {
    link.addEventListener('click', () => {
      window.sessionStorage.setItem('callPanelRequestFullscreen', '1');
    });
  });

  if (document.body.classList.contains('call-panel-fullscreen-page')) {
    const shouldRequestFullscreen = window.sessionStorage.getItem('callPanelRequestFullscreen') === '1';
    window.sessionStorage.removeItem('callPanelRequestFullscreen');
    if (shouldRequestFullscreen && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  if (hasPanel) {
    Object.keys(lists).forEach((status) => {
      const list = lists[status];
      if (list && list.children.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'call-list-empty';
        empty.textContent = 'Nenhum pedido';
        list.appendChild(empty);
      }
    });
    updateClock();
    syncPanel();
    window.setInterval(updateClock, 1000);
    window.setInterval(syncPanel, 1000);
  }
})();
