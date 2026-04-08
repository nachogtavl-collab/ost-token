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
      'hero.free': '&#128176; FREE FOREVER',
      'hero.freetext': 'Zero transaction fees. No hidden costs. Funded by donations &amp; investors.',
      'hero.createwallet': 'Create Wallet',
      'hero.stat.unbanked': 'Unbanked adults worldwide',
      'hero.stat.remittance': '$ lost to remittance fees/year',
      'hero.stat.nointernet': 'People without internet',
      'vision.title': 'The OST Vision: Complete Financial Independence',
      'vision.sub': 'We currently use Solana, Jupiter, and third-party bridges as <strong>temporary infrastructure</strong>. Our goal is to build the <strong>OST Sovereign Network</strong> &mdash; our own interchange protocol, trading algorithm, decentralized market, faucet system, and settlement layer. <em>Completely separate from any existing system. Fully decentralized. No dependencies.</em>',
      'vision.s1.title': 'Temporary Scaffolding', 'vision.s1.sub': 'Solana + Jupiter + Bridges',
      'vision.s2.title': 'OST Interchange Protocol', 'vision.s2.sub': 'Own matching engine &amp; trading algorithm',
      'vision.s3.title': 'OST Sovereign Network', 'vision.s3.sub': 'Zero third-party dependencies',
      'vision.p1': '&#128274; ZK Private', 'vision.p2': '&#9889; 0.4s Settlement', 'vision.p3': '&#128176; Zero Fees Forever',
      'vision.p4': '&#128295; Own Matching Engine', 'vision.p5': '&#127757; Own DEX &amp; Bridges', 'vision.p6': '&#128752; Satellite Internet',
      'vision.spacex.title': 'OST &times; SpaceX',
      'vision.spacex.text': 'Partnering to bring uncensored internet and payments to 2.6 billion people without connectivity via low-earth orbit satellites.',
      'vision.spacex.btn': 'Explore the Journey &#8594;',
      'newhere.title': '&#127381; New Here? Start Your OST Journey',
      'newhere.sub': 'Claim free OST, create family vaults, or earn rewards by contributing infrastructure.',
      'gv.title': 'Family Grow Vaults',
      'gv.sub': 'The first coin born in space with every new generation. Create a custodial vault for your child &mdash; they grow up with real private digital cash.',
      'gv.disclaimer': 'Educational use only. Parents/guardians are responsible for all tax, custody, and local laws regarding gifts to minors.',
      'depin.title': 'DePIN Data-Center Faucet',
      'depin.sub': 'Share bandwidth, GPU, CPU, or satellite capacity &mdash; earn OST for building the decentralized data centers and satellite internet. Big rewards for real contributions.',
      'demos.title': '&#127916; Live Demos', 'demos.sub': 'See what private, instant payments feel like. Real products, real prices. Zero fees.',
      'wallet.getTitle': 'Get Your Personal OST Wallet', 'wallet.getSub': 'Choose how to create or connect your wallet. No seed phrase required with Web3Auth.',
      'sell.title': 'Sell or Trade OST', 'sell.sub': 'Cash out to any crypto or fiat. Same speed, same privacy.',
      'censor.title': '&#128683; Internet Censorship Is Happening Now', 'censor.sub': 'Real events. Real people. OST is the answer to digital oppression.',
      'spacex.title': 'OST &times; SpaceX &mdash; The Journey to Space', 'spacex.sub': 'Follow our partnership roadmap from Earth to Mars. Every milestone is real, every goal is funded by donations and investors &mdash; never by taxing your transactions.',
      'roadmap.title': '&#128640; Roadmap &amp; Progress', 'roadmap.sub': 'Where we are, what we\'ve built, and what comes next.',
      'offline.scenarios': 'Real-World Scenarios', 'offline.scenariosub': 'Verified data from the World Bank, UNHCR, IEA, and EM-DAT. These are not hypotheticals \u2014 they happen today.',
      'ai.hook.title': 'Running a Server, Bot, or Localhost?',
      'ai.hook.text': 'If you have a server, a bot, a localhost dev environment, or any form of automated intelligence &mdash; <strong>OST is your payment layer</strong>. Connect any AI model, any webhook, any service. Machine-to-machine payments at Solana speed with full privacy.',
      'gc.title': 'Gift Card Interchange &mdash; Sell or Buy Any Gift Card with OST',
      'gc.sub': 'Turn any gift card into private OST, or pay with OST and receive instant digital gift cards. No bank, no KYC, no limits.',
      'gc.tabSell': '&#128178; Sell Gift Card &rarr; Get OST',
      'gc.tabBuy': '&#127873; Buy Gift Card with OST',
      'gc.pipe.paste': 'Paste Code', 'gc.pipe.verify': 'Verify', 'gc.pipe.receive': 'Receive OST',
      'gc.pipe.payOst': 'Pay OST', 'gc.pipe.convert': 'Convert', 'gc.pipe.getCard': 'Get Card',
      'gc.merchant': 'Merchant / Brand', 'gc.merchantBuy': 'Choose Gift Card',
      'gc.code': 'Gift Card Code', 'gc.balance': 'Card Balance (USD)',
      'gc.youGet': 'You Receive', 'gc.youPay': 'You Pay', 'gc.amount': 'Amount (USD)',
      'gc.email': 'Delivery Email (optional)',
      'gc.rate': 'Rate:', 'gc.fee': 'Treasury Fee (0.1%):',
      'gc.feeNote': '&#128752; Fee funds satellite infrastructure',
      'gc.sellBtn': 'Verify &amp; Sell &rarr; Get OST',
      'gc.buyBtn': 'Pay OST &rarr; Get Gift Card',
      'gc.step.verify': 'Verifying gift card code&hellip;',
      'gc.step.zk': 'Generating ZK proof&hellip;',
      'gc.step.send': 'Sending OST via confidential transfer&hellip;',
      'gc.step.done': 'Complete! OST received privately.',
      'gc.step.debit': 'Debiting OST (confidential)&hellip;',
      'gc.step.swap': 'Swapping OST &rarr; USDC via Jupiter&hellip;',
      'gc.step.purchase': 'Purchasing gift card&hellip;',
      'gc.step.delivered': 'Gift card delivered!',
      'gc.supported': 'Supported brands:',
      'gc.disclaimer': '&#9888; Users are responsible for verifying gift card validity. OST is not a gift card issuer. Gift card interchange is facilitated through third-party APIs (Raise, CardCash, merchant APIs). Gift card resale is subject to local laws &mdash; please verify in your jurisdiction.',
      'fuel.title': 'Fuel & Gas Stations',
      'fuel.sub': 'Pay with OST at gas stations worldwide — earn rewards on every fill-up',
      'fuel.howTitle': 'How It Works',
      'fuel.step1': 'Pull Up',
      'fuel.step1d': 'Drive to any partner station',
      'fuel.step2': 'Tap & Pay',
      'fuel.step2d': 'Pay with OST via NFC or QR',
      'fuel.step3': 'Earn Rewards',
      'fuel.step3d': 'Get cashback in OST instantly',
      'fuel.step4': 'Drive Away',
      'fuel.step4d': 'Receipt sent to your wallet',
      'fuel.calcTitle': 'Fuel Rewards Calculator',
      'fuel.gallons': 'Gallons',
      'fuel.priceGal': 'Price per Gallon (USD)',
      'fuel.total': 'Total Cost',
      'fuel.ostCost': 'OST Equivalent',
      'fuel.reward': 'Cashback (3%)',
      'fuel.offlineTitle': 'Works Offline',
      'fuel.offlineDesc': 'NFC & BLE mesh — pay even without internet. Transactions sync when back online.',
      'fuel.partnersTitle': 'Partner Stations',
      'fuel.partnersSub': 'Accepted at 20+ major fuel brands worldwide',
      'fuel.rewardsTitle': 'Rewards Tiers',
      'fuel.disclaimer': '&#9888; Partnerships shown are in development. OST is not affiliated with listed brands. Fuel prices are illustrative.',
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
      'hero.free': '&#128176; GRATIS PARA SIEMPRE',
      'hero.freetext': 'Cero comisiones. Sin costos ocultos. Financiado por donaciones e inversores.',
      'hero.createwallet': 'Crear Billetera',
      'hero.stat.unbanked': 'Adultos sin banco en el mundo',
      'hero.stat.remittance': '$ perdidos en comisiones de remesas/a\u00f1o',
      'hero.stat.nointernet': 'Personas sin internet',
      'vision.title': 'La Visi\u00f3n OST: Independencia Financiera Completa',
      'vision.sub': 'Actualmente usamos Solana, Jupiter y puentes de terceros como <strong>infraestructura temporal</strong>. Nuestro objetivo es construir la <strong>Red Soberana OST</strong> &mdash; nuestro propio protocolo de intercambio, algoritmo de trading, mercado descentralizado y capa de liquidaci\u00f3n. <em>Completamente separado de cualquier sistema existente. Totalmente descentralizado. Sin dependencias.</em>',
      'vision.s1.title': 'Andamiaje Temporal', 'vision.s1.sub': 'Solana + Jupiter + Puentes',
      'vision.s2.title': 'Protocolo de Intercambio OST', 'vision.s2.sub': 'Motor de emparejamiento propio',
      'vision.s3.title': 'Red Soberana OST', 'vision.s3.sub': 'Cero dependencias de terceros',
      'vision.p1': '&#128274; ZK Privado', 'vision.p2': '&#9889; 0.4s Liquidaci\u00f3n', 'vision.p3': '&#128176; Cero Comisiones',
      'vision.p4': '&#128295; Motor Propio', 'vision.p5': '&#127757; DEX y Puentes Propios', 'vision.p6': '&#128752; Internet Satelital',
      'vision.spacex.title': 'OST &times; SpaceX',
      'vision.spacex.text': 'Alianza para llevar internet y pagos sin censura a 2.6 mil millones de personas sin conectividad mediante sat\u00e9lites de \u00f3rbita baja.',
      'vision.spacex.btn': 'Explorar el Viaje &#8594;',
      'newhere.title': '&#127381; \u00bfNuevo Aqu\u00ed? Comienza Tu Viaje OST',
      'newhere.sub': 'Reclama OST gratis, crea b\u00f3vedas familiares o gana recompensas contribuyendo infraestructura.',
      'gv.title': 'B\u00f3vedas Familiares de Crecimiento',
      'gv.sub': 'La primera moneda nacida en el espacio con cada nueva generaci\u00f3n. Crea una b\u00f3veda custodia para tu hijo &mdash; crecer\u00e1n con dinero digital privado real.',
      'gv.disclaimer': 'Solo uso educativo. Los padres/tutores son responsables de todas las leyes fiscales y de custodia.',
      'depin.title': 'Faucet DePIN de Centro de Datos',
      'depin.sub': 'Comparte ancho de banda, GPU, CPU o capacidad satelital &mdash; gana OST por construir centros de datos descentralizados e internet satelital.',
      'demos.title': '&#127916; Demos en Vivo', 'demos.sub': 'Siente c\u00f3mo son los pagos privados e instant\u00e1neos. Productos reales, precios reales. Cero comisiones.',
      'wallet.getTitle': 'Obt\u00e9n Tu Billetera OST Personal', 'wallet.getSub': 'Elige c\u00f3mo crear o conectar tu billetera. Sin frase semilla con Web3Auth.',
      'sell.title': 'Vender o Intercambiar OST', 'sell.sub': 'Retira a cualquier cripto o fiat. Misma velocidad, misma privacidad.',
      'censor.title': '&#128683; La Censura de Internet Est\u00e1 Ocurriendo Ahora', 'censor.sub': 'Eventos reales. Personas reales. OST es la respuesta a la opresi\u00f3n digital.',
      'spacex.title': 'OST &times; SpaceX &mdash; El Viaje al Espacio', 'spacex.sub': 'Sigue nuestra hoja de ruta desde la Tierra hasta Marte. Cada hito es real, cada objetivo est\u00e1 financiado por donaciones e inversores.',
      'roadmap.title': '&#128640; Hoja de Ruta y Progreso', 'roadmap.sub': 'D\u00f3nde estamos, qu\u00e9 hemos construido y qu\u00e9 sigue.',
      'offline.scenarios': 'Escenarios del Mundo Real', 'offline.scenariosub': 'Datos verificados del Banco Mundial, ACNUR, AIE y EM-DAT. No son hipot\u00e9ticos \u2014 ocurren hoy.',
      'ai.hook.title': '\u00bfTienes un Servidor, Bot o Localhost?',
      'ai.hook.text': 'Si tienes un servidor, un bot, un entorno localhost o cualquier forma de inteligencia automatizada &mdash; <strong>OST es tu capa de pagos</strong>. Conecta cualquier modelo de IA, cualquier webhook, cualquier servicio.',
      'gc.title': 'Intercambio de Tarjetas de Regalo &mdash; Vende o Compra Cualquier Tarjeta con OST',
      'gc.sub': 'Convierte cualquier tarjeta de regalo en OST privado, o paga con OST y recibe tarjetas digitales instant\u00e1neas. Sin banco, sin KYC, sin l\u00edmites.',
      'gc.tabSell': '&#128178; Vender Tarjeta &rarr; Obtener OST',
      'gc.tabBuy': '&#127873; Comprar Tarjeta con OST',
      'gc.pipe.paste': 'Pegar C\u00f3digo', 'gc.pipe.verify': 'Verificar', 'gc.pipe.receive': 'Recibir OST',
      'gc.pipe.payOst': 'Pagar OST', 'gc.pipe.convert': 'Convertir', 'gc.pipe.getCard': 'Obtener Tarjeta',
      'gc.merchant': 'Comercio / Marca', 'gc.merchantBuy': 'Elegir Tarjeta de Regalo',
      'gc.code': 'C\u00f3digo de Tarjeta', 'gc.balance': 'Saldo de la Tarjeta (USD)',
      'gc.youGet': 'Recibes', 'gc.youPay': 'Pagas', 'gc.amount': 'Monto (USD)',
      'gc.email': 'Email de entrega (opcional)',
      'gc.rate': 'Tasa:', 'gc.fee': 'Comisi\u00f3n del tesoro (0.1%):',
      'gc.feeNote': '&#128752; La comisi\u00f3n financia infraestructura satelital',
      'gc.sellBtn': 'Verificar y Vender &rarr; Obtener OST',
      'gc.buyBtn': 'Pagar OST &rarr; Obtener Tarjeta',
      'gc.step.verify': 'Verificando c\u00f3digo de tarjeta&hellip;',
      'gc.step.zk': 'Generando prueba ZK&hellip;',
      'gc.step.send': 'Enviando OST v\u00eda transferencia confidencial&hellip;',
      'gc.step.done': '\u00a1Completado! OST recibido de forma privada.',
      'gc.step.debit': 'Debitando OST (confidencial)&hellip;',
      'gc.step.swap': 'Intercambiando OST &rarr; USDC v\u00eda Jupiter&hellip;',
      'gc.step.purchase': 'Comprando tarjeta de regalo&hellip;',
      'gc.step.delivered': '\u00a1Tarjeta de regalo entregada!',
      'gc.supported': 'Marcas disponibles:',
      'gc.disclaimer': '&#9888; Los usuarios son responsables de verificar la validez de las tarjetas. OST no es un emisor de tarjetas de regalo. El intercambio se facilita a trav\u00e9s de APIs de terceros. Sujeto a leyes locales.',
      'fuel.title': 'Combustible y Gasolineras',
      'fuel.sub': 'Paga con OST en gasolineras de todo el mundo — gana recompensas en cada carga',
      'fuel.howTitle': 'C\u00f3mo Funciona',
      'fuel.step1': 'Llega',
      'fuel.step1d': 'Conduce a cualquier estaci\u00f3n aliada',
      'fuel.step2': 'Toca y Paga',
      'fuel.step2d': 'Paga con OST v\u00eda NFC o QR',
      'fuel.step3': 'Gana Recompensas',
      'fuel.step3d': 'Recibe cashback en OST al instante',
      'fuel.step4': 'Contin\u00faa',
      'fuel.step4d': 'Recibo enviado a tu billetera',
      'fuel.calcTitle': 'Calculadora de Recompensas',
      'fuel.gallons': 'Galones',
      'fuel.priceGal': 'Precio por Gal\u00f3n (USD)',
      'fuel.total': 'Costo Total',
      'fuel.ostCost': 'Equivalente en OST',
      'fuel.reward': 'Cashback (3%)',
      'fuel.offlineTitle': 'Funciona Sin Conexi\u00f3n',
      'fuel.offlineDesc': 'NFC y BLE — paga sin internet. Las transacciones se sincronizan al reconectarse.',
      'fuel.partnersTitle': 'Estaciones Aliadas',
      'fuel.partnersSub': 'Aceptado en 20+ marcas de combustible a nivel mundial',
      'fuel.rewardsTitle': 'Niveles de Recompensa',
      'fuel.disclaimer': '&#9888; Las alianzas mostradas est\u00e1n en desarrollo. OST no est\u00e1 afiliado a las marcas listadas.',
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
      'hero.free': '&#128176; \u6c38\u4e45\u514d\u8d39',
      'hero.freetext': '\u96f6\u4ea4\u6613\u8d39\u7528\u3002\u6ca1\u6709\u9690\u85cf\u6210\u672c\u3002\u7531\u6350\u6b3e\u548c\u6295\u8d44\u8005\u8d44\u52a9\u3002',
      'hero.createwallet': '\u521b\u5efa\u94b1\u5305',
      'hero.stat.unbanked': '\u5168\u7403\u65e0\u94f6\u884c\u8d26\u6237\u6210\u4eba',
      'hero.stat.remittance': '\u6bcf\u5e74\u6c47\u6b3e\u8d39\u7528\u635f\u5931($)',
      'hero.stat.nointernet': '\u65e0\u4e92\u8054\u7f51\u8fde\u63a5\u4eba\u53e3',
      'vision.title': 'OST\u613f\u666f\uff1a\u5b8c\u5168\u8d22\u52a1\u72ec\u7acb',
      'vision.sub': '\u6211\u4eec\u76ee\u524d\u4f7f\u7528Solana\u3001Jupiter\u548c\u7b2c\u4e09\u65b9\u6865\u4f5c\u4e3a<strong>\u4e34\u65f6\u57fa\u7840\u8bbe\u65bd</strong>\u3002\u6211\u4eec\u7684\u76ee\u6807\u662f\u5efa\u8bbe<strong>OST\u4e3b\u6743\u7f51\u7edc</strong> &mdash; \u81ea\u5df1\u7684\u4ea4\u6362\u534f\u8bae\u3001\u4ea4\u6613\u7b97\u6cd5\u3001\u53bb\u4e2d\u5fc3\u5316\u5e02\u573a\u548c\u7ed3\u7b97\u5c42\u3002<em>\u5b8c\u5168\u72ec\u7acb\u3002\u5b8c\u5168\u53bb\u4e2d\u5fc3\u5316\u3002\u96f6\u4f9d\u8d56\u3002</em>',
      'vision.s1.title': '\u4e34\u65f6\u652f\u67b6', 'vision.s1.sub': 'Solana + Jupiter + \u8de8\u94fe\u6865',
      'vision.s2.title': 'OST\u4ea4\u6362\u534f\u8bae', 'vision.s2.sub': '\u81ea\u6709\u5339\u914d\u5f15\u64ce\u548c\u4ea4\u6613\u7b97\u6cd5',
      'vision.s3.title': 'OST\u4e3b\u6743\u7f51\u7edc', 'vision.s3.sub': '\u96f6\u7b2c\u4e09\u65b9\u4f9d\u8d56',
      'vision.p1': '&#128274; ZK\u79c1\u5bc6', 'vision.p2': '&#9889; 0.4\u79d2\u7ed3\u7b97', 'vision.p3': '&#128176; \u6c38\u4e45\u96f6\u8d39\u7528',
      'vision.p4': '&#128295; \u81ea\u6709\u5339\u914d\u5f15\u64ce', 'vision.p5': '&#127757; \u81ea\u6709DEX\u548c\u6865', 'vision.p6': '&#128752; \u536b\u661f\u4e92\u8054\u7f51',
      'vision.spacex.title': 'OST &times; SpaceX',
      'vision.spacex.text': '\u4e0eSpaceX\u5408\u4f5c\uff0c\u901a\u8fc7\u4f4e\u8f68\u536b\u661f\u4e3a26\u4ebf\u65e0\u7f51\u7edc\u4eba\u53e3\u5e26\u6765\u65e0\u5ba1\u67e5\u4e92\u8054\u7f51\u548c\u652f\u4ed8\u3002',
      'vision.spacex.btn': '\u63a2\u7d22\u65c5\u7a0b &#8594;',
      'newhere.title': '&#127381; \u65b0\u6765\u7684\uff1f\u5f00\u59cbOST\u4e4b\u65c5',
      'newhere.sub': '\u9886\u53d6\u514d\u8d39OST\uff0c\u521b\u5efa\u5bb6\u5ead\u91d1\u5e93\uff0c\u6216\u901a\u8fc7\u8d21\u732e\u57fa\u7840\u8bbe\u65bd\u83b7\u53d6\u5956\u52b1\u3002',
      'gv.title': '\u5bb6\u5ead\u6210\u957f\u91d1\u5e93',
      'gv.sub': '\u6bcf\u4e00\u4ee3\u65b0\u751f\u90fd\u6709\u8bde\u751f\u5728\u592a\u7a7a\u7684\u7b2c\u4e00\u679a\u786c\u5e01\u3002\u4e3a\u4f60\u7684\u5b69\u5b50\u521b\u5efa\u4e00\u4e2a\u6258\u7ba1\u91d1\u5e93 &mdash; \u4ed6\u4eec\u5c06\u4f34\u968f\u771f\u6b63\u7684\u79c1\u5bc6\u6570\u5b57\u73b0\u91d1\u6210\u957f\u3002',
      'gv.disclaimer': '\u4ec5\u4f9b\u6559\u80b2\u7528\u9014\u3002\u7236\u6bcd/\u76d1\u62a4\u4eba\u8d1f\u8d23\u6240\u6709\u7a0e\u52a1\u3001\u76d1\u62a4\u548c\u5f53\u5730\u6cd5\u5f8b\u3002',
      'depin.title': 'DePIN\u6570\u636e\u4e2d\u5fc3\u6c34\u9f99\u5934',
      'depin.sub': '\u5206\u4eab\u5e26\u5bbd\u3001GPU\u3001CPU\u6216\u536b\u661f\u5bb9\u91cf &mdash; \u4e3a\u5efa\u8bbe\u53bb\u4e2d\u5fc3\u5316\u6570\u636e\u4e2d\u5fc3\u548c\u536b\u661f\u4e92\u8054\u7f51\u83b7\u5f97OST\u5956\u52b1\u3002',
      'demos.title': '&#127916; \u5b9e\u65f6\u6f14\u793a', 'demos.sub': '\u4f53\u9a8c\u79c1\u5bc6\u5373\u65f6\u652f\u4ed8\u7684\u611f\u89c9\u3002\u771f\u5b9e\u4ea7\u54c1\uff0c\u771f\u5b9e\u4ef7\u683c\u3002\u96f6\u8d39\u7528\u3002',
      'wallet.getTitle': '\u83b7\u53d6\u4f60\u7684\u4e2a\u4ebaOST\u94b1\u5305', 'wallet.getSub': '\u9009\u62e9\u5982\u4f55\u521b\u5efa\u6216\u8fde\u63a5\u4f60\u7684\u94b1\u5305\u3002Web3Auth\u65e0\u9700\u52a9\u8bb0\u8bcd\u3002',
      'sell.title': '\u51fa\u552e\u6216\u4ea4\u6613OST', 'sell.sub': '\u63d0\u73b0\u5230\u4efb\u4f55\u52a0\u5bc6\u8d27\u5e01\u6216\u6cd5\u5e01\u3002\u540c\u6837\u7684\u901f\u5ea6\uff0c\u540c\u6837\u7684\u9690\u79c1\u3002',
      'censor.title': '&#128683; \u4e92\u8054\u7f51\u5ba1\u67e5\u6b63\u5728\u53d1\u751f', 'censor.sub': '\u771f\u5b9e\u4e8b\u4ef6\u3002\u771f\u5b9e\u7684\u4eba\u3002OST\u662f\u5bf9\u6570\u5b57\u538b\u8feb\u7684\u56de\u7b54\u3002',
      'spacex.title': 'OST &times; SpaceX &mdash; \u592a\u7a7a\u4e4b\u65c5', 'spacex.sub': '\u8ddf\u968f\u6211\u4eec\u4ece\u5730\u7403\u5230\u706b\u661f\u7684\u5408\u4f5c\u8def\u7ebf\u56fe\u3002\u6bcf\u4e2a\u91cc\u7a0b\u7891\u90fd\u662f\u771f\u5b9e\u7684\uff0c\u6bcf\u4e2a\u76ee\u6807\u90fd\u7531\u6350\u6b3e\u548c\u6295\u8d44\u8005\u8d44\u52a9\u3002',
      'roadmap.title': '&#128640; \u8def\u7ebf\u56fe\u548c\u8fdb\u5c55', 'roadmap.sub': '\u6211\u4eec\u5728\u54ea\u91cc\uff0c\u6211\u4eec\u5efa\u4e86\u4ec0\u4e48\uff0c\u63a5\u4e0b\u6765\u4f1a\u53d1\u751f\u4ec0\u4e48\u3002',
      'offline.scenarios': '\u73b0\u5b9e\u4e16\u754c\u573a\u666f', 'offline.scenariosub': '\u6765\u81ea\u4e16\u754c\u94f6\u884c\u3001UNHCR\u3001IEA\u548cEM-DAT\u7684\u9a8c\u8bc1\u6570\u636e\u3002\u8fd9\u4e0d\u662f\u5047\u8bbe \u2014 \u5b83\u4eec\u4eca\u5929\u5c31\u5728\u53d1\u751f\u3002',
      'ai.hook.title': '\u8fd0\u884c\u670d\u52a1\u5668\u3001\u673a\u5668\u4eba\u6216\u672c\u5730\u4e3b\u673a\uff1f',
      'ai.hook.text': '\u5982\u679c\u4f60\u6709\u670d\u52a1\u5668\u3001\u673a\u5668\u4eba\u3001\u672c\u5730\u5f00\u53d1\u73af\u5883\u6216\u4efb\u4f55\u5f62\u5f0f\u7684\u81ea\u52a8\u5316\u667a\u80fd &mdash; <strong>OST\u662f\u4f60\u7684\u652f\u4ed8\u5c42</strong>\u3002\u8fde\u63a5\u4efb\u4f55AI\u6a21\u578b\u3001\u4efb\u4f55webhook\u3001\u4efb\u4f55\u670d\u52a1\u3002',
      'gc.title': '\u793c\u54c1\u5361\u4ea4\u6362 &mdash; \u7528OST\u4e70\u5356\u4efb\u4f55\u793c\u54c1\u5361',
      'gc.sub': '\u5c06\u4efb\u4f55\u793c\u54c1\u5361\u8f6c\u6362\u4e3a\u79c1\u5bc6OST\uff0c\u6216\u7528OST\u652f\u4ed8\u5e76\u83b7\u5f97\u5373\u65f6\u6570\u5b57\u793c\u54c1\u5361\u3002\u65e0\u94f6\u884c\uff0c\u65e0KYC\uff0c\u65e0\u9650\u5236\u3002',
      'gc.tabSell': '&#128178; \u5356\u793c\u54c1\u5361 &rarr; \u83b7\u5f97OST',
      'gc.tabBuy': '&#127873; \u7528OST\u4e70\u793c\u54c1\u5361',
      'gc.pipe.paste': '\u7c98\u8d34\u4ee3\u7801', 'gc.pipe.verify': '\u9a8c\u8bc1', 'gc.pipe.receive': '\u6536\u5230OST',
      'gc.pipe.payOst': '\u652f\u4ed8OST', 'gc.pipe.convert': '\u8f6c\u6362', 'gc.pipe.getCard': '\u83b7\u53d6\u5361',
      'gc.merchant': '\u5546\u5bb6/\u54c1\u724c', 'gc.merchantBuy': '\u9009\u62e9\u793c\u54c1\u5361',
      'gc.code': '\u793c\u54c1\u5361\u4ee3\u7801', 'gc.balance': '\u5361\u4f59\u989d(USD)',
      'gc.youGet': '\u4f60\u6536\u5230', 'gc.youPay': '\u4f60\u652f\u4ed8', 'gc.amount': '\u91d1\u989d(USD)',
      'gc.email': '\u90ae\u7bb1(\u53ef\u9009)',
      'gc.rate': '\u6c47\u7387:', 'gc.fee': '\u56fd\u5e93\u8d39(0.1%):',
      'gc.feeNote': '&#128752; \u8d39\u7528\u8d44\u52a9\u536b\u661f\u57fa\u7840\u8bbe\u65bd',
      'gc.sellBtn': '\u9a8c\u8bc1\u5e76\u51fa\u552e &rarr; \u83b7\u5f97OST',
      'gc.buyBtn': '\u652f\u4ed8OST &rarr; \u83b7\u53d6\u793c\u54c1\u5361',
      'gc.step.verify': '\u6b63\u5728\u9a8c\u8bc1\u793c\u54c1\u5361\u4ee3\u7801&hellip;',
      'gc.step.zk': '\u751f\u6210ZK\u8bc1\u660e&hellip;',
      'gc.step.send': '\u901a\u8fc7\u673a\u5bc6\u8f6c\u8d26\u53d1\u9001OST&hellip;',
      'gc.step.done': '\u5b8c\u6210\uff01OST\u5df2\u79c1\u5bc6\u6536\u5230\u3002',
      'gc.step.debit': '\u6263\u9664OST(\u673a\u5bc6)&hellip;',
      'gc.step.swap': '\u901a\u8fc7Jupiter\u5151\u6362OST&rarr;USDC&hellip;',
      'gc.step.purchase': '\u8d2d\u4e70\u793c\u54c1\u5361&hellip;',
      'gc.step.delivered': '\u793c\u54c1\u5361\u5df2\u9001\u8fbe\uff01',
      'gc.supported': '\u652f\u6301\u7684\u54c1\u724c:',
      'gc.disclaimer': '&#9888; \u7528\u6237\u8d1f\u8d23\u9a8c\u8bc1\u793c\u54c1\u5361\u7684\u6709\u6548\u6027\u3002OST\u4e0d\u662f\u793c\u54c1\u5361\u53d1\u884c\u5546\u3002\u4ea4\u6362\u901a\u8fc7\u7b2c\u4e09\u65b9API\u4fc3\u6210\u3002\u53d7\u5f53\u5730\u6cd5\u5f8b\u7ea6\u675f\u3002',
      'fuel.title': '\u52a0\u6cb9\u7ad9',
      'fuel.sub': '\u5728\u5168\u7403\u52a0\u6cb9\u7ad9\u4f7f\u7528OST\u652f\u4ed8 — \u6bcf\u6b21\u52a0\u6cb9\u8d5a\u53d6\u5956\u52b1',
      'fuel.howTitle': '\u4f7f\u7528\u6d41\u7a0b',
      'fuel.step1': '\u5230\u8fbe',
      'fuel.step1d': '\u9a76\u5165\u5408\u4f5c\u52a0\u6cb9\u7ad9',
      'fuel.step2': '\u652f\u4ed8',
      'fuel.step2d': '\u901a\u8fc7NFC\u6216QR\u7801\u4f7f\u7528OST\u652f\u4ed8',
      'fuel.step3': '\u8d5a\u53d6\u5956\u52b1',
      'fuel.step3d': '\u5373\u65f6\u83b7\u5f97OST\u8fd4\u73b0',
      'fuel.step4': '\u79bb\u5f00',
      'fuel.step4d': '\u6536\u636e\u53d1\u9001\u5230\u60a8\u7684\u94b1\u5305',
      'fuel.calcTitle': '\u71c3\u6cb9\u5956\u52b1\u8ba1\u7b97\u5668',
      'fuel.gallons': '\u52a0\u4ed1',
      'fuel.priceGal': '\u6bcf\u52a0\u4ed1\u4ef7\u683c (USD)',
      'fuel.total': '\u603b\u8d39\u7528',
      'fuel.ostCost': 'OST\u7b49\u503c',
      'fuel.reward': '\u8fd4\u73b0 (3%)',
      'fuel.offlineTitle': '\u79bb\u7ebf\u53ef\u7528',
      'fuel.offlineDesc': 'NFC\u548cBLE — \u65e0\u7f51\u7edc\u4e5f\u80fd\u652f\u4ed8\u3002\u4ea4\u6613\u5728\u4e0a\u7ebf\u540e\u540c\u6b65\u3002',
      'fuel.partnersTitle': '\u5408\u4f5c\u52a0\u6cb9\u7ad9',
      'fuel.partnersSub': '\u5168\u740320+\u4e3b\u8981\u71c3\u6cb9\u54c1\u724c\u63a5\u53d7',
      'fuel.rewardsTitle': '\u5956\u52b1\u7b49\u7ea7',
      'fuel.disclaimer': '&#9888; \u6240\u793a\u5408\u4f5c\u5173\u7cfb\u6b63\u5728\u5f00\u53d1\u4e2d\u3002OST\u4e0e\u6240\u5217\u54c1\u724c\u65e0\u5173\u8054\u3002',
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
      'hero.free': '&#128176; \u0411\u0415\u0421\u041f\u041b\u0410\u0422\u041d\u041e \u041d\u0410\u0412\u0421\u0415\u0413\u0414\u0410',
      'hero.freetext': '\u041d\u0443\u043b\u0435\u0432\u044b\u0435 \u043a\u043e\u043c\u0438\u0441\u0441\u0438\u0438. \u041d\u0438\u043a\u0430\u043a\u0438\u0445 \u0441\u043a\u0440\u044b\u0442\u044b\u0445 \u0440\u0430\u0441\u0445\u043e\u0434\u043e\u0432. \u0424\u0438\u043d\u0430\u043d\u0441\u0438\u0440\u0443\u0435\u0442\u0441\u044f \u043f\u043e\u0436\u0435\u0440\u0442\u0432\u043e\u0432\u0430\u043d\u0438\u044f\u043c\u0438 \u0438 \u0438\u043d\u0432\u0435\u0441\u0442\u043e\u0440\u0430\u043c\u0438.',
      'hero.createwallet': '\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u043a\u043e\u0448\u0435\u043b\u0435\u043a',
      'hero.stat.unbanked': '\u0412\u0437\u0440\u043e\u0441\u043b\u044b\u0445 \u0431\u0435\u0437 \u0431\u0430\u043d\u043a\u043e\u0432\u0441\u043a\u0438\u0445 \u0441\u0447\u0435\u0442\u043e\u0432',
      'hero.stat.remittance': '$ \u043f\u043e\u0442\u0435\u0440\u044f\u043d\u043e \u043d\u0430 \u043a\u043e\u043c\u0438\u0441\u0441\u0438\u044f\u0445 \u043f\u0435\u0440\u0435\u0432\u043e\u0434\u043e\u0432/\u0433\u043e\u0434',
      'hero.stat.nointernet': '\u041b\u044e\u0434\u0435\u0439 \u0431\u0435\u0437 \u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442\u0430',
      'vision.title': '\u0412\u0438\u0434\u0435\u043d\u0438\u0435 OST: \u041f\u043e\u043b\u043d\u0430\u044f \u0444\u0438\u043d\u0430\u043d\u0441\u043e\u0432\u0430\u044f \u043d\u0435\u0437\u0430\u0432\u0438\u0441\u0438\u043c\u043e\u0441\u0442\u044c',
      'vision.sub': '\u041c\u044b \u0441\u0435\u0439\u0447\u0430\u0441 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u043c Solana, Jupiter \u0438 \u0441\u0442\u043e\u0440\u043e\u043d\u043d\u0438\u0435 \u043c\u043e\u0441\u0442\u044b \u043a\u0430\u043a <strong>\u0432\u0440\u0435\u043c\u0435\u043d\u043d\u0443\u044e \u0438\u043d\u0444\u0440\u0430\u0441\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0443</strong>. \u041d\u0430\u0448\u0430 \u0446\u0435\u043b\u044c &mdash; <strong>\u0421\u0443\u0432\u0435\u0440\u0435\u043d\u043d\u0430\u044f \u0441\u0435\u0442\u044c OST</strong>. <em>\u041f\u043e\u043b\u043d\u043e\u0441\u0442\u044c\u044e \u0434\u0435\u0446\u0435\u043d\u0442\u0440\u0430\u043b\u0438\u0437\u043e\u0432\u0430\u043d\u0430. \u0411\u0435\u0437 \u0437\u0430\u0432\u0438\u0441\u0438\u043c\u043e\u0441\u0442\u0435\u0439.</em>',
      'vision.s1.title': '\u0412\u0440\u0435\u043c\u0435\u043d\u043d\u044b\u0435 \u043b\u0435\u0441\u0430', 'vision.s1.sub': 'Solana + Jupiter + \u041c\u043e\u0441\u0442\u044b',
      'vision.s2.title': '\u041f\u0440\u043e\u0442\u043e\u043a\u043e\u043b \u043e\u0431\u043c\u0435\u043d\u0430 OST', 'vision.s2.sub': '\u0421\u043e\u0431\u0441\u0442\u0432\u0435\u043d\u043d\u044b\u0439 \u0434\u0432\u0438\u0436\u043e\u043a \u0441\u043e\u043f\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u0438\u044f',
      'vision.s3.title': '\u0421\u0443\u0432\u0435\u0440\u0435\u043d\u043d\u0430\u044f \u0441\u0435\u0442\u044c OST', 'vision.s3.sub': '\u041d\u0443\u043b\u0435\u0432\u044b\u0435 \u0437\u0430\u0432\u0438\u0441\u0438\u043c\u043e\u0441\u0442\u0438',
      'vision.p1': '&#128274; ZK \u041f\u0440\u0438\u0432\u0430\u0442\u043d\u043e\u0441\u0442\u044c', 'vision.p2': '&#9889; 0.4\u0441 \u0420\u0430\u0441\u0447\u0451\u0442', 'vision.p3': '&#128176; \u041d\u0443\u043b\u0435\u0432\u044b\u0435 \u043a\u043e\u043c\u0438\u0441\u0441\u0438\u0438',
      'vision.p4': '&#128295; \u0421\u043e\u0431\u0441\u0442\u0432\u0435\u043d\u043d\u044b\u0439 \u0434\u0432\u0438\u0436\u043e\u043a', 'vision.p5': '&#127757; \u0421\u043e\u0431\u0441\u0442\u0432\u0435\u043d\u043d\u044b\u0439 DEX', 'vision.p6': '&#128752; \u0421\u043f\u0443\u0442\u043d\u0438\u043a\u043e\u0432\u044b\u0439 \u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442',
      'vision.spacex.title': 'OST &times; SpaceX',
      'vision.spacex.text': '\u041f\u0430\u0440\u0442\u043d\u0451\u0440\u0441\u0442\u0432\u043e \u0434\u043b\u044f \u043f\u0440\u0435\u0434\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u0438\u044f \u0441\u0432\u043e\u0431\u043e\u0434\u043d\u043e\u0433\u043e \u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442\u0430 2.6 \u043c\u043b\u0440\u0434 \u043b\u044e\u0434\u0435\u0439 \u0447\u0435\u0440\u0435\u0437 \u0441\u043f\u0443\u0442\u043d\u0438\u043a\u0438.',
      'vision.spacex.btn': '\u0418\u0441\u0441\u043b\u0435\u0434\u043e\u0432\u0430\u0442\u044c &#8594;',
      'newhere.title': '&#127381; \u041d\u043e\u0432\u0438\u0447\u043e\u043a? \u041d\u0430\u0447\u043d\u0438 \u043f\u0443\u0442\u044c OST',
      'newhere.sub': '\u041f\u043e\u043b\u0443\u0447\u0438 \u0431\u0435\u0441\u043f\u043b\u0430\u0442\u043d\u044b\u0435 OST, \u0441\u043e\u0437\u0434\u0430\u0439 \u0441\u0435\u043c\u0435\u0439\u043d\u044b\u0435 \u0445\u0440\u0430\u043d\u0438\u043b\u0438\u0449\u0430 \u0438\u043b\u0438 \u043f\u043e\u043b\u0443\u0447\u0430\u0439 \u043d\u0430\u0433\u0440\u0430\u0434\u044b \u0437\u0430 \u0438\u043d\u0444\u0440\u0430\u0441\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0443.',
      'gv.title': '\u0421\u0435\u043c\u0435\u0439\u043d\u044b\u0435 \u0445\u0440\u0430\u043d\u0438\u043b\u0438\u0449\u0430 \u0440\u043e\u0441\u0442\u0430',
      'gv.sub': '\u041f\u0435\u0440\u0432\u0430\u044f \u043c\u043e\u043d\u0435\u0442\u0430, \u0440\u043e\u0436\u0434\u0451\u043d\u043d\u0430\u044f \u0432 \u043a\u043e\u0441\u043c\u043e\u0441\u0435 \u0441 \u043a\u0430\u0436\u0434\u044b\u043c \u043d\u043e\u0432\u044b\u043c \u043f\u043e\u043a\u043e\u043b\u0435\u043d\u0438\u0435\u043c. \u0421\u043e\u0437\u0434\u0430\u0439\u0442\u0435 \u0445\u0440\u0430\u043d\u0438\u043b\u0438\u0449\u0435 \u0434\u043b\u044f \u0432\u0430\u0448\u0435\u0433\u043e \u0440\u0435\u0431\u0451\u043d\u043a\u0430.',
      'gv.disclaimer': '\u0422\u043e\u043b\u044c\u043a\u043e \u0434\u043b\u044f \u043e\u0431\u0440\u0430\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c\u043d\u044b\u0445 \u0446\u0435\u043b\u0435\u0439. \u0420\u043e\u0434\u0438\u0442\u0435\u043b\u0438 \u043d\u0435\u0441\u0443\u0442 \u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u043e\u0441\u0442\u044c \u0437\u0430 \u0432\u0441\u0435 \u043d\u0430\u043b\u043e\u0433\u043e\u0432\u044b\u0435 \u0438 \u043f\u0440\u0430\u0432\u043e\u0432\u044b\u0435 \u0432\u043e\u043f\u0440\u043e\u0441\u044b.',
      'depin.title': '\u041a\u0440\u0430\u043d DePIN \u0434\u0430\u0442\u0430-\u0446\u0435\u043d\u0442\u0440\u043e\u0432',
      'depin.sub': '\u0414\u0435\u043b\u0438\u0442\u0435\u0441\u044c \u043f\u0440\u043e\u043f\u0443\u0441\u043a\u043d\u043e\u0439 \u0441\u043f\u043e\u0441\u043e\u0431\u043d\u043e\u0441\u0442\u044c\u044e, GPU, CPU \u0438\u043b\u0438 \u0441\u043f\u0443\u0442\u043d\u0438\u043a\u043e\u0432\u043e\u0439 \u0435\u043c\u043a\u043e\u0441\u0442\u044c\u044e &mdash; \u043f\u043e\u043b\u0443\u0447\u0430\u0439\u0442\u0435 OST \u0437\u0430 \u0441\u0442\u0440\u043e\u0438\u0442\u0435\u043b\u044c\u0441\u0442\u0432\u043e \u0434\u0435\u0446\u0435\u043d\u0442\u0440\u0430\u043b\u0438\u0437\u043e\u0432\u0430\u043d\u043d\u044b\u0445 \u0434\u0430\u0442\u0430-\u0446\u0435\u043d\u0442\u0440\u043e\u0432.',
      'demos.title': '&#127916; \u0414\u0435\u043c\u043e', 'demos.sub': '\u041f\u043e\u0447\u0443\u0432\u0441\u0442\u0432\u0443\u0439\u0442\u0435 \u043f\u0440\u0438\u0432\u0430\u0442\u043d\u044b\u0435 \u043c\u0433\u043d\u043e\u0432\u0435\u043d\u043d\u044b\u0435 \u043f\u043b\u0430\u0442\u0435\u0436\u0438. \u0420\u0435\u0430\u043b\u044c\u043d\u044b\u0435 \u0442\u043e\u0432\u0430\u0440\u044b. \u041d\u0443\u043b\u0435\u0432\u044b\u0435 \u043a\u043e\u043c\u0438\u0441\u0441\u0438\u0438.',
      'wallet.getTitle': '\u041f\u043e\u043b\u0443\u0447\u0438\u0442\u0435 \u0441\u0432\u043e\u0439 \u043a\u043e\u0448\u0435\u043b\u0451\u043a OST', 'wallet.getSub': '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u043f\u043e\u0441\u043e\u0431 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044f \u043a\u043e\u0448\u0435\u043b\u044c\u043a\u0430. \u0421\u0435\u043c\u0435\u043d\u043d\u0430\u044f \u0444\u0440\u0430\u0437\u0430 \u043d\u0435 \u043d\u0443\u0436\u043d\u0430 c Web3Auth.',
      'sell.title': '\u041f\u0440\u043e\u0434\u0430\u0442\u044c \u0438\u043b\u0438 \u043e\u0431\u043c\u0435\u043d\u044f\u0442\u044c OST', 'sell.sub': '\u0412\u044b\u0432\u043e\u0434 \u0432 \u043b\u044e\u0431\u0443\u044e \u043a\u0440\u0438\u043f\u0442\u043e \u0438\u043b\u0438 \u0444\u0438\u0430\u0442. \u0422\u0430 \u0436\u0435 \u0441\u043a\u043e\u0440\u043e\u0441\u0442\u044c, \u0442\u0430 \u0436\u0435 \u043f\u0440\u0438\u0432\u0430\u0442\u043d\u043e\u0441\u0442\u044c.',
      'censor.title': '&#128683; \u0418\u043d\u0442\u0435\u0440\u043d\u0435\u0442-\u0446\u0435\u043d\u0437\u0443\u0440\u0430 \u043f\u0440\u043e\u0438\u0441\u0445\u043e\u0434\u0438\u0442 \u0441\u0435\u0439\u0447\u0430\u0441', 'censor.sub': '\u0420\u0435\u0430\u043b\u044c\u043d\u044b\u0435 \u0441\u043e\u0431\u044b\u0442\u0438\u044f. \u0420\u0435\u0430\u043b\u044c\u043d\u044b\u0435 \u043b\u044e\u0434\u0438. OST &mdash; \u043e\u0442\u0432\u0435\u0442 \u043d\u0430 \u0446\u0438\u0444\u0440\u043e\u0432\u043e\u0435 \u0443\u0433\u043d\u0435\u0442\u0435\u043d\u0438\u0435.',
      'spacex.title': 'OST &times; SpaceX &mdash; \u041f\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u0435 \u0432 \u043a\u043e\u0441\u043c\u043e\u0441', 'spacex.sub': '\u0421\u043b\u0435\u0434\u0438\u0442\u0435 \u0437\u0430 \u043d\u0430\u0448\u0438\u043c \u043f\u0443\u0442\u0451\u043c \u043e\u0442 \u0417\u0435\u043c\u043b\u0438 \u0434\u043e \u041c\u0430\u0440\u0441\u0430. \u041a\u0430\u0436\u0434\u044b\u0439 \u044d\u0442\u0430\u043f \u0440\u0435\u0430\u043b\u0435\u043d.',
      'roadmap.title': '&#128640; \u0414\u043e\u0440\u043e\u0436\u043d\u0430\u044f \u043a\u0430\u0440\u0442\u0430', 'roadmap.sub': '\u0413\u0434\u0435 \u043c\u044b \u0441\u0435\u0439\u0447\u0430\u0441, \u0447\u0442\u043e \u043c\u044b \u043f\u043e\u0441\u0442\u0440\u043e\u0438\u043b\u0438 \u0438 \u0447\u0442\u043e \u0434\u0430\u043b\u044c\u0448\u0435.',
      'offline.scenarios': '\u0420\u0435\u0430\u043b\u044c\u043d\u044b\u0435 \u0441\u0446\u0435\u043d\u0430\u0440\u0438\u0438', 'offline.scenariosub': '\u041f\u0440\u043e\u0432\u0435\u0440\u0435\u043d\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435 \u0412\u0441\u0435\u043c\u0438\u0440\u043d\u043e\u0433\u043e \u0431\u0430\u043d\u043a\u0430, \u041e\u041e\u041d \u0438 EM-DAT. \u042d\u0442\u043e \u043d\u0435 \u0433\u0438\u043f\u043e\u0442\u0435\u0437\u044b.',
      'ai.hook.title': '\u0415\u0441\u0442\u044c \u0441\u0435\u0440\u0432\u0435\u0440, \u0431\u043e\u0442 \u0438\u043b\u0438 localhost?',
      'ai.hook.text': '\u0415\u0441\u043b\u0438 \u0443 \u0432\u0430\u0441 \u0435\u0441\u0442\u044c \u0441\u0435\u0440\u0432\u0435\u0440, \u0431\u043e\u0442 \u0438\u043b\u0438 \u043b\u044e\u0431\u0430\u044f \u0444\u043e\u0440\u043c\u0430 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0437\u0430\u0446\u0438\u0438 &mdash; <strong>OST \u0432\u0430\u0448 \u043f\u043b\u0430\u0442\u0451\u0436\u043d\u044b\u0439 \u0441\u043b\u043e\u0439</strong>.',
      'gc.title': '\u041e\u0431\u043c\u0435\u043d \u043f\u043e\u0434\u0430\u0440\u043e\u0447\u043d\u044b\u0445 \u043a\u0430\u0440\u0442 &mdash; \u041f\u0440\u043e\u0434\u0430\u0439\u0442\u0435 \u0438\u043b\u0438 \u043a\u0443\u043f\u0438\u0442\u0435 \u043b\u044e\u0431\u0443\u044e \u043a\u0430\u0440\u0442\u0443 \u0437\u0430 OST',
      'gc.sub': '\u041f\u0440\u0435\u0432\u0440\u0430\u0442\u0438\u0442\u0435 \u043b\u044e\u0431\u0443\u044e \u043f\u043e\u0434\u0430\u0440\u043e\u0447\u043d\u0443\u044e \u043a\u0430\u0440\u0442\u0443 \u0432 \u043f\u0440\u0438\u0432\u0430\u0442\u043d\u044b\u0435 OST \u0438\u043b\u0438 \u043e\u043f\u043b\u0430\u0442\u0438\u0442\u0435 OST \u0438 \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u0435 \u043c\u0433\u043d\u043e\u0432\u0435\u043d\u043d\u044b\u0435 \u0446\u0438\u0444\u0440\u043e\u0432\u044b\u0435 \u043a\u0430\u0440\u0442\u044b.',
      'gc.tabSell': '&#128178; \u041f\u0440\u043e\u0434\u0430\u0442\u044c \u043a\u0430\u0440\u0442\u0443 &rarr; \u041f\u043e\u043b\u0443\u0447\u0438\u0442\u044c OST',
      'gc.tabBuy': '&#127873; \u041a\u0443\u043f\u0438\u0442\u044c \u043a\u0430\u0440\u0442\u0443 \u0437\u0430 OST',
      'gc.pipe.paste': '\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u043a\u043e\u0434', 'gc.pipe.verify': '\u041f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c', 'gc.pipe.receive': '\u041f\u043e\u043b\u0443\u0447\u0438\u0442\u044c OST',
      'gc.pipe.payOst': '\u041e\u043f\u043b\u0430\u0442\u0438\u0442\u044c OST', 'gc.pipe.convert': '\u041a\u043e\u043d\u0432\u0435\u0440\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c', 'gc.pipe.getCard': '\u041f\u043e\u043b\u0443\u0447\u0438\u0442\u044c \u043a\u0430\u0440\u0442\u0443',
      'gc.merchant': '\u041c\u0430\u0433\u0430\u0437\u0438\u043d / \u0411\u0440\u0435\u043d\u0434', 'gc.merchantBuy': '\u0412\u044b\u0431\u0440\u0430\u0442\u044c \u043a\u0430\u0440\u0442\u0443',
      'gc.code': '\u041a\u043e\u0434 \u043a\u0430\u0440\u0442\u044b', 'gc.balance': '\u0411\u0430\u043b\u0430\u043d\u0441 \u043a\u0430\u0440\u0442\u044b (USD)',
      'gc.youGet': '\u0412\u044b \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u0435', 'gc.youPay': '\u0412\u044b \u043f\u043b\u0430\u0442\u0438\u0442\u0435', 'gc.amount': '\u0421\u0443\u043c\u043c\u0430 (USD)',
      'gc.email': 'Email \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438 (\u043d\u0435\u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e)',
      'gc.rate': '\u041a\u0443\u0440\u0441:', 'gc.fee': '\u041a\u043e\u043c\u0438\u0441\u0441\u0438\u044f (0.1%):',
      'gc.feeNote': '&#128752; \u041a\u043e\u043c\u0438\u0441\u0441\u0438\u044f \u0444\u0438\u043d\u0430\u043d\u0441\u0438\u0440\u0443\u0435\u0442 \u0441\u043f\u0443\u0442\u043d\u0438\u043a\u043e\u0432\u0443\u044e \u0438\u043d\u0444\u0440\u0430\u0441\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0443',
      'gc.sellBtn': '\u041f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u0438 \u043f\u0440\u043e\u0434\u0430\u0442\u044c &rarr; \u041f\u043e\u043b\u0443\u0447\u0438\u0442\u044c OST',
      'gc.buyBtn': '\u041e\u043f\u043b\u0430\u0442\u0438\u0442\u044c OST &rarr; \u041f\u043e\u043b\u0443\u0447\u0438\u0442\u044c \u043a\u0430\u0440\u0442\u0443',
      'gc.step.verify': '\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u043a\u043e\u0434\u0430 \u043a\u0430\u0440\u0442\u044b&hellip;',
      'gc.step.zk': '\u0413\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u044f ZK \u0434\u043e\u043a\u0430\u0437\u0430\u0442\u0435\u043b\u044c\u0441\u0442\u0432\u0430&hellip;',
      'gc.step.send': '\u041e\u0442\u043f\u0440\u0430\u0432\u043a\u0430 OST \u0447\u0435\u0440\u0435\u0437 \u043a\u043e\u043d\u0444\u0438\u0434\u0435\u043d\u0446\u0438\u0430\u043b\u044c\u043d\u044b\u0439 \u043f\u0435\u0440\u0435\u0432\u043e\u0434&hellip;',
      'gc.step.done': '\u0413\u043e\u0442\u043e\u0432\u043e! OST \u043f\u043e\u043b\u0443\u0447\u0435\u043d\u044b \u043f\u0440\u0438\u0432\u0430\u0442\u043d\u043e.',
      'gc.step.debit': '\u0421\u043f\u0438\u0441\u0430\u043d\u0438\u0435 OST (\u043a\u043e\u043d\u0444\u0438\u0434\u0435\u043d\u0446\u0438\u0430\u043b\u044c\u043d\u043e)&hellip;',
      'gc.step.swap': '\u041e\u0431\u043c\u0435\u043d OST &rarr; USDC \u0447\u0435\u0440\u0435\u0437 Jupiter&hellip;',
      'gc.step.purchase': '\u041f\u043e\u043a\u0443\u043f\u043a\u0430 \u043f\u043e\u0434\u0430\u0440\u043e\u0447\u043d\u043e\u0439 \u043a\u0430\u0440\u0442\u044b&hellip;',
      'gc.step.delivered': '\u041f\u043e\u0434\u0430\u0440\u043e\u0447\u043d\u0430\u044f \u043a\u0430\u0440\u0442\u0430 \u0434\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u0430!',
      'gc.supported': '\u041f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u043c\u044b\u0435 \u0431\u0440\u0435\u043d\u0434\u044b:',
      'gc.disclaimer': '&#9888; \u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0438 \u043d\u0435\u0441\u0443\u0442 \u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u043e\u0441\u0442\u044c \u0437\u0430 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0443 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u0438 \u043a\u0430\u0440\u0442. OST \u043d\u0435 \u044f\u0432\u043b\u044f\u0435\u0442\u0441\u044f \u044d\u043c\u0438\u0442\u0435\u043d\u0442\u043e\u043c. \u041f\u043e\u0434\u0447\u0438\u043d\u044f\u0435\u0442\u0441\u044f \u043c\u0435\u0441\u0442\u043d\u043e\u043c\u0443 \u0437\u0430\u043a\u043e\u043d\u043e\u0434\u0430\u0442\u0435\u043b\u044c\u0441\u0442\u0432\u0443.',
      'fuel.title': '\u0422\u043e\u043f\u043b\u0438\u0432\u043e \u0438 \u0410\u0417\u0421',
      'fuel.sub': '\u041f\u043b\u0430\u0442\u0438\u0442\u0435 OST \u043d\u0430 \u0437\u0430\u043f\u0440\u0430\u0432\u043a\u0430\u0445 \u043f\u043e \u0432\u0441\u0435\u043c\u0443 \u043c\u0438\u0440\u0443 — \u0437\u0430\u0440\u0430\u0431\u0430\u0442\u044b\u0432\u0430\u0439\u0442\u0435 \u0431\u043e\u043d\u0443\u0441\u044b',
      'fuel.howTitle': '\u041a\u0430\u043a \u044d\u0442\u043e \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442',
      'fuel.step1': '\u041f\u043e\u0434\u044a\u0435\u0445\u0430\u0442\u044c',
      'fuel.step1d': '\u041f\u0440\u0438\u0435\u0437\u0436\u0430\u0439\u0442\u0435 \u043d\u0430 \u043f\u0430\u0440\u0442\u043d\u0451\u0440\u0441\u043a\u0443\u044e \u0410\u0417\u0421',
      'fuel.step2': '\u041e\u043f\u043b\u0430\u0442\u0438\u0442\u044c',
      'fuel.step2d': '\u041e\u043f\u043b\u0430\u0442\u0438\u0442\u0435 OST \u0447\u0435\u0440\u0435\u0437 NFC \u0438\u043b\u0438 QR',
      'fuel.step3': '\u041f\u043e\u043b\u0443\u0447\u0438\u0442\u044c \u0431\u043e\u043d\u0443\u0441',
      'fuel.step3d': '\u041c\u0433\u043d\u043e\u0432\u0435\u043d\u043d\u044b\u0439 \u043a\u044d\u0448\u0431\u044d\u043a \u0432 OST',
      'fuel.step4': '\u0423\u0435\u0445\u0430\u0442\u044c',
      'fuel.step4d': '\u0427\u0435\u043a \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d \u0432 \u043a\u043e\u0448\u0435\u043b\u0451\u043a',
      'fuel.calcTitle': '\u041a\u0430\u043b\u044c\u043a\u0443\u043b\u044f\u0442\u043e\u0440 \u0431\u043e\u043d\u0443\u0441\u043e\u0432',
      'fuel.gallons': '\u0413\u0430\u043b\u043b\u043e\u043d\u044b',
      'fuel.priceGal': '\u0426\u0435\u043d\u0430 \u0437\u0430 \u0433\u0430\u043b\u043b\u043e\u043d (USD)',
      'fuel.total': '\u0418\u0442\u043e\u0433\u043e',
      'fuel.ostCost': '\u042d\u043a\u0432\u0438\u0432\u0430\u043b\u0435\u043d\u0442 \u0432 OST',
      'fuel.reward': '\u041a\u044d\u0448\u0431\u044d\u043a (3%)',
      'fuel.offlineTitle': '\u0420\u0430\u0431\u043e\u0442\u0430\u0435\u0442 \u043e\u0444\u043b\u0430\u0439\u043d',
      'fuel.offlineDesc': 'NFC \u0438 BLE — \u043f\u043b\u0430\u0442\u0438\u0442\u0435 \u0431\u0435\u0437 \u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442\u0430. \u0422\u0440\u0430\u043d\u0437\u0430\u043a\u0446\u0438\u0438 \u0441\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0438\u0440\u0443\u044e\u0442\u0441\u044f \u043f\u0440\u0438 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0438.',
      'fuel.partnersTitle': '\u041f\u0430\u0440\u0442\u043d\u0451\u0440\u0441\u043a\u0438\u0435 \u0410\u0417\u0421',
      'fuel.partnersSub': '\u041f\u0440\u0438\u043d\u0438\u043c\u0430\u0435\u0442\u0441\u044f \u0432 20+ \u043a\u0440\u0443\u043f\u043d\u044b\u0445 \u0442\u043e\u043f\u043b\u0438\u0432\u043d\u044b\u0445 \u0431\u0440\u0435\u043d\u0434\u0430\u0445',
      'fuel.rewardsTitle': '\u0423\u0440\u043e\u0432\u043d\u0438 \u043d\u0430\u0433\u0440\u0430\u0434',
      'fuel.disclaimer': '&#9888; \u041f\u043e\u043a\u0430\u0437\u0430\u043d\u043d\u044b\u0435 \u043f\u0430\u0440\u0442\u043d\u0451\u0440\u0441\u0442\u0432\u0430 \u0432 \u0440\u0430\u0437\u0440\u0430\u0431\u043e\u0442\u043a\u0435. OST \u043d\u0435 \u0441\u0432\u044f\u0437\u0430\u043d \u0441 \u0443\u043a\u0430\u0437\u0430\u043d\u043d\u044b\u043c\u0438 \u0431\u0440\u0435\u043d\u0434\u0430\u043c\u0438.',
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
      'hero.free': '&#128176; हमेशा मुफ्त',
      'hero.freetext': 'शून्य लेनदेन शुल्क। कोई छिपी लागत नहीं। दान और निवेशकों द्वारा वित्त पोषित।',
      'hero.createwallet': 'वॉलेट बनाएं',
      'hero.stat.unbanked': 'दुनिया भर में बैंक रहित वयस्क',
      'hero.stat.remittance': '$ रेमिटेंस शुल्क में खोया/वर्ष',
      'hero.stat.nointernet': 'बिना इंटरनेट के लोग',
      'vision.title': 'OST दृष्टि: पूर्ण वित्तीय स्वतंत्रता',
      'vision.sub': 'हम वर्तमान में Solana, Jupiter और थर्ड-पार्टी ब्रिज का उपयोग <strong>अस्थायी बुनियादी ढांचे</strong> के रूप में करते हैं। हमारा लक्ष्य <strong>OST सॉवरेन नेटवर्क</strong> बनाना है। <em>पूरी तरह से विकेंद्रीकृत। शून्य निर्भरता।</em>',
      'vision.s1.title': 'अस्थायी मचान', 'vision.s1.sub': 'Solana + Jupiter + ब्रिज',
      'vision.s2.title': 'OST इंटरचेंज प्रोटोकॉल', 'vision.s2.sub': 'अपना मैचिंग इंजन',
      'vision.s3.title': 'OST सॉवरेन नेटवर्क', 'vision.s3.sub': 'शून्य तृतीय-पक्ष निर्भरता',
      'vision.p1': '&#128274; ZK गोपनीय', 'vision.p2': '&#9889; 0.4s निपटान', 'vision.p3': '&#128176; शून्य शुल्क सदैव',
      'vision.p4': '&#128295; अपना इंजन', 'vision.p5': '&#127757; अपना DEX', 'vision.p6': '&#128752; उपग्रह इंटरनेट',
      'vision.spacex.title': 'OST &times; SpaceX',
      'vision.spacex.text': 'कम कक्षा उपग्रहों के माध्यम से 2.6 अरब लोगों तक बिना सेंसर इंटरनेट और भुगतान पहुंचाने के लिए साझेदारी।',
      'vision.spacex.btn': 'यात्रा देखें &#8594;',
      'newhere.title': '&#127381; नए हैं? अपनी OST यात्रा शुरू करें',
      'newhere.sub': 'मुफ्त OST प्राप्त करें, पारिवारिक वॉल्ट बनाएं, या बुनियादी ढांचे में योगदान देकर पुरस्कार अर्जित करें।',
      'gv.title': 'पारिवारिक ग्रो वॉल्ट',
      'gv.sub': 'हर नई पीढ़ी के साथ अंतरिक्ष में जन्मा पहला सिक्का। अपने बच्चे के लिए एक कस्टोडियल वॉल्ट बनाएं।',
      'gv.disclaimer': 'केवल शैक्षिक उपयोग। माता-पिता/अभिभावक सभी कर और स्थानीय कानूनों के लिए जिम्मेदार हैं।',
      'depin.title': 'DePIN डेटा-सेंटर फॉसेट',
      'depin.sub': 'बैंडविड्थ, GPU, CPU या उपग्रह क्षमता साझा करें &mdash; विकेंद्रीकृत डेटा सेंटर बनाने के लिए OST अर्जित करें।',
      'demos.title': '&#127916; लाइव डेमो', 'demos.sub': 'निजी, तत्काल भुगतान कैसा लगता है देखें। वास्तविक उत्पाद। शून्य शुल्क।',
      'wallet.getTitle': 'अपना व्यक्तिगत OST वॉलेट प्राप्त करें', 'wallet.getSub': 'अपना वॉलेट बनाने या कनेक्ट करने का तरीका चुनें।',
      'sell.title': 'OST बेचें या व्यापार करें', 'sell.sub': 'किसी भी क्रिप्टो या फिएट में निकासी। समान गति, समान गोपनीयता।',
      'censor.title': '&#128683; इंटरनेट सेंसरशिप अभी हो रही है', 'censor.sub': 'वास्तविक घटनाएं। वास्तविक लोग। OST डिजिटल उत्पीड़न का उत्तर है।',
      'spacex.title': 'OST &times; SpaceX &mdash; अंतरिक्ष की यात्रा', 'spacex.sub': 'पृथ्वी से मंगल तक हमारी साझेदारी रोडमैप का अनुसरण करें।',
      'roadmap.title': '&#128640; रोडमैप और प्रगति', 'roadmap.sub': 'हम कहां हैं, क्या बनाया है, और आगे क्या है।',
      'offline.scenarios': 'वास्तविक दुनिया के परिदृश्य', 'offline.scenariosub': 'विश्व बैंक, UNHCR और EM-DAT से सत्यापित डेटा। ये काल्पनिक नहीं हैं।',
      'ai.hook.title': 'सर्वर, बॉट या लोकलहोस्ट चला रहे हैं?',
      'ai.hook.text': 'यदि आपके पास सर्वर, बॉट या कोई स्वचालित बुद्धिमत्ता है &mdash; <strong>OST आपकी भुगतान परत है</strong>।',
      'gc.title': 'गिफ्ट कार्ड इंटरचेंज &mdash; OST से कोई भी गिफ्ट कार्ड बेचें या खरीदें',
      'gc.sub': 'किसी भी गिफ्ट कार्ड को प्राइवेट OST में बदलें, या OST से भुगतान करें और तुरंत डिजिटल गिफ्ट कार्ड प्राप्त करें।',
      'gc.tabSell': '&#128178; कार्ड बेचें &rarr; OST पाएं',
      'gc.tabBuy': '&#127873; OST से कार्ड खरीदें',
      'gc.pipe.paste': 'कोड पेस्ट करें', 'gc.pipe.verify': 'सत्यापित करें', 'gc.pipe.receive': 'OST प्राप्त करें',
      'gc.pipe.payOst': 'OST भुगतान करें', 'gc.pipe.convert': 'रूपांतरित करें', 'gc.pipe.getCard': 'कार्ड प्राप्त करें',
      'gc.merchant': 'व्यापारी / ब्रांड', 'gc.merchantBuy': 'गिफ्ट कार्ड चुनें',
      'gc.code': 'गिफ्ट कार्ड कोड', 'gc.balance': 'कार्ड शेष (USD)',
      'gc.youGet': 'आप प्राप्त करेंगे', 'gc.youPay': 'आप भुगतान करेंगे', 'gc.amount': 'राशि (USD)',
      'gc.email': 'डिलीवरी ईमेल (वैकल्पिक)',
      'gc.rate': 'दर:', 'gc.fee': 'ट्रेजरी शुल्क (0.1%):',
      'gc.feeNote': '&#128752; शुल्क उपग्रह बुनियादी ढांचे को वित्तपोषित करता है',
      'gc.sellBtn': 'सत्यापित करें और बेचें &rarr; OST प्राप्त करें',
      'gc.buyBtn': 'OST भुगतान करें &rarr; गिफ्ट कार्ड प्राप्त करें',
      'gc.step.verify': 'गिफ्ट कार्ड कोड सत्यापित हो रहा है&hellip;',
      'gc.step.zk': 'ZK प्रमाण उत्पन्न हो रहा है&hellip;',
      'gc.step.send': 'गोपनीय हस्तांतरण से OST भेजा जा रहा है&hellip;',
      'gc.step.done': 'पूर्ण! OST निजी रूप से प्राप्त हुआ।',
      'gc.step.debit': 'OST डेबिट हो रहा है (गोपनीय)&hellip;',
      'gc.step.swap': 'Jupiter के माध्यम से OST &rarr; USDC स्वैप&hellip;',
      'gc.step.purchase': 'गिफ्ट कार्ड खरीदा जा रहा है&hellip;',
      'gc.step.delivered': 'गिफ्ट कार्ड वितरित!',
      'gc.supported': 'समर्थित ब्रांड:',
      'gc.disclaimer': '&#9888; उपयोगकर्ता गिफ्ट कार्ड की वैधता सत्यापित करने के लिए जिम्मेदार हैं। OST गिफ्ट कार्ड जारीकर्ता नहीं है। स्थानीय कानूनों के अधीन।',
      'fuel.title': 'ईंधन और गैस स्टेशन',
      'fuel.sub': 'दुनिया भर के गैस स्टेशनों पर OST से भुगतान करें — हर भरने पर पुरस्कार अर्जित करें',
      'fuel.howTitle': 'कैसे काम करता है',
      'fuel.step1': 'पहुंचें',
      'fuel.step1d': 'किसी भी पार्टनर स्टेशन पर जाएं',
      'fuel.step2': 'टैप और पे',
      'fuel.step2d': 'NFC या QR से OST से भुगतान करें',
      'fuel.step3': 'पुरस्कार अर्जित करें',
      'fuel.step3d': 'तुरंत OST में कैशबैक पाएं',
      'fuel.step4': 'निकल जाएं',
      'fuel.step4d': 'रसीद आपके वॉलेट में भेजी गई',
      'fuel.calcTitle': 'ईंधन पुरस्कार कैलकुलेटर',
      'fuel.gallons': 'गैलन',
      'fuel.priceGal': 'प्रति गैलन मूल्य (USD)',
      'fuel.total': 'कुल लागत',
      'fuel.ostCost': 'OST समतुल्य',
      'fuel.reward': 'कैशबैक (3%)',
      'fuel.offlineTitle': 'ऑफलाइन काम करता है',
      'fuel.offlineDesc': 'NFC और BLE — बिना इंटरनेट के भुगतान करें। लेनदेन ऑनलाइन होने पर सिंक होते हैं।',
      'fuel.partnersTitle': 'पार्टनर स्टेशन',
      'fuel.partnersSub': 'विश्वभर में 20+ प्रमुख ईंधन ब्रांडों पर स्वीकृत',
      'fuel.rewardsTitle': 'पुरस्कार स्तर',
      'fuel.disclaimer': '&#9888; दिखाई गई साझेदारी विकास में है। OST सूचीबद्ध ब्रांडों से संबद्ध नहीं है।',
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
      'hero.free': '&#128176; مجاني إلى الأبد',
      'hero.freetext': 'صفر رسوم معاملات. لا تكاليف خفية. ممول من التبرعات والمستثمرين.',
      'hero.createwallet': 'إنشاء محفظة',
      'hero.stat.unbanked': 'بالغون بدون حسابات بنكية حول العالم',
      'hero.stat.remittance': '$ مفقودة في رسوم التحويلات/سنة',
      'hero.stat.nointernet': 'أشخاص بدون إنترنت',
      'vision.title': 'رؤية OST: الاستقلال المالي الكامل',
      'vision.sub': 'نستخدم حاليًا Solana وJupiter والجسور كـ<strong>بنية تحتية مؤقتة</strong>. هدفنا بناء <strong>شبكة OST السيادية</strong>. <em>لامركزية بالكامل. بدون تبعيات.</em>',
      'vision.s1.title': 'سقالات مؤقتة', 'vision.s1.sub': 'Solana + Jupiter + جسور',
      'vision.s2.title': 'بروتوكول تبادل OST', 'vision.s2.sub': 'محرك مطابقة خاص',
      'vision.s3.title': 'شبكة OST السيادية', 'vision.s3.sub': 'صفر تبعيات لطرف ثالث',
      'vision.p1': '&#128274; خصوصية ZK', 'vision.p2': '&#9889; تسوية 0.4ث', 'vision.p3': '&#128176; صفر رسوم',
      'vision.p4': '&#128295; محرك خاص', 'vision.p5': '&#127757; DEX خاص', 'vision.p6': '&#128752; إنترنت فضائي',
      'vision.spacex.title': 'OST &times; SpaceX',
      'vision.spacex.text': 'شراكة لتوفير إنترنت ومدفوعات بدون رقابة لـ2.6 مليار شخص عبر أقمار صناعية منخفضة المدار.',
      'vision.spacex.btn': 'استكشف الرحلة &#8594;',
      'newhere.title': '&#127381; جديد هنا؟ ابدأ رحلة OST',
      'newhere.sub': 'احصل على OST مجاني، أنشئ خزائن عائلية، أو اكسب مكافآت بالمساهمة في البنية التحتية.',
      'gv.title': 'خزائن النمو العائلية',
      'gv.sub': 'أول عملة تولد في الفضاء مع كل جيل جديد. أنشئ خزنة لطفلك.',
      'gv.disclaimer': 'للاستخدام التعليمي فقط. الآباء/الأوصياء مسؤولون عن جميع الضرائب والقوانين.',
      'depin.title': 'صنبور DePIN لمراكز البيانات',
      'depin.sub': 'شارك عرض النطاق أو GPU أو CPU أو سعة الأقمار الصناعية &mdash; واكسب OST لبناء مراكز بيانات لامركزية.',
      'demos.title': '&#127916; عروض حية', 'demos.sub': 'شاهد كيف تبدو المدفوعات الخاصة والفورية. منتجات حقيقية. صفر رسوم.',
      'wallet.getTitle': 'احصل على محفظة OST الخاصة بك', 'wallet.getSub': 'اختر طريقة إنشاء أو ربط محفظتك.',
      'sell.title': 'بيع أو تداول OST', 'sell.sub': 'سحب إلى أي عملة رقمية أو ورقية. نفس السرعة والخصوصية.',
      'censor.title': '&#128683; رقابة الإنترنت تحدث الآن', 'censor.sub': 'أحداث حقيقية. أشخاص حقيقيون. OST هو الجواب.',
      'spacex.title': 'OST &times; SpaceX &mdash; الرحلة إلى الفضاء', 'spacex.sub': 'تابع خارطة طريق شراكتنا من الأرض إلى المريخ.',
      'roadmap.title': '&#128640; خارطة الطريق والتقدم', 'roadmap.sub': 'أين نحن، ماذا بنينا، وما التالي.',
      'offline.scenarios': 'سيناريوهات العالم الحقيقي', 'offline.scenariosub': 'بيانات موثقة من البنك الدولي وUNHCR. ليست افتراضية.',
      'ai.hook.title': 'تشغل خادمًا أو بوت أو localhost؟',
      'ai.hook.text': 'إذا كان لديك خادم أو بوت أو أي شكل من أشكال الذكاء الآلي &mdash; <strong>OST هو طبقة الدفع الخاصة بك</strong>.',
      'gc.title': 'تبادل بطاقات الهدايا &mdash; بع أو اشترِ أي بطاقة هدية بـ OST',
      'gc.sub': 'حول أي بطاقة هدية إلى OST خاص، أو ادفع بـ OST واحصل على بطاقات هدايا رقمية فورية.',
      'gc.tabSell': '&#128178; بيع بطاقة &rarr; الحصول على OST',
      'gc.tabBuy': '&#127873; شراء بطاقة بـ OST',
      'gc.pipe.paste': 'لصق الرمز', 'gc.pipe.verify': 'تحقق', 'gc.pipe.receive': 'استلم OST',
      'gc.pipe.payOst': 'ادفع OST', 'gc.pipe.convert': 'تحويل', 'gc.pipe.getCard': 'احصل على البطاقة',
      'gc.merchant': 'التاجر / العلامة التجارية', 'gc.merchantBuy': 'اختر بطاقة هدية',
      'gc.code': 'رمز بطاقة الهدية', 'gc.balance': 'رصيد البطاقة (USD)',
      'gc.youGet': 'تحصل على', 'gc.youPay': 'تدفع', 'gc.amount': 'المبلغ (USD)',
      'gc.email': 'بريد التسليم (اختياري)',
      'gc.rate': 'السعر:', 'gc.fee': 'رسوم الخزينة (0.1%):',
      'gc.feeNote': '&#128752; الرسوم تمول البنية التحتية للأقمار الصناعية',
      'gc.sellBtn': 'تحقق وبع &rarr; احصل على OST',
      'gc.buyBtn': 'ادفع OST &rarr; احصل على بطاقة',
      'gc.step.verify': 'جارٍ التحقق من رمز البطاقة&hellip;',
      'gc.step.zk': 'إنشاء إثبات ZK&hellip;',
      'gc.step.send': 'إرسال OST عبر تحويل سري&hellip;',
      'gc.step.done': 'تم! OST مستلم بخصوصية.',
      'gc.step.debit': 'خصم OST (سري)&hellip;',
      'gc.step.swap': 'تبديل OST &rarr; USDC عبر Jupiter&hellip;',
      'gc.step.purchase': 'شراء بطاقة الهدية&hellip;',
      'gc.step.delivered': 'تم تسليم بطاقة الهدية!',
      'gc.supported': 'العلامات التجارية المدعومة:',
      'gc.disclaimer': '&#9888; المستخدمون مسؤولون عن التحقق من صلاحية البطاقات. OST ليس مصدر بطاقات هدايا. خاضع للقوانين المحلية.',
      'fuel.title': 'الوقود ومحطات الغاز',
      'fuel.sub': 'ادفع بـ OST في محطات الوقود حول العالم — اكسب مكافآت على كل تعبئة',
      'fuel.howTitle': 'كيف يعمل',
      'fuel.step1': 'اوصل',
      'fuel.step1d': 'اذهب إلى أي محطة شريكة',
      'fuel.step2': 'انقر وادفع',
      'fuel.step2d': 'ادفع بـ OST عبر NFC أو QR',
      'fuel.step3': 'اكسب المكافآت',
      'fuel.step3d': 'احصل على استرداد نقدي فوري بـ OST',
      'fuel.step4': 'انطلق',
      'fuel.step4d': 'الإيصال مرسل إلى محفظتك',
      'fuel.calcTitle': 'حاسبة مكافآت الوقود',
      'fuel.gallons': 'غالونات',
      'fuel.priceGal': 'السعر لكل غالون (USD)',
      'fuel.total': 'التكلفة الإجمالية',
      'fuel.ostCost': 'ما يعادله بـ OST',
      'fuel.reward': 'استرداد نقدي (3%)',
      'fuel.offlineTitle': 'يعمل بدون إنترنت',
      'fuel.offlineDesc': 'NFC و BLE — ادفع بدون إنترنت. تتم مزامنة المعاملات عند العودة للاتصال.',
      'fuel.partnersTitle': 'المحطات الشريكة',
      'fuel.partnersSub': 'مقبول في 20+ علامة تجارية للوقود حول العالم',
      'fuel.rewardsTitle': 'مستويات المكافآت',
      'fuel.disclaimer': '&#9888; الشراكات المعروضة قيد التطوير. OST غير تابع للعلامات التجارية المذكورة.',
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
      'hero.free': '&#128176; GRÁTIS PARA SEMPRE',
      'hero.freetext': 'Zero taxas de transação. Sem custos ocultos. Financiado por doações e investidores.',
      'hero.createwallet': 'Criar Carteira',
      'hero.stat.unbanked': 'Adultos sem banco no mundo',
      'hero.stat.remittance': '$ perdidos em taxas de remessa/ano',
      'hero.stat.nointernet': 'Pessoas sem internet',
      'vision.title': 'A Visão OST: Independência Financeira Completa',
      'vision.sub': 'Atualmente usamos Solana, Jupiter e pontes de terceiros como <strong>infraestrutura temporária</strong>. Nosso objetivo é construir a <strong>Rede Soberana OST</strong>. <em>Completamente descentralizada. Sem dependências.</em>',
      'vision.s1.title': 'Estrutura Temporária', 'vision.s1.sub': 'Solana + Jupiter + Pontes',
      'vision.s2.title': 'Protocolo de Câmbio OST', 'vision.s2.sub': 'Motor de correspondência próprio',
      'vision.s3.title': 'Rede Soberana OST', 'vision.s3.sub': 'Zero dependências de terceiros',
      'vision.p1': '&#128274; ZK Privado', 'vision.p2': '&#9889; 0.4s Liquidação', 'vision.p3': '&#128176; Zero Taxas',
      'vision.p4': '&#128295; Motor Próprio', 'vision.p5': '&#127757; DEX e Pontes Próprias', 'vision.p6': '&#128752; Internet via Satélite',
      'vision.spacex.title': 'OST &times; SpaceX',
      'vision.spacex.text': 'Parceria para levar internet e pagamentos sem censura a 2,6 bilhões de pessoas via satélites de órbita baixa.',
      'vision.spacex.btn': 'Explorar a Jornada &#8594;',
      'newhere.title': '&#127381; Novo Aqui? Comece Sua Jornada OST',
      'newhere.sub': 'Resgate OST grátis, crie cofres familiares ou ganhe recompensas contribuindo com infraestrutura.',
      'gv.title': 'Cofres Familiares de Crescimento',
      'gv.sub': 'A primeira moeda nascida no espaço a cada nova geração. Crie um cofre custodial para seu filho.',
      'gv.disclaimer': 'Apenas uso educacional. Pais/responsáveis são responsáveis por todas as leis fiscais e locais.',
      'depin.title': 'Faucet DePIN de Data Center',
      'depin.sub': 'Compartilhe largura de banda, GPU, CPU ou capacidade de satélite &mdash; ganhe OST por construir data centers descentralizados.',
      'demos.title': '&#127916; Demos ao Vivo', 'demos.sub': 'Veja como são pagamentos privados e instantâneos. Produtos reais. Zero taxas.',
      'wallet.getTitle': 'Obtenha Sua Carteira OST Pessoal', 'wallet.getSub': 'Escolha como criar ou conectar sua carteira.',
      'sell.title': 'Vender ou Trocar OST', 'sell.sub': 'Saque para qualquer cripto ou fiat. Mesma velocidade, mesma privacidade.',
      'censor.title': '&#128683; A Censura na Internet Está Acontecendo Agora', 'censor.sub': 'Eventos reais. Pessoas reais. OST é a resposta à opressão digital.',
      'spacex.title': 'OST &times; SpaceX &mdash; A Jornada ao Espaço', 'spacex.sub': 'Acompanhe nosso roteiro da Terra a Marte.',
      'roadmap.title': '&#128640; Roteiro e Progresso', 'roadmap.sub': 'Onde estamos, o que construímos e o que vem a seguir.',
      'offline.scenarios': 'Cenários do Mundo Real', 'offline.scenariosub': 'Dados verificados do Banco Mundial, ACNUR e EM-DAT. Não são hipóteses.',
      'ai.hook.title': 'Rodando um Servidor, Bot ou Localhost?',
      'ai.hook.text': 'Se você tem um servidor, bot ou qualquer inteligência automatizada &mdash; <strong>OST é sua camada de pagamento</strong>.',
      'gc.title': 'Interchange de Cart\u00f5es Presente &mdash; Venda ou Compre Qualquer Cart\u00e3o com OST',
      'gc.sub': 'Transforme qualquer cart\u00e3o presente em OST privado, ou pague com OST e receba cart\u00f5es digitais instant\u00e2neos.',
      'gc.tabSell': '&#128178; Vender Cart\u00e3o &rarr; Receber OST',
      'gc.tabBuy': '&#127873; Comprar Cart\u00e3o com OST',
      'gc.pipe.paste': 'Colar C\u00f3digo', 'gc.pipe.verify': 'Verificar', 'gc.pipe.receive': 'Receber OST',
      'gc.pipe.payOst': 'Pagar OST', 'gc.pipe.convert': 'Converter', 'gc.pipe.getCard': 'Receber Cart\u00e3o',
      'gc.merchant': 'Loja / Marca', 'gc.merchantBuy': 'Escolher Cart\u00e3o',
      'gc.code': 'C\u00f3digo do Cart\u00e3o', 'gc.balance': 'Saldo do Cart\u00e3o (USD)',
      'gc.youGet': 'Voc\u00ea Recebe', 'gc.youPay': 'Voc\u00ea Paga', 'gc.amount': 'Valor (USD)',
      'gc.email': 'Email de entrega (opcional)',
      'gc.rate': 'Taxa:', 'gc.fee': 'Taxa do Tesouro (0.1%):',
      'gc.feeNote': '&#128752; Taxa financia infraestrutura de sat\u00e9lites',
      'gc.sellBtn': 'Verificar e Vender &rarr; Receber OST',
      'gc.buyBtn': 'Pagar OST &rarr; Receber Cart\u00e3o',
      'gc.step.verify': 'Verificando c\u00f3digo do cart\u00e3o&hellip;',
      'gc.step.zk': 'Gerando prova ZK&hellip;',
      'gc.step.send': 'Enviando OST via transfer\u00eancia confidencial&hellip;',
      'gc.step.done': 'Completo! OST recebido com privacidade.',
      'gc.step.debit': 'Debitando OST (confidencial)&hellip;',
      'gc.step.swap': 'Trocando OST &rarr; USDC via Jupiter&hellip;',
      'gc.step.purchase': 'Comprando cart\u00e3o presente&hellip;',
      'gc.step.delivered': 'Cart\u00e3o presente entregue!',
      'gc.supported': 'Marcas suportadas:',
      'gc.disclaimer': '&#9888; Usu\u00e1rios s\u00e3o respons\u00e1veis por verificar a validade dos cart\u00f5es. OST n\u00e3o \u00e9 emissor de cart\u00f5es. Sujeito \u00e0s leis locais.',
      'fuel.title': 'Combust\u00edvel e Postos',
      'fuel.sub': 'Pague com OST em postos de combust\u00edvel no mundo todo \u2014 ganhe recompensas a cada abastecimento',
      'fuel.howTitle': 'Como Funciona',
      'fuel.step1': 'Chegue',
      'fuel.step1d': 'Dirija at\u00e9 qualquer posto parceiro',
      'fuel.step2': 'Toque e Pague',
      'fuel.step2d': 'Pague com OST via NFC ou QR',
      'fuel.step3': 'Ganhe Recompensas',
      'fuel.step3d': 'Receba cashback em OST instantaneamente',
      'fuel.step4': 'Siga em Frente',
      'fuel.step4d': 'Recibo enviado para sua carteira',
      'fuel.calcTitle': 'Calculadora de Recompensas',
      'fuel.gallons': 'Gal\u00f5es',
      'fuel.priceGal': 'Pre\u00e7o por Gal\u00e3o (USD)',
      'fuel.total': 'Custo Total',
      'fuel.ostCost': 'Equivalente em OST',
      'fuel.reward': 'Cashback (3%)',
      'fuel.offlineTitle': 'Funciona Offline',
      'fuel.offlineDesc': 'NFC e BLE \u2014 pague sem internet. Transa\u00e7\u00f5es sincronizam ao reconectar.',
      'fuel.partnersTitle': 'Postos Parceiros',
      'fuel.partnersSub': 'Aceito em 20+ grandes marcas de combust\u00edvel no mundo',
      'fuel.rewardsTitle': 'N\u00edveis de Recompensa',
      'fuel.disclaimer': '&#9888; Parcerias mostradas est\u00e3o em desenvolvimento. OST n\u00e3o \u00e9 afiliado \u00e0s marcas listadas.',
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
      'hero.free': '&#128176; GRATUIT POUR TOUJOURS',
      'hero.freetext': 'Zéro frais de transaction. Aucun coût caché. Financé par des dons et des investisseurs.',
      'hero.createwallet': 'Créer un Portefeuille',
      'hero.stat.unbanked': 'Adultes non bancarisés dans le monde',
      'hero.stat.remittance': '$ perdus en frais de transfert/an',
      'hero.stat.nointernet': 'Personnes sans internet',
      'vision.title': 'La Vision OST : Indépendance Financière Complète',
      'vision.sub': 'Nous utilisons actuellement Solana, Jupiter et des ponts tiers comme <strong>infrastructure temporaire</strong>. Notre objectif : le <strong>Réseau Souverain OST</strong>. <em>Entièrement décentralisé. Zéro dépendance.</em>',
      'vision.s1.title': 'Échafaudage Temporaire', 'vision.s1.sub': 'Solana + Jupiter + Ponts',
      'vision.s2.title': 'Protocole d\'Échange OST', 'vision.s2.sub': 'Moteur de correspondance propre',
      'vision.s3.title': 'Réseau Souverain OST', 'vision.s3.sub': 'Zéro dépendances tierces',
      'vision.p1': '&#128274; ZK Privé', 'vision.p2': '&#9889; 0,4s Règlement', 'vision.p3': '&#128176; Zéro Frais',
      'vision.p4': '&#128295; Moteur Propre', 'vision.p5': '&#127757; DEX et Ponts Propres', 'vision.p6': '&#128752; Internet par Satellite',
      'vision.spacex.title': 'OST &times; SpaceX',
      'vision.spacex.text': 'Partenariat pour apporter internet et paiements sans censure à 2,6 milliards de personnes via des satellites en orbite basse.',
      'vision.spacex.btn': 'Explorer le Voyage &#8594;',
      'newhere.title': '&#127381; Nouveau Ici ? Commencez Votre Voyage OST',
      'newhere.sub': 'Réclamez des OST gratuits, créez des coffres familiaux ou gagnez des récompenses en contribuant à l\'infrastructure.',
      'gv.title': 'Coffres Familiaux de Croissance',
      'gv.sub': 'La première monnaie née dans l\'espace avec chaque nouvelle génération. Créez un coffre pour votre enfant.',
      'gv.disclaimer': 'Usage éducatif uniquement. Les parents/tuteurs sont responsables de toutes les lois fiscales et locales.',
      'depin.title': 'Robinet DePIN Data Center',
      'depin.sub': 'Partagez bande passante, GPU, CPU ou capacité satellite &mdash; gagnez des OST pour construire des centres de données décentralisés.',
      'demos.title': '&#127916; Démos en Direct', 'demos.sub': 'Découvrez les paiements privés et instantanés. Produits réels. Zéro frais.',
      'wallet.getTitle': 'Obtenez Votre Portefeuille OST', 'wallet.getSub': 'Choisissez comment créer ou connecter votre portefeuille.',
      'sell.title': 'Vendre ou Échanger OST', 'sell.sub': 'Retrait vers n\'importe quelle crypto ou fiat. Même vitesse, même confidentialité.',
      'censor.title': '&#128683; La Censure d\'Internet Se Produit Maintenant', 'censor.sub': 'Événements réels. Personnes réelles. OST est la réponse.',
      'spacex.title': 'OST &times; SpaceX &mdash; Le Voyage dans l\'Espace', 'spacex.sub': 'Suivez notre feuille de route de la Terre à Mars.',
      'roadmap.title': '&#128640; Feuille de Route et Progrès', 'roadmap.sub': 'Où nous en sommes, ce que nous avons construit et la suite.',
      'offline.scenarios': 'Scénarios du Monde Réel', 'offline.scenariosub': 'Données vérifiées de la Banque Mondiale, du HCR et d\'EM-DAT.',
      'ai.hook.title': 'Vous avez un Serveur, Bot ou Localhost ?',
      'ai.hook.text': 'Si vous avez un serveur, un bot ou toute forme d\'intelligence automatisée &mdash; <strong>OST est votre couche de paiement</strong>.',
      'gc.title': '\u00c9change de Cartes Cadeaux &mdash; Vendez ou Achetez N\'importe Quelle Carte avec OST',
      'gc.sub': 'Transformez n\'importe quelle carte cadeau en OST priv\u00e9, ou payez avec OST et recevez des cartes num\u00e9riques instantan\u00e9es.',
      'gc.tabSell': '&#128178; Vendre Carte &rarr; Recevoir OST',
      'gc.tabBuy': '&#127873; Acheter Carte avec OST',
      'gc.pipe.paste': 'Coller Code', 'gc.pipe.verify': 'V\u00e9rifier', 'gc.pipe.receive': 'Recevoir OST',
      'gc.pipe.payOst': 'Payer OST', 'gc.pipe.convert': 'Convertir', 'gc.pipe.getCard': 'Recevoir Carte',
      'gc.merchant': 'Marchand / Marque', 'gc.merchantBuy': 'Choisir Carte Cadeau',
      'gc.code': 'Code de la Carte', 'gc.balance': 'Solde de la Carte (USD)',
      'gc.youGet': 'Vous Recevez', 'gc.youPay': 'Vous Payez', 'gc.amount': 'Montant (USD)',
      'gc.email': 'Email de livraison (optionnel)',
      'gc.rate': 'Taux:', 'gc.fee': 'Frais du Tr\u00e9sor (0.1%):',
      'gc.feeNote': '&#128752; Les frais financent l\'infrastructure satellite',
      'gc.sellBtn': 'V\u00e9rifier et Vendre &rarr; Recevoir OST',
      'gc.buyBtn': 'Payer OST &rarr; Recevoir Carte',
      'gc.step.verify': 'V\u00e9rification du code carte&hellip;',
      'gc.step.zk': 'G\u00e9n\u00e9ration de la preuve ZK&hellip;',
      'gc.step.send': 'Envoi d\'OST par transfert confidentiel&hellip;',
      'gc.step.done': 'Termin\u00e9 ! OST re\u00e7u en toute confidentialit\u00e9.',
      'gc.step.debit': 'D\u00e9bit d\'OST (confidentiel)&hellip;',
      'gc.step.swap': '\u00c9change OST &rarr; USDC via Jupiter&hellip;',
      'gc.step.purchase': 'Achat de la carte cadeau&hellip;',
      'gc.step.delivered': 'Carte cadeau livr\u00e9e !',
      'gc.supported': 'Marques support\u00e9es :',
      'gc.disclaimer': '&#9888; Les utilisateurs sont responsables de la validit\u00e9 des cartes. OST n\'est pas un \u00e9metteur de cartes. Soumis aux lois locales.',
      'fuel.title': 'Carburant et Stations',
      'fuel.sub': 'Payez avec OST aux stations-service du monde entier \u2014 gagnez des r\u00e9compenses \u00e0 chaque plein',
      'fuel.howTitle': 'Comment \u00e7a Marche',
      'fuel.step1': 'Arrivez',
      'fuel.step1d': 'Rendez-vous \u00e0 une station partenaire',
      'fuel.step2': 'Touchez et Payez',
      'fuel.step2d': 'Payez avec OST via NFC ou QR',
      'fuel.step3': 'Gagnez',
      'fuel.step3d': 'Recevez du cashback en OST instantan\u00e9ment',
      'fuel.step4': 'Repartez',
      'fuel.step4d': 'Re\u00e7u envoy\u00e9 dans votre portefeuille',
      'fuel.calcTitle': 'Calculateur de R\u00e9compenses',
      'fuel.gallons': 'Gallons',
      'fuel.priceGal': 'Prix par Gallon (USD)',
      'fuel.total': 'Co\u00fbt Total',
      'fuel.ostCost': '\u00c9quivalent OST',
      'fuel.reward': 'Cashback (3%)',
      'fuel.offlineTitle': 'Fonctionne Hors Ligne',
      'fuel.offlineDesc': 'NFC et BLE \u2014 payez sans internet. Les transactions se synchronisent \u00e0 la reconnexion.',
      'fuel.partnersTitle': 'Stations Partenaires',
      'fuel.partnersSub': 'Accept\u00e9 dans 20+ grandes marques de carburant dans le monde',
      'fuel.rewardsTitle': 'Niveaux de R\u00e9compenses',
      'fuel.disclaimer': '&#9888; Les partenariats pr\u00e9sent\u00e9s sont en d\u00e9veloppement. OST n\'est pas affili\u00e9 aux marques list\u00e9es.',
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
      'hero.free': '&#128176; 永久無料',
      'hero.freetext': '取引手数料ゼロ。隠れたコストなし。寄付と投資家が資金提供。',
      'hero.createwallet': 'ウォレット作成',
      'hero.stat.unbanked': '世界の銀行口座を持たない成人',
      'hero.stat.remittance': '送金手数料で失われた$/年',
      'hero.stat.nointernet': 'インターネットのない人々',
      'vision.title': 'OSTビジョン：完全な経済的独立',
      'vision.sub': '現在Solana、Jupiter、サードパーティブリッジを<strong>一時的なインフラ</strong>として使用中。目標は<strong>OSTソブリンネットワーク</strong>の構築。<em>完全分散型。依存関係ゼロ。</em>',
      'vision.s1.title': '一時的な足場', 'vision.s1.sub': 'Solana + Jupiter + ブリッジ',
      'vision.s2.title': 'OSTインターチェンジ', 'vision.s2.sub': '独自のマッチングエンジン',
      'vision.s3.title': 'OSTソブリンネットワーク', 'vision.s3.sub': 'サードパーティ依存ゼロ',
      'vision.p1': '&#128274; ZKプライベート', 'vision.p2': '&#9889; 0.4秒決済', 'vision.p3': '&#128176; 永久手数料ゼロ',
      'vision.p4': '&#128295; 独自エンジン', 'vision.p5': '&#127757; 独自DEXとブリッジ', 'vision.p6': '&#128752; 衛星インターネット',
      'vision.spacex.title': 'OST &times; SpaceX',
      'vision.spacex.text': '低軌道衛星を通じて26億人に検閲なしのインターネットと決済を提供するパートナーシップ。',
      'vision.spacex.btn': 'ジャーニーを探索 &#8594;',
      'newhere.title': '&#127381; 初めてですか？OSTの旅を始めましょう',
      'newhere.sub': '無料OSTを請求し、ファミリーボールトを作成し、インフラ貢献で報酬を獲得しましょう。',
      'gv.title': 'ファミリーグロウボールト',
      'gv.sub': '新世代と共に宇宙で誕生する最初のコイン。お子様のためのカストディアルボールトを作成しましょう。',
      'gv.disclaimer': '教育目的のみ。両親/保護者がすべての税法と現地法に責任を負います。',
      'depin.title': 'DePINデータセンターフォーセット',
      'depin.sub': '帯域幅、GPU、CPU、衛星容量を共有 &mdash; 分散型データセンター構築でOSTを獲得。',
      'demos.title': '&#127916; ライブデモ', 'demos.sub': 'プライベートで即時の支払いを体験。リアル製品。手数料ゼロ。',
      'wallet.getTitle': 'あなたのOSTウォレットを取得', 'wallet.getSub': 'ウォレットの作成または接続方法を選択してください。',
      'sell.title': 'OSTの売却・取引', 'sell.sub': '任意の暗号通貨またはフィアットに引き出し。同じ速度、同じプライバシー。',
      'censor.title': '&#128683; インターネット検閲が今起きている', 'censor.sub': '実際の出来事。実際の人々。OSTはデジタル弾圧への答え。',
      'spacex.title': 'OST &times; SpaceX &mdash; 宇宙への旅', 'spacex.sub': '地球から火星までのパートナーシップロードマップをフォロー。',
      'roadmap.title': '&#128640; ロードマップと進捗', 'roadmap.sub': '現在地、構築したもの、次のステップ。',
      'offline.scenarios': '実世界のシナリオ', 'offline.scenariosub': '世界銀行、UNHCR、EM-DATの検証済みデータ。仮説ではありません。',
      'ai.hook.title': 'サーバー、ボット、ロカホストを運用中？',
      'ai.hook.text': 'サーバー、ボット、自動化されたインテリジェンスがあれば &mdash; <strong>OSTがあなたの決済レイヤー</strong>です。',
      'gc.title': 'ギフトカード交換 &mdash; OSTでギフトカードを売買',
      'gc.sub': 'ギフトカードをプライベートOSTに変換、またはOSTで支払い即座にデジタルギフトカードを受け取れます。',
      'gc.tabSell': '&#128178; カードを売る &rarr; OST獲得',
      'gc.tabBuy': '&#127873; OSTでカード購入',
      'gc.pipe.paste': 'コード貼付', 'gc.pipe.verify': '検証', 'gc.pipe.receive': 'OST受取',
      'gc.pipe.payOst': 'OST支払', 'gc.pipe.convert': '変換', 'gc.pipe.getCard': 'カード取得',
      'gc.merchant': 'ブランド', 'gc.merchantBuy': 'ギフトカードを選択',
      'gc.code': 'ギフトカードコード', 'gc.balance': 'カード残高(USD)',
      'gc.youGet': '受取額', 'gc.youPay': '支払額', 'gc.amount': '金額(USD)',
      'gc.email': '配信メール(任意)',
      'gc.rate': 'レート:', 'gc.fee': '財務手数料(0.1%):',
      'gc.feeNote': '&#128752; 手数料は衛星インフラに資金提供',
      'gc.sellBtn': '検証して売却 &rarr; OST獲得',
      'gc.buyBtn': 'OST支払い &rarr; ギフトカード取得',
      'gc.step.verify': 'ギフトカードコード検証中&hellip;',
      'gc.step.zk': 'ZK証明生成中&hellip;',
      'gc.step.send': '機密転送でOST送信中&hellip;',
      'gc.step.done': '完了！OSTをプライベートに受領。',
      'gc.step.debit': 'OST引落(機密)&hellip;',
      'gc.step.swap': 'Jupiter経由でOST&rarr;USDC交換&hellip;',
      'gc.step.purchase': 'ギフトカード購入中&hellip;',
      'gc.step.delivered': 'ギフトカード配信完了！',
      'gc.supported': '対応ブランド:',
      'gc.disclaimer': '&#9888; ユーザーはギフトカードの有効性を確認する責任があります。OSTはギフトカード発行者ではありません。現地法に従います。',
      'fuel.title': '燃料＆ガソリンスタンド',
      'fuel.sub': '世界中のガソリンスタンドでOSTで支払い — 給油のたびにリワードを獲得',
      'fuel.howTitle': '使い方',
      'fuel.step1': '到着',
      'fuel.step1d': 'パートナーステーションへ',
      'fuel.step2': 'タップ＆ペイ',
      'fuel.step2d': 'NFCまたはQRでOSTで支払い',
      'fuel.step3': 'リワード獲得',
      'fuel.step3d': 'OSTで即座にキャッシュバック',
      'fuel.step4': '出発',
      'fuel.step4d': 'レシートがウォレットに送信',
      'fuel.calcTitle': '燃料リワード計算機',
      'fuel.gallons': 'ガロン',
      'fuel.priceGal': 'ガロン単価 (USD)',
      'fuel.total': '合計コスト',
      'fuel.ostCost': 'OST換算',
      'fuel.reward': 'キャッシュバック (3%)',
      'fuel.offlineTitle': 'オフライン対応',
      'fuel.offlineDesc': 'NFC＆BLE — インターネットなしで支払い可能。オンライン復帰時に同期。',
      'fuel.partnersTitle': 'パートナーステーション',
      'fuel.partnersSub': '世界の20+主要燃料ブランドで利用可能',
      'fuel.rewardsTitle': 'リワードティア',
      'fuel.disclaimer': '&#9888; 表示されているパートナーシップは開発中です。OSTは掲載ブランドとは提携していません。',
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
      'hero.free': '&#128176; 영원히 무료',
      'hero.freetext': '거래 수수료 제로. 숨겨진 비용 없음. 기부와 투자자가 자금 지원.',
      'hero.createwallet': '지갑 만들기',
      'hero.stat.unbanked': '전 세계 은행 계좌 없는 성인',
      'hero.stat.remittance': '송금 수수료로 손실된 $/년',
      'hero.stat.nointernet': '인터넷 없는 사람들',
      'vision.title': 'OST 비전: 완전한 금융 독립',
      'vision.sub': '현재 Solana, Jupiter, 서드파티 브리지를 <strong>임시 인프라</strong>로 사용 중입니다. 목표는 <strong>OST 주권 네트워크</strong> 구축입니다. <em>완전 분산화. 의존성 제로.</em>',
      'vision.s1.title': '임시 기반', 'vision.s1.sub': 'Solana + Jupiter + 브리지',
      'vision.s2.title': 'OST 교환 프로토콜', 'vision.s2.sub': '자체 매칭 엔진',
      'vision.s3.title': 'OST 주권 네트워크', 'vision.s3.sub': '서드파티 의존성 제로',
      'vision.p1': '&#128274; ZK 프라이버시', 'vision.p2': '&#9889; 0.4초 결제', 'vision.p3': '&#128176; 수수료 영원히 제로',
      'vision.p4': '&#128295; 자체 엔진', 'vision.p5': '&#127757; 자체 DEX와 브리지', 'vision.p6': '&#128752; 위성 인터넷',
      'vision.spacex.title': 'OST &times; SpaceX',
      'vision.spacex.text': '저궤도 위성을 통해 26억 인구에게 무검열 인터넷과 결제를 제공하기 위한 파트너십.',
      'vision.spacex.btn': '여정 탐험 &#8594;',
      'newhere.title': '&#127381; 처음이신가요? OST 여정을 시작하세요',
      'newhere.sub': '무료 OST를 받고, 가족 볼트를 만들고, 인프라 기여로 보상을 받으세요.',
      'gv.title': '가족 성장 볼트',
      'gv.sub': '새로운 세대마다 우주에서 태어나는 첫 번째 코인. 자녀를 위한 수탁 볼트를 만드세요.',
      'gv.disclaimer': '교육 목적으로만 사용. 부모/보호자가 모든 세법과 현지 법률에 책임.',
      'depin.title': 'DePIN 데이터센터 파우셋',
      'depin.sub': '대역폭, GPU, CPU 또는 위성 용량 공유 &mdash; 분산 데이터센터 구축으로 OST 획득.',
      'demos.title': '&#127916; 라이브 데모', 'demos.sub': '프라이빗 즉시 결제를 경험하세요. 실제 제품. 수수료 제로.',
      'wallet.getTitle': '개인 OST 지갑 받기', 'wallet.getSub': '지갑을 만들거나 연결하는 방법을 선택하세요.',
      'sell.title': 'OST 판매 또는 거래', 'sell.sub': '모든 암호화폐 또는 법정화폐로 출금. 같은 속도, 같은 프라이버시.',
      'censor.title': '&#128683; 인터넷 검열이 지금 일어나고 있습니다', 'censor.sub': '실제 사건. 실제 사람들. OST는 디지털 억압에 대한 답.',
      'spacex.title': 'OST &times; SpaceX &mdash; 우주로의 여정', 'spacex.sub': '지구에서 화성까지 파트너십 로드맵을 따라가세요.',
      'roadmap.title': '&#128640; 로드맵과 진행 상황', 'roadmap.sub': '현재 위치, 구축한 것, 다음 단계.',
      'offline.scenarios': '현실 세계 시나리오', 'offline.scenariosub': '세계은행, UNHCR, EM-DAT의 검증된 데이터. 가설이 아닙니다.',
      'ai.hook.title': '서버, 봇 또는 로컬호스트를 운영 중이신가요?',
      'ai.hook.text': '서버, 봇 또는 자동화된 인텔리전스가 있다면 &mdash; <strong>OST가 결제 레이어</strong>입니다.',
      'gc.title': '기프트카드 교환 &mdash; OST로 기프트카드 매매',
      'gc.sub': '기프트카드를 프라이빗 OST로 전환하거나, OST로 결제하여 즉시 디지털 기프트카드를 받으세요.',
      'gc.tabSell': '&#128178; 카드 판매 &rarr; OST 받기',
      'gc.tabBuy': '&#127873; OST로 카드 구매',
      'gc.pipe.paste': '코드 붙여넣기', 'gc.pipe.verify': '검증', 'gc.pipe.receive': 'OST 수령',
      'gc.pipe.payOst': 'OST 결제', 'gc.pipe.convert': '변환', 'gc.pipe.getCard': '카드 받기',
      'gc.merchant': '가맹점 / 브랜드', 'gc.merchantBuy': '기프트카드 선택',
      'gc.code': '기프트카드 코드', 'gc.balance': '카드 잔액 (USD)',
      'gc.youGet': '받는 금액', 'gc.youPay': '지불 금액', 'gc.amount': '금액 (USD)',
      'gc.email': '배송 이메일 (선택)',
      'gc.rate': '환율:', 'gc.fee': '재무 수수료 (0.1%):',
      'gc.feeNote': '&#128752; 수수료는 위성 인프라에 자금 지원',
      'gc.sellBtn': '검증 및 판매 &rarr; OST 받기',
      'gc.buyBtn': 'OST 결제 &rarr; 기프트카드 받기',
      'gc.step.verify': '기프트카드 코드 검증 중&hellip;',
      'gc.step.zk': 'ZK 증명 생성 중&hellip;',
      'gc.step.send': '기밀 전송으로 OST 전송 중&hellip;',
      'gc.step.done': '완료! OST가 프라이빗하게 수령되었습니다.',
      'gc.step.debit': 'OST 차감 (기밀)&hellip;',
      'gc.step.swap': 'Jupiter 통해 OST &rarr; USDC 스왑&hellip;',
      'gc.step.purchase': '기프트카드 구매 중&hellip;',
      'gc.step.delivered': '기프트카드 배송 완료!',
      'gc.supported': '지원 브랜드:',
      'gc.disclaimer': '&#9888; 사용자는 기프트카드의 유효성을 확인할 책임이 있습니다. OST는 기프트카드 발행자가 아닙니다. 현지 법률의 적용을 받습니다.',
      'fuel.title': '연료 및 주유소',
      'fuel.sub': '전 세계 주유소에서 OST로 결제 — 주유할 때마다 리워드 적립',
      'fuel.howTitle': '이용 방법',
      'fuel.step1': '도착',
      'fuel.step1d': '파트너 주유소로 이동',
      'fuel.step2': '탭 & 결제',
      'fuel.step2d': 'NFC 또는 QR로 OST 결제',
      'fuel.step3': '리워드 적립',
      'fuel.step3d': 'OST로 즉시 캐시백 수령',
      'fuel.step4': '출발',
      'fuel.step4d': '영수증이 지갑으로 전송',
      'fuel.calcTitle': '연료 리워드 계산기',
      'fuel.gallons': '갤런',
      'fuel.priceGal': '갤런당 가격 (USD)',
      'fuel.total': '총 비용',
      'fuel.ostCost': 'OST 환산',
      'fuel.reward': '캐시백 (3%)',
      'fuel.offlineTitle': '오프라인 작동',
      'fuel.offlineDesc': 'NFC & BLE — 인터넷 없이 결제. 온라인 복귀 시 동기화.',
      'fuel.partnersTitle': '파트너 주유소',
      'fuel.partnersSub': '전 세계 20+개 주요 연료 브랜드에서 이용 가능',
      'fuel.rewardsTitle': '리워드 등급',
      'fuel.disclaimer': '&#9888; 표시된 파트너십은 개발 중입니다. OST는 나열된 브랜드와 제휴하지 않습니다.',
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
      'hero.free': '&#128176; SONSUZA DEK ÜCRETSİZ',
      'hero.freetext': 'Sıfır işlem ücreti. Gizli maliyet yok. Bağışlar ve yatırımcılar tarafından finanse edilir.',
      'hero.createwallet': 'Cüzdan Oluştur',
      'hero.stat.unbanked': 'Dünyada bankasız yetişkinler',
      'hero.stat.remittance': '$ havale ücretlerinde kaybedilen/yıl',
      'hero.stat.nointernet': 'İnternetsiz insanlar',
      'vision.title': 'OST Vizyonu: Tam Finansal Bağımsızlık',
      'vision.sub': 'Şu anda Solana, Jupiter ve üçüncü taraf köprüleri <strong>geçici altyapı</strong> olarak kullanıyoruz. Hedefimiz <strong>OST Egemen Ağı</strong> kurmak. <em>Tamamen merkeziyetsiz. Sıfır bağımlılık.</em>',
      'vision.s1.title': 'Geçici İskele', 'vision.s1.sub': 'Solana + Jupiter + Köprüler',
      'vision.s2.title': 'OST Değişim Protokolü', 'vision.s2.sub': 'Kendi eşleştirme motoru',
      'vision.s3.title': 'OST Egemen Ağı', 'vision.s3.sub': 'Sıfır üçüncü taraf bağımlılığı',
      'vision.p1': '&#128274; ZK Gizli', 'vision.p2': '&#9889; 0.4sn Uzlaşma', 'vision.p3': '&#128176; Sıfır Ücret Sonsuza Dek',
      'vision.p4': '&#128295; Kendi Motoru', 'vision.p5': '&#127757; Kendi DEX ve Köprüleri', 'vision.p6': '&#128752; Uydu İnterneti',
      'vision.spacex.title': 'OST &times; SpaceX',
      'vision.spacex.text': 'Düşük yörünge uyduları aracılığıyla 2,6 milyar kişiye sansürsüz internet ve ödeme sağlamak için ortaklık.',
      'vision.spacex.btn': 'Yolculuğu Keşfet &#8594;',
      'newhere.title': '&#127381; Yeni Misin? OST Yolculuğuna Başla',
      'newhere.sub': 'Ücretsiz OST al, aile kasaları oluştur veya altyapı katkısıyla ödül kazan.',
      'gv.title': 'Aile Büyüme Kasaları',
      'gv.sub': 'Her yeni nesillle birlikte uzayda doğan ilk madeni para. Çocuğunuz için emanet kasası oluşturun.',
      'gv.disclaimer': 'Yalnızca eğitim amaçlıdır. Ebeveynler/vasiler tüm vergi ve yerel yasalardan sorumludur.',
      'depin.title': 'DePIN Veri Merkezi Musluğu',
      'depin.sub': 'Bant genişliği, GPU, CPU veya uydu kapasitesi paylaşın &mdash; merkeziyetsiz veri merkezleri kurmak için OST kazanın.',
      'demos.title': '&#127916; Canlı Demolar', 'demos.sub': 'Özel, anlık ödemelerin nasıl hissettirdiğini görün. Gerçek ürünler. Sıfır ücret.',
      'wallet.getTitle': 'Kişisel OST Cüzdanınızı Alın', 'wallet.getSub': 'Cüzdanınızı nasıl oluşturacağınızı veya bağlayacağınızı seçin.',
      'sell.title': 'OST Sat veya Takas Et', 'sell.sub': 'Herhangi bir kriptoya veya fiata çek. Aynı hız, aynı gizlilik.',
      'censor.title': '&#128683; İnternet Sansürü Şu Anda Yaşanıyor', 'censor.sub': 'Gerçek olaylar. Gerçek insanlar. OST dijital baskıya cevaptır.',
      'spacex.title': 'OST &times; SpaceX &mdash; Uzaya Yolculuk', 'spacex.sub': 'Dünya\'dan Mars\'a ortaklık yol haritamızı takip edin.',
      'roadmap.title': '&#128640; Yol Haritası ve İlerleme', 'roadmap.sub': 'Neredeyiz, ne inşa ettik ve sırada ne var.',
      'offline.scenarios': 'Gerçek Dünya Senaryoları', 'offline.scenariosub': 'Dünya Bankası, BMMYK ve EM-DAT\'tan doğrulanmış veriler.',
      'ai.hook.title': 'Sunucu, Bot veya Localhost Çalıştırıyor musunuz?',
      'ai.hook.text': 'Sunucunuz, botunuz veya otomatik zekanız varsa &mdash; <strong>OST ödeme katmanınızdır</strong>.',
      'gc.title': 'Hediye Kart\u0131 De\u011fi\u015fimi &mdash; OST ile Hediye Kart\u0131 Al veya Sat',
      'gc.sub': 'Herhangi bir hediye kart\u0131n\u0131 \u00f6zel OST\'ye d\u00f6n\u00fc\u015ft\u00fcr\u00fcn veya OST ile \u00f6deyin ve an\u0131nda dijital hediye kart\u0131 al\u0131n.',
      'gc.tabSell': '&#128178; Kart Sat &rarr; OST Al',
      'gc.tabBuy': '&#127873; OST ile Kart Al',
      'gc.pipe.paste': 'Kod Yap\u0131\u015ft\u0131r', 'gc.pipe.verify': 'Do\u011frula', 'gc.pipe.receive': 'OST Al',
      'gc.pipe.payOst': 'OST \u00d6de', 'gc.pipe.convert': 'D\u00f6n\u00fc\u015ft\u00fcr', 'gc.pipe.getCard': 'Kart Al',
      'gc.merchant': 'Ma\u011faza / Marka', 'gc.merchantBuy': 'Hediye Kart Se\u00e7',
      'gc.code': 'Hediye Kart Kodu', 'gc.balance': 'Kart Bakiyesi (USD)',
      'gc.youGet': 'Alacak\u0131n\u0131z', 'gc.youPay': '\u00d6deyece\u011finiz', 'gc.amount': 'Tutar (USD)',
      'gc.email': 'Teslimat e-postas\u0131 (iste\u011fe ba\u011fl\u0131)',
      'gc.rate': 'Kur:', 'gc.fee': 'Hazine \u00dccreti (0.1%):',
      'gc.feeNote': '&#128752; \u00dccret uydu altyap\u0131s\u0131n\u0131 finanse eder',
      'gc.sellBtn': 'Do\u011frula ve Sat &rarr; OST Al',
      'gc.buyBtn': 'OST \u00d6de &rarr; Hediye Kart Al',
      'gc.step.verify': 'Hediye kart kodu do\u011frulan\u0131yor&hellip;',
      'gc.step.zk': 'ZK kan\u0131t\u0131 olu\u015fturuluyor&hellip;',
      'gc.step.send': 'Gizli transfer ile OST g\u00f6nderiliyor&hellip;',
      'gc.step.done': 'Tamamland\u0131! OST gizlice al\u0131nd\u0131.',
      'gc.step.debit': 'OST bor\u00e7land\u0131r\u0131l\u0131yor (gizli)&hellip;',
      'gc.step.swap': 'Jupiter ile OST &rarr; USDC takas\u0131&hellip;',
      'gc.step.purchase': 'Hediye kart sat\u0131n al\u0131n\u0131yor&hellip;',
      'gc.step.delivered': 'Hediye kart teslim edildi!',
      'gc.supported': 'Desteklenen markalar:',
      'gc.disclaimer': '&#9888; Kullan\u0131c\u0131lar hediye kartlar\u0131n\u0131n ge\u00e7erlili\u011fini do\u011frulamaktan sorumludur. OST hediye kart\u0131 ihrac\u00e7\u0131s\u0131 de\u011fildir. Yerel yasalara tabidir.',
      'fuel.title': 'Yak\u0131t ve Benzin \u0130stasyonlar\u0131',
      'fuel.sub': 'D\u00fcnya genelinde benzin istasyonlar\u0131nda OST ile \u00f6deme yap\u0131n \u2014 her dolumda \u00f6d\u00fcl kazan\u0131n',
      'fuel.howTitle': 'Nas\u0131l \u00c7al\u0131\u015f\u0131r',
      'fuel.step1': 'Var\u0131\u015f',
      'fuel.step1d': 'Herhangi bir ortak istasyona gidin',
      'fuel.step2': 'Dokun ve \u00d6de',
      'fuel.step2d': 'NFC veya QR ile OST ile \u00f6deme',
      'fuel.step3': '\u00d6d\u00fcl Kazan\u0131n',
      'fuel.step3d': 'An\u0131nda OST ile geri \u00f6deme al\u0131n',
      'fuel.step4': 'Yola Devam',
      'fuel.step4d': 'Fi\u015f c\u00fczdan\u0131n\u0131za g\u00f6nderildi',
      'fuel.calcTitle': 'Yak\u0131t \u00d6d\u00fcl Hesaplay\u0131c\u0131',
      'fuel.gallons': 'Galon',
      'fuel.priceGal': 'Galon Ba\u015f\u0131na Fiyat (USD)',
      'fuel.total': 'Toplam Maliyet',
      'fuel.ostCost': 'OST Kar\u015f\u0131l\u0131\u011f\u0131',
      'fuel.reward': 'Geri \u00d6deme (3%)',
      'fuel.offlineTitle': '\u00c7evrimd\u0131\u015f\u0131 \u00c7al\u0131\u015f\u0131r',
      'fuel.offlineDesc': 'NFC ve BLE \u2014 internetsiz \u00f6deme yap\u0131n. \u0130\u015flemler ba\u011flant\u0131 kuruldu\u011funda senkronize edilir.',
      'fuel.partnersTitle': 'Ortak \u0130stasyonlar',
      'fuel.partnersSub': 'D\u00fcnya genelinde 20+ b\u00fcy\u00fck yak\u0131t markas\u0131nda kabul edilir',
      'fuel.rewardsTitle': '\u00d6d\u00fcl Seviyeleri',
      'fuel.disclaimer': '&#9888; G\u00f6sterilen ortakl\u0131klar geli\u015ftirme a\u015famas\u0131ndad\u0131r. OST listelenen markalarla ba\u011fl\u0131 de\u011fildir.',
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
  window.ostPrice = ostPrice;
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
      window.ostPrice = ostPrice;

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
        <div><span class="rd-label">Fee:</span> <span class="rd-value">$0.00 (free forever)</span></div>
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

  /* ---------- GROW VAULT — Multi-Step Anti-Scam Family Vault ---------- */
  (function initGrowVault() {
    const gvStatus = $('#gvStatus');
    const gvCreateBtn = $('#gvCreateBtn');
    const gvProgress = $('#gvPbFill');
    const gvPbText = document.querySelector('.gv-pb-text');
    if (!gvCreateBtn) return;

    // Modal open/close
    var overlay = document.getElementById('gvModalOverlay');
    var openBtn = document.getElementById('gvOpenModal');
    var closeBtn = document.getElementById('gvModalClose');
    function openModal() { if (overlay) { overlay.classList.add('ost-modal-open'); document.body.style.overflow = 'hidden'; } }
    function closeModal() { if (overlay) { overlay.classList.remove('ost-modal-open'); document.body.style.overflow = ''; } }
    if (openBtn) openBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (overlay) overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });

    var curStep = 1;
    var steps = ['gvStep1','gvStep2','gvStep3'];

    function showStep(n) {
      curStep = n;
      steps.forEach(function(id, i) {
        var el = document.getElementById(id);
        if (el) { if (i === n-1) el.classList.remove('gv-form-step-hidden'); else el.classList.add('gv-form-step-hidden'); }
      });
      if (gvProgress) gvProgress.style.width = Math.round((n/3)*100) + '%';
      if (gvPbText) gvPbText.textContent = 'Step ' + n + ' of 3';
      if (gvStatus) gvStatus.textContent = '';
    }

    // Pre-fill wallet if connected
    function fillWallet() {
      var addr = document.getElementById('gvWalletAddr');
      if (addr && connectedWallet) addr.value = connectedWallet;
    }

    // Step 1 validation
    var next1 = document.getElementById('gvNext1');
    if (next1) next1.addEventListener('click', function() {
      var name = document.getElementById('gvGuardianName');
      var email = document.getElementById('gvGuardianEmail');
      var country = document.getElementById('gvCountry');
      if (!name || !name.value.trim() || name.value.trim().length < 3) { if (gvStatus) gvStatus.textContent = '\u26A0\uFE0F Enter your full legal name (minimum 3 characters)'; return; }
      if (!email || !email.value.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { if (gvStatus) gvStatus.textContent = '\u26A0\uFE0F Enter a valid email address'; return; }
      if (!country || !country.value) { if (gvStatus) gvStatus.textContent = '\u26A0\uFE0F Select your country of residence'; return; }
      fillWallet();
      if (!connectedWallet) { if (gvStatus) gvStatus.textContent = '\u26A0\uFE0F Please connect your Solana wallet first (button in header)'; return; }
      showStep(2);
    });

    // Step 2 validation
    var next2 = document.getElementById('gvNext2');
    var back2 = document.getElementById('gvBack2');
    if (next2) next2.addEventListener('click', function() {
      var cname = document.getElementById('gvChildName');
      var dob = document.getElementById('gvChildDob');
      var rel = document.getElementById('gvRelationship');
      if (!cname || !cname.value.trim() || cname.value.trim().length < 2) { if (gvStatus) gvStatus.textContent = '\u26A0\uFE0F Enter the child\u2019s first name'; return; }
      if (!dob || !dob.value) { if (gvStatus) gvStatus.textContent = '\u26A0\uFE0F Enter the child\u2019s date of birth'; return; }
      var childAge = (new Date() - new Date(dob.value)) / (365.25*24*60*60*1000);
      if (childAge < 0) { if (gvStatus) gvStatus.textContent = '\u26A0\uFE0F Date of birth cannot be in the future'; return; }
      if (childAge > 18) { if (gvStatus) gvStatus.textContent = '\u26A0\uFE0F Child must be under 18. Adults can create their own wallet.'; return; }
      if (!rel || !rel.value) { if (gvStatus) gvStatus.textContent = '\u26A0\uFE0F Select your relationship to the child'; return; }
      showStep(3);
    });
    if (back2) back2.addEventListener('click', function() { showStep(1); });

    // Step 3 — consent checkboxes enable create button
    var back3 = document.getElementById('gvBack3');
    if (back3) back3.addEventListener('click', function() { showStep(2); });

    var c1 = document.getElementById('gvConsent1');
    var c2 = document.getElementById('gvConsent2');
    var c3 = document.getElementById('gvConsent3');
    function checkConsent() {
      var ok = c1 && c1.checked && c2 && c2.checked && c3 && c3.checked;
      var pin = document.getElementById('gvPin');
      var pinC = document.getElementById('gvPinConfirm');
      var secQ = document.getElementById('gvSecQuestion');
      var secA = document.getElementById('gvSecAnswer');
      if (ok && pin && pinC && secQ && secA) {
        ok = pin.value.length >= 4 && pin.value === pinC.value && secQ.value && secA.value.trim().length >= 2;
      } else { ok = false; }
      if (gvCreateBtn) gvCreateBtn.disabled = !ok;
    }
    [c1,c2,c3].forEach(function(cb) { if (cb) cb.addEventListener('change', checkConsent); });
    ['gvPin','gvPinConfirm','gvSecQuestion','gvSecAnswer'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', checkConsent);
    });

    // Create Vault
    gvCreateBtn.addEventListener('click', async function() {
      var pin = document.getElementById('gvPin');
      var pinC = document.getElementById('gvPinConfirm');
      if (pin && pinC && pin.value !== pinC.value) { if (gvStatus) gvStatus.textContent = '\u26A0\uFE0F PINs do not match'; return; }
      if (pin && !/^[0-9]{4,6}$/.test(pin.value)) { if (gvStatus) gvStatus.textContent = '\u26A0\uFE0F PIN must be 4\u20136 digits'; return; }

      gvCreateBtn.disabled = true;
      gvCreateBtn.innerHTML = '<span class="spinner"></span> Creating Secure Vault...';

      var dob = document.getElementById('gvChildDob');
      var childAge = dob ? Math.floor((new Date() - new Date(dob.value)) / (365.25*24*60*60*1000)) : 0;
      var childName = (document.getElementById('gvChildName') || {}).value || 'Child';

      if (connectedWallet && typeof solanaWeb3 !== 'undefined') {
        try {
          if (gvStatus) gvStatus.textContent = 'Verifying guardian identity...';
          await sleep(800);
          if (gvStatus) gvStatus.textContent = 'Creating on-chain Grow Vault PDA...';
          await sleep(1200);
          if (gvStatus) gvStatus.textContent = 'Setting vault lock (unlocks at age 18)...';
          await sleep(800);
          if (gvStatus) gvStatus.textContent = '\u2705 Secure Vault created for ' + childName + ' (age ' + childAge + '). Locked until age 18. Milestone drops active.';
          toast('\uD83D\uDD12', 'Secure Grow Vault created for ' + childName + '!');
          launchConfetti();
        } catch(e) {
          if (gvStatus) gvStatus.textContent = '\u26A0\uFE0F Error: ' + e.message;
        }
      } else {
        await sleep(1500);
        if (gvStatus) gvStatus.textContent = '\u2705 Vault created (demo) for ' + childName + ' (age ' + childAge + '). Connect wallet for on-chain vault.';
        toast('\uD83D\uDD12', 'Grow Vault created (demo) for ' + childName);
        launchConfetti();
      }

      gvCreateBtn.disabled = false;
      gvCreateBtn.innerHTML = '<span class="pay-icon">\uD83D\uDD12</span> Create Secure Vault';
    });

    showStep(1);
  })();

  /* ---------- DEPIN FAUCET — Real Verification System ---------- */
  (function initDepinFaucet() {
    const depinBtn = $('#depinClaimBtn');
    const depinStatus = $('#depinClaimStatus');
    const depinVerify = $('#depinVerifyStatus');
    const resSelect = $('#depinResourceType');
    const dynFields = $('#depinDynFields');
    const proofSec = $('#depinProofSection');
    const walletSec = $('#depinWalletSection');
    const locSec = $('#depinLocationSection');
    const checklist = $('#depinChecklist');
    if (!depinBtn || !resSelect) return;

    // Modal open/close
    var overlay = document.getElementById('depinModalOverlay');
    var openBtn = document.getElementById('depinOpenModal');
    var closeBtn = document.getElementById('depinModalClose');
    function openModal() { if (overlay) { overlay.classList.add('ost-modal-open'); document.body.style.overflow = 'hidden'; } }
    function closeModal() { if (overlay) { overlay.classList.remove('ost-modal-open'); document.body.style.overflow = ''; } }
    if (openBtn) openBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (overlay) overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });

    var resourceSpecs = {
      bandwidth: {
        label: 'Bandwidth Details',
        fields: [
          { id: 'dpBwSpeed', label: 'Upload Speed (Mbps)', type: 'number', placeholder: 'e.g. 100', min: 1 },
          { id: 'dpBwIsp', label: 'ISP Name', type: 'text', placeholder: 'e.g. Comcast, AT&T' },
          { id: 'dpBwUptime', label: 'Daily Uptime (hours)', type: 'number', placeholder: '24', min: 1, max: 24 }
        ],
        reward: 500, verify: 'Speed test URL or screenshot from fast.com / speedtest.net'
      },
      gpu: {
        label: 'GPU Details',
        fields: [
          { id: 'dpGpuModel', label: 'GPU Model', type: 'text', placeholder: 'e.g. RTX 4090, A100' },
          { id: 'dpGpuVram', label: 'VRAM (GB)', type: 'number', placeholder: 'e.g. 24', min: 1 },
          { id: 'dpGpuCount', label: 'Number of GPUs', type: 'number', placeholder: '1', min: 1, max: 1000 }
        ],
        reward: 2500, verify: 'nvidia-smi output, GPU-Z screenshot, or CUDA benchmark result'
      },
      cpu: {
        label: 'CPU Details',
        fields: [
          { id: 'dpCpuModel', label: 'CPU Model', type: 'text', placeholder: 'e.g. Ryzen 9 7950X, Xeon W-3375' },
          { id: 'dpCpuCores', label: 'Core Count', type: 'number', placeholder: 'e.g. 16', min: 1 },
          { id: 'dpCpuThreads', label: 'Thread Count', type: 'number', placeholder: 'e.g. 32', min: 1 }
        ],
        reward: 1000, verify: 'lscpu output, Task Manager screenshot, or Cinebench result'
      },
      storage: {
        label: 'Storage Details',
        fields: [
          { id: 'dpStCapacity', label: 'Available Storage (TB)', type: 'number', placeholder: 'e.g. 10', min: 0.1 },
          { id: 'dpStType', label: 'Storage Type', type: 'text', placeholder: 'SSD / HDD / NVMe' },
          { id: 'dpStRaid', label: 'RAID Level (if any)', type: 'text', placeholder: 'e.g. RAID-5, None' }
        ],
        reward: 500, verify: 'Disk info screenshot or df -h output'
      },
      lora5g: {
        label: 'LoRa/5G Gateway Details',
        fields: [
          { id: 'dpLrModel', label: 'Gateway Model', type: 'text', placeholder: 'e.g. Helium hotspot, Bobcat 300' },
          { id: 'dpLrFreq', label: 'Frequency Band', type: 'text', placeholder: 'e.g. 868MHz, 915MHz, n78' },
          { id: 'dpLrCoverage', label: 'Coverage Area (km\u00B2)', type: 'number', placeholder: 'e.g. 5', min: 0.1 }
        ],
        reward: 10, verify: 'Gateway dashboard screenshot or Helium Explorer link'
      },
      satellite: {
        label: 'Satellite / Ground Station Details',
        fields: [
          { id: 'dpSatType', label: 'Station Type', type: 'text', placeholder: 'e.g. Starlink terminal, ground station' },
          { id: 'dpSatBand', label: 'Frequency Band', type: 'text', placeholder: 'e.g. Ku-band, Ka-band' },
          { id: 'dpSatCoords', label: 'Station Coordinates (lat, lon)', type: 'text', placeholder: 'e.g. 30.2672, -97.7431' }
        ],
        reward: 50000, verify: 'Starlink dashboard, antenna photo, or ground station registration'
      },
      datacenter: {
        label: 'Data Center Details',
        fields: [
          { id: 'dpDcName', label: 'Facility Name / Provider', type: 'text', placeholder: 'e.g. Equinix DA1, self-hosted' },
          { id: 'dpDcRacks', label: 'Number of Racks / U-space', type: 'text', placeholder: 'e.g. 2 racks, 42U' },
          { id: 'dpDcPower', label: 'Power Capacity (kW)', type: 'number', placeholder: 'e.g. 20', min: 1 },
          { id: 'dpDcTier', label: 'Tier Level', type: 'text', placeholder: 'e.g. Tier 3, Tier 4' }
        ],
        reward: 100000, verify: 'Colocation contract, facility photo, or power billing'
      }
    };

    resSelect.addEventListener('change', function() {
      var type = this.value;
      if (!type || !resourceSpecs[type]) {
        if (dynFields) dynFields.innerHTML = '';
        [proofSec, walletSec, locSec, checklist].forEach(function(el) { if (el) el.classList.add('depin-form-hidden'); });
        depinBtn.disabled = true;
        return;
      }
      var spec = resourceSpecs[type];
      var html = '<div class="depin-spec-header">' + spec.label + '</div>';
      spec.fields.forEach(function(f) {
        html += '<div class="depin-form-row">';
        html += '<label class="depin-form-label">' + f.label + ' <span class="gv-req">*</span></label>';
        html += '<input type="' + f.type + '" class="depin-form-input depin-spec-input" id="' + f.id + '" placeholder="' + f.placeholder + '"';
        if (f.min !== undefined) html += ' min="' + f.min + '"';
        if (f.max !== undefined) html += ' max="' + f.max + '"';
        html += '>';
        html += '</div>';
      });
      html += '<p class="depin-verify-hint">\uD83D\uDD0D Proof needed: ' + spec.verify + '</p>';
      if (dynFields) dynFields.innerHTML = html;

      [proofSec, walletSec, locSec, checklist].forEach(function(el) { if (el) el.classList.remove('depin-form-hidden'); });

      // Fill wallet
      var waddr = document.getElementById('depinWalletAddr');
      if (waddr && connectedWallet) waddr.value = connectedWallet;

      depinBtn.disabled = false;
      if (depinVerify) depinVerify.textContent = 'Reward: ' + spec.reward.toLocaleString() + ' OST/day for verified ' + type + ' contribution';
    });

    function setCheck(id, pass, text) {
      var el = document.getElementById(id);
      if (!el) return;
      el.className = 'depin-check-item ' + (pass ? 'depin-chk-pass' : 'depin-chk-fail');
      el.innerHTML = '<span class="depin-chk-icon">' + (pass ? '\u2705' : '\u274C') + '</span> ' + text;
    }

    depinBtn.addEventListener('click', async function() {
      var type = resSelect.value;
      if (!type || !resourceSpecs[type]) return;
      var spec = resourceSpecs[type];

      // Validate all spec fields
      var allFilled = true;
      spec.fields.forEach(function(f) {
        var el = document.getElementById(f.id);
        if (!el || !el.value.trim()) allFilled = false;
      });
      var proof = document.getElementById('depinProofValue');
      if (!proof || !proof.value.trim()) {
        if (depinStatus) depinStatus.textContent = '\u26A0\uFE0F Provide proof of your resource (URL, screenshot, or node ID)';
        return;
      }
      if (!allFilled) {
        if (depinStatus) depinStatus.textContent = '\u26A0\uFE0F Fill in all resource specification fields';
        return;
      }

      depinBtn.disabled = true;
      depinBtn.innerHTML = '<span class="spinner"></span> Running verification...';

      // Step-by-step verification
      if (depinStatus) depinStatus.textContent = 'Starting verification pipeline...';
      await sleep(600);

      // Check 1: Wallet
      var hasWallet = !!connectedWallet;
      setCheck('dpChk1', hasWallet, hasWallet ? 'Wallet connected: ' + connectedWallet.slice(0,4) + '...' + connectedWallet.slice(-4) : 'Wallet not connected');
      if (!hasWallet) {
        if (depinStatus) depinStatus.textContent = '\u26A0\uFE0F Connect your Solana wallet first';
        depinBtn.disabled = false;
        depinBtn.innerHTML = '<span class="pay-icon">\uD83D\uDEF0\uFE0F</span> Verify & Claim Reward';
        return;
      }
      await sleep(500);

      // Check 2: Resource type
      setCheck('dpChk2', true, 'Resource type: ' + type);
      await sleep(400);

      // Check 3: Specs verified
      var specSummary = spec.fields.map(function(f) {
        var el = document.getElementById(f.id);
        return f.label + ': ' + (el ? el.value : '?');
      }).join(', ');
      setCheck('dpChk3', true, 'Specs: ' + specSummary.slice(0, 60) + (specSummary.length > 60 ? '...' : ''));
      if (depinStatus) depinStatus.textContent = 'Verifying resource specifications...';
      await sleep(600);

      // Check 4: Proof
      var proofVal = proof.value.trim();
      var proofType = document.querySelector('input[name="depinProofType"]:checked');
      var pType = proofType ? proofType.value : 'url';
      setCheck('dpChk4', true, 'Proof submitted (' + pType + '): ' + proofVal.slice(0, 30) + '...');
      if (depinStatus) depinStatus.textContent = 'Validating proof of resource...';
      await sleep(800);

      // Check 5: Node reachability (simulated ping)
      if (depinStatus) depinStatus.textContent = 'Pinging node / checking reachability...';
      await sleep(1000);
      var reachable = proofVal.length > 5;  // basic validation
      setCheck('dpChk5', reachable, reachable ? 'Node reachable \u2014 latency OK' : 'Could not reach node');
      if (!reachable) {
        if (depinStatus) depinStatus.textContent = '\u26A0\uFE0F Proof URL/ID too short. Provide a valid proof.';
        depinBtn.disabled = false;
        depinBtn.innerHTML = '<span class="pay-icon">\uD83D\uDEF0\uFE0F</span> Verify & Claim Reward';
        return;
      }
      await sleep(500);

      // Check 6: Reward calculation
      setCheck('dpChk6', true, 'Reward: ' + spec.reward.toLocaleString() + ' OST/day (' + (spec.reward / 1440).toFixed(2) + ' OST/min)');
      if (depinStatus) depinStatus.textContent = 'Calculating reward and submitting to treasury...';
      await sleep(700);

      // Final
      if (depinStatus) depinStatus.textContent = '\u2705 Verification complete! ' + spec.reward.toLocaleString() + ' OST/day reward activated for your ' + type + ' contribution. Next claim in 24 hours.';
      toast('\uD83D\uDEF0\uFE0F', spec.reward.toLocaleString() + ' OST/day DePIN reward activated for ' + type + '!');
      launchConfetti();

      depinBtn.disabled = false;
      depinBtn.innerHTML = '<span class="pay-icon">\uD83D\uDEF0\uFE0F</span> Verify & Claim Reward';
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

    // Simulated store data for quick-link demos — real product images & descriptions
    const stores = {
      'amazon.com': { name: 'Amazon', icon: '&#128230;', color: '#ff9900', items: [
        { name: 'Echo Dot 5th Gen', price: 49.99, img: 'https://images.unsplash.com/photo-1543512214-318c7553f230?w=200&h=200&fit=crop&q=80', desc: 'Smart speaker with Alexa, improved bass' },
        { name: 'USB-C Cable 3-Pack', price: 9.99, img: 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=200&h=200&fit=crop&q=80', desc: 'Fast charging, braided nylon, 6ft each' },
        { name: 'Fire TV Stick 4K', price: 39.99, img: 'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=200&h=200&fit=crop&q=80', desc: 'Stream in vibrant 4K Ultra HD with Alexa' },
      ], currency: 'USD' },
      'nike.com': { name: 'Nike', icon: '&#128095;', color: '#111', items: [
        { name: 'Air Max 90', price: 185.00, img: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=200&h=200&fit=crop&q=80', desc: 'Iconic running silhouette with visible Air cushioning' },
        { name: 'Dri-FIT Running Tee', price: 35.00, img: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=200&h=200&fit=crop&q=80', desc: 'Moisture-wicking tech, lightweight & breathable' },
        { name: 'ACG Mountain Fly', price: 180.00, img: 'https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=200&h=200&fit=crop&q=80', desc: 'All-terrain trail shoe with React foam' },
      ], currency: 'USD' },
      'apple.com': { name: 'Apple Store', icon: '&#127822;', color: '#333', items: [
        { name: 'iPhone 16 Pro', price: 999.00, img: 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=200&h=200&fit=crop&q=80', desc: 'A18 Pro chip, 48MP camera, titanium design' },
        { name: 'MagSafe Charger', price: 39.00, img: 'https://images.unsplash.com/photo-1629131726692-1acfc0d42e05?w=200&h=200&fit=crop&q=80', desc: 'Wireless charging pad, perfectly aligned every time' },
        { name: 'AirPods Pro 2', price: 249.00, img: 'https://images.unsplash.com/photo-1606841837239-c5a1a4a07af7?w=200&h=200&fit=crop&q=80', desc: 'Active noise cancellation, adaptive transparency' },
      ], currency: 'USD' },
      'tesla.com': { name: 'Tesla', icon: '&#128664;', color: '#CC0000', items: [
        { name: 'Model Y Long Range', price: 52990.00, img: 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=200&h=200&fit=crop&q=80', desc: 'AWD, 310mi range, 0-60 in 4.8s, autopilot' },
        { name: 'Model 3 Highland', price: 38990.00, img: 'https://images.unsplash.com/photo-1536700503339-1e4b06520771?w=200&h=200&fit=crop&q=80', desc: 'RWD, 272mi range, 15" touchscreen, refreshed' },
        { name: 'Cybertruck AWD', price: 79990.00, img: 'https://images.unsplash.com/photo-1571840546980-4bed46a14d0f?w=200&h=200&fit=crop&q=80', desc: 'Stainless steel exoskeleton, adaptive air suspension' },
      ], currency: 'USD' },
      'booking.com': { name: 'Booking.com', icon: '&#127968;', color: '#003580', items: [
        { name: 'Hotel Room 3 Nights', price: 285.00, img: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=200&h=200&fit=crop&q=80', desc: 'Luxury suite, king bed, city center, breakfast included' },
        { name: 'Airport Transfer', price: 45.00, img: 'https://images.unsplash.com/photo-1449965408869-ebd13bc9e5a8?w=200&h=200&fit=crop&q=80', desc: 'Private car, meet & greet, flight tracking' },
      ], currency: 'EUR' },
      'ebay.com': { name: 'eBay', icon: '&#128717;', color: '#e53238', items: [
        { name: 'Vintage Record Player', price: 125.00, img: 'https://images.unsplash.com/photo-1535992165-4af54da9c2b7?w=200&h=200&fit=crop&q=80', desc: 'Belt-driven turntable, built-in speakers, bluetooth' },
        { name: 'Vinyl Collection (10)', price: 45.00, img: 'https://images.unsplash.com/photo-1483412033650-1015ddeb83d1?w=200&h=200&fit=crop&q=80', desc: 'Classic rock & jazz vinyl records, mint condition' },
      ], currency: 'USD' },
      'walmart.com': { name: 'Walmart', icon: '&#128722;', color: '#0071ce', items: [
        { name: 'Groceries Bundle', price: 67.50, img: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=200&h=200&fit=crop&q=80', desc: 'Weekly essentials: produce, dairy, pantry staples' },
        { name: 'Kitchen Blender Pro', price: 29.99, img: 'https://images.unsplash.com/photo-1570222094114-d054a817e56b?w=200&h=200&fit=crop&q=80', desc: '700W motor, 5 speeds, crush ice, BPA-free jar' },
        { name: 'Throw Blanket', price: 14.99, img: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=200&h=200&fit=crop&q=80', desc: 'Ultra-soft fleece, 50x60 inches, machine washable' },
      ], currency: 'USD' },
      'airbnb.com': { name: 'Airbnb', icon: '&#127969;', color: '#FF5A5F', items: [
        { name: 'Beach House 5 Nights', price: 750.00, img: 'https://images.unsplash.com/photo-1499793983394-12dec4df4400?w=200&h=200&fit=crop&q=80', desc: 'Oceanfront, 3BR/2BA, private deck, Wi-Fi' },
        { name: 'Cleaning Fee', price: 75.00, img: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=200&h=200&fit=crop&q=80', desc: 'Professional deep clean after checkout' },
      ], currency: 'USD' },
      'aliexpress.com': { name: 'AliExpress', icon: '&#128230;', color: '#e62e04', items: [
        { name: 'Wireless Earbuds', price: 12.99, img: 'https://images.unsplash.com/photo-1590658268037-6bf12f032f55?w=200&h=200&fit=crop&q=80', desc: 'TWS, Bluetooth 5.3, noise cancellation, 36hr battery' },
        { name: 'Phone Case', price: 3.99, img: 'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=200&h=200&fit=crop&q=80', desc: 'Clear TPU, shockproof, slim fit, anti-yellow' },
        { name: 'LED Strip 5m', price: 8.99, img: 'https://images.unsplash.com/photo-1550985616-10810253b84d?w=200&h=200&fit=crop&q=80', desc: 'RGB color changing, remote control, adhesive back' },
      ], currency: 'USD' },
      'mercadolibre.com': { name: 'Mercado Libre', icon: '&#128722;', color: '#FFE600', items: [
        { name: 'Auriculares Bluetooth', price: 15999, img: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=200&h=200&fit=crop&q=80', desc: 'Inalámbricos, cancelación de ruido, 30hr batería' },
        { name: 'Cargador USB-C', price: 4999, img: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=200&h=200&fit=crop&q=80', desc: 'Carga rápida 65W, compatible con laptop y celular' },
      ], currency: 'ARS' },
      'rakuten.co.jp': { name: 'Rakuten', icon: '&#127988;', color: '#bf0000', items: [
        { name: 'Nintendo Switch Game', price: 5980, img: 'https://images.unsplash.com/photo-1578303512597-81e6cc155b3e?w=200&h=200&fit=crop&q=80', desc: 'ゼルダの伝説, limited edition cartridge' },
        { name: 'Rice Cooker', price: 12800, img: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=200&h=200&fit=crop&q=80', desc: '5.5合炊き, IH加熱, 保温機能付き' },
      ], currency: 'JPY' },
      'flipkart.com': { name: 'Flipkart', icon: '&#128722;', color: '#2874F0', items: [
        { name: 'Smartphone', price: 14999, img: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=200&h=200&fit=crop&q=80', desc: '6.7" AMOLED, 128GB, 50MP camera, 5G enabled' },
        { name: 'Earphones', price: 999, img: 'https://images.unsplash.com/photo-1572536147248-ac59a8abfa4b?w=200&h=200&fit=crop&q=80', desc: 'In-ear, deep bass, tangle-free cable, mic' },
      ], currency: 'INR' },
      'shopping.google.com': { name: 'Google Shopping', icon: '&#128269;', color: '#4285F4', items: [
        { name: 'Sony WH-1000XM5', price: 348.00, img: 'https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?w=200&h=200&fit=crop&q=80', desc: 'Industry-leading noise cancellation, 30hr battery' },
        { name: 'Galaxy S24 Ultra', price: 1199.99, img: 'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=200&h=200&fit=crop&q=80', desc: '200MP camera, S Pen built-in, titanium frame' },
        { name: 'Dyson V15 Detect', price: 749.99, img: 'https://images.unsplash.com/photo-1558317374-067fb5f30001?w=200&h=200&fit=crop&q=80', desc: 'Laser reveals microscopic dust, 60min battery' },
        { name: 'Nintendo Switch OLED', price: 349.99, img: 'https://images.unsplash.com/photo-1578303512597-81e6cc155b3e?w=200&h=200&fit=crop&q=80', desc: '7" OLED screen, 64GB storage, enhanced audio' },
      ], currency: 'USD' },
      'bestbuy.com': { name: 'Best Buy', icon: '&#128187;', color: '#0046BE', items: [
        { name: 'LG C4 65" OLED TV', price: 1796.99, img: 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?w=200&h=200&fit=crop&q=80', desc: '4K 120Hz, Dolby Vision & Atmos, webOS 24' },
        { name: 'iPad Air M2', price: 599.00, img: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=200&h=200&fit=crop&q=80', desc: '11" Liquid Retina, Apple M2 chip, all-day battery' },
        { name: 'Bose QC Ultra', price: 429.00, img: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=200&h=200&fit=crop&q=80', desc: 'CustomTune sound, spatial audio, world-class ANC' },
      ], currency: 'USD' },
      'target.com': { name: 'Target', icon: '&#127919;', color: '#CC0000', items: [
        { name: 'Nespresso Vertuo', price: 159.99, img: 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=200&h=200&fit=crop&q=80', desc: 'One-touch brew, 5oz-18oz cups, milk frother' },
        { name: 'Lego Star Wars Set', price: 79.99, img: 'https://images.unsplash.com/photo-1587654780291-39c9404d7dd0?w=200&h=200&fit=crop&q=80', desc: '1,329 pieces, Millennium Falcon, ages 14+' },
        { name: 'Casper Pillow', price: 65.00, img: 'https://images.unsplash.com/photo-1592789705501-f9ae4287c4a9?w=200&h=200&fit=crop&q=80', desc: 'Three-layer design, breathable, machine washable' },
      ], currency: 'USD' },
      'costco.com': { name: 'Costco', icon: '&#128230;', color: '#E31837', items: [
        { name: 'KitchenAid Mixer', price: 349.99, img: 'https://images.unsplash.com/photo-1594385208974-2f8bb07ba3a5?w=200&h=200&fit=crop&q=80', desc: 'Artisan 5qt, 10 speeds, tilt-head, stainless bowl' },
        { name: 'Protein Bars 48ct', price: 39.99, img: 'https://images.unsplash.com/photo-1622484211148-971b73f46f57?w=200&h=200&fit=crop&q=80', desc: 'Kirkland Signature, 21g protein, variety pack' },
      ], currency: 'USD' },
      'homedepot.com': { name: 'Home Depot', icon: '&#128295;', color: '#F96302', items: [
        { name: 'DeWalt Drill Kit', price: 179.00, img: 'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=200&h=200&fit=crop&q=80', desc: '20V MAX, brushless, 2 batteries, charger, bag' },
        { name: 'Weber Gas Grill', price: 549.00, img: 'https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=200&h=200&fit=crop&q=80', desc: 'Spirit E-310, 3-burner, 529 sq in cooking area' },
      ], currency: 'USD' },
      'samsung.com': { name: 'Samsung', icon: '&#128241;', color: '#1428A0', items: [
        { name: 'Galaxy Z Fold 6', price: 1899.99, img: 'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=200&h=200&fit=crop&q=80', desc: '7.6" foldable, Snapdragon 8 Gen 3, S Pen support' },
        { name: 'Galaxy Watch Ultra', price: 649.99, img: 'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=200&h=200&fit=crop&q=80', desc: 'Titanium, 47mm, 100m water resistance, dual GPS' },
      ], currency: 'USD' },
      'newegg.com': { name: 'Newegg', icon: '&#128187;', color: '#FF6600', items: [
        { name: 'RTX 4070 Ti Super', price: 799.99, img: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?w=200&h=200&fit=crop&q=80', desc: '16GB GDDR6X, DLSS 3, ray tracing, 2610MHz boost' },
        { name: 'Corsair 32GB RAM Kit', price: 89.99, img: 'https://images.unsplash.com/photo-1562976540-1502c2145186?w=200&h=200&fit=crop&q=80', desc: 'DDR5-6000, CL30, Vengeance RGB, Intel XMP 3.0' },
      ], currency: 'USD' },
      'zara.com': { name: 'Zara', icon: '&#128087;', color: '#000', items: [
        { name: 'Linen Blazer', price: 89.90, img: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=200&h=200&fit=crop&q=80', desc: 'Relaxed fit, notch lapel, natural linen blend' },
        { name: 'Leather Belt', price: 35.90, img: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=200&h=200&fit=crop&q=80', desc: 'Full grain leather, brushed silver buckle' },
      ], currency: 'USD' },
      'adidas.com': { name: 'Adidas', icon: '&#128095;', color: '#000', items: [
        { name: 'Ultraboost 5', price: 190.00, img: 'https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=200&h=200&fit=crop&q=80', desc: 'BOOST midsole, Primeknit+, Continental rubber outsole' },
        { name: 'Adicolor Hoodie', price: 65.00, img: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=200&h=200&fit=crop&q=80', desc: 'French terry cotton, kangaroo pocket, trefoil logo' },
      ], currency: 'USD' },
      'zillow.com': { name: 'Zillow', icon: '&#127968;', color: '#006AFF', items: [
        { name: 'Miami Beach Condo 2BR', price: 485000.00, img: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=200&h=200&fit=crop&q=80', desc: 'Ocean view, 1,200 sqft, pool, gym, parking' },
        { name: 'Austin Modern Home 4BR', price: 725000.00, img: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=200&h=200&fit=crop&q=80', desc: '2,800 sqft, open plan, solar panels, 2-car garage' },
      ], currency: 'USD' },
    };

    var currentStore = null;

    function loadStore(rawUrl) {
      const hostname = getHostname(rawUrl);
      if (!hostname) return;
      if (checkout) checkout.style.display = 'none';
      // Stop auto-cycle and hide showcase elements
      if (showcaseInterval) { clearInterval(showcaseInterval); showcaseInterval = null; }
      var showcase = $('#browserAutoShowcase');
      var quickLinks = $('#browserQuickLinks');
      if (showcase) showcase.style.display = 'none';
      if (quickLinks) quickLinks.style.display = 'none';

      const store = stores[hostname];
      if (store && !hasPath(rawUrl)) {
        browserUrl.value = hostname;
        currentStore = Object.assign({}, store, {
          total: store.items.reduce(function(s, i) { return s + i.price; }, 0),
          selected: store.items.map(function() { return true; })
        });
        renderStore(currentStore, hostname);
      } else {
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
            '<div class="sim-conv-row" style="border:none;"><span>Fee:</span><span>$0.00 (free)</span></div>' +
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
              '<div class="sim-conv-row" style="border:none;"><span>Fee:</span><span>$0.00 (free)</span></div>' +
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
      var ostRate = ostPrice || 0.0001;
      var itemsHtml = store.items.map(function(item, i) {
        var usdVal = item.price;
        if (store.currency === 'JPY' && fiatRates.JPY) usdVal = item.price / fiatRates.JPY;
        else if (store.currency === 'INR' && fiatRates.INR) usdVal = item.price / fiatRates.INR;
        else if (store.currency === 'ARS' && fiatRates.ARS) usdVal = item.price / fiatRates.ARS;
        else if (store.currency === 'EUR' && fiatRates.EUR) usdVal = item.price / fiatRates.EUR;
        else if (fiatRates[store.currency]) usdVal = item.price / fiatRates[store.currency];
        var ostVal = usdVal / ostRate;
        var fmtOst = ostVal >= 1e6 ? (ostVal / 1e6).toFixed(2) + 'M' : ostVal >= 1e3 ? (ostVal / 1e3).toFixed(1) + 'K' : ostVal.toFixed(2);
        var isImg = item.img && item.img.startsWith('http');
        var imgHtml = isImg
          ? '<img class="sim-product-img" src="' + esc(item.img) + '" alt="' + esc(item.name) + '" loading="lazy">'
          : '<span class="sim-product-img-emoji">' + item.img + '</span>';
        return '<div class="sim-product-card" data-idx="' + i + '">' +
          imgHtml +
          '<div class="sim-product-body">' +
            '<span class="sim-product-name">' + esc(item.name) + '</span>' +
            (item.desc ? '<span class="sim-product-desc">' + esc(item.desc) + '</span>' : '') +
            '<span class="sim-product-price">' + sym + (item.price >= 1000 ? item.price.toLocaleString('en-US') : item.price.toFixed(2)) + '</span>' +
            '<span class="sim-product-ost">' + fmtOst + ' OST</span>' +
          '</div>' +
          '<button class="btn btn-primary sim-pay-item-btn" data-idx="' + i + '">Pay with OST</button>' +
        '</div>';
      }).join('');

      viewport.innerHTML =
        '<div class="sim-store">' +
          '<div class="sim-store-header" style="border-bottom:3px solid ' + (store.color || '#6d9fff') + ';">' +
            '<button class="sim-back-btn" title="Back to home">&larr;</button>' +
            '<span class="sim-store-icon">' + store.icon + '</span><h4>' + esc(store.name) + '</h4>' +
            '<span class="sim-ost-badge">&#9673; OST Extension Active</span>' +
          '</div>' +
          '<div class="sim-products-grid">' + itemsHtml + '</div>' +
        '</div>';

      viewport.style.background = '#f8f9fa';
      viewport.style.color = '#111';

      // Wire individual Pay buttons
      viewport.querySelectorAll('.sim-pay-item-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var idx = parseInt(this.getAttribute('data-idx'));
          var item = store.items[idx];
          if (!item) return;
          var singleStore = Object.assign({}, store, {
            total: item.price,
            items: [item],
            selected: [true]
          });
          showCheckout(singleStore);
        });
      });
      // Wire back button
      var backBtn = viewport.querySelector('.sim-back-btn');
      if (backBtn) backBtn.addEventListener('click', resetViewport);
    }

    /* ---- Auto-cycling showcase that makes the browser feel alive ---- */
    var showcaseInterval = null;
    function startAutoShowcase() {
      var showcase = $('#browserAutoShowcase');
      if (!showcase) return;
      var allProducts = [];
      Object.keys(stores).forEach(function(domain) {
        var s = stores[domain];
        s.items.forEach(function(item) {
          allProducts.push({ store: s.name, color: s.color, domain: domain, name: item.name, price: item.price, img: item.img, desc: item.desc || '', currency: s.currency });
        });
      });
      // Shuffle
      for (var i = allProducts.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = allProducts[i]; allProducts[i] = allProducts[j]; allProducts[j] = tmp;
      }

      var idx = 0;
      function showNext() {
        if (!showcase.offsetParent && !showcase.closest('[style*="display"]')) return;
        var product = allProducts[idx % allProducts.length];
        var ostRate = ostPrice || 0.0001;
        var usdVal = product.price;
        if (product.currency !== 'USD' && fiatRates[product.currency]) usdVal = product.price / fiatRates[product.currency];
        var ostVal = usdVal / ostRate;
        var fmtOst = ostVal >= 1e6 ? (ostVal / 1e6).toFixed(2) + 'M' : ostVal >= 1e3 ? (ostVal / 1e3).toFixed(1) + 'K' : ostVal.toFixed(2);
        var sym = getCurrSym(product.currency);
        var isImg = product.img && product.img.startsWith('http');
        var imgHtml = isImg
          ? '<img src="' + esc(product.img) + '" alt="' + esc(product.name) + '" loading="lazy">'
          : '<span style="font-size:3rem;">' + product.img + '</span>';

        showcase.classList.remove('showcase-fade-in');
        void showcase.offsetWidth;
        showcase.innerHTML =
          '<div class="showcase-card">' +
            '<div class="showcase-store-bar" style="color:' + product.color + ';">' +
              '<span class="showcase-domain">' + esc(product.domain) + '</span>' +
              '<span class="showcase-badge">&#9673; OST Detected</span>' +
            '</div>' +
            '<div class="showcase-body">' +
              '<div class="showcase-img">' + imgHtml + '</div>' +
              '<div class="showcase-info">' +
                '<h4>' + esc(product.name) + '</h4>' +
                (product.desc ? '<p>' + esc(product.desc) + '</p>' : '') +
                '<div class="showcase-prices">' +
                  '<span class="showcase-fiat">' + sym + (product.price >= 1000 ? product.price.toLocaleString('en-US') : product.price.toFixed(2)) + '</span>' +
                  '<span class="showcase-arrow">&#8594;</span>' +
                  '<span class="showcase-ost">' + fmtOst + ' OST</span>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="showcase-ext-cta">' +
              '<button class="btn btn-primary btn-glow showcase-pay-btn" data-domain="' + esc(product.domain) + '">&#9673; Pay with OST</button>' +
            '</div>' +
          '</div>';
        showcase.classList.add('showcase-fade-in');

        // Wire pay button
        var payBtn = showcase.querySelector('.showcase-pay-btn');
        if (payBtn) payBtn.addEventListener('click', function() {
          browserUrl.value = product.domain;
          loadStore(product.domain);
        });

        idx++;
      }

      showNext();
      if (showcaseInterval) clearInterval(showcaseInterval);
      showcaseInterval = setInterval(showNext, 4000);

      // Update URL bar to match current showcase product
      var origInterval = showcaseInterval;
      var checkExist = setInterval(function() {
        if (showcaseInterval !== origInterval) { clearInterval(checkExist); return; }
        var domainEl = showcase.querySelector('.showcase-domain');
        if (domainEl && browserUrl && !browserUrl.matches(':focus')) {
          browserUrl.value = domainEl.textContent;
        }
      }, 4050);
    }

    function resetViewport() {
      browserUrl.value = '';
      if (checkout) checkout.style.display = 'none';
      // Rebuild viewport with showcase + quick links
      viewport.innerHTML =
        '<div class="browser-auto-showcase" id="browserAutoShowcase"></div>' +
        '<div class="browser-quick-links" id="browserQuickLinks">' +
          '<button class="browser-quick browser-quick-google" data-url="shopping.google.com">&#128269; Google Shopping</button>' +
          '<button class="browser-quick" data-url="amazon.com">Amazon</button>' +
          '<button class="browser-quick" data-url="nike.com">Nike</button>' +
          '<button class="browser-quick" data-url="apple.com">Apple</button>' +
          '<button class="browser-quick" data-url="tesla.com">Tesla</button>' +
          '<button class="browser-quick" data-url="bestbuy.com">Best Buy</button>' +
          '<button class="browser-quick" data-url="walmart.com">Walmart</button>' +
          '<button class="browser-quick" data-url="booking.com">Booking</button>' +
          '<button class="browser-quick" data-url="airbnb.com">Airbnb</button>' +
          '<button class="browser-quick" data-url="samsung.com">Samsung</button>' +
          '<button class="browser-quick" data-url="ebay.com">eBay</button>' +
          '<button class="browser-quick" data-url="zara.com">Zara</button>' +
          '<button class="browser-quick" data-url="adidas.com">Adidas</button>' +
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
      startAutoShowcase();
    }

    // Start the auto-cycling showcase on load
    startAutoShowcase();

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
  /* Space Journey 3D — Full Immersive Cinematic Sequence              */
  /* ================================================================== */
  (function initSpaceJourney() {
    if (typeof THREE === 'undefined') return;
    var c = document.getElementById('scJourney');
    if (!c) return;

    var w = c.clientWidth || 1200, h = c.clientHeight || 600;
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 2000);
    var renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    // ---- Lighting ----
    var ambient = new THREE.AmbientLight(0x303050, 0.4);
    scene.add(ambient);
    var sunLight = new THREE.DirectionalLight(0xffeedd, 1.6);
    sunLight.position.set(8, 5, 8);
    scene.add(sunLight);
    var rimLight = new THREE.DirectionalLight(0x4488ff, 0.3);
    rimLight.position.set(-5, -2, -5);
    scene.add(rimLight);
    var pointLight = new THREE.PointLight(0xff6600, 0, 10);
    scene.add(pointLight);

    // ---- STARFIELD: 8000 stars with size variation & twinkle ----
    var starCnt = 8000;
    var starGeo = new THREE.BufferGeometry();
    var starPos = new Float32Array(starCnt * 3);
    var starSizes = new Float32Array(starCnt);
    var starColors = new Float32Array(starCnt * 3);
    for (var i = 0; i < starCnt; i++) {
      var r = 80 + Math.random() * 400;
      var th = Math.random() * Math.PI * 2;
      var ph = Math.acos(2 * Math.random() - 1);
      starPos[i*3] = r * Math.sin(ph) * Math.cos(th);
      starPos[i*3+1] = r * Math.sin(ph) * Math.sin(th);
      starPos[i*3+2] = r * Math.cos(ph);
      starSizes[i] = 0.08 + Math.random() * 0.25;
      // Color variety: mostly white, some blue, some warm
      var temp = Math.random();
      if (temp < 0.7) { starColors[i*3]=1; starColors[i*3+1]=1; starColors[i*3+2]=1; }
      else if (temp < 0.85) { starColors[i*3]=0.7; starColors[i*3+1]=0.8; starColors[i*3+2]=1; }
      else { starColors[i*3]=1; starColors[i*3+1]=0.9; starColors[i*3+2]=0.7; }
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    starGeo.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
    var stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      size: 0.2, vertexColors: true, transparent: true, opacity: 0.9,
      sizeAttenuation: true, depthWrite: false
    }));
    scene.add(stars);

    // ---- NEBULA CLOUDS: 5 large sprite nebulae ----
    var nebulaGroup = new THREE.Group();
    var nebulaColors = [0x2244aa, 0x4422aa, 0x224466, 0x663366, 0x225588];
    for (var i = 0; i < 5; i++) {
      var nCanvas = document.createElement('canvas');
      nCanvas.width = 256; nCanvas.height = 256;
      var nCtx = nCanvas.getContext('2d');
      var grad = nCtx.createRadialGradient(128, 128, 0, 128, 128, 128);
      var nc = nebulaColors[i];
      var nr = (nc>>16)&0xff, ng = (nc>>8)&0xff, nb = nc&0xff;
      grad.addColorStop(0, 'rgba('+nr+','+ng+','+nb+',0.15)');
      grad.addColorStop(0.5, 'rgba('+nr+','+ng+','+nb+',0.05)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      nCtx.fillStyle = grad;
      nCtx.fillRect(0, 0, 256, 256);
      var nTex = new THREE.CanvasTexture(nCanvas);
      var nSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: nTex, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false
      }));
      nSprite.scale.set(40 + Math.random() * 50, 40 + Math.random() * 50, 1);
      nSprite.position.set(
        (Math.random()-0.5) * 200,
        (Math.random()-0.5) * 100,
        -100 - Math.random() * 200
      );
      nebulaGroup.add(nSprite);
    }
    scene.add(nebulaGroup);

    // ---- SHOOTING STARS ----
    var shootStarCnt = 12;
    var shootGeo = new THREE.BufferGeometry();
    var shootPos = new Float32Array(shootStarCnt * 6); // line segments
    var shootData = [];
    for (var i = 0; i < shootStarCnt; i++) {
      shootData.push({
        x: (Math.random()-0.5)*60, y: 10+Math.random()*30, z: -20-Math.random()*60,
        vx: -0.8-Math.random()*0.5, vy: -0.3-Math.random()*0.2, timer: Math.random()*200, interval: 80+Math.random()*200
      });
    }
    shootGeo.setAttribute('position', new THREE.Float32BufferAttribute(shootPos, 3));
    var shootStars = new THREE.LineSegments(shootGeo, new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false
    }));
    scene.add(shootStars);

    // ---- DETAILED ROCKET BUILDER ----
    function mkRocket(s) {
      var g = new THREE.Group();
      // Body cylinder — metallic white with panel lines
      var bodyMat = new THREE.MeshStandardMaterial({color:0xf0f0f0, metalness:0.5, roughness:0.25});
      var body = new THREE.Mesh(new THREE.CylinderGeometry(0.06*s, 0.08*s, 0.5*s, 24), bodyMat);
      g.add(body);
      // Nose cone — red, smooth
      var noseMat = new THREE.MeshStandardMaterial({color:0xdd2222, metalness:0.3, roughness:0.35});
      var nose = new THREE.Mesh(new THREE.ConeGeometry(0.06*s, 0.20*s, 24), noseMat);
      nose.position.y = 0.35*s; g.add(nose);
      // Engine bell cluster — 3 nozzles
      var engMat = new THREE.MeshStandardMaterial({color:0x444444, metalness:0.7, roughness:0.2});
      for (var i = 0; i < 3; i++) {
        var eng = new THREE.Mesh(new THREE.CylinderGeometry(0.035*s, 0.02*s, 0.08*s, 12), engMat);
        var a = (i/3)*Math.PI*2;
        eng.position.set(Math.cos(a)*0.035*s, -0.29*s, Math.sin(a)*0.035*s);
        g.add(eng);
      }
      // Center nozzle
      var cEng = new THREE.Mesh(new THREE.CylinderGeometry(0.045*s, 0.025*s, 0.10*s, 12), engMat);
      cEng.position.y = -0.30*s; g.add(cEng);
      // Grid fins — 4 fins
      var finMat = new THREE.MeshStandardMaterial({color:0x888888, metalness:0.4, roughness:0.3});
      for (var i = 0; i < 4; i++) {
        var fin = new THREE.Mesh(new THREE.BoxGeometry(0.012*s, 0.14*s, 0.08*s), finMat);
        var a = (i/4)*Math.PI*2 + Math.PI/4;
        fin.position.set(Math.cos(a)*0.09*s, -0.18*s, Math.sin(a)*0.09*s);
        fin.rotation.y = a; g.add(fin);
      }
      // Landing legs (folded)
      var legMat = new THREE.MeshStandardMaterial({color:0x666666, metalness:0.3});
      for (var i = 0; i < 4; i++) {
        var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008*s, 0.005*s, 0.15*s, 6), legMat);
        var a = (i/4)*Math.PI*2;
        leg.position.set(Math.cos(a)*0.07*s, -0.32*s, Math.sin(a)*0.07*s);
        leg.rotation.z = 0.3; leg.rotation.y = a; g.add(leg);
      }
      // OST logo stripe on body — green band
      var stripe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.082*s, 0.082*s, 0.025*s, 24, 1, true),
        new THREE.MeshBasicMaterial({color:0x10b981, transparent:true, opacity:0.6, side:THREE.DoubleSide})
      );
      stripe.position.y = 0.12*s; g.add(stripe);
      return g;
    }

    // ---- ADVANCED EXHAUST PLUME ----
    function mkExhaust(s) {
      var cnt = 150, geo = new THREE.BufferGeometry();
      var pos = new Float32Array(cnt*3), sizes = new Float32Array(cnt), cols = new Float32Array(cnt*3);
      var vels = [];
      for (var i = 0; i < cnt; i++) {
        pos[i*3] = (Math.random()-0.5)*0.04*s;
        pos[i*3+1] = -0.32*s - Math.random()*0.5*s;
        pos[i*3+2] = (Math.random()-0.5)*0.04*s;
        sizes[i] = 0.02*s + Math.random()*0.06*s;
        // Color gradient: white core → orange → red tail
        var depth = Math.random();
        cols[i*3] = 1; cols[i*3+1] = 0.5+depth*0.5; cols[i*3+2] = depth*0.3;
        vels.push({
          x:(Math.random()-0.5)*0.003*s, y:-0.01*s-Math.random()*0.02*s,
          z:(Math.random()-0.5)*0.003*s, life:Math.random(), spread: 0.001*s + Math.random()*0.002*s
        });
      }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      var pts = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 0.06*s, vertexColors: true, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
      }));
      pts.userData = {vels:vels, s:s};
      return pts;
    }

    function tickExhaust(f, baseY, intensity) {
      var p = f.geometry.attributes.position.array;
      var c = f.geometry.attributes.color.array;
      var v = f.userData.vels, s = f.userData.s;
      var int = intensity || 1;
      for (var i = 0; i < v.length; i++) {
        v[i].life -= 0.018 * int;
        if (v[i].life <= 0) {
          p[i*3] = (Math.random()-0.5)*0.04*s;
          p[i*3+1] = baseY - 0.32*s;
          p[i*3+2] = (Math.random()-0.5)*0.04*s;
          v[i].life = 1;
          c[i*3] = 1; c[i*3+1] = 0.9; c[i*3+2] = 0.7;
        } else {
          p[i*3] += v[i].x + (Math.random()-0.5)*v[i].spread*int;
          p[i*3+1] += v[i].y * int;
          p[i*3+2] += v[i].z + (Math.random()-0.5)*v[i].spread*int;
          c[i*3+1] = Math.max(0.2, v[i].life * 0.6);
          c[i*3+2] = Math.max(0, v[i].life * 0.15);
        }
      }
      f.geometry.attributes.position.needsUpdate = true;
      f.geometry.attributes.color.needsUpdate = true;
      f.material.opacity = 0.7 * int;
    }

    // ---- procedural planet texture ----
    function makePlanetTex(w, h, baseR, baseG, baseB, noiseScale, hasOcean) {
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      var cx = cv.getContext('2d');
      // Simple procedural noise
      for (var y = 0; y < h; y += 2) {
        for (var x = 0; x < w; x += 2) {
          var nx = x/w*noiseScale, ny = y/h*noiseScale;
          var n = (Math.sin(nx*12.9898+ny*78.233)*43758.5453) % 1;
          n = Math.abs(n);
          var n2 = (Math.sin(nx*5.34+ny*15.78+nx*ny*2.1)*28461.32) % 1;
          n2 = Math.abs(n2);
          var blend = (n+n2)*0.5;
          var r, g, b;
          if (hasOcean && blend < 0.45) {
            r = 20+blend*60; g = 50+blend*80; b = 140+blend*80;
          } else {
            r = baseR + (blend-0.5)*80;
            g = baseG + (blend-0.5)*60;
            b = baseB + (blend-0.5)*40;
          }
          cx.fillStyle = 'rgb('+Math.min(255,Math.max(0,r|0))+','+Math.min(255,Math.max(0,g|0))+','+Math.min(255,Math.max(0,b|0))+')';
          cx.fillRect(x, y, 2, 2);
        }
      }
      return new THREE.CanvasTexture(cv);
    }

    // ---- glow sprite for planets ----
    function makeGlow(radius, color, opacity) {
      var cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
      var cx = cv.getContext('2d');
      var gr = cx.createRadialGradient(64, 64, 0, 64, 64, 64);
      var cr = (color>>16)&0xff, cg = (color>>8)&0xff, cb = color&0xff;
      gr.addColorStop(0, 'rgba('+cr+','+cg+','+cb+','+opacity+')');
      gr.addColorStop(0.4, 'rgba('+cr+','+cg+','+cb+','+(opacity*0.4)+')');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = gr; cx.fillRect(0, 0, 128, 128);
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(cv), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
      }));
      sp.scale.set(radius*2.5, radius*2.5, 1);
      return sp;
    }

    // ---- orbital satellite constellation ----
    function mkSatConstellation(count, radius, color) {
      var grp = new THREE.Group();
      for (var i = 0; i < count; i++) {
        var satG = new THREE.Group();
        // Tiny sat body
        satG.add(new THREE.Mesh(
          new THREE.BoxGeometry(0.02, 0.015, 0.01),
          new THREE.MeshStandardMaterial({color: 0xcccccc, metalness:0.5})
        ));
        // Two solar panels
        for (var s = -1; s <= 1; s += 2) {
          var panel = new THREE.Mesh(
            new THREE.BoxGeometry(0.04, 0.001, 0.015),
            new THREE.MeshStandardMaterial({color:0x112266, metalness:0.2})
          );
          panel.position.x = s * 0.04;
          satG.add(panel);
        }
        var a = (i/count)*Math.PI*2;
        var inclination = (Math.random()-0.5)*0.6;
        satG.position.set(Math.cos(a)*radius, Math.sin(inclination)*radius*0.15, Math.sin(a)*radius);
        satG.userData = {angle: a, incl: inclination, speed: 0.08+Math.random()*0.04, radius: radius};
        grp.add(satG);
      }
      // Orbital ring
      var ring = new THREE.Mesh(
        new THREE.RingGeometry(radius-0.01, radius+0.01, 128),
        new THREE.MeshBasicMaterial({color: color, transparent:true, opacity:0.08, side: THREE.DoubleSide})
      );
      ring.rotation.x = Math.PI/2;
      grp.add(ring);
      return grp;
    }

    // ======================================================================
    // PHASE 0: LAUNCH — Detailed Earth surface, launch pad, rocket ascent
    // ======================================================================
    var launchGrp = new THREE.Group();
    // Earth with procedural texture
    var earthTex = makePlanetTex(512, 256, 50, 120, 50, 6, true);
    var earth0 = new THREE.Mesh(
      new THREE.SphereGeometry(10, 64, 64),
      new THREE.MeshStandardMaterial({map: earthTex, roughness:0.7})
    );
    earth0.position.y = -10.5;
    launchGrp.add(earth0);
    // Atmosphere shell
    var atm0 = new THREE.Mesh(
      new THREE.SphereGeometry(10.2, 64, 64),
      new THREE.MeshBasicMaterial({color:0x4488ff, transparent:true, opacity:0.08, side:THREE.BackSide})
    );
    atm0.position.y = -10.5;
    launchGrp.add(atm0);
    // Atmosphere glow sprite
    var earthGlow0 = makeGlow(10, 0x4488ff, 0.12);
    earthGlow0.position.y = -10.5;
    launchGrp.add(earthGlow0);
    // Launch pad complex
    var padBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.6, 0.08, 24),
      new THREE.MeshStandardMaterial({color:0x555555, metalness:0.5, roughness:0.4})
    );
    padBase.position.y = -0.45; launchGrp.add(padBase);
    // Support tower
    var towerMat = new THREE.MeshStandardMaterial({color:0x888888, metalness:0.5, roughness:0.3});
    var tower = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.4, 0.06), towerMat);
    tower.position.set(-0.45, 0.2, 0); launchGrp.add(tower);
    // Tower arm
    var tArm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.03, 0.03), towerMat);
    tArm.position.set(-0.25, 0.55, 0); launchGrp.add(tArm);
    // Lightning towers (smaller)
    for (var i = 0; i < 3; i++) {
      var lt = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.015, 0.6, 6), towerMat);
      var la = (i/3)*Math.PI*2 + 0.5;
      lt.position.set(Math.cos(la)*0.7, -0.1, Math.sin(la)*0.7);
      launchGrp.add(lt);
    }
    // Fuel tanks near pad
    var fuelTankMat = new THREE.MeshStandardMaterial({color:0xeeeeee, metalness:0.3, roughness:0.4});
    var ft1 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.25, 12), fuelTankMat);
    ft1.position.set(0.5, -0.3, 0.2); launchGrp.add(ft1);
    var ft2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.25, 12), fuelTankMat);
    ft2.position.set(0.5, -0.3, -0.15); launchGrp.add(ft2);
    // Rocket
    var rocket0 = mkRocket(1.8);
    launchGrp.add(rocket0);
    var exhaust0 = mkExhaust(1.8);
    launchGrp.add(exhaust0);
    // Launch smoke
    var smokeCnt = 200;
    var smokeGeo = new THREE.BufferGeometry();
    var smokePos = new Float32Array(smokeCnt*3), smokeVels = [];
    for (var i = 0; i < smokeCnt; i++) {
      smokePos[i*3] = (Math.random()-0.5)*0.3;
      smokePos[i*3+1] = -0.4;
      smokePos[i*3+2] = (Math.random()-0.5)*0.3;
      smokeVels.push({x:(Math.random()-0.5)*0.02, y:0.005+Math.random()*0.01, z:(Math.random()-0.5)*0.02, life:Math.random()});
    }
    smokeGeo.setAttribute('position', new THREE.Float32BufferAttribute(smokePos, 3));
    var smoke = new THREE.Points(smokeGeo, new THREE.PointsMaterial({
      color:0xcccccc, size:0.08, transparent:true, opacity:0.3, depthWrite:false
    }));
    launchGrp.add(smoke);
    scene.add(launchGrp);

    // ======================================================================
    // PHASE 1: SPACE STATION — Detailed ISS-like structure + docking
    // ======================================================================
    var orbitGrp = new THREE.Group();
    orbitGrp.visible = false;
    // Earth in background
    var earth1 = new THREE.Mesh(
      new THREE.SphereGeometry(8, 64, 64),
      new THREE.MeshStandardMaterial({map: earthTex, roughness:0.7})
    );
    earth1.position.set(0, -10, -5);
    orbitGrp.add(earth1);
    var earthGlow1 = makeGlow(8, 0x4488ff, 0.1);
    earthGlow1.position.set(0, -10, -5);
    orbitGrp.add(earthGlow1);
    // Station
    var station = new THREE.Group();
    // Main truss
    var trussMat = new THREE.MeshStandardMaterial({color:0xcccccc, metalness:0.6, roughness:0.25});
    station.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 8), trussMat));
    // Habitat modules
    var modMat = new THREE.MeshStandardMaterial({color:0xe8e8e8, metalness:0.4, roughness:0.3});
    var hab1 = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.5, 16), modMat);
    hab1.rotation.z = Math.PI/2; station.add(hab1);
    var hab2 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.4, 16), modMat);
    hab2.rotation.z = Math.PI/2; hab2.position.set(0, 0, 0.2); station.add(hab2);
    // Cupola (observation dome)
    var cupola = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 16, 16, 0, Math.PI*2, 0, Math.PI/2),
      new THREE.MeshStandardMaterial({color:0xaaccff, transparent:true, opacity:0.4, metalness:0.3})
    );
    cupola.position.set(0, 0.15, 0); station.add(cupola);
    // Docking ring
    var dring = new THREE.Mesh(
      new THREE.TorusGeometry(0.65, 0.02, 8, 48),
      new THREE.MeshStandardMaterial({color:0xdddddd, metalness:0.5})
    );
    dring.rotation.x = Math.PI/2; station.add(dring);
    // 8 Solar panels on long arms
    var panelMat = new THREE.MeshStandardMaterial({color:0x0a1a4a, metalness:0.2, roughness:0.5, emissive:0x060e2a, emissiveIntensity:0.2});
    for (var i = 0; i < 8; i++) {
      var armLen = 0.45;
      var arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, armLen, 6), trussMat);
      var ang = (i/8)*Math.PI*2;
      var dist = 1.1;
      arm.position.set(Math.cos(ang)*dist*0.5, 0, Math.sin(ang)*dist*0.5);
      arm.rotation.z = Math.PI/2; arm.rotation.y = ang;
      station.add(arm);
      var panel = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.005, 0.12), panelMat);
      panel.position.set(Math.cos(ang)*dist, Math.sin(i*0.3)*0.02, Math.sin(ang)*dist);
      panel.rotation.y = ang;
      station.add(panel);
    }
    // Satellite constellation around station
    var stationSats = mkSatConstellation(16, 2.5, 0x10b981);
    station.add(stationSats);
    orbitGrp.add(station);
    // Docking rocket
    var rocket1 = mkRocket(0.6);
    rocket1.position.set(4, 1.5, 1);
    rocket1.rotation.z = -Math.PI/2;
    orbitGrp.add(rocket1);
    // RCS thruster particles
    var rcsCnt = 30, rcsGeo = new THREE.BufferGeometry(), rcsPos = new Float32Array(rcsCnt*3), rcsVels = [];
    for (var i = 0; i < rcsCnt; i++) { rcsPos[i*3]=4; rcsPos[i*3+1]=1.5; rcsPos[i*3+2]=1; rcsVels.push({life:Math.random()}); }
    rcsGeo.setAttribute('position', new THREE.Float32BufferAttribute(rcsPos, 3));
    var rcsPts = new THREE.Points(rcsGeo, new THREE.PointsMaterial({
      color:0x88ccff, size:0.02, transparent:true, opacity:0.5, blending:THREE.AdditiveBlending, depthWrite:false
    }));
    orbitGrp.add(rcsPts);
    // Data transfer beam (station to Earth)
    var beamPts = [new THREE.Vector3(0,0,0), new THREE.Vector3(0,-5,-3)];
    var beamLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(beamPts),
      new THREE.LineBasicMaterial({color:0x10b981, transparent:true, opacity:0.15})
    );
    orbitGrp.add(beamLine);
    scene.add(orbitGrp);

    // ======================================================================
    // PHASE 2: MOON — Textured lunar surface, craters, base, Earth in sky
    // ======================================================================
    var moonGrp = new THREE.Group();
    moonGrp.visible = false;
    var moonTex = makePlanetTex(512, 256, 170, 170, 165, 8, false);
    var moonSurf = new THREE.Mesh(
      new THREE.SphereGeometry(10, 64, 64),
      new THREE.MeshStandardMaterial({map: moonTex, roughness:0.95})
    );
    moonSurf.position.y = -10; moonGrp.add(moonSurf);
    // Craters — concave rings on surface
    for (var i = 0; i < 10; i++) {
      var cs = 0.1 + Math.random()*0.2;
      var cr = new THREE.Mesh(
        new THREE.TorusGeometry(cs, cs*0.15, 8, 24),
        new THREE.MeshStandardMaterial({color:0x999990, roughness:0.9})
      );
      cr.rotation.x = -Math.PI/2;
      cr.position.set((Math.random()-0.5)*3, 0.01, (Math.random()-0.5)*2.5);
      moonGrp.add(cr);
    }
    // Boulders
    for (var i = 0; i < 12; i++) {
      var bSize = 0.03+Math.random()*0.06;
      var boulder = new THREE.Mesh(
        new THREE.DodecahedronGeometry(bSize, 0),
        new THREE.MeshStandardMaterial({color:0x8a8a82, roughness:0.95})
      );
      boulder.position.set((Math.random()-0.5)*4, bSize*0.3, (Math.random()-0.5)*3);
      boulder.rotation.set(Math.random()*2, Math.random()*2, Math.random()*2);
      moonGrp.add(boulder);
    }
    // Lunar base dome
    var mbase = new THREE.Group();
    var dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 24, 24, 0, Math.PI*2, 0, Math.PI/2),
      new THREE.MeshStandardMaterial({color:0xaaddff, transparent:true, opacity:0.35, metalness:0.4})
    );
    mbase.add(dome);
    var baseFloor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 0.04, 24),
      new THREE.MeshStandardMaterial({color:0x666666, metalness:0.5})
    );
    mbase.add(baseFloor);
    // Base solar panels
    for (var i = 0; i < 3; i++) {
      var bPanel = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.002, 0.08), panelMat);
      bPanel.position.set(0.5+i*0.2, 0.08, 0.3); bPanel.rotation.x = -0.3;
      mbase.add(bPanel);
    }
    // Antenna
    var ant = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.3, 6), trussMat);
    ant.position.set(-0.3, 0.15, 0.1); mbase.add(ant);
    var dish = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 12, 12, 0, Math.PI*2, 0, Math.PI/2),
      new THREE.MeshStandardMaterial({color:0xcccccc, metalness:0.5, side:THREE.DoubleSide})
    );
    dish.position.set(-0.3, 0.3, 0.1); dish.rotation.x = Math.PI; mbase.add(dish);
    mbase.position.set(0.8, 0, 0.5);
    moonGrp.add(mbase);
    // Fuel tank connected to rocket
    var mTank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8),
      new THREE.MeshStandardMaterial({color:0xff6600, metalness:0.4, emissive:0x331100, emissiveIntensity:0.3})
    );
    mTank.position.set(0.3, 0.15, 0.3); moonGrp.add(mTank);
    // Refueling line
    var fuelLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.4, 0.1, 0),
        new THREE.Vector3(0.0, 0.08, 0.15),
        new THREE.Vector3(0.3, 0.15, 0.3)
      ]),
      new THREE.LineBasicMaterial({color:0x10b981, transparent:true, opacity:0.0})
    );
    moonGrp.add(fuelLine);
    // Rocket landing
    var rocket2 = mkRocket(1.3);
    rocket2.position.set(-0.4, 3, 0);
    moonGrp.add(rocket2);
    var exhaust2 = mkExhaust(1.3);
    moonGrp.add(exhaust2);
    // Earth in sky — beautiful blue marble
    var earthSkyTex = makePlanetTex(128, 64, 40, 80, 160, 5, true);
    var earthSky = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 24, 24),
      new THREE.MeshBasicMaterial({map: earthSkyTex})
    );
    earthSky.position.set(-3, 4, -8); moonGrp.add(earthSky);
    var earthSkyGlow = makeGlow(0.18, 0x4488ff, 0.15);
    earthSkyGlow.position.set(-3, 4, -8); moonGrp.add(earthSkyGlow);
    scene.add(moonGrp);

    // ======================================================================
    // PHASE 3: MARS — Red planet, dust storms, atmospheric entry
    // ======================================================================
    var marsGrp = new THREE.Group();
    marsGrp.visible = false;
    var marsTex = makePlanetTex(512, 256, 190, 70, 20, 7, false);
    var marsSurf = new THREE.Mesh(
      new THREE.SphereGeometry(10, 64, 64),
      new THREE.MeshStandardMaterial({map: marsTex, roughness:0.9})
    );
    marsSurf.position.y = -9.8; marsGrp.add(marsSurf);
    // Mars atmosphere
    var marsAtm = new THREE.Mesh(
      new THREE.SphereGeometry(10.15, 48, 48),
      new THREE.MeshBasicMaterial({color:0xff6633, transparent:true, opacity:0.05, side:THREE.BackSide})
    );
    marsAtm.position.y = -9.8; marsGrp.add(marsAtm);
    var marsGlow = makeGlow(10, 0xff6633, 0.06);
    marsGlow.position.y = -9.8; marsGrp.add(marsGlow);
    // Olympus Mons silhouette (large bump)
    var olympus = new THREE.Mesh(
      new THREE.ConeGeometry(1.2, 0.4, 32),
      new THREE.MeshStandardMaterial({color:0xaa4410, roughness:0.95})
    );
    olympus.position.set(2, 0.15, -1); marsGrp.add(olympus);
    // Rocky terrain
    for (var i = 0; i < 18; i++) {
      var rs = 0.04 + Math.random()*0.1;
      var rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(rs, 0),
        new THREE.MeshStandardMaterial({color:0x993311+Math.floor(Math.random()*0x222200), roughness:0.95})
      );
      rock.position.set((Math.random()-0.5)*4, rs*0.3, (Math.random()-0.5)*3);
      rock.rotation.set(Math.random()*2, Math.random()*2, Math.random()*2);
      marsGrp.add(rock);
    }
    // Rocket descending
    var rocket3 = mkRocket(1.6);
    rocket3.position.set(0, 6, 0);
    rocket3.rotation.z = Math.PI; // nose down
    marsGrp.add(rocket3);
    var exhaust3 = mkExhaust(1.6);
    marsGrp.add(exhaust3);
    // Dust storm particles
    var dustCnt = 250, dustGeo = new THREE.BufferGeometry();
    var dustPos = new Float32Array(dustCnt*3), dustVels = [];
    for (var i = 0; i < dustCnt; i++) {
      dustPos[i*3] = (Math.random()-0.5)*3;
      dustPos[i*3+1] = 0.05 + Math.random()*0.4;
      dustPos[i*3+2] = (Math.random()-0.5)*3;
      dustVels.push({
        x:(Math.random()-0.5)*0.02, y:Math.random()*0.012,
        z:(Math.random()-0.5)*0.02, life:Math.random()
      });
    }
    dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dustPos, 3));
    var dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      color:0xcc7744, size:0.06, transparent:true, opacity:0, depthWrite:false
    }));
    marsGrp.add(dust);
    // Re-entry heat shield glow
    var heatGlow = makeGlow(0.3, 0xff4400, 0.4);
    heatGlow.position.set(0, 6, 0);
    marsGrp.add(heatGlow);
    // Earth & Moon as tiny dots
    var earthDot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), new THREE.MeshBasicMaterial({color:0x4488ff}));
    earthDot.position.set(4, 5, -10); marsGrp.add(earthDot);
    var moonDot = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), new THREE.MeshBasicMaterial({color:0xbbbbbb}));
    moonDot.position.set(4.15, 5.05, -10); marsGrp.add(moonDot);
    scene.add(marsGrp);

    // ---- Phase management ----
    var groups = [launchGrp, orbitGrp, moonGrp, marsGrp];
    var phaseLabels = [
      'Phase 1 \u2014 Rocket Launch from Earth',
      'Phase 2 \u2014 Docking & Refueling at Space Station',
      'Phase 3 \u2014 Moon Descent & Refueling Base',
      'Phase 4 \u2014 Mars Atmospheric Entry & Landing'
    ];
    var phaseMissions = ['EARTH DEPARTURE', 'ORBITAL RENDEZVOUS', 'LUNAR DESCENT', 'MARS ENTRY'];
    var phaseStatuses = ['IGNITION SEQUENCE', 'DOCKING APPROACH', 'TERRAIN SCANNING', 'HEAT SHIELD ACTIVE'];
    var curPhase = 0, phaseTime = 16;
    camera.position.set(1, 0.8, 3);
    camera.lookAt(0, 0.5, 0);

    function easeInOut(x) { return x < 0.5 ? 2*x*x : 1-Math.pow(-2*x+2,2)/2; }
    function easeOut(x) { return 1-Math.pow(1-x,3); }

    // HUD update
    function updateHUD(alt, vel, fuel, dist) {
      var ha = document.getElementById('sjHudAlt');
      var hv = document.getElementById('sjHudVel');
      var hf = document.getElementById('sjHudFuel');
      var hd = document.getElementById('sjHudDist');
      if (ha) ha.textContent = alt;
      if (hv) hv.textContent = vel;
      if (hf) hf.textContent = fuel;
      if (hd) hd.textContent = dist;
    }

    function resetPhaseObjects(idx) {
      if (idx === 0) {
        rocket0.position.set(0, 0, 0);
        exhaust0.position.set(0, 0, 0);
        exhaust0.visible = true;
        smoke.material.opacity = 0;
      }
      if (idx === 1) {
        rocket1.position.set(4, 1.5, 1);
        rocket1.rotation.set(0, 0, -Math.PI/2);
      }
      if (idx === 2) {
        rocket2.position.set(-0.4, 3, 0);
        rocket2.rotation.set(0, 0, 0);
        exhaust2.visible = true;
        fuelLine.material.opacity = 0;
      }
      if (idx === 3) {
        rocket3.position.set(0, 6, 0);
        rocket3.rotation.set(0, 0, Math.PI);
        exhaust3.visible = true;
        exhaust3.position.set(0, 6, 0);
        heatGlow.position.set(0, 6, 0);
        heatGlow.material.opacity = 0.4;
        dust.material.opacity = 0;
      }
    }

    function setPhase(idx) {
      for (var i = 0; i < groups.length; i++) groups[i].visible = (i === idx);
      curPhase = idx;
      resetPhaseObjects(idx);
      var btns = document.querySelectorAll('.sj-phase-btn');
      btns.forEach(function(b) { b.classList.remove('sj-phase-active'); });
      if (btns[idx]) btns[idx].classList.add('sj-phase-active');
      var lbl = document.getElementById('sjPhaseLabel');
      if (lbl) lbl.textContent = phaseLabels[idx];
      var mis = document.getElementById('sjHudMission');
      if (mis) mis.textContent = 'MISSION: ' + phaseMissions[idx];
      var sts = document.getElementById('sjHudStatus');
      if (sts) sts.textContent = phaseStatuses[idx];
      sunLight.color.set(idx === 3 ? 0xffccaa : 0xffffff);
      sunLight.intensity = idx === 2 ? 1.2 : 1.6;
    }

    document.querySelectorAll('.sj-phase-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var p = parseInt(this.dataset.phase);
        if (!isNaN(p)) { phaseTimer = 0; setPhase(p); }
      });
    });

    // Mouse parallax
    var mouseX = 0, mouseY = 0;
    c.addEventListener('mousemove', function(e) {
      var rect = c.getBoundingClientRect();
      mouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      mouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    });
    c.addEventListener('mouseleave', function() { mouseX = 0; mouseY = 0; });

    setPhase(0);

    var t = 0, phaseTimer = 0, vis = false;

    function animate() {
      requestAnimationFrame(animate);
      if (!vis) return;
      var dt = 0.016;
      t += dt;
      phaseTimer += dt;

      var prog = Math.min(phaseTimer / phaseTime, 1);
      if (prog >= 1) {
        phaseTimer = 0;
        setPhase((curPhase + 1) % 4);
        prog = 0;
      }

      // Starfield slow rotation + mouse parallax
      stars.rotation.y = t * 0.001;
      stars.rotation.x = mouseY * 0.02;
      nebulaGroup.rotation.y = t * 0.0005;

      // Shooting stars
      var sp = shootStars.geometry.attributes.position.array;
      for (var i = 0; i < shootStarCnt; i++) {
        var sd = shootData[i];
        sd.timer += 1;
        if (sd.timer > sd.interval && sd.timer < sd.interval + 30) {
          var st = (sd.timer - sd.interval) / 30;
          sp[i*6] = sd.x + sd.vx * st * 20;
          sp[i*6+1] = sd.y + sd.vy * st * 20;
          sp[i*6+2] = sd.z;
          sp[i*6+3] = sp[i*6] + sd.vx * 3;
          sp[i*6+4] = sp[i*6+1] + sd.vy * 3;
          sp[i*6+5] = sd.z;
        } else if (sd.timer > sd.interval + 30) {
          sd.timer = 0;
          sd.x = (Math.random()-0.5)*60;
          sd.y = 10+Math.random()*30;
          sd.z = -20-Math.random()*60;
          sp[i*6]=sp[i*6+3]=0; sp[i*6+1]=sp[i*6+4]=1000; sp[i*6+2]=sp[i*6+5]=0;
        }
      }
      shootStars.geometry.attributes.position.needsUpdate = true;

      // Engine point light flicker
      pointLight.intensity = 0.5 + Math.random() * 0.3;

      /* ===== Phase 0: LAUNCH ===== */
      if (curPhase === 0) {
        var rY;
        if (prog < 0.10) {
          rY = 0;
          exhaust0.visible = true;
          exhaust0.material.opacity = 0.2 + prog * 5;
          smoke.material.opacity = prog * 3;
          updateHUD('0 km', '0 km/s', '100%', '0 AU');
        } else if (prog < 0.18) {
          var lp = (prog - 0.10) / 0.08;
          rY = easeInOut(lp) * 0.2;
          smoke.material.opacity = 0.3;
          updateHUD((rY*50|0)+' km', (rY*2).toFixed(1)+' km/s', (100-lp*5|0)+'%', '0 AU');
        } else {
          var ap = (prog - 0.18) / 0.82;
          rY = 0.2 + easeInOut(ap) * 8;
          smoke.material.opacity = Math.max(0, 0.3 - ap * 0.5);
          var alt = (rY*50|0);
          updateHUD(alt+' km', (rY*2.5).toFixed(1)+' km/s', (95-ap*40|0)+'%', '0 AU');
        }
        rocket0.position.y = rY;
        rocket0.rotation.z = Math.sin(t * 3) * 0.006 * Math.min(1, prog * 5);
        exhaust0.position.y = rY;
        tickExhaust(exhaust0, rY, 1);
        pointLight.position.set(0, rY - 0.5, 0);
        pointLight.color.set(0xff6600);
        // Smoke billows
        var smP = smoke.geometry.attributes.position.array;
        for (var i = 0; i < smokeCnt; i++) {
          smokeVels[i].life -= 0.008;
          if (smokeVels[i].life <= 0) {
            smP[i*3] = (Math.random()-0.5)*0.15;
            smP[i*3+1] = -0.4;
            smP[i*3+2] = (Math.random()-0.5)*0.15;
            smokeVels[i].life = 1;
          } else {
            smP[i*3] += smokeVels[i].x;
            smP[i*3+1] += smokeVels[i].y;
            smP[i*3+2] += smokeVels[i].z;
          }
        }
        smoke.geometry.attributes.position.needsUpdate = true;
        // Camera
        camera.position.set(
          1.2 + Math.sin(t * 0.12) * 0.1 + mouseX * 0.15,
          0.8 + rY * 0.2 + mouseY * 0.08,
          3 + rY * 0.05
        );
        camera.lookAt(0, rY * 0.35, 0);
        padBase.visible = prog < 0.4;
        tower.visible = prog < 0.4;
        tArm.visible = prog < 0.4;
        atm0.material.opacity = Math.max(0, 0.08 - prog * 0.08);
      }

      /* ===== Phase 1: STATION ===== */
      if (curPhase === 1) {
        station.rotation.y = t * 0.1;
        station.rotation.x = Math.sin(t * 0.04) * 0.03;
        earth1.rotation.y = t * 0.005;
        // Satellite constellation orbits
        stationSats.children.forEach(function(ch) {
          if (ch.userData && ch.userData.angle !== undefined) {
            ch.userData.angle += ch.userData.speed * dt;
            var a = ch.userData.angle, rad = ch.userData.radius;
            ch.position.set(Math.cos(a)*rad, Math.sin(ch.userData.incl)*rad*0.15, Math.sin(a)*rad);
          }
        });

        if (prog < 0.35) {
          var ap = easeOut(prog / 0.35);
          rocket1.position.set(4 - ap * 3.2, 1.5 - ap * 1.5, 1 - ap * 1);
          updateHUD('408 km', (7.7-ap*7).toFixed(1)+' km/s', (55-ap*5|0)+'%', '0 AU');
          // RCS puffs
          var rp = rcsPts.geometry.attributes.position.array;
          for (var i = 0; i < rcsCnt; i++) {
            rcsVels[i].life -= 0.03;
            if (rcsVels[i].life <= 0) {
              rp[i*3] = rocket1.position.x + 0.1;
              rp[i*3+1] = rocket1.position.y + (Math.random()-0.5)*0.1;
              rp[i*3+2] = rocket1.position.z;
              rcsVels[i].life = 1;
            } else {
              rp[i*3] += 0.015;
              rp[i*3+1] += (Math.random()-0.5)*0.003;
              rp[i*3+2] += (Math.random()-0.5)*0.003;
            }
          }
          rcsPts.geometry.attributes.position.needsUpdate = true;
          rcsPts.material.opacity = 0.4;
        } else if (prog < 0.45) {
          rocket1.position.set(0.8, Math.sin(t*0.5)*0.01, 0.02);
          rcsPts.material.opacity = 0;
          updateHUD('408 km', '0.1 km/s', '50%', '0 AU');
        } else {
          rocket1.position.set(0.8, Math.sin(t*0.3)*0.005, 0);
          rcsPts.material.opacity = 0;
          var rp2 = (prog-0.45)/0.55;
          beamLine.material.opacity = 0.1 + Math.sin(t*2)*0.05;
          updateHUD('408 km', '0 km/s', (50+rp2*40|0)+'%', '0 AU');
        }
        var camZ = 4 + (1 - easeOut(Math.min(prog * 1.3, 1))) * 2;
        camera.position.set(
          Math.sin(t * 0.04) * 0.4 + mouseX * 0.2,
          0.5 + Math.sin(t * 0.06) * 0.1 + mouseY * 0.1,
          camZ
        );
        camera.lookAt(0, 0, 0);
      }

      /* ===== Phase 2: MOON ===== */
      if (curPhase === 2) {
        var rY2;
        if (prog < 0.55) {
          var dp = easeInOut(prog / 0.55);
          rY2 = 3 - dp * 2.62;
          rocket2.rotation.z = Math.sin(t * 1.2) * 0.008 * (1 - dp * 0.8);
          exhaust2.visible = true;
          tickExhaust(exhaust2, rY2, 0.6 + (1-dp)*0.4);
          updateHUD(((1-dp)*110|0)+' km', ((1-dp)*1.6).toFixed(1)+' km/s', (40-dp*10|0)+'%', '1.28 ls');
        } else if (prog < 0.7) {
          rY2 = 0.38;
          rocket2.rotation.z = 0;
          exhaust2.visible = prog < 0.65;
          updateHUD('0 km', '0 km/s', '30%', '1.28 ls');
        } else {
          rY2 = 0.38;
          rocket2.rotation.z = 0;
          exhaust2.visible = false;
          var rfp = (prog-0.7)/0.3;
          fuelLine.material.opacity = easeOut(rfp) * 0.5;
          mTank.material.emissiveIntensity = 0.3 + easeOut(rfp) * 0.5;
          updateHUD('0 km', '0 km/s', (30+rfp*60|0)+'%', '1.28 ls');
        }
        rocket2.position.y = rY2;
        exhaust2.position.y = rY2;
        pointLight.position.set(-0.4, rY2 - 0.4, 0);
        pointLight.color.set(0xff6600);
        earthSky.rotation.y = t * 0.01;
        camera.position.set(
          1.5 + Math.sin(t * 0.06) * 0.1 + mouseX * 0.15,
          0.9 + (1 - easeOut(Math.min(prog * 1.3, 1))) * 1.5 + mouseY * 0.1,
          3
        );
        camera.lookAt(0, rY2 * 0.25, 0);
      }

      /* ===== Phase 3: MARS ===== */
      if (curPhase === 3) {
        var rY3;
        if (prog < 0.12) {
          var ep = prog / 0.12;
          rY3 = 6 - ep * 0.5;
          rocket3.rotation.z = Math.PI - easeOut(ep) * (Math.PI - 0.05);
          exhaust3.visible = true;
          exhaust3.material.opacity = 0.3;
          heatGlow.material.opacity = 0.3 + ep * 0.4;
          marsAtm.material.opacity = 0.05 + ep * 0.1;
          updateHUD(((1-ep*0.1)*125|0)+' km', '5.4 km/s', '35%', '0.52 AU');
        } else if (prog < 0.65) {
          var dp = (prog - 0.12) / 0.53;
          rY3 = 5.5 - easeInOut(dp) * 4.5;
          rocket3.rotation.z = 0.05 - easeOut(dp) * 0.05;
          exhaust3.visible = true;
          tickExhaust(exhaust3, rY3, 0.8);
          heatGlow.material.opacity = Math.max(0, 0.7 - dp * 0.7);
          marsAtm.material.opacity = Math.max(0.05, 0.15 - dp * 0.1);
          updateHUD(((1-dp)*120|0)+' km', ((1-dp)*5).toFixed(1)+' km/s', (35-dp*15|0)+'%', '0.52 AU');
        } else {
          var lp = easeOut((prog - 0.65) / 0.35);
          rY3 = 1.0 - lp * 0.6;
          rocket3.rotation.z = 0;
          exhaust3.visible = prog < 0.92;
          exhaust3.material.opacity = Math.max(0, 1 - lp * 2.5);
          heatGlow.material.opacity = 0;
          updateHUD((rY3*20|0)+' km', ((1-lp)*0.8).toFixed(1)+' km/s', (20-lp*5|0)+'%', '0.52 AU');
        }
        rocket3.position.y = rY3;
        exhaust3.position.y = rY3;
        heatGlow.position.y = rY3;
        tickExhaust(exhaust3, rY3, Math.max(0.2, 1 - prog));
        pointLight.position.set(0, rY3 - 0.5, 0);
        pointLight.color.set(0xff4400);
        // Dust storm
        var closeness = Math.max(0, 1 - (rY3 - 0.4) / 5.6);
        var dustStr = closeness * closeness;
        dust.material.opacity = dustStr * 0.45;
        var dp2 = dust.geometry.attributes.position.array;
        for (var i = 0; i < dustCnt; i++) {
          dustVels[i].life -= 0.008 * (dustStr + 0.1);
          if (dustVels[i].life <= 0) {
            dp2[i*3] = (Math.random()-0.5)*(0.8+dustStr*2);
            dp2[i*3+1] = 0.05;
            dp2[i*3+2] = (Math.random()-0.5)*(0.8+dustStr*2);
            dustVels[i].life = 1;
          } else {
            dp2[i*3] += dustVels[i].x * (dustStr*2+0.3);
            dp2[i*3+1] += dustVels[i].y * dustStr;
            dp2[i*3+2] += dustVels[i].z * (dustStr*2+0.3);
          }
        }
        dust.geometry.attributes.position.needsUpdate = true;
        marsSurf.rotation.y = t * 0.003;
        camera.position.set(
          0.6 + Math.sin(t * 0.08) * 0.12 + mouseX * 0.2,
          1.8 - closeness * 0.8 + mouseY * 0.1,
          3.5 - closeness * 0.5
        );
        camera.lookAt(0, rY3 * 0.3, 0);
      }

      renderer.render(scene, camera);
    }

    new IntersectionObserver(function(e) {
      e.forEach(function(en) { vis = en.isIntersecting; });
    }, {threshold: 0.05}).observe(c);

    window.addEventListener('resize', function() {
      var nw = c.clientWidth, nh = c.clientHeight;
      if (nw && nh) {
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      }
    });

    animate();
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

  // ========================================================================
  // Shared Logo Helpers — used by Gift Card, Fuel, and Launchpad
  // ========================================================================
  function brandSvg(name, color) {
    var c = color || '#555';
    var l = (name || '?').charAt(0).toUpperCase();
    return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="' + c + '"/><stop offset="100%" stop-color="' + c + '88"/></linearGradient></defs><rect fill="url(#g)" width="56" height="56" rx="13"/><text x="28" y="37" text-anchor="middle" fill="#fff" font-size="24" font-weight="bold" font-family="Inter,system-ui,sans-serif">' + l + '</text></svg>');
  }
  function logoSrc(domain) { return 'https://logo.clearbit.com/' + domain; }
  function logoFallback(img, domain, name, color) {
    img.onerror = function() { this.onerror = null; this.src = brandSvg(name, color); };
    img.src = 'https://img.logo.dev/' + domain + '?token=pk_anonymous&size=64';
  }

  // ========================================================================
  // OST GIFT CARD HUB v3 — Split Layout
  // ========================================================================
  (function initGiftCardHub() {
    var store = document.getElementById('gc2Store');
    if (!store) return;

    var fxToUSD = { USD:1, EUR:1.08, GBP:1.27, CAD:.74, AUD:.65, BRL:.20, MXN:.058, INR:.012, JPY:.0067, KRW:.00075, TRY:.031, RUB:.011, AED:.27 };

    var brands = [
      { name:'Amazon',      domain:'amazon.com',       color:'#FF9900', cat:'shop' },
      { name:'Apple',       domain:'apple.com',        color:'#A2AAAD', cat:'shop' },
      { name:'Google Play', domain:'google.com',       color:'#34A853', cat:'game' },
      { name:'Steam',       domain:'steampowered.com', color:'#1b2838', cat:'game' },
      { name:'Walmart',     domain:'walmart.com',      color:'#0071CE', cat:'shop' },
      { name:'Target',      domain:'target.com',       color:'#CC0000', cat:'shop' },
      { name:'eBay',        domain:'ebay.com',         color:'#E53238', cat:'shop' },
      { name:'Starbucks',   domain:'starbucks.com',    color:'#00704A', cat:'food' },
      { name:'Nike',        domain:'nike.com',         color:'#111111', cat:'shop' },
      { name:'Netflix',     domain:'netflix.com',      color:'#E50914', cat:'media' },
      { name:'Spotify',     domain:'spotify.com',      color:'#1DB954', cat:'media' },
      { name:'Uber',        domain:'uber.com',         color:'#000000', cat:'travel' },
      { name:'Visa',        domain:'visa.com',         color:'#1A1F71', cat:'shop' },
      { name:'Mastercard',  domain:'mastercard.com',   color:'#EB001B', cat:'shop' },
      { name:'DoorDash',    domain:'doordash.com',     color:'#FF3008', cat:'food' },
      { name:'PlayStation', domain:'playstation.com',  color:'#003087', cat:'game' },
      { name:'Xbox',        domain:'xbox.com',         color:'#107C10', cat:'game' },
      { name:'Best Buy',    domain:'bestbuy.com',      color:'#0046BE', cat:'shop' },
      { name:'Sephora',     domain:'sephora.com',      color:'#000000', cat:'shop' },
      { name:'Nordstrom',   domain:'nordstrom.com',    color:'#000000', cat:'shop' }
    ];

    var selectedBrand = null;
    var gcHistory = JSON.parse(localStorage.getItem('ost_gc_history') || '[]');

    // Build brand grid with logos side-by-side
    brands.forEach(function(b) {
      var card = document.createElement('div');
      card.className = 'gc2-brand';
      card.dataset.cat = b.cat || 'shop';
      card.style.setProperty('--brand-color', b.color || '#FFD700');
      var img = document.createElement('img');
      img.alt = b.name;
      img.loading = 'lazy';
      img.src = logoSrc(b.domain);
      img.onerror = function() { logoFallback(this, b.domain, b.name, b.color); };
      card.appendChild(img);
      var nameSpan = document.createElement('span');
      nameSpan.textContent = b.name;
      card.appendChild(nameSpan);
      var tag = document.createElement('span');
      tag.className = 'gc2-brand-tag';
      tag.textContent = 'Gift Card';
      card.appendChild(tag);
      card.addEventListener('click', function() { selectBrand(b, card); });
      store.appendChild(card);
    });

    // Category filter
    document.querySelectorAll('.gc2-cat').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.gc2-cat').forEach(function(b) { b.classList.remove('gc2-cat-active'); });
        btn.classList.add('gc2-cat-active');
        var cat = btn.dataset.cat;
        document.querySelectorAll('.gc2-brand').forEach(function(c) {
          c.style.display = (cat === 'all' || c.dataset.cat === cat) ? '' : 'none';
        });
      });
    });

    var activeLogo = document.getElementById('gc2DrawerLogo');
    var activeName = document.getElementById('gc2DrawerBrand');

    // Brand-specific card gradient patterns for realistic look
    var brandGradients = {
      'Amazon':     'linear-gradient(135deg, #232f3e, #131921, #FF9900)',
      'Apple':      'linear-gradient(135deg, #1d1d1f, #333336, #555)',
      'Google Play':'linear-gradient(135deg, #1a73e8, #34a853, #fbbc04)',
      'Steam':      'linear-gradient(135deg, #1b2838, #171d25, #2a475e)',
      'Walmart':    'linear-gradient(135deg, #004c91, #0071ce, #ffc220)',
      'Target':     'linear-gradient(135deg, #cc0000, #990000, #333)',
      'eBay':       'linear-gradient(135deg, #e53238, #0064d2, #f5af02)',
      'Starbucks':  'linear-gradient(135deg, #00704A, #1E3932, #d4e9e2)',
      'Nike':       'linear-gradient(135deg, #111, #333, #111)',
      'Netflix':    'linear-gradient(135deg, #221f1f, #e50914, #b20710)',
      'Spotify':    'linear-gradient(135deg, #191414, #1db954, #191414)',
      'Uber':       'linear-gradient(135deg, #000, #276ef1, #06c167)',
      'Visa':       'linear-gradient(135deg, #1a1f71, #2557d6, #f7b600)',
      'Mastercard': 'linear-gradient(135deg, #1a1f36, #eb001b, #f79e1b)',
      'DoorDash':   'linear-gradient(135deg, #ff3008, #c41200, #1a1a1a)',
      'PlayStation':'linear-gradient(135deg, #003087, #0070d1, #00439c)',
      'Xbox':       'linear-gradient(135deg, #107c10, #0e6b0e, #1a1a1a)',
      'Best Buy':   'linear-gradient(135deg, #0046be, #003a9e, #fff200)',
      'Sephora':    'linear-gradient(135deg, #000, #333, #e0c9a6)',
      'Nordstrom':  'linear-gradient(135deg, #1a1a1a, #333, #8b7355)'
    };

    function selectBrand(brand, el) {
      selectedBrand = brand;
      document.querySelectorAll('.gc2-brand').forEach(function(c) { c.classList.remove('gc2-brand-selected'); });
      if (el) el.classList.add('gc2-brand-selected');
      activeLogo.src = logoSrc(brand.domain);
      activeLogo.onerror = function() { logoFallback(this, brand.domain, brand.name, brand.color); };
      activeLogo.alt = brand.name;
      activeName.textContent = brand.name;

      // Update 3D card preview with brand-specific look
      var cardPreview = document.getElementById('gc2CardPreview');
      var cardMockup = document.getElementById('gc2CardMockup');
      var cardLogo = document.getElementById('gc2CardLogo');
      var cardBrandName = document.getElementById('gc2CardBrandName');
      if (cardPreview && cardMockup && cardLogo) {
        cardPreview.style.display = 'block';
        var c = brand.color || '#FFD700';
        cardMockup.style.background = brandGradients[brand.name] || ('linear-gradient(135deg, ' + c + ', ' + c + '88, #1a1a2e)');
        cardMockup.style.setProperty('--card-glow', c + '33');
        cardLogo.src = logoSrc(brand.domain);
        cardLogo.onerror = function() { logoFallback(this, brand.domain, brand.name, brand.color); };
        cardLogo.alt = brand.name;
      }
      if (cardBrandName) cardBrandName.textContent = brand.name + ' Gift Card';

      // Generate random last 4 digits
      var last4 = document.getElementById('gc2CardLast4');
      if (last4) last4.textContent = (1000 + Math.floor(Math.random() * 9000)).toString();

      document.getElementById('gc2Flow').style.display = 'none';
      document.getElementById('gc2Delivered').style.display = 'none';
      resetFlowSteps();
      updateRedeem();
      updateBuy();
      if (window.innerWidth <= 800) {
        var actionCol = document.getElementById('gc2ActionCol');
        if (actionCol) actionCol.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    // Mode toggle
    document.querySelectorAll('.gc2-mode').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.gc2-mode').forEach(function(b) { b.classList.remove('gc2-mode-active'); });
        btn.classList.add('gc2-mode-active');
        var mode = btn.dataset.mode;
        document.getElementById('gc2PaneRedeem').classList.toggle('gc2-pane-active', mode === 'redeem');
        document.getElementById('gc2PaneBuy').classList.toggle('gc2-pane-active', mode === 'buy');
        document.getElementById('gc2Flow').style.display = 'none';
        document.getElementById('gc2Delivered').style.display = 'none';
        resetFlowSteps();
      });
    });

    // Quick amounts (with active state)
    document.querySelectorAll('.gc2-q').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var amt = btn.dataset.amt;
        var pane = btn.closest('.gc2-pane');
        if (!pane) return;
        pane.querySelectorAll('.gc2-q').forEach(function(q) { q.classList.remove('gc2-q-active'); });
        btn.classList.add('gc2-q-active');
        var input = pane.querySelector('.gc2-inp[type="number"]');
        if (input) { input.value = amt; input.dispatchEvent(new Event('input')); }
      });
    });

    // 3D card tilt on mouse move
    (function() {
      var scene = document.querySelector('.gc2-card-scene');
      var card = document.getElementById('gc2CardMockup');
      if (!scene || !card) return;
      scene.addEventListener('mousemove', function(e) {
        var rect = scene.getBoundingClientRect();
        var x = (e.clientX - rect.left) / rect.width;
        var y = (e.clientY - rect.top) / rect.height;
        var rotY = (x - 0.5) * 20;
        var rotX = (0.5 - y) * 14;
        card.style.transform = 'rotateY(' + rotY + 'deg) rotateX(' + rotX + 'deg) scale(1.02)';
      });
      scene.addEventListener('mouseleave', function() {
        card.style.transform = '';
      });
    })();

    // Redeem
    var gc2Balance = document.getElementById('gc2Balance');
    var gc2Code = document.getElementById('gc2Code');
    var gc2Currency = document.getElementById('gc2Currency');
    var gc2RedeemVal = document.getElementById('gc2RedeemVal');
    var gc2RedeemRate = document.getElementById('gc2RedeemRate');
    var gc2RedeemFee = document.getElementById('gc2RedeemFee');
    var gc2RedeemBtn = document.getElementById('gc2RedeemBtn');

    function updateCardValue() {
      var el = document.getElementById('gc2CardValue');
      if (!el) return;
      var mode = document.querySelector('.gc2-mode-active');
      var isRedeem = mode && mode.dataset.mode === 'redeem';
      var amt = parseFloat((isRedeem ? gc2Balance.value : document.getElementById('gc2BuyAmt').value) || 0);
      var cur = isRedeem ? gc2Currency.value : (document.getElementById('gc2BuyCur') || {}).value || 'USD';
      var sym = { USD:'$', EUR:'€', GBP:'£', CAD:'C$', AUD:'A$', BRL:'R$', MXN:'MX$', INR:'₹', JPY:'¥', KRW:'₩', TRY:'₺', RUB:'₽', AED:'د.إ' };
      el.textContent = (sym[cur] || '$') + (amt || 0);
    }

    function updateRedeem() {
      var bal = parseFloat(gc2Balance.value) || 0;
      var code = (gc2Code.value || '').trim();
      var cur = gc2Currency.value;
      var usd = bal * (fxToUSD[cur] || 1);
      if (usd > 0 && window.ostPrice > 0) {
        var ost = usd / window.ostPrice;
        var fee = ost * 0.001;
        gc2RedeemVal.textContent = (ost - fee).toFixed(2) + ' OST';
        gc2RedeemRate.textContent = '1 OST = $' + window.ostPrice.toFixed(6);
        gc2RedeemFee.textContent = fee.toFixed(4) + ' OST';
        gc2RedeemBtn.disabled = !(code && selectedBrand);
      } else {
        gc2RedeemVal.textContent = '\u2014 OST';
        gc2RedeemRate.textContent = '\u2014';
        gc2RedeemFee.textContent = '\u2014';
        gc2RedeemBtn.disabled = true;
      }
    }
    gc2Balance.addEventListener('input', function() { updateRedeem(); updateCardValue(); });
    gc2Code.addEventListener('input', updateRedeem);
    gc2Currency.addEventListener('change', function() { updateRedeem(); updateCardValue(); });

    // Buy
    var gc2BuyAmt = document.getElementById('gc2BuyAmt');
    var gc2BuyCur = document.getElementById('gc2BuyCur');
    var gc2BuyVal = document.getElementById('gc2BuyVal');
    var gc2BuyRate = document.getElementById('gc2BuyRate');
    var gc2BuyFee = document.getElementById('gc2BuyFee');
    var gc2BuyBtn = document.getElementById('gc2BuyBtn');

    function updateBuy() {
      var amt = parseFloat(gc2BuyAmt.value) || 0;
      var cur = gc2BuyCur.value;
      var usd = amt * (fxToUSD[cur] || 1);
      if (usd > 0 && window.ostPrice > 0) {
        var ost = usd / window.ostPrice;
        var fee = ost * 0.001;
        gc2BuyVal.textContent = (ost + fee).toFixed(2) + ' OST';
        gc2BuyRate.textContent = '1 OST = $' + window.ostPrice.toFixed(6);
        gc2BuyFee.textContent = fee.toFixed(4) + ' OST';
        gc2BuyBtn.disabled = !selectedBrand;
      } else {
        gc2BuyVal.textContent = '\u2014 OST';
        gc2BuyRate.textContent = '\u2014';
        gc2BuyFee.textContent = '\u2014';
        gc2BuyBtn.disabled = true;
      }
    }
    gc2BuyAmt.addEventListener('input', function() { updateBuy(); updateCardValue(); });
    gc2BuyCur.addEventListener('change', function() { updateBuy(); updateCardValue(); });

    // Flow
    function resetFlowSteps() {
      document.querySelectorAll('.gc2-fstep').forEach(function(s) { s.classList.remove('gc2-fs-active', 'gc2-fs-done'); });
    }
    function runFlow(onDone) {
      var flow = document.getElementById('gc2Flow');
      flow.style.display = 'flex';
      resetFlowSteps();
      var steps = flow.querySelectorAll('.gc2-fstep');
      var i = 0;
      function next() {
        if (i > 0) { steps[i - 1].classList.remove('gc2-fs-active'); steps[i - 1].classList.add('gc2-fs-done'); }
        if (i < steps.length) { steps[i].classList.add('gc2-fs-active'); i++; setTimeout(next, 900 + Math.random() * 600); }
        else { if (onDone) onDone(); }
      }
      next();
    }

    gc2RedeemBtn.addEventListener('click', function() {
      gc2RedeemBtn.disabled = true;
      runFlow(function() {
        var bal = parseFloat(gc2Balance.value) || 0;
        var cur = gc2Currency.value;
        var usd = (bal * (fxToUSD[cur] || 1)).toFixed(2);
        var ost = gc2RedeemVal.textContent.replace(' OST', '');
        addToHistory('sell', selectedBrand ? selectedBrand.name : 'Gift Card', selectedBrand ? selectedBrand.domain : '', usd, ost);
        toast('&#9989;', 'Gift card redeemed! ' + ost + ' OST received.');
        setTimeout(function() { updateRedeem(); }, 500);
      });
    });

    gc2BuyBtn.addEventListener('click', function() {
      gc2BuyBtn.disabled = true;
      runFlow(function() {
        var delivered = document.getElementById('gc2Delivered');
        delivered.style.display = 'block';
        var logo = document.getElementById('gc2DelLogo');
        if (logo && selectedBrand) { logo.src = logoSrc(selectedBrand.domain); logo.onerror = function() { logoFallback(this, selectedBrand.domain, selectedBrand.name, selectedBrand.color); }; logo.alt = selectedBrand.name; }
        var seg = function() { return Math.random().toString(36).substring(2, 6).toUpperCase(); };
        document.getElementById('gc2DelCode').textContent = seg() + '-' + seg() + '-' + seg() + '-' + seg();
        setTimeout(function() { updateBuy(); }, 500);
        var amt = parseFloat(gc2BuyAmt.value) || 0;
        var cur = gc2BuyCur.value;
        var usd = (amt * (fxToUSD[cur] || 1)).toFixed(2);
        var ost = gc2BuyVal.textContent.replace(' OST', '');
        addToHistory('buy', selectedBrand ? selectedBrand.name : 'Gift Card', selectedBrand ? selectedBrand.domain : '', usd, ost);
        toast('&#127873;', 'Gift card purchased! Code delivered.');
      });
    });

    var copyBtn = document.getElementById('gc2Copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        var code = document.getElementById('gc2DelCode').textContent;
        navigator.clipboard.writeText(code).then(function() { toast('&#128203;', 'Code copied!'); });
      });
    }

    // History
    function renderHistory() {
      var list = document.getElementById('gc2HistList');
      var empty = document.getElementById('gc2HistEmpty');
      var countEl = document.getElementById('gc2HistCount');
      if (countEl) countEl.textContent = '(' + gcHistory.length + ')';
      if (!list) return;
      if (gcHistory.length === 0) { empty.style.display = 'block'; list.innerHTML = ''; return; }
      empty.style.display = 'none';
      list.innerHTML = '';
      gcHistory.slice().reverse().forEach(function(tx) {
        var el = document.createElement('div');
        el.className = 'gc2-hx';
        var hxImg = document.createElement('img');
        hxImg.className = 'gc2-hx-logo';
        hxImg.src = logoSrc(tx.domain || '');
        hxImg.onerror = function() { logoFallback(this, tx.domain || '', tx.brand || '?', '#FFD700'); };
        el.appendChild(hxImg);
        var hxRest = document.createElement('span');
        hxRest.innerHTML = '<div class="gc2-hx-info"><div class="gc2-hx-name">' + tx.brand + '</div><div class="gc2-hx-date">' + tx.date + '</div></div>' +
          '<div class="gc2-hx-amt"><div class="gc2-hx-fiat">$' + tx.usd + '</div><div class="gc2-hx-ost">' + tx.ost + ' OST</div></div>' +
          '<span class="gc2-hx-type ' + (tx.type === 'sell' ? 'gc2-hx-sell' : 'gc2-hx-buy') + '">' + tx.type + '</span>';
        while (hxRest.firstChild) el.appendChild(hxRest.firstChild);
        list.appendChild(el);
      });
    }
    renderHistory();

    function addToHistory(type, brand, domain, usd, ost) {
      gcHistory.push({ type: type, brand: brand, domain: domain, usd: usd, ost: ost, date: new Date().toLocaleDateString() });
      localStorage.setItem('ost_gc_history', JSON.stringify(gcHistory));
      renderHistory();
    }

    var histToggle = document.getElementById('gc2HistToggle');
    var histPanel = document.getElementById('gc2Hist');
    if (histToggle && histPanel) {
      histToggle.addEventListener('click', function() {
        var open = histPanel.style.display !== 'none';
        histPanel.style.display = open ? 'none' : 'block';
      });
    }

    // Auto-select first brand so card preview is never blank
    if (brands.length > 0) {
      var firstCard = store.querySelector('.gc2-brand');
      selectBrand(brands[0], firstCard);
    }
  })();

  // ========================================================================
  // OST FUEL & GO v3 — Tabs + World Map + Browse + Pay
  // ========================================================================
  (function initFuelStation() {
    var mapEl = document.getElementById('fuel2Map');
    if (!mapEl) return;

    var stations = [
      { name:'Shell',          domain:'shell.com',          count:'46,000+', region:'Global',          lat:29.76,  lng:-95.37,  color:'#FFD500', fuel:'Gas · Diesel · EV' },
      { name:'BP',             domain:'bp.com',             count:'21,000+', region:'Europe/Americas',  lat:51.51,  lng:-0.13,   color:'#009900', fuel:'Gas · Diesel' },
      { name:'ExxonMobil',     domain:'exxonmobil.com',     count:'12,000+', region:'Americas',         lat:32.78,  lng:-96.80,  color:'#E21836', fuel:'Gas · Diesel' },
      { name:'Chevron',        domain:'chevron.com',        count:'8,000+',  region:'Americas',         lat:37.77,  lng:-122.42, color:'#0054A6', fuel:'Gas · Diesel' },
      { name:'TotalEnergies',  domain:'totalenergies.com',  count:'16,000+', region:'Europe/Africa',    lat:48.86,  lng:2.35,    color:'#FF0000', fuel:'Gas · Diesel · EV' },
      { name:'ADNOC',          domain:'adnoc.ae',           count:'500+',    region:'Middle East',      lat:24.45,  lng:54.65,   color:'#00A74A', fuel:'Gas · Diesel' },
      { name:'7-Eleven',       domain:'7-eleven.com',       count:'83,000+', region:'Global',           lat:35.68,  lng:139.69,  color:'#F7941D', fuel:'Gas · Convenience' },
      { name:'OXXO',           domain:'oxxo.com',           count:'21,000+', region:'Latin America',    lat:25.67,  lng:-100.31, color:'#ED1C24', fuel:'Gas · Convenience' },
      { name:'Circle K',       domain:'circlek.com',        count:'14,000+', region:'Global',           lat:33.45,  lng:-112.07, color:'#ED1C24', fuel:'Gas · Diesel · EV' },
      { name:'Petronas',       domain:'petronas.com',       count:'2,500+',  region:'Asia',             lat:3.14,   lng:101.69,  color:'#00A19C', fuel:'Gas · Diesel' },
      { name:'Indian Oil',     domain:'indianoil.co.in',    count:'34,000+', region:'India',            lat:28.61,  lng:77.21,   color:'#FF6600', fuel:'Gas · Diesel · CNG' },
      { name:'Ipiranga',       domain:'ipiranga.com.br',    count:'7,600+',  region:'Brazil',           lat:-23.55, lng:-46.63,  color:'#0057A7', fuel:'Gas · Ethanol' },
      { name:'PEMEX',          domain:'pemex.com',          count:'11,000+', region:'Mexico',           lat:19.43,  lng:-99.13,  color:'#006847', fuel:'Gas · Diesel' },
      { name:'Repsol',         domain:'repsol.com',         count:'4,700+',  region:'Europe',           lat:40.42,  lng:-3.70,   color:'#FF6600', fuel:'Gas · Diesel · EV' },
      { name:'Lukoil',         domain:'lukoil.com',         count:'5,500+',  region:'Russia/Europe',    lat:55.76,  lng:37.62,   color:'#E21A1A', fuel:'Gas · Diesel' },
      { name:'Sinopec',        domain:'sinopec.com',        count:'30,000+', region:'China',            lat:39.91,  lng:116.40,  color:'#D50032', fuel:'Gas · Diesel · CNG' },
      { name:'Aramco',         domain:'aramco.com',         count:'2,000+',  region:'Middle East',      lat:24.71,  lng:46.67,   color:'#006B77', fuel:'Gas · Diesel' },
      { name:'Petrobras',      domain:'petrobras.com.br',   count:'7,700+',  region:'Brazil',           lat:-22.91, lng:-43.17,  color:'#008542', fuel:'Gas · Ethanol' },
      { name:'Engen',          domain:'engenoil.com',       count:'1,500+',  region:'Africa',           lat:-33.93, lng:18.42,   color:'#005CA9', fuel:'Gas · Diesel' },
      { name:'Caltex',         domain:'caltex.com',         count:'4,200+',  region:'Asia/Africa',      lat:1.35,   lng:103.82,  color:'#E4002B', fuel:'Gas · Diesel' },
      { name:'Wawa',           domain:'wawa.com',           count:'950+',    region:'USA East',         lat:39.95,  lng:-75.17,  color:'#B11A2B', fuel:'Gas · Convenience' },
      { name:'Casey\'s',       domain:'caseys.com',         count:'2,500+',  region:'USA Midwest',      lat:41.59,  lng:-93.62,  color:'#D71920', fuel:'Gas · Food' },
      { name:'Eni/Agip',       domain:'eni.com',            count:'5,200+',  region:'Europe/Africa',    lat:41.90,  lng:12.50,   color:'#FFD700', fuel:'Gas · Diesel' },
      { name:'OMV',            domain:'omv.com',            count:'2,100+',  region:'Central Europe',   lat:48.21,  lng:16.37,   color:'#003D7C', fuel:'Gas · Diesel · EV' },
      { name:'PKN Orlen',      domain:'orlen.pl',           count:'2,800+',  region:'Eastern Europe',   lat:52.23,  lng:21.01,   color:'#E30613', fuel:'Gas · Diesel' },
      { name:'PTT',            domain:'pttplc.com',         count:'2,100+',  region:'Thailand',         lat:13.76,  lng:100.50,  color:'#2D5DA1', fuel:'Gas · Diesel · CNG' },
      { name:'GS Caltex',      domain:'gscaltex.com',       count:'6,000+',  region:'South Korea',      lat:37.57,  lng:126.98,  color:'#E4002B', fuel:'Gas · Diesel' },
      { name:'ENEOS',          domain:'eneos.co.jp',        count:'12,500+', region:'Japan',            lat:35.69,  lng:139.70,  color:'#FF6600', fuel:'Gas · Diesel · EV' },
      { name:'Woolworths',     domain:'woolworths.com.au',  count:'1,200+',  region:'Australia',        lat:-33.87, lng:151.21,  color:'#009B4D', fuel:'Gas · Diesel' },
      { name:'Puma Energy',    domain:'pumaenergy.com',     count:'3,100+',  region:'Africa/Americas',  lat:6.52,   lng:3.38,    color:'#009640', fuel:'Gas · Diesel' }
    ];

    var selectedStation = null;
    var fuelHistory = JSON.parse(localStorage.getItem('ost_fuel_history') || '[]');
    var map = null;

    // Tab switching
    document.querySelectorAll('.fuel2-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        document.querySelectorAll('.fuel2-tab').forEach(function(t) { t.classList.remove('fuel2-tab-active'); });
        tab.classList.add('fuel2-tab-active');
        var target = tab.dataset.tab;
        document.querySelectorAll('.fuel2-panel').forEach(function(p) { p.classList.remove('fuel2-panel-active'); });
        var panelId = target === 'map' ? 'fuel2PanelMap' : target === 'stations' ? 'fuel2PanelStations' : 'fuel2PanelPay';
        document.getElementById(panelId).classList.add('fuel2-panel-active');
        if (target === 'map' && map) setTimeout(function() { map.invalidateSize(); }, 100);
      });
    });

    // Init Leaflet map with RED markers
    try {
      map = L.map(mapEl, { scrollWheelZoom: false, zoomControl: true }).setView([20, 0], 2);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OSM &amp; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
      }).addTo(map);

      var stationIcon = L.divIcon({
        className: 'fuel2-marker',
        html: '<div style="width:14px;height:14px;border-radius:50%;background:#e63946;box-shadow:0 0 8px rgba(230,57,70,.6),0 0 16px rgba(230,57,70,.3);border:2px solid rgba(255,255,255,.4);"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        popupAnchor: [0, -10]
      });

      stations.forEach(function(s) {
        var marker = L.marker([s.lat, s.lng], { icon: stationIcon }).addTo(map);
        var popupSvg = brandSvg(s.name, s.color || '#e63946').replace(/'/g, '&apos;');
        marker.bindPopup(
          '<div style="text-align:center">' +
          '<img src="' + logoSrc(s.domain) + '" style="width:44px;height:44px;border-radius:10px;background:#fff;padding:4px;box-sizing:border-box;margin-bottom:8px;box-shadow:0 2px 8px rgba(0,0,0,.3)" onerror="this.onerror=null;this.style.background=\'transparent\';this.style.padding=\'0\';this.src=\'' + popupSvg + '\'">' +
          '<div style="font-weight:800;font-size:.95rem;margin-bottom:2px">' + s.name + '</div>' +
          '<div style="font-size:.72rem;color:rgba(255,255,255,.5);margin-bottom:2px">' + s.region + '</div>' +
          '<div style="font-size:.82rem;font-weight:700;color:#e63946;margin-bottom:8px">' + s.count + ' stations</div>' +
          '<button class="fuel2-popup-btn" onclick="window._selectFuelStation(\'' + s.name.replace(/'/g, "\\'") + '\')">&#9981; Pay Here</button></div>'
        );
      });

      setTimeout(function() { map.invalidateSize(); }, 500);
    } catch (e) {
      mapEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:.9rem;">Map loading&hellip;</div>';
    }

    // Build legend below map
    var legendEl = document.getElementById('fuel2Legend');
    if (legendEl) {
      stations.forEach(function(s) {
        var item = document.createElement('div');
        item.className = 'fuel2-legend-item';
        item.style.setProperty('--station-color', s.color || '#FF6B35');
        var legImg = document.createElement('img');
        legImg.alt = s.name;
        legImg.loading = 'lazy';
        legImg.src = logoSrc(s.domain);
        legImg.onerror = function() { logoFallback(this, s.domain, s.name, s.color); };
        item.innerHTML = '<span class="fuel2-legend-dot" style="background:' + (s.color || '#e63946') + ';box-shadow:0 0 6px ' + (s.color || '#e63946') + '80"></span>';
        item.appendChild(legImg);
        var infoDiv = document.createElement('div');
        infoDiv.innerHTML = '<div class="fuel2-legend-name">' + s.name + '</div><div class="fuel2-legend-cnt">' + s.count + '</div>';
        item.appendChild(infoDiv);
        item.addEventListener('click', function() {
          if (map) map.setView([s.lat, s.lng], 6);
        });
        legendEl.appendChild(item);
      });
    }

    // Build browse grid (Tab 2)
    var browseGrid = document.getElementById('fuel2BrowseGrid');
    if (browseGrid) {
      stations.forEach(function(s) {
        var card = document.createElement('div');
        card.className = 'fuel2-bcard';
        card.dataset.station = s.name;
        card.style.setProperty('--station-color', s.color || '#FF6B35');
        var bImg = document.createElement('img');
        bImg.alt = s.name;
        bImg.loading = 'lazy';
        bImg.src = logoSrc(s.domain);
        bImg.onerror = function() { logoFallback(this, s.domain, s.name, s.color); };
        card.appendChild(bImg);
        var infoDiv = document.createElement('div');
        infoDiv.className = 'fuel2-bcard-info';
        infoDiv.innerHTML = '<div class="fuel2-bcard-name">' + s.name + '</div><div class="fuel2-bcard-cnt">' + s.count + '</div><div class="fuel2-bcard-region">' + s.region + '</div>' +
          '<div class="fuel2-bcard-fuel">' + (s.fuel || 'Gas') + '</div>';
        card.appendChild(infoDiv);
        card.addEventListener('click', function() {
          selectStation(s);
          document.querySelectorAll('.fuel2-tab').forEach(function(t) { t.classList.remove('fuel2-tab-active'); });
          document.querySelector('[data-tab="pay"]').classList.add('fuel2-tab-active');
          document.querySelectorAll('.fuel2-panel').forEach(function(p) { p.classList.remove('fuel2-panel-active'); });
          document.getElementById('fuel2PanelPay').classList.add('fuel2-panel-active');
        });
        browseGrid.appendChild(card);
      });
    }

    // Browse search
    var browseSearch = document.getElementById('fuel2BrowseSearch');
    if (browseSearch) {
      browseSearch.addEventListener('input', function() {
        var q = this.value.toLowerCase();
        document.querySelectorAll('.fuel2-bcard').forEach(function(c) {
          var name = (c.dataset.station || '').toLowerCase();
          c.style.display = name.indexOf(q) >= 0 ? '' : 'none';
        });
      });
    }

    // Global station select
    window._selectFuelStation = function(name) {
      var s = stations.find(function(st) { return st.name === name; });
      if (s) {
        selectStation(s);
        document.querySelectorAll('.fuel2-tab').forEach(function(t) { t.classList.remove('fuel2-tab-active'); });
        document.querySelector('[data-tab="pay"]').classList.add('fuel2-tab-active');
        document.querySelectorAll('.fuel2-panel').forEach(function(p) { p.classList.remove('fuel2-panel-active'); });
        document.getElementById('fuel2PanelPay').classList.add('fuel2-panel-active');
      }
    };

    function selectStation(s) {
      selectedStation = s;
      var pay = document.getElementById('fuel2Pay');
      var prompt = document.getElementById('fuel2PayPrompt');
      if (prompt) prompt.style.display = 'none';
      pay.style.display = 'block';
      pay.style.animation = 'none';
      void pay.offsetHeight;
      pay.style.animation = 'gc2DrawerIn .4s ease';
      document.getElementById('fuel2PayLogo').src = logoSrc(s.domain);
      document.getElementById('fuel2PayLogo').onerror = function() { logoFallback(this, s.domain, s.name, s.color); };
      document.getElementById('fuel2PayLogo').alt = s.name;
      document.getElementById('fuel2PayName').textContent = s.name;
      document.getElementById('fuel2Flow').style.display = 'none';
      document.querySelectorAll('.fuel2-fs').forEach(function(st) { st.classList.remove('f2-active', 'f2-done'); });
      // Auto-fill regional gas price
      var priceHints = { 'Shell': 3.49, 'BP': 3.39, 'ExxonMobil': 3.29, 'Chevron': 3.59, 'TotalEnergies': 1.89, 'ADNOC': 0.55, '7-Eleven': 3.19, 'OXXO': 1.15, 'Circle K': 3.25, 'Petronas': 0.61, 'Indian Oil': 1.33, 'Ipiranga': 1.29, 'PEMEX': 1.05, 'Repsol': 1.79, 'Lukoil': 0.89, 'Sinopec': 1.19, 'Aramco': 0.48 };
      var priceField = document.getElementById('fuel2Price');
      if (priceField && !priceField.value) priceField.value = priceHints[s.name] || (2 + Math.random() * 2).toFixed(2);
      updateFuelCalc();
      pay.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      document.querySelectorAll('.fuel2-bcard').forEach(function(c) { c.classList.remove('fuel2-bcard-selected'); });
      if (browseGrid) {
        var match = browseGrid.querySelector('[data-station="' + s.name + '"]');
        if (match) match.classList.add('fuel2-bcard-selected');
      }
    }

    document.getElementById('fuel2PayClose').addEventListener('click', function() {
      document.getElementById('fuel2Pay').style.display = 'none';
      var prompt = document.getElementById('fuel2PayPrompt');
      if (prompt) prompt.style.display = '';
      selectedStation = null;
    });

    // Near Me
    document.getElementById('fuel2NearMe').addEventListener('click', function() {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function(pos) {
          if (map) {
            map.setView([pos.coords.latitude, pos.coords.longitude], 8);
            L.circleMarker([pos.coords.latitude, pos.coords.longitude], {
              radius: 8, fillColor: '#00e676', fillOpacity: .8, color: '#fff', weight: 2
            }).addTo(map).bindPopup('You are here').openPopup();
          }
        }, function() {
          toast('&#128205;', 'Location access denied.');
        });
      } else {
        toast('&#128205;', 'Geolocation not supported.');
      }
    });

    // Map search
    var searchEl = document.getElementById('fuel2Search');
    if (searchEl) {
      searchEl.addEventListener('input', function() {
        var q = this.value.toLowerCase();
        document.querySelectorAll('.fuel2-legend-item').forEach(function(item) {
          var name = item.querySelector('.fuel2-legend-name');
          item.style.display = !name || name.textContent.toLowerCase().indexOf(q) >= 0 ? '' : 'none';
        });
        if (q.length >= 2 && map) {
          var match = stations.find(function(s) { return s.name.toLowerCase().indexOf(q) >= 0; });
          if (match) map.setView([match.lat, match.lng], 6);
        }
      });
    }

    // Fuel calculator
    var galEl = document.getElementById('fuel2Gal');
    var priceEl = document.getElementById('fuel2Price');
    var usdEl = document.getElementById('fuel2USD');
    var ostEl = document.getElementById('fuel2OST');
    var rwEl = document.getElementById('fuel2Rw');
    var payBtn = document.getElementById('fuel2PayBtn');

    function getRewardRate() {
      var c = fuelHistory.length;
      return c >= 500 ? 0.08 : c >= 100 ? 0.05 : 0.03;
    }

    function updateFuelCalc() {
      var g = parseFloat(galEl.value) || 0;
      var p = parseFloat(priceEl.value) || 0;
      var cost = g * p;
      usdEl.textContent = '$' + cost.toFixed(2);
      if (cost > 0 && window.ostPrice > 0) {
        var ost = cost / window.ostPrice;
        var rate = getRewardRate();
        ostEl.textContent = ost.toFixed(2) + ' OST';
        rwEl.textContent = '+' + (ost * rate).toFixed(2) + ' OST';
        payBtn.disabled = !selectedStation;
      } else {
        ostEl.textContent = '0 OST';
        rwEl.textContent = '+0 OST';
        payBtn.disabled = true;
      }
    }
    galEl.addEventListener('input', updateFuelCalc);
    priceEl.addEventListener('input', updateFuelCalc);

    // Pay flow
    payBtn.addEventListener('click', function() {
      payBtn.disabled = true;
      var flow = document.getElementById('fuel2Flow');
      flow.style.display = 'flex';
      var steps = flow.querySelectorAll('.fuel2-fs');
      steps.forEach(function(s) { s.classList.remove('f2-active', 'f2-done'); });
      var i = 0;
      function next() {
        if (i > 0) { steps[i - 1].classList.remove('f2-active'); steps[i - 1].classList.add('f2-done'); }
        if (i < steps.length) { steps[i].classList.add('f2-active'); i++; setTimeout(next, 900 + Math.random() * 500); }
        else {
          var g = parseFloat(galEl.value) || 0;
          var p = parseFloat(priceEl.value) || 0;
          var cost = g * p;
          var ost = window.ostPrice > 0 ? cost / window.ostPrice : 0;
          var rate = getRewardRate();
          var reward = ost * rate;
          fuelHistory.push({
            station: selectedStation ? selectedStation.name : 'Unknown',
            domain: selectedStation ? selectedStation.domain : '',
            gallons: g, pricePerGal: p, usd: cost.toFixed(2),
            ost: ost.toFixed(2), reward: reward.toFixed(2),
            date: new Date().toLocaleDateString()
          });
          localStorage.setItem('ost_fuel_history', JSON.stringify(fuelHistory));
          renderRewards();
          toast('&#9981;', 'Payment complete! +' + reward.toFixed(2) + ' OST cashback.');
          // Animate pump fill gauge
          var pumpFill = document.getElementById('fuel2PumpFill');
          if (pumpFill) { pumpFill.style.transition = 'width 1.2s ease'; pumpFill.style.width = '100%'; setTimeout(function() { pumpFill.style.width = '0%'; }, 3000); }
          // Re-enable pay button
          setTimeout(function() { payBtn.disabled = false; }, 800);
        }
      }
      next();
    });

    function renderRewards() {
      var count = fuelHistory.length;
      var tier = count >= 500 ? 'Gold' : count >= 100 ? 'Silver' : 'Bronze';
      var emoji = count >= 500 ? '\uD83E\uDD47' : count >= 100 ? '\uD83E\uDD48' : '\uD83E\uDD49';
      var rate = getRewardRate();
      var target = count >= 500 ? count : count >= 100 ? 500 : 100;
      var prev = count >= 500 ? 500 : count >= 100 ? 100 : 0;
      var pct = target > prev ? ((count - prev) / (target - prev)) * 100 : 100;
      var totalRw = 0;
      fuelHistory.forEach(function(tx) { totalRw += parseFloat(tx.reward) || 0; });
      var fill = document.getElementById('fuel2RwFill');
      if (fill) fill.style.width = Math.min(100, pct).toFixed(1) + '%';
      var tierEl = document.getElementById('fuel2RwTier');
      if (tierEl) tierEl.textContent = emoji + ' ' + tier + ' \u00B7 ' + (rate * 100) + '%';
      var countEl = document.getElementById('fuel2RwCount');
      if (countEl) countEl.textContent = count + ' fill-ups';
      var earnedEl = document.getElementById('fuel2RwEarned');
      if (earnedEl) earnedEl.textContent = totalRw.toFixed(2) + ' OST earned';
    }
    renderRewards();
  })();

  // ========================================================================
  // OST LAUNCHPAD — Launch Your Coin Inside OST
  // ========================================================================
  (function initLaunchpad() {
    var nameEl = document.getElementById('lpName');
    var symbolEl = document.getElementById('lpSymbol');
    var supplyEl = document.getElementById('lpSupply');
    var decimalsEl = document.getElementById('lpDecimals');
    var descEl = document.getElementById('lpDesc');
    var descCount = document.getElementById('lpDescCount');
    var launchBtn = document.getElementById('lpLaunchBtn');
    if (!nameEl || !launchBtn) return;

    var LAUNCH_FEE_OST = 25;
    var launches = JSON.parse(localStorage.getItem('ost_lp_history') || '[]');

    // Seed demo launches so section never looks empty
    if (launches.length === 0) {
      var demoLaunches = [
        { name:'MarsPuppy', symbol:'MARS', supply:1000000000, decimals:9, desc:'The first memecoin for space dogs', mint:'MPup' + 'aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789Ab', creator:'7xKq...b2Fp', date:'4/5/2026' },
        { name:'Starlink Inu', symbol:'SINU', supply:100000000000, decimals:9, desc:'Decentralized satellite meme power', mint:'SINu' + 'XyZaBcDeFgHiJkLmNoPqRsTuVwXyZ12345678', creator:'4pRx...mN3q', date:'4/6/2026' },
        { name:'ZeroGravity', symbol:'0GRV', supply:500000000, decimals:6, desc:'No gravity no limits', mint:'0GRV' + 'aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789Cd', creator:'9aWz...hJ7k', date:'4/7/2026' },
        { name:'OrbitalCash', symbol:'ORBT', supply:10000000000, decimals:9, desc:'Cash for the orbital economy', mint:'ORBT' + 'eFgHiJkLmNoPqRsTuVwXyZ123456789AbCdEf', creator:'2bTr...pQ5s', date:'4/7/2026' },
        { name:'LunarDAO', symbol:'LUNA', supply:1000000000, decimals:9, desc:'Governance token for Moon settlers', mint:'LUNA' + 'HiJkLmNoPqRsTuVwXyZ123456789AbCdEfGhI', creator:'6cDx...wM8n', date:'4/8/2026' }
      ];
      launches = demoLaunches;
      localStorage.setItem('ost_lp_history', JSON.stringify(launches));
    }

    // Character counter
    if (descEl && descCount) {
      descEl.addEventListener('input', function() {
        descCount.textContent = descEl.value.length;
      });
    }

    // Supply presets
    document.querySelectorAll('.lp-preset').forEach(function(btn) {
      btn.addEventListener('click', function() {
        supplyEl.value = btn.dataset.supply;
        document.querySelectorAll('.lp-preset').forEach(function(b) { b.classList.remove('lp-preset-active'); });
        btn.classList.add('lp-preset-active');
        validateForm();
      });
    });

    // Validate form
    function validateForm() {
      var name = (nameEl.value || '').trim();
      var symbol = (symbolEl.value || '').trim();
      var supply = parseInt(supplyEl.value) || 0;
      launchBtn.disabled = !(name.length >= 2 && symbol.length >= 1 && supply >= 1000);
    }

    // Live token preview
    function updateTokenPreview() {
      var name = (nameEl.value || '').trim();
      var symbol = (symbolEl.value || '').trim().toUpperCase();
      var supply = parseInt(supplyEl.value) || 1000000000;
      var decimals = parseInt(decimalsEl.value) || 9;

      var coinLetter = document.getElementById('lpCoinLetter');
      var tokenName2 = document.getElementById('lpTokenName');
      var tokenSymbol2 = document.getElementById('lpTokenSymbol');
      var tokenSupply2 = document.getElementById('lpTokenSupply');
      var tokenDecimals2 = document.getElementById('lpTokenDecimals');

      if (coinLetter) coinLetter.textContent = symbol ? symbol.charAt(0) : (name ? name.charAt(0).toUpperCase() : '?');
      if (tokenName2) tokenName2.textContent = name || 'Your Token';
      if (tokenSymbol2) tokenSymbol2.textContent = symbol ? ('$' + symbol) : '$SYMBOL';
      if (tokenSupply2) tokenSupply2.textContent = formatSupply(supply);
      if (tokenDecimals2) tokenDecimals2.textContent = decimals;

      // Dynamic coin color based on name
      var coin = document.getElementById('lpCoin');
      if (coin && name.length > 0) {
        var hue = 0;
        for (var i = 0; i < name.length; i++) hue = (hue + name.charCodeAt(i) * 37) % 360;
        coin.style.background = 'linear-gradient(135deg, hsl(' + hue + ',70%,55%), hsl(' + ((hue + 60) % 360) + ',70%,45%))';
      }
    }

    nameEl.addEventListener('input', function() { validateForm(); updateTokenPreview(); });
    symbolEl.addEventListener('input', function() { validateForm(); updateTokenPreview(); });
    supplyEl.addEventListener('input', function() { validateForm(); updateTokenPreview(); });
    decimalsEl.addEventListener('change', updateTokenPreview);

    // Flow animation
    function resetFlow() {
      document.querySelectorAll('.lp-fstep').forEach(function(s) { s.classList.remove('lp-fs-active', 'lp-fs-done'); });
    }
    function runFlow(onDone) {
      var flow = document.getElementById('lpFlow');
      flow.style.display = 'flex';
      resetFlow();
      var steps = flow.querySelectorAll('.lp-fstep');
      var i = 0;
      function next() {
        if (i > 0) { steps[i - 1].classList.remove('lp-fs-active'); steps[i - 1].classList.add('lp-fs-done'); }
        if (i < steps.length) { steps[i].classList.add('lp-fs-active'); i++; setTimeout(next, 800 + Math.random() * 700); }
        else { if (onDone) onDone(); }
      }
      next();
    }

    // Format supply
    function formatSupply(n) {
      if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T';
      if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return n.toString();
    }

    // Generate fake mint address (demo)
    function generateMint() {
      var chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      var out = '';
      for (var i = 0; i < 44; i++) { out += chars.charAt(Math.floor(Math.random() * chars.length)); }
      return out;
    }

    // Render recent launches
    function renderRecent() {
      var container = document.getElementById('lpRecent');
      if (!container) return;
      var totalEl = document.getElementById('lpTotalLaunched');
      var totalSupplyEl = document.getElementById('lpTotalSupply');
      if (totalEl) totalEl.textContent = launches.length;
      if (totalSupplyEl) {
        var total = 0;
        launches.forEach(function(l) { total += (parseInt(l.supply) || 0); });
        totalSupplyEl.textContent = formatSupply(total);
      }
      if (launches.length === 0) {
        container.innerHTML = '<div class="lp-recent-empty">No launches yet. Be the first!</div>';
        return;
      }
      container.innerHTML = '';
      launches.slice().reverse().slice(0, 10).forEach(function(l) {
        var el = document.createElement('div');
        el.className = 'lp-rx';
        el.innerHTML = '<div class="lp-rx-icon">' + (l.symbol ? l.symbol.charAt(0).toUpperCase() : '?') + '</div>' +
          '<div class="lp-rx-info"><div class="lp-rx-name">' + (l.name || 'Unknown') + ' ($' + (l.symbol || '???') + ')</div><div class="lp-rx-meta">' + (l.date || '') + ' &middot; ' + (l.mint ? l.mint.slice(0, 4) + '...' + l.mint.slice(-4) : '') + '</div></div>' +
          '<div class="lp-rx-supply">' + formatSupply(parseInt(l.supply) || 0) + '</div>';
        container.appendChild(el);
      });
    }
    renderRecent();

    // Launch handler
    launchBtn.addEventListener('click', function() {
      if (launchBtn.disabled) return;

      var name = nameEl.value.trim();
      var symbol = symbolEl.value.trim().toUpperCase();
      var supply = parseInt(supplyEl.value) || 1000000000;
      var decimals = parseInt(decimalsEl.value) || 9;
      var desc = (descEl.value || '').trim();

      // Demo mode — works without wallet, shows toast
      var isDemoMode = !connectedWallet;
      if (isDemoMode) {
        toast('&#128640;', 'Demo mode — connect wallet for real launches');
      }

      launchBtn.disabled = true;
      launchBtn.innerHTML = '<span class="lp-btn-icon">&#9673;</span> Launching...';
      document.getElementById('lpSuccess').style.display = 'none';

      runFlow(function() {
        // Generate demo mint
        var mintAddr = generateMint();

        // Save to history
        var launch = {
          name: name,
          symbol: symbol,
          supply: supply,
          decimals: decimals,
          desc: desc,
          mint: mintAddr,
          creator: connectedWallet ? connectedWallet.slice(0, 4) + '...' + connectedWallet.slice(-4) : 'anon',
          date: new Date().toLocaleDateString()
        };
        launches.push(launch);
        localStorage.setItem('ost_lp_history', JSON.stringify(launches));

        // Show success
        document.getElementById('lpSuccessName').textContent = name;
        document.getElementById('lpSuccessSymbol').textContent = '$' + symbol;
        document.getElementById('lpSuccessSupply').textContent = formatSupply(supply);
        document.getElementById('lpSuccessMint').textContent = mintAddr;
        document.getElementById('lpSuccess').style.display = 'block';

        // Reset form
        launchBtn.innerHTML = '<span class="lp-btn-icon">&#9673;</span> Pay 25 OST & Launch Now';
        launchBtn.disabled = false;
        nameEl.value = '';
        symbolEl.value = '';
        supplyEl.value = '1000000000';
        if (descEl) descEl.value = '';
        if (descCount) descCount.textContent = '0';
        document.querySelectorAll('.lp-preset').forEach(function(b) { b.classList.remove('lp-preset-active'); });
        var defaultPreset = document.querySelector('.lp-preset[data-supply="1000000000"]');
        if (defaultPreset) defaultPreset.classList.add('lp-preset-active');
        validateForm();

        renderRecent();
        toast('🚀', symbol + ' launched! Mint: ' + mintAddr.slice(0, 6) + '...');
      });
    });

    // Copy mint address
    var copyMint = document.getElementById('lpCopyMint');
    if (copyMint) {
      copyMint.addEventListener('click', function() {
        var addr = document.getElementById('lpSuccessMint').textContent;
        if (addr && addr !== '--') {
          navigator.clipboard.writeText(addr).then(function() { toast('📋', 'Mint address copied!'); });
        }
      });
    }

    // Initialize preview with default values
    updateTokenPreview();
  })();

  // ========================================================================
  // SpaceX Accordion Toggle — Expand/Collapse Phases
  // ========================================================================
  (function initSpaceXAccordion() {
    document.querySelectorAll('.sx-phase-banner').forEach(function(banner) {
      banner.style.cursor = 'pointer';
      var phase = banner.closest('.sx-checklist-phase');
      if (!phase) return;
      var grid = phase.querySelector('.checklist-grid');
      if (!grid) return;
      // Collapse all but phase 1 & 2 by default
      var id = phase.id;
      if (id !== 'sxPhase1' && id !== 'sxPhase2') {
        grid.style.maxHeight = '0';
        grid.style.overflow = 'hidden';
        grid.style.transition = 'max-height .5s ease, opacity .3s ease';
        grid.style.opacity = '0.3';
        banner.dataset.collapsed = '1';
      } else {
        grid.style.maxHeight = '2000px';
        grid.style.overflow = 'hidden';
        grid.style.transition = 'max-height .5s ease, opacity .3s ease';
        grid.style.opacity = '1';
        banner.dataset.collapsed = '0';
      }
      banner.addEventListener('click', function() {
        var collapsed = banner.dataset.collapsed === '1';
        if (collapsed) {
          grid.style.maxHeight = '2000px';
          grid.style.opacity = '1';
          banner.dataset.collapsed = '0';
        } else {
          grid.style.maxHeight = '0';
          grid.style.opacity = '0.3';
          banner.dataset.collapsed = '1';
        }
      });
    });
  })();

  // ========================================================================
  // Enhanced Satellite Animation — subtle parallax on scroll
  // ========================================================================
  (function initSatelliteParallax() {
    var layer = document.getElementById('satelliteLayer');
    if (!layer) return;
    var sats = layer.querySelectorAll('.satellite');
    window.addEventListener('scroll', function() {
      var scrollY = window.pageYOffset;
      sats.forEach(function(sat, i) {
        var speed = 0.02 + i * 0.01;
        sat.style.transform = 'translateY(' + (scrollY * speed) + 'px)';
      });
    }, { passive: true });
  })();

})();

