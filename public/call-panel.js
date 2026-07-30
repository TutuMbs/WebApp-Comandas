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
  const soundButtons = document.querySelectorAll('[data-panel-sound]');
  const STORAGE_KEY = 'callPanelAlertDurationSeconds';
  const DEFAULT_ALERT_SECONDS = 3;
  const hasPanel = Boolean(lists.preparing || lists.ready);

  let knownReadyIds = new Set(
    Array.from(document.querySelectorAll('[data-call-list="ready"] [data-call-ticket]')).map(
      (ticket) => ticket.dataset.orderId,
    ),
  );
  let knownReadyRevisions = new Map();
  let overlayTimer = null;
  let firstSync = true;
  let audioContext = null;
  let soundReady = false;

  document.querySelectorAll('[data-call-list="ready"] [data-call-ticket]').forEach((ticket) => {
    knownReadyRevisions.set(ticket.dataset.orderId, Number(ticket.dataset.alertRevision || 0));
  });

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

    if (order.status === 'ready') {
      const actions = document.createElement('div');
      actions.className = 'call-ticket-actions';

      const resendButton = document.createElement('button');
      resendButton.className = 'btn btn-secondary btn-sm';
      resendButton.type = 'button';
      resendButton.dataset.resendAlert = '';
      resendButton.dataset.orderId = order.id;
      resendButton.textContent = 'Reenviar aviso';

      actions.appendChild(resendButton);
      ticket.appendChild(actions);
    }

    return ticket;
  }

  function updateSoundButtons() {
    soundButtons.forEach((button) => {
      button.textContent = soundReady ? 'Som ativado' : 'Ativar som';
      button.classList.toggle('btn-primary', soundReady);
      button.classList.toggle('btn-secondary', !soundReady);
    });
  }

  async function enableSound() {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      soundButtons.forEach((button) => {
        button.textContent = 'Som indisponível';
        button.disabled = true;
      });
      return false;
    }

    if (!audioContext) {
      audioContext = new AudioContextConstructor();
    }
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    soundReady = true;
    updateSoundButtons();
    playPanelSound({ test: true });
    return true;
  }

  function playPanelSound(options = {}) {
    if (!soundReady || !audioContext) {
      return;
    }

    const scheduleSound = () => {
      const now = audioContext.currentTime;
      const volume = options.test ? 0.25 : 0.72;
      const pattern = options.test
        ? [0, 0.18, 0.36]
        : [0, 0.16, 0.32, 0.48, 0.64, 0.8, 0.96, 1.12, 1.28, 1.44, 1.6, 1.76];

      pattern.forEach((offset, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = index % 2 === 0 ? 'square' : 'sawtooth';
        oscillator.frequency.setValueAtTime(index % 2 === 0 ? 1240 : 1568, now + offset);
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(volume, now + offset + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.13);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.15);
      });
    };

    if (audioContext.state === 'suspended') {
      audioContext.resume().then(scheduleSound).catch(() => {});
      return;
    }

    scheduleSound();
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
    playPanelSound();

    overlayTimer = window.setTimeout(() => {
      overlay.hidden = true;
      overlay.classList.remove('is-showing');
    }, getAlertDurationMs());
  }

  function reconcile(orders) {
    const preparingOrders = orders.filter((order) => order.status === 'preparing');
    const readyOrders = orders.filter((order) => order.status === 'ready');
    const nextReadyIds = new Set(readyOrders.map((order) => order.id));
    const nextReadyRevisions = new Map(readyOrders.map((order) => [order.id, Number(order.alertRevision || 0)]));

    if (!firstSync) {
      const orderToAlert = readyOrders.find((order) => {
        if (!knownReadyIds.has(order.id)) {
          return true;
        }
        return Number(order.alertRevision || 0) > Number(knownReadyRevisions.get(order.id) || 0);
      });
      if (orderToAlert) {
        showReadyOverlay(orderToAlert);
      }
    }

    renderList('preparing', preparingOrders);
    renderList('ready', readyOrders);
    knownReadyIds = nextReadyIds;
    knownReadyRevisions = nextReadyRevisions;
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

  soundButtons.forEach((button) => {
    button.addEventListener('click', () => {
      enableSound().catch(() => {
        button.textContent = 'Erro no som';
      });
    });
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-resend-alert]');
    if (!button) {
      return;
    }

    const orderId = button.dataset.orderId;
    if (!orderId) {
      return;
    }

    button.disabled = true;
    button.textContent = 'Reenviando...';

    try {
      if (!soundReady) {
        await enableSound();
      }

      const response = await fetch(`/orders/${orderId}/notify`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'fetch',
        },
      });

      const payload = await response.json();
      if (!response.ok || !payload.order) {
        throw new Error(payload.error || 'Falha ao reenviar');
      }

      knownReadyRevisions.set(payload.order.id, Number(payload.order.alertRevision || 0));
      showReadyOverlay(payload.order);
      button.textContent = 'Aviso reenviado';
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = 'Reenviar aviso';
      }, 1400);
    } catch {
      button.disabled = false;
      button.textContent = 'Erro ao reenviar';
      window.setTimeout(() => {
        button.textContent = 'Reenviar aviso';
      }, 1800);
    }
  });

  if (document.body.classList.contains('call-panel-fullscreen-page')) {
    const shouldRequestFullscreen = window.sessionStorage.getItem('callPanelRequestFullscreen') === '1';
    window.sessionStorage.removeItem('callPanelRequestFullscreen');
    if (shouldRequestFullscreen && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  if (hasPanel) {
    updateSoundButtons();
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
