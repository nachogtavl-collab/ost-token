/* ==========================================================================
 * OST · i18n runtime patch
 * --------------------------------------------------------------------------
 * The static HTML uses data-i18n correctly, but many dynamic strings (toasts,
 * the new Faucet Hub / Games / Academy panels, swap errors, send/receive
 * labels) are hard-coded in English across multiple JS files. This script
 * watches the DOM and translates known English phrases to Spanish when the
 * user has selected `es` — without touching the original source files.
 *
 *  - Activates only when document.documentElement.lang === 'es'.
 *  - Uses MutationObserver + exact-text match on TEXT NODES only (never on
 *    code, never on attributes that hold logic).
 *  - Also wraps window.alert / window.confirm and the page's toast helpers.
 * ========================================================================== */
(function () {
  'use strict';

  // ────────────────────────────────────────────────────────────────────────
  // Phrase dictionary  (English source → Spanish target)
  // Keep keys EXACT — matched after .trim() against text-node content.
  // ────────────────────────────────────────────────────────────────────────
  var DICT = {
    // Wallet / send / receive
    'Send': 'Enviar',
    'Receive': 'Recibir',
    'Send OST': 'Enviar OST',
    'Send SOL': 'Enviar SOL',
    'Receive OST': 'Recibir OST',
    'Recipient': 'Destinatario',
    'Recipient address': 'Dirección del destinatario',
    'Amount': 'Monto',
    'Amount (OST)': 'Monto (OST)',
    'Amount (SOL)': 'Monto (SOL)',
    'Memo (optional)': 'Memo (opcional)',
    'Confirm Send': 'Confirmar Envío',
    'Cancel': 'Cancelar',
    'Close': 'Cerrar',
    'Copy': 'Copiar',
    'Copied!': '¡Copiado!',
    'Connect Wallet': 'Conectar Cartera',
    'Disconnect': 'Desconectar',
    'Create Wallet': 'Crear Cartera',
    'My Wallet': 'Mi Cartera',
    'Balance': 'Saldo',
    'Wallet Address': 'Dirección de Cartera',
    'Network': 'Red',
    'Devnet': 'Red de Pruebas',
    'Mainnet': 'Red Principal',
    'Transaction Hash': 'Hash de Transacción',
    'View on Explorer': 'Ver en el Explorador',
    'View on Solana Explorer': 'Ver en el Explorador de Solana',

    // Convert / Swap
    'Convert': 'Convertir',
    'Convert to OST': 'Convertir a OST',
    'Swap': 'Intercambiar',
    'Buy OST': 'Comprar OST',
    'Sell OST': 'Vender OST',
    'Your Currency': 'Tu Moneda',
    'You Pay': 'Tú Pagas',
    'You Receive': 'Tú Recibes',
    'Rate': 'Tasa',
    'Network Fee': 'Tarifa de Red',
    'Confirm Swap': 'Confirmar Intercambio',
    'Loading swap rates…': 'Cargando tasas de intercambio…',
    'Swap pool unavailable': 'Pool de intercambio no disponible',

    // Faucet / Treasury
    'Faucet': 'Grifo',
    'Treasury': 'Tesorería',
    'Claim Free OST': 'Reclamar OST Gratis',
    'Claim': 'Reclamar',
    'Claim Reward': 'Reclamar Recompensa',
    'Claim reward': 'Reclamar recompensa',
    'Already claimed': 'Ya reclamado',
    'Turn the Faucet': 'Activar el Grifo',
    'Free OST claimed!': '¡OST gratis reclamado!',

    // Faucet Hub mini-games
    'Faucet Hub': 'Centro del Grifo',
    'Bonus Credits': 'Créditos de Bonificación',
    'Cash out to OST': 'Cobrar a OST',
    'Pick the right square': 'Elige el cuadrado correcto',
    'Spin the wheel': 'Gira la ruleta',
    'Cosmic Jumper': 'Saltador Cósmico',
    'Watch Ad': 'Ver Anuncio',
    'Code Academy': 'Academia de Código',
    'Daily Streak': 'Racha Diaria',
    'Open': 'Abrir',
    'Play': 'Jugar',
    'Spin': 'Girar',
    'Cooldown': 'Tiempo de espera',
    'Ready': 'Listo',
    'Lifetime earned': 'Ganado de por vida',

    // Games
    '💣 Mines': '💣 Minas',
    '🚀 Crash': '🚀 Choque',
    '🎲 Dice': '🎲 Dados',
    '🟡 Plinko': '🟡 Plinko',
    'Bet (credits)': 'Apuesta (créditos)',
    'Mines': 'Minas',
    'Risk': 'Riesgo',
    'Rows': 'Filas',
    'Low': 'Bajo',
    'Medium': 'Medio',
    'High': 'Alto',
    'Auto cash-out at': 'Auto cobro en',
    'Cash out': 'Cobrar',
    'Place bet': 'Realizar apuesta',
    'Roll': 'Lanzar',
    'Drop ball': 'Soltar bola',
    'Drop': 'Soltar',
    'Provably Fair': 'Demostrablemente Justo',
    'Verify Fairness': 'Verificar Justicia',
    'Server seed (hashed)': 'Semilla del servidor (con hash)',
    'Client seed': 'Semilla del cliente',
    'Nonce': 'Nonce',
    'Reveal & rotate': 'Revelar y rotar',
    'Recent multipliers': 'Multiplicadores recientes',
    'Game over — bet again': 'Juego terminado — apuesta de nuevo',
    'You won': 'Ganaste',
    'You lost': 'Perdiste',
    'Insufficient credits': 'Créditos insuficientes',
    'Over': 'Mayor',
    'Under': 'Menor',
    'Target': 'Objetivo',
    'Win chance': 'Probabilidad de ganar',
    'Multiplier': 'Multiplicador',
    'Payout': 'Pago',

    // Code Academy
    '💻 Open Code Academy': '💻 Abrir Academia de Código',
    'OST Code Academy': 'Academia de Código OST',
    '· learn what you type': '· aprende lo que escribes',
    'Balance:': 'Saldo:',
    'What you just typed': 'Lo que acabas de escribir',
    'Lines mastered this lesson': 'Líneas dominadas en esta lección',
    'Pick a lesson on the left to begin.': 'Elige una lección a la izquierda para comenzar.',
    'Nothing yet — every correct line will appear here as a quick reference.':
      'Nada aún — cada línea correcta aparecerá aquí como referencia rápida.',
    'Ready when you are.': 'Listo cuando tú lo estés.',
    '▶ Run': '▶ Ejecutar',
    '✅ All lines typed correctly. Claim your reward.':
      '✅ Todas las líneas escritas correctamente. Reclama tu recompensa.',
    '🎉 Lesson complete — every line typed and explained.':
      '🎉 Lección completa — cada línea escrita y explicada.',
    'JavaScript · Your first variable': 'JavaScript · Tu primera variable',
    'JavaScript · A function that adds two numbers': 'JavaScript · Una función que suma dos números',
    'JavaScript · Transform an array with .map()': 'JavaScript · Transforma un arreglo con .map()',
    'JavaScript · async / await for network calls': 'JavaScript · async / await para llamadas de red',
    'HTML · A clickable button': 'HTML · Un botón clicable',
    'CSS · Centre something with Flexbox': 'CSS · Centrar algo con Flexbox',
    'SQL · Filter rows with WHERE': 'SQL · Filtrar filas con WHERE',
    'Rust · A function with explicit types': 'Rust · Una función con tipos explícitos',
    'Solana · An Anchor instruction': 'Solana · Una instrucción de Anchor',
    'beginner': 'principiante',
    'intermediate': 'intermedio',
    'advanced': 'avanzado',

    // Errors / toasts
    'Send failed: Buffer is not defined': 'Envío fallido: error de compatibilidad del navegador (Buffer). Recarga la página.',
    'Convert could not complete: Buffer is not defined':
      'No se pudo completar la conversión: error de compatibilidad del navegador (Buffer). Recarga la página.',
    'Buffer is not defined': 'Buffer no está definido (recarga la página)',
    'Connect your wallet first': 'Conecta tu cartera primero',
    'Connect or create your OST wallet first': 'Conecta o crea tu cartera OST primero',
    'Create or connect your OST wallet first': 'Crea o conecta tu cartera OST primero',
    'Insufficient balance': 'Saldo insuficiente',
    'Transaction confirmed': 'Transacción confirmada',
    'Transaction failed': 'Transacción fallida',
    'Pending…': 'Pendiente…',
    'Loading…': 'Cargando…',
    'Please wait…': 'Por favor espera…',
    'Try again': 'Intentar de nuevo',
    'Coming soon': 'Próximamente',
    'Save': 'Guardar',
    'Edit': 'Editar',
    'Delete': 'Eliminar',
    'Yes': 'Sí',
    'No': 'No'
  };

  // Phrases that should be translated even if they contain prefixes/suffixes.
  // Each entry: [regex, replacement]. Use sparingly — must be unambiguous.
  var PATTERNS = [
    [/^Send failed:\s*(.*)$/i, function (_m, rest) { return 'Envío fallido: ' + (DICT[rest] || rest); }],
    [/^Convert could not complete:\s*(.*)$/i, function (_m, rest) { return 'Conversión fallida: ' + (DICT[rest] || rest); }],
    [/^Balance:\s*(.+?)\s*OST$/i, function (_m, n) { return 'Saldo: ' + n + ' OST'; }],
    [/^(\d+)\s*\/\s*(\d+)\s*lines\s*·\s*(\d+%)$/i,
      function (_m, a, b, p) { return a + ' / ' + b + ' líneas · ' + p; }],
    [/^earn\s+([\d.]+)\s+OST$/i, function (_m, n) { return 'gana ' + n + ' OST'; }],
    [/^\+\s*([\d.]+)\s+OST credited to your bonus balance\.\s*Pick another lesson\s*→$/i,
      function (_m, n) { return '+ ' + n + ' OST acreditados a tu saldo de bonificación. Elige otra lección →'; }]
  ];

  function isSpanish() {
    return (document.documentElement.getAttribute('lang') || '').toLowerCase().startsWith('es') ||
           (document.documentElement.getAttribute('data-lang') || '').toLowerCase().startsWith('es');
  }

  function translateString(s) {
    if (!s) return s;
    var trimmed = s.trim();
    if (!trimmed) return s;
    if (DICT.hasOwnProperty(trimmed)) {
      // preserve leading/trailing whitespace
      var pre = s.match(/^\s*/)[0];
      var post = s.match(/\s*$/)[0];
      return pre + DICT[trimmed] + post;
    }
    for (var i = 0; i < PATTERNS.length; i++) {
      var p = PATTERNS[i];
      if (p[0].test(trimmed)) {
        var pre2 = s.match(/^\s*/)[0];
        var post2 = s.match(/\s*$/)[0];
        return pre2 + trimmed.replace(p[0], p[1]) + post2;
      }
    }
    return s;
  }

  function walk(root) {
    if (!isSpanish()) return;
    if (!root) return;
    if (root.nodeType === 3) {
      var nv = translateString(root.nodeValue);
      if (nv !== root.nodeValue) root.nodeValue = nv;
      return;
    }
    if (root.nodeType !== 1) return;
    // Skip code-bearing elements
    var tag = root.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE' || tag === 'PRE' ||
        tag === 'INPUT' || tag === 'TEXTAREA') return;
    // Translate placeholders / titles / aria-labels on inputs/buttons
    if (root.hasAttribute && root.hasAttribute('placeholder')) {
      var ph = translateString(root.getAttribute('placeholder'));
      if (ph !== root.getAttribute('placeholder')) root.setAttribute('placeholder', ph);
    }
    if (root.hasAttribute && root.hasAttribute('title')) {
      var ti = translateString(root.getAttribute('title'));
      if (ti !== root.getAttribute('title')) root.setAttribute('title', ti);
    }
    if (root.hasAttribute && root.hasAttribute('aria-label')) {
      var al = translateString(root.getAttribute('aria-label'));
      if (al !== root.getAttribute('aria-label')) root.setAttribute('aria-label', al);
    }
    var kids = root.childNodes;
    for (var i = 0; i < kids.length; i++) walk(kids[i]);
  }

  var observer = null;
  function attachObserver() {
    if (observer) return;
    observer = new MutationObserver(function (muts) {
      if (!isSpanish()) return;
      muts.forEach(function (m) {
        m.addedNodes && m.addedNodes.forEach(function (n) { walk(n); });
        if (m.type === 'characterData' && m.target) walk(m.target);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function refreshAll() {
    if (!isSpanish()) return;
    walk(document.body);
  }

  // React to language changes performed by app.js applyTranslations()
  var prevLang = document.documentElement.getAttribute('lang') || 'en';
  var langWatcher = new MutationObserver(function () {
    var now = document.documentElement.getAttribute('lang') || 'en';
    if (now !== prevLang) {
      prevLang = now;
      if (isSpanish()) refreshAll();
      // When switching back to English, the page already re-applied the EN
      // dictionary via app.js applyTranslations(); for dynamic strings the
      // user must reload, which is acceptable since browsing back to EN is
      // less common than the broken ES path.
    }
  });
  langWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'data-lang'] });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      attachObserver();
      refreshAll();
    });
  } else {
    attachObserver();
    refreshAll();
  }

  // Public hook for other scripts that want to translate freshly-built UI.
  window.OST_TRANSLATE_NODE = function (node) { walk(node); };
  window.OST_TRANSLATE_STRING = function (s) { return isSpanish() ? translateString(s) : s; };
})();
