(function () {
  const shell = document.querySelector('[data-order-id]');
  if (!shell) {
    return;
  }

  const orderId = shell.dataset.orderId;
  const realtimeTransport = window.__REALTIME_TRANSPORT__ || 'socket';
  const socket = realtimeTransport === 'socket' && typeof io === 'function' ? io() : null;
  const badge = document.querySelector('[data-order-status]');
  const ring = document.querySelector('[data-status-ring]');
  const soundButton = document.querySelector('[data-activate-sound]');
  const hint = document.querySelector('[data-audio-hint]');

  let audioContext = null;
  let audioReady = false;
  let latestKnownStatus = badge?.dataset.status || null;
  let alertArmed = false;
  let readyAlertPlayed = false;

  if (socket) {
    socket.emit('join-order', { orderId });
  }

  function setStatus(status) {
    const labels = {
      awaiting: 'Aguardando',
      preparing: 'Em preparo',
      ready: 'Pronto',
      delivered: 'Entregue',
    };
    const classes = ['status-awaiting', 'status-preparing', 'status-ready', 'status-delivered'];

    if (!badge || !ring) return;

    badge.textContent = labels[status] || status;
    badge.dataset.status = status;
    badge.classList.remove(...classes);
    badge.classList.add(`status-${status}`);
    ring.classList.remove(...classes);
    ring.classList.add(`status-${status}`);
  }

  function vibrate() {
    if (navigator.vibrate) {
      navigator.vibrate([250, 120, 250, 120, 420]);
    }
  }

  async function ensureAudio() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    audioReady = true;
    if (hint) {
      hint.textContent = 'Aviso sonoro ativado. Você será notificado quando a comanda ficar pronta.';
    }
    if (soundButton) {
      soundButton.textContent = 'Aviso ativado';
      soundButton.classList.remove('btn-primary');
      soundButton.classList.add('btn-secondary');
    }

    if (latestKnownStatus === 'ready' && !readyAlertPlayed) {
      alertReady();
    }
  }

  function beep() {
    if (!audioReady || !audioContext) {
      return;
    }

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.7);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.75);
  }

  function alertReady() {
    readyAlertPlayed = true;
    document.body.classList.add('is-pulsing');
    setTimeout(() => document.body.classList.remove('is-pulsing'), 1600);
    vibrate();
    beep();
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Pedido pronto', {
          body: 'Sua comanda já está liberada para retirada.',
        });
      } catch {
        // ignore notification failures
      }
    }
  }

  async function syncOrder() {
    try {
      const response = await fetch(`/api/orders/${orderId}`, {
        headers: {
          Accept: 'application/json',
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      const order = payload?.order;
      if (!order || !order.status) {
        return;
      }

      const previousStatus = latestKnownStatus;
      if (order.status !== latestKnownStatus) {
        setStatus(order.status);
        latestKnownStatus = order.status;
      }

      if (order.status === 'ready' && previousStatus !== 'ready' && alertArmed && !readyAlertPlayed) {
        alertReady();
      }

      if (order.status === 'delivered' && hint) {
        hint.textContent = 'Pedido entregue. Você pode fechar esta tela.';
      }
    } catch {
      // keep the page working even if the sync request fails
    }
  }

  if (soundButton) {
    soundButton.addEventListener('click', async () => {
      await ensureAudio();
      alertArmed = true;
      if ('Notification' in window && Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
        } catch {
          // ignore permission errors
        }
      }
      beep();
    });
  }

  if (socket) {
    socket.on('connect', syncOrder);

    socket.on('order:updated', (order) => {
      if (!order || order.id !== orderId) return;

      const previousStatus = badge?.dataset.status;
      setStatus(order.status);
      latestKnownStatus = order.status;

      if (order.status === 'ready' && previousStatus !== 'ready') {
        if (audioReady && alertArmed && !readyAlertPlayed) {
          alertReady();
        } else if (hint) {
          hint.textContent = 'A comanda ficou pronta. Toque em "Ativar aviso sonoro" para ouvir o proximo alerta.';
        }
      }

      if (order.status === 'delivered' && hint) {
        hint.textContent = 'Pedido entregue. Voce pode fechar esta tela.';
      }
    });
  }

  syncOrder();
  setInterval(syncOrder, realtimeTransport === 'socket' ? 8000 : 2000);
})();
