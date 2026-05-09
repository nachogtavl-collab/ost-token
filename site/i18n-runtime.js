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

    // First-run preferences / navigation gaps
    'Skip and enter site': 'Saltar y entrar al sitio',
    'Skip welcome and enter site': 'Saltar bienvenida y entrar al sitio',
    'Welcome — Choose Your Preferences': 'Bienvenido — elige tus preferencias',
    'Select your language and primary currency to get started.': 'Selecciona tu idioma y tu moneda principal para empezar.',
    '🌐 Language': '🌐 Idioma',
    '💰 Primary Currency': '💰 Moneda principal',
    'Next → Currency': 'Siguiente → Moneda',
    '← Back': '← Atrás',
    'Enter OST →': 'Entrar a OST →',
    'US Dollar': 'Dólar estadounidense',
    'British Pound': 'Libra esterlina',
    'Canadian Dollar': 'Dólar canadiense',
    'Australian Dollar': 'Dólar australiano',
    'Mexican Peso': 'Peso mexicano',
    'Brazilian Real': 'Real brasileño',
    'Japanese Yen': 'Yen japonés',
    'Chinese Yuan': 'Yuan chino',
    'Russian Ruble': 'Rublo ruso',
    'Indian Rupee': 'Rupia india',
    'Korean Won': 'Won coreano',
    'Turkish Lira': 'Lira turca',
    'Saudi Riyal': 'Riyal saudí',
    'UAE Dirham': 'Dirham de EAU',
    'Stocks': 'Acciones',
    'Launchpad': 'Lanzamientos',
    'Survival': 'Supervivencia',
    'Quantum': 'Cuántico',
    'Legacy': 'Legado',
    'Toggle Ancient Hieroglyphic Mode': 'Cambiar modo jeroglífico antiguo',
    'Legacy Mode Activated': 'Modo legado activado',
    'Espanol': 'Español',

    // Prediction market UI
    'Predict with OST': 'Predice con OST',
    'Prediction venue': 'Mercado de predicciones',
    'Scan live Polymarket and Kalshi markets, read the tape, inspect the ladder, and route an OST ticket without leaving the wallet rail.':
      'Escanea mercados en vivo de Polymarket y Kalshi, lee la cinta, revisa la escalera y envía un ticket OST sin salir de la billetera.',
    'Public venue feeds expose live prices, change anchors, and liquidity. The curve and ladder reflect that data directly without inventing candles or settlement.':
      'Los feeds públicos muestran precios en vivo, cambios y liquidez. La curva y la escalera reflejan esos datos sin inventar velas ni liquidación.',
    'Market pulse': 'Pulso del mercado',
    'Lead contracts, fastest movers, and the markets closing soonest across both venues.':
      'Contratos principales, mayores movimientos y mercados que cierran antes en ambos sitios.',
    'Markets loaded': 'Mercados cargados',
    'Live sources': 'Fuentes en vivo',
    'Breaking now': 'Última hora',
    'Search any contract': 'Buscar cualquier contrato',
    'Bitcoin, Trump, NBA, inflation, Nvidia, weather, election...': 'Bitcoin, Trump, NBA, inflación, Nvidia, clima, elección...',
    'Search live prediction contracts': 'Buscar contratos de predicción en vivo',
    'All venues': 'Todos los mercados',
    'All markets': 'Todos los mercados',
    'Trending': 'Tendencia',
    'Breaking': 'Última hora',
    'New': 'Nuevo',
    'Politics': 'Política',
    'Sports': 'Deportes',
    'Crypto': 'Cripto',
    'Finance': 'Finanzas',
    'Geopolitics': 'Geopolítica',
    'Tech': 'Tecnología',
    'Culture': 'Cultura',
    'Economy': 'Economía',
    'Weather': 'Clima',
    'Mentions': 'Menciones',
    'Elections': 'Elecciones',
    'Lead market': 'Mercado principal',
    'Lead contract': 'Contrato principal',
    'Fast mover': 'Mayor movimiento',
    'Closes soon': 'Cierra pronto',
    'Deepest book': 'Mayor liquidez',
    'Live contract': 'Contrato en vivo',
    'The first market in the current board.': 'El primer mercado del tablero actual.',
    'Largest live shift in the current lane.': 'El mayor cambio en vivo de esta categoría.',
    'Nearest live expiry still on the tape.': 'El vencimiento en vivo más cercano de la cinta.',
    'Highest visible depth in this board.': 'La mayor profundidad visible en este tablero.',
    'Visible in the current market lane.': 'Visible en la categoría de mercado actual.',
    'Click a tile to load the stage and trade desk.': 'Toca una tarjeta para cargar el escenario y el panel de operación.',
    'Loading market pulse...': 'Cargando pulso del mercado...',
    'Loading venue tape...': 'Cargando cinta del mercado...',
    'No live contracts in this lane yet.': 'Aún no hay contratos en vivo en esta categoría.',
    'Select a lead market': 'Selecciona un mercado principal',
    'We surface the lead contract here so the tape, ladder, and OST trade desk stay locked on one live market at a time.':
      'Mostramos aquí el contrato principal para que la cinta, la escalera y el panel OST sigan el mismo mercado en vivo.',
    'Select a live market': 'Selecciona un mercado en vivo',
    'Choose a live contract to inspect the live probability curve, price ladder, share pricing, and OST ticket details before you commit.':
      'Elige un contrato en vivo para revisar la curva de probabilidad, la escalera de precios y los detalles del ticket OST antes de confirmar.',
    'Live probability curve': 'Curva de probabilidad en vivo',
    'Anchored to current share pricing, recent venue changes, and source liquidity.':
      'Basado en el precio actual de acciones, cambios recientes del mercado y liquidez de la fuente.',
    'Real Polymarket CLOB price history for the selected outcome.': 'Historial real de precios CLOB de Polymarket para el resultado seleccionado.',
    'Loading real Polymarket CLOB price history through the OST worker.': 'Cargando historial real de precios CLOB de Polymarket por el worker OST.',
    'Live Polymarket price is real; using an outcome-specific preview while history refreshes.':
      'El precio en vivo de Polymarket es real; usamos una vista previa del resultado mientras se actualiza el historial.',
    'Live Polymarket price is real; waiting for published CLOB history.':
      'El precio en vivo de Polymarket es real; esperando historial CLOB publicado.',
    'Live quote shown; preview uses previous trade and venue liquidity.':
      'Cotización en vivo mostrada; la vista previa usa operación previa y liquidez del mercado.',
    'Opened --': 'Apertura --',
    'Live now': 'En vivo ahora',
    'Closes --': 'Cierra --',
    'Flat': 'Sin cambio',
    'Volume': 'Volumen',
    'Liquidity': 'Liquidez',
    'Open interest': 'Interés abierto',
    'Closes': 'Cierra',
    'Closing now': 'Cerrando ahora',
    'No close time': 'Sin hora de cierre',
    'Binary contract': 'Contrato binario',
    'Event contract': 'Contrato de evento',
    'Live yes/no contract routed directly from Polymarket.': 'Contrato sí/no en vivo conectado directamente desde Polymarket.',
    'Live event contract routed from Kalshi.': 'Contrato de evento en vivo conectado desde Kalshi.',
    'No market selected': 'No hay mercado seleccionado',
    'Choose a live contract from the board to build an OST-denominated position.':
      'Elige un contrato en vivo del tablero para crear una posición denominada en OST.',
    'Select a live contract first.': 'Selecciona primero un contrato en vivo.',
    'Build an OST ticket': 'Crear un ticket OST',
    'Choose the live side, size the order, and route an OST-denominated ticket from the same market board into the devnet settlement vault.':
      'Elige el lado en vivo, define el monto y envía un ticket denominado en OST desde el tablero hacia la bóveda de liquidación devnet.',
    'Connect your OST wallet to place a market ticket.': 'Conecta tu billetera OST para colocar un ticket de mercado.',
    'This side is not tradeable right now.': 'Este lado no se puede operar ahora.',
    'This wallet does not have enough OST for that stake.': 'Esta billetera no tiene suficiente OST para ese monto.',
    'Ready to route this position into the OST prediction vault.': 'Listo para enviar esta posición a la bóveda de predicción OST.',
    'Sending a real OST market ticket to the prediction vault...': 'Enviando un ticket real de mercado OST a la bóveda de predicción...',
    'Sending OST order...': 'Enviando orden OST...',
    'Could not place the prediction market order right now.': 'No se pudo colocar la orden del mercado de predicción ahora.',
    'Unavailable': 'No disponible',
    'Connect wallet': 'Conecta tu billetera',
    'Win return': 'Retorno si gana',
    'Entry price': 'Precio de entrada',
    'Payout multiple': 'Multiplicador de pago',
    'Profit if right': 'Ganancia si aciertas',
    'Wallet -> OST vault': 'Billetera -> bóveda OST',
    'Open venue': 'Abrir mercado',
    'Open feed': 'Abrir feed',
    'Details': 'Detalles',
    'Venue': 'Mercado',
    'Show more': 'Mostrar más',
    'Show less': 'Mostrar menos',
    'Showing every market in this lane.': 'Mostrando todos los mercados de esta categoría.',
    'No active markets matched that filter. Try another topic, rank, or search term.':
      'Ningún mercado activo coincide con ese filtro. Prueba otro tema, ranking o búsqueda.',
    'No live crypto contracts matched that lane. Try All markets or search for bitcoin, ethereum, solana, or ETF.':
      'Ningún contrato cripto en vivo coincide con esa categoría. Prueba Todos los mercados o busca bitcoin, ethereum, solana o ETF.',
    'Loading live prediction markets...': 'Cargando mercados de predicción en vivo...',
    'No live ladder available.': 'No hay escalera en vivo disponible.',
    'YES': 'SÍ',
    'NO': 'NO',
    'Yes': 'Sí',
    'No': 'No',
    'Yes ask': 'Oferta Sí',
    'No ask': 'Oferta No',
    'Buy Yes': 'Comprar Sí',
    'Buy No': 'Comprar No',
    'Buy YES': 'Comprar SÍ',
    'Buy NO': 'Comprar NO',
    'Buy YES with OST': 'Comprar SÍ con OST',
    'Buy NO with OST': 'Comprar NO con OST',
    'YES position': 'Posición SÍ',
    'NO position': 'Posición NO',
    'No OST market tickets recorded yet.': 'Aún no hay tickets de mercado OST registrados.',
    'shares': 'acciones',
    'Win return (Yes)': 'Retorno si gana (Sí)',
    'Win return (No)': 'Retorno si gana (No)',

    // Prediction modals and OST native markets
    'Info': 'Info',
    'Graph': 'Gráfica',
    'Yes price': 'Precio Sí',
    'Closes': 'Cierra',
    'Settlement': 'Liquidación',
    'OST native vault': 'Bóveda nativa OST',
    'External venue (Polymarket / Kalshi)': 'Mercado externo (Polymarket / Kalshi)',
    'See venue': 'Ver mercado',
    'Recent ticks': 'Ticks recientes',
    'Order book preview': 'Vista del libro de órdenes',
    'Time': 'Hora',
    'Side': 'Lado',
    'Price': 'Precio',
    'Size': 'Tamaño',
    'YES bids': 'Posturas SÍ',
    'NO bids': 'Posturas NO',
    '5-min round': 'Ronda de 5 min',
    'Closes in': 'Cierra en',
    'Open price:': 'Precio de apertura:',
    'Live BTC:': 'BTC en vivo:',
    'Open venue ↗': 'Abrir mercado ↗',
    'OST Native': 'Nativo OST',
    'OST 5-min BTC': 'BTC OST de 5 min',
    'BTC FEED': 'FEED BTC',
    'YES (UP)': 'SÍ (SUBE)',
    'NO (DOWN/SAME)': 'NO (BAJA/IGUAL)',
    'Round': 'Ronda',
    '5 min': '5 min',
    'Price feed': 'Feed de precio',
    'Open Coinbase': 'Abrir Coinbase',
    'OST native · 5-min round': 'Nativo OST · ronda de 5 min',
    'OST native binary': 'Binario nativo OST',
    'Trade with OST': 'Operar con OST',
    'Open OST market': 'Abrir mercado OST',
    'Curated Polymarket event — opens directly on Polymarket. Live odds load from the Polymarket Gamma feed once selected.':
      'Evento curado de Polymarket — abre directamente en Polymarket. Las cuotas en vivo cargan desde el feed Gamma al seleccionarlo.',
    'Open on Polymarket': 'Abrir en Polymarket',
    'Featured': 'Destacado',
    'Featured · curated': 'Destacado · curado',
    'US x Iran permanent peace deal': 'Acuerdo de paz permanente EE. UU. x Irán',
    '2026 FIFA World Cup winner': 'Ganador de la Copa Mundial FIFA 2026',
    'US Presidential Election 2028': 'Elección presidencial de EE. UU. 2028',
    'Republican nominee 2028': 'Candidato republicano 2028',
    'When will Bitcoin hit $150k?': '¿Cuándo llegará Bitcoin a $150k?',
    'Bitcoin price April 2026': 'Precio de Bitcoin en abril de 2026',
    'UCL · PSG vs Bayern (Apr 28)': 'Champions · PSG vs Bayern (28 abr.)',
    'Will BTC close higher today?': '¿BTC cerrará más alto hoy?',
    'BTC above $100,000 by Dec 31, 2026?': '¿BTC estará por encima de $100,000 antes del 31 de dic. de 2026?',
    'ETH market cap flips BTC in 2026?': '¿La capitalización de ETH superará a BTC en 2026?',
    'SOL above $150 before July 1, 2026?': '¿SOL superará $150 antes del 1 de julio de 2026?',
    'Brazil to win FIFA World Cup 2026?': '¿Brasil ganará la Copa Mundial FIFA 2026?',
    'Argentina to defend the World Cup 2026?': '¿Argentina defenderá el título mundial en 2026?',
    'France to win World Cup 2026?': '¿Francia ganará el Mundial 2026?',
    'USA reaches the World Cup 2026 quarter-finals?': '¿EE. UU. llegará a cuartos de final del Mundial 2026?',
    'WTI crude above $90 a barrel by year-end 2026?': '¿El crudo WTI superará $90 por barril al cierre de 2026?',
    'OPEC+ announces a production cut at June 2026 meeting?': '¿OPEC+ anunciará un recorte de producción en la reunión de junio de 2026?',
    'US average gas under $3.00/gal on July 4, 2026?': '¿La gasolina promedio en EE. UU. estará bajo $3.00/gal el 4 de julio de 2026?',
    'Democratic candidate wins the 2028 US presidency?': '¿El candidato demócrata ganará la presidencia de EE. UU. en 2028?',
    'Republican candidate wins the 2028 US presidency?': '¿El candidato republicano ganará la presidencia de EE. UU. en 2028?',
    'JD Vance wins the 2028 GOP presidential nomination?': '¿JD Vance ganará la nominación presidencial republicana de 2028?',
    'Gavin Newsom wins the 2028 Democratic presidential nomination?': '¿Gavin Newsom ganará la nominación presidencial demócrata de 2028?',
    'Democrats flip the US House in 2026 midterms?': '¿Los demócratas recuperarán la Cámara de Representantes en las elecciones intermedias de 2026?',
    'OpenAI ships a public "GPT-6" model in 2026?': '¿OpenAI lanzará un modelo público "GPT-6" en 2026?',
    'SpaceX Starship reaches orbit with payload deploy in 2026?': '¿Starship de SpaceX alcanzará órbita y desplegará carga en 2026?',
    '2026 ranks as one of the 3 hottest years on record?': '¿2026 estará entre los 3 años más calurosos registrados?',
    'World Cup': 'Mundial',
    'Oil': 'Petróleo',
    'US Election': 'Elección EE. UU.',
    'World Events': 'Eventos mundiales',
    'Polymarket-style tape': 'Cinta estilo Polymarket',
    'Kalshi-style ladder': 'Escalera estilo Kalshi',
    'OST wallet execution': 'Ejecución desde billetera OST',
    'Live market spotlight': 'Mercado destacado en vivo',
    'Yes share': 'Acción Sí',
    'No share': 'Acción No',
    'Implied yes': 'Sí implícito',
    '24h volume': 'Volumen 24h',
    'Depth': 'Profundidad',
    'Momentum': 'Impulso',
    'Loading live feeds...': 'Cargando feeds en vivo...',
    'Waiting for first refresh': 'Esperando primera actualización',
    'Venue parity': 'Paridad de mercados',
    'Live pricing, ranking, and one market board instead of a static prediction widget.':
      'Precios en vivo, ranking y un solo tablero de mercados en vez de un widget estático.',
    'Execution rail': 'Riel de ejecución',
    'OST order path': 'Ruta de orden OST',
    'Stay on the same page from venue scan to Yes or No sizing and ticket routing.':
      'Quédate en la misma página desde el escaneo del mercado hasta definir Sí o No y enviar el ticket.',
    'Refresh': 'Actualizar',
    'Order depth map': 'Mapa de profundidad',
    'Quote bands shaped from live venue pricing and available depth.':
      'Bandas de cotización formadas con precios del mercado en vivo y profundidad disponible.',
    'Yes depth': 'Profundidad Sí',
    'No depth': 'Profundidad No',
    'Waiting for a live contract.': 'Esperando un contrato en vivo.',
    'Pick a live contract, choose Yes or No, review your share pricing, then commit OST directly from your wallet into the market vault.':
      'Elige un contrato en vivo, selecciona Sí o No, revisa el precio de tus acciones y envía OST directo desde tu billetera a la bóveda del mercado.',
    'Stake in OST': 'Monto en OST',
    'Available OST': 'OST disponible',
    'Est. shares': 'Acciones est.',
    'Est. win return': 'Retorno est. si gana',
    'P&L': 'G/P',
    'Open / Claim': 'Abiertas / Cobro',
    'Staked': 'En juego',
    'Value': 'Valor',
    'All': 'Todos',
    'Claim': 'Cobrar',
    'Paid': 'Pagado',
    'Closed': 'Cerrado',
    'Claim win': 'Cobrar ganancia',
    'Closed lost': 'Cerrado perdido',
    'Resolved winner': 'Ganador resuelto',
    'Resolved losing side': 'Lado perdedor resuelto',
    'Sell position': 'Vender posición',
    'Live mark price': 'Precio de marca en vivo',
    'Entry price fallback': 'Respaldo con precio de entrada',
    'Prediction ticket': 'Ticket de predicción',
    'Live venue': 'Mercado en vivo',
    'Breaking tape': 'Cinta de última hora',
    'Fresh market': 'Mercado nuevo',
    'Esports': 'Deportes electrónicos',
    'Iran': 'Irán',
    'Select': 'Seleccionar',
    'More': 'Más',
    'How it works': 'Cómo funciona',
    'Bet YES': 'Apostar SÍ',
    'Bet NO': 'Apostar NO',
    'Bet YES with OST': 'Apostar SÍ con OST',
    'Bet NO with OST': 'Apostar NO con OST',
    'Confirm bet': 'Confirmar apuesta',
    'Stake (OST)': 'Monto (OST)',
    'Bet OST on YES or NO. Winning side gets paid back at <em>1 / price</em> minus a small protocol fee. OST native markets settle from the swap pool when the close time passes.':
      'Apuesta OST por SÍ o NO. El lado ganador cobra <em>1 / precio</em> menos una pequeña comisión de protocolo. Los mercados nativos OST se liquidan desde el pool de swap cuando pasa el cierre.',
    'Probability over time (last 60 ticks).': 'Probabilidad en el tiempo (últimos 60 ticks).',
    'OST is transferred to the on-chain prediction vault.': 'El OST se transfiere a la bóveda de predicción on-chain.',

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
      function (_m, n) { return '+ ' + n + ' OST acreditados a tu saldo de bonificación. Elige otra lección →'; }],
    [/^Language:\s*ES$/i, function () { return 'Idioma: ES'; }],
    [/^5-min BTC:\s*will price be UP at\s*(.+)\?$/i,
      function (_m, time) { return 'BTC 5 min: ¿el precio estará ARRIBA a las ' + time + '?'; }],
    [/^Native OST market priced from live BTC-USD spot\. Open\s*(.+?)\s*·\s*live\s*(.+?)\s*·\s*(.+?)\s*from open via\s*(.+?)\.$/i,
      function (_m, open, live, delta, source) { return 'Mercado nativo OST con precio BTC-USD en vivo. Apertura ' + open + ' · en vivo ' + live + ' · ' + delta + ' desde la apertura vía ' + source + '.'; }],
    [/^Resolves YES if Bitcoin closes above its current spot of \$(.+?) at 23:59 UTC\.$/i,
      function (_m, price) { return 'Se resuelve SÍ si Bitcoin cierra por encima de su precio actual de $' + price + ' a las 23:59 UTC.'; }],
    [/^Spot price currently \$(.+?)\. Resolves on official CoinGecko close\.$/i,
      function (_m, price) { return 'Precio spot actual: $' + price + '. Se resuelve con el cierre oficial de CoinGecko.'; }],
    [/^ETH spot \$(.+?)\. Long-shot binary settled on year-end CoinGecko data\.$/i,
      function (_m, price) { return 'Spot de ETH: $' + price + '. Binario de baja probabilidad liquidado con datos de CoinGecko al cierre del año.'; }],
    [/^SOL spot \$(.+?)\. OST swap pool settles directly into your wallet\.$/i,
      function (_m, price) { return 'Spot de SOL: $' + price + '. El pool de swap OST liquida directo en tu billetera.'; }],
    [/^Final on July 19, 2026 at MetLife Stadium\. Resolves on the official FIFA result\.$/i,
      function () { return 'Final el 19 de julio de 2026 en el MetLife Stadium. Se resuelve con el resultado oficial de FIFA.'; }],
    [/^Reigning champion\. Resolves on the official FIFA final result\.$/i,
      function () { return 'Campeón vigente. Se resuelve con el resultado oficial de la final FIFA.'; }],
    [/^Strong squad\. Settled on FIFA-confirmed final\.$/i,
      function () { return 'Plantel fuerte. Se liquida con la final confirmada por FIFA.'; }],
    [/^Co-host advantage\. Resolves YES if USMNT plays a QF match\.$/i,
      function () { return 'Ventaja de coanfitrión. Se resuelve SÍ si la selección de EE. UU. juega cuartos de final.'; }],
    [/^Settled on EIA spot price for West Texas Intermediate on Dec 31, 2026\.$/i,
      function () { return 'Se liquida con el precio spot EIA de West Texas Intermediate el 31 de dic. de 2026.'; }],
    [/^Resolves YES if any headline cut > 200kbpd is announced at the next OPEC\+ ministerial\.$/i,
      function () { return 'Se resuelve SÍ si se anuncia un recorte titular mayor a 200 kbpd en la próxima ministerial de OPEC+.'; }],
    [/^Settled on AAA national average on July 4\. Currently around \$(.+?)\.$/i,
      function (_m, price) { return 'Se liquida con el promedio nacional AAA del 4 de julio. Actualmente cerca de $' + price + '.'; }],
    [/^Settled on certified Electoral College result\. Lines refresh as primaries unfold\.$/i,
      function () { return 'Se liquida con el resultado certificado del Colegio Electoral. Las líneas se actualizan conforme avancen las primarias.'; }],
    [/^Settled on certified Electoral College result\. Counterpart of the Dem line\.$/i,
      function () { return 'Se liquida con el resultado certificado del Colegio Electoral. Contraparte de la línea demócrata.'; }],
    [/^Resolves on official RNC nomination roll-call\.$/i,
      function () { return 'Se resuelve con el pase de lista oficial de nominación del RNC.'; }],
    [/^Resolves on official DNC nomination roll-call\.$/i,
      function () { return 'Se resuelve con el pase de lista oficial de nominación del DNC.'; }],
    [/^Settled on AP race calls for the 435 House seats on Nov 3, 2026\.$/i,
      function () { return 'Se liquida con las proyecciones de AP para los 435 escaños de la Cámara el 3 de nov. de 2026.'; }],
    [/^Resolves YES on a generally-available GPT-6-branded launch announced by OpenAI in 2026\.$/i,
      function () { return 'Se resuelve SÍ con un lanzamiento público de marca GPT-6 anunciado por OpenAI en 2026.'; }],
    [/^Resolves on FAA \+ SpaceX confirmation of orbital insertion \+ payload separation\.$/i,
      function () { return 'Se resuelve con confirmación de FAA + SpaceX de inserción orbital y separación de carga.'; }],
    [/^Settled on NOAA \+ Copernicus annual global temperature ranking\.$/i,
      function () { return 'Se liquida con el ranking anual de temperatura global de NOAA + Copernicus.'; }],
    [/^Closes in\s+(.+)$/i, function (_m, rest) { return 'Cierra en ' + rest; }],
    [/^in\s+(\d+)h$/i, function (_m, n) { return 'en ' + n + 'h'; }],
    [/^in\s+(\d+)d$/i, function (_m, n) { return 'en ' + n + 'd'; }],
    [/^in\s+(\d+)mo$/i, function (_m, n) { return 'en ' + n + ' meses'; }],
    [/^(\d+)\s+live contracts in this lane\. Click a tile to focus the desk\.$/i,
      function (_m, n) { return n + ' contratos en vivo en esta categoría. Toca una tarjeta para enfocar el panel.'; }],
    [/^(\d+)\s+matched$/i, function (_m, n) { return n + ' coincidencias'; }],
    [/^(\d+)\s+more markets hidden to keep the venue compact\.$/i,
      function (_m, n) { return n + ' mercados más ocultos para mantener compacto el tablero.'; }],
    [/^(.+)\s+shares @\s+(.+)$/i, function (_m, label, price) { return label + ' acciones @ ' + price; }],
    [/^Win return \((.+)\)$/i, function (_m, label) { return 'Retorno si gana (' + label + ')'; }],
    [/^(.+) entry price$/i, function (_m, label) { return 'Precio de entrada ' + label; }],
    [/^Open\s+(\d+)$/i, function (_m, n) { return 'Abiertas ' + n; }],
    [/^Claim\s+(\d+)$/i, function (_m, n) { return 'Por cobrar ' + n; }],
    [/^Paid\s+(\d+)$/i, function (_m, n) { return 'Pagadas ' + n; }],
    [/^Closed\s+(\d+)$/i, function (_m, n) { return 'Cerradas ' + n; }],
    [/^Paid out\s+(.+)$/i, function (_m, amount) { return 'Pagado ' + amount; }],
    [/^Bet\s+(YES|NO)\s+on\s+[“"](.+)[”"]$/i,
      function (_m, side, title) { return 'Apostar ' + (side.toUpperCase() === 'YES' ? 'SÍ' : 'NO') + ' en “' + title + '”'; }],
    [/^Probability over time \(last 60 ticks\)\. Anchored to current YES price\s+(.+)\.$/i,
      function (_m, price) { return 'Probabilidad en el tiempo (últimos 60 ticks). Basada en el precio SÍ actual de ' + price + '.'; }],
    [/^Side price:\s+(.+?)\s+—\s+payout multiplier\s+≈\s+(.+?)x\. OST is transferred to the on-chain prediction vault\.$/i,
      function (_m, price, multiple) { return 'Precio del lado: ' + price + ' — multiplicador de pago ≈ ' + multiple + 'x. El OST se transfiere a la bóveda de predicción on-chain.'; }],
    [/^(YES|NO)\s+price$/i,
      function (_m, side) { return (side.toUpperCase() === 'YES' ? 'SÍ' : 'NO') + ' precio'; }],
    [/^(YES|NO)\s+shares @\s+(.+)$/i,
      function (_m, side, price) { return (side.toUpperCase() === 'YES' ? 'SÍ' : 'NO') + ' acciones @ ' + price; }]
  ];

  function storedLang() {
    try {
      var direct = localStorage.getItem('ost.lang') || '';
      if (direct) return direct;
      var prefs = JSON.parse(localStorage.getItem('ost_prefs') || '{}');
      return prefs && prefs.lang ? prefs.lang : '';
    } catch (e) {
      return '';
    }
  }

  function isSpanish() {
    return (document.documentElement.getAttribute('lang') || '').toLowerCase().startsWith('es') ||
           (document.documentElement.getAttribute('data-lang') || '').toLowerCase().startsWith('es') ||
           String(storedLang() || '').toLowerCase().startsWith('es');
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
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE' || tag === 'PRE') return;
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
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
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
  window.addEventListener('ost:languagechange', refreshAll);

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
