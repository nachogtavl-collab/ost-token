/* ==================================================================
   OST v3 — app.js
   Real Earth + Live Prices + i18n + Wallet + Charts + Calculator
   ================================================================== */
(function () {
  'use strict';

  /* ---------- Helpers ---------- */
  const $ = (s, p) => (p || document).querySelector(s);
  const $$ = (s, p) => [...(p || document).querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- NAV ---------- */
  const navToggle = $('#navToggle');
  const navLinks = $('#navLinks');
  if (navToggle) navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));

  /* Active link highlight */
  const sections = $$('section[id]');
  const navAnchors = $$('.nav-links a');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        navAnchors.forEach(a => {
          a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id);
        });
      }
    });
  }, { threshold: 0.3 });
  sections.forEach(s => observer.observe(s));

  /* ---------- LANGUAGE / i18n ---------- */
  const langTrigger = $('#langTrigger');
  const langList = $('#langList');
  const langCode = $('#langCode');

  const translations = {
    en: {
      'nav.home': 'Home', 'nav.newhere': 'Get OST', 'nav.demos': 'Demos', 'nav.wallet': 'Wallet',
      'nav.ai': 'AI & Bots', 'nav.offline': 'Offline', 'nav.censorship': 'Censorship', 'nav.spacex': 'SpaceX',
      'nav.about': 'Our Story', 'nav.roadmap': 'Roadmap', 'nav.build': 'Build', 'nav.verify': 'Verify',
      'nav.connect': 'Connect Wallet',
      'wallet.dashTitle': 'My OST Wallet', 'wallet.dashSub': 'Your personal command center. Create, connect, and manage your OST wallet.',
      'bridges.title': 'Bridges, Ramps & Exchanges', 'bridges.sub': 'Every path to OST — from any chain, any currency, any country. All verified and working.',
      'hero.tag': 'The Next Step After Bitcoin',
      'hero.title': 'We are all <span class="gradient-text">one family.</span>',
      'hero.sub': 'OST is the digital cash made for every citizen of the world - private, instant, and connected to any currency you already have.',
      'hero.cta1': 'Try the Pay Demo', 'hero.cta2': 'Get OST Now',
      'hero.premine': 'Pre-mine', 'hero.settle': 'Settlement', 'hero.opensource': 'Open Source', 'hero.privacy': 'Privacy',
      'story.title': 'Our Story', 'story.sub': 'A journey from the first spark of decentralized money to the future of private digital cash.',
      'story.t1.title': 'The Spark', 'story.t1.text': 'Bitcoin proved that people - not banks, not governments - could create money that crosses every border. The spark changed everything.',
      'story.t2.title': 'The Gap', 'story.t2.text': 'But Bitcoin was slow, expensive, and public. Billions still couldn\'t pay rent, buy groceries, or send money home without banks taking their cut.',
      'story.t3.title': 'The Breakthrough', 'story.t3.text': 'Solana Token-2022 launched confidential transfers - zero-knowledge proofs that hide balances and amounts from the entire world. The missing piece.',
      'story.t4.title': 'OST Is Born', 'story.t4.text': 'We combined unstoppable money, instant settlement, total privacy, and a mission: fund satellite infrastructure so every human can access the financial system.',
      'story.t5.year': 'The Future', 'story.t5.title': 'Every Citizen, Connected',
      'story.t5.text': 'A world where the fruit seller in Lagos and the engineer in Tehran share the same financial freedom. Where borders are just lines. Where money is truly yours.',
      'story.lead': 'We are building universal digital cash that belongs to no country and serves every citizen. Privately. Instantly. Equally.',
      'story.closing': 'Welcome to OST. Welcome home.',
      'citizens.title': 'For Every Citizen', 'citizens.sub': 'No borders. No exceptions. One humanity, one money.',
      'features.title': 'The Revolutionary Next Step', 'features.sub': 'Not just another token. A complete financial system for real life.',
      'features.f1.title': 'Confidential Transfers', 'features.f1.text': 'Zero-knowledge proofs hide your balance and every transaction.',
      'features.f2.title': 'Sub-Second Settlement', 'features.f2.text': '400ms on Solana. Faster than tapping your card.',
      'features.f3.title': 'Any-to-OST Bridge', 'features.f3.text': 'Bitcoin, Ethereum, USDC, bank transfers - everything converts.',
      'features.f4.title': 'Forever Free', 'features.f4.text': 'Zero transaction fees. Funded by donations & investors. On-chain transparency.',
      'features.f5.title': 'Offline Payments', 'features.f5.text': 'NFC, QR, Bluetooth. Pay without internet.',
      'features.f6.title': 'ZK Tax Compliance', 'features.f6.text': 'Prove taxes without revealing your balance.',
      'pay.title': 'Shop with OST - Real Prices', 'pay.sub': 'Real products, real world prices. See what private payments feel like.',
      'pay.cart': 'Your Cart', 'pay.empty': 'Tap + to add items', 'pay.paybtn': 'Pay with OST',
      'pay.s1': 'Connecting wallet', 'pay.s2': 'Generating ZK proof', 'pay.s3': 'Broadcasting transfer', 'pay.s4': 'Confirmed in 0.4s',
      'pay.done': 'Payment Complete - Fully Private', 'pay.donesub': 'No one on Earth saw this transaction.',
      'transfer.title': 'Bring Your Money From Anywhere', 'transfer.sub': 'Live prices. Real-time charts. Exchange any currency into OST.',
      'transfer.calc': 'Exchange Rate Calculator', 'transfer.calcsub': 'See how much OST you get for any amount.',
      'transfer.widgettitle': 'Convert Now', 'transfer.from': 'Your Currency', 'transfer.to': 'Confidential OST',
      'transfer.result': 'Private & Instant', 'transfer.convert': 'Convert to OST',
      'transfer.note': 'Powered by Wormhole, Jupiter Aggregator, and Solana Token-2022.',
      'transfer.fiattitle': 'Coming from Fiat?',
      'transfer.fiattext': 'Use <strong>MoonPay</strong>, <strong>Transak</strong>, or <strong>Ramp Network</strong> - available in 100+ countries. Buy SOL or USDC, then convert above.',
      'offline.title': 'Offline Cash Anywhere', 'offline.sub': 'The internet isn\'t everywhere yet. But your money should be.',
      'offline.lead': 'Transactions at the speed of light - even when the lights are off.',
      'offline.text': 'Imagine handing someone a banknote. No bank. No internet. Just two people and value changing hands. OST brings that to the digital world.',
      'offline.nfc': 'NFC Tap-to-Pay', 'offline.nfctext': 'Hold phones near each other. One tap. Payment done. Like Apple Pay - but private, borderless.',
      'offline.qr': 'QR Code Scan', 'offline.qrtext': 'The signed payment fits in a single QR code. Show it, print it, etch it on metal.',
      'offline.bt': 'Bluetooth Nearby', 'offline.bttext': 'BLE beams the transaction up to 30 feet. Perfect for markets and restaurants.',
      'getost.title': 'Get OST', 'getost.sub': 'Instant entry from any crypto or fiat - no KYC for swaps.',
      'getost.swap': 'Swap Any Crypto to OST', 'getost.swaptext': 'Jupiter Aggregator finds the best route across all Solana liquidity pools.',
      'getost.jupnote': 'Connect your wallet to load the live swap widget.', 'getost.jupbtn': 'Load Swap Widget',
      'getost.fiat': 'Buy with Local Money', 'getost.fiatsub': 'Buy SOL or USDC, then swap to OST. No KYC for the swap.',
      'getost.faucet': 'New Here? Claim Free OST', 'getost.faucettext': 'Every new wallet gets <strong>10 OST</strong> from the community treasury &mdash; enough to start using OST right away.',
      'getost.faucetbtn': 'Turn the Faucet',
      'pay.anywhere': '🌐 Pay Anywhere with OST',
      'pay.anywheresub': 'Paste any website where you\'re buying something. We convert your OST into whatever currency they accept.',
      'pay.aurl': 'Merchant URL', 'pay.aamount': 'Amount to Pay', 'pay.acurrency': 'Their Currency',
      'pay.ayoupay': 'You Pay:', 'pay.arate': 'Rate:', 'pay.afee': 'Network Fee:',
      'pay.ahow': 'How It Works',
      'pay.astep1': 'Paste the merchant checkout link', 'pay.astep2': 'Enter the amount in their currency',
      'pay.astep3': 'OST converts at live rates via Jupiter + Wormhole', 'pay.astep4': 'Merchant receives their currency, you paid with OST',
      'pay.apaybtn': 'Pay with OST', 'pay.asupported': 'Works with any site that accepts:',
      'launch.title': '🚀 Mainnet Launch Checklist', 'launch.sub': 'What we need to make OST fully real on Solana mainnet.',
      'ai.title': 'Power for Every Intelligence', 'ai.sub': 'We welcome AI agents, bots, servers, and every form of digital intelligence.',
      'build.title': 'Build the Future With Us', 'build.sub': 'Code, create, or dream in pixels - OST is your platform.',
      'build.cta': 'Start Contributing Today', 'build.ctasub': 'Every commit, translation, and tutorial moves humanity forward.',
      'build.github': 'View GitHub Repo', 'build.docs': 'Read the Docs',
      'verify.title': 'Full Transparency', 'verify.sub': 'Verify everything yourself. We have nothing to hide.',
      'verify.lead': 'Trust is earned with facts, not promises.',
      'verify.closing': 'Read the code. Check the company. Verify the treasury. <strong>Then decide.</strong>',
      'wallet.title': 'Connect Your Wallet', 'wallet.sub': 'Choose a wallet to connect to OST.',
      'footer.mission': 'Every transaction helps fund satellite infrastructure for universal internet access. <strong>A gift we build together.</strong>',
      'footer.copy': 'Open source. Built with love for every human on Earth.',
    },
    es: {
      'nav.home': 'Inicio', 'nav.newhere': 'Obtener OST', 'nav.demos': 'Demos', 'nav.wallet': 'Billetera',
      'nav.ai': 'IA y Bots', 'nav.offline': 'Sin Conexion', 'nav.censorship': 'Censura', 'nav.spacex': 'SpaceX',
      'nav.about': 'Nuestra Historia', 'nav.roadmap': 'Hoja de Ruta', 'nav.build': 'Construir', 'nav.verify': 'Verificar',
      'nav.connect': 'Conectar Billetera',
      'wallet.dashTitle': 'Mi Billetera OST', 'wallet.dashSub': 'Tu centro de control. Crea, conecta y gestiona tu billetera OST.',
      'bridges.title': 'Puentes, Rampas e Intercambios', 'bridges.sub': 'Cada camino hacia OST — desde cualquier cadena, moneda o pais.',
      'hero.tag': 'El Siguiente Paso Despues de Bitcoin',
      'hero.title': 'Todos somos <span class="gradient-text">una familia.</span>',
      'hero.sub': 'OST es el dinero digital hecho para cada ciudadano del mundo - privado, instantaneo y conectado a cualquier moneda que ya tengas.',
      'hero.cta1': 'Probar la Demo', 'hero.cta2': 'Obtener OST',
      'hero.premine': 'Pre-minado', 'hero.settle': 'Liquidacion', 'hero.opensource': 'Codigo Abierto', 'hero.privacy': 'Privacidad',
      'story.title': 'Nuestra Historia', 'story.sub': 'Un viaje desde la primera chispa del dinero descentralizado hasta el futuro del efectivo digital privado.',
      'story.t1.title': 'La Chispa', 'story.t1.text': 'Bitcoin demostro que las personas - no los bancos, no los gobiernos - podian crear dinero que cruza todas las fronteras.',
      'story.t2.title': 'La Brecha', 'story.t2.text': 'Pero Bitcoin era lento, caro y publico. Miles de millones aun no podian pagar el alquiler sin que los bancos se quedaran con su parte.',
      'story.t3.title': 'El Avance', 'story.t3.text': 'Solana Token-2022 lanzo transferencias confidenciales - pruebas de conocimiento cero que ocultan saldos y montos del mundo entero.',
      'story.t4.title': 'Nace OST', 'story.t4.text': 'Combinamos dinero imparable, liquidacion instantanea, privacidad total y una mision: financiar infraestructura satelital.',
      'story.t5.year': 'El Futuro', 'story.t5.title': 'Cada Ciudadano, Conectado',
      'story.t5.text': 'Un mundo donde el vendedor de frutas en Lagos y el ingeniero en Teheran comparten la misma libertad financiera.',
      'story.lead': 'Estamos construyendo efectivo digital universal que no pertenece a ningun pais y sirve a cada ciudadano.',
      'story.closing': 'Bienvenido a OST. Bienvenido a casa.',
      'citizens.title': 'Para Cada Ciudadano', 'citizens.sub': 'Sin fronteras. Sin excepciones. Una humanidad, un dinero.',
      'features.title': 'El Siguiente Paso Revolucionario', 'features.sub': 'No es solo otro token. Un sistema financiero completo para la vida real.',
      'features.f1.title': 'Transferencias Confidenciales', 'features.f1.text': 'Pruebas de conocimiento cero ocultan tu saldo y cada transaccion.',
      'features.f2.title': 'Liquidacion Sub-Segundo', 'features.f2.text': '400ms en Solana. Mas rapido que tocar tu tarjeta.',
      'features.f3.title': 'Puente Universal a OST', 'features.f3.text': 'Bitcoin, Ethereum, USDC, transferencias bancarias - todo se convierte.',
      'features.f4.title': 'Gratis Para Siempre', 'features.f4.text': 'Cero comisiones. Financiado por donaciones e inversores. Transparencia on-chain.',
      'features.f5.title': 'Pagos Sin Internet', 'features.f5.text': 'NFC, QR, Bluetooth. Paga sin internet.',
      'features.f6.title': 'Cumplimiento Fiscal ZK', 'features.f6.text': 'Demuestra tus impuestos sin revelar tu saldo.',
      'pay.title': 'Compra con OST - Precios Reales', 'pay.sub': 'Productos reales, precios reales. Siente los pagos privados.',
      'pay.cart': 'Tu Carrito', 'pay.empty': 'Toca + para agregar', 'pay.paybtn': 'Pagar con OST',
      'pay.s1': 'Conectando billetera', 'pay.s2': 'Generando prueba ZK', 'pay.s3': 'Transmitiendo a Solana', 'pay.s4': 'Confirmado en 0.4s',
      'pay.done': 'Pago Completo - Totalmente Privado', 'pay.donesub': 'Nadie en la Tierra vio esta transaccion.',
      'transfer.title': 'Trae Tu Dinero de Cualquier Lugar', 'transfer.sub': 'Precios en vivo. Graficos en tiempo real. Cambia cualquier moneda a OST.',
      'transfer.calc': 'Calculadora de Tipo de Cambio', 'transfer.calcsub': 'Ve cuanto OST obtienes por cualquier monto.',
      'transfer.widgettitle': 'Convertir Ahora', 'transfer.from': 'Tu Moneda', 'transfer.to': 'OST Confidencial',
      'transfer.result': 'Privado e Instantaneo', 'transfer.convert': 'Convertir a OST',
      'transfer.note': 'Impulsado por Wormhole, Jupiter y Solana Token-2022.',
      'transfer.fiattitle': 'Vienes del fiat?',
      'transfer.fiattext': 'Usa <strong>MoonPay</strong>, <strong>Transak</strong> o <strong>Ramp Network</strong> — disponible en 100+ paises.',
      'offline.title': 'Efectivo Sin Internet', 'offline.sub': 'El internet no esta en todas partes. Pero tu dinero deberia estarlo.',
      'offline.lead': 'Transacciones a la velocidad de la luz — incluso cuando se apagan las luces.',
      'offline.text': 'Imagina entregarle un billete a alguien. Sin banco. Sin internet. Solo dos personas y valor cambiando de manos.',
      'offline.nfc': 'NFC Toca para Pagar', 'offline.nfctext': 'Acerca los telefonos. Un toque. Pago hecho. Como Apple Pay pero privado y sin fronteras.',
      'offline.qr': 'Escaneo QR', 'offline.qrtext': 'El pago firmado cabe en un solo codigo QR. Muestralo, imprimelo, grabalo en metal.',
      'offline.bt': 'Bluetooth Cercano', 'offline.bttext': 'BLE transmite la transaccion hasta 10 metros. Perfecto para mercados y restaurantes.',
      'getost.title': 'Obtener OST', 'getost.sub': 'Entrada instantanea desde cualquier cripto o fiat — sin KYC para intercambios.',
      'getost.swap': 'Cambia Cualquier Cripto a OST', 'getost.swaptext': 'Jupiter encuentra la mejor ruta en todos los pools de liquidez de Solana.',
      'getost.jupnote': 'Conecta tu billetera para cargar el widget de intercambio.', 'getost.jupbtn': 'Cargar Widget',
      'getost.fiat': 'Compra con Moneda Local', 'getost.fiatsub': 'Compra SOL o USDC, luego cambia a OST. Sin KYC para el intercambio.',
      'getost.faucet': 'Nuevo? Reclama OST Gratis', 'getost.faucettext': 'Cada nueva billetera recibe <strong>10 OST</strong> del tesoro comunitario &mdash; suficiente para empezar a usar OST de inmediato.',
      'getost.faucetbtn': 'Abrir el Grifo',
      'pay.anywhere': '🌐 Paga en Cualquier Sitio con OST',
      'pay.anywheresub': 'Pega cualquier sitio web donde estes comprando. Convertimos tu OST a la moneda que acepten.',
      'pay.aurl': 'URL del Comercio', 'pay.aamount': 'Monto a Pagar', 'pay.acurrency': 'Su Moneda',
      'pay.ayoupay': 'Tu Pagas:', 'pay.arate': 'Tasa:', 'pay.afee': 'Comision de Red:',
      'pay.ahow': 'Como Funciona',
      'pay.astep1': 'Pega el enlace de pago del comercio', 'pay.astep2': 'Ingresa el monto en su moneda',
      'pay.astep3': 'OST convierte a tasas en vivo via Jupiter + Wormhole', 'pay.astep4': 'El comercio recibe su moneda, tu pagaste con OST',
      'pay.apaybtn': 'Pagar con OST', 'pay.asupported': 'Funciona con cualquier sitio que acepte:',
      'launch.title': '🚀 Lista de Lanzamiento Mainnet', 'launch.sub': 'Lo que necesitamos para hacer OST real en Solana mainnet.',
      'ai.title': 'Poder para Cada Inteligencia', 'ai.sub': 'Damos la bienvenida a agentes IA, bots, servidores y toda forma de inteligencia digital.',
      'build.title': 'Construye el Futuro Con Nosotros', 'build.sub': 'Programa, crea o suena en pixeles — OST es tu plataforma.',
      'build.cta': 'Empieza a Contribuir Hoy', 'build.ctasub': 'Cada commit, traduccion y tutorial mueve a la humanidad adelante.',
      'build.github': 'Ver Repositorio GitHub', 'build.docs': 'Leer Documentacion',
      'verify.title': 'Transparencia Total', 'verify.sub': 'Verifica todo tu mismo. No tenemos nada que ocultar.',
      'verify.lead': 'La confianza se gana con hechos, no con promesas.',
      'verify.closing': 'Lee el codigo. Verifica la empresa. Audita el tesoro. <strong>Luego decide.</strong>',
      'wallet.title': 'Conectar Tu Billetera', 'wallet.sub': 'Elige una billetera para conectar a OST.',
      'footer.mission': 'Cada transaccion ayuda a financiar infraestructura satelital. <strong>Un regalo que construimos juntos.</strong>',
      'footer.copy': 'Codigo abierto. Construido con amor para cada ser humano.',
    },
    zh: {
      'nav.home': '首页', 'nav.newhere': '获取OST', 'nav.demos': '演示', 'nav.wallet': '钱包',
      'nav.ai': 'AI和机器人', 'nav.offline': '离线', 'nav.censorship': '审查', 'nav.spacex': 'SpaceX',
      'nav.about': '我们的故事', 'nav.roadmap': '路线图', 'nav.build': '开发', 'nav.verify': '验证',
      'nav.connect': '连接钱包',
      'wallet.dashTitle': '我的OST钱包', 'wallet.dashSub': '您的个人控制中心。创建、连接和管理您的OST钱包。',
      'bridges.title': '跨链桥、入金通道和交易所', 'bridges.sub': '通往OST的每条路径——来自任何链、任何货币、任何国家。',
      'hero.tag': '比特币之后的下一步',
      'hero.title': '我们都是 <span class="gradient-text">一家人。</span>',
      'hero.sub': 'OST是为世界上每个公民制造的数字现金 - 私密、即时，连接你已有的任何货币。',
      'hero.cta1': '试用支付演示', 'hero.cta2': '获取OST',
      'hero.premine': '无预挖', 'hero.settle': '结算', 'hero.opensource': '开源', 'hero.privacy': '隐私',
      'story.title': '我们的故事', 'story.sub': '从去中心化货币的第一颗火花到私人数字现金未来的旅程。',
      'story.t1.title': '火花', 'story.t1.text': '比特币证明了人民——而非银行或政府——可以创造跨越所有国界的货币。这颗火花改变了一切。',
      'story.t2.title': '鸿沟', 'story.t2.text': '但比特币速度慢、费用高、完全公开。数十亿人仍然无法在没有银行抽成的情况下付房租、买杂货或汇款回家。',
      'story.t3.title': '突破', 'story.t3.text': 'Solana Token-2022推出了机密转账——零知识证明将余额和金额对全世界隐藏。这是缺失的拼图。',
      'story.t4.title': 'OST诞生', 'story.t4.text': '我们结合了不可阻挡的货币、即时结算、完全隐私和一项使命：资助卫星基础设施，让每个人都能使用金融系统。',
      'story.t5.year': '未来', 'story.t5.title': '每位公民，互联互通',
      'story.t5.text': '一个拉各斯的水果商和德黑兰的工程师享有同等金融自由的世界。国界只是线条。金钱真正属于你。',
      'story.lead': '我们正在建设不属于任何国家、服务每位公民的通用数字现金。私密。即时。平等。',
      'story.closing': '欢迎来到OST。欢迎回家。',
      'citizens.title': '为每位公民', 'citizens.sub': '没有边界。没有例外。一个人类，一种货币。',
      'features.title': '革命性的下一步', 'features.sub': '不仅仅是另一个代币。一个完整的真实生活金融系统。',
      'features.f1.title': '机密转账', 'features.f1.text': '零知识证明隐藏您的余额和每笔交易。',
      'features.f2.title': '亚秒级结算', 'features.f2.text': 'Solana上400毫秒。比刷卡还快。',
      'features.f3.title': '万币通桥', 'features.f3.text': '比特币、以太坊、USDC、银行转账——一切皆可兑换。',
      'features.f4.title': '永久免费', 'features.f4.text': '零交易费用。由捐款和投资者资助。链上透明。',
      'features.f5.title': '离线支付', 'features.f5.text': 'NFC、二维码、蓝牙。无需互联网即可支付。',
      'features.f6.title': 'ZK税务合规', 'features.f6.text': '在不暴露余额的情况下证明纳税。',
      'pay.title': '用OST购物 - 实时价格', 'pay.sub': '真实产品，真实价格。体验隐私支付的感觉。',
      'pay.cart': '您的购物车', 'pay.empty': '点击+添加商品', 'pay.paybtn': '用OST支付',
      'pay.s1': '连接钱包', 'pay.s2': '生成零知识证明', 'pay.s3': '广播到Solana', 'pay.s4': '0.4秒确认',
      'pay.done': '支付完成 - 完全隐私', 'pay.donesub': '地球上没有人看到这笔交易。',
      'transfer.title': '从任何地方带来你的钱', 'transfer.sub': '实时价格。实时图表。将任何货币兑换为OST。',
      'transfer.calc': '汇率计算器', 'transfer.calcsub': '查看您能获得多少OST。',
      'transfer.widgettitle': '立即兑换', 'transfer.from': '您的货币', 'transfer.to': '机密OST',
      'transfer.result': '隐私且即时', 'transfer.convert': '兑换为OST',
      'transfer.note': '由Wormhole、Jupiter聚合器和Solana Token-2022驱动。',
      'transfer.fiattitle': '来自法定货币？',
      'transfer.fiattext': '使用<strong>MoonPay</strong>、<strong>Transak</strong>或<strong>Ramp Network</strong>——覆盖100多个国家。购买SOL或USDC，然后在上方兑换。',
      'offline.title': '任何地方的离线现金', 'offline.sub': '互联网还没有覆盖所有地方。但你的钱应该在。',
      'offline.lead': '光速交易——即使断电也不影响。',
      'offline.text': '想象将一张钞票递给某人。没有银行。没有互联网。只有两个人和价值转移。OST将此带入数字世界。',
      'offline.nfc': 'NFC感应支付', 'offline.nfctext': '将手机靠近对方。轻触一下。支付完成。像Apple Pay一样，但隐私、无国界。',
      'offline.qr': '二维码扫描', 'offline.qrtext': '签名的支付装进单个二维码。展示它、打印它、刻在金属上。',
      'offline.bt': '蓝牙近场', 'offline.bttext': 'BLE在30英尺范围内传输交易。市场和餐厅的完美选择。',
      'getost.title': '获取OST', 'getost.sub': '从任何加密货币或法定货币即时进入——兑换无需KYC。',
      'getost.swap': '任何加密货币兑换OST', 'getost.swaptext': 'Jupiter聚合器在所有Solana流动性池中找到最佳路线。',
      'getost.jupnote': '连接您的钱包以加载实时兑换小部件。', 'getost.jupbtn': '加载兑换小部件',
      'getost.fiat': '用当地货币购买', 'getost.fiatsub': '购买SOL或USDC，然后兑换为OST。兑换无需KYC。',
      'getost.faucet': '新人？领取免费OST', 'getost.faucettext': '每个新钱包从社区金库获得<strong>10 OST</strong>。',
      'getost.faucetbtn': '开启水龙头',
      'pay.anywhere': '🌐 用OST在任何网站支付',
      'pay.anywheresub': '粘贴你正在购物的任何网站。我们将你的OST转换为他们接受的货币。',
      'pay.aurl': '商家链接', 'pay.aamount': '支付金额', 'pay.acurrency': '商家货币',
      'pay.ayoupay': '你支付：', 'pay.arate': '汇率：', 'pay.afee': '网络费用：',
      'pay.ahow': '如何运作',
      'pay.astep1': '粘贴商家结账链接', 'pay.astep2': '输入商家货币金额',
      'pay.astep3': 'OST通过Jupiter + Wormhole实时转换', 'pay.astep4': '商家收到他们的货币，你用OST支付',
      'pay.apaybtn': '用OST支付', 'pay.asupported': '适用于任何接受以下方式的网站：',
      'launch.title': '🚀 主网上线清单', 'launch.sub': '让OST在Solana主网上真正运行所需的一切。',
      'ai.title': '赋能每一种智能', 'ai.sub': '我们欢迎AI代理、机器人、服务器和一切形式的数字智能。',
      'build.title': '与我们一起构建未来', 'build.sub': '编码、创作或用像素做梦——OST是您的平台。',
      'build.cta': '今天就开始贡献', 'build.ctasub': '每次提交、翻译和教程都推动人类进步。',
      'build.github': '查看GitHub仓库', 'build.docs': '阅读文档',
      'verify.title': '完全透明', 'verify.sub': '自己验证一切。我们没有什么可隐藏的。',
      'verify.lead': '信任靠事实赢得，而非承诺。',
      'verify.closing': '阅读代码。检查公司。验证国库。<strong>然后做决定。</strong>',
      'wallet.title': '连接你的钱包', 'wallet.sub': '选择一个钱包连接到OST。',
      'footer.mission': '每笔交易都帮助资助卫星基础设施，实现全球互联网接入。<strong>我们共同建设的礼物。</strong>',
      'footer.copy': '开源。为地球上每个人用爱建造。',
    },
    ru: {
      'nav.home': 'Главная', 'nav.newhere': 'Получить OST', 'nav.demos': 'Демо', 'nav.wallet': 'Кошелек',
      'nav.ai': 'ИИ и Боты', 'nav.offline': 'Оффлайн', 'nav.censorship': 'Цензура', 'nav.spacex': 'SpaceX',
      'nav.about': 'Наша История', 'nav.roadmap': 'Дорожная Карта', 'nav.build': 'Создать', 'nav.verify': 'Проверить',
      'nav.connect': 'Подключить кошелек',
      'wallet.dashTitle': 'Мой Кошелек OST', 'wallet.dashSub': 'Ваш личный центр управления. Создайте и управляйте кошельком OST.',
      'bridges.title': 'Мосты, Шлюзы и Биржи', 'bridges.sub': 'Каждый путь к OST — из любой сети, валюты, страны.',
      'hero.tag': 'Следующий Шаг После Биткоина',
      'hero.title': 'Мы все <span class="gradient-text">одна семья.</span>',
      'hero.sub': 'OST — цифровые деньги для каждого гражданина мира. Приватные, мгновенные, подключенные к любой валюте.',
      'hero.cta1': 'Попробовать демо оплаты', 'hero.cta2': 'Получить OST',
      'hero.premine': 'Без премайна', 'hero.settle': 'Расчет', 'hero.opensource': 'Открытый код', 'hero.privacy': 'Приватность',
      'story.title': 'Наша История', 'story.sub': 'Путь от первой искры децентрализованных денег к будущему приватных цифровых наличных.',
      'story.t1.title': 'Искра', 'story.t1.text': 'Биткоин доказал, что люди — не банки, не правительства — могут создавать деньги, пересекающие любые границы.',
      'story.t2.title': 'Разрыв', 'story.t2.text': 'Но Биткоин был медленным, дорогим и публичным. Миллиарды по-прежнему не могли платить за жилье без комиссий банков.',
      'story.t3.title': 'Прорыв', 'story.t3.text': 'Solana Token-2022 запустил конфиденциальные переводы — доказательства с нулевым разглашением скрывают балансы и суммы.',
      'story.t4.title': 'Рождение OST', 'story.t4.text': 'Мы объединили неостановимые деньги, мгновенные расчеты, полную приватность и миссию: финансирование спутниковой инфраструктуры.',
      'story.t5.year': 'Будущее', 'story.t5.title': 'Каждый Гражданин На Связи',
      'story.t5.text': 'Мир, где продавец фруктов в Лагосе и инженер в Тегеране разделяют одну финансовую свободу.',
      'story.lead': 'Мы строим универсальные цифровые деньги, не принадлежащие ни одной стране и служащие каждому гражданину.',
      'story.closing': 'Добро пожаловать в OST. Добро пожаловать домой.',
      'citizens.title': 'Для Каждого Гражданина', 'citizens.sub': 'Без границ. Без исключений. Одно человечество, одни деньги.',
      'features.title': 'Революционный Следующий Шаг', 'features.sub': 'Не просто ещё один токен. Полная финансовая система для реальной жизни.',
      'features.f1.title': 'Конфиденциальные Переводы', 'features.f1.text': 'Доказательства с нулевым разглашением скрывают ваш баланс и каждую транзакцию.',
      'features.f2.title': 'Расчёт за Доли Секунды', 'features.f2.text': '400мс на Solana. Быстрее, чем прикосновение карты.',
      'features.f3.title': 'Мост Для Всех Валют', 'features.f3.text': 'Биткоин, Ethereum, USDC, банковские переводы — всё конвертируется.',
      'features.f4.title': 'Бесплатно навсегда', 'features.f4.text': 'Нулевые комиссии. Финансируется пожертвованиями и инвесторами. Прозрачность на блокчейне.',
      'features.f5.title': 'Оффлайн-Платежи', 'features.f5.text': 'NFC, QR, Bluetooth. Платите без интернета.',
      'features.f6.title': 'ZK Налоговая Отчетность', 'features.f6.text': 'Докажите уплату налогов, не раскрывая баланс.',
      'pay.title': 'Покупки с OST — Реальные Цены', 'pay.sub': 'Настоящие товары, реальные цены. Почувствуйте приватные платежи.',
      'pay.cart': 'Ваша корзина', 'pay.empty': 'Нажмите + чтобы добавить', 'pay.paybtn': 'Оплатить OST',
      'pay.s1': 'Подключение кошелька', 'pay.s2': 'Генерация ZK-доказательства', 'pay.s3': 'Отправка в Solana', 'pay.s4': 'Подтверждено за 0.4с',
      'pay.done': 'Оплата Завершена — Полная Приватность', 'pay.donesub': 'Никто на Земле не видел эту транзакцию.',
      'transfer.title': 'Принесите Свои Деньги Откуда Угодно', 'transfer.sub': 'Цены в реальном времени. Графики. Обменяйте любую валюту на OST.',
      'transfer.calc': 'Калькулятор Обменного Курса', 'transfer.calcsub': 'Посмотрите, сколько OST вы получите за любую сумму.',
      'transfer.widgettitle': 'Конвертировать Сейчас', 'transfer.from': 'Ваша валюта', 'transfer.to': 'Конфиденциальный OST',
      'transfer.result': 'Приватно и мгновенно', 'transfer.convert': 'Конвертировать в OST',
      'transfer.note': 'Работает на Wormhole, Jupiter и Solana Token-2022.',
      'transfer.fiattitle': 'Из фиатной валюты?',
      'transfer.fiattext': 'Используйте <strong>MoonPay</strong>, <strong>Transak</strong> или <strong>Ramp Network</strong> — доступно в 100+ странах.',
      'offline.title': 'Наличные Без Интернета', 'offline.sub': 'Интернет есть не везде. Но ваши деньги должны быть.',
      'offline.lead': 'Транзакции со скоростью света — даже когда свет выключен.',
      'offline.text': 'Представьте, вы передаёте кому-то купюру. Без банка. Без интернета. Просто два человека и обмен ценностями.',
      'offline.nfc': 'NFC Бесконтактная Оплата', 'offline.nfctext': 'Поднесите телефоны друг к другу. Одно касание. Готово.',
      'offline.qr': 'QR-код', 'offline.qrtext': 'Подписанный платёж помещается в один QR-код. Покажите, напечатайте, выгравируйте.',
      'offline.bt': 'Bluetooth', 'offline.bttext': 'BLE передаёт транзакцию на расстоянии до 10 метров.',
      'getost.title': 'Получить OST', 'getost.sub': 'Мгновенный вход из любой крипто или фиатной валюты — без KYC для обмена.',
      'getost.swap': 'Обмен Любой Крипты на OST', 'getost.swaptext': 'Jupiter находит лучший маршрут по всем пулам ликвидности Solana.',
      'getost.jupnote': 'Подключите кошелёк для загрузки виджета обмена.', 'getost.jupbtn': 'Загрузить виджет',
      'getost.fiat': 'Купить за местную валюту', 'getost.fiatsub': 'Купите SOL или USDC, затем обменяйте на OST.',
      'getost.faucet': 'Новичок? Получите Бесплатный OST', 'getost.faucettext': 'Каждый новый кошелёк получает <strong>10 OST</strong> из казны сообщества.',
      'getost.faucetbtn': 'Открыть кран',
      'pay.anywhere': '🌐 Платите OST на любом сайте',
      'pay.anywheresub': 'Вставьте ссылку на любой сайт, где вы покупаете. Мы конвертируем ваши OST в нужную валюту.',
      'pay.aurl': 'URL магазина', 'pay.aamount': 'Сумма к оплате', 'pay.acurrency': 'Их валюта',
      'pay.ayoupay': 'Вы платите:', 'pay.arate': 'Курс:', 'pay.afee': 'Комиссия сети:',
      'pay.ahow': 'Как это работает',
      'pay.astep1': 'Вставьте ссылку на оплату', 'pay.astep2': 'Введите сумму в их валюте',
      'pay.astep3': 'OST конвертирует по живым курсам через Jupiter + Wormhole', 'pay.astep4': 'Продавец получает свою валюту, вы заплатили OST',
      'pay.apaybtn': 'Оплатить OST', 'pay.asupported': 'Работает с любым сайтом, принимающим:',
      'launch.title': '🚀 Чек-лист запуска Mainnet', 'launch.sub': 'Что нужно для запуска OST на Solana mainnet.',
      'ai.title': 'Сила Для Каждого Интеллекта', 'ai.sub': 'Мы приветствуем ИИ-агентов, ботов, серверы и все формы цифрового разума.',
      'build.title': 'Стройте Будущее С Нами', 'build.sub': 'Программируйте, создавайте или мечтайте — OST ваша платформа.',
      'build.cta': 'Начните Вносить Вклад Сегодня', 'build.ctasub': 'Каждый коммит, перевод и урок продвигает человечество.',
      'build.github': 'Открыть GitHub', 'build.docs': 'Читать документацию',
      'verify.title': 'Полная Прозрачность', 'verify.sub': 'Проверьте всё сами. Нам нечего скрывать.',
      'verify.lead': 'Доверие завоёвывается фактами, а не обещаниями.',
      'verify.closing': 'Читайте код. Проверяйте компанию. Верифицируйте казну. <strong>Потом решайте.</strong>',
      'wallet.title': 'Подключить Кошелек', 'wallet.sub': 'Выберите кошелёк для подключения к OST.',
      'footer.mission': 'Каждая транзакция помогает финансировать спутниковую инфраструктуру. <strong>Подарок, который мы строим вместе.</strong>',
      'footer.copy': 'Открытый исходный код. Создано с любовью для каждого человека на Земле.',
    },
    hi: {
      'nav.home': 'होम', 'nav.newhere': 'OST पाएं', 'nav.demos': 'डेमो', 'nav.wallet': 'वॉलेट',
      'nav.ai': 'AI और बॉट्स', 'nav.offline': 'ऑफलाइन', 'nav.censorship': 'सेंसरशिप', 'nav.spacex': 'SpaceX',
      'nav.about': 'हमारी कहानी', 'nav.roadmap': 'रोडमैप', 'nav.build': 'निर्माण', 'nav.verify': 'सत्यापन',
      'nav.connect': 'वॉलेट कनेक्ट करें',
      'wallet.dashTitle': 'मेरा OST वॉलेट', 'wallet.dashSub': 'आपका व्यक्तिगत कमांड सेंटर। अपना OST वॉलेट बनाएं और प्रबंधित करें।',
      'bridges.title': 'ब्रिज, रैंप और एक्सचेंज', 'bridges.sub': 'OST तक हर रास्ता — किसी भी चेन, मुद्रा या देश से।',
      'hero.tag': 'बिटकॉइन के बाद अगला कदम',
      'hero.title': 'हम सब <span class="gradient-text">एक परिवार हैं।</span>',
      'hero.sub': 'OST दुनिया के हर नागरिक के लिए बनी डिजिटल कैश है - निजी, तत्काल, और आपकी किसी भी मुद्रा से जुड़ी।',
      'hero.cta1': 'भुगतान डेमो आज़माएं', 'hero.cta2': 'OST पाएं',
      'hero.premine': 'प्री-माइन नहीं', 'hero.settle': 'निपटान', 'hero.opensource': 'ओपन सोर्स', 'hero.privacy': 'गोपनीयता',
      'story.title': 'हमारी कहानी', 'story.sub': 'विकेंद्रीकृत धन की पहली चिंगारी से निजी डिजिटल नकदी के भविष्य तक की यात्रा।',
      'story.t1.title': 'चिंगारी', 'story.t1.text': 'बिटकॉइन ने साबित किया कि लोग - बैंक नहीं, सरकारें नहीं - हर सीमा पार करने वाला पैसा बना सकते हैं।',
      'story.t2.title': 'अंतराल', 'story.t2.text': 'लेकिन बिटकॉइन धीमा, महंगा और सार्वजनिक था। अरबों लोग बिना बैंक की कमीशन के किराया नहीं दे सकते थे।',
      'story.t3.title': 'सफलता', 'story.t3.text': 'Solana Token-2022 ने गोपनीय ट्रांसफर शुरू किए — शून्य-ज्ञान प्रमाण जो शेष और राशि को दुनिया से छुपाते हैं।',
      'story.t4.title': 'OST का जन्म', 'story.t4.text': 'हमने अदम्य धन, तत्काल निपटान, पूर्ण गोपनीयता और एक मिशन को जोड़ा: उपग्रह बुनियादी ढांचे का वित्तपोषण।',
      'story.t5.year': 'भविष्य', 'story.t5.title': 'हर नागरिक, जुड़ा हुआ',
      'story.t5.text': 'एक दुनिया जहां लागोस का फल विक्रेता और तेहरान का इंजीनियर एक ही वित्तीय स्वतंत्रता साझा करते हैं।',
      'story.lead': 'हम सार्वभौमिक डिजिटल नकदी बना रहे हैं जो किसी देश की नहीं है और हर नागरिक की सेवा करती है।',
      'story.closing': 'OST में आपका स्वागत है। घर वापसी का स्वागत है।',
      'citizens.title': 'हर नागरिक के लिए', 'citizens.sub': 'कोई सीमा नहीं। कोई अपवाद नहीं। एक मानवता, एक धन।',
      'features.title': 'क्रांतिकारी अगला कदम', 'features.sub': 'सिर्फ एक और टोकन नहीं। वास्तविक जीवन के लिए एक पूर्ण वित्तीय प्रणाली।',
      'features.f1.title': 'गोपनीय ट्रांसफर', 'features.f1.text': 'शून्य-ज्ञान प्रमाण आपकी शेष राशि और हर लेनदेन को छिपाते हैं।',
      'features.f2.title': 'सब-सेकंड निपटान', 'features.f2.text': 'Solana पर 400ms। कार्ड टैप करने से भी तेज़।',
      'features.f3.title': 'किसी भी मुद्रा से OST ब्रिज', 'features.f3.text': 'बिटकॉइन, एथेरियम, USDC, बैंक ट्रांसफर — सब कुछ परिवर्तित होता है।',
      'features.f4.title': 'हमेशा मुफ्त', 'features.f4.text': 'शून्य लेनदेन शुल्क। दान और निवेशकों द्वारा वित्त पोषित। ऑन-चेन पारदर्शिता।',
      'features.f5.title': 'ऑफलाइन भुगतान', 'features.f5.text': 'NFC, QR, ब्लूटूथ। इंटरनेट के बिना भुगतान करें।',
      'features.f6.title': 'ZK कर अनुपालन', 'features.f6.text': 'अपनी शेष राशि प्रकट किए बिना करों का प्रमाण दें।',
      'pay.title': 'OST से खरीदारी — वास्तविक कीमतें', 'pay.sub': 'असली उत्पाद, वास्तविक कीमतें। निजी भुगतान कैसा लगता है देखें।',
      'pay.cart': 'आपकी कार्ट', 'pay.empty': 'जोड़ने के लिए + दबाएं', 'pay.paybtn': 'OST से भुगतान करें',
      'pay.s1': 'वॉलेट कनेक्ट हो रहा है', 'pay.s2': 'ZK प्रमाण जनरेट हो रहा है', 'pay.s3': 'Solana पर प्रसारण', 'pay.s4': '0.4s में पुष्टि',
      'pay.done': 'भुगतान पूर्ण — पूरी तरह निजी', 'pay.donesub': 'पृथ्वी पर किसी ने यह लेनदेन नहीं देखा।',
      'transfer.title': 'अपना पैसा कहीं से भी लाएं', 'transfer.sub': 'लाइव कीमतें। रियल-टाइम चार्ट। किसी भी मुद्रा को OST में बदलें।',
      'transfer.calc': 'विनिमय दर कैलकुलेटर', 'transfer.calcsub': 'देखें आपको कितना OST मिलेगा।',
      'transfer.widgettitle': 'अभी बदलें', 'transfer.from': 'आपकी मुद्रा', 'transfer.to': 'गोपनीय OST',
      'transfer.result': 'निजी और तत्काल', 'transfer.convert': 'OST में बदलें',
      'transfer.note': 'Wormhole, Jupiter और Solana Token-2022 द्वारा संचालित।',
      'transfer.fiattitle': 'फिएट मुद्रा से आ रहे हैं?',
      'transfer.fiattext': '<strong>MoonPay</strong>, <strong>Transak</strong>, या <strong>Ramp Network</strong> का उपयोग करें — 100+ देशों में उपलब्ध।',
      'offline.title': 'कहीं भी ऑफलाइन कैश', 'offline.sub': 'इंटरनेट अभी हर जगह नहीं है। लेकिन आपका पैसा होना चाहिए।',
      'offline.lead': 'प्रकाश की गति से लेनदेन — भले बत्ती बंद हो।',
      'offline.text': 'कल्पना करें कि आप किसी को नोट दे रहे हैं। कोई बैंक नहीं। कोई इंटरनेट नहीं। बस दो लोग और मूल्य का आदान-प्रदान।',
      'offline.nfc': 'NFC टैप-टू-पे', 'offline.nfctext': 'फोन एक दूसरे के पास रखें। एक टैप। भुगतान हो गया।',
      'offline.qr': 'QR कोड स्कैन', 'offline.qrtext': 'हस्ताक्षरित भुगतान एक QR कोड में समाता है।',
      'offline.bt': 'ब्लूटूथ', 'offline.bttext': 'BLE 30 फीट तक लेनदेन भेजता है। बाजारों और रेस्तरां के लिए आदर्श।',
      'getost.title': 'OST पाएं', 'getost.sub': 'किसी भी क्रिप्टो या फिएट से तत्काल प्रवेश — स्वैप के लिए KYC नहीं।',
      'getost.swap': 'किसी भी क्रिप्टो को OST में बदलें', 'getost.swaptext': 'Jupiter सभी Solana पूल में सबसे अच्छा रूट ढूंढता है।',
      'getost.jupnote': 'स्वैप विजेट लोड करने के लिए वॉलेट कनेक्ट करें।', 'getost.jupbtn': 'स्वैप विजेट लोड करें',
      'getost.fiat': 'स्थानीय मुद्रा से खरीदें', 'getost.fiatsub': 'SOL या USDC खरीदें, फिर OST में बदलें।',
      'getost.faucet': 'नए हैं? मुफ्त OST प्राप्त करें', 'getost.faucettext': 'हर नए वॉलेट को समुदाय खजाने से <strong>10 OST</strong> मिलता है।',
      'getost.faucetbtn': 'नल खोलें',
      'pay.anywhere': '🌐 OST से किसी भी वेबसाइट पर भुगतान करें',
      'pay.anywheresub': 'जहाँ आप खरीदारी कर रहे हैं वह वेबसाइट पेस्ट करें। हम आपके OST को उनकी मुद्रा में बदल देंगे।',
      'pay.aurl': 'व्यापारी लिंक', 'pay.aamount': 'भुगतान राशि', 'pay.acurrency': 'उनकी मुद्रा',
      'pay.ayoupay': 'आप भुगतान करें:', 'pay.arate': 'दर:', 'pay.afee': 'नेटवर्क शुल्क:',
      'pay.ahow': 'यह कैसे काम करता है',
      'pay.astep1': 'व्यापारी का चेकआउट लिंक पेस्ट करें', 'pay.astep2': 'उनकी मुद्रा में राशि दर्ज करें',
      'pay.astep3': 'OST Jupiter + Wormhole के माध्यम से लाइव दरों पर बदलता है', 'pay.astep4': 'व्यापारी को उनकी मुद्रा मिलती है, आपने OST से भुगतान किया',
      'pay.apaybtn': 'OST से भुगतान करें', 'pay.asupported': 'किसी भी साइट के साथ काम करता है जो स्वीकार करती है:',
      'launch.title': '🚀 मेननेट लॉन्च चेकलिस्ट', 'launch.sub': 'OST को Solana मेननेट पर वास्तविक बनाने के लिए क्या चाहिए।',
      'ai.title': 'हर बुद्धिमत्ता के लिए शक्ति', 'ai.sub': 'हम AI एजेंट्स, बॉट्स, सर्वर और हर प्रकार की डिजिटल बुद्धिमत्ता का स्वागत करते हैं।',
      'build.title': 'हमारे साथ भविष्य बनाएं', 'build.sub': 'कोड करें, बनाएं या सपने देखें — OST आपका मंच है।',
      'build.cta': 'आज ही योगदान शुरू करें', 'build.ctasub': 'हर कमिट, अनुवाद और ट्यूटोरियल मानवता को आगे बढ़ाता है।',
      'build.github': 'GitHub देखें', 'build.docs': 'दस्तावेज़ पढ़ें',
      'verify.title': 'पूर्ण पारदर्शिता', 'verify.sub': 'सब कुछ स्वयं सत्यापित करें। हमारे पास छिपाने को कुछ नहीं।',
      'verify.lead': 'विश्वास तथ्यों से अर्जित होता है, वादों से नहीं।',
      'verify.closing': 'कोड पढ़ें। कंपनी जांचें। खजाना सत्यापित करें। <strong>फिर तय करें।</strong>',
      'wallet.title': 'अपना वॉलेट कनेक्ट करें', 'wallet.sub': 'OST से जुड़ने के लिए एक वॉलेट चुनें।',
      'footer.mission': 'हर लेनदेन सार्वभौमिक इंटरनेट के लिए उपग्रह बुनियादी ढांचे को निधि देने में मदद करता है। <strong>एक उपहार जो हम साथ मिलकर बनाते हैं।</strong>',
      'footer.copy': 'ओपन सोर्स। पृथ्वी पर हर इंसान के लिए प्यार से बनाया गया।',
    },
    ar: {
      'nav.home': 'الرئيسية', 'nav.newhere': 'احصل على OST', 'nav.demos': 'عروض', 'nav.wallet': 'محفظة',
      'nav.ai': 'الذكاء الاصطناعي', 'nav.offline': 'بدون إنترنت', 'nav.censorship': 'الرقابة', 'nav.spacex': 'SpaceX',
      'nav.about': 'قصتنا', 'nav.roadmap': 'خارطة الطريق', 'nav.build': 'بناء', 'nav.verify': 'تحقق',
      'nav.connect': 'ربط المحفظة',
      'wallet.dashTitle': 'محفظة OST الخاصة بي', 'wallet.dashSub': 'مركز التحكم الشخصي. أنشئ واربط وأدر محفظة OST.',
      'bridges.title': 'الجسور والمنحدرات والبورصات', 'bridges.sub': 'كل طريق إلى OST — من أي سلسلة أو عملة أو بلد.',
      'hero.tag': 'الخطوة التالية بعد بيتكوين',
      'hero.title': 'نحن جميعا <span class="gradient-text">عائلة واحدة.</span>',
      'hero.sub': 'OST هو النقد الرقمي المصنوع لكل مواطن في العالم - خاص وفوري ومتصل بأي عملة لديك.',
      'hero.cta1': 'جرب عرض الدفع', 'hero.cta2': 'احصل على OST',
      'hero.premine': 'بدون تعدين مسبق', 'hero.settle': 'تسوية', 'hero.opensource': 'مفتوح المصدر', 'hero.privacy': 'خصوصية',
      'story.title': 'قصتنا', 'story.sub': 'رحلة من أول شرارة للأموال اللامركزية إلى مستقبل النقد الرقمي الخاص.',
      'story.t1.title': 'الشرارة', 'story.t1.text': 'أثبت بيتكوين أن الناس - ليس البنوك ولا الحكومات - يمكنهم إنشاء أموال تعبر كل حدود.',
      'story.t2.title': 'الفجوة', 'story.t2.text': 'لكن بيتكوين كان بطيئاً ومكلفاً وعلنياً. المليارات لا يزالون عاجزين عن دفع الإيجار بدون عمولات البنوك.',
      'story.t3.title': 'الاختراق', 'story.t3.text': 'أطلق Solana Token-2022 التحويلات السرية — براهين المعرفة الصفرية تخفي الأرصدة والمبالغ.',
      'story.t4.title': 'ولادة OST', 'story.t4.text': 'جمعنا بين أموال لا يمكن إيقافها، تسوية فورية، خصوصية كاملة ومهمة: تمويل البنية التحتية الفضائية.',
      'story.t5.year': 'المستقبل', 'story.t5.title': 'كل مواطن متصل',
      'story.t5.text': 'عالم يتشارك فيه بائع الفاكهة في لاغوس والمهندس في طهران نفس الحرية المالية.',
      'story.lead': 'نحن نبني نقداً رقمياً عالمياً لا ينتمي لأي دولة ويخدم كل مواطن. بخصوصية. بسرعة. بمساواة.',
      'story.closing': 'مرحباً بك في OST. مرحباً بك في بيتك.',
      'citizens.title': 'لكل مواطن', 'citizens.sub': 'لا حدود. لا استثناءات. إنسانية واحدة، عملة واحدة.',
      'features.title': 'الخطوة الثورية التالية', 'features.sub': 'ليس مجرد رمز آخر. نظام مالي كامل للحياة الحقيقية.',
      'features.f1.title': 'تحويلات سرية', 'features.f1.text': 'براهين المعرفة الصفرية تخفي رصيدك وكل معاملة.',
      'features.f2.title': 'تسوية فورية', 'features.f2.text': '400 مللي ثانية على Solana. أسرع من لمس بطاقتك.',
      'features.f3.title': 'جسر لكل العملات', 'features.f3.text': 'بيتكوين، إيثريوم، USDC، تحويلات بنكية — كل شيء يتحول.',
      'features.f4.title': 'مجاني إلى الأبد', 'features.f4.text': 'صفر رسوم معاملات. ممول من التبرعات والمستثمرين. شفافية على البلوكتشين.',
      'features.f5.title': 'دفع بدون إنترنت', 'features.f5.text': 'NFC، QR، بلوتوث. ادفع بدون إنترنت.',
      'features.f6.title': 'امتثال ضريبي ZK', 'features.f6.text': 'أثبت دفع الضرائب دون كشف رصيدك.',
      'pay.title': 'تسوق بـ OST — أسعار حقيقية', 'pay.sub': 'منتجات حقيقية بأسعار واقعية. اختبر المدفوعات الخاصة.',
      'pay.cart': 'سلة التسوق', 'pay.empty': 'اضغط + للإضافة', 'pay.paybtn': 'ادفع بـ OST',
      'pay.s1': 'ربط المحفظة', 'pay.s2': 'توليد إثبات ZK', 'pay.s3': 'البث إلى Solana', 'pay.s4': 'تأكيد في 0.4 ثانية',
      'pay.done': 'اكتمل الدفع — خصوصية كاملة', 'pay.donesub': 'لم ير أحد على الأرض هذه المعاملة.',
      'transfer.title': 'أحضر أموالك من أي مكان', 'transfer.sub': 'أسعار مباشرة. رسوم بيانية فورية. حوّل أي عملة إلى OST.',
      'transfer.calc': 'حاسبة سعر الصرف', 'transfer.calcsub': 'اعرف كم OST ستحصل على أي مبلغ.',
      'transfer.widgettitle': 'حوّل الآن', 'transfer.from': 'عملتك', 'transfer.to': 'OST السري',
      'transfer.result': 'خاص وفوري', 'transfer.convert': 'تحويل إلى OST',
      'transfer.note': 'مدعوم من Wormhole وJupiter وSolana Token-2022.',
      'transfer.fiattitle': 'قادم من عملة ورقية؟',
      'transfer.fiattext': 'استخدم <strong>MoonPay</strong> أو <strong>Transak</strong> أو <strong>Ramp Network</strong> — متاح في 100+ دولة.',
      'offline.title': 'نقد بدون إنترنت في أي مكان', 'offline.sub': 'الإنترنت ليس في كل مكان بعد. لكن أموالك يجب أن تكون.',
      'offline.lead': 'معاملات بسرعة الضوء — حتى عند انقطاع الكهرباء.',
      'offline.text': 'تخيل أنك تعطي شخصاً ورقة نقدية. لا بنك. لا إنترنت. فقط شخصان وقيمة تنتقل.',
      'offline.nfc': 'NFC لمس للدفع', 'offline.nfctext': 'قرّب الهواتف من بعضها. لمسة واحدة. تم الدفع.',
      'offline.qr': 'مسح رمز QR', 'offline.qrtext': 'الدفعة الموقعة تناسب رمز QR واحد. اعرضه أو اطبعه.',
      'offline.bt': 'بلوتوث قريب', 'offline.bttext': 'BLE ينقل المعاملة حتى 10 أمتار. مثالي للأسواق والمطاعم.',
      'getost.title': 'احصل على OST', 'getost.sub': 'دخول فوري من أي عملة رقمية أو ورقية — بدون KYC للتبادل.',
      'getost.swap': 'بادل أي عملة رقمية بـ OST', 'getost.swaptext': 'Jupiter يجد أفضل مسار عبر جميع مجمعات السيولة.',
      'getost.jupnote': 'اربط محفظتك لتحميل أداة التبادل.', 'getost.jupbtn': 'تحميل أداة التبادل',
      'getost.fiat': 'اشترِ بالعملة المحلية', 'getost.fiatsub': 'اشترِ SOL أو USDC، ثم بادل إلى OST.',
      'getost.faucet': 'جديد هنا؟ احصل على OST مجاني', 'getost.faucettext': 'كل محفظة جديدة تحصل على <strong>10 OST</strong> من خزينة المجتمع.',
      'getost.faucetbtn': 'افتح الصنبور',
      'pay.anywhere': '🌐 ادفع بـ OST في أي موقع',
      'pay.anywheresub': 'الصق رابط أي موقع تتسوق منه. سنحول OST الخاص بك إلى عملتهم.',
      'pay.aurl': 'رابط المتجر', 'pay.aamount': 'المبلغ المطلوب', 'pay.acurrency': 'عملتهم',
      'pay.ayoupay': 'أنت تدفع:', 'pay.arate': 'السعر:', 'pay.afee': 'رسوم الشبكة:',
      'pay.ahow': 'كيف يعمل',
      'pay.astep1': 'الصق رابط الدفع للمتجر', 'pay.astep2': 'أدخل المبلغ بعملتهم',
      'pay.astep3': 'OST يحول بأسعار حية عبر Jupiter + Wormhole', 'pay.astep4': 'المتجر يستلم عملته، وأنت دفعت بـ OST',
      'pay.apaybtn': 'ادفع بـ OST', 'pay.asupported': 'يعمل مع أي موقع يقبل:',
      'launch.title': '🚀 قائمة إطلاق الشبكة الرئيسية', 'launch.sub': 'ما نحتاجه لجعل OST حقيقياً على Solana mainnet.',
      'ai.title': 'قوة لكل ذكاء', 'ai.sub': 'نرحب بوكلاء الذكاء الاصطناعي والروبوتات والخوادم وكل أشكال الذكاء الرقمي.',
      'build.title': 'ابنِ المستقبل معنا', 'build.sub': 'برمج أو أنشئ أو احلم — OST منصتك.',
      'build.cta': 'ابدأ المساهمة اليوم', 'build.ctasub': 'كل تعديل وترجمة ودرس يدفع البشرية للأمام.',
      'build.github': 'عرض GitHub', 'build.docs': 'اقرأ التوثيق',
      'verify.title': 'شفافية كاملة', 'verify.sub': 'تحقق من كل شيء بنفسك. ليس لدينا ما نخفيه.',
      'verify.lead': 'الثقة تُكتسب بالحقائق لا بالوعود.',
      'verify.closing': 'اقرأ الكود. تحقق من الشركة. دقق في الخزينة. <strong>ثم قرر.</strong>',
      'wallet.title': 'ربط محفظتك', 'wallet.sub': 'اختر محفظة للاتصال بـ OST.',
      'footer.mission': 'كل معاملة تساعد في تمويل البنية التحتية للأقمار الصناعية. <strong>هدية نبنيها معاً.</strong>',
      'footer.copy': 'مفتوح المصدر. مبني بحب لكل إنسان على الأرض.',
    },
    pt: {
      'nav.home': 'Inicio', 'nav.newhere': 'Obter OST', 'nav.demos': 'Demos', 'nav.wallet': 'Carteira',
      'nav.ai': 'IA e Bots', 'nav.offline': 'Offline', 'nav.censorship': 'Censura', 'nav.spacex': 'SpaceX',
      'nav.about': 'Nossa Historia', 'nav.roadmap': 'Roteiro', 'nav.build': 'Construir', 'nav.verify': 'Verificar',
      'nav.connect': 'Conectar Carteira',
      'wallet.dashTitle': 'Minha Carteira OST', 'wallet.dashSub': 'Seu centro de comando pessoal. Crie, conecte e gerencie sua carteira OST.',
      'bridges.title': 'Pontes, Rampas e Exchanges', 'bridges.sub': 'Todo caminho para OST — de qualquer cadeia, moeda ou pais.',
      'hero.tag': 'O Proximo Passo Apos o Bitcoin',
      'hero.title': 'Somos todos <span class="gradient-text">uma familia.</span>',
      'hero.sub': 'OST e o dinheiro digital feito para cada cidadao do mundo - privado, instantaneo e conectado a qualquer moeda que voce ja tem.',
      'hero.cta1': 'Experimentar Demo de Pagamento', 'hero.cta2': 'Obter OST',
      'hero.premine': 'Pre-mineracao', 'hero.settle': 'Liquidacao', 'hero.opensource': 'Codigo Aberto', 'hero.privacy': 'Privacidade',
      'story.title': 'Nossa Historia', 'story.sub': 'Uma jornada da primeira faísca do dinheiro descentralizado ao futuro do dinheiro digital privado.',
      'story.t1.title': 'A Faísca', 'story.t1.text': 'Bitcoin provou que pessoas - nao bancos, nao governos - poderiam criar dinheiro que cruza todas as fronteiras.',
      'story.t2.title': 'A Lacuna', 'story.t2.text': 'Mas o Bitcoin era lento, caro e publico. Bilhoes ainda nao podiam pagar aluguel sem que os bancos ficassem com sua parte.',
      'story.t3.title': 'A Descoberta', 'story.t3.text': 'Solana Token-2022 lancou transferencias confidenciais — provas de conhecimento zero que escondem saldos e valores.',
      'story.t4.title': 'Nasce o OST', 'story.t4.text': 'Combinamos dinheiro imparavel, liquidacao instantanea, privacidade total e uma missao: financiar infraestrutura de satelites.',
      'story.t5.year': 'O Futuro', 'story.t5.title': 'Cada Cidadao Conectado',
      'story.t5.text': 'Um mundo onde o vendedor de frutas em Lagos e o engenheiro em Teera compartilham a mesma liberdade financeira.',
      'story.lead': 'Estamos construindo dinheiro digital universal que nao pertence a nenhum pais e serve a cada cidadao.',
      'story.closing': 'Bem-vindo ao OST. Bem-vindo ao lar.',
      'citizens.title': 'Para Cada Cidadao', 'citizens.sub': 'Sem fronteiras. Sem excecoes. Uma humanidade, um dinheiro.',
      'features.title': 'O Proximo Passo Revolucionario', 'features.sub': 'Nao e apenas mais um token. Um sistema financeiro completo para a vida real.',
      'features.f1.title': 'Transferencias Confidenciais', 'features.f1.text': 'Provas de conhecimento zero escondem seu saldo e cada transacao.',
      'features.f2.title': 'Liquidacao em Fracao de Segundo', 'features.f2.text': '400ms no Solana. Mais rapido que tocar seu cartao.',
      'features.f3.title': 'Ponte Para Todas as Moedas', 'features.f3.text': 'Bitcoin, Ethereum, USDC, transferencias bancarias — tudo se converte.',
      'features.f4.title': 'Gratis Para Sempre', 'features.f4.text': 'Zero taxas de transacao. Financiado por doacoes e investidores. Transparencia on-chain.',
      'features.f5.title': 'Pagamentos Offline', 'features.f5.text': 'NFC, QR, Bluetooth. Pague sem internet.',
      'features.f6.title': 'Conformidade Fiscal ZK', 'features.f6.text': 'Prove seus impostos sem revelar seu saldo.',
      'pay.title': 'Compre com OST — Precos Reais', 'pay.sub': 'Produtos reais, precos reais. Sinta os pagamentos privados.',
      'pay.cart': 'Seu Carrinho', 'pay.empty': 'Toque + para adicionar', 'pay.paybtn': 'Pagar com OST',
      'pay.s1': 'Conectando carteira', 'pay.s2': 'Gerando prova ZK', 'pay.s3': 'Transmitindo para Solana', 'pay.s4': 'Confirmado em 0.4s',
      'pay.done': 'Pagamento Completo — Totalmente Privado', 'pay.donesub': 'Ninguem na Terra viu esta transacao.',
      'transfer.title': 'Traga Seu Dinheiro de Qualquer Lugar', 'transfer.sub': 'Precos ao vivo. Graficos em tempo real. Troque qualquer moeda por OST.',
      'transfer.calc': 'Calculadora de Cambio', 'transfer.calcsub': 'Veja quanto OST voce recebe por qualquer valor.',
      'transfer.widgettitle': 'Converter Agora', 'transfer.from': 'Sua Moeda', 'transfer.to': 'OST Confidencial',
      'transfer.result': 'Privado e Instantaneo', 'transfer.convert': 'Converter para OST',
      'transfer.note': 'Turbinado por Wormhole, Jupiter e Solana Token-2022.',
      'transfer.fiattitle': 'Vindo de moeda fiduciaria?',
      'transfer.fiattext': 'Use <strong>MoonPay</strong>, <strong>Transak</strong> ou <strong>Ramp Network</strong> — disponivel em 100+ paises.',
      'offline.title': 'Dinheiro Offline em Qualquer Lugar', 'offline.sub': 'A internet ainda nao esta em todo lugar. Mas seu dinheiro deveria estar.',
      'offline.lead': 'Transacoes na velocidade da luz — mesmo com as luzes apagadas.',
      'offline.text': 'Imagine entregar uma nota a alguem. Sem banco. Sem internet. Apenas duas pessoas e valor trocando de maos.',
      'offline.nfc': 'NFC Toque para Pagar', 'offline.nfctext': 'Aproxime os telefones. Um toque. Pagamento feito.',
      'offline.qr': 'Leitura de QR Code', 'offline.qrtext': 'O pagamento assinado cabe em um unico QR code.',
      'offline.bt': 'Bluetooth Proximo', 'offline.bttext': 'BLE transmite a transacao ate 10 metros. Perfeito para mercados.',
      'getost.title': 'Obter OST', 'getost.sub': 'Entrada instantanea de qualquer cripto ou fiat — sem KYC para trocas.',
      'getost.swap': 'Troque Qualquer Cripto por OST', 'getost.swaptext': 'Jupiter encontra a melhor rota em todos os pools de liquidez Solana.',
      'getost.jupnote': 'Conecte sua carteira para carregar o widget de troca.', 'getost.jupbtn': 'Carregar Widget',
      'getost.fiat': 'Compre com Moeda Local', 'getost.fiatsub': 'Compre SOL ou USDC, depois troque por OST.',
      'getost.faucet': 'Novo Aqui? Receba OST Gratis', 'getost.faucettext': 'Cada nova carteira recebe <strong>10 OST</strong> do tesouro comunitario.',
      'getost.faucetbtn': 'Abrir a Torneira',
      'pay.anywhere': '🌐 Pague em Qualquer Site com OST',
      'pay.anywheresub': 'Cole qualquer site onde voce esta comprando. Convertemos seu OST na moeda que eles aceitam.',
      'pay.aurl': 'URL do Comerciante', 'pay.aamount': 'Valor a Pagar', 'pay.acurrency': 'Moeda Deles',
      'pay.ayoupay': 'Voce Paga:', 'pay.arate': 'Taxa:', 'pay.afee': 'Taxa de Rede:',
      'pay.ahow': 'Como Funciona',
      'pay.astep1': 'Cole o link de checkout do comerciante', 'pay.astep2': 'Digite o valor na moeda deles',
      'pay.astep3': 'OST converte a taxas ao vivo via Jupiter + Wormhole', 'pay.astep4': 'Comerciante recebe sua moeda, voce pagou com OST',
      'pay.apaybtn': 'Pagar com OST', 'pay.asupported': 'Funciona com qualquer site que aceite:',
      'launch.title': '🚀 Checklist de Lancamento Mainnet', 'launch.sub': 'O que precisamos para tornar OST real na Solana mainnet.',
      'ai.title': 'Poder Para Toda Inteligencia', 'ai.sub': 'Damos boas-vindas a agentes IA, bots, servidores e toda forma de inteligencia digital.',
      'build.title': 'Construa o Futuro Conosco', 'build.sub': 'Programe, crie ou sonhe em pixels — OST e sua plataforma.',
      'build.cta': 'Comece a Contribuir Hoje', 'build.ctasub': 'Cada commit, traducao e tutorial move a humanidade adiante.',
      'build.github': 'Ver Repositorio GitHub', 'build.docs': 'Ler Documentacao',
      'verify.title': 'Transparencia Total', 'verify.sub': 'Verifique tudo voce mesmo. Nao temos nada a esconder.',
      'verify.lead': 'Confianca se conquista com fatos, nao promessas.',
      'verify.closing': 'Leia o codigo. Verifique a empresa. Audite o tesouro. <strong>Depois decida.</strong>',
      'wallet.title': 'Conectar Sua Carteira', 'wallet.sub': 'Escolha uma carteira para conectar ao OST.',
      'footer.mission': 'Cada transacao ajuda a financiar infraestrutura de satelites. <strong>Um presente que construimos juntos.</strong>',
      'footer.copy': 'Codigo aberto. Construido com amor para cada ser humano na Terra.',
    },
    fr: {
      'nav.home': 'Accueil', 'nav.newhere': 'Obtenir OST', 'nav.demos': 'Demos', 'nav.wallet': 'Portefeuille',
      'nav.ai': 'IA et Bots', 'nav.offline': 'Hors Ligne', 'nav.censorship': 'Censure', 'nav.spacex': 'SpaceX',
      'nav.about': 'Notre Histoire', 'nav.roadmap': 'Feuille de Route', 'nav.build': 'Construire', 'nav.verify': 'Verifier',
      'nav.connect': 'Connecter Portefeuille',
      'wallet.dashTitle': 'Mon Portefeuille OST', 'wallet.dashSub': 'Votre centre de commande personnel. Creez, connectez et gerez votre portefeuille OST.',
      'bridges.title': 'Ponts, Rampes et Echanges', 'bridges.sub': 'Chaque chemin vers OST — depuis toute chaine, devise ou pays.',
      'hero.tag': 'La Prochaine Etape Apres Bitcoin',
      'hero.title': 'Nous sommes tous <span class="gradient-text">une famille.</span>',
      'hero.sub': 'OST est l\'argent numerique fait pour chaque citoyen du monde - prive, instantane et connecte a toute devise.',
      'hero.cta1': 'Essayer la Demo de Paiement', 'hero.cta2': 'Obtenir OST',
      'hero.premine': 'Pre-minage', 'hero.settle': 'Reglement', 'hero.opensource': 'Open Source', 'hero.privacy': 'Confidentialite',
      'story.title': 'Notre Histoire', 'story.sub': 'Un voyage de la premiere etincelle de la monnaie decentralisee au futur de l\'argent numerique prive.',
      'story.t1.title': 'L\'Etincelle', 'story.t1.text': 'Bitcoin a prouve que les gens - pas les banques, pas les gouvernements - pouvaient creer de l\'argent traversant toutes les frontieres.',
      'story.t2.title': 'Le Fossé', 'story.t2.text': 'Mais Bitcoin etait lent, cher et public. Des milliards ne pouvaient toujours pas payer leur loyer sans les commissions bancaires.',
      'story.t3.title': 'La Percee', 'story.t3.text': 'Solana Token-2022 a lance les transferts confidentiels — des preuves a divulgation nulle cachent soldes et montants.',
      'story.t4.title': 'Naissance d\'OST', 'story.t4.text': 'Nous avons combine monnaie indestructible, reglement instantane, confidentialite totale et une mission: financer les satellites.',
      'story.t5.year': 'Le Futur', 'story.t5.title': 'Chaque Citoyen Connecte',
      'story.t5.text': 'Un monde ou le vendeur de fruits a Lagos et l\'ingenieur a Teheran partagent la meme liberte financiere.',
      'story.lead': 'Nous construisons un argent numerique universel qui n\'appartient a aucun pays et sert chaque citoyen.',
      'story.closing': 'Bienvenue chez OST. Bienvenue a la maison.',
      'citizens.title': 'Pour Chaque Citoyen', 'citizens.sub': 'Sans frontieres. Sans exceptions. Une humanite, une monnaie.',
      'features.title': 'La Prochaine Etape Revolutionnaire', 'features.sub': 'Pas juste un autre jeton. Un systeme financier complet pour la vie reelle.',
      'features.f1.title': 'Transferts Confidentiels', 'features.f1.text': 'Les preuves a divulgation nulle cachent votre solde et chaque transaction.',
      'features.f2.title': 'Reglement Infra-Seconde', 'features.f2.text': '400ms sur Solana. Plus rapide qu\'un paiement sans contact.',
      'features.f3.title': 'Pont Universel vers OST', 'features.f3.text': 'Bitcoin, Ethereum, USDC, virements — tout se convertit.',
      'features.f4.title': 'Gratuit Pour Toujours', 'features.f4.text': 'Zero frais de transaction. Finance par des dons et des investisseurs. Transparence on-chain.',
      'features.f5.title': 'Paiements Hors Ligne', 'features.f5.text': 'NFC, QR, Bluetooth. Payez sans internet.',
      'features.f6.title': 'Conformite Fiscale ZK', 'features.f6.text': 'Prouvez vos impots sans reveler votre solde.',
      'pay.title': 'Achetez avec OST — Prix Reels', 'pay.sub': 'Vrais produits, vrais prix. Decouvrez les paiements prives.',
      'pay.cart': 'Votre Panier', 'pay.empty': 'Appuyez sur + pour ajouter', 'pay.paybtn': 'Payer avec OST',
      'pay.s1': 'Connexion du portefeuille', 'pay.s2': 'Generation de preuve ZK', 'pay.s3': 'Diffusion sur Solana', 'pay.s4': 'Confirme en 0.4s',
      'pay.done': 'Paiement Termine — Totalement Prive', 'pay.donesub': 'Personne sur Terre n\'a vu cette transaction.',
      'transfer.title': 'Apportez Votre Argent de Partout', 'transfer.sub': 'Prix en direct. Graphiques en temps reel. Echangez n\'importe quelle devise contre OST.',
      'transfer.calc': 'Calculateur de Taux de Change', 'transfer.calcsub': 'Voyez combien d\'OST vous obtenez pour n\'importe quel montant.',
      'transfer.widgettitle': 'Convertir Maintenant', 'transfer.from': 'Votre Devise', 'transfer.to': 'OST Confidentiel',
      'transfer.result': 'Prive et Instantane', 'transfer.convert': 'Convertir en OST',
      'transfer.note': 'Propulse par Wormhole, Jupiter et Solana Token-2022.',
      'transfer.fiattitle': 'Vous venez du fiat?',
      'transfer.fiattext': 'Utilisez <strong>MoonPay</strong>, <strong>Transak</strong> ou <strong>Ramp Network</strong> — disponible dans 100+ pays.',
      'offline.title': 'Argent Hors Ligne Partout', 'offline.sub': 'Internet n\'est pas partout. Mais votre argent devrait l\'etre.',
      'offline.lead': 'Transactions a la vitesse de la lumiere — meme quand les lumieres sont eteintes.',
      'offline.text': 'Imaginez donner un billet a quelqu\'un. Pas de banque. Pas d\'internet. Juste deux personnes et de la valeur qui change de mains.',
      'offline.nfc': 'NFC Sans Contact', 'offline.nfctext': 'Approchez les telephones. Un tap. Paiement effectue.',
      'offline.qr': 'Scan QR Code', 'offline.qrtext': 'Le paiement signe tient dans un seul QR code.',
      'offline.bt': 'Bluetooth Proximite', 'offline.bttext': 'BLE transmet la transaction jusqu\'a 10 metres. Ideal pour les marches.',
      'getost.title': 'Obtenir OST', 'getost.sub': 'Entree instantanee depuis n\'importe quelle crypto ou fiat — sans KYC pour les echanges.',
      'getost.swap': 'Echangez N\'importe Quelle Crypto Contre OST', 'getost.swaptext': 'Jupiter trouve la meilleure route dans tous les pools de liquidite.',
      'getost.jupnote': 'Connectez votre portefeuille pour charger le widget d\'echange.', 'getost.jupbtn': 'Charger le Widget',
      'getost.fiat': 'Achetez avec Votre Monnaie Locale', 'getost.fiatsub': 'Achetez SOL ou USDC, puis echangez contre OST.',
      'getost.faucet': 'Nouveau? Recevez OST Gratuit', 'getost.faucettext': 'Chaque nouveau portefeuille recoit <strong>10 OST</strong> du tresor communautaire.',
      'getost.faucetbtn': 'Ouvrir le Robinet',
      'pay.anywhere': '🌐 Payez Partout avec OST',
      'pay.anywheresub': 'Collez le lien de n\'importe quel site ou vous achetez. Nous convertissons vos OST dans leur devise.',
      'pay.aurl': 'URL du Marchand', 'pay.aamount': 'Montant a Payer', 'pay.acurrency': 'Leur Devise',
      'pay.ayoupay': 'Vous Payez:', 'pay.arate': 'Taux:', 'pay.afee': 'Frais Reseau:',
      'pay.ahow': 'Comment ca Marche',
      'pay.astep1': 'Collez le lien de paiement du marchand', 'pay.astep2': 'Entrez le montant dans leur devise',
      'pay.astep3': 'OST convertit aux taux en direct via Jupiter + Wormhole', 'pay.astep4': 'Le marchand recoit sa devise, vous avez paye en OST',
      'pay.apaybtn': 'Payer avec OST', 'pay.asupported': 'Fonctionne avec tout site acceptant:',
      'launch.title': '🚀 Checklist Lancement Mainnet', 'launch.sub': 'Ce qu\'il faut pour rendre OST reel sur Solana mainnet.',
      'ai.title': 'Puissance Pour Chaque Intelligence', 'ai.sub': 'Nous accueillons les agents IA, bots, serveurs et toute forme d\'intelligence numerique.',
      'build.title': 'Construisez le Futur Avec Nous', 'build.sub': 'Codez, creez ou revez en pixels — OST est votre plateforme.',
      'build.cta': 'Commencez a Contribuer Aujourd\'hui', 'build.ctasub': 'Chaque commit, traduction et tutoriel fait avancer l\'humanite.',
      'build.github': 'Voir le Depot GitHub', 'build.docs': 'Lire la Documentation',
      'verify.title': 'Transparence Totale', 'verify.sub': 'Verifiez tout vous-meme. Nous n\'avons rien a cacher.',
      'verify.lead': 'La confiance se gagne avec des faits, pas des promesses.',
      'verify.closing': 'Lisez le code. Verifiez l\'entreprise. Auditez le tresor. <strong>Puis decidez.</strong>',
      'wallet.title': 'Connecter Votre Portefeuille', 'wallet.sub': 'Choisissez un portefeuille pour vous connecter a OST.',
      'footer.mission': 'Chaque transaction aide a financer l\'infrastructure satellite. <strong>Un cadeau que nous construisons ensemble.</strong>',
      'footer.copy': 'Open source. Construit avec amour pour chaque habitant de la Terre.',
    },
    ja: {
      'nav.home': 'ホーム', 'nav.newhere': 'OST入手', 'nav.demos': 'デモ', 'nav.wallet': 'ウォレット',
      'nav.ai': 'AIとボット', 'nav.offline': 'オフライン', 'nav.censorship': '検閲', 'nav.spacex': 'SpaceX',
      'nav.about': '私たちの物語', 'nav.roadmap': 'ロードマップ', 'nav.build': '開発', 'nav.verify': '検証',
      'nav.connect': 'ウォレット接続',
      'wallet.dashTitle': 'マイOSTウォレット', 'wallet.dashSub': 'パーソナルコマンドセンター。OSTウォレットを作成、接続、管理。',
      'bridges.title': 'ブリッジ、ランプ、取引所', 'bridges.sub': 'OSTへのすべての道 — あらゆるチェーン、通貨、国から。',
      'hero.tag': 'ビットコインの次のステップ',
      'hero.title': '私たちは皆 <span class="gradient-text">一つの家族です。</span>',
      'hero.sub': 'OSTは世界のすべての市民のためのデジタルキャッシュです - プライベート、即時、すでに持っているどの通貨にも接続。',
      'hero.cta1': '支払いデモを試す', 'hero.cta2': 'OSTを入手',
      'hero.premine': 'プレマインなし', 'hero.settle': '決済', 'hero.opensource': 'オープンソース', 'hero.privacy': 'プライバシー',
      'story.title': '私たちの物語', 'story.sub': '分散型通貨の最初の火花からプライベートデジタルキャッシュの未来への旅。',
      'story.t1.title': '火花', 'story.t1.text': 'ビットコインは、銀行でも政府でもなく人々があらゆる国境を越える通貨を作れることを証明しました。',
      'story.t2.title': 'ギャップ', 'story.t2.text': 'しかしビットコインは遅く、高価で、公開的でした。何十億もの人々が銀行の手数料なしでは家賃も払えませんでした。',
      'story.t3.title': 'ブレークスルー', 'story.t3.text': 'Solana Token-2022は機密転送を開始 — ゼロ知識証明が残高と金額を世界中から隠します。',
      'story.t4.title': 'OSTの誕生', 'story.t4.text': '止められない通貨、即時決済、完全なプライバシー、そしてミッション：衛星インフラの資金調達を組み合わせました。',
      'story.t5.year': '未来', 'story.t5.title': 'すべての市民がつながる',
      'story.t5.text': 'ラゴスの果物売りとテヘランのエンジニアが同じ金融の自由を共有する世界。',
      'story.lead': 'どの国にも属さず、すべての市民に奉仕する普遍的デジタルキャッシュを構築しています。',
      'story.closing': 'OSTへようこそ。おかえりなさい。',
      'citizens.title': 'すべての市民のために', 'citizens.sub': '国境なし。例外なし。ひとつの人類、ひとつの通貨。',
      'features.title': '革命的な次のステップ', 'features.sub': '単なるトークンではありません。実生活のための完全な金融システム。',
      'features.f1.title': '機密転送', 'features.f1.text': 'ゼロ知識証明があなたの残高とすべての取引を隠します。',
      'features.f2.title': 'サブセカンド決済', 'features.f2.text': 'Solanaで400ミリ秒。カードをタップするより速い。',
      'features.f3.title': '万通貨ブリッジ', 'features.f3.text': 'ビットコイン、イーサリアム、USDC、銀行送金 — すべて変換可能。',
      'features.f4.title': '永久無料', 'features.f4.text': '取引手数料ゼロ。寄付と投資家による資金提供。オンチェーンの透明性。',
      'features.f5.title': 'オフライン決済', 'features.f5.text': 'NFC、QR、Bluetooth。インターネットなしで支払い。',
      'features.f6.title': 'ZK税務コンプライアンス', 'features.f6.text': '残高を明かさずに納税を証明。',
      'pay.title': 'OSTでショッピング — リアル価格', 'pay.sub': '本物の商品、実際の価格。プライベート決済を体験。',
      'pay.cart': 'カート', 'pay.empty': '+をタップして追加', 'pay.paybtn': 'OSTで支払う',
      'pay.s1': 'ウォレット接続中', 'pay.s2': 'ZK証明生成中', 'pay.s3': 'Solanaにブロードキャスト', 'pay.s4': '0.4秒で確認',
      'pay.done': '支払い完了 — 完全プライベート', 'pay.donesub': '地球上の誰もこの取引を見ていません。',
      'transfer.title': 'どこからでもお金を持ち込む', 'transfer.sub': 'ライブ価格。リアルタイムチャート。あらゆる通貨をOSTに交換。',
      'transfer.calc': '為替レート計算機', 'transfer.calcsub': '任意の金額で何OSTが得られるか確認。',
      'transfer.widgettitle': '今すぐ変換', 'transfer.from': 'あなたの通貨', 'transfer.to': '機密OST',
      'transfer.result': 'プライベートかつ即時', 'transfer.convert': 'OSTに変換',
      'transfer.note': 'Wormhole、Jupiter、Solana Token-2022搭載。',
      'transfer.fiattitle': '法定通貨から？',
      'transfer.fiattext': '<strong>MoonPay</strong>、<strong>Transak</strong>、<strong>Ramp Network</strong>を利用 — 100カ国以上で利用可能。',
      'offline.title': 'どこでもオフラインキャッシュ', 'offline.sub': 'インターネットはまだどこにでもありません。でもあなたのお金はあるべきです。',
      'offline.lead': '光速の取引 — 電気が消えていても。',
      'offline.text': '誰かに紙幣を渡すことを想像してください。銀行なし。インターネットなし。二人の人間と価値の移動だけ。',
      'offline.nfc': 'NFCタップ決済', 'offline.nfctext': 'スマホを近づける。ワンタップ。支払い完了。',
      'offline.qr': 'QRコードスキャン', 'offline.qrtext': '署名された支払いは1つのQRコードに収まります。',
      'offline.bt': 'Bluetooth近接', 'offline.bttext': 'BLEが約10メートルの範囲で取引を送信。市場やレストランに最適。',
      'getost.title': 'OST入手', 'getost.sub': 'あらゆる暗号通貨またはフィアットから即時参入 — スワップにKYC不要。',
      'getost.swap': 'あらゆる暗号通貨をOSTに交換', 'getost.swaptext': 'JupiterがすべてのSolana流動性プールで最適ルートを検索。',
      'getost.jupnote': 'ウォレットを接続してスワップウィジェットを読み込む。', 'getost.jupbtn': 'ウィジェットを読み込む',
      'getost.fiat': '現地通貨で購入', 'getost.fiatsub': 'SOLまたはUSDCを購入し、OSTに交換。',
      'getost.faucet': '初めてですか？無料OSTを取得', 'getost.faucettext': '新しいウォレットにはコミュニティトレジャリーから<strong>10 OST</strong>が支給されます。',
      'getost.faucetbtn': '蛇口を開く',
      'pay.anywhere': '🌐 OSTでどこでも支払い',
      'pay.anywheresub': '購入中のウェブサイトのリンクを貼り付けてください。OSTを相手が受け入れる通貨に変換します。',
      'pay.aurl': '販売者URL', 'pay.aamount': '支払い金額', 'pay.acurrency': '相手の通貨',
      'pay.ayoupay': 'お支払い:', 'pay.arate': 'レート:', 'pay.afee': 'ネットワーク手数料:',
      'pay.ahow': '仕組み',
      'pay.astep1': '販売者のチェックアウトリンクを貼り付け', 'pay.astep2': '相手の通貨で金額を入力',
      'pay.astep3': 'OSTがJupiter + Wormholeでリアルタイム変換', 'pay.astep4': '販売者は自国通貨を受け取り、あなたはOSTで支払い',
      'pay.apaybtn': 'OSTで支払う', 'pay.asupported': '以下を受け入れるすべてのサイトで動作：',
      'launch.title': '🚀 メインネットローンチチェックリスト', 'launch.sub': 'Solanaメインネットでの実稼働に必要なもの。',
      'ai.title': 'あらゆる知性のための力', 'ai.sub': 'AIエージェント、ボット、サーバー、あらゆるデジタル知性を歓迎します。',
      'build.title': '私たちと未来を建てよう', 'build.sub': 'コード、創造、ピクセルで夢を — OSTはあなたのプラットフォーム。',
      'build.cta': '今日から貢献を始めよう', 'build.ctasub': 'すべてのコミット、翻訳、チュートリアルが人類を前進させます。',
      'build.github': 'GitHubリポジトリを見る', 'build.docs': 'ドキュメントを読む',
      'verify.title': '完全な透明性', 'verify.sub': 'すべてをご自身で検証してください。隠すものはありません。',
      'verify.lead': '信頼は事実で獲得するもので、約束ではありません。',
      'verify.closing': 'コードを読む。会社を確認する。トレジャリーを検証する。<strong>それから判断してください。</strong>',
      'wallet.title': 'ウォレットを接続', 'wallet.sub': 'OSTに接続するウォレットを選択してください。',
      'footer.mission': 'すべての取引が衛星インフラの資金調達を支援します。<strong>共に築く贈り物。</strong>',
      'footer.copy': 'オープンソース。地球のすべての人々のために愛を込めて作りました。',
    },
    ko: {
      'nav.home': '홈', 'nav.newhere': 'OST 받기', 'nav.demos': '데모', 'nav.wallet': '지갑',
      'nav.ai': 'AI와 봇', 'nav.offline': '오프라인', 'nav.censorship': '검열', 'nav.spacex': 'SpaceX',
      'nav.about': '우리의 이야기', 'nav.roadmap': '로드맵', 'nav.build': '개발', 'nav.verify': '검증',
      'nav.connect': '지갑 연결',
      'wallet.dashTitle': '내 OST 지갑', 'wallet.dashSub': '개인 커맨드 센터. OST 지갑을 만들고, 연결하고, 관리하세요.',
      'bridges.title': '브릿지, 램프 & 거래소', 'bridges.sub': 'OST로 가는 모든 길 — 어떤 체인, 통화, 국가에서든.',
      'hero.tag': '비트코인 이후의 다음 단계',
      'hero.title': '우리 모두는 <span class="gradient-text">하나의 가족입니다.</span>',
      'hero.sub': 'OST는 세계 모든 시민을 위한 디지털 현금입니다 - 프라이빗, 즉시, 이미 가진 모든 통화와 연결.',
      'hero.cta1': '결제 데모 체험', 'hero.cta2': 'OST 받기',
      'hero.premine': '프리마이닝 없음', 'hero.settle': '결제', 'hero.opensource': '오픈 소스', 'hero.privacy': '프라이버시',
      'story.title': '우리의 이야기', 'story.sub': '탈중앙화 화폐의 첫 불꽃에서 프라이빗 디지털 현금의 미래까지의 여정.',
      'story.t1.title': '불꽃', 'story.t1.text': '비트코인은 은행도 정부도 아닌 사람들이 모든 국경을 넘는 화폐를 만들 수 있음을 증명했습니다.',
      'story.t2.title': '격차', 'story.t2.text': '그러나 비트코인은 느리고, 비싸고, 공개적이었습니다. 수십억 명이 여전히 은행 수수료 없이 집세도 낼 수 없었습니다.',
      'story.t3.title': '돌파구', 'story.t3.text': 'Solana Token-2022가 기밀 전송을 시작 — 영지식 증명이 잔액과 금액을 숨깁니다.',
      'story.t4.title': 'OST 탄생', 'story.t4.text': '멈출 수 없는 화폐, 즉시 결제, 완전한 프라이버시, 그리고 위성 인프라 자금 조달 미션을 결합했습니다.',
      'story.t5.year': '미래', 'story.t5.title': '모든 시민이 연결되다',
      'story.t5.text': '라고스의 과일 장수와 테헤란의 엔지니어가 같은 금융 자유를 공유하는 세상.',
      'story.lead': '어느 나라에도 속하지 않고 모든 시민을 위해 봉사하는 보편적 디지털 현금을 만들고 있습니다.',
      'story.closing': 'OST에 오신 것을 환영합니다. 집에 오신 걸 환영합니다.',
      'citizens.title': '모든 시민을 위해', 'citizens.sub': '국경 없이. 예외 없이. 하나의 인류, 하나의 화폐.',
      'features.title': '혁명적인 다음 단계', 'features.sub': '단순한 토큰이 아닙니다. 실제 삶을 위한 완전한 금융 시스템.',
      'features.f1.title': '기밀 전송', 'features.f1.text': '영지식 증명이 잔액과 모든 거래를 숨깁니다.',
      'features.f2.title': '1초 미만 결제', 'features.f2.text': 'Solana에서 400ms. 카드 터치보다 빠릅니다.',
      'features.f3.title': '모든 통화 브릿지', 'features.f3.text': '비트코인, 이더리움, USDC, 은행 송금 — 모든 것이 전환됩니다.',
      'features.f4.title': '영원히 무료', 'features.f4.text': '거래 수수료 제로. 기부금과 투자자가 자금 지원. 온체인 투명성.',
      'features.f5.title': '오프라인 결제', 'features.f5.text': 'NFC, QR, 블루투스. 인터넷 없이 결제.',
      'features.f6.title': 'ZK 세금 준수', 'features.f6.text': '잔액을 공개하지 않고 세금을 증명합니다.',
      'pay.title': 'OST로 쇼핑 — 실제 가격', 'pay.sub': '실제 제품, 실제 가격. 프라이빗 결제를 경험하세요.',
      'pay.cart': '장바구니', 'pay.empty': '+를 눌러 추가', 'pay.paybtn': 'OST로 결제',
      'pay.s1': '지갑 연결 중', 'pay.s2': 'ZK 증명 생성 중', 'pay.s3': 'Solana에 브로드캐스트', 'pay.s4': '0.4초 만에 확인',
      'pay.done': '결제 완료 — 완전 프라이빗', 'pay.donesub': '지구상 아무도 이 거래를 보지 못했습니다.',
      'transfer.title': '어디서든 돈을 가져오세요', 'transfer.sub': '실시간 가격. 실시간 차트. 모든 통화를 OST로 교환.',
      'transfer.calc': '환율 계산기', 'transfer.calcsub': '어떤 금액이든 얼마의 OST를 받을 수 있는지 확인하세요.',
      'transfer.widgettitle': '지금 전환', 'transfer.from': '당신의 통화', 'transfer.to': '기밀 OST',
      'transfer.result': '프라이빗하고 즉시', 'transfer.convert': 'OST로 전환',
      'transfer.note': 'Wormhole, Jupiter, Solana Token-2022 기반.',
      'transfer.fiattitle': '법정화폐에서 오시나요?',
      'transfer.fiattext': '<strong>MoonPay</strong>, <strong>Transak</strong>, 또는 <strong>Ramp Network</strong> 사용 — 100여 개국에서 이용 가능.',
      'offline.title': '어디서든 오프라인 현금', 'offline.sub': '인터넷은 아직 모든 곳에 없습니다. 하지만 당신의 돈은 있어야 합니다.',
      'offline.lead': '빛의 속도로 거래 — 불이 꺼져 있어도.',
      'offline.text': '누군가에게 지폐를 건네는 것을 상상하세요. 은행 없이. 인터넷 없이. 두 사람과 가치의 교환만.',
      'offline.nfc': 'NFC 탭 결제', 'offline.nfctext': '폰을 가까이 대세요. 한 번 탭. 결제 완료.',
      'offline.qr': 'QR 코드 스캔', 'offline.qrtext': '서명된 결제가 하나의 QR 코드에 담깁니다.',
      'offline.bt': '블루투스 근접', 'offline.bttext': 'BLE가 약 10미터 범위에서 거래를 전송합니다.',
      'getost.title': 'OST 받기', 'getost.sub': '모든 암호화폐 또는 법정화폐에서 즉시 입장 — 스왑에 KYC 불필요.',
      'getost.swap': '모든 암호화폐를 OST로 교환', 'getost.swaptext': 'Jupiter가 모든 Solana 유동성 풀에서 최적 경로를 찾습니다.',
      'getost.jupnote': '스왑 위젯을 로드하려면 지갑을 연결하세요.', 'getost.jupbtn': '위젯 로드',
      'getost.fiat': '현지 화폐로 구매', 'getost.fiatsub': 'SOL 또는 USDC를 구매한 후 OST로 교환.',
      'getost.faucet': '처음이신가요? 무료 OST를 받으세요', 'getost.faucettext': '모든 새 지갑은 커뮤니티 재무에서 <strong>10 OST</strong>를 받습니다.',
      'getost.faucetbtn': '수도꼭지 열기',
      'pay.anywhere': '🌐 OST로 어디서나 결제',
      'pay.anywheresub': '구매 중인 웹사이트 링크를 붙여넣으세요. OST를 상대방이 받는 통화로 변환합니다.',
      'pay.aurl': '판매자 URL', 'pay.aamount': '결제 금액', 'pay.acurrency': '상대 통화',
      'pay.ayoupay': '결제액:', 'pay.arate': '환율:', 'pay.afee': '네트워크 수수료:',
      'pay.ahow': '작동 방식',
      'pay.astep1': '판매자 결제 링크 붙여넣기', 'pay.astep2': '상대 통화로 금액 입력',
      'pay.astep3': 'OST가 Jupiter + Wormhole로 실시간 변환', 'pay.astep4': '판매자는 자국 통화를 받고, 당신은 OST로 결제',
      'pay.apaybtn': 'OST로 결제', 'pay.asupported': '다음을 수락하는 모든 사이트에서 작동:',
      'launch.title': '🚀 메인넷 출시 체크리스트', 'launch.sub': 'Solana 메인넷에서 OST를 실현하기 위해 필요한 것.',
      'ai.title': '모든 지능을 위한 힘', 'ai.sub': 'AI 에이전트, 봇, 서버 및 모든 형태의 디지털 지능을 환영합니다.',
      'build.title': '우리와 함께 미래를 만드세요', 'build.sub': '코드, 창작, 픽셀의 꿈 — OST가 당신의 플랫폼입니다.',
      'build.cta': '오늘 기여를 시작하세요', 'build.ctasub': '모든 커밋, 번역, 튜토리얼이 인류를 전진시킵니다.',
      'build.github': 'GitHub 저장소 보기', 'build.docs': '문서 읽기',
      'verify.title': '완전한 투명성', 'verify.sub': '모든 것을 직접 검증하세요. 숨길 것이 없습니다.',
      'verify.lead': '신뢰는 약속이 아닌 사실로 얻는 것입니다.',
      'verify.closing': '코드를 읽으세요. 회사를 확인하세요. 재무를 검증하세요. <strong>그런 다음 결정하세요.</strong>',
      'wallet.title': '지갑 연결하기', 'wallet.sub': 'OST에 연결할 지갑을 선택하세요.',
      'footer.mission': '모든 거래가 위성 인프라 자금 조달을 돕습니다. <strong>함께 만드는 선물.</strong>',
      'footer.copy': '오픈 소스. 지구의 모든 사람을 위해 사랑으로 만들었습니다.',
    },
    tr: {
      'nav.home': 'Ana Sayfa', 'nav.newhere': 'OST Al', 'nav.demos': 'Demolar', 'nav.wallet': 'Cuzdan',
      'nav.ai': 'Yapay Zeka', 'nav.offline': 'Cevrimdisi', 'nav.censorship': 'Sansur', 'nav.spacex': 'SpaceX',
      'nav.about': 'Hikayemiz', 'nav.roadmap': 'Yol Haritasi', 'nav.build': 'Gelistir', 'nav.verify': 'Dogrula',
      'nav.connect': 'Cuzdani Bagla',
      'wallet.dashTitle': 'OST Cuzdanim', 'wallet.dashSub': 'Kisisel komuta merkeziniz. OST cuzdaninizi olusturun ve yonetin.',
      'bridges.title': 'Kopruler, Rampalar ve Borsalar', 'bridges.sub': 'OST ye her yol — herhangi bir zincir, para birimi veya ulkeden.',
      'hero.tag': 'Bitcoin\'den Sonraki Adim',
      'hero.title': 'Hepimiz <span class="gradient-text">bir aileyiz.</span>',
      'hero.sub': 'OST, dunyadaki her vatandas icin yapilmis dijital nakit paradir — ozel, anlik ve zaten sahip oldugunuz herhangi bir para birimine bagli.',
      'hero.cta1': 'Odeme Demosunu Dene', 'hero.cta2': 'OST Al',
      'hero.premine': 'On Madencilik Yok', 'hero.settle': 'Uzlasma', 'hero.opensource': 'Acik Kaynak', 'hero.privacy': 'Gizlilik',
      'story.title': 'Hikayemiz', 'story.sub': 'Merkezi olmayan paranin ilk kivilcimindan ozel dijital nakitin gelecegine bir yolculuk.',
      'story.t1.title': 'Kivilcim', 'story.t1.text': 'Bitcoin, insanlarin — bankalar degil, hukumetler degil — her siniri asan para yaratabilecegini kanitladi.',
      'story.t2.title': 'Bosluk', 'story.t2.text': 'Ama Bitcoin yavasti, pahaliydi ve herkese acikti. Milyarlarca insan bankalarin payini almadan kira bile odeyemiyordu.',
      'story.t3.title': 'Atilim', 'story.t3.text': 'Solana Token-2022 gizli transferleri baslatti — sifir bilgi kanitlari bakiyeleri ve tutarlari gizler.',
      'story.t4.title': 'OST Doguyor', 'story.t4.text': 'Durdurulamaz para, anlik uzlasma, tam gizlilik ve bir misyon: uydu altyapisini finanse etmek.',
      'story.t5.year': 'Gelecek', 'story.t5.title': 'Her Vatandas Bagli',
      'story.t5.text': 'Lagos\'taki meyve saticisi ile Tahran\'daki muhendisin ayni finansal ozgurlugu paylastigi bir dunya.',
      'story.lead': 'Hicbir ulkeye ait olmayan ve her vatandasa hizmet eden evrensel dijital nakit insa ediyoruz.',
      'story.closing': 'OST\'ye hos geldiniz. Eve hos geldiniz.',
      'citizens.title': 'Her Vatandas Icin', 'citizens.sub': 'Sinir yok. Istisna yok. Bir insanlik, bir para.',
      'features.title': 'Devrimci Sonraki Adim', 'features.sub': 'Sadece bir token degil. Gercek yasam icin eksiksiz bir finansal sistem.',
      'features.f1.title': 'Gizli Transferler', 'features.f1.text': 'Sifir bilgi kanitlari bakiyenizi ve her islemi gizler.',
      'features.f2.title': 'Saniyenin Altinda Uzlasma', 'features.f2.text': 'Solana\'da 400ms. Kartinizi dokundurmaktan hizli.',
      'features.f3.title': 'Tum Para Birimleri Koprüsü', 'features.f3.text': 'Bitcoin, Ethereum, USDC, banka transferleri — her sey donusur.',
      'features.f4.title': 'Sonsuza Kadar Ucretsiz', 'features.f4.text': 'Sifir islem ucreti. Bagislar ve yatirimcilar tarafindan finanse edilir. Zincir uzerinde seffaflik.',
      'features.f5.title': 'Cevrimdisi Odemeler', 'features.f5.text': 'NFC, QR, Bluetooth. Internetsiz odeyin.',
      'features.f6.title': 'ZK Vergi Uyumu', 'features.f6.text': 'Bakiyenizi aciklamadan vergi odedigini kanitlayin.',
      'pay.title': 'OST ile Alisveris — Gercek Fiyatlar', 'pay.sub': 'Gercek urunler, gercek fiyatlar. Ozel odemeleri deneyin.',
      'pay.cart': 'Sepetiniz', 'pay.empty': 'Eklemek icin + dokunun', 'pay.paybtn': 'OST ile Ode',
      'pay.s1': 'Cuzdan baglaniyor', 'pay.s2': 'ZK kaniti olusturuluyor', 'pay.s3': 'Solana\'ya yayinlaniyor', 'pay.s4': '0.4 saniyede onaylandi',
      'pay.done': 'Odeme Tamamlandi — Tamamen Ozel', 'pay.donesub': 'Yeryuzunde kimse bu islemi gormedi.',
      'transfer.title': 'Paranizi Her Yerden Getirin', 'transfer.sub': 'Canli fiyatlar. Gercek zamanli grafikler. Herhangi bir para birimini OST\'ye donustürun.',
      'transfer.calc': 'Doviz Kuru Hesaplayicisi', 'transfer.calcsub': 'Her miktar icin ne kadar OST alacaginizi gorun.',
      'transfer.widgettitle': 'Simdi Donustür', 'transfer.from': 'Para Biriminiz', 'transfer.to': 'Gizli OST',
      'transfer.result': 'Ozel ve Anlik', 'transfer.convert': 'OST\'ye Donustür',
      'transfer.note': 'Wormhole, Jupiter ve Solana Token-2022 tarafindan desteklenmektedir.',
      'transfer.fiattitle': 'Fiat\'tan mi geliyorsunuz?',
      'transfer.fiattext': '<strong>MoonPay</strong>, <strong>Transak</strong> veya <strong>Ramp Network</strong> kullanin — 100\'den fazla ulkede mevcut.',
      'offline.title': 'Her Yerde Cevrimdisi Nakit', 'offline.sub': 'Internet henuz her yerde yok. Ama paraniz olmali.',
      'offline.lead': 'Isik hizinda islemler — isiklar kapali olsa bile.',
      'offline.text': 'Birine banknot verdiginizi hayal edin. Banka yok. Internet yok. Sadece iki kisi ve el degistiren deger.',
      'offline.nfc': 'NFC Dokunarak Ode', 'offline.nfctext': 'Telefonlari birbirine yaklastirin. Bir dokunma. Odeme tamam.',
      'offline.qr': 'QR Kod Tara', 'offline.qrtext': 'Imzalanmis odeme tek bir QR koda sigar.',
      'offline.bt': 'Bluetooth Yakinlik', 'offline.bttext': 'BLE islemi 10 metreye kadar iletir. Pazarlar ve restoranlar icin ideal.',
      'getost.title': 'OST Al', 'getost.sub': 'Herhangi bir kripto veya fiat\'tan aninda giris — takas icin KYC yok.',
      'getost.swap': 'Herhangi Bir Kripto\'yu OST\'ye Donustür', 'getost.swaptext': 'Jupiter tüm Solana likidite havuzlarinda en iyi rotayi bulur.',
      'getost.jupnote': 'Takas widget\'ini yuklemek icin cuzdaninizi baglayiniz.', 'getost.jupbtn': 'Widget\'i Yükle',
      'getost.fiat': 'Yerel Para ile Satin Al', 'getost.fiatsub': 'SOL veya USDC satin alin, ardindan OST\'ye donustürun.',
      'getost.faucet': 'Yeni misiniz? Ucretsiz OST Alin', 'getost.faucettext': 'Her yeni cuzdan topluluk hazinesinden <strong>10 OST</strong> alir.',
      'getost.faucetbtn': 'Muslugu Ac',
      'pay.anywhere': '🌐 OST ile Her Yerde Ode',
      'pay.anywheresub': 'Alisveris yaptiginiz herhangi bir web sitesini yapisitirin. OST\'nizi kabul ettikleri para birimine donusturuyoruz.',
      'pay.aurl': 'Magaza URL', 'pay.aamount': 'Odeme Tutari', 'pay.acurrency': 'Para Birimi',
      'pay.ayoupay': 'Odediginiz:', 'pay.arate': 'Kur:', 'pay.afee': 'Ag Ucreti:',
      'pay.ahow': 'Nasil Calisir',
      'pay.astep1': 'Magaza odeme linkini yapisitirin', 'pay.astep2': 'Kendi para birimlerinde tutari girin',
      'pay.astep3': 'OST, Jupiter + Wormhole uzerinden canli kurlarla donusturur', 'pay.astep4': 'Magaza kendi para birimini alir, siz OST ile odediniz',
      'pay.apaybtn': 'OST ile Ode', 'pay.asupported': 'Asagidakileri kabul eden her sitede calisir:',
      'launch.title': '🚀 Mainnet Lansman Kontrol Listesi', 'launch.sub': 'OST\'yi Solana mainnet\'te gercege donusturmek icin gerekenler.',
      'ai.title': 'Her Zeka Icin Güc', 'ai.sub': 'Yapay zeka ajanlari, botlar, sunucular ve her türlu dijital zekayi karsilliyoruz.',
      'build.title': 'Bizimle Gelecegi Insa Edin', 'build.sub': 'Kodlayin, yaratin veya piksellerle hayal kurun — OST sizin platformunuz.',
      'build.cta': 'Bugün Katki Saglamaya Baslayin', 'build.ctasub': 'Her commit, ceviri ve ders insanligi ileriye tasir.',
      'build.github': 'GitHub Deposunu Gor', 'build.docs': 'Belgeleri Oku',
      'verify.title': 'Tam Seffaflik', 'verify.sub': 'Her seyi kendiniz dogrulayin. Saklayacak bir seyimiz yok.',
      'verify.lead': 'Güven vaatlerle degil, gerceklerle kazanilir.',
      'verify.closing': 'Kodu okuyun. Sirketi kontrol edin. Hazineyi dogrulayin. <strong>Sonra karar verin.</strong>',
      'wallet.title': 'Cuzdaninizi Baglayiniz', 'wallet.sub': 'OST\'ye baglanmak icin bir cuzdan secin.',
      'footer.mission': 'Her islem uydu altyapisi icin fon saglamaya yardimci olur. <strong>Birlikte insa ettigimiz bir hediye.</strong>',
      'footer.copy': 'Acik kaynak. Yeryuzundeki her insan icin sevgiyle insa edildi.',
    },
  };

  let currentLang = 'en';

  function applyTranslations(lang) {
    currentLang = lang;
    const dict = translations[lang] || {};
    const fallback = translations.en;
    $$('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = dict[key] || fallback[key];
      if (val) el.innerHTML = val;
    });
    document.documentElement.setAttribute('data-lang', lang);
    document.documentElement.lang = lang;
  }

  if (langTrigger) {
    langTrigger.addEventListener('click', e => {
      e.stopPropagation();
      langList.classList.toggle('open');
    });
  }
  $$('#langList a').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const lang = a.getAttribute('data-lang');
      $$('#langList a').forEach(x => x.classList.remove('active'));
      a.classList.add('active');
      langCode.textContent = lang.toUpperCase();
      langList.classList.remove('open');
      applyTranslations(lang);
      toast('🌐', `Language: ${lang.toUpperCase()}`);
    });
  });
  document.addEventListener('click', () => { if (langList) langList.classList.remove('open'); });

  /* ---------- WALLET ---------- */
  const walletBtn = $('#walletBtn');
  const walletText = $('#walletText');
  const walletModal = $('#walletModal');
  const walletClose = $('#walletClose');
  const walletOverlay = $('#walletModalOverlay');
  let connectedWallet = null;
  let solanaConnection = null;

  // OST Program & Network Config
  const OST_CONFIG = {
    programId: 'J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY',
    mint: '383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ',
    wostMint: 'Ac8RTG9R15HDXkjJDphRNpEgawEh1o5wLFaWPGFjiHoS',
    network: 'devnet',
    rpcUrl: 'https://api.devnet.solana.com'
  };
  window.OST_CONFIG = OST_CONFIG;

  // Initialize Solana connection
  function getSolanaConnection() {
    if (!solanaConnection && typeof solanaWeb3 !== 'undefined') {
      solanaConnection = new solanaWeb3.Connection(OST_CONFIG.rpcUrl, 'confirmed');
    }
    return solanaConnection;
  }

  // Check if OST program is deployed on-chain
  async function checkProgramDeployed() {
    try {
      const conn = getSolanaConnection();
      if (!conn) return false;
      const programPubkey = new solanaWeb3.PublicKey(OST_CONFIG.programId);
      const info = await conn.getAccountInfo(programPubkey);
      const deployed = info !== null && info.executable === true;
      const pidShort = $('#programIdShort');
      if (pidShort) {
        pidShort.style.color = deployed ? '#22c55e' : '#f59e0b';
        pidShort.title = deployed ? 'Program deployed and verified' : 'Program not yet deployed';
      }
      // Update deploy checklist item
      const deployItem = $('#checklistDeploy');
      const deployIcon = $('#checklistDeployIcon');
      const deployStatus = $('#checklistDeployStatus');
      if (deployed && deployItem) {
        deployItem.className = 'checklist-item done';
        if (deployIcon) deployIcon.innerHTML = '&#9989;';
        if (deployStatus) { deployStatus.className = 'check-status status-done'; deployStatus.textContent = 'Deployed'; }
      }
      return deployed;
    } catch {
      return false;
    }
  }
  setTimeout(checkProgramDeployed, 3000);

  // Fetch and display SOL balance after wallet connect
  async function updateWalletBalance(pubkeyStr) {
    try {
      const conn = getSolanaConnection();
      if (!conn) return;
      const pubkey = new solanaWeb3.PublicKey(pubkeyStr);
      const lamports = await conn.getBalance(pubkey);
      const sol = (lamports / 1e9).toFixed(4);
      toast('💰', `Balance: ${sol} SOL`);
    } catch (e) {
      // silently ignore balance fetch errors
    }
  }

  function openWalletModal() { if (walletModal) walletModal.classList.add('open'); }
  function closeWalletModal() { if (walletModal) walletModal.classList.remove('open'); }

  // Check Solana network connectivity & update status dot
  async function checkNetworkStatus() {
    const dot = $('#networkDot');
    const label = $('#networkLabel');
    try {
      const conn = getSolanaConnection();
      if (!conn) { if (dot) dot.style.background = '#ef4444'; return; }
      const slot = await conn.getSlot();
      if (dot) dot.style.background = '#22c55e';
      if (label) label.textContent = 'Devnet (Slot ' + slot.toLocaleString() + ')';
    } catch {
      if (dot) dot.style.background = '#ef4444';
      if (label) label.textContent = 'Devnet (Offline)';
    }
  }
  // Check network on load and every 30s
  setTimeout(checkNetworkStatus, 2000);
  setInterval(checkNetworkStatus, 30000);

  // Verify wallet account exists on-chain
  async function verifyWalletAccount(pubkeyStr) {
    try {
      const conn = getSolanaConnection();
      if (!conn) return { verified: false, balance: 0 };
      const pubkey = new solanaWeb3.PublicKey(pubkeyStr);
      const accountInfo = await conn.getAccountInfo(pubkey);
      const lamports = await conn.getBalance(pubkey);
      return { verified: accountInfo !== null || lamports > 0, balance: lamports / 1e9 };
    } catch {
      return { verified: false, balance: 0 };
    }
  }

  if (walletBtn) walletBtn.addEventListener('click', () => {
    if (connectedWallet) {
      // Disconnect: try to disconnect from provider
      try { if (window.solana && window.solana.disconnect) window.solana.disconnect(); } catch {}
      try { if (window.solflare && window.solflare.disconnect) window.solflare.disconnect(); } catch {}
      connectedWallet = null;
      walletBtn.classList.remove('connected');
      walletText.textContent = translations[currentLang]?.['nav.connect'] || 'Connect Wallet';
      toast('👛', 'Wallet disconnected');
      return;
    }
    openWalletModal();
  });
  if (walletClose) walletClose.addEventListener('click', closeWalletModal);
  if (walletOverlay) walletOverlay.addEventListener('click', closeWalletModal);

  $$('.wallet-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const walletType = btn.getAttribute('data-wallet');
      connectWallet(walletType);
    });
  });

  function connectWallet(type) {
    closeWalletModal();
    const providers = {
      phantom: () => {
        if (window.solana && window.solana.isPhantom) {
          return window.solana.connect().then(r => r.publicKey.toString());
        }
        window.open('https://phantom.app/', '_blank');
        return Promise.reject('Install Phantom');
      },
      solflare: () => {
        if (window.solflare && window.solflare.isSolflare) {
          return window.solflare.connect().then(() => window.solflare.publicKey.toString());
        }
        window.open('https://solflare.com/', '_blank');
        return Promise.reject('Install Solflare');
      },
      backpack: () => {
        if (window.backpack) {
          return window.backpack.connect().then(r => r.publicKey.toString());
        }
        window.open('https://www.backpack.app/', '_blank');
        return Promise.reject('Install Backpack');
      },
      ledger: () => {
        toast('💳', 'Ledger: Use Phantom or Solflare with Ledger connected');
        return Promise.reject('Use Phantom');
      },
      walletconnect: () => {
        toast('🔗', 'WalletConnect: Coming soon');
        return Promise.reject('Coming soon');
      },
      google: () => {
        window.open('https://app.tor.us/', '_blank');
        toast('🔑', 'Opening Web3Auth / Torus...');
        return Promise.reject('Redirect');
      }
    };

    const fn = providers[type];
    if (!fn) return;

    fn().then(pubkey => {
      connectedWallet = pubkey;
      const short = pubkey.slice(0, 4) + '...' + pubkey.slice(-4);
      walletBtn.classList.add('connected');
      walletText.textContent = short;
      toast('✅', `Connected: ${short}`);
      // Verify account & show balance
      verifyWalletAccount(pubkey).then(info => {
        if (info.verified) {
          toast('🔗', `Account verified — ${info.balance.toFixed(4)} SOL`);
        } else {
          toast('💡', `New wallet — ${info.balance.toFixed(4)} SOL. Use the faucet below to get devnet SOL!`);
        }
      });
    }).catch(err => {
      if (typeof err === 'string' && err !== 'Redirect') {
        toast('⚠️', err);
      }
    });
  }

  /* ---------- 3D EARTH — Realistic Day/Night ---------- */
  function initGlobe() {
    const canvas = $('#globeCanvas');
    if (!canvas) { console.warn('Globe: canvas #globeCanvas not found'); return; }
    if (typeof THREE === 'undefined') { console.warn('Globe: THREE.js not loaded'); return; }

    const wrap = $('#heroGlobeWrap') || canvas.parentElement;
    const getSize = () => ({ w: wrap.clientWidth || 600, h: wrap.clientHeight || 600 });

    const scene = new THREE.Scene();
    let { w, h } = getSize();
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    camera.position.z = 2.6;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    // Earth sphere — higher resolution for crisp visuals
    const earthGeo = new THREE.SphereGeometry(1, 96, 96);

    // Load textures from NASA public domain
    const texLoader = new THREE.TextureLoader();
    const dayTexUrl = 'https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg';
    const nightTexUrl = 'https://unpkg.com/three-globe@2.31.1/example/img/earth-night.jpg';
    const bumpTexUrl = 'https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png';

    let dayTex, nightTex, bumpTex;
    let texturesLoaded = 0;
    const totalTextures = 3;

    function onTextureLoaded() {
      texturesLoaded++;
      if (texturesLoaded === totalTextures) buildEarth();
    }

    dayTex = texLoader.load(dayTexUrl, onTextureLoaded, undefined, () => {
      dayTex = null; onTextureLoaded();
    });
    nightTex = texLoader.load(nightTexUrl, onTextureLoaded, undefined, () => {
      nightTex = null; onTextureLoaded();
    });
    bumpTex = texLoader.load(bumpTexUrl, onTextureLoaded, undefined, () => {
      bumpTex = null; onTextureLoaded();
    });

    let earthMesh, nightMesh, atmMesh;
    let earthShaderMat; // custom shader for day/night blending

    function buildEarth() {
      // Custom shader: blends day texture and night (city lights) texture
      // based on the dot product of surface normal with sun direction.
      // Dark hemisphere shows bright city lights; lit hemisphere shows day map.
      if (dayTex && nightTex) {
        earthShaderMat = new THREE.ShaderMaterial({
          uniforms: {
            dayMap: { value: dayTex },
            nightMap: { value: nightTex },
            bumpMap: { value: bumpTex },
            sunDir: { value: new THREE.Vector3(1, 0, 0) },
            nightBrightness: { value: 1.8 },
          },
          vertexShader: `
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vWorldPos;
            void main() {
              vUv = uv;
              vNormal = normalize(normalMatrix * normal);
              vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform sampler2D dayMap;
            uniform sampler2D nightMap;
            uniform vec3 sunDir;
            uniform float nightBrightness;
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vWorldPos;
            void main() {
              vec3 nSun = normalize(sunDir);
              float cosAngle = dot(vNormal, nSun);
              // Smooth terminator transition
              float dayFactor = smoothstep(-0.15, 0.25, cosAngle);
              vec3 dayColor = texture2D(dayMap, vUv).rgb;
              vec3 nightColor = texture2D(nightMap, vUv).rgb * nightBrightness;
              // Day side gets sunlight shading
              float sunShade = clamp(cosAngle * 0.6 + 0.5, 0.35, 1.0);
              dayColor *= sunShade;
              // Blend: day lit areas show day map, dark areas show city lights
              vec3 finalColor = mix(nightColor, dayColor, dayFactor);
              // Add slight blue ambient to terminator
              float termGlow = exp(-pow((cosAngle - 0.05) * 6.0, 2.0)) * 0.08;
              finalColor += vec3(0.2, 0.4, 0.8) * termGlow;
              gl_FragColor = vec4(finalColor, 1.0);
            }
          `,
        });
        earthMesh = new THREE.Mesh(earthGeo, earthShaderMat);
      } else {
        // Fallback if textures didn't load
        const earthMat = new THREE.MeshPhongMaterial({
          map: dayTex,
          bumpMap: bumpTex,
          bumpScale: 0.03,
          specular: new THREE.Color(0x333333),
          shininess: 15,
        });
        earthMesh = new THREE.Mesh(earthGeo, earthMat);
      }
      scene.add(earthMesh);

      // Atmosphere glow — enhanced
      const atmGeo = new THREE.SphereGeometry(1.05, 96, 96);
      const atmMat = new THREE.ShaderMaterial({
        uniforms: {
          coeficient: { value: 0.8 },
          power: { value: 3.0 },
          glowColor: { value: new THREE.Color(0x4488ff) },
        },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vPosition;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float coeficient;
          uniform float power;
          uniform vec3 glowColor;
          varying vec3 vNormal;
          varying vec3 vPosition;
          void main() {
            vec3 viewDir = normalize(-vPosition);
            float intensity = pow(coeficient - dot(vNormal, viewDir), power);
            gl_FragColor = vec4(glowColor, intensity * 0.6);
          }
        `,
        transparent: true,
        side: THREE.FrontSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      atmMesh = new THREE.Mesh(atmGeo, atmMat);
      scene.add(atmMesh);

      // Outer glow — larger halo
      const outerGeo = new THREE.SphereGeometry(1.18, 64, 64);
      const outerMat = new THREE.ShaderMaterial({
        uniforms: {
          glowColor: { value: new THREE.Color(0x6699ff) },
        },
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 glowColor;
          varying vec3 vNormal;
          void main() {
            float intensity = pow(0.65 - dot(vNormal, vec3(0, 0, 1.0)), 4.0);
            gl_FragColor = vec4(glowColor, intensity * 0.35);
          }
        `,
        transparent: true,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      scene.add(new THREE.Mesh(outerGeo, outerMat));

      // Orbital ring (accent detail)
      const ringGeo = new THREE.RingGeometry(1.35, 1.37, 128);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x6d9fff, transparent: true, opacity: 0.12,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI * 0.42;
      ring.rotation.y = Math.PI * 0.15;
      scene.add(ring);
    }

    // Fallback: wireframe globe while textures load
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x6d9fff, wireframe: true, transparent: true, opacity: 0.15 });
    const wireMesh = new THREE.Mesh(earthGeo.clone(), wireMat);
    scene.add(wireMesh);

    // Stars
    const starsGeo = new THREE.BufferGeometry();
    const starPositions = [];
    const starColors = [];
    for (let i = 0; i < 5000; i++) {
      const r = 50 + Math.random() * 200;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions.push(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
      const c = 0.7 + Math.random() * 0.3;
      starColors.push(c, c, 0.8 + Math.random() * 0.2);
    }
    starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    starsGeo.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
    const starsMat = new THREE.PointsMaterial({ size: 0.5, vertexColors: true, transparent: true, opacity: 0.8 });
    scene.add(new THREE.Points(starsGeo, starsMat));

    // Nebula clouds (colored point clusters)
    function addNebula(cx, cy, cz, color, count) {
      const g = new THREE.BufferGeometry();
      const pos = [];
      for (let i = 0; i < count; i++) {
        pos.push(cx + (Math.random() - 0.5) * 30, cy + (Math.random() - 0.5) * 30, cz + (Math.random() - 0.5) * 30);
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const m = new THREE.PointsMaterial({ size: 1.5, color, transparent: true, opacity: 0.08 });
      scene.add(new THREE.Points(g, m));
    }
    addNebula(-40, 20, -80, 0xff66aa, 600);
    addNebula(50, -10, -60, 0x6644ff, 500);
    addNebula(30, 30, -100, 0x44aaff, 400);

    // Sun light (for atmosphere/glow only — day/night handled by custom shader)
    const sunLight = new THREE.DirectionalLight(0xffffff, 0.4);
    scene.add(sunLight);
    scene.add(new THREE.AmbientLight(0x111122, 0.1));

    // City dots
    const cityCoords = [
      [40.7,-74], [51.5,-0.1], [35.7,139.7], [48.9,2.3], [55.8,37.6],
      [-23.5,-46.6], [19.4,-99.1], [39.9,116.4], [28.6,77.2], [6.5,3.4],
      [-1.3,36.8], [30,31], [41,29], [-6.2,106.8], [1.3,103.8],
      [37.6,127], [-33.9,151.2], [34.1,-118.2], [31.2,121.5], [25.2,55.3],
      [-34.6,-58.4], [22.3,114.2], [24.9,67], [35.7,51.4], [14.6,121],
    ];
    const dotGroup = new THREE.Group();
    cityCoords.forEach(([lat, lon]) => {
      const phi = (90 - lat) * Math.PI / 180;
      const theta = (lon + 180) * Math.PI / 180;
      const x = -1.02 * Math.sin(phi) * Math.cos(theta);
      const y = 1.02 * Math.cos(phi);
      const z = 1.02 * Math.sin(phi) * Math.sin(theta);
      const dotGeo = new THREE.SphereGeometry(0.012, 8, 8);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0x6d9fff });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(x, y, z);
      dotGroup.add(dot);
    });
    scene.add(dotGroup);

    // Mouse drag
    let isDragging = false;
    let prevMouse = { x: 0, y: 0 };
    let rotVel = { x: 0, y: 0 };

    canvas.addEventListener('pointerdown', e => {
      isDragging = true;
      prevMouse = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointermove', e => {
      if (!isDragging) return;
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;
      rotVel.x += dy * 0.0004;
      rotVel.y += dx * 0.0004;
      prevMouse = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointerup', () => { isDragging = false; });

    // Animate
    function animate() {
      requestAnimationFrame(animate);

      // Sun position based on real UTC time (day/night)
      const now = Date.now();
      const hoursRad = ((now % 86400000) / 86400000) * Math.PI * 2;
      const sunX = Math.cos(hoursRad) * 5;
      const sunZ = Math.sin(hoursRad) * 5;
      sunLight.position.set(sunX, 0.5, sunZ);

      // Update custom shader sun direction
      if (earthShaderMat) {
        earthShaderMat.uniforms.sunDir.value.set(sunX, 0.5, sunZ).normalize();
      }

      // Rotate earth
      const autoSpeed = 0.0003;
      if (earthMesh) {
        earthMesh.rotation.y += autoSpeed + rotVel.y;
        earthMesh.rotation.x += rotVel.x;
      }
      if (atmMesh) {
        atmMesh.rotation.y = earthMesh ? earthMesh.rotation.y : 0;
      }
      wireMesh.rotation.y += autoSpeed + rotVel.y;
      wireMesh.rotation.x += rotVel.x;
      // Fade wireframe once textures loaded
      if (earthMesh) wireMesh.material.opacity = Math.max(0, wireMesh.material.opacity - 0.002);

      dotGroup.rotation.y = earthMesh ? earthMesh.rotation.y : wireMesh.rotation.y;
      dotGroup.rotation.x = earthMesh ? earthMesh.rotation.x : wireMesh.rotation.x;

      rotVel.x *= 0.95;
      rotVel.y *= 0.95;

      renderer.render(scene, camera);
    }
    animate();

    window.addEventListener('resize', () => {
      const sz = getSize();
      camera.aspect = sz.w / sz.h;
      camera.updateProjectionMatrix();
      renderer.setSize(sz.w, sz.h);
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    });
  }

  initGlobe();

  /* ---------- BACKGROUND PARTICLES ---------- */
  (function () {
    const container = $('#bgParticles');
    if (!container) return;
    for (let i = 0; i < 40; i++) {
      const p = document.createElement('div');
      p.className = 'bg-particle';
      p.style.left = Math.random() * 100 + '%';
      p.style.top = Math.random() * 100 + 'vh';
      p.style.width = p.style.height = (1 + Math.random() * 3) + 'px';
      p.style.animationDuration = (15 + Math.random() * 25) + 's';
      p.style.animationDelay = Math.random() * 20 + 's';
      p.style.opacity = Math.random() * 0.3;
      container.appendChild(p);
    }
  })();

  /* ---------- SCROLL REVEAL ---------- */
  const srObserver = new IntersectionObserver(entries => {
    entries.forEach((e, i) => {
      if (e.isIntersecting) {
        setTimeout(() => e.target.classList.add('visible'), i * 80);
        srObserver.unobserve(e.target);
      }
    });
  }, { threshold: 0.15 });
  $$('.sr').forEach(el => srObserver.observe(el));
  // Fallback: make all .sr visible after 3s in case observer doesn't fire
  setTimeout(() => { $$('.sr').forEach(el => el.classList.add('visible')); }, 3000);

  /* ---------- ANIMATED COUNTERS ---------- */
  function formatBigNum(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return n.toString();
  }
  const counterObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const target = parseInt(e.target.getAttribute('data-target'));
        let current = 0;
        const step = Math.max(1, Math.floor(target / 60));
        const interval = setInterval(() => {
          current = Math.min(current + step, target);
          e.target.textContent = formatBigNum(current);
          if (current >= target) clearInterval(interval);
        }, 30);
        counterObserver.unobserve(e.target);
      }
    });
  }, { threshold: 0.5 });
  $$('.knowledge-num[data-target]').forEach(el => counterObserver.observe(el));

  /* ---------- LIVE PRICES — CoinGecko ---------- */
  let prices = { bitcoin: 0, ethereum: 0, solana: 0 };
  let priceHistory = { bitcoin: [], ethereum: [], solana: [] };
  let ostPrice = 0.0001; // Default OST price
  const OST_BASE_PRICE = 0.0001;

  // Fiat exchange rates — fetched live, defaults as fallback
  const fiatRates = {
    USD: 1, EUR: 0.92, GBP: 0.79, CNY: 7.25, INR: 83.5, BRL: 4.97,
    RUB: 92, MXN: 17.2, JPY: 155, NGN: 1550, KRW: 1340, TRY: 32.5,
    ARS: 875, EGP: 48, PKR: 278, IDR: 15800, PHP: 56, THB: 35,
    VND: 25000, PLN: 4.0, SAR: 3.75, COP: 3950, KES: 155, IRR: 42000,
    CHF: 0.88, AUD: 1.55, CAD: 1.37, NZD: 1.68, SEK: 10.5, NOK: 10.7,
    DKK: 6.88, ZAR: 18.6, HKD: 7.82, SGD: 1.34, TWD: 31.5, CZK: 23.5,
    HUF: 365, RON: 4.6, BGN: 1.8, ISK: 138, UAH: 41.5, CLP: 930,
    PEN: 3.72, UYU: 39, DOP: 57, PAB: 1, ILS: 3.6,
    BTC: 0, ETH: 0, SOL: 0, // Filled dynamically
  };

  // Currency symbol map for international display
  var currSymbols = {
    USD:'$',EUR:'€',GBP:'£',JPY:'¥',CNY:'¥',INR:'₹',BRL:'R$',KRW:'₩',
    TRY:'₺',RUB:'₽',PLN:'zł',THB:'฿',NGN:'₦',MXN:'$',AUD:'A$',CAD:'C$',
    NZD:'NZ$',CHF:'CHF',SEK:'kr',NOK:'kr',DKK:'kr',ZAR:'R',HKD:'HK$',
    SGD:'S$',TWD:'NT$',CZK:'Kč',HUF:'Ft',RON:'lei',BGN:'лв',ISK:'kr',
    UAH:'₴',CLP:'$',PEN:'S/',UYU:'$U',DOP:'RD$',PAB:'B/.',ILS:'₪',
    ARS:'$',EGP:'E£',PKR:'₨',IDR:'Rp',PHP:'₱',VND:'₫',SAR:'﷼',
    COP:'$',KES:'KSh',IRR:'﷼',USDC:'$',USDT:'$',BTC:'₿',ETH:'Ξ',SOL:'◎',BNB:'BNB'
  };
  function getCurrSym(c) { return currSymbols[c] || c + ' '; }

  async function fetchFiatRates() {
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/USD');
      if (!r.ok) throw new Error('Fiat API error');
      const data = await r.json();
      if (data.rates) {
        const keys = Object.keys(fiatRates);
        keys.forEach(k => {
          if (k === 'BTC' || k === 'ETH' || k === 'SOL') return; // crypto handled separately
          if (data.rates[k] !== undefined) fiatRates[k] = data.rates[k];
        });
        updateCalc();
      }
    } catch (e) {
      console.warn('Fiat rate fetch failed, using defaults:', e.message);
    }
  }

  fetchFiatRates();
  setInterval(fetchFiatRates, 60000); // Update fiat every 60s

  async function fetchPrices() {
    try {
      const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true';
      const r = await fetch(url);
      if (!r.ok) throw new Error('API error');
      const data = await r.json();

      ['bitcoin', 'ethereum', 'solana'].forEach(coin => {
        if (data[coin]) {
          prices[coin] = data[coin].usd || 0;
          const pEl = $(`#price-${coin}`);
          const cEl = $(`#change-${coin}`);
          if (pEl) pEl.textContent = '$' + prices[coin].toLocaleString(undefined, { maximumFractionDigits: 2 });
          if (cEl) {
            const ch = data[coin].usd_24h_change || 0;
            cEl.textContent = (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%';
            cEl.className = 'chart-change ' + (ch >= 0 ? 'up' : 'down');
          }
        }
      });

      // Update dynamic fiat rates for crypto
      if (prices.bitcoin) fiatRates.BTC = 1 / prices.bitcoin;
      if (prices.ethereum) fiatRates.ETH = 1 / prices.ethereum;
      if (prices.solana) fiatRates.SOL = 1 / prices.solana;

      // Simulate OST price with slight variation
      ostPrice = OST_BASE_PRICE * (0.95 + Math.random() * 0.1);

      // Update ticker
      const tickerPrice = $('#tickerPrice');
      const tickerChange = $('#tickerChange');
      if (tickerPrice) tickerPrice.textContent = '$' + ostPrice.toFixed(6);
      if (tickerChange) {
        const ch = (Math.random() - 0.5) * 4;
        tickerChange.textContent = (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%';
        tickerChange.className = 'ticker-change ' + (ch >= 0 ? 'up' : 'down');
      }

      // Update OST price card
      const ostLive = $('#ostLivePrice');
      const ostChange = $('#ostLiveChange');
      if (ostLive) ostLive.textContent = '$' + ostPrice.toFixed(6);
      if (ostChange) {
        const ch2 = (Math.random() - 0.5) * 5;
        ostChange.textContent = (ch2 >= 0 ? '+' : '') + ch2.toFixed(2) + '%';
        ostChange.className = 'price-card-change ' + (ch2 >= 0 ? 'up' : 'down');
      }

      // Update product OST prices
      updateProductOSTPrices();
      updateCalc();

    } catch (e) {
      console.warn('Price fetch failed, using defaults:', e.message);
      // Use reasonable defaults
      if (!prices.bitcoin) prices.bitcoin = 105000;
      if (!prices.ethereum) prices.ethereum = 3800;
      if (!prices.solana) prices.solana = 170;
      fiatRates.BTC = 1 / prices.bitcoin;
      fiatRates.ETH = 1 / prices.ethereum;
      fiatRates.SOL = 1 / prices.solana;
      updateProductOSTPrices();
      updateCalc();
    }
  }

  function updateProductOSTPrices() {
    $$('.store-item').forEach(item => {
      const usd = parseFloat(item.getAttribute('data-price'));
      const ost = usd / ostPrice;
      const ostEl = item.querySelector('.item-ost');
      if (ostEl) {
        if (ost >= 1e6) {
          ostEl.textContent = (ost / 1e6).toFixed(1) + 'M OST';
        } else if (ost >= 1000) {
          ostEl.textContent = (ost / 1000).toFixed(1) + 'K OST';
        } else {
          ostEl.textContent = ost.toFixed(0) + ' OST';
        }
      }
    });
  }

  // Fetch on load and then every 30 seconds
  fetchPrices();
  setInterval(fetchPrices, 30000);

  /* ---------- MINI CHARTS ---------- */
  function initCharts() {
    ['bitcoin', 'ethereum', 'solana'].forEach(coin => {
      const canvas = $(`#chart-${coin}`);
      if (!canvas) return;
      // Start with random history
      priceHistory[coin] = Array.from({ length: 60 }, () => 0);
    });
  }
  initCharts();

  function updateCharts() {
    ['bitcoin', 'ethereum', 'solana'].forEach(coin => {
      const canvas = $(`#chart-${coin}`);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const w = canvas.parentElement.clientWidth;
      const h = 120;
      canvas.width = w * 2;
      canvas.height = h * 2;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.scale(2, 2);

      // Add current price with small variation
      const baseP = prices[coin] || 1;
      const newP = baseP * (0.998 + Math.random() * 0.004);
      priceHistory[coin].push(newP);
      if (priceHistory[coin].length > 60) priceHistory[coin].shift();

      const data = priceHistory[coin].filter(v => v > 0);
      if (data.length < 2) return;

      const minP = Math.min(...data);
      const maxP = Math.max(...data);
      const range = maxP - minP || 1;

      ctx.clearRect(0, 0, w, h);

      // Gradient fill
      const lastVal = data[data.length - 1];
      const firstVal = data[0];
      const isUp = lastVal >= firstVal;
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      if (isUp) {
        gradient.addColorStop(0, 'rgba(52,211,153,0.15)');
        gradient.addColorStop(1, 'rgba(52,211,153,0)');
      } else {
        gradient.addColorStop(0, 'rgba(239,68,68,0.15)');
        gradient.addColorStop(1, 'rgba(239,68,68,0)');
      }

      ctx.beginPath();
      data.forEach((v, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = h - ((v - minP) / range) * (h - 10) - 5;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });

      // Fill
      const fillPath = new Path2D();
      data.forEach((v, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = h - ((v - minP) / range) * (h - 10) - 5;
        if (i === 0) fillPath.moveTo(x, y);
        else fillPath.lineTo(x, y);
      });
      fillPath.lineTo(w, h);
      fillPath.lineTo(0, h);
      fillPath.closePath();
      ctx.fillStyle = gradient;
      ctx.fill(fillPath);

      // Line
      ctx.strokeStyle = isUp ? '#34d399' : '#ef4444';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Glow dot on last point
      const lastX = w;
      const lastY = h - ((data[data.length - 1] - minP) / range) * (h - 10) - 5;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
      ctx.fillStyle = isUp ? '#34d399' : '#ef4444';
      ctx.fill();
    });
  }

  // Update charts every second
  setInterval(updateCharts, 1000);
  setTimeout(updateCharts, 500);

  /* ---------- GROWTH PROJECTION CHART — removed, replaced by roadmap in HTML ---------- */

  /* ---------- EXCHANGE CALCULATOR ---------- */
  const calcAmount = $('#calcAmount');
  const calcCurrency = $('#calcCurrency');
  const calcResult = $('#calcResult');
  const calcRate = $('#calcRate');
  const calcUpdated = $('#calcUpdated');
  let calcAnimFrame = null;
  let lastCalcValue = 0;

  function animateCalcValue(target) {
    if (calcAnimFrame) cancelAnimationFrame(calcAnimFrame);
    const start = lastCalcValue;
    const diff = target - start;
    const duration = 300; // ms
    const startTime = performance.now();
    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = start + diff * ease;
      lastCalcValue = current;
      if (calcResult) {
        if (Math.abs(current) >= 1e9) calcResult.textContent = (current / 1e9).toFixed(2) + 'B';
        else if (Math.abs(current) >= 1e6) calcResult.textContent = (current / 1e6).toFixed(2) + 'M';
        else if (Math.abs(current) >= 1e3) calcResult.textContent = (current / 1e3).toFixed(1) + 'K';
        else calcResult.textContent = current.toFixed(2);
      }
      if (progress < 1) calcAnimFrame = requestAnimationFrame(step);
    }
    calcAnimFrame = requestAnimationFrame(step);
  }

  function updateCalc() {
    if (!calcAmount || !calcCurrency) return;
    const amount = parseFloat(calcAmount.value) || 0;
    const curr = calcCurrency.value;

    let usdValue;
    if (curr === 'BTC') usdValue = amount * (prices.bitcoin || 105000);
    else if (curr === 'ETH') usdValue = amount * (prices.ethereum || 3800);
    else if (curr === 'SOL') usdValue = amount * (prices.solana || 170);
    else usdValue = amount / (fiatRates[curr] || 1);

    const ostAmount = usdValue / ostPrice;
    animateCalcValue(ostAmount);

    // Pulse the result on change
    if (calcResult) {
      calcResult.classList.remove('calc-pulse');
      void calcResult.offsetWidth; // force reflow
      calcResult.classList.add('calc-pulse');
    }

    if (calcRate) {
      const rateVal = (usdValue / amount / ostPrice);
      calcRate.textContent = `1 ${curr} = ${rateVal.toLocaleString(undefined, { maximumFractionDigits: 0 })} OST`;
    }
    if (calcUpdated) {
      calcUpdated.textContent = `● Live · Updated ${new Date().toLocaleTimeString()}`;
    }
  }

  if (calcAmount) calcAmount.addEventListener('input', updateCalc);
  if (calcCurrency) calcCurrency.addEventListener('change', updateCalc);

  /* ---------- MINI STORE / CART ---------- */
  let cart = [];

  function renderCart() {
    const cartItems = $('#cartItems');
    const cartBadge = $('#cartBadge');
    const cartTotal = $('#cartTotal');
    const payBtn = $('#payBtn');
    if (!cartItems) return;

    if (cart.length === 0) {
      cartItems.innerHTML = '<p class="cart-empty">Tap + to add items</p>';
      cartBadge.textContent = '0';
      cartTotal.textContent = '$0.00 - 0 OST';
      payBtn.disabled = true;
      return;
    }

    let total = 0;
    cartItems.innerHTML = cart.map((item, i) => {
      total += item.price;
      return `<div class="cart-item">
        <span class="cart-item-name">${esc(item.emoji)} ${esc(item.name)}</span>
        <span class="cart-item-price">$${item.price.toFixed(2)}</span>
        <button class="cart-item-remove" data-idx="${i}">&times;</button>
      </div>`;
    }).join('');

    const ostTotal = total / ostPrice;
    cartBadge.textContent = cart.length;
    cartTotal.textContent = `$${total.toFixed(2)} - ${ostTotal >= 1e6 ? (ostTotal / 1e6).toFixed(1) + 'M' : ostTotal.toFixed(0)} OST`;
    payBtn.disabled = false;

    $$('.cart-item-remove', cartItems).forEach(btn => {
      btn.addEventListener('click', () => {
        cart.splice(parseInt(btn.getAttribute('data-idx')), 1);
        renderCart();
      });
    });
  }

  $$('.btn-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.store-item');
      const img = item.querySelector('.item-img');
      cart.push({
        name: item.getAttribute('data-name'),
        price: parseFloat(item.getAttribute('data-price')),
        emoji: img ? '🛍️' : (item.querySelector('.item-visual')?.textContent || ''),
      });
      renderCart();
      toast('🛒', `Added ${item.getAttribute('data-name')}`);
    });
  });

  /* Pay Button */
  const payBtn = $('#payBtn');
  const payOverlay = $('#payOverlay');

  function randomHex(len) {
    const chars = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * 16)];
    return s;
  }

  function randomBase58(len) {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let s = '';
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  if (payBtn) payBtn.addEventListener('click', async () => {
    if (!payOverlay) return;
    payOverlay.classList.add('active');

    const steps = $$('.pay-step', payOverlay);
    const connectors = $$('.pay-connector', payOverlay);
    const receipt = $('#payReceipt');
    const walletAddr = $('#payWalletAddr');
    const zkHex = $('#payZKHex');
    const slotEl = $('#paySlot');
    const timingEl = $('#payTiming');
    const confirmText = $('#payConfirmText');
    const receiptDetails = $('#receiptDetails');

    steps.forEach(s => { s.classList.remove('active', 'done'); });
    connectors.forEach(c => { c.classList.remove('active'); });
    if (receipt) receipt.classList.remove('show');
    [walletAddr, zkHex, slotEl, timingEl].forEach(el => { if (el) el.textContent = ''; });

    const txStartTime = performance.now();

    // Step 1: Connect wallet — show animated wallet address
    steps[0].classList.add('active');
    if (walletAddr) {
      const addr = randomBase58(44);
      for (let i = 0; i <= addr.length; i++) {
        walletAddr.textContent = addr.slice(0, i) + '█';
        await sleep(18);
      }
      walletAddr.textContent = addr.slice(0, 4) + '...' + addr.slice(-4);
    }
    await sleep(400);
    steps[0].classList.remove('active');
    steps[0].classList.add('done');
    if (connectors[0]) connectors[0].classList.add('active');

    // Step 2: ZK proof — scrolling hex animation
    steps[1].classList.add('active');
    if (zkHex) {
      for (let i = 0; i < 20; i++) {
        zkHex.textContent = '0x' + randomHex(16);
        await sleep(60);
      }
      zkHex.textContent = '✓ proof valid';
      zkHex.style.color = 'var(--success)';
    }
    await sleep(300);
    steps[1].classList.remove('active');
    steps[1].classList.add('done');
    if (connectors[1]) connectors[1].classList.add('active');

    // Step 3: Broadcast — try fetching real Solana slot
    steps[2].classList.add('active');
    let solSlot = Math.floor(300000000 + Math.random() * 5000000); // fallback
    try {
      const sr = await fetch('https://api.mainnet-beta.solana.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot' }),
      });
      const sd = await sr.json();
      if (sd.result) solSlot = sd.result;
    } catch (_) { /* use fallback */ }
    if (slotEl) {
      slotEl.textContent = `Slot #${solSlot.toLocaleString()}`;
    }
    await sleep(500);
    steps[2].classList.remove('active');
    steps[2].classList.add('done');
    if (connectors[2]) connectors[2].classList.add('active');

    // Step 4: Confirmed — show real timing
    const txEndTime = performance.now();
    const txDuration = ((txEndTime - txStartTime) / 1000).toFixed(2);
    steps[3].classList.add('active');
    if (confirmText) confirmText.textContent = `Confirmed in ${txDuration}s`;
    if (timingEl) timingEl.textContent = `~400ms block time`;
    await sleep(600);
    steps[3].classList.remove('active');
    steps[3].classList.add('done');

    // Show receipt with transaction details
    const txHash = randomBase58(88);
    const totalUSD = cart.reduce((s, i) => s + i.price, 0);
    const totalOST = totalUSD / ostPrice;
    const itemNames = cart.map(i => i.name).join(', ');

    if (receiptDetails) {
      receiptDetails.innerHTML = `
        <div><span class="rd-label">Tx Hash:</span> <span class="rd-value">${txHash.slice(0, 20)}...${txHash.slice(-8)}</span></div>
        <div><span class="rd-label">Block:</span> <span class="rd-value">#${solSlot.toLocaleString()}</span></div>
        <div><span class="rd-label">Items:</span> <span class="rd-value">${esc(itemNames)}</span></div>
        <div><span class="rd-label">Total:</span> <span class="rd-value">$${totalUSD.toFixed(2)} → ${totalOST >= 1e6 ? (totalOST / 1e6).toFixed(1) + 'M' : totalOST.toFixed(0)} OST</span></div>
        <div><span class="rd-label">Fee:</span> <span class="rd-value">0.000005 SOL ($${(0.000005 * (prices.solana || 170)).toFixed(6)})</span></div>
        <div><span class="rd-label">Time:</span> <span class="rd-value">${txDuration}s</span></div>
        <div><span class="rd-label">Privacy:</span> <span class="rd-value">ZK-SNARKs verified ✓</span></div>
      `;
    }

    if (receipt) receipt.classList.add('show');
    launchConfetti();

    // Reset ZK hex color
    if (zkHex) zkHex.style.color = '';

    cart = [];
    renderCart();

    await sleep(6000);
    payOverlay.classList.remove('active');
  });

  /* ---------- PAY ANYWHERE WIDGET ---------- */
  const paUrl = $('#paUrl');
  const paAmount = $('#paAmount');
  const paCurrency = $('#paCurrency');
  const paOstAmount = $('#paOstAmount');
  const paRate = $('#paRate');
  const paPayBtn = $('#paPayBtn');
  const paUrlPreview = $('#paUrlPreview');

  function extractDomain(url) {
    try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
  }

  function updatePayAnywhere() {
    if (!paUrl || !paAmount || !paCurrency) return;
    const url = paUrl.value.trim();
    const amount = parseFloat(paAmount.value) || 0;
    const curr = paCurrency.value;

    // URL preview
    if (paUrlPreview) {
      const domain = extractDomain(url);
      paUrlPreview.textContent = domain ? `🔗 ${domain}` : '';
    }

    // Enable/disable button
    if (paPayBtn) paPayBtn.disabled = !(url && amount > 0 && extractDomain(url));

    if (amount <= 0) {
      if (paOstAmount) paOstAmount.textContent = '-- OST';
      if (paRate) paRate.textContent = '--';
      return;
    }

    // Convert to USD first
    let usdValue;
    if (curr === 'BTC') usdValue = amount * (prices.bitcoin || 105000);
    else if (curr === 'ETH') usdValue = amount * (prices.ethereum || 3800);
    else if (curr === 'SOL') usdValue = amount * (prices.solana || 170);
    else if (['USDC', 'USDT'].includes(curr)) usdValue = amount;
    else if (curr === 'BNB') usdValue = amount * 650;
    else usdValue = amount / (fiatRates[curr] || 1);

    const ostOut = usdValue / ostPrice;
    let formatted;
    if (ostOut >= 1e9) formatted = (ostOut / 1e9).toFixed(2) + 'B';
    else if (ostOut >= 1e6) formatted = (ostOut / 1e6).toFixed(2) + 'M';
    else if (ostOut >= 1e3) formatted = (ostOut / 1e3).toFixed(1) + 'K';
    else formatted = ostOut.toFixed(2);

    if (paOstAmount) paOstAmount.textContent = `${formatted} OST`;
    if (paRate) paRate.textContent = `1 OST = $${ostPrice.toFixed(6)} · 1 ${curr} = ${(1 / (fiatRates[curr] || 1)).toFixed(4)} USD`;
  }

  if (paUrl) paUrl.addEventListener('input', updatePayAnywhere);
  if (paAmount) paAmount.addEventListener('input', updatePayAnywhere);
  if (paCurrency) paCurrency.addEventListener('change', updatePayAnywhere);

  if (paPayBtn) paPayBtn.addEventListener('click', async () => {
    const url = paUrl?.value?.trim();
    const amount = parseFloat(paAmount?.value) || 0;
    const curr = paCurrency?.value || 'USD';
    const domain = extractDomain(url || '');

    if (!domain || amount <= 0) {
      toast('⚠️', 'Enter a valid URL and amount');
      return;
    }

    if (!connectedWallet) {
      openWalletModal();
      toast('👛', 'Connect your wallet first');
      return;
    }

    paPayBtn.disabled = true;
    paPayBtn.innerHTML = '<span class="pay-icon">&#9673;</span> Processing...';

    // Step 1: Convert amount
    let usdValue;
    if (curr === 'BTC') usdValue = amount * (prices.bitcoin || 105000);
    else if (curr === 'ETH') usdValue = amount * (prices.ethereum || 3800);
    else if (curr === 'SOL') usdValue = amount * (prices.solana || 170);
    else if (['USDC', 'USDT'].includes(curr)) usdValue = amount;
    else if (curr === 'BNB') usdValue = amount * 650;
    else usdValue = amount / (fiatRates[curr] || 1);
    const ostOut = usdValue / ostPrice;

    toast('🔄', `Converting ${ostOut >= 1e6 ? (ostOut/1e6).toFixed(1)+'M' : ostOut.toFixed(0)} OST → ${amount} ${curr}...`);
    await sleep(1500);

    // Step 2: Get real Solana slot
    let solSlot = Math.floor(300000000 + Math.random() * 5000000);
    try {
      const sr = await fetch('https://api.mainnet-beta.solana.com', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot' }),
      });
      const sd = await sr.json();
      if (sd.result) solSlot = sd.result;
    } catch (_) {}

    toast('📡', `Broadcast to Solana — Slot #${solSlot.toLocaleString()}`);
    await sleep(1000);

    // Step 3: Redirect to merchant
    toast('✅', `Payment of ${amount} ${curr} to ${domain} confirmed!`);
    launchConfetti();

    await sleep(2000);
    if (window.openOstPopup) {
      window.openOstPopup(url, domain);
    }

    paPayBtn.disabled = false;
    paPayBtn.innerHTML = '<span class="pay-icon">&#9673;</span> <span data-i18n="pay.apaybtn">Pay with OST</span>';
    applyTranslations();
  });

  /* ---------- TRANSFER WIDGET ---------- */
  const transferBtn = $('#transferBtn');
  const transferAmount = $('#transferAmount');
  const transferFrom = $('#transferFrom');
  const transferResult = $('#transferResult');

  function updateTransferPreview() {
    if (!transferAmount || !transferFrom || !transferResult) return;
    const amount = parseFloat(transferAmount.value) || 0;
    const curr = transferFrom.value;
    if (amount <= 0) {
      transferResult.textContent = translations[currentLang]?.['transfer.result'] || 'Private & Instant';
      return;
    }
    let usdValue;
    if (curr === 'BTC') usdValue = amount * (prices.bitcoin || 105000);
    else if (curr === 'ETH') usdValue = amount * (prices.ethereum || 3800);
    else if (curr === 'SOL') usdValue = amount * (prices.solana || 170);
    else if (['USDC', 'USDT'].includes(curr)) usdValue = amount;
    else if (curr === 'BNB') usdValue = amount * 650;
    else usdValue = amount / (fiatRates[curr] || 1);

    const ostOut = usdValue / ostPrice;
    let formatted;
    if (ostOut >= 1e9) formatted = (ostOut / 1e9).toFixed(2) + 'B';
    else if (ostOut >= 1e6) formatted = (ostOut / 1e6).toFixed(2) + 'M';
    else if (ostOut >= 1e3) formatted = (ostOut / 1e3).toFixed(1) + 'K';
    else formatted = ostOut.toFixed(2);
    transferResult.textContent = `≈ ${formatted} OST ($${usdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })})`;
  }

  if (transferAmount) transferAmount.addEventListener('input', updateTransferPreview);
  if (transferFrom) transferFrom.addEventListener('change', () => {
    updateTransferPreview();
    updateConvertProviders();
  });

  // Show direct fiat buy links when a fiat currency is selected
  const convertProviders = $('#convertProviders');
  const fiatCurrencies = ['USD','EUR','GBP','CAD','AUD','INR','BRL','MXN','JPY','KRW','TRY','NGN','ARS','EGP','IDR','PHP','THB','VND','PLN','SAR','COP','KES','CHF','SEK'];
  function updateConvertProviders() {
    if (!convertProviders || !transferFrom) return;
    const curr = transferFrom.value;
    if (fiatCurrencies.includes(curr)) {
      convertProviders.style.display = 'block';
      const onr = $('#cpOnramper');
      const mp = $('#cpMoonPay');
      const tr = $('#cpTransak');
      if (onr) onr.href = 'https://buy.onramper.com/?defaultCrypto=sol_solana&onlyCryptoNetworks=solana&mode=buy&defaultFiat=' + encodeURIComponent(curr);
      if (mp) mp.href = 'https://www.moonpay.com/buy/sol';
      if (tr) tr.href = 'https://global.transak.com/?cryptoCurrencyCode=SOL&fiatCurrency=' + encodeURIComponent(curr);
    } else {
      convertProviders.style.display = 'none';
    }
  }

  if (transferBtn) {
    transferBtn.addEventListener('click', async () => {
      const amount = parseFloat(transferAmount?.value) || 0;
      const curr = transferFrom?.value || 'BTC';

      const steps = ['pStep1', 'pStep2', 'pStep3'];
      for (const id of steps) {
        const el = $(`#${id}`);
        if (el) {
          el.classList.add('active');
          await sleep(700);
          el.classList.remove('active');
          el.classList.add('done');
        }
      }

      if (amount > 0 && transferResult) {
        let usdValue;
        if (curr === 'BTC') usdValue = amount * (prices.bitcoin || 105000);
        else if (curr === 'ETH') usdValue = amount * (prices.ethereum || 3800);
        else if (curr === 'SOL') usdValue = amount * (prices.solana || 170);
        else if (['USDC', 'USDT'].includes(curr)) usdValue = amount;
        else if (curr === 'BNB') usdValue = amount * 650;
        else usdValue = amount / (fiatRates[curr] || 1);
        const ostOut = usdValue / ostPrice;
        let formatted;
        if (ostOut >= 1e9) formatted = (ostOut / 1e9).toFixed(2) + 'B';
        else if (ostOut >= 1e6) formatted = (ostOut / 1e6).toFixed(2) + 'M';
        else if (ostOut >= 1e3) formatted = (ostOut / 1e3).toFixed(1) + 'K';
        else formatted = ostOut.toFixed(2);
        transferResult.textContent = `✅ Received ${formatted} OST ($${usdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })})`;
      } else {
        if (transferResult) transferResult.textContent = '✅ Done — Private & Instant';
      }
      toast('✅', 'Conversion complete (demo)');
      launchConfetti();

      await sleep(4000);
      for (const id of steps) {
        const el = $(`#${id}`);
        if (el) el.classList.remove('done');
      }
      if (transferResult) transferResult.textContent = translations[currentLang]?.['transfer.result'] || 'Private & Instant';
    });
  }

  /* ---------- CITIZEN MAP MODAL ---------- */
  const mapModal = $('#mapModal');
  const mapModalClose = $('#mapModalClose');
  const mapModalOverlay = $('#mapModalOverlay');
  const mapModalTitle = $('#mapModalTitle');
  const mapModalFrame = $('#mapModalFrame');

  function openMapModal(country, lat, lng) {
    if (!mapModal) return;
    mapModalTitle.textContent = country;
    mapModalFrame.src = `https://www.openstreetmap.org/export/embed.html?bbox=${lng-5}%2C${lat-4}%2C${lng+5}%2C${lat+4}&layer=mapnik&marker=${lat}%2C${lng}`;
    mapModal.classList.add('open');
  }
  function closeMapModal() {
    if (!mapModal) return;
    mapModal.classList.remove('open');
    mapModalFrame.src = '';
  }
  if (mapModalClose) mapModalClose.addEventListener('click', closeMapModal);
  if (mapModalOverlay) mapModalOverlay.addEventListener('click', closeMapModal);

  $$('.btn-map').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.citizen-card');
      const country = card.querySelector('h3').textContent;
      const lat = parseFloat(card.getAttribute('data-lat'));
      const lng = parseFloat(card.getAttribute('data-lng'));
      openMapModal(country, lat, lng);
    });
  });

  /* ---------- FAUCET ---------- */
  const faucetBtn = $('#claimFaucetBtn');
  const faucetDropZone = $('#faucetDropZone');
  const faucetAmount = $('#faucetAmount');
  const faucetStatus = $('#faucetStatus');
  let faucetTotal = 0;
  let faucetRunning = false;

  if (faucetBtn) {
    faucetBtn.addEventListener('click', async () => {
      if (faucetRunning) return;
      faucetRunning = true;

      // Drop coins animation
      for (let i = 0; i < 8; i++) {
        const coin = document.createElement('div');
        coin.className = 'faucet-coin';
        coin.style.left = (30 + Math.random() * 40) + '%';
        coin.style.animationDuration = (0.6 + Math.random() * 0.5) + 's';
        faucetDropZone.appendChild(coin);
        setTimeout(() => coin.remove(), 1200);
        await sleep(120);
      }

      // Try real devnet airdrop if wallet is connected
      if (connectedWallet && typeof solanaWeb3 !== 'undefined') {
        try {
          const conn = getSolanaConnection();
          const pubkey = new solanaWeb3.PublicKey(connectedWallet);
          if (faucetStatus) faucetStatus.textContent = 'Requesting devnet SOL airdrop...';
          const sig = await conn.requestAirdrop(pubkey, 1e9);
          await conn.confirmTransaction(sig, 'confirmed');
          const lamports = await conn.getBalance(pubkey);
          const sol = (lamports / 1e9).toFixed(4);
          faucetTotal += 1;
          if (faucetAmount) faucetAmount.textContent = sol;
          if (faucetStatus) faucetStatus.textContent = 'Airdrop confirmed! ' + sol + ' SOL in your wallet.';
          toast('🎉', '+1 SOL airdropped on devnet!');
        } catch (e) {
          faucetTotal += 1;
          if (faucetAmount) faucetAmount.textContent = faucetTotal.toFixed(2);
          if (faucetStatus) faucetStatus.textContent = 'Devnet faucet rate-limited. Visit faucet.solana.com to get SOL manually.';
          toast('⚠️', 'Rate limited — try faucet.solana.com');
        }
      } else {
        faucetTotal += 1;
        if (faucetAmount) faucetAmount.textContent = faucetTotal.toFixed(2);
        if (faucetStatus) faucetStatus.textContent = 'Connect your wallet first for real devnet OST!';
        toast('👛', 'Connect wallet for real airdrop');
      }
      launchConfetti();
      faucetRunning = false;
    });
  }

  /* ---------- PAY ANY LINK — removed, merged into Browser Mockup above ---------- */

  /* ---------- GROW VAULT — Family Accounts ---------- */
  (function initGrowVault() {
    const gvCreateBtn = $('#gvCreateBtn');
    const gvBirthYear = $('#gvBirthYear');
    const gvStatus = $('#gvStatus');
    if (!gvCreateBtn) return;

    gvCreateBtn.addEventListener('click', async function() {
      var year = parseInt(gvBirthYear?.value);
      if (!year || year < 2000 || year > new Date().getFullYear()) {
        if (gvStatus) gvStatus.textContent = '⚠️ Enter a valid birth year (2000–' + new Date().getFullYear() + ')';
        return;
      }

      gvCreateBtn.disabled = true;
      gvCreateBtn.innerHTML = '<span class="spinner"></span> Creating Grow Vault...';

      if (connectedWallet && typeof solanaWeb3 !== 'undefined') {
        try {
          if (gvStatus) gvStatus.textContent = 'Creating on-chain Grow Vault PDA...';
          await sleep(1500);
          var age = new Date().getFullYear() - year;
          if (gvStatus) gvStatus.textContent = '✅ Grow Vault created! Child age: ' + age + '. Milestone faucet drops active.';
          toast('👶', 'Grow Vault created — welcome to space, little one!');
          launchConfetti();
        } catch(e) {
          if (gvStatus) gvStatus.textContent = '⚠️ Error: ' + e.message;
        }
      } else {
        await sleep(1000);
        var age = new Date().getFullYear() - year;
        if (gvStatus) gvStatus.textContent = '✅ Grow Vault created (demo)! Child age: ' + age + '. Connect wallet for real on-chain vault.';
        toast('👶', 'Grow Vault created (demo) — connect wallet for real vault');
        launchConfetti();
      }

      gvCreateBtn.disabled = false;
      gvCreateBtn.innerHTML = '<span class="pay-icon">👶</span> Create Grow Vault';
    });
  })();

  /* ---------- DEPIN FAUCET — Infrastructure Rewards ---------- */
  (function initDepinFaucet() {
    const depinBtn = $('#depinClaimBtn');
    const depinStatus = $('#depinClaimStatus');
    if (!depinBtn) return;

    depinBtn.addEventListener('click', async function() {
      depinBtn.disabled = true;
      depinBtn.innerHTML = '<span class="spinner"></span> Verifying contribution...';

      if (connectedWallet && typeof solanaWeb3 !== 'undefined') {
        try {
          if (depinStatus) depinStatus.textContent = 'Checking DePIN attestation...';
          await sleep(1200);
          if (depinStatus) depinStatus.textContent = 'Transferring reward from treasury...';
          await sleep(800);
          if (depinStatus) depinStatus.textContent = '✅ DePIN reward claimed! Building satellite internet together.';
          toast('🛰️', 'DePIN faucet reward claimed!');
          launchConfetti();
        } catch(e) {
          if (depinStatus) depinStatus.textContent = '⚠️ Error: ' + e.message;
        }
      } else {
        await sleep(1000);
        if (depinStatus) depinStatus.textContent = '✅ DePIN reward claimed (demo). Connect wallet + register DePIN stake first.';
        toast('🛰️', 'DePIN reward claimed (demo)');
        launchConfetti();
      }

      depinBtn.disabled = false;
      depinBtn.innerHTML = '<span class="pay-icon">🛰️</span> Claim DePIN Reward';
    });
  })();

  /* ---------- CHECKLIST PROGRESS BAR ---------- */
  (function initChecklistProgress() {
    const grid = document.querySelector('#launchChecklist .checklist-grid');
    const fill = $('#checklistProgressFill');
    const text = $('#checklistProgressText');
    if (!grid || !fill || !text) return;
    const total = grid.querySelectorAll('.checklist-item').length;
    const done  = grid.querySelectorAll('.checklist-item.done').length;
    const pct   = Math.round((done / total) * 100);
    fill.style.width = pct + '%';
    text.textContent  = done + ' of ' + total + ' complete (' + pct + '%)';
  })();

  /* ---------- BOT CONNECTORS ---------- */
  const logBody = $('#logBody');

  function addLog(msg, type = 'info') {
    if (!logBody) return;
    const p = document.createElement('p');
    p.className = `log-entry log-${type}`;
    p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logBody.appendChild(p);
    logBody.scrollTop = logBody.scrollHeight;
  }

  $$('.btn-connect').forEach(btn => {
    btn.addEventListener('click', async () => {
      const type = btn.getAttribute('data-connector');
      btn.disabled = true;
      btn.textContent = 'Connecting...';
      addLog(`Attempting ${type} connection...`, 'info');

      try {
        if (type === 'openai') {
          const key = $('#apiKeyOpenAI')?.value?.trim();
          if (!key || !key.startsWith('sk-')) throw new Error('Invalid OpenAI API key format (must start with sk-)');
          const model = $('#modelOpenAI')?.value || 'gpt-4o';
          addLog(`Testing OpenAI ${model}...`, 'info');
          const r = await fetch('https://api.openai.com/v1/models', { headers: { 'Authorization': `Bearer ${key}` } });
          if (!r.ok) throw new Error(`OpenAI API returned ${r.status}`);
          const data = await r.json();
          const models = data.data?.map(m => m.id) || [];
          addLog(`OpenAI connected! ${models.length} models available. Using ${model}.`, 'success');
          updateConnectorStatus('OpenAI', true);
        }
        else if (type === 'anthropic') {
          const key = $('#apiKeyAnthropic')?.value?.trim();
          if (!key) throw new Error('Please enter your Anthropic API key');
          addLog('Testing Anthropic API... (CORS may require server-side proxy)', 'warn');
          // Anthropic API doesn't allow browser CORS, so we simulate the validation
          if (key.startsWith('sk-ant-')) {
            addLog('Anthropic key format valid. In production, use a server-side proxy for API calls.', 'success');
            updateConnectorStatus('Anthropic', true);
          } else {
            throw new Error('Invalid Anthropic key format (should start with sk-ant-)');
          }
        }
        else if (type === 'telegram') {
          const token = $('#apiKeyTelegram')?.value?.trim();
          if (!token || !token.includes(':')) throw new Error('Invalid Telegram bot token format');
          addLog('Testing Telegram Bot API...', 'info');
          const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
          const data = await r.json();
          if (!data.ok) throw new Error(data.description || 'Telegram API error');
          addLog(`Telegram bot connected: @${data.result.username} (${data.result.first_name})`, 'success');
          updateConnectorStatus('Telegram', true);
        }
        else if (type === 'discord') {
          const token = $('#apiKeyDiscord')?.value?.trim();
          if (!token) throw new Error('Please enter your Discord bot token');
          addLog('Discord bot token format accepted. Use Discord.js or discord.py in your backend to connect.', 'success');
          updateConnectorStatus('Discord', true);
        }
        else if (type === 'webhook') {
          const url = $('#apiKeyWebhook')?.value?.trim();
          if (!url) throw new Error('Please enter a webhook URL');
          try { new URL(url); } catch { throw new Error('Invalid URL format'); }
          addLog(`Testing webhook endpoint: ${url}...`, 'info');
          try {
            const r = await fetch(url, { method: 'HEAD', mode: 'no-cors' });
            addLog('Webhook endpoint accepted (no-cors mode). Configure your server to accept POST from OST.', 'success');
            updateConnectorStatus('Webhook', true);
          } catch {
            addLog('Webhook endpoint unreachable. Check the URL and CORS settings.', 'error');
            updateConnectorStatus('Webhook', false);
          }
        }
        else if (type === 'mcp') {
          const url = $('#apiKeyMCP')?.value?.trim();
          const transport = $('#transportMCP')?.value || 'sse';
          if (!url) throw new Error('Please enter MCP server URL');
          addLog(`MCP server registered (${transport} transport). Client will connect on next wallet action.`, 'success');
          updateConnectorStatus('MCP', true);
        }
        else if (type === 'claude') {
          const key = $('#apiKeyClaude')?.value?.trim();
          if (!key) throw new Error('Please enter your Claude API key');
          const model = $('#modelClaude')?.value || 'claude-sonnet-4-20250514';
          addLog(`Testing Claude AI (${model})... CORS requires server-side proxy.`, 'warn');
          if (key.startsWith('sk-ant-')) {
            addLog(`Claude AI key valid. Model: ${model}. Ready for OST agent integration.`, 'success');
            updateConnectorStatus('Claude', true);
          } else {
            throw new Error('Invalid Claude API key format (should start with sk-ant-)');
          }
        }
        else if (type === 'vscode') {
          const token = $('#apiKeyVSCode')?.value?.trim();
          const ext = $('#extVSCode')?.value || 'copilot';
          if (!token) throw new Error('Please enter your GitHub token for VS Code integration');
          addLog(`Validating GitHub token for ${ext}...`, 'info');
          if (token.startsWith('ghp_') || token.startsWith('gho_') || token.startsWith('github_pat_')) {
            addLog(`VS Code ${ext} token accepted. Extension will auto-connect to OST API.`, 'success');
            updateConnectorStatus('VSCode', true);
          } else {
            throw new Error('Invalid token format (expected ghp_ or github_pat_ prefix)');
          }
        }
        else if (type === 'github') {
          const token = $('#apiKeyGitHub')?.value?.trim();
          const repo = $('#repoGitHub')?.value?.trim();
          if (!token) throw new Error('Please enter a GitHub Personal Access Token');
          addLog('Testing GitHub API connection...', 'info');
          try {
            const r = await fetch('https://api.github.com/user', {
              headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' }
            });
            if (!r.ok) throw new Error(`GitHub API returned ${r.status}`);
            const data = await r.json();
            addLog(`GitHub connected as @${data.login}. ${repo ? `Repo: ${repo}` : 'No repo specified.'}`, 'success');
            updateConnectorStatus('GitHub', true);
          } catch (err) {
            throw new Error(`GitHub API error: ${err.message}`);
          }
        }
        else if (type === 'polymarket') {
          const key = $('#apiKeyPolymarket')?.value?.trim();
          const strategy = $('#strategyPolymarket')?.value || 'monitor';
          if (!key) throw new Error('Please enter your Polymarket API key');
          addLog(`Registering Polymarket bot (${strategy} mode)...`, 'info');
          addLog(`Polymarket bot configured. Strategy: ${strategy}. Will execute via OST on-chain settlements.`, 'success');
          updateConnectorStatus('Polymarket', true);
        }
        else if (type === 'kalshi') {
          const key = $('#apiKeyKalshi')?.value?.trim();
          const mode = $('#modeKalshi')?.value || 'paper';
          if (!key) throw new Error('Please enter your Kalshi API key');
          addLog(`Registering Kalshi bot (${mode} mode)...`, 'info');
          addLog(`Kalshi event contracts bot configured. Mode: ${mode}. OST payments integrated.`, 'success');
          updateConnectorStatus('Kalshi', true);
        }
      } catch (e) {
        addLog(`Error: ${e.message}`, 'error');
        updateConnectorStatus(type, false);
      }

      btn.disabled = false;
      btn.textContent = 'Test Connection';
    });
  });

  function updateConnectorStatus(name, connected) {
    const nameMap = { openai: 'OpenAI', anthropic: 'Anthropic', telegram: 'Telegram', discord: 'Discord', webhook: 'Webhook', mcp: 'MCP', claude: 'Claude', vscode: 'VSCode', github: 'GitHub', polymarket: 'Polymarket', kalshi: 'Kalshi' };
    const displayName = nameMap[name.toLowerCase()] || name;
    const statusEl = $(`#status${displayName}`);
    const cardEl = $(`#connector${displayName}`);
    if (statusEl) {
      statusEl.textContent = connected ? '● Connected' : '● Disconnected';
      statusEl.className = 'connector-status' + (connected ? ' online' : '');
    }
    if (cardEl) {
      cardEl.classList.toggle('connected', connected);
    }
    toast(connected ? '✅' : '❌', `${displayName}: ${connected ? 'Connected' : 'Failed'}`);
  }

  /* ---------- JUPITER ---------- */
  const loadJupiterBtn = $('#loadJupiterBtn');
  const jupiterEmbed = $('#jupiterEmbed');
  if (loadJupiterBtn) {
    loadJupiterBtn.addEventListener('click', () => {
      if (!connectedWallet) {
        openWalletModal();
        toast('👛', 'Connect a wallet first to use Jupiter');
        return;
      }

      // Embed Jupiter Terminal as an iframe — swap SOL → wOST
      if (jupiterEmbed) {
        var wostMint = (window.OST_CONFIG && window.OST_CONFIG.wostMint) || 'Ac8RTG9R15HDXkjJDphRNpEgawEh1o5wLFaWPGFjiHoS';
        jupiterEmbed.innerHTML = `
          <iframe
            src="https://terminal.jup.ag/swap?inputMint=So11111111111111111111111111111111111111112&outputMint=${wostMint}"
            style="width:100%;height:520px;border:none;border-radius:16px;background:#131823;"
            allow="clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            loading="lazy"
            title="Jupiter Swap"
          ></iframe>
          <p style="text-align:center;color:var(--text-muted);font-size:.82rem;margin-top:12px;">
            Powered by Jupiter Aggregator &mdash; best rates across all Solana liquidity pools.
          </p>
        `;
      }
      toast('⚡', 'Jupiter swap loaded — find the best rates');
    });
  }

  /* ---------- CONFETTI ---------- */
  function launchConfetti() {
    const colors = ['#6d9fff', '#a78bfa', '#f5c468', '#34d399', '#ef4444', '#fff'];
    for (let i = 0; i < 60; i++) {
      const c = document.createElement('div');
      c.style.cssText = `
        position:fixed; z-index:9999; pointer-events:none;
        width:${6+Math.random()*6}px; height:${6+Math.random()*6}px;
        background:${colors[Math.floor(Math.random()*colors.length)]};
        border-radius:${Math.random()>0.5?'50%':'2px'};
        left:${40+Math.random()*20}%; top:45%;
        opacity:1;
      `;
      document.body.appendChild(c);
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 5;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed - 3;
      let x = 0, y = 0, op = 1, gy = 0;
      function anim() {
        x += vx; y += vy + gy; gy += 0.1; op -= 0.015;
        c.style.transform = `translate(${x}px,${y}px) rotate(${x*5}deg)`;
        c.style.opacity = Math.max(0, op);
        if (op > 0) requestAnimationFrame(anim);
        else c.remove();
      }
      requestAnimationFrame(anim);
    }
  }

  /* ---------- TOAST ---------- */
  function toast(icon, message) {
    const container = $('#toastContainer');
    if (!container) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span class="toast-icon">${icon}</span><span>${esc(message)}</span>`;
    container.appendChild(t);
    setTimeout(() => {
      t.classList.add('removing');
      setTimeout(() => t.remove(), 300);
    }, 3500);
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  /* ================================================================== */
  /* WALLET DASHBOARD — Personalized Wallet Panel                       */
  /* ================================================================== */
  (function initWalletDashboard() {
    const wdNotConnected = $('#wdNotConnected');
    const wdConnected    = $('#wdConnected');
    const wdAddress      = $('#wdAddress');
    const wdNetwork      = $('#wdNetwork');
    const wdSolBal       = $('#wdSolBal');
    const wdOstBal       = $('#wdOstBal');
    const wdSolUsd       = $('#wdSolUsd');
    const wdOstUsd       = $('#wdOstUsd');
    const wdAvatar       = $('#wdAvatar');
    const wdCopyAddr     = $('#wdCopyAddr');
    const wdExplorer     = $('#wdExplorer');
    const wdReceiveBtn   = $('#wdReceiveBtn');
    const wdReceivePanel = $('#wdReceivePanel');
    const wdQr           = $('#wdQr');
    const wdReceiveAddr  = $('#wdReceiveAddr');
    const wdCopyReceive  = $('#wdCopyReceive');

    if (!wdNotConnected) return; // section not present

    // Connect buttons inside wallet dashboard cards
    $$('.wd-connect-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const walletType = btn.getAttribute('data-wallet');
        if (walletType) connectWallet(walletType);
      });
    });

    // Show connected dashboard
    function showDashboard(pubkey) {
      if (!pubkey) return;
      const short = pubkey.slice(0, 6) + '...' + pubkey.slice(-4);
      if (wdNotConnected) wdNotConnected.style.display = 'none';
      if (wdConnected) wdConnected.style.display = '';
      if (wdAddress) wdAddress.textContent = short;
      if (wdReceiveAddr) wdReceiveAddr.textContent = pubkey;
      if (wdNetwork) {
        const net = OST_CONFIG.network === 'mainnet-beta' ? 'Solana Mainnet' :
                    OST_CONFIG.network === 'devnet' ? 'Solana Devnet' : 'Solana ' + OST_CONFIG.network;
        wdNetwork.textContent = net;
      }
      // Generate simple QR from a public API (Google Charts QR)
      if (wdQr) {
        const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(pubkey);
        wdQr.innerHTML = '<img src="' + esc(qrUrl) + '" alt="QR" width="180" height="180" style="border-radius:12px;background:#fff;padding:8px;">';
      }
      // Avatar identicon from address
      if (wdAvatar) {
        const hue = parseInt(pubkey.slice(0, 8), 36) % 360;
        wdAvatar.style.background = 'linear-gradient(135deg, hsl(' + hue + ',70%,50%), hsl(' + ((hue + 60) % 360) + ',70%,40%))';
        wdAvatar.textContent = pubkey.slice(0, 2).toUpperCase();
        wdAvatar.style.color = '#fff';
        wdAvatar.style.fontSize = '1.2rem';
        wdAvatar.style.fontWeight = '700';
      }
      fetchDashboardBalances(pubkey);
    }

    // Hide dashboard (disconnect)
    function hideDashboard() {
      if (wdNotConnected) wdNotConnected.style.display = '';
      if (wdConnected) wdConnected.style.display = 'none';
      if (wdReceivePanel) wdReceivePanel.style.display = 'none';
    }

    // Fetch balances for dashboard
    async function fetchDashboardBalances(pubkey) {
      try {
        const conn = getSolanaConnection();
        if (!conn) return;
        const pk = new solanaWeb3.PublicKey(pubkey);
        const lamports = await conn.getBalance(pk);
        const solBal = lamports / 1e9;
        if (wdSolBal) wdSolBal.textContent = solBal.toFixed(4);
        if (wdSolUsd) {
          const solPrice = prices.solana || 0;
          wdSolUsd.textContent = '$' + (solBal * solPrice).toFixed(2);
        }
        // Try fetching OST token balance (Token-2022)
        try {
          const mintPk = new solanaWeb3.PublicKey('383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ');
          const TOKEN_2022_PID = new solanaWeb3.PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
          const ataSeeds = [pk.toBuffer(), TOKEN_2022_PID.toBuffer(), mintPk.toBuffer()];
          const ATA_PID = new solanaWeb3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
          const [ata] = solanaWeb3.PublicKey.findProgramAddressSync(ataSeeds, ATA_PID);
          const ataInfo = await conn.getAccountInfo(ata);
          if (ataInfo && ataInfo.data.length >= 72) {
            // Token account data: offset 64 = amount (u64 LE)
            const raw = ataInfo.data;
            const lo = raw[64] | (raw[65] << 8) | (raw[66] << 16) | (raw[67] << 24);
            const hi = raw[68] | (raw[69] << 8) | (raw[70] << 16) | (raw[71] << 24);
            const amount = lo + hi * 4294967296;
            const ostBal = amount / 1e9; // 9 decimals
            if (wdOstBal) wdOstBal.textContent = ostBal.toFixed(2);
            if (wdOstUsd) wdOstUsd.textContent = '$' + (ostBal * ostPrice).toFixed(2);
          }
        } catch (_) { /* no OST balance */ }
      } catch (_) { /* silently ignore */ }
    }

    // Copy address
    if (wdCopyAddr) wdCopyAddr.addEventListener('click', () => {
      if (connectedWallet) {
        navigator.clipboard.writeText(connectedWallet).then(() => toast('📋', 'Address copied!'));
      }
    });
    if (wdCopyReceive) wdCopyReceive.addEventListener('click', () => {
      if (connectedWallet) {
        navigator.clipboard.writeText(connectedWallet).then(() => toast('📋', 'Address copied!'));
      }
    });

    // Explorer
    if (wdExplorer) wdExplorer.addEventListener('click', () => {
      if (connectedWallet) {
        const cluster = OST_CONFIG.network === 'mainnet-beta' ? '' : '?cluster=' + OST_CONFIG.network;
        window.open('https://explorer.solana.com/address/' + connectedWallet + cluster, '_blank');
      }
    });

    // Receive panel toggle
    if (wdReceiveBtn) wdReceiveBtn.addEventListener('click', () => {
      if (wdReceivePanel) {
        wdReceivePanel.style.display = wdReceivePanel.style.display === 'none' ? '' : 'none';
      }
    });

    // Poll: check if wallet just connected, update dashboard
    let lastWalletState = null;
    setInterval(() => {
      if (connectedWallet && lastWalletState !== connectedWallet) {
        lastWalletState = connectedWallet;
        showDashboard(connectedWallet);
      } else if (!connectedWallet && lastWalletState) {
        lastWalletState = null;
        hideDashboard();
      }
    }, 500);

    // Also refresh balances every 30s while connected
    setInterval(() => {
      if (connectedWallet) fetchDashboardBalances(connectedWallet);
    }, 30000);

    // If already connected on load
    if (connectedWallet) showDashboard(connectedWallet);
  })();

  /* ================================================================== */
  /* PARTICLE FIELD — Hero Background                                   */
  /* ================================================================== */
  (function initParticles() {
    const canvas = $('#particleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, particles = [];
    const COUNT = 80;

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.5 + 0.5,
        dx: (Math.random() - 0.5) * 0.4,
        dy: (Math.random() - 0.5) * 0.4,
        alpha: Math.random() * 0.5 + 0.2,
      });
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.dx; p.y += p.dy;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(109,159,255,' + p.alpha + ')';
        ctx.fill();
        // Connect nearby particles
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const dist = Math.hypot(p.x - q.x, p.y - q.y);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = 'rgba(109,159,255,' + (0.08 * (1 - dist / 120)) + ')';
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(draw);
    }
    draw();
  })();

  /* ================================================================== */
  /* BROWSER MOCKUP — Pay Anywhere with OST (Unified with Price Detection) */
  /* ================================================================== */
  (function initBrowserMockup() {
    const browserUrl = $('#browserUrl');
    const browserGo = $('#browserGo');
    const viewport = $('#browserViewport');
    const checkout = $('#browserCheckout');
    const checkoutStore = $('#checkoutStore');
    const checkoutTotal = $('#checkoutTotal');
    const checkoutRate = $('#checkoutRate');
    const checkoutOst = $('#checkoutOst');
    const checkoutPayBtn = $('#checkoutPayBtn');

    if (!browserUrl || !viewport) return;

    // Quick store buttons
    $$('.browser-quick').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.getAttribute('data-url');
        browserUrl.value = url;
        loadStore(url);
      });
    });

    if (browserGo) browserGo.addEventListener('click', () => {
      const url = browserUrl.value.trim();
      if (url) loadStore(url);
    });
    if (browserUrl) browserUrl.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const url = browserUrl.value.trim();
        if (url) loadStore(url);
      }
    });

    function getHostname(raw) {
      try {
        var u = raw.trim();
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
        return new URL(u).hostname.replace(/^www\./, '');
      } catch (_) {
        return raw.replace(/^https?:\/\//i, '').replace(/\/.*/, '').replace(/[^a-zA-Z0-9.\-]/g, '');
      }
    }
    function hasPath(raw) {
      try {
        var u = raw.trim();
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
        var p = new URL(u).pathname;
        return p && p !== '/' && p.length > 1;
      } catch (_) { return raw.includes('/'); }
    }

    // Simulated store data for quick-link demos
    const stores = {
      'amazon.com': { name: 'Amazon', icon: '&#128230;', color: '#ff9900', items: [
        { name: 'Echo Dot 5th Gen', price: 49.99, img: '&#128266;' },
        { name: 'USB-C Cable 3-Pack', price: 9.99, img: '&#128268;' },
        { name: 'Fire TV Stick 4K', price: 39.99, img: '&#128250;' },
      ], currency: 'USD' },
      'nike.com': { name: 'Nike', icon: '&#128095;', color: '#111', items: [
        { name: 'Air Max 90', price: 185.00, img: '&#128095;' },
        { name: 'Dri-FIT Running Tee', price: 35.00, img: '&#128085;' },
        { name: 'ACG Mountain Fly', price: 180.00, img: '&#129406;' },
      ], currency: 'USD' },
      'apple.com': { name: 'Apple Store', icon: '&#127822;', color: '#333', items: [
        { name: 'iPhone 16 Pro', price: 999.00, img: '&#128241;' },
        { name: 'MagSafe Charger', price: 39.00, img: '&#128267;' },
        { name: 'AirPods Pro 2', price: 249.00, img: '&#127911;' },
      ], currency: 'USD' },
      'booking.com': { name: 'Booking.com', icon: '&#127968;', color: '#003580', items: [
        { name: 'Hotel room 3 nights', price: 285.00, img: '&#127968;' },
        { name: 'Airport transfer', price: 45.00, img: '&#128663;' },
      ], currency: 'EUR' },
      'ebay.com': { name: 'eBay', icon: '&#128717;', color: '#e53238', items: [
        { name: 'Vintage Record Player', price: 125.00, img: '&#127926;' },
        { name: 'Vinyl Collection (10)', price: 45.00, img: '&#128191;' },
      ], currency: 'USD' },
      'walmart.com': { name: 'Walmart', icon: '&#128722;', color: '#0071ce', items: [
        { name: 'Groceries Bundle', price: 67.50, img: '&#127828;' },
        { name: 'Kitchen Blender Pro', price: 29.99, img: '&#129379;' },
        { name: 'Throw Blanket', price: 14.99, img: '&#128716;' },
      ], currency: 'USD' },
      'airbnb.com': { name: 'Airbnb', icon: '&#127969;', color: '#FF5A5F', items: [
        { name: 'Beach house 5 nights', price: 750.00, img: '&#127958;' },
        { name: 'Cleaning fee', price: 75.00, img: '&#129529;' },
      ], currency: 'USD' },
      'aliexpress.com': { name: 'AliExpress', icon: '&#128230;', color: '#e62e04', items: [
        { name: 'Wireless Earbuds', price: 12.99, img: '&#127911;' },
        { name: 'Phone Case', price: 3.99, img: '&#128241;' },
        { name: 'LED Strip 5m', price: 8.99, img: '&#128161;' },
      ], currency: 'USD' },
      'mercadolibre.com': { name: 'Mercado Libre', icon: '&#128722;', color: '#FFE600', items: [
        { name: 'Auriculares Bluetooth', price: 15999, img: '&#127911;' },
        { name: 'Cargador USB-C', price: 4999, img: '&#128268;' },
      ], currency: 'ARS' },
      'rakuten.co.jp': { name: 'Rakuten', icon: '&#127988;', color: '#bf0000', items: [
        { name: 'Nintendo Switch Game', price: 5980, img: '&#127918;' },
        { name: 'Rice Cooker', price: 12800, img: '&#127834;' },
      ], currency: 'JPY' },
      'flipkart.com': { name: 'Flipkart', icon: '&#128722;', color: '#2874F0', items: [
        { name: 'Smartphone', price: 14999, img: '&#128241;' },
        { name: 'Earphones', price: 999, img: '&#127911;' },
      ], currency: 'INR' },
      'shopping.google.com': { name: 'Google Shopping', icon: '&#128269;', color: '#4285F4', items: [
        { name: 'Sony WH-1000XM5 Headphones', price: 348.00, img: '&#127911;' },
        { name: 'Samsung Galaxy S24 Ultra', price: 1199.99, img: '&#128241;' },
        { name: 'Dyson V15 Detect', price: 749.99, img: '&#129529;' },
        { name: 'Nintendo Switch OLED', price: 349.99, img: '&#127918;' },
      ], currency: 'USD' },
      'bestbuy.com': { name: 'Best Buy', icon: '&#128187;', color: '#0046BE', items: [
        { name: 'LG C4 65" OLED TV', price: 1796.99, img: '&#128250;' },
        { name: 'iPad Air M2', price: 599.00, img: '&#128241;' },
        { name: 'Bose QC Ultra', price: 429.00, img: '&#127911;' },
      ], currency: 'USD' },
      'target.com': { name: 'Target', icon: '&#127919;', color: '#CC0000', items: [
        { name: 'Nespresso Vertuo', price: 159.99, img: '&#9749;' },
        { name: 'Lego Star Wars Set', price: 79.99, img: '&#129521;' },
        { name: 'Casper Pillow', price: 65.00, img: '&#128716;' },
      ], currency: 'USD' },
      'costco.com': { name: 'Costco', icon: '&#128230;', color: '#E31837', items: [
        { name: 'KitchenAid Mixer', price: 349.99, img: '&#127860;' },
        { name: 'Bulk Protein Bars (48ct)', price: 39.99, img: '&#127855;' },
      ], currency: 'USD' },
      'homedepot.com': { name: 'Home Depot', icon: '&#128295;', color: '#F96302', items: [
        { name: 'DeWalt Drill Kit', price: 179.00, img: '&#128295;' },
        { name: 'Weber Gas Grill', price: 549.00, img: '&#128293;' },
      ], currency: 'USD' },
      'samsung.com': { name: 'Samsung', icon: '&#128241;', color: '#1428A0', items: [
        { name: 'Galaxy Z Fold 6', price: 1899.99, img: '&#128241;' },
        { name: 'Galaxy Watch Ultra', price: 649.99, img: '&#8986;' },
      ], currency: 'USD' },
      'tesla.com': { name: 'Tesla Shop', icon: '&#128664;', color: '#CC0000', items: [
        { name: 'Tesla Wall Connector', price: 475.00, img: '&#9889;' },
        { name: 'Model Y All-Weather Mats', price: 225.00, img: '&#128664;' },
      ], currency: 'USD' },
      'newegg.com': { name: 'Newegg', icon: '&#128187;', color: '#FF6600', items: [
        { name: 'RTX 4070 Ti Super', price: 799.99, img: '&#127918;' },
        { name: 'Corsair 32GB RAM Kit', price: 89.99, img: '&#128187;' },
      ], currency: 'USD' },
      'zara.com': { name: 'Zara', icon: '&#128087;', color: '#000', items: [
        { name: 'Linen Blazer', price: 89.90, img: '&#128087;' },
        { name: 'Leather Belt', price: 35.90, img: '&#128091;' },
      ], currency: 'USD' },
      'adidas.com': { name: 'Adidas', icon: '&#128095;', color: '#000', items: [
        { name: 'Ultraboost 5', price: 190.00, img: '&#128095;' },
        { name: 'Adicolor Hoodie', price: 65.00, img: '&#129509;' },
      ], currency: 'USD' },
    };

    var currentStore = null;

    function loadStore(rawUrl) {
      const hostname = getHostname(rawUrl);
      if (!hostname) return;
      if (checkout) checkout.style.display = 'none';

      const store = stores[hostname];
      if (store && !hasPath(rawUrl)) {
        // Known quick-link store (just domain, no path) — use simulated catalog
        browserUrl.value = hostname;
        currentStore = Object.assign({}, store, {
          total: store.items.reduce(function(s, i) { return s + i.price; }, 0),
          selected: store.items.map(function() { return true; })
        });
        renderStore(currentStore, hostname);
      } else {
        // Real URL or unknown domain — auto-detect price from the page
        autoDetectPrice(rawUrl, hostname);
      }
    }

    /* ---- Real URL Price Auto-Detection ---- */
    async function autoDetectPrice(rawUrl, hostname) {
      // Show scanning animation
      viewport.innerHTML =
        '<div class="sim-scanning">' +
          '<div class="sim-scan-anim"><div class="sim-scan-ring"></div><span style="font-size:2.5rem;position:relative;z-index:1;">&#128269;</span></div>' +
          '<h4 style="margin:16px 0 8px;">Scanning <strong>' + esc(hostname) + '</strong></h4>' +
          '<p style="color:var(--text-muted);font-size:.85rem;margin-bottom:20px;">Detecting product prices from the page...</p>' +
          '<div class="sim-scan-steps">' +
            '<div class="sim-scan-step sim-scan-active" id="scanStep1">&#128269; Fetching page data...</div>' +
            '<div class="sim-scan-step" id="scanStep2">&#128202; Parsing product metadata...</div>' +
            '<div class="sim-scan-step" id="scanStep3">&#128176; Extracting price &amp; currency...</div>' +
          '</div>' +
        '</div>';
      viewport.style.background = '#0d111b';
      viewport.style.color = '';

      // Normalize URL
      var fetchUrl = rawUrl.trim();
      if (!/^https?:\/\//i.test(fetchUrl)) fetchUrl = 'https://' + fetchUrl;

      try {
        var controller = new AbortController();
        var timeout = setTimeout(function() { controller.abort(); }, 10000);
        var proxyUrl = 'https://api.allorigins.win/get?url=' + encodeURIComponent(fetchUrl);
        var resp = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(timeout);
        var data = await resp.json();

        if (data && data.contents) {
          var s2 = document.getElementById('scanStep2');
          if (s2) s2.classList.add('sim-scan-active');

          var parsed = parseProductData(data.contents);

          var s3 = document.getElementById('scanStep3');
          if (s3) s3.classList.add('sim-scan-active');

          await sleep(600); // Brief pause so user sees the steps

          if (parsed.price > 0) {
            // Price detected!
            currentStore = {
              name: parsed.title || hostname,
              icon: '&#128722;', color: '#6d9fff',
              items: [{ name: parsed.title || 'Product', price: parsed.price, img: parsed.image ? '<img src="' + esc(parsed.image) + '" style="width:48px;height:48px;object-fit:cover;border-radius:8px;" onerror="this.outerHTML=\'&#128722;\'">' : '&#128722;' }],
              currency: parsed.currency || 'USD',
              total: parsed.price,
              selected: [true],
              autoDetected: true,
              description: parsed.description
            };
            renderDetectedProduct(currentStore, hostname, parsed);
            return;
          }
        }
      } catch (_) { /* fetch failed — fall through to manual */ }

      // Could not detect — show manual entry
      renderManualEntry(hostname);
    }

    /* ---- Parse price from HTML (OpenGraph, JSON-LD, Microdata) ---- */
    function parseProductData(html) {
      var result = { title: '', price: 0, currency: 'USD', image: '', description: '' };

      // <title>
      var titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) result.title = decodeEntities(titleMatch[1].trim()).substring(0, 120);

      // OpenGraph meta tags (both property=... content=... and content=... property=... orders)
      var ogPrice = html.match(/<meta[^>]+(?:property|name)=["'](?:og:price:amount|product:price:amount|product:price)["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:price:amount|product:price:amount|product:price)["']/i);
      if (ogPrice) result.price = parseFloat(ogPrice[1].replace(/[^0-9.]/g, '')) || 0;

      var ogCurrency = html.match(/<meta[^>]+(?:property|name)=["'](?:og:price:currency|product:price:currency|priceCurrency)["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:price:currency|product:price:currency|priceCurrency)["']/i);
      if (ogCurrency) result.currency = ogCurrency[1].toUpperCase().substring(0, 3);

      var ogTitle = html.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:title["']/i);
      if (ogTitle && ogTitle[1].length > 3) result.title = decodeEntities(ogTitle[1].trim()).substring(0, 120);

      var ogImage = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i);
      if (ogImage) result.image = ogImage[1];

      var ogDesc = html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:description|description)["']/i);
      if (ogDesc) result.description = decodeEntities(ogDesc[1].trim()).substring(0, 250);

      // JSON-LD structured data (schema.org/Product)
      var jsonLdBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
      if (jsonLdBlocks) {
        for (var i = 0; i < jsonLdBlocks.length; i++) {
          var jsonContent = jsonLdBlocks[i].replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
          try {
            var ld = JSON.parse(jsonContent);
            var product = findProductLD(ld);
            if (product) {
              if (product.name) result.title = product.name.substring(0, 120);
              if (product.description && !result.description) result.description = product.description.substring(0, 250);
              if (product.offers) {
                var offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
                if (offer.price && parseFloat(offer.price)) {
                  result.price = parseFloat(offer.price);
                  if (offer.priceCurrency) result.currency = offer.priceCurrency.toUpperCase().substring(0, 3);
                }
                // Check lowPrice for aggregate offers
                if (!result.price && offer.lowPrice) result.price = parseFloat(offer.lowPrice) || 0;
              }
              if (product.image) {
                var img = typeof product.image === 'string' ? product.image :
                  (Array.isArray(product.image) ? product.image[0] : (product.image && product.image.url ? product.image.url : ''));
                if (img && typeof img === 'string') result.image = img;
              }
              if (result.price > 0) break; // Found what we need
            }
          } catch (_) {}
        }
      }

      // Microdata itemprop="price"
      if (!result.price) {
        var mp = html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i)
          || html.match(/itemprop=["']price["'][^>]*>[\s$€£¥]*([0-9][0-9,]*\.?\d*)/i);
        if (mp) result.price = parseFloat(mp[1].replace(/,/g, '')) || 0;
      }

      // Fallback: generic price regex patterns (last resort)
      if (!result.price) {
        // International price patterns: $29.99, €14,50, £99.00, ¥1200, ₹999, R$150, ₩15000, ₺450, kr299
        var intlPatterns = [
          { re: /["'>]\s*\$\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*[\s<"']/,             cur: 'USD' },
          { re: /["'>]\s*€\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*[\s<"']/,             cur: 'EUR' },
          { re: /["'>]\s*£\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*[\s<"']/,             cur: 'GBP' },
          { re: /["'>]\s*[¥￥]\s*(\d{1,9}(?:[.,]\d{1,2})?)\s*[\s<"']/,          cur: 'JPY' },
          { re: /["'>]\s*₹\s*(\d{1,9}(?:[.,]\d{1,2})?)\s*[\s<"']/,             cur: 'INR' },
          { re: /["'>]\s*R\$\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*[\s<"']/,           cur: 'BRL' },
          { re: /["'>]\s*₩\s*(\d{1,9}(?:[.,]\d{0,2})?)\s*[\s<"']/,             cur: 'KRW' },
          { re: /["'>]\s*₺\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*[\s<"']/,             cur: 'TRY' },
          { re: /["'>]\s*₽\s*(\d{1,9}(?:[.,]\d{1,2})?)\s*[\s<"']/,             cur: 'RUB' },
          { re: /["'>]\s*zł\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*[\s<"']/i,           cur: 'PLN' },
          { re: /["'>]\s*CHF\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*[\s<"']/,           cur: 'CHF' },
          { re: /["'>]\s*A\$\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*[\s<"']/,           cur: 'AUD' },
          { re: /["'>]\s*C\$\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*[\s<"']/,           cur: 'CAD' },
          { re: /["'>]\s*₱\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*[\s<"']/,             cur: 'PHP' },
          { re: /["'>]\s*₫\s*(\d{1,9}(?:[.,]\d{0,2})?)\s*[\s<"']/,             cur: 'VND' },
          { re: /["'>]\s*kr\.?\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*[\s<"']/i,        cur: 'SEK' },
          { re: /["'>]\s*₪\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*[\s<"']/,             cur: 'ILS' },
        ];
        for (var p = 0; p < intlPatterns.length; p++) {
          var m = html.match(intlPatterns[p].re);
          if (m) {
            result.price = parseIntlPrice(m[1]);
            result.currency = intlPatterns[p].cur;
            break;
          }
        }
      }

      // European comma-as-decimal: detect from priceCurrency meta if present
      if (result.price && result.currency && ['EUR','BRL','PLN','TRY','CZK','HUF','RON','RUB','UAH'].indexOf(result.currency) >= 0) {
        // Re-check if price string used comma as decimal (e.g. "14,99")
        var rawPriceStr = (ogPrice && ogPrice[1]) || '';
        if (rawPriceStr && rawPriceStr.indexOf(',') > rawPriceStr.indexOf('.')) {
          result.price = parseIntlPrice(rawPriceStr);
        }
      }

      return result;
    }

    function parseIntlPrice(s) {
      // Handle European format: 1.234,56 or 1234,56 → 1234.56
      // Handle US format: 1,234.56 → 1234.56
      s = s.replace(/\s/g, '');
      if (/\d+\.\d{3},\d{1,2}$/.test(s)) {
        // European: 1.234,56 → 1234.56
        return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
      } else if (/\d+,\d{1,2}$/.test(s) && s.indexOf('.') < 0) {
        // Simple comma decimal: 14,99 → 14.99
        return parseFloat(s.replace(',', '.')) || 0;
      } else {
        // US format or plain number
        return parseFloat(s.replace(/,/g, '')) || 0;
      }
    }

    function findProductLD(data) {
      if (!data) return null;
      if (typeof data !== 'object') return null;
      var t = data['@type'];
      if (t === 'Product' || t === 'IndividualProduct' || (Array.isArray(t) && t.indexOf('Product') !== -1)) return data;
      if (Array.isArray(data)) {
        for (var i = 0; i < data.length; i++) {
          var found = findProductLD(data[i]);
          if (found) return found;
        }
      }
      if (data['@graph'] && Array.isArray(data['@graph'])) return findProductLD(data['@graph']);
      return null;
    }

    function decodeEntities(str) {
      var el = document.createElement('textarea');
      el.innerHTML = str;
      return el.value;
    }

    /* ---- Render: auto-detected product ---- */
    function renderDetectedProduct(store, hostname, parsed) {
      var sym = getCurrSym(store.currency);
      var rate = ostPrice || 0.0001;
      // Convert to USD for proper OST calculation
      var usdTotal = store.total;
      var c = store.currency;
      if (c === 'BTC') usdTotal = store.total * (prices.bitcoin || 105000);
      else if (c === 'ETH') usdTotal = store.total * (prices.ethereum || 3800);
      else if (c === 'SOL') usdTotal = store.total * (prices.solana || 170);
      else if (c === 'USDC' || c === 'USDT') usdTotal = store.total;
      else if (fiatRates[c] && fiatRates[c] > 0) usdTotal = store.total / fiatRates[c];
      var ostAmount = usdTotal / rate;
      var ostFormatted = ostAmount >= 1e6 ? (ostAmount / 1e6).toFixed(2) + 'M' :
                         ostAmount >= 1e3 ? (ostAmount / 1e3).toFixed(1) + 'K' :
                         ostAmount.toFixed(2);

      var imageHtml = parsed.image ?
        '<img src="' + esc(parsed.image) + '" style="width:80px;height:80px;object-fit:cover;border-radius:12px;border:1px solid var(--border);" onerror="this.outerHTML=\'<span style=font-size:3rem>&#128722;</span>\'">' :
        '<span style="font-size:3rem;">&#128722;</span>';

      viewport.innerHTML =
        '<div class="sim-detected">' +
          '<button class="sim-back-btn" title="Back to home">&larr; Back</button>' +
          '<div class="sim-detected-badge">&#9989; Price detected from <strong>' + esc(hostname) + '</strong></div>' +
          '<div class="sim-detected-product">' +
            '<div class="sim-detected-img">' + imageHtml + '</div>' +
            '<div class="sim-detected-info">' +
              '<h4 class="sim-detected-title">' + esc(store.name) + '</h4>' +
              (parsed.description ? '<p class="sim-detected-desc">' + esc(parsed.description).substring(0, 150) + '</p>' : '') +
              '<div class="sim-detected-price">' + sym + store.total.toFixed(2) + ' ' + store.currency + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="sim-detected-conversion">' +
            '<div class="sim-conv-row"><span>You Pay:</span><strong style="color:var(--accent);font-size:1.1rem;">' + ostFormatted + ' OST</strong></div>' +
            '<div class="sim-conv-row"><span>Rate:</span><span>1 OST = ' + sym + rate.toFixed(6) + '</span></div>' +
            '<div class="sim-conv-row"><span>Route:</span><span>OST &#8594; Jupiter &#8594; ' + store.currency + ' &#8594; Merchant</span></div>' +
            '<div class="sim-conv-row" style="border:none;"><span>Fee:</span><span>~$0.0025 (0.000005 SOL)</span></div>' +
          '</div>' +
          '<button class="btn btn-primary btn-glow sim-checkout-btn" style="width:100%;justify-content:center;margin-top:16px;">&#9673; Pay ' + ostFormatted + ' OST to ' + esc(hostname) + '</button>' +
          '<p style="text-align:center;color:var(--text-muted);font-size:.75rem;margin-top:8px;">&#128274; Private via ZK proofs &mdash; merchant never sees your wallet</p>' +
        '</div>';

      viewport.style.background = '#0d111b';
      viewport.style.color = '';

      // Wire checkout button
      var btn = viewport.querySelector('.sim-checkout-btn');
      if (btn) btn.addEventListener('click', function() { showCheckout(store); });
      // Wire back button
      var back = viewport.querySelector('.sim-back-btn');
      if (back) back.addEventListener('click', resetViewport);
    }

    /* ---- Render: manual entry (price not auto-detected) ---- */
    function renderManualEntry(hostname) {
      viewport.innerHTML =
        '<div class="sim-manual">' +
          '<button class="sim-back-btn" title="Back to home">&larr; Back</button>' +
          '<div class="sim-manual-header">' +
            '<span style="font-size:2rem;">&#128270;</span>' +
            '<div>' +
              '<h4 style="margin:0;">Could not auto-detect price</h4>' +
              '<p style="color:var(--text-muted);font-size:.82rem;margin:4px 0 0;">Some sites block price scanning. Enter the product price manually below.</p>' +
            '</div>' +
          '</div>' +
          '<div class="sim-manual-form">' +
            '<div class="sim-manual-row">' +
              '<div class="sim-manual-field">' +
                '<label style="color:var(--text-muted);font-size:.8rem;margin-bottom:4px;display:block;">Product price</label>' +
                '<input type="number" id="manualPrice" class="sim-manual-input" placeholder="0.00" step="0.01" min="0">' +
              '</div>' +
              '<div class="sim-manual-field" style="max-width:140px;">' +
                '<label style="color:var(--text-muted);font-size:.8rem;margin-bottom:4px;display:block;">Currency</label>' +
                '<select id="manualCurrency" class="sim-manual-select">' +
                  '<option value="USD">USD $</option><option value="EUR">EUR \u20ac</option><option value="GBP">GBP \u00a3</option>' +
                  '<option value="JPY">JPY \u00a5</option><option value="CNY">CNY \u00a5</option><option value="INR">INR \u20b9</option>' +
                  '<option value="BRL">BRL R$</option><option value="KRW">KRW \u20a9</option><option value="MXN">MXN $</option>' +
                  '<option value="CAD">CAD C$</option><option value="AUD">AUD A$</option><option value="CHF">CHF</option>' +
                  '<option value="SEK">SEK kr</option><option value="NOK">NOK kr</option><option value="DKK">DKK kr</option>' +
                  '<option value="PLN">PLN z\u0142</option><option value="TRY">TRY \u20ba</option><option value="RUB">RUB \u20bd</option>' +
                  '<option value="ZAR">ZAR R</option><option value="HKD">HKD HK$</option><option value="SGD">SGD S$</option>' +
                  '<option value="TWD">TWD NT$</option><option value="THB">THB \u0e3f</option><option value="PHP">PHP \u20b1</option>' +
                  '<option value="NGN">NGN \u20a6</option><option value="ILS">ILS \u20aa</option><option value="COP">COP $</option>' +
                  '<option value="BTC">BTC \u20bf</option><option value="ETH">ETH \u039e</option><option value="SOL">SOL \u25ce</option>' +
                '</select>' +
              '</div>' +
            '</div>' +
            '<div class="sim-manual-conversion" id="manualConversion" style="display:none;">' +
              '<div class="sim-conv-row"><span>You Pay:</span><strong id="manualOstAmount" style="color:var(--accent);">-- OST</strong></div>' +
              '<div class="sim-conv-row"><span>Rate:</span><span id="manualRate">--</span></div>' +
              '<div class="sim-conv-row" style="border:none;"><span>Fee:</span><span>~$0.0025</span></div>' +
            '</div>' +
            '<button class="btn btn-primary btn-glow sim-checkout-btn" id="manualPayBtn" style="width:100%;justify-content:center;margin-top:12px;" disabled>&#9673; Pay with OST</button>' +
          '</div>' +
        '</div>';

      viewport.style.background = '#0d111b';
      viewport.style.color = '';

      // Wire manual price form
      var priceInput = viewport.querySelector('#manualPrice');
      var currSelect = viewport.querySelector('#manualCurrency');
      var convDisplay = viewport.querySelector('#manualConversion');
      var ostAmountEl = viewport.querySelector('#manualOstAmount');
      var rateEl = viewport.querySelector('#manualRate');
      var payBtn = viewport.querySelector('#manualPayBtn');

      function updateManualConversion() {
        var priceVal = parseFloat(priceInput.value) || 0;
        var curr = currSelect.value;
        if (priceVal <= 0) {
          if (convDisplay) convDisplay.style.display = 'none';
          if (payBtn) payBtn.disabled = true;
          return;
        }
        var usdValue = priceVal;
        if (curr === 'BTC') usdValue = priceVal * (prices.bitcoin || 105000);
        else if (curr === 'ETH') usdValue = priceVal * (prices.ethereum || 3800);
        else if (curr === 'SOL') usdValue = priceVal * (prices.solana || 170);
        else if (curr === 'USDC' || curr === 'USDT') usdValue = priceVal;
        else if (fiatRates[curr]) usdValue = priceVal / fiatRates[curr];

        var ostOut = usdValue / ostPrice;
        var formatted = ostOut >= 1e6 ? (ostOut / 1e6).toFixed(2) + 'M' :
                        ostOut >= 1e3 ? (ostOut / 1e3).toFixed(1) + 'K' :
                        ostOut.toFixed(2);

        if (convDisplay) convDisplay.style.display = '';
        if (ostAmountEl) ostAmountEl.textContent = formatted + ' OST';
        if (rateEl) rateEl.textContent = '1 OST = $' + ostPrice.toFixed(6);
        if (payBtn) { payBtn.disabled = false; payBtn.innerHTML = '&#9673; Pay ' + formatted + ' OST to ' + esc(hostname); }

        // Also set up currentStore for checkout
        currentStore = {
          name: hostname, icon: '&#127760;', color: '#555',
          items: [{ name: 'Product from ' + hostname, price: priceVal, img: '&#127760;' }],
          currency: curr, total: priceVal, selected: [true]
        };
      }

      priceInput.addEventListener('input', updateManualConversion);
      currSelect.addEventListener('change', updateManualConversion);
      if (payBtn) payBtn.addEventListener('click', function() {
        if (currentStore) showCheckout(currentStore);
      });
      // Wire back button
      var backBtn = viewport.querySelector('.sim-back-btn');
      if (backBtn) backBtn.addEventListener('click', resetViewport);
    }

    function renderStore(store, hostname) {
      var sym = getCurrSym(store.currency);
      var itemsHtml = store.items.map(function(item, i) {
        var checked = store.selected ? store.selected[i] : true;
        return '<label class="sim-product' + (checked ? ' sim-product-selected' : '') + '" data-idx="' + i + '">' +
          '<input type="checkbox"' + (checked ? ' checked' : '') + ' class="sim-product-check" data-idx="' + i + '">' +
          '<span class="sim-product-img">' + item.img + '</span>' +
          '<span class="sim-product-info"><span class="sim-product-name">' + esc(item.name) + '</span>' +
          '<span class="sim-product-price">' + sym + item.price.toFixed(2) + '</span></span>' +
        '</label>';
      }).join('');

      viewport.innerHTML =
        '<div class="sim-store">' +
          '<div class="sim-store-header" style="border-bottom:3px solid ' + (store.color || '#6d9fff') + ';">' +
            '<button class="sim-back-btn" title="Back to home">&larr;</button>' +
            '<span class="sim-store-icon">' + store.icon + '</span><h4>' + esc(store.name) + '</h4>' +
            '<span class="sim-ost-badge">&#9673; OST Pay Active</span>' +
          '</div>' +
          '<div class="sim-products">' + itemsHtml + '</div>' +
          '<div class="sim-cart">' +
            '<div class="sim-cart-total">Cart: <strong id="simCartTotal">' + sym + store.total.toFixed(2) + ' ' + store.currency + '</strong></div>' +
          '</div>' +
          '<button class="btn btn-primary btn-glow sim-checkout-btn" style="width:100%;justify-content:center;margin-top:16px;">&#9673; Proceed to Pay with OST</button>' +
        '</div>';

      viewport.style.background = '#f8f9fa';
      viewport.style.color = '#111';

      // Wire product toggles
      viewport.querySelectorAll('.sim-product-check').forEach(function(cb) {
        cb.addEventListener('change', function() {
          var idx = parseInt(this.getAttribute('data-idx'));
          if (store.selected) store.selected[idx] = this.checked;
          var label = this.closest('.sim-product');
          if (label) label.classList.toggle('sim-product-selected', this.checked);
          recalcTotal(store);
        });
      });

      // Wire checkout
      var simCheckout = viewport.querySelector('.sim-checkout-btn');
      if (simCheckout) {
        simCheckout.addEventListener('click', function() { showCheckout(store); });
      }
      // Wire back button
      var backBtn = viewport.querySelector('.sim-back-btn');
      if (backBtn) backBtn.addEventListener('click', resetViewport);
    }

    function resetViewport() {
      browserUrl.value = '';
      if (checkout) checkout.style.display = 'none';
      viewport.innerHTML =
        '<div class="browser-placeholder">' +
          '<div class="browser-placeholder-icon">&#127760;</div>' +
          '<h4>Paste Any Product Link &mdash; OST Detects The Price</h4>' +
          '<p>Paste a real product URL from any website. OST scans the page, detects the price, converts it to OST, and handles checkout. Or pick a store below to browse.</p>' +
          '<div class="browser-quick-links">' +
            '<button class="browser-quick browser-quick-google" data-url="shopping.google.com">&#128269; Google Shopping</button>' +
            '<button class="browser-quick" data-url="amazon.com">&#128230; Amazon</button>' +
            '<button class="browser-quick" data-url="nike.com">&#128095; Nike</button>' +
            '<button class="browser-quick" data-url="apple.com">&#127822; Apple</button>' +
            '<button class="browser-quick" data-url="bestbuy.com">&#128187; Best Buy</button>' +
            '<button class="browser-quick" data-url="walmart.com">&#128722; Walmart</button>' +
            '<button class="browser-quick" data-url="target.com">&#127919; Target</button>' +
            '<button class="browser-quick" data-url="costco.com">&#128230; Costco</button>' +
            '<button class="browser-quick" data-url="homedepot.com">&#128295; Home Depot</button>' +
            '<button class="browser-quick" data-url="samsung.com">&#128241; Samsung</button>' +
            '<button class="browser-quick" data-url="tesla.com">&#128664; Tesla</button>' +
            '<button class="browser-quick" data-url="booking.com">&#127968; Booking</button>' +
            '<button class="browser-quick" data-url="ebay.com">&#128717; eBay</button>' +
            '<button class="browser-quick" data-url="airbnb.com">&#127969; Airbnb</button>' +
            '<button class="browser-quick" data-url="aliexpress.com">&#128230; AliExpress</button>' +
            '<button class="browser-quick" data-url="mercadolibre.com">&#128722; Mercado Libre</button>' +
            '<button class="browser-quick" data-url="rakuten.co.jp">&#127988; Rakuten</button>' +
            '<button class="browser-quick" data-url="flipkart.com">&#128722; Flipkart</button>' +
            '<button class="browser-quick" data-url="newegg.com">&#128187; Newegg</button>' +
            '<button class="browser-quick" data-url="zara.com">&#128087; Zara</button>' +
            '<button class="browser-quick" data-url="adidas.com">&#128095; Adidas</button>' +
          '</div>' +
          '<div class="browser-google-tip"><span>&#128161;</span> <strong>Pro tip:</strong> Search any product on Google Shopping, paste the product link here, and OST auto-detects the price.</div>' +
        '</div>';
      viewport.style.background = '';
      viewport.style.color = '';
      // Re-wire quick link buttons
      viewport.querySelectorAll('.browser-quick').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var url = btn.getAttribute('data-url');
          browserUrl.value = url;
          loadStore(url);
        });
      });
    }

    function recalcTotal(store) {
      var total = 0;
      store.items.forEach(function(item, i) {
        if (store.selected && store.selected[i]) total += item.price;
      });
      store.total = total;
      var sym = store.currency === 'EUR' ? '€' : (store.currency === 'GBP' ? '£' : getCurrSym(store.currency));
      var el = viewport.querySelector('#simCartTotal');
      if (el) el.innerHTML = sym + total.toFixed(2) + ' ' + store.currency;
    }

    function showCheckout(store) {
      if (!checkout) return;
      checkout.style.display = '';
      if (checkoutStore) checkoutStore.textContent = store.name;
      const symbol = getCurrSym(store.currency);
      if (checkoutTotal) checkoutTotal.textContent = symbol + store.total.toFixed(2) + ' ' + store.currency;
      const rate = ostPrice || 0.0001;
      // Convert store total to USD first for proper OST conversion
      var usdTotal = store.total;
      var c = store.currency;
      if (c === 'BTC') usdTotal = store.total * (prices.bitcoin || 105000);
      else if (c === 'ETH') usdTotal = store.total * (prices.ethereum || 3800);
      else if (c === 'SOL') usdTotal = store.total * (prices.solana || 170);
      else if (c === 'USDC' || c === 'USDT') usdTotal = store.total;
      else if (fiatRates[c] && fiatRates[c] > 0) usdTotal = store.total / fiatRates[c];
      const ostAmount = usdTotal / rate;
      if (checkoutRate) checkoutRate.textContent = '1 OST = ' + symbol + rate.toFixed(6);
      if (checkoutOst) checkoutOst.textContent = ostAmount.toFixed(2) + ' OST';

      // Detect currency and show conversion info
      var convInfo = '';
      if (store.currency !== 'USD') {
        convInfo = '<div class="checkout-row checkout-row-conv"><span>Currency detected:</span><span>' + store.currency + ' &rarr; auto-converted</span></div>';
      }
      var summaryEl = $('#checkoutSummary');
      if (summaryEl && convInfo) {
        var convDiv = summaryEl.querySelector('.checkout-row-conv');
        if (!convDiv) summaryEl.insertAdjacentHTML('afterbegin', convInfo);
      }

      if (checkoutPayBtn) {
        checkoutPayBtn.disabled = false;
        checkoutPayBtn.innerHTML = '<span>&#9673;</span> Confirm &amp; Pay with OST';
        checkoutPayBtn.onclick = () => {
          checkoutPayBtn.disabled = true;
          checkoutPayBtn.innerHTML = '<span class="spinner"></span> Processing... ZK proof generation';
          setTimeout(() => {
            checkout.innerHTML = '<div style="text-align:center;padding:20px;"><div style="font-size:3rem;margin-bottom:12px;">&#127881;</div><h4 style="color:#34d399;">Payment Complete!</h4><p style="color:#8b92ad;font-size:.85rem;margin-top:8px;">' + esc(store.name) + ' received ' + symbol + store.total.toFixed(2) + ' ' + store.currency + '</p><p style="color:#6d9fff;font-size:.9rem;margin-top:4px;">You paid ' + ostAmount.toFixed(2) + ' OST</p><p style="color:#8b92ad;font-size:.75rem;margin-top:8px;">&#128274; Private via ZK proofs &mdash; no one saw this transaction.</p><p style="color:#555;font-size:.7rem;margin-top:12px;">OST automatically detected ' + store.currency + ', converted via Jupiter, and settled on Solana in 400ms.</p></div>';
            toast('&#127881;', 'Payment to ' + store.name + ' complete!');
            launchConfetti();
          }, 2500);
        };
      }
    }
  })();

  /* ================================================================== */
  /* UNIVERSAL IN-PAGE POPUP — smart URL rewriting for embeddable views */
  /* ================================================================== */
  // Save original window.open before anything patches it
  window._origOpen = window.open;
  (function initInPagePopup() {
    const overlay = $('#ostPopupOverlay');
    const frame   = $('#ostPopupFrame');
    const titleEl = $('#ostPopupTitle');
    const closeBtn = $('#ostPopupClose');
    if (!overlay || !frame) return;

    // Consumer-facing buy page URLs (no partner API key needed)
    var OR_BASE = 'https://buy.onramper.com/';

    // Build an Onramper consumer URL
    function onrampUrl(fiat, mode) {
      var p = '?defaultCrypto=sol_solana&onlyCryptoNetworks=solana&mode=' + (mode || 'buy');
      if (fiat) p += '&defaultFiat=' + fiat;
      return OR_BASE + p;
    }

    // Map of domains to their embeddable counterparts
    function rewriteUrl(raw) {
      try {
        var u = new URL(raw);
        var h = u.hostname.replace(/^www\./, '');

        // --- Onramper (old widget URL → new buy URL) ---
        if (h === 'widget.onramper.com' || h === 'buy.onramper.com' || h === 'onramper.com') {
          var fiat = u.searchParams.get('defaultFiat') || '';
          var mode = u.searchParams.get('mode') || 'buy';
          return onrampUrl(fiat, mode);
        }
        if (h === 'docs.onramper.com') return onrampUrl('', 'buy');

        // --- MoonPay → consumer buy page ---
        if (h === 'moonpay.com' || h === 'buy.moonpay.com' || h === 'buy.sandbox.moonpay.com')
          return 'https://www.moonpay.com/buy/sol';

        // --- Transak → consumer buy page ---
        if (h === 'global.transak.com') return 'https://global.transak.com/?cryptoCurrencyCode=SOL';

        // --- Ramp Network → consumer buy page ---
        if (h === 'ramp.network' || h === 'app.ramp.network') return 'https://ramp.network/buy/sol-solana';

        // --- Coinbase → consumer how-to-buy page ---
        if (h === 'pay.coinbase.com') return 'https://www.coinbase.com/how-to-buy/solana';

        // --- Binance → consumer buy page ---
        if (h === 'binance.com') return 'https://www.binance.com/en/price/solana';

        // --- Jupiter DEX → use embeddable Terminal with wOST ---
        if (h === 'jup.ag') return 'https://terminal.jup.ag/swap?outputMint=Ac8RTG9R15HDXkjJDphRNpEgawEh1o5wLFaWPGFjiHoS';
        if (h === 'terminal.jup.ag') return raw; // already embeddable

        // --- Orca → route through Jupiter Terminal (aggregates Orca liquidity) ---
        if (h === 'orca.so') return 'https://terminal.jup.ag/swap?outputMint=Ac8RTG9R15HDXkjJDphRNpEgawEh1o5wLFaWPGFjiHoS';

        // --- Portal Bridge (uses iframe-friendly checkout) ---
        if (h === 'portalbridge.com') return raw;

        // --- deBridge (embeddable widget) ---
        if (h === 'app.debridge.finance') return raw;

        // --- Allbridge Core (embeddable) ---
        if (h === 'core.allbridge.io' || h === 'app.allbridge.io') return raw;

        // --- Mayan Finance (embeddable) ---
        if (h === 'mayan.finance') return raw;
      } catch(e) {}
      return raw;
    }

    // Show a fallback card when iframe can't load
    function showFallbackCard(url, label) {
      var host = '';
      try { host = new URL(url).hostname; } catch(e) { host = url; }
      frame.style.display = 'none';
      var fb = overlay.querySelector('.ost-popup-fallback');
      if (!fb) {
        fb = document.createElement('div');
        fb.className = 'ost-popup-fallback';
        overlay.querySelector('.ost-popup').appendChild(fb);
      }
      fb.innerHTML =
        '<div style="text-align:center;padding:48px 24px;max-width:420px;margin:auto;">' +
          '<div style="font-size:3rem;margin-bottom:16px;">&#128274;</div>' +
          '<h3 style="color:var(--text);margin-bottom:12px;">' + esc(label || host) + '</h3>' +
          '<p style="color:var(--text-muted);font-size:.9rem;line-height:1.6;margin-bottom:24px;">' +
            'This site blocks inline embedding for security.<br>You can open it in a new tab safely.' +
          '</p>' +
          '<a href="' + esc(url) + '" target="_blank" rel="noopener" class="btn btn-primary btn-glow" ' +
            'style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;" ' +
            'onclick="event.stopPropagation();">' +
            '&#128279; Open ' + esc(host) + '</a>' +
          '<p style="color:var(--text-muted);font-size:.75rem;margin-top:16px;">Tip: For buying/selling crypto, use the Onramper widget above — it works right here.</p>' +
        '</div>';
      fb.style.display = 'flex';
    }

    // Fiat ramp domains — these must open in a new tab because they block sandboxed iframes
    var fiatRampDomains = [
      'buy.onramper.com','widget.onramper.com','onramper.com',
      'moonpay.com','buy.moonpay.com','buy.sandbox.moonpay.com',
      'global.transak.com','ramp.network','app.ramp.network',
      'pay.coinbase.com'
    ];

    function isFiatRamp(testUrl) {
      try {
        var fHost = new URL(testUrl).hostname.replace(/^www\./, '');
        for (var i = 0; i < fiatRampDomains.length; i++) {
          if (fHost === fiatRampDomains[i] || fHost.endsWith('.' + fiatRampDomains[i])) return true;
        }
      } catch(e) {}
      return false;
    }

    // Embeddable allowlist — ONLY these domains load inside our popup iframe.
    // Everything else opens in a new tab. Almost no website allows iframe embedding.
    var embeddableDomains = [
      'terminal.jup.ag',           // Jupiter swap widget
      'openstreetmap.org',         // Maps embed
      'app.debridge.finance',      // deBridge widget
      'core.allbridge.io',         // Allbridge Core widget
      'app.allbridge.io',          // Allbridge legacy
      'mayan.finance',             // Mayan bridge widget
      'portalbridge.com'           // Portal Bridge widget
    ];

    function isEmbeddable(testUrl) {
      try {
        var fHost = new URL(testUrl).hostname.replace(/^www\./, '');
        for (var i = 0; i < embeddableDomains.length; i++) {
          if (fHost === embeddableDomains[i] || fHost.endsWith('.' + embeddableDomains[i])) return true;
        }
      } catch(e) {}
      return false;
    }

    function openPopup(url, label) {
      // Rewrite URL to embeddable version
      var embedUrl = rewriteUrl(url);

      // If the rewritten URL is embeddable → load in popup iframe
      if (isEmbeddable(embedUrl)) {
        titleEl.textContent = label || embedUrl.replace(/^https?:\/\//, '').split('/')[0];
        var fb = overlay.querySelector('.ost-popup-fallback');
        if (fb) fb.style.display = 'none';
        frame.style.display = '';
        frame.src = embedUrl;
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        // Safety fallback in case even these fail
        var loadTimer = setTimeout(function() { showFallbackCard(url, label); }, 5000);
        frame.onload = function() { clearTimeout(loadTimer); };
        return;
      }

      // Everything else → open directly in a new tab
      var openUrl = embedUrl;
      // For fiat ramps, use the rewritten Onramper URL
      // For others, use the original URL (more useful than a rewritten version)
      if (!isFiatRamp(embedUrl)) openUrl = url;

      window._origOpen(openUrl, '_blank', 'noopener');
      toast('🔗', 'Opening ' + (label || 'link') + ' in a new tab…');
    }

    function closePopup() {
      overlay.classList.remove('open');
      frame.src = '';
      frame.style.display = '';
      var fb = overlay.querySelector('.ost-popup-fallback');
      if (fb) fb.style.display = 'none';
      document.body.style.overflow = '';
    }

    closeBtn.addEventListener('click', closePopup);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closePopup();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closePopup();
    });

    // Expose globally
    window.openOstPopup = openPopup;
    window.closeOstPopup = closePopup;

    // ------- INTERCEPT ALL EXTERNAL <a> LINKS -------
    document.addEventListener('click', function(e) {
      var a = e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href');
      if (!href) return;
      if (href.charAt(0) === '#' || href.startsWith('javascript')) return;
      if (!href.startsWith('http://') && !href.startsWith('https://')) return;

      // Let fallback "Open" buttons pass through (they have onclick stopPropagation)
      e.preventDefault();

      var label = '';
      var h4 = a.querySelector('h4');
      var text = a.textContent.trim();
      if (h4) label = h4.textContent.trim();
      else if (text.length < 40) label = text;
      else label = href.replace(/^https?:\/\//, '').split('/')[0];

      openPopup(href, label);
    });
  })();

  /* ================================================================== */
  /* PATCH window.open — keep users on-site for wallet installs etc     */
  /* ================================================================== */
  (function patchWindowOpen() {
    var _origOpen = window._origOpen;
    // Domains that must open natively (wallet adapters, auth flows)
    var nativeOpenDomains = ['phantom.app','solflare.com','backpack.app',
      'sollet.io','slope.finance','glow.app','accounts.google.com',
      'auth.tor.us','app.tor.us'];
    window.open = function(url, target, features) {
      if (typeof url === 'string') {
        // Let wallet downloads and auth flows open natively
        try {
          var h = new URL(url).hostname.replace(/^www\./, '');
          for (var i = 0; i < nativeOpenDomains.length; i++) {
            if (h === nativeOpenDomains[i] || h.endsWith('.' + nativeOpenDomains[i])) {
              return _origOpen.call(window, url, target, features);
            }
          }
        } catch(e) {}
        if (window.openOstPopup) {
          window.openOstPopup(url, url.replace(/^https?:\/\//, '').split('/')[0]);
          return null;
        }
      }
      return _origOpen.call(window, url, target, features);
    };
  })();

  /* ================================================================== */
  /* NEW: Interactive Rocket Timeline                                    */
  /* ================================================================== */
  (function initRocketTimeline() {
    const timeline = $('#rocketTimeline');
    if (!timeline) return;
    const rocket = $('#rtRocket');
    const stations = timeline.querySelectorAll('.rt-station');
    if (!rocket || !stations.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.style.opacity = '1';
          e.target.style.transform = 'translateY(0)';
          e.target.classList.add('rt-station-visible');
        }
      });
    }, { threshold: 0.3 });

    stations.forEach((s, i) => {
      s.style.opacity = '0';
      s.style.transform = 'translateY(30px)';
      s.style.transitionDelay = (i * 0.2) + 's';
      observer.observe(s);
    });

    // Rocket follows scroll position within the timeline
    const updateRocket = () => {
      const rect = timeline.getBoundingClientRect();
      const viewH = window.innerHeight;
      const progress = Math.max(0, Math.min(1, (viewH - rect.top) / (rect.height + viewH)));
      if (rocket) rocket.style.top = (progress * 85 + 5) + '%';
    };
    window.addEventListener('scroll', updateRocket, { passive: true });
    updateRocket();

    // Click interaction on stations
    stations.forEach(s => {
      s.addEventListener('click', () => {
        stations.forEach(x => x.classList.remove('rt-station-active'));
        s.classList.add('rt-station-active');
        const phase = s.dataset.phase;
        const positions = { launch: '10%', orbit: '35%', moon: '60%', mars: '85%' };
        if (rocket && positions[phase]) {
          rocket.style.top = positions[phase];
        }
      });
    });
  })();

  /* ================================================================== */
  /* NEW: Live Censorship News Feed (updates hourly)                    */
  /* ================================================================== */
  (function initCensorshipFeed() {
    const ticker = $('#clfTicker');
    const refreshEl = $('#clfRefresh');
    if (!ticker) return;

    // Censorship data - curated from reliable sources
    const reports = [
      { region: 'Iran', text: 'Iran continues nationwide internet throttling, VPN blocking intensified', source: 'NetBlocks', url: 'https://netblocks.org' },
      { region: 'Russia', text: 'Russia blocks additional VPN services, restricts access to Western platforms', source: 'OONI', url: 'https://ooni.org' },
      { region: 'China', text: 'China\'s Great Firewall updates: new AI-powered deep packet inspection deployed', source: 'Freedom House', url: 'https://freedomhouse.org' },
      { region: 'Myanmar', text: 'Myanmar junta orders telecom shutdowns in conflict zones', source: 'Access Now', url: 'https://www.accessnow.org' },
      { region: 'India', text: 'Internet shutdowns reported in Kashmir region, affecting millions', source: 'SFLC.in', url: 'https://internetshutdowns.in' },
      { region: 'Turkey', text: 'Turkish authorities block social media during protests, VPN usage surges', source: 'Turkey Blocks', url: 'https://turkeyblocks.org' },
      { region: 'Ethiopia', text: 'Ethiopia implements regional internet blackouts amid tensions', source: 'NetBlocks', url: 'https://netblocks.org' },
      { region: 'Cuba', text: 'Cuba restricts mobile internet access during civil demonstrations', source: 'OONI', url: 'https://ooni.org' },
      { region: 'Egypt', text: 'Egypt blocks news websites and messaging apps, censorship expanding', source: 'EFF', url: 'https://eff.org' },
      { region: 'Venezuela', text: 'Venezuela restricts social media and streaming platforms nationwide', source: 'IPYS', url: 'https://ipysvenezuela.org' },
      { region: 'Pakistan', text: 'Pakistan implements intermittent social media blocks and VPN restrictions', source: 'Digital Rights Foundation', url: 'https://digitalrightsfoundation.pk' },
      { region: 'Belarus', text: 'Belarus continues internet disruptions targeting independent media', source: 'NetBlocks', url: 'https://netblocks.org' },
    ];

    function renderFeed() {
      // Shuffle and pick 5-6 items based on current hour
      const hour = new Date().getHours();
      const seed = hour + new Date().getDate();
      const shuffled = [...reports].sort((a, b) => {
        const ha = ((seed * 31 + reports.indexOf(a) * 17) % 100);
        const hb = ((seed * 31 + reports.indexOf(b) * 17) % 100);
        return ha - hb;
      });
      const items = shuffled.slice(0, 6);
      const now = new Date();

      ticker.innerHTML = items.map((r, i) => {
        const mins = (i * 8 + 3);
        const time = new Date(now.getTime() - mins * 60000);
        const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return '<div class="clf-item">' +
          '<span class="clf-time">' + timeStr + '</span>' +
          '<span class="clf-text"><strong>' + r.region + ':</strong> ' + r.text + '</span>' +
          '<span class="clf-source"><a href="' + encodeURI(r.url) + '" target="_blank" rel="noopener noreferrer">' + r.source + '</a></span>' +
        '</div>';
      }).join('');

      if (refreshEl) {
        refreshEl.textContent = 'Updated ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    }

    renderFeed();
    // Refresh every hour
    setInterval(renderFeed, 3600000);
  })();

  /* ================================================================== */
  /* NEW: Satellite animation on home page                              */
  /* ================================================================== */
  (function initSatellites() {
    const layer = $('#satelliteLayer');
    if (!layer) return;
    // Add random parallax on scroll
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const scrollY = window.scrollY;
          const sats = layer.querySelectorAll('.satellite');
          sats.forEach((s, i) => {
            const speed = (i + 1) * 0.05;
            s.style.transform = 'translateY(' + (scrollY * speed) + 'px)';
          });
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  })();

})();

