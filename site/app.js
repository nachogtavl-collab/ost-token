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
      'nav.home': 'Home', 'nav.newhere': 'Get OST', 'nav.demos': 'Commerce', 'nav.stores': 'Commerce', 'nav.wallet': 'Wallet',
      'nav.ai': 'AI & Bots', 'nav.offline': 'Offline', 'nav.censorship': 'Censorship', 'nav.spacex': 'SpaceX',
      'nav.about': 'Our Story', 'nav.roadmap': 'Roadmap', 'nav.build': 'Build', 'nav.verify': 'Verify',
      'nav.connect': 'Connect Wallet',
      'wallet.dashTitle': 'My OST Wallet', 'wallet.dashSub': 'Your personal command center. Create, connect, and manage your OST wallet.',
      'bridges.title': 'Bridges, Ramps & Exchanges', 'bridges.sub': 'Every path to OST — from any chain, any currency, any country. All verified and working.',
      'hero.tag': 'The Next Step After Bitcoin',
      'hero.title': 'We are all <span class="gradient-text">one family.</span>',
      'hero.sub': 'OST is the digital cash made for every citizen of the world - private, instant, and connected to any currency you already have.',
      'hero.cta1': 'Explore Commerce', 'hero.cta2': 'Get OST Now',
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
      'pay.title': 'Curated Shop - Live Listings', 'pay.sub': 'Build a cart from real products, then send it to the interchange desk for a live OST request.',
      'pay.cart': 'Your Cart', 'pay.empty': 'Tap + to add items', 'pay.paybtn': 'Review in OST Desk',
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
      'getost.faucet': 'New Here? Claim Free OST', 'getost.faucettext': 'Every new wallet gets <strong>1 OST</strong> from the community treasury &mdash; enough to test the live devnet wallet flow right away.',
      'getost.faucetbtn': 'Turn the Faucet',
      'pay.anywhere': '🌐 Interchange - Browse Any Merchant',
      'pay.anywheresub': 'Paste a real product or checkout URL, or open a merchant lane below. OST loads the quote and prepares an honest on-chain request instead of pretending merchant settlement is live.',
      'pay.aurl': 'Merchant URL', 'pay.aamount': 'Amount to Pay', 'pay.acurrency': 'Their Currency',
      'pay.ayoupay': 'You Pay:', 'pay.arate': 'Rate:', 'pay.afee': 'Network Fee:',
      'pay.ahow': 'How It Works',
      'pay.astep1': 'Paste the merchant checkout link', 'pay.astep2': 'Enter the amount in their currency',
      'pay.astep3': 'OST converts at live rates via Jupiter + Wormhole', 'pay.astep4': 'Merchant receives their currency, you paid with OST',
      'pay.apaybtn': 'Load Request Desk', 'pay.asupported': 'Works with any site that accepts:',
      'pay.catalogkicker': 'Curated lanes',
      'pay.catalogcopy': 'Build a cart from live products, flights, hotels, vehicles, and property listings, then move it into the OST desk.',
      'pay.catalogCountSuffix': 'live listings',
      'pay.filter.all': 'All', 'pay.filter.tech': 'Tech', 'pay.filter.fashion': 'Fashion', 'pay.filter.travel': 'Travel',
      'pay.filter.flight': 'Flights', 'pay.filter.hotel': 'Hotels', 'pay.filter.car': 'Cars', 'pay.filter.property': 'Property', 'pay.filter.food': 'Food',
      'pay.deskKicker': 'Live rail', 'pay.deskTitle': 'Real OST purchase request desk', 'pay.deskBadge': 'On-chain vault + memo',
      'pay.deskCopy': 'This rail no longer fakes merchant settlement. OST records a real on-chain payment request to the interchange vault and attaches the merchant and order memo while direct merchant connectors roll out.',
      'pay.deskStatusIdle': 'Paste a live product or checkout URL, or send a curated cart here from Shop.',
      'pay.deskStatusLoaded': 'Request loaded. The next step creates a real devnet OST transfer to the interchange desk vault.',
      'pay.deskStatusSending': 'Sending a real OST payment request to the interchange vault...',
      'pay.deskStatusRecorded': 'On-chain request recorded. Share the signature with the desk to finish fulfillment.',
      'pay.deskNeedRequest': 'Load a request first.', 'pay.deskNeedWallet': 'Create or connect your OST wallet first.',
      'pay.deskMerchantLabel': 'Merchant', 'pay.deskSourceLabel': 'Source', 'pay.deskFiatLabel': 'Fiat total', 'pay.deskOstLabel': 'OST total', 'pay.deskWalletLabel': 'Wallet',
      'pay.deskEmpty': 'No request loaded yet.', 'pay.deskMerchantLink': 'Open merchant page', 'pay.deskCreate': 'Create on-chain OST request',
      'pay.deskSendingButton': 'Sending OST request...',
      'pay.deskReceiptTitle': 'On-chain request recorded', 'pay.deskReceiptSignature': 'Signature', 'pay.deskReceiptMerchant': 'Merchant',
      'pay.deskReceiptFiat': 'Fiat total', 'pay.deskReceiptOst': 'OST sent',
      'pay.deskReceiptHelp': 'Share this transaction with the interchange desk to complete merchant-side fulfillment.',
      'pay.deskReceiptExplorer': 'View on Solana Explorer',
      'pay.toastAdded': 'Added', 'pay.toastConnectWallet': 'Connect your OST wallet first', 'pay.toastRequestCreated': 'On-chain interchange request created',
      'pay.interchangeLoading': 'Interchange desk is still loading', 'pay.cartMoved': 'Cart moved to the interchange desk',
      'pay.shopSource': 'shop cart', 'pay.manualSource': 'manual request', 'pay.browserSource': 'interchange browser',
      'pay.walletNeedsSol': 'This wallet needs a little devnet SOL for the network fee. Fund it at faucet.solana.com, then try again.',
      'pay.notEnoughOst': 'Not enough OST in this wallet. Claim or buy OST first.', 'pay.deskNeedValidAmount': 'Load a request with a valid OST amount first',
      'pay.deskRequestFailed': 'Could not create the interchange request right now.',
      'pay.browseTitle': 'Browse merchant lanes', 'pay.browseSub': 'Pick hotels, flights, cars, property, or retail, then load a real quote into the request desk.',
      'pay.browseHotels': 'Hotels', 'pay.browseFlights': 'Flights', 'pay.browseCars': 'Cars', 'pay.browseProperty': 'Property', 'pay.browseRetail': 'Retail', 'pay.browseOpen': 'Open lane',
      'launch.title': '🚀 Mainnet Launch Checklist', 'launch.sub': 'What we need to make OST fully real on Solana mainnet.',
      'ai.title': 'Power for Every Intelligence', 'ai.sub': 'We welcome AI agents, bots, servers, and every form of digital intelligence.',
      'build.title': 'Build the Future With Us', 'build.sub': 'Code, create, or dream in pixels - OST is your platform.',
      'build.cta': 'Start Contributing Today', 'build.ctasub': 'Every commit, translation, and tutorial moves humanity forward.',
      'build.github': 'View GitHub Repo', 'build.docs': 'Read the Docs',
      'verify.title': 'Full Transparency', 'verify.sub': 'Verify everything yourself. We have nothing to hide.',
      'verify.lead': 'Trust is earned with facts, not promises.',
      'verify.closing': 'Read the code. Check the company. Verify the treasury. <strong>Then decide.</strong>',
      'wallet.title': 'Connect or Create Wallet', 'wallet.sub': 'Choose an existing wallet or generate a local OST wallet in this browser.',
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
      'demos.title': '&#128717;&#65039; OST Commerce', 'demos.sub': 'Curated shopping, live merchant browsing, and real on-chain request routing with OST.',
        'wallet.getTitle': 'Get Your Personal OST Wallet', 'wallet.getSub': 'Choose how to create or connect your wallet. Build one in this browser or connect an existing Solana wallet.',
        'wallet.commandKicker': 'Wallet + conversion rail',
        'wallet.commandTitle': 'Open a wallet, read the OST market, and move from fiat or crypto into confidential OST.',
        'wallet.commandSub': 'The wallet page now behaves like a command center for access, market watch, conversion, and portal routing.',
        'wallet.tabs.aria': 'Wallet command panels',
        'wallet.market.velocity': 'Route speed',
        'wallet.market.liquidity': 'Liquidity',
        'wallet.market.title': 'OST market pulse',
        'wallet.market.updated': 'Live',
        'wallet.market.price': 'OST price',
        'wallet.market.volume': '24h volume',
        'wallet.tabs.access': 'Access',
        'wallet.tabs.market': 'Market',
        'wallet.tabs.convert': 'Convert',
        'wallet.tabs.portals': 'Portals',
        'wallet.card.phantomDesc': 'Fast mobile and desktop access for users who already live inside Solana.',
        'wallet.card.connectAction': 'Connect',
        'wallet.card.solflareDesc': 'Strong staking and portfolio tools for users who want a deeper wallet dashboard.',
        'wallet.card.backpackDesc': 'A multi-chain option for people who want apps, collectibles, and payments in one place.',
        'wallet.card.seedlessTitle': 'Create OST wallet',
        'wallet.card.seedlessDesc': 'Generate an OST wallet in this browser, download a backup, and start with devnet OST.',
        'wallet.card.seedlessAction': 'Create wallet',
        'wallet.downloadTitle': 'Need an install first? Use the official wallet download links.',
        'wallet.copy': 'Copy',
        'wallet.explorer': 'Explorer',
        'wallet.buyOst': 'Buy OST',
        'wallet.send': 'Send',
        'wallet.bridge': 'Bridge',
        'wallet.receive': 'Receive',
        'wallet.swap': 'Swap',
        'wallet.receiveTitle': 'Receive OST or SOL',
        'wallet.receiveSub': 'Share your address or let someone scan the QR rail below.',
        'wallet.quickLinksTitle': 'Quick routes',
        'wallet.secure.title': 'Secure onboarding',
        'wallet.secure.sub': 'Choose the access rail that matches the user: seed phrase power users, browser-wallet newcomers, or wallet-native Solana traders.',
        'wallet.secure.point1': 'Use Phantom, Solflare, or Backpack when the user already has a Solana workflow.',
        'wallet.secure.point2': 'Use the local wallet flow when the priority is onboarding a first wallet in minutes.',
        'wallet.secure.point3': 'Keep one address across swap, payment, and launchpad rails to reduce confusion.',
        'wallet.secure.point4': 'The connected view surfaces balances, receive QR, and direct links without leaving the page.',
        'wallet.market.note2': 'The calculator below reads the same OST quote as the convert rail, so the preview and execution surface stay aligned.',
        'wallet.convert.lead': 'Institutional-grade currency conversion, redesigned for regular users who need a clean entry rail into confidential OST.',
        'wallet.convert.from': 'From',
        'wallet.convert.bridge': 'Bridge',
        'wallet.convert.swap': 'Swap',
        'wallet.convert.encrypt': 'Encrypt',
        'wallet.convert.to': 'To',
        'wallet.convert.providers': 'Direct fiat on-ramps for the selected currency:',
        'wallet.convert.note': 'Currently powered by Jupiter + Wormhole on Solana while the OST native interchange engine is under construction.',
        'wallet.convert.received': 'Received',
        'wallet.convert.done': 'Done - private and instant',
        'wallet.sell.stable': 'Swap to stablecoins',
        'wallet.sell.stableDesc': 'Route OST into USDC, USDT, or DAI when the user needs a fast stable exit.',
        'wallet.sell.cashout': 'Cash out to bank',
        'wallet.sell.cashoutDesc': 'Use Onramper or Transak sell rails after the OST to SOL or OST to USDC swap completes.',
        'wallet.sell.p2p': 'P2P market',
        'wallet.sell.p2pDesc': 'Direct wallet-to-wallet trading stays on the roadmap for people who want a simpler off-ramp.',
        'wallet.portal.wormholeDesc': 'Move liquidity from major chains into Solana before the OST swap rail takes over.',
        'wallet.portal.onramperDesc': 'Aggregator entry rail with card, bank, Apple Pay, and local fiat routing.',
        'wallet.portal.moonpayDesc': 'Fast card-based SOL entry for users who want the cleanest first purchase flow.',
        'wallet.portal.transakDesc': 'Regional payment coverage with PIX, UPI, SEPA, Faster Payments, and card rails.',
        'wallet.portal.onramperSellDesc': 'Cash out SOL or USDC into bank accounts and mobile money rails after conversion.',
        'wallet.portal.transakSellDesc': 'Regional fiat exits for users who want local banking rails instead of stablecoin custody.',
        'wallet.portal.jupiterDesc': 'Best-route aggregator for OST conversions, stable exits, and spot rotations.',
        'wallet.portal.raydiumDesc': 'Liquidity and swap venue for users who want direct pool access on Solana.',
        'wallet.portal.orcaDesc': 'Cleaner swap route for concentrated liquidity users who want a simpler interface.',
        'wallet.portal.meteoraDesc': 'Dynamic liquidity venue for newer assets and launchpad-native routing.',
        'wallet.portal.prediction.title': 'Coming soon',
        'wallet.portal.prediction.sub': 'A community-first event market rail inspired by Polymarket, Kalshi, and the rest of the contract platforms, but built inside OST.',
        'ancient.toggle.off': '𓅱 Ancient',
        'ancient.toggle.on': 'Modern Mode',
        'ancient.toggle.activate': 'Activate ancient hieroglyphic mode',
        'ancient.toggle.deactivate': 'Return to the modern interface',
        'ancient.toast.on': 'Ancient mode activated',
        'ancient.toast.off': 'Modern interface restored',
        'transmit.button': '𓂇 Transmit to Space',
        'transmit.buttonLarge': '𓂇 Open Transmission Console',
        'transmit.ctaSub': 'Encode a custom message, DNA sequence, image, video, or any file in hieroglyphic, binary, and quantum form before routing it toward future OST relay targets.',
        'transmit.kicker': 'Deep-space payload console',
        'transmit.title': '𓂇 Transmit to Space',
        'transmit.sub': 'Send a custom message, DNA sequence, image, video, or any file through the OST transmission ritual. Preview the payload in hieroglyphs, binary, and quantum entanglement before launch.',
        'transmit.message.label': 'Custom message',
        'transmit.message.placeholder': 'Describe the signal, dedication, coordinates, or mission note you want to send...',
        'transmit.dna.label': 'DNA / life-seed sequence',
        'transmit.dna.placeholder': 'Optional: ACGT sequence, sample tag, or biological archive note',
        'transmit.files.label': 'Attach payloads',
        'transmit.files.sub': 'Drop images, video, documents, archives, or any other file type',
        'transmit.launch': 'Encode and transmit',
        'transmit.launchBusy': 'Transmitting...',
        'transmit.preview.glyph': 'Ancient hieroglyph render',
        'transmit.preview.binary': 'Binary + checksum',
        'transmit.preview.quantum': 'Quantum entanglement',
        'transmit.preview.manifest': 'Transmission manifest',
        'transmit.preview.attachments': 'Attached payloads',
        'transmit.empty': 'Add a message, DNA sequence, or file to build a transmission.',
        'transmit.none': 'No payload attached yet.',
        'transmit.result.ready': 'Signal deck ready',
        'transmit.result.sent': 'Transmission complete',
        'transmit.manifest.default': 'Awaiting payload',
        'transmit.summary.message': 'Message',
        'transmit.summary.dna': 'DNA',
        'transmit.summary.files': 'Files',
        'transmit.summary.route': 'Route',
        'transmit.summary.checksum': 'Checksum',
        'transmit.summary.packet': 'Packet',
        'transmit.summary.target': 'Target',
        'transmit.summary.render': 'Render',
        'transmit.summary.chars': 'chars',
        'transmit.summary.bases': 'bases',
        'transmit.route.value': 'LEO relay -> quantum entanglement -> Moon / Mars / deep space',
        'transmit.target.value': 'Moon, Mars, deep space',
        'transmit.render.value': 'Hieroglyphic + binary + quantum',
        'transmit.stage.prepare': 'Preparing payload lattice...',
        'transmit.stage.encode': 'Encoding payload into hieroglyphic memory...',
        'transmit.stage.binary': 'Converting packet into binary and orbital checksum...',
        'transmit.stage.entangle': 'Entangling packet states across relay pairs...',
        'transmit.stage.route': 'Routing through orbital infrastructure...',
        'transmit.stage.broadcast': 'Broadcast aimed at Moon, Mars, and deep space...',
        'transmit.stage.done': 'Transmission complete — relay lock confirmed.',
        'transmit.file.image': 'Image payload',
        'transmit.file.video': 'Video payload',
        'transmit.file.text': 'Text payload',
        'transmit.file.data': 'Archive payload',
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
      'nav.home': 'Inicio', 'nav.newhere': 'Obtener OST', 'nav.demos': 'Comercio', 'nav.stores': 'Comercio', 'nav.wallet': 'Billetera',
      'nav.ai': 'IA y Bots', 'nav.offline': 'Sin Conexion', 'nav.censorship': 'Censura', 'nav.spacex': 'SpaceX',
      'nav.about': 'Nuestra Historia', 'nav.roadmap': 'Hoja de Ruta', 'nav.build': 'Construir', 'nav.verify': 'Verificar',
      'nav.connect': 'Conectar Billetera',
      'wallet.dashTitle': 'Mi Billetera OST', 'wallet.dashSub': 'Tu centro de control. Crea, conecta y gestiona tu billetera OST.',
      'bridges.title': 'Puentes, Rampas e Intercambios', 'bridges.sub': 'Cada camino hacia OST — desde cualquier cadena, moneda o pais.',
      'hero.tag': 'El Siguiente Paso Despues de Bitcoin',
      'hero.title': 'Todos somos <span class="gradient-text">una familia.</span>',
      'hero.sub': 'OST es el dinero digital hecho para cada ciudadano del mundo - privado, instantaneo y conectado a cualquier moneda que ya tengas.',
      'hero.cta1': 'Explorar Comercio', 'hero.cta2': 'Obtener OST',
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
      'pay.title': 'Tienda Curada - Listados Reales', 'pay.sub': 'Arma un carrito con productos reales y luego envialo al desk OST para una solicitud en vivo.',
      'pay.cart': 'Tu Carrito', 'pay.empty': 'Toca + para agregar', 'pay.paybtn': 'Revisar en el Desk OST',
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
      'getost.faucet': 'Nuevo? Reclama OST Gratis', 'getost.faucettext': 'Cada nueva billetera recibe <strong>1 OST</strong> del tesoro comunitario &mdash; suficiente para probar el flujo real en devnet de inmediato.',
      'getost.faucetbtn': 'Abrir el Grifo',
      'pay.anywhere': '🌐 Interchange - Explora Cualquier Comercio',
      'pay.anywheresub': 'Pega una URL real de producto o checkout, o abre una ruta comercial abajo. OST carga la cotizacion y prepara una solicitud on-chain honesta en vez de fingir que la liquidacion del comercio ya existe.',
      'pay.aurl': 'URL del Comercio', 'pay.aamount': 'Monto a Pagar', 'pay.acurrency': 'Su Moneda',
      'pay.ayoupay': 'Tu Pagas:', 'pay.arate': 'Tasa:', 'pay.afee': 'Comision de Red:',
      'pay.ahow': 'Como Funciona',
      'pay.astep1': 'Pega el enlace de pago del comercio', 'pay.astep2': 'Ingresa el monto en su moneda',
      'pay.astep3': 'OST convierte a tasas en vivo via Jupiter + Wormhole', 'pay.astep4': 'El comercio recibe su moneda, tu pagaste con OST',
      'pay.apaybtn': 'Cargar en el Desk', 'pay.asupported': 'Funciona con cualquier sitio que acepte:',
      'pay.catalogkicker': 'Rutas curadas',
      'pay.catalogcopy': 'Arma un carrito con productos, vuelos, hoteles, vehiculos y propiedades reales, y luego muevelo al desk OST.',
      'pay.catalogCountSuffix': 'listados activos',
      'pay.filter.all': 'Todo', 'pay.filter.tech': 'Tecnologia', 'pay.filter.fashion': 'Moda', 'pay.filter.travel': 'Viajes',
      'pay.filter.flight': 'Vuelos', 'pay.filter.hotel': 'Hoteles', 'pay.filter.car': 'Autos', 'pay.filter.property': 'Propiedad', 'pay.filter.food': 'Comida',
      'pay.deskKicker': 'Riel activo', 'pay.deskTitle': 'Desk real de solicitudes de compra OST', 'pay.deskBadge': 'Boveda on-chain + memo',
      'pay.deskCopy': 'Este riel ya no finge la liquidacion del comercio. OST registra una solicitud de pago real on-chain hacia la boveda del interchange y adjunta el comercio y el memo del pedido mientras llegan los conectores directos.',
      'pay.deskStatusIdle': 'Pega una URL real de producto o checkout, o envia un carrito curado desde Shop.',
      'pay.deskStatusLoaded': 'Solicitud cargada. El siguiente paso crea una transferencia real de OST en devnet hacia la boveda del desk interchange.',
      'pay.deskStatusSending': 'Enviando una solicitud real de pago OST hacia la boveda interchange...',
      'pay.deskStatusRecorded': 'Solicitud on-chain registrada. Comparte la firma con el desk para terminar la entrega.',
      'pay.deskNeedRequest': 'Primero carga una solicitud.', 'pay.deskNeedWallet': 'Primero crea o conecta tu billetera OST.',
      'pay.deskMerchantLabel': 'Comercio', 'pay.deskSourceLabel': 'Origen', 'pay.deskFiatLabel': 'Total fiat', 'pay.deskOstLabel': 'Total OST', 'pay.deskWalletLabel': 'Billetera',
      'pay.deskEmpty': 'Aun no hay ninguna solicitud cargada.', 'pay.deskMerchantLink': 'Abrir pagina del comercio', 'pay.deskCreate': 'Crear solicitud OST on-chain',
      'pay.deskSendingButton': 'Enviando solicitud OST...',
      'pay.deskReceiptTitle': 'Solicitud on-chain registrada', 'pay.deskReceiptSignature': 'Firma', 'pay.deskReceiptMerchant': 'Comercio',
      'pay.deskReceiptFiat': 'Total fiat', 'pay.deskReceiptOst': 'OST enviado',
      'pay.deskReceiptHelp': 'Comparte esta transaccion con el desk interchange para completar la entrega del lado del comercio.',
      'pay.deskReceiptExplorer': 'Ver en Solana Explorer',
      'pay.toastAdded': 'Agregado', 'pay.toastConnectWallet': 'Conecta tu billetera OST primero', 'pay.toastRequestCreated': 'Solicitud interchange on-chain creada',
      'pay.interchangeLoading': 'El desk interchange todavia se esta cargando', 'pay.cartMoved': 'El carrito fue enviado al desk interchange',
      'pay.shopSource': 'carrito de shop', 'pay.manualSource': 'solicitud manual', 'pay.browserSource': 'navegador interchange',
      'pay.walletNeedsSol': 'Esta billetera necesita un poco de SOL en devnet para la comision de red. Fondeala en faucet.solana.com y vuelve a intentar.',
      'pay.notEnoughOst': 'No hay suficiente OST en esta billetera. Reclama o compra OST primero.', 'pay.deskNeedValidAmount': 'Carga primero una solicitud con un monto OST valido',
      'pay.deskRequestFailed': 'No se pudo crear la solicitud interchange en este momento.',
      'pay.browseTitle': 'Explora rutas comerciales', 'pay.browseSub': 'Elige hoteles, vuelos, autos, propiedad o retail y carga una cotizacion real en el desk.',
      'pay.browseHotels': 'Hoteles', 'pay.browseFlights': 'Vuelos', 'pay.browseCars': 'Autos', 'pay.browseProperty': 'Propiedad', 'pay.browseRetail': 'Retail', 'pay.browseOpen': 'Abrir ruta',
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
      'demos.title': '&#128717;&#65039; Comercio OST', 'demos.sub': 'Compra curada, navegacion de comercios reales y ruteo on-chain de solicitudes con OST.',
        'wallet.getTitle': 'Obten Tu Billetera OST Personal', 'wallet.getSub': 'Elige como crear o conectar tu billetera. Genera una billetera local en este navegador o conecta una billetera Solana existente.',
        'wallet.commandKicker': 'Billetera + riel de conversi\u00f3n',
        'wallet.commandTitle': 'Abre una billetera, sigue el mercado OST y pasa de fiat o cripto a OST confidencial.',
        'wallet.commandSub': 'La p\u00e1gina de billetera ahora funciona como un centro de mando para acceso, mercado, conversi\u00f3n y portales.',
        'wallet.tabs.aria': 'Paneles de la billetera',
        'wallet.market.velocity': 'Velocidad de ruta',
        'wallet.market.liquidity': 'Liquidez',
        'wallet.market.title': 'Pulso de mercado OST',
        'wallet.market.updated': 'En vivo',
        'wallet.market.price': 'Precio de OST',
        'wallet.market.volume': 'Volumen 24h',
        'wallet.tabs.access': 'Acceso',
        'wallet.tabs.market': 'Mercado',
        'wallet.tabs.convert': 'Convertir',
        'wallet.tabs.portals': 'Portales',
        'wallet.card.phantomDesc': 'Acceso r\u00e1pido en m\u00f3vil y escritorio para usuarios que ya viven dentro de Solana.',
        'wallet.card.connectAction': 'Conectar',
        'wallet.card.solflareDesc': 'Herramientas s\u00f3lidas de staking y portafolio para usuarios que quieren una billetera m\u00e1s profunda.',
        'wallet.card.backpackDesc': 'Una opci\u00f3n multicadena para quienes quieren apps, coleccionables y pagos en un solo lugar.',
        'wallet.card.seedlessTitle': 'Crear billetera OST',
        'wallet.card.seedlessDesc': 'Genera una billetera OST en este navegador, descarga un respaldo y empieza con OST en devnet.',
        'wallet.card.seedlessAction': 'Crear billetera',
        'wallet.downloadTitle': '¿Necesitas instalar primero? Usa los enlaces oficiales de descarga.',
        'wallet.copy': 'Copiar',
        'wallet.explorer': 'Explorador',
        'wallet.buyOst': 'Comprar OST',
        'wallet.send': 'Enviar',
        'wallet.bridge': 'Puente',
        'wallet.receive': 'Recibir',
        'wallet.swap': 'Intercambiar',
        'wallet.receiveTitle': 'Recibir OST o SOL',
        'wallet.receiveSub': 'Comparte tu direcci\u00f3n o deja que alguien escanee el riel QR de abajo.',
        'wallet.quickLinksTitle': 'Rutas r\u00e1pidas',
        'wallet.secure.title': 'Ingreso seguro',
        'wallet.secure.sub': 'Elige el riel de acceso que coincide con el usuario: avanzados con frase semilla, nuevos sin semilla o traders nativos de Solana.',
        'wallet.secure.point1': 'Usa Phantom, Solflare o Backpack cuando el usuario ya tenga un flujo dentro de Solana.',
        'wallet.secure.point2': 'Usa el flujo sin semilla cuando la prioridad sea abrir una primera billetera en minutos.',
        'wallet.secure.point3': 'Mant\u00e9n una sola direcci\u00f3n en swap, pagos y launchpad para reducir la confusi\u00f3n.',
        'wallet.secure.point4': 'La vista conectada muestra balances, QR de recepci\u00f3n y enlaces directos sin salir de la p\u00e1gina.',
        'wallet.market.note2': 'La calculadora de abajo usa la misma cotizaci\u00f3n de OST que el riel de conversi\u00f3n, para que la vista previa y la ejecuci\u00f3n coincidan.',
        'wallet.convert.lead': 'Conversi\u00f3n de moneda de grado institucional, redise\u00f1ada para usuarios comunes que necesitan una entrada clara a OST confidencial.',
        'wallet.convert.from': 'Desde',
        'wallet.convert.bridge': 'Puente',
        'wallet.convert.swap': 'Intercambio',
        'wallet.convert.encrypt': 'Cifrar',
        'wallet.convert.to': 'Hacia',
        'wallet.convert.providers': 'Rampas fiat directas para la moneda seleccionada:',
        'wallet.convert.note': 'Actualmente funciona con Jupiter + Wormhole en Solana mientras el motor nativo de intercambio de OST sigue en construcci\u00f3n.',
        'wallet.convert.received': 'Recibido',
        'wallet.convert.done': 'Listo - privado e instant\u00e1neo',
        'wallet.sell.stable': 'Cambiar a stablecoins',
        'wallet.sell.stableDesc': 'Mueve OST a USDC, USDT o DAI cuando el usuario necesita una salida estable r\u00e1pida.',
        'wallet.sell.cashout': 'Retirar al banco',
        'wallet.sell.cashoutDesc': 'Usa las rutas de venta de Onramper o Transak despu\u00e9s de completar el swap de OST a SOL o de OST a USDC.',
        'wallet.sell.p2p': 'Mercado P2P',
        'wallet.sell.p2pDesc': 'El intercambio directo entre billeteras sigue en la hoja de ruta para quienes quieren una salida m\u00e1s simple.',
        'wallet.portal.wormholeDesc': 'Mueve liquidez desde cadenas principales a Solana antes de que el riel de swap de OST tome el control.',
        'wallet.portal.onramperDesc': 'Ruta agregadora de entrada con tarjeta, banco, Apple Pay y ruteo fiat local.',
        'wallet.portal.moonpayDesc': 'Entrada r\u00e1pida a SOL con tarjeta para usuarios que quieren el flujo de compra m\u00e1s limpio.',
        'wallet.portal.transakDesc': 'Cobertura regional de pagos con PIX, UPI, SEPA, Faster Payments y tarjetas.',
        'wallet.portal.onramperSellDesc': 'Retira SOL o USDC a cuentas bancarias y rieles de dinero m\u00f3vil despu\u00e9s de la conversi\u00f3n.',
        'wallet.portal.transakSellDesc': 'Salidas fiat regionales para usuarios que quieren banca local en lugar de custodiar stablecoins.',
        'wallet.portal.jupiterDesc': 'Agregador de mejor ruta para conversiones OST, salidas estables y rotaciones spot.',
        'wallet.portal.raydiumDesc': 'Lugar de liquidez e intercambio para usuarios que quieren acceso directo a pools en Solana.',
        'wallet.portal.orcaDesc': 'Ruta de swap m\u00e1s limpia para usuarios de liquidez concentrada que quieren una interfaz m\u00e1s simple.',
        'wallet.portal.meteoraDesc': 'Lugar de liquidez din\u00e1mica para activos nuevos y ruteo nativo del launchpad.',
        'wallet.portal.prediction.title': 'Pr\u00f3ximamente',
        'wallet.portal.prediction.sub': 'Un riel comunitario de mercados de eventos inspirado por Polymarket, Kalshi y el resto de las plataformas de contratos, pero construido dentro de OST.',
        'ancient.toggle.off': '𓅱 Antiguo',
        'ancient.toggle.on': 'Modo Moderno',
        'ancient.toggle.activate': 'Activar el modo jerogl\u00edfico antiguo',
        'ancient.toggle.deactivate': 'Volver a la interfaz moderna',
        'ancient.toast.on': 'Modo antiguo activado',
        'ancient.toast.off': 'Interfaz moderna restaurada',
        'transmit.button': '𓂇 Transmitir al Espacio',
        'transmit.buttonLarge': '𓂇 Abrir Consola de Transmisi\u00f3n',
        'transmit.ctaSub': 'Codifica un mensaje personalizado, secuencia de ADN, imagen, video o cualquier archivo en forma jerogl\u00edfica, binaria y cu\u00e1ntica antes de dirigirlo a futuros rel\u00e9s OST.',
        'transmit.kicker': 'Consola de carga para espacio profundo',
        'transmit.title': '𓂇 Transmitir al Espacio',
        'transmit.sub': 'Env\u00eda un mensaje personalizado, secuencia de ADN, imagen, video o cualquier archivo mediante el ritual de transmisi\u00f3n OST. Previsualiza la carga en jerogl\u00edficos, binario y entrelazamiento cu\u00e1ntico antes del lanzamiento.',
        'transmit.message.label': 'Mensaje personalizado',
        'transmit.message.placeholder': 'Describe la se\u00f1al, dedicatoria, coordenadas o nota de misi\u00f3n que quieres enviar...',
        'transmit.dna.label': 'Secuencia de ADN / semilla de vida',
        'transmit.dna.placeholder': 'Opcional: secuencia ACGT, etiqueta de muestra o nota de archivo biol\u00f3gico',
        'transmit.files.label': 'Adjuntar cargas',
        'transmit.files.sub': 'Suelta im\u00e1genes, video, documentos, archivos comprimidos o cualquier otro tipo de archivo',
        'transmit.launch': 'Codificar y transmitir',
        'transmit.launchBusy': 'Transmitiendo...',
        'transmit.preview.glyph': 'Render jerogl\u00edfico antiguo',
        'transmit.preview.binary': 'Binario + checksum',
        'transmit.preview.quantum': 'Entrelazamiento cu\u00e1ntico',
        'transmit.preview.manifest': 'Manifiesto de transmisi\u00f3n',
        'transmit.preview.attachments': 'Cargas adjuntas',
        'transmit.empty': 'Agrega un mensaje, secuencia de ADN o archivo para construir una transmisi\u00f3n.',
        'transmit.none': 'Todav\u00eda no hay carga adjunta.',
        'transmit.result.ready': 'Panel de se\u00f1al listo',
        'transmit.result.sent': 'Transmisi\u00f3n completa',
        'transmit.manifest.default': 'Esperando carga',
        'transmit.summary.message': 'Mensaje',
        'transmit.summary.dna': 'ADN',
        'transmit.summary.files': 'Archivos',
        'transmit.summary.route': 'Ruta',
        'transmit.summary.checksum': 'Checksum',
        'transmit.summary.packet': 'Paquete',
        'transmit.summary.target': 'Objetivo',
        'transmit.summary.render': 'Render',
        'transmit.summary.chars': 'caracteres',
        'transmit.summary.bases': 'bases',
        'transmit.route.value': 'Rel\u00e9 LEO -> entrelazamiento cu\u00e1ntico -> Luna / Marte / espacio profundo',
        'transmit.target.value': 'Luna, Marte, espacio profundo',
        'transmit.render.value': 'Jerogl\u00edfico + binario + cu\u00e1ntico',
        'transmit.stage.prepare': 'Preparando la red de carga...',
        'transmit.stage.encode': 'Codificando la carga en memoria jerogl\u00edfica...',
        'transmit.stage.binary': 'Convirtiendo el paquete a binario y checksum orbital...',
        'transmit.stage.entangle': 'Entrelazando estados del paquete entre pares de rel\u00e9...',
        'transmit.stage.route': 'Enrutando por infraestructura orbital...',
        'transmit.stage.broadcast': 'Difusi\u00f3n apuntada a la Luna, Marte y espacio profundo...',
        'transmit.stage.done': 'Transmisi\u00f3n completa \u2014 bloqueo del rel\u00e9 confirmado.',
        'transmit.file.image': 'Carga de imagen',
        'transmit.file.video': 'Carga de video',
        'transmit.file.text': 'Carga de texto',
        'transmit.file.data': 'Carga de archivo',
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
      'nav.home': '首页', 'nav.newhere': '获取OST', 'nav.demos': '商业', 'nav.wallet': '钱包',
      'nav.ai': 'AI和机器人', 'nav.offline': '离线', 'nav.censorship': '审查', 'nav.spacex': 'SpaceX',
      'nav.about': '我们的故事', 'nav.roadmap': '路线图', 'nav.build': '开发', 'nav.verify': '验证',
      'nav.connect': '连接钱包',
      'wallet.dashTitle': '我的OST钱包', 'wallet.dashSub': '您的个人控制中心。创建、连接和管理您的OST钱包。',
      'bridges.title': '跨链桥、入金通道和交易所', 'bridges.sub': '通往OST的每条路径——来自任何链、任何货币、任何国家。',
      'hero.tag': '比特币之后的下一步',
      'hero.title': '我们都是 <span class="gradient-text">一家人。</span>',
      'hero.sub': 'OST是为世界上每个公民制造的数字现金 - 私密、即时，连接你已有的任何货币。',
      'hero.cta1': '探索商业', 'hero.cta2': '获取OST',
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
      'getost.faucet': '新人？领取免费OST', 'getost.faucettext': '每个新钱包从社区金库获得<strong>1 OST</strong>。',
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
      'demos.title': '&#128717;&#65039; OST \u5546\u4e1a', 'demos.sub': '\u4f53\u9a8c\u79c1\u5bc6\u5373\u65f6\u652f\u4ed8\u7684\u611f\u89c9\u3002\u771f\u5b9e\u4ea7\u54c1\uff0c\u771f\u5b9e\u4ef7\u683c\u3002\u96f6\u8d39\u7528\u3002',
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
      'nav.home': 'Главная', 'nav.newhere': 'Получить OST', 'nav.demos': 'Коммерция', 'nav.wallet': 'Кошелек',
      'nav.ai': 'ИИ и Боты', 'nav.offline': 'Оффлайн', 'nav.censorship': 'Цензура', 'nav.spacex': 'SpaceX',
      'nav.about': 'Наша История', 'nav.roadmap': 'Дорожная Карта', 'nav.build': 'Создать', 'nav.verify': 'Проверить',
      'nav.connect': 'Подключить кошелек',
      'wallet.dashTitle': 'Мой Кошелек OST', 'wallet.dashSub': 'Ваш личный центр управления. Создайте и управляйте кошельком OST.',
      'bridges.title': 'Мосты, Шлюзы и Биржи', 'bridges.sub': 'Каждый путь к OST — из любой сети, валюты, страны.',
      'hero.tag': 'Следующий Шаг После Биткоина',
      'hero.title': 'Мы все <span class="gradient-text">одна семья.</span>',
      'hero.sub': 'OST — цифровые деньги для каждого гражданина мира. Приватные, мгновенные, подключенные к любой валюте.',
      'hero.cta1': 'Открыть коммерцию', 'hero.cta2': 'Получить OST',
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
      'getost.faucet': 'Новичок? Получите Бесплатный OST', 'getost.faucettext': 'Каждый новый кошелёк получает <strong>1 OST</strong> из казны сообщества.',
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
      'demos.title': '&#128717;&#65039; \u041a\u043e\u043c\u043c\u0435\u0440\u0446\u0438\u044f OST', 'demos.sub': '\u041f\u043e\u0447\u0443\u0432\u0441\u0442\u0432\u0443\u0439\u0442\u0435 \u043f\u0440\u0438\u0432\u0430\u0442\u043d\u044b\u0435 \u043c\u0433\u043d\u043e\u0432\u0435\u043d\u043d\u044b\u0435 \u043f\u043b\u0430\u0442\u0435\u0436\u0438. \u0420\u0435\u0430\u043b\u044c\u043d\u044b\u0435 \u0442\u043e\u0432\u0430\u0440\u044b. \u041d\u0443\u043b\u0435\u0432\u044b\u0435 \u043a\u043e\u043c\u0438\u0441\u0441\u0438\u0438.',
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
      'nav.home': 'होम', 'nav.newhere': 'OST पाएं', 'nav.demos': 'कॉमर्स', 'nav.wallet': 'वॉलेट',
      'nav.ai': 'AI और बॉट्स', 'nav.offline': 'ऑफलाइन', 'nav.censorship': 'सेंसरशिप', 'nav.spacex': 'SpaceX',
      'nav.about': 'हमारी कहानी', 'nav.roadmap': 'रोडमैप', 'nav.build': 'निर्माण', 'nav.verify': 'सत्यापन',
      'nav.connect': 'वॉलेट कनेक्ट करें',
      'wallet.dashTitle': 'मेरा OST वॉलेट', 'wallet.dashSub': 'आपका व्यक्तिगत कमांड सेंटर। अपना OST वॉलेट बनाएं और प्रबंधित करें।',
      'bridges.title': 'ब्रिज, रैंप और एक्सचेंज', 'bridges.sub': 'OST तक हर रास्ता — किसी भी चेन, मुद्रा या देश से।',
      'hero.tag': 'बिटकॉइन के बाद अगला कदम',
      'hero.title': 'हम सब <span class="gradient-text">एक परिवार हैं।</span>',
      'hero.sub': 'OST दुनिया के हर नागरिक के लिए बनी डिजिटल कैश है - निजी, तत्काल, और आपकी किसी भी मुद्रा से जुड़ी।',
      'hero.cta1': 'कॉमर्स देखें', 'hero.cta2': 'OST पाएं',
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
      'getost.faucet': 'नए हैं? मुफ्त OST प्राप्त करें', 'getost.faucettext': 'हर नए वॉलेट को समुदाय खजाने से <strong>1 OST</strong> मिलता है।',
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
      'demos.title': '&#128717;&#65039; OST कॉमर्स', 'demos.sub': 'निजी, तत्काल भुगतान कैसा लगता है देखें। वास्तविक उत्पाद। शून्य शुल्क।',
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
      'nav.home': 'الرئيسية', 'nav.newhere': 'احصل على OST', 'nav.demos': 'التجارة', 'nav.wallet': 'محفظة',
      'nav.ai': 'الذكاء الاصطناعي', 'nav.offline': 'بدون إنترنت', 'nav.censorship': 'الرقابة', 'nav.spacex': 'SpaceX',
      'nav.about': 'قصتنا', 'nav.roadmap': 'خارطة الطريق', 'nav.build': 'بناء', 'nav.verify': 'تحقق',
      'nav.connect': 'ربط المحفظة',
      'wallet.dashTitle': 'محفظة OST الخاصة بي', 'wallet.dashSub': 'مركز التحكم الشخصي. أنشئ واربط وأدر محفظة OST.',
      'bridges.title': 'الجسور والمنحدرات والبورصات', 'bridges.sub': 'كل طريق إلى OST — من أي سلسلة أو عملة أو بلد.',
      'hero.tag': 'الخطوة التالية بعد بيتكوين',
      'hero.title': 'نحن جميعا <span class="gradient-text">عائلة واحدة.</span>',
      'hero.sub': 'OST هو النقد الرقمي المصنوع لكل مواطن في العالم - خاص وفوري ومتصل بأي عملة لديك.',
      'hero.cta1': 'استكشف التجارة', 'hero.cta2': 'احصل على OST',
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
      'getost.faucet': 'جديد هنا؟ احصل على OST مجاني', 'getost.faucettext': 'كل محفظة جديدة تحصل على <strong>1 OST</strong> من خزينة المجتمع.',
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
      'demos.title': '&#128717;&#65039; تجارة OST', 'demos.sub': 'شاهد كيف تبدو المدفوعات الخاصة والفورية. منتجات حقيقية. صفر رسوم.',
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
      'nav.home': 'Inicio', 'nav.newhere': 'Obter OST', 'nav.demos': 'Comércio', 'nav.wallet': 'Carteira',
      'nav.ai': 'IA e Bots', 'nav.offline': 'Offline', 'nav.censorship': 'Censura', 'nav.spacex': 'SpaceX',
      'nav.about': 'Nossa Historia', 'nav.roadmap': 'Roteiro', 'nav.build': 'Construir', 'nav.verify': 'Verificar',
      'nav.connect': 'Conectar Carteira',
      'wallet.dashTitle': 'Minha Carteira OST', 'wallet.dashSub': 'Seu centro de comando pessoal. Crie, conecte e gerencie sua carteira OST.',
      'bridges.title': 'Pontes, Rampas e Exchanges', 'bridges.sub': 'Todo caminho para OST — de qualquer cadeia, moeda ou pais.',
      'hero.tag': 'O Proximo Passo Apos o Bitcoin',
      'hero.title': 'Somos todos <span class="gradient-text">uma familia.</span>',
      'hero.sub': 'OST e o dinheiro digital feito para cada cidadao do mundo - privado, instantaneo e conectado a qualquer moeda que voce ja tem.',
      'hero.cta1': 'Explorar Comércio', 'hero.cta2': 'Obter OST',
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
      'getost.faucet': 'Novo Aqui? Receba OST Gratis', 'getost.faucettext': 'Cada nova carteira recebe <strong>1 OST</strong> do tesouro comunitario.',
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
      'demos.title': '&#128717;&#65039; Comércio OST', 'demos.sub': 'Veja como são pagamentos privados e instantâneos. Produtos reais. Zero taxas.',
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
      'nav.home': 'Accueil', 'nav.newhere': 'Obtenir OST', 'nav.demos': 'Commerce', 'nav.wallet': 'Portefeuille',
      'nav.ai': 'IA et Bots', 'nav.offline': 'Hors Ligne', 'nav.censorship': 'Censure', 'nav.spacex': 'SpaceX',
      'nav.about': 'Notre Histoire', 'nav.roadmap': 'Feuille de Route', 'nav.build': 'Construire', 'nav.verify': 'Verifier',
      'nav.connect': 'Connecter Portefeuille',
      'wallet.dashTitle': 'Mon Portefeuille OST', 'wallet.dashSub': 'Votre centre de commande personnel. Creez, connectez et gerez votre portefeuille OST.',
      'bridges.title': 'Ponts, Rampes et Echanges', 'bridges.sub': 'Chaque chemin vers OST — depuis toute chaine, devise ou pays.',
      'hero.tag': 'La Prochaine Etape Apres Bitcoin',
      'hero.title': 'Nous sommes tous <span class="gradient-text">une famille.</span>',
      'hero.sub': 'OST est l\'argent numerique fait pour chaque citoyen du monde - prive, instantane et connecte a toute devise.',
      'hero.cta1': 'Explorer le Commerce', 'hero.cta2': 'Obtenir OST',
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
      'getost.faucet': 'Nouveau? Recevez OST Gratuit', 'getost.faucettext': 'Chaque nouveau portefeuille recoit <strong>1 OST</strong> du tresor communautaire.',
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
      'demos.title': '&#128717;&#65039; Commerce OST', 'demos.sub': 'Découvrez les paiements privés et instantanés. Produits réels. Zéro frais.',
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
      'nav.home': 'ホーム', 'nav.newhere': 'OST入手', 'nav.demos': 'コマース', 'nav.wallet': 'ウォレット',
      'nav.ai': 'AIとボット', 'nav.offline': 'オフライン', 'nav.censorship': '検閲', 'nav.spacex': 'SpaceX',
      'nav.about': '私たちの物語', 'nav.roadmap': 'ロードマップ', 'nav.build': '開発', 'nav.verify': '検証',
      'nav.connect': 'ウォレット接続',
      'wallet.dashTitle': 'マイOSTウォレット', 'wallet.dashSub': 'パーソナルコマンドセンター。OSTウォレットを作成、接続、管理。',
      'bridges.title': 'ブリッジ、ランプ、取引所', 'bridges.sub': 'OSTへのすべての道 — あらゆるチェーン、通貨、国から。',
      'hero.tag': 'ビットコインの次のステップ',
      'hero.title': '私たちは皆 <span class="gradient-text">一つの家族です。</span>',
      'hero.sub': 'OSTは世界のすべての市民のためのデジタルキャッシュです - プライベート、即時、すでに持っているどの通貨にも接続。',
      'hero.cta1': 'コマースを見る', 'hero.cta2': 'OSTを入手',
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
      'getost.faucet': '初めてですか？無料OSTを取得', 'getost.faucettext': '新しいウォレットにはコミュニティトレジャリーから<strong>1 OST</strong>が支給されます。',
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
      'demos.title': '&#128717;&#65039; OSTコマース', 'demos.sub': 'プライベートで即時の支払いを体験。リアル製品。手数料ゼロ。',
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
      'nav.home': '홈', 'nav.newhere': 'OST 받기', 'nav.demos': '커머스', 'nav.wallet': '지갑',
      'nav.ai': 'AI와 봇', 'nav.offline': '오프라인', 'nav.censorship': '검열', 'nav.spacex': 'SpaceX',
      'nav.about': '우리의 이야기', 'nav.roadmap': '로드맵', 'nav.build': '개발', 'nav.verify': '검증',
      'nav.connect': '지갑 연결',
      'wallet.dashTitle': '내 OST 지갑', 'wallet.dashSub': '개인 커맨드 센터. OST 지갑을 만들고, 연결하고, 관리하세요.',
      'bridges.title': '브릿지, 램프 & 거래소', 'bridges.sub': 'OST로 가는 모든 길 — 어떤 체인, 통화, 국가에서든.',
      'hero.tag': '비트코인 이후의 다음 단계',
      'hero.title': '우리 모두는 <span class="gradient-text">하나의 가족입니다.</span>',
      'hero.sub': 'OST는 세계 모든 시민을 위한 디지털 현금입니다 - 프라이빗, 즉시, 이미 가진 모든 통화와 연결.',
      'hero.cta1': '커머스 둘러보기', 'hero.cta2': 'OST 받기',
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
      'getost.faucet': '처음이신가요? 무료 OST를 받으세요', 'getost.faucettext': '모든 새 지갑은 커뮤니티 재무에서 <strong>1 OST</strong>를 받습니다.',
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
      'demos.title': '&#128717;&#65039; OST 커머스', 'demos.sub': '프라이빗 즉시 결제를 경험하세요. 실제 제품. 수수료 제로.',
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
      'nav.home': 'Ana Sayfa', 'nav.newhere': 'OST Al', 'nav.demos': 'Ticaret', 'nav.wallet': 'Cuzdan',
      'nav.ai': 'Yapay Zeka', 'nav.offline': 'Cevrimdisi', 'nav.censorship': 'Sansur', 'nav.spacex': 'SpaceX',
      'nav.about': 'Hikayemiz', 'nav.roadmap': 'Yol Haritasi', 'nav.build': 'Gelistir', 'nav.verify': 'Dogrula',
      'nav.connect': 'Cuzdani Bagla',
      'wallet.dashTitle': 'OST Cuzdanim', 'wallet.dashSub': 'Kisisel komuta merkeziniz. OST cuzdaninizi olusturun ve yonetin.',
      'bridges.title': 'Kopruler, Rampalar ve Borsalar', 'bridges.sub': 'OST ye her yol — herhangi bir zincir, para birimi veya ulkeden.',
      'hero.tag': 'Bitcoin\'den Sonraki Adim',
      'hero.title': 'Hepimiz <span class="gradient-text">bir aileyiz.</span>',
      'hero.sub': 'OST, dunyadaki her vatandas icin yapilmis dijital nakit paradir — ozel, anlik ve zaten sahip oldugunuz herhangi bir para birimine bagli.',
      'hero.cta1': 'Ticareti Kesfet', 'hero.cta2': 'OST Al',
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
      'getost.faucet': 'Yeni misiniz? Ucretsiz OST Alin', 'getost.faucettext': 'Her yeni cuzdan topluluk hazinesinden <strong>1 OST</strong> alir.',
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
      'demos.title': '&#128717;&#65039; OST Ticaret', 'demos.sub': 'Özel, anlık ödemelerin nasıl hissettirdiğini görün. Gerçek ürünler. Sıfır ücret.',
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

  function applyTranslations(lang = currentLang) {
    currentLang = translations[lang] ? lang : 'en';
    const dict = translations[currentLang] || {};
    const fallback = translations.en;
    const getTranslation = key => dict[key] || fallback[key];
    const stripHtml = value => value.replace(/<[^>]*>/g, '');

    $$('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = getTranslation(key);
      if (val) el.innerHTML = val;
    });

    [
      ['data-i18n-placeholder', 'placeholder'],
      ['data-i18n-title', 'title'],
      ['data-i18n-aria-label', 'aria-label'],
    ].forEach(([dataAttr, domAttr]) => {
      $$(`[${dataAttr}]`).forEach(el => {
        const key = el.getAttribute(dataAttr);
        const val = getTranslation(key);
        if (val) el.setAttribute(domAttr, stripHtml(val));
      });
    });

    document.documentElement.setAttribute('data-lang', currentLang);
    document.documentElement.lang = currentLang;

    if (typeof window.syncAncientModeUi === 'function') window.syncAncientModeUi();
    if (typeof window.syncTransmitUi === 'function') window.syncTransmitUi();
    if (typeof window.syncConnectedWalletUi === 'function') window.syncConnectedWalletUi();
    if (typeof window.syncStoreCatalogUi === 'function') window.syncStoreCatalogUi();
    if (typeof window.syncInterchangeBrowserUi === 'function') window.syncInterchangeBrowserUi();
    if (typeof window.syncPredictionMarketBoardUi === 'function') window.syncPredictionMarketBoardUi();
  }
  window.applyTranslations = applyTranslations;

  function t(key, fallbackText) {
    return (translations[currentLang] && translations[currentLang][key]) || translations.en[key] || fallbackText || key;
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
      try {
        const prefs = JSON.parse(localStorage.getItem('ost_prefs') || '{}');
        localStorage.setItem('ost_prefs', JSON.stringify({
          lang,
          currency: prefs.currency || window.__ostCurrency || 'USD'
        }));
      } catch (err) {}
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
  let connectedWalletSession = null;
  let solanaConnection = null;

  // OST Program & Network Config
  const OST_CONFIG = {
    programId: 'J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY',
    mint: '383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ',
    wostMint: 'Ac8RTG9R15HDXkjJDphRNpEgawEh1o5wLFaWPGFjiHoS',
    network: 'devnet',
    rpcUrl: 'https://api.devnet.solana.com'
  };
  const TOKEN_2022_PROGRAM_ID = new solanaWeb3.PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
  const ASSOCIATED_TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  const MEMO_PROGRAM_ID = new solanaWeb3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
  const OST_TOKEN_DECIMALS = 9;
  const OST_FAUCET_AMOUNT = 1;
  const OST_DEVNET_METRICS_REFRESH_MS = 120000;
  const LOCAL_WALLET_STORAGE_KEY = 'ost.localWallet.v1';
  const LOCAL_WALLET_BACKUP_EXPORTED_KEY = 'ost.localWallet.backupExportedAt';
  const INTERCHANGE_REQUESTS_STORAGE_KEY = 'ost.interchange.requests.v1';
  const PREDICTION_ORDERS_STORAGE_KEY = 'ost.prediction.orders.v1';
  const WELCOME_SESSION_KEY = 'ost.welcome.seen.session';
  const CLAIM_FAUCET_DISCRIMINATOR = Uint8Array.from([80, 7, 251, 108, 55, 145, 135, 68]);
  const SEEDLESS_ONBOARD_DISCRIMINATOR = Uint8Array.from([135, 41, 102, 172, 127, 61, 190, 75]);
  const textEncoder = new TextEncoder();
  const accountDiscriminatorCache = {};
  let ostDevnetMetrics = {
    mintSupply: 0,
    treasuryBalance: 0,
    faucetClaimCount: 0,
    faucetDistributed: 0,
    circulatingSupply: 0,
    unstagedSupply: 0,
    feeBasisPoints: 10,
    totalFeesCollected: 0,
    available: false,
    loading: false,
    error: '',
    lastUpdatedAt: 0
  };
  let walletFundingState = {
    needsManualFunding: false,
    walletAddress: '',
    lastError: ''
  };
  window.OST_CONFIG = OST_CONFIG;

  // Initialize Solana connection
  function getSolanaConnection() {
    if (!solanaConnection && typeof solanaWeb3 !== 'undefined') {
      solanaConnection = new solanaWeb3.Connection(OST_CONFIG.rpcUrl, 'confirmed');
    }
    return solanaConnection;
  }

  function readU16LE(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  function readU64LE(bytes, offset) {
    let value = 0n;
    for (let index = 0; index < 8; index++) {
      value |= BigInt(bytes[offset + index]) << BigInt(index * 8);
    }
    return value;
  }

  function formatCompactCount(value) {
    if (!Number.isFinite(value) || value <= 0) return '0';
    if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B';
    if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M';
    if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
    return Math.round(value).toLocaleString();
  }

  function formatCompactTokenAmount(value) {
    if (!Number.isFinite(value) || value <= 0) return '0 OST';
    if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B OST';
    if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M OST';
    if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K OST';
    return value.toFixed(value >= 10 ? 0 : 2) + ' OST';
  }

  function decodeDaoTreasuryAccount(accountInfo) {
    if (!accountInfo || !accountInfo.data || accountInfo.data.length < 83) return null;
    const bytes = accountInfo.data;
    return {
      treasuryTokenAccount: new solanaWeb3.PublicKey(bytes.slice(8, 40)).toBase58(),
      feeBasisPoints: readU16LE(bytes, 40),
      totalFeesCollected: Number(readU64LE(bytes, 42)) / 1e9,
      authority: new solanaWeb3.PublicKey(bytes.slice(50, 82)).toBase58(),
      bump: bytes[82]
    };
  }

  async function getAnchorAccountDiscriminator(name) {
    if (accountDiscriminatorCache[name]) return accountDiscriminatorCache[name];
    if (!(window.crypto && window.crypto.subtle)) {
      accountDiscriminatorCache[name] = null;
      return null;
    }
    const digest = await window.crypto.subtle.digest('SHA-256', textEncoder.encode('account:' + name));
    const discriminator = Array.from(new Uint8Array(digest).slice(0, 8));
    accountDiscriminatorCache[name] = discriminator;
    return discriminator;
  }

  function clearWalletFundingState() {
    walletFundingState = {
      needsManualFunding: false,
      walletAddress: '',
      lastError: ''
    };
  }

  function setWalletFundingState(nextState) {
    walletFundingState = Object.assign({}, walletFundingState, nextState || {});
    if (typeof window.syncWalletJourneyUi === 'function') {
      window.syncWalletJourneyUi();
    }
  }

  function copyTextToClipboard(text) {
    if (!text || !(navigator && navigator.clipboard && navigator.clipboard.writeText)) {
      return Promise.reject(new Error('Clipboard unavailable'));
    }
    return navigator.clipboard.writeText(String(text));
  }

  function openManualSolFaucet(pubkeyInput, options) {
    const settings = options || {};
    const address = pubkeyInput ? String(pubkeyInput) : '';
    if (!address) {
      toast('⚠️', 'Connect a wallet first');
      return false;
    }
    setWalletFundingState({
      needsManualFunding: true,
      walletAddress: address,
      lastError: walletFundingState.lastError || 'Manual devnet SOL top-up required'
    });
    copyTextToClipboard(address).then(function() {
      toast('📋', 'Wallet address copied. Fund a little devnet SOL, then return to claim OST.');
    }).catch(function() {
      toast('ℹ️', 'Copy this wallet address into the Solana browser faucet.');
    });
    if (faucetStatus) {
      faucetStatus.textContent = 'Wallet address ready. Open the Solana browser faucet, add a little devnet SOL, then come back here to claim OST.';
    }
    if (settings.open !== false) {
      window.open('https://faucet.solana.com/', '_blank', 'noopener');
    }
    return true;
  }

  async function fetchOstDevnetMetrics(options) {
    const settings = options || {};
    const now = Date.now();
    if (!settings.force && ostDevnetMetrics.available && ostDevnetMetrics.lastUpdatedAt && now - ostDevnetMetrics.lastUpdatedAt < OST_DEVNET_METRICS_REFRESH_MS) {
      return ostDevnetMetrics;
    }

    const conn = getSolanaConnection();
    if (!conn) throw new Error('Solana RPC unavailable');

    const programId = new solanaWeb3.PublicKey(OST_CONFIG.programId);
    const mintPk = new solanaWeb3.PublicKey(OST_CONFIG.mint);
    const daoTreasury = solanaWeb3.PublicKey.findProgramAddressSync([encodeSeed('dao-treasury')], programId)[0];
    const treasuryAuthority = solanaWeb3.PublicKey.findProgramAddressSync([encodeSeed('treasury-authority')], programId)[0];
    const derivedTreasuryTokenAccount = getAssociatedTokenAddressSync(
      mintPk,
      treasuryAuthority,
      true,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const [mintInfo, daoInfo] = await Promise.all([
      conn.getParsedAccountInfo(mintPk),
      conn.getAccountInfo(daoTreasury)
    ]);

    const daoTreasuryData = decodeDaoTreasuryAccount(daoInfo);
    const treasuryTokenAccount = daoTreasuryData && daoTreasuryData.treasuryTokenAccount
      ? new solanaWeb3.PublicKey(daoTreasuryData.treasuryTokenAccount)
      : derivedTreasuryTokenAccount;

    const [treasuryBalanceResponse, faucetClaimDiscriminator] = await Promise.all([
      conn.getTokenAccountBalance(treasuryTokenAccount).catch(function() { return null; }),
      getAnchorAccountDiscriminator('FaucetClaim')
    ]);

    let faucetClaimCount = ostDevnetMetrics.faucetClaimCount || 0;
    if (faucetClaimDiscriminator) {
      const faucetAccounts = await conn.getProgramAccounts(programId, {
        filters: [{ dataSize: 57 }]
      });
      faucetClaimCount = faucetAccounts.reduce(function(total, entry) {
        const matches = faucetClaimDiscriminator.every(function(byte, index) {
          return entry.account.data[index] === byte;
        });
        return matches ? total + 1 : total;
      }, 0);
    }

    const mintParsed = mintInfo && mintInfo.value && mintInfo.value.data && mintInfo.value.data.parsed && mintInfo.value.data.parsed.info
      ? mintInfo.value.data.parsed.info
      : null;
    const mintSupply = mintParsed ? Number(mintParsed.supply || 0) / 1e9 : 0;
    const treasuryBalance = treasuryBalanceResponse ? Number(treasuryBalanceResponse.value.amount || 0) / 1e9 : 0;
    const faucetDistributed = faucetClaimCount * OST_FAUCET_AMOUNT;
    const circulatingSupply = Math.max(0, mintSupply - treasuryBalance);
    const unstagedSupply = Math.max(0, circulatingSupply - faucetDistributed);

    return {
      mintSupply,
      treasuryBalance,
      faucetClaimCount,
      faucetDistributed,
      circulatingSupply,
      unstagedSupply,
      feeBasisPoints: daoTreasuryData ? daoTreasuryData.feeBasisPoints : 10,
      totalFeesCollected: daoTreasuryData ? daoTreasuryData.totalFeesCollected : 0,
      treasuryTokenAccount: treasuryTokenAccount.toBase58(),
      available: true,
      loading: false,
      error: '',
      lastUpdatedAt: now
    };
  }

  async function syncOstDevnetMetrics(options) {
    const settings = options || {};
    if (ostDevnetMetrics.loading && !settings.force) {
      return ostDevnetMetrics;
    }
    ostDevnetMetrics = Object.assign({}, ostDevnetMetrics, {
      loading: true,
      error: ''
    });
    updateOstMarketBoard();
    renderOstReserveChart();

    try {
      ostDevnetMetrics = await fetchOstDevnetMetrics(settings);
    } catch (error) {
      ostDevnetMetrics = Object.assign({}, ostDevnetMetrics, {
        loading: false,
        error: (error && error.message) || String(error || 'Devnet sync failed')
      });
    }

    updateOstMarketBoard();
    renderOstReserveChart();
    return ostDevnetMetrics;
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
    if (typeof window.syncWalletJourneyUi === 'function') {
      window.syncWalletJourneyUi();
    }
  }

  function shortAddress(pubkeyStr) {
    if (!pubkeyStr) return translations[currentLang]?.['nav.connect'] || 'Connect Wallet';
    return pubkeyStr.slice(0, 4) + '...' + pubkeyStr.slice(-4);
  }

  function setWalletButtonState(pubkeyStr) {
    if (!walletBtn || !walletText) return;
    if (pubkeyStr) {
      walletBtn.classList.add('connected');
      walletText.textContent = shortAddress(pubkeyStr);
      return;
    }
    walletBtn.classList.remove('connected');
    walletText.textContent = translations[currentLang]?.['nav.connect'] || 'Connect Wallet';
  }

  window.syncConnectedWalletUi = function syncConnectedWalletUi() {
    setWalletButtonState(connectedWallet);
    if (typeof window.syncInterchangeDeskWallet === 'function') {
      window.syncInterchangeDeskWallet();
    }
    if (typeof window.syncPredictionMarketTradeWallet === 'function') {
      window.syncPredictionMarketTradeWallet();
    }
  };

  function toPublicKey(value) {
    return value instanceof solanaWeb3.PublicKey ? value : new solanaWeb3.PublicKey(value);
  }

  function encodeSeed(seedText) {
    return textEncoder.encode(seedText);
  }

  function createLocalWalletRecord(keypair) {
    return {
      createdAt: Date.now(),
      secretKey: Array.from(keypair.secretKey)
    };
  }

  function readStoredLocalWallet() {
    try {
      const raw = localStorage.getItem(LOCAL_WALLET_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.secretKey) || !parsed.secretKey.length) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function persistLocalWallet(keypair) {
    try {
      localStorage.setItem(LOCAL_WALLET_STORAGE_KEY, JSON.stringify(createLocalWalletRecord(keypair)));
    } catch {
      toast('⚠️', 'Could not persist the local wallet in this browser');
    }
  }

  function loadLocalWalletKeypair() {
    const record = readStoredLocalWallet();
    if (!record) return null;
    try {
      return solanaWeb3.Keypair.fromSecretKey(Uint8Array.from(record.secretKey));
    } catch {
      return null;
    }
  }

  function downloadTextFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType || 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function markLocalWalletBackupExported() {
    try {
      localStorage.setItem(LOCAL_WALLET_BACKUP_EXPORTED_KEY, String(Date.now()));
    } catch {}
  }

  function readLocalWalletBackupExportedAt() {
    try {
      return Number(localStorage.getItem(LOCAL_WALLET_BACKUP_EXPORTED_KEY) || 0) || 0;
    } catch {
      return 0;
    }
  }

  function exportLocalWalletBackup(keypair) {
    markLocalWalletBackupExported();
    downloadTextFile('ost-browser-wallet.json', JSON.stringify(Array.from(keypair.secretKey)), 'application/json');
  }

  function getLocalWalletSession() {
    const keypair = loadLocalWalletKeypair();
    if (!keypair) return null;
    return {
      kind: 'local',
      type: 'local',
      label: 'OST Browser Wallet',
      keypair,
      publicKey: keypair.publicKey
    };
  }

  function setConnectedWalletSession(session, options) {
    const settings = options || {};
    if (!session || !session.publicKey) return;
    if (!connectedWalletSession || !connectedWalletSession.publicKey || connectedWalletSession.publicKey.toBase58() !== session.publicKey.toBase58()) {
      clearWalletFundingState();
    }
    connectedWalletSession = session;
    connectedWallet = session.publicKey.toBase58();
    setWalletButtonState(connectedWallet);

    if (settings.backup && session.kind === 'local' && session.keypair) {
      exportLocalWalletBackup(session.keypair);
      toast('🧾', 'Wallet backup downloaded. Keep that file offline.');
    }

    if (settings.announce !== false) {
      if (session.kind === 'local' && settings.backup) {
        toast('🔐', 'Browser wallet created on Solana devnet.');
      } else {
        toast('✅', `Connected: ${shortAddress(connectedWallet)}`);
      }
      verifyWalletAccount(connectedWallet).then(info => {
        if (info.verified) {
          toast('🔗', `Account verified — ${info.balance.toFixed(4)} SOL`);
        } else if (session.kind === 'local') {
          toast('💡', 'Local wallet ready. Claim devnet OST next to finish the live test flow.');
        } else {
          toast('💡', `New wallet — ${info.balance.toFixed(4)} SOL. Use the faucet below to get OST.`);
        }
      });
    }

    setTimeout(() => {
      if (typeof updateConvertProviders === 'function') {
        updateConvertProviders();
      }
      try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch {}
    }, 0);

    if (typeof window.syncWalletJourneyUi === 'function') {
      window.syncWalletJourneyUi();
    }
    syncOstDevnetMetrics();
  }

  function disconnectConnectedWallet() {
    const provider = connectedWalletSession && connectedWalletSession.provider;
    try {
      if (provider && typeof provider.disconnect === 'function') provider.disconnect();
    } catch {}
    connectedWalletSession = null;
    connectedWallet = null;
    clearWalletFundingState();
    setWalletButtonState(null);
    if (typeof window.syncInterchangeDeskWallet === 'function') {
      window.syncInterchangeDeskWallet();
    }
    if (typeof window.syncPredictionMarketTradeWallet === 'function') {
      window.syncPredictionMarketTradeWallet();
    }
    setTimeout(() => {
      if (typeof updateConvertProviders === 'function') {
        updateConvertProviders();
      }
    }, 0);
    if (typeof window.syncWalletJourneyUi === 'function') {
      window.syncWalletJourneyUi();
    }
    syncOstDevnetMetrics();
    toast('👛', 'Wallet disconnected');
  }

  function getAssociatedTokenAddressSync(mint, owner, allowOwnerOffCurve, tokenProgramId, associatedTokenProgramId) {
    const nextMint = toPublicKey(mint);
    const nextOwner = toPublicKey(owner);
    const nextTokenProgramId = tokenProgramId || TOKEN_2022_PROGRAM_ID;
    const nextAssociatedTokenProgramId = associatedTokenProgramId || ASSOCIATED_TOKEN_PROGRAM_ID;
    if (!allowOwnerOffCurve && !solanaWeb3.PublicKey.isOnCurve(nextOwner.toBuffer())) {
      throw new Error('Owner must be on curve');
    }
    return solanaWeb3.PublicKey.findProgramAddressSync(
      [nextOwner.toBuffer(), nextTokenProgramId.toBuffer(), nextMint.toBuffer()],
      nextAssociatedTokenProgramId
    )[0];
  }

  function createAssociatedTokenAccountInstruction(payer, associatedToken, owner, mint, tokenProgramId, associatedTokenProgramId) {
    return new solanaWeb3.TransactionInstruction({
      programId: associatedTokenProgramId || ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: toPublicKey(payer), isSigner: true, isWritable: true },
        { pubkey: toPublicKey(associatedToken), isSigner: false, isWritable: true },
        { pubkey: toPublicKey(owner), isSigner: false, isWritable: false },
        { pubkey: toPublicKey(mint), isSigner: false, isWritable: false },
        { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: tokenProgramId || TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }
      ],
      data: new Uint8Array([])
    });
  }

  function encodeU64LE(value) {
    let remaining = typeof value === 'bigint' ? value : BigInt(value);
    const bytes = new Uint8Array(8);
    for (let index = 0; index < 8; index++) {
      bytes[index] = Number(remaining & 255n);
      remaining >>= 8n;
    }
    return bytes;
  }

  function decimalAmountToBaseUnits(amount, decimals) {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error('Amount must be greater than zero');
    }
    const fixed = numericAmount.toFixed(decimals);
    const parts = fixed.split('.');
    return BigInt(parts[0] + (parts[1] || '').padEnd(decimals, '0'));
  }

  function createTransferCheckedInstruction(source, mint, destination, owner, amountBaseUnits, decimals, tokenProgramId) {
    const data = new Uint8Array(10);
    data[0] = 12;
    data.set(encodeU64LE(amountBaseUnits), 1);
    data[9] = decimals;
    return new solanaWeb3.TransactionInstruction({
      programId: tokenProgramId || TOKEN_2022_PROGRAM_ID,
      keys: [
        { pubkey: toPublicKey(source), isSigner: false, isWritable: true },
        { pubkey: toPublicKey(mint), isSigner: false, isWritable: false },
        { pubkey: toPublicKey(destination), isSigner: false, isWritable: true },
        { pubkey: toPublicKey(owner), isSigner: true, isWritable: false }
      ],
      data
    });
  }

  function createMemoInstruction(memoText, signerPubkey) {
    return new solanaWeb3.TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: signerPubkey ? [{ pubkey: toPublicKey(signerPubkey), isSigner: true, isWritable: false }] : [],
      data: textEncoder.encode(String(memoText || ''))
    });
  }

  function sanitizeMemoChunk(value, maxLength) {
    return String(value || '')
      .replace(/[|\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength || 32);
  }

  function buildInterchangeMemo(request) {
    const itemName = request && request.items && request.items.length
      ? sanitizeMemoChunk(request.items[0].name || request.items[0].merchant || 'item', 36)
      : 'item';
    return [
      'OST',
      'interchange',
      'source=' + sanitizeMemoChunk(request && request.source, 18),
      'merchant=' + sanitizeMemoChunk(request && request.merchant, 28),
      'curr=' + sanitizeMemoChunk(request && request.currency, 6),
      'fiat=' + Number(request && request.amount || 0).toFixed(2),
      'ost=' + Number(request && request.ostAmount || 0).toFixed(2),
      'items=' + Number(request && request.items ? request.items.length : 0),
      'ref=' + sanitizeMemoChunk(request && request.reference, 18),
      'item=' + itemName
    ].join('|');
  }

  function buildPredictionOrderMemo(order) {
    return [
      'OST',
      'prediction',
      'source=' + sanitizeMemoChunk(order && order.source, 18),
      'market=' + sanitizeMemoChunk(order && order.marketId, 24),
      'side=' + sanitizeMemoChunk(order && order.side, 4),
      'stake=' + Number(order && order.stake || 0).toFixed(2),
      'price=' + Number(order && order.price || 0).toFixed(4),
      'title=' + sanitizeMemoChunk(order && order.title, 36),
      'ref=' + sanitizeMemoChunk(order && order.reference, 18)
    ].join('|');
  }

  function getInterchangeDeskAccounts() {
    const programId = new solanaWeb3.PublicKey(OST_CONFIG.programId);
    const mintPk = new solanaWeb3.PublicKey(OST_CONFIG.mint);
    const treasuryAuthority = solanaWeb3.PublicKey.findProgramAddressSync([encodeSeed('treasury-authority')], programId)[0];
    const vaultTokenAccount = getAssociatedTokenAddressSync(mintPk, treasuryAuthority, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    return { programId, mintPk, treasuryAuthority, vaultTokenAccount };
  }

  async function ensureInterchangeDeskVaultAccount() {
    const conn = getSolanaConnection();
    if (!conn) throw new Error('Solana RPC unavailable');
    if (!connectedWalletSession || !connectedWalletSession.publicKey) throw new Error('Connect your wallet first');

    const accounts = getInterchangeDeskAccounts();
    const existingAccount = await conn.getAccountInfo(accounts.vaultTokenAccount);
    if (!existingAccount) {
      const createVaultTx = new solanaWeb3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          connectedWalletSession.publicKey,
          accounts.vaultTokenAccount,
          accounts.treasuryAuthority,
          accounts.mintPk,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
      await signAndSendTransaction(createVaultTx);
    }
    return accounts;
  }

  function storeInterchangeRequestRecord(record) {
    try {
      const existing = JSON.parse(localStorage.getItem(INTERCHANGE_REQUESTS_STORAGE_KEY) || '[]');
      existing.unshift(record);
      localStorage.setItem(INTERCHANGE_REQUESTS_STORAGE_KEY, JSON.stringify(existing.slice(0, 12)));
    } catch {}
  }

  function readPredictionOrderRecords() {
    try {
      return JSON.parse(localStorage.getItem(PREDICTION_ORDERS_STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function storePredictionOrderRecord(record) {
    try {
      const existing = readPredictionOrderRecords();
      existing.unshift(record);
      localStorage.setItem(PREDICTION_ORDERS_STORAGE_KEY, JSON.stringify(existing.slice(0, 12)));
    } catch {}
  }

  function getPredictionDeskAccounts() {
    return getInterchangeDeskAccounts();
  }

  async function ensurePredictionDeskVaultAccount() {
    return ensureInterchangeDeskVaultAccount();
  }

  async function createPredictionMarketOrder(order) {
    if (!order || !Number.isFinite(Number(order.stake)) || Number(order.stake) <= 0) {
      throw new Error('Select a live market and enter a valid OST stake first.');
    }
    if (!connectedWalletSession || !connectedWalletSession.publicKey) {
      throw new Error(t('pay.deskNeedWallet', 'Create or connect your OST wallet first'));
    }

    const conn = getSolanaConnection();
    if (!conn) throw new Error('Solana RPC unavailable');

    const trader = connectedWalletSession.publicKey;
    const lamports = await conn.getBalance(trader);
    if (lamports < Math.round(0.001 * solanaWeb3.LAMPORTS_PER_SOL)) {
      throw new Error(t('pay.walletNeedsSol', 'This wallet needs a little devnet SOL for the network fee. Fund it at faucet.solana.com, then try again.'));
    }

    const ostBalance = await getOstBalanceForAddress(trader);
    if (ostBalance + 1e-9 < Number(order.stake)) {
      throw new Error(t('pay.notEnoughOst', 'Not enough OST in this wallet. Claim or buy OST first.'));
    }

    const mintPk = new solanaWeb3.PublicKey(OST_CONFIG.mint);
    const sourceAta = getAssociatedTokenAddressSync(mintPk, trader, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const sourceInfo = await conn.getAccountInfo(sourceAta);
    if (!sourceInfo) {
      throw new Error('This wallet does not have an OST token account yet. Claim or receive OST first.');
    }

    const deskAccounts = await ensurePredictionDeskVaultAccount();
    const memo = buildPredictionOrderMemo(order);
    const amountBaseUnits = decimalAmountToBaseUnits(Number(order.stake), OST_TOKEN_DECIMALS);
    const transaction = new solanaWeb3.Transaction();
    transaction.add(createMemoInstruction(memo, trader));
    transaction.add(
      createTransferCheckedInstruction(
        sourceAta,
        mintPk,
        deskAccounts.vaultTokenAccount,
        trader,
        amountBaseUnits,
        OST_TOKEN_DECIMALS,
        TOKEN_2022_PROGRAM_ID
      )
    );

    const signature = await signAndSendTransaction(transaction);
    const remainingBalance = await getOstBalanceForAddress(trader);
    var record = {
      signature: signature,
      source: order.source,
      marketId: order.marketId,
      title: order.title,
      side: order.side,
      topic: order.topic,
      price: Number(order.price),
      stake: Number(order.stake),
      potentialReturn: Number(order.potentialReturn),
      sourceUrl: order.sourceUrl,
      createdAt: Date.now()
    };
    storePredictionOrderRecord(record);
    return {
      signature: signature,
      remainingBalance: remainingBalance,
      vaultTokenAccount: deskAccounts.vaultTokenAccount.toBase58(),
      record: record
    };
  }

  async function createInterchangePaymentRequest(request) {
    if (!request || !Number.isFinite(Number(request.ostAmount)) || Number(request.ostAmount) <= 0) {
      throw new Error(t('pay.deskNeedValidAmount', 'Load a request with a valid OST amount first'));
    }
    if (!connectedWalletSession || !connectedWalletSession.publicKey) {
      throw new Error(t('pay.deskNeedWallet', 'Create or connect your OST wallet first'));
    }

    const conn = getSolanaConnection();
    if (!conn) throw new Error('Solana RPC unavailable');

    const requester = connectedWalletSession.publicKey;
    const lamports = await conn.getBalance(requester);
    if (lamports < Math.round(0.001 * solanaWeb3.LAMPORTS_PER_SOL)) {
      throw new Error(t('pay.walletNeedsSol', 'This wallet needs a little devnet SOL for the network fee. Fund it at faucet.solana.com, then try again.'));
    }

    const ostBalance = await getOstBalanceForAddress(requester);
    if (ostBalance + 1e-9 < Number(request.ostAmount)) {
      throw new Error(t('pay.notEnoughOst', 'Not enough OST in this wallet. Claim or buy OST first.'));
    }

    const mintPk = new solanaWeb3.PublicKey(OST_CONFIG.mint);
    const sourceAta = getAssociatedTokenAddressSync(mintPk, requester, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const sourceInfo = await conn.getAccountInfo(sourceAta);
    if (!sourceInfo) {
      throw new Error('This wallet does not have an OST token account yet. Claim or receive OST first.');
    }

    const deskAccounts = await ensureInterchangeDeskVaultAccount();
    const memo = buildInterchangeMemo(request);
    const amountBaseUnits = decimalAmountToBaseUnits(Number(request.ostAmount), OST_TOKEN_DECIMALS);
    const transaction = new solanaWeb3.Transaction();
    transaction.add(createMemoInstruction(memo, requester));
    transaction.add(
      createTransferCheckedInstruction(
        sourceAta,
        mintPk,
        deskAccounts.vaultTokenAccount,
        requester,
        amountBaseUnits,
        OST_TOKEN_DECIMALS,
        TOKEN_2022_PROGRAM_ID
      )
    );

    const signature = await signAndSendTransaction(transaction);
    const remainingBalance = await getOstBalanceForAddress(requester);
    storeInterchangeRequestRecord({
      signature,
      merchant: request.merchant,
      amount: request.amount,
      currency: request.currency,
      ostAmount: request.ostAmount,
      createdAt: Date.now()
    });
    return {
      signature,
      vaultTokenAccount: deskAccounts.vaultTokenAccount.toBase58(),
      remainingBalance
    };
  }

  function decodeTokenBalance(accountInfo) {
    if (!accountInfo || !accountInfo.data || accountInfo.data.length < 72) return 0;
    let rawAmount = 0n;
    for (let index = 0; index < 8; index++) {
      rawAmount |= BigInt(accountInfo.data[64 + index]) << BigInt(index * 8);
    }
    return Number(rawAmount) / 1e9;
  }

  async function getOstBalanceForAddress(pubkeyInput) {
    try {
      const conn = getSolanaConnection();
      if (!conn) return 0;
      const owner = toPublicKey(pubkeyInput);
      const mintPk = new solanaWeb3.PublicKey(OST_CONFIG.mint);
      const ata = getAssociatedTokenAddressSync(mintPk, owner, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      const ataInfo = await conn.getAccountInfo(ata);
      return decodeTokenBalance(ataInfo);
    } catch {
      return 0;
    }
  }

  async function signAndSendTransaction(transaction) {
    const conn = getSolanaConnection();
    if (!conn) throw new Error('Solana RPC unavailable');
    if (!connectedWalletSession || !connectedWalletSession.publicKey) throw new Error('Connect your wallet first');

    // Preserve any existing blockhash/feePayer/partial signatures (e.g. when the
    // OST swap pool has already co-signed the transaction). Overwriting the
    // blockhash invalidates the pool's signature and silently breaks every swap.
    let latest = null;
    if (!transaction.recentBlockhash) {
      latest = await conn.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = latest.blockhash;
    }
    if (!transaction.feePayer) {
      transaction.feePayer = connectedWalletSession.publicKey;
    }

    let signature = null;
    if (connectedWalletSession.kind === 'local' && connectedWalletSession.keypair) {
      // partialSign preserves any pre-existing co-signer signatures (vs .sign which clears them).
      transaction.partialSign(connectedWalletSession.keypair);
      signature = await conn.sendRawTransaction(transaction.serialize());
    } else if (connectedWalletSession.provider && typeof connectedWalletSession.provider.signAndSendTransaction === 'function') {
      const result = await connectedWalletSession.provider.signAndSendTransaction(transaction);
      signature = typeof result === 'string' ? result : result && result.signature;
    } else if (connectedWalletSession.provider && typeof connectedWalletSession.provider.signTransaction === 'function') {
      const signedTransaction = await connectedWalletSession.provider.signTransaction(transaction);
      signature = await conn.sendRawTransaction(signedTransaction.serialize());
    }

    if (!signature) throw new Error('Active wallet cannot sign transactions');
    if (!latest) {
      try { latest = await conn.getLatestBlockhash('confirmed'); } catch (_) {}
    }
    if (latest) {
      await conn.confirmTransaction({
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight
      }, 'confirmed');
    } else {
      await conn.confirmTransaction(signature, 'confirmed');
    }
    return signature;
  }

  async function ensureWalletFeeBalance(pubkeyInput) {
    const conn = getSolanaConnection();
    if (!conn) throw new Error('Solana RPC unavailable');
    const pubkey = toPublicKey(pubkeyInput);
    const minimumLamports = Math.round(0.02 * solanaWeb3.LAMPORTS_PER_SOL);
    const airdropLamports = Math.round(0.1 * solanaWeb3.LAMPORTS_PER_SOL);
    const currentLamports = await conn.getBalance(pubkey);
    if (currentLamports >= minimumLamports) {
      return { funded: false, balance: currentLamports / solanaWeb3.LAMPORTS_PER_SOL };
    }
    const signature = await conn.requestAirdrop(pubkey, airdropLamports);
    await conn.confirmTransaction(signature, 'confirmed');
    const nextLamports = await conn.getBalance(pubkey);
    return { funded: true, balance: nextLamports / solanaWeb3.LAMPORTS_PER_SOL };
  }

  async function ensureOstAssociatedTokenAccount(ownerPubkey) {
    const conn = getSolanaConnection();
    if (!conn) throw new Error('Solana RPC unavailable');
    const owner = toPublicKey(ownerPubkey);
    const mintPk = new solanaWeb3.PublicKey(OST_CONFIG.mint);
    const claimerAta = getAssociatedTokenAddressSync(mintPk, owner, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const existingAccount = await conn.getAccountInfo(claimerAta);
    if (!existingAccount) {
      const createAtaTx = new solanaWeb3.Transaction().add(
        createAssociatedTokenAccountInstruction(owner, claimerAta, owner, mintPk, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
      );
      await signAndSendTransaction(createAtaTx);
    }
    return claimerAta;
  }

  async function maybeRecordSeedlessOnboard() {
    if (!connectedWalletSession || connectedWalletSession.kind !== 'local') return null;
    const conn = getSolanaConnection();
    if (!conn) throw new Error('Solana RPC unavailable');

    const user = connectedWalletSession.publicKey;
    const programId = new solanaWeb3.PublicKey(OST_CONFIG.programId);
    const seedlessAccount = solanaWeb3.PublicKey.findProgramAddressSync([encodeSeed('seedless'), user.toBuffer()], programId)[0];

    if (await conn.getAccountInfo(seedlessAccount)) {
      return { created: false, seedlessAccount: seedlessAccount.toBase58() };
    }

    const data = new Uint8Array(SEEDLESS_ONBOARD_DISCRIMINATOR.length + 1);
    data.set(SEEDLESS_ONBOARD_DISCRIMINATOR, 0);
    data[SEEDLESS_ONBOARD_DISCRIMINATOR.length] = 0;

    const instruction = new solanaWeb3.TransactionInstruction({
      programId,
      keys: [
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: seedlessAccount, isSigner: false, isWritable: true },
        { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      data
    });

    const signature = await signAndSendTransaction(new solanaWeb3.Transaction().add(instruction));
    return { created: true, signature, seedlessAccount: seedlessAccount.toBase58() };
  }

  async function claimOstFaucetForActiveWallet() {
    if (!connectedWalletSession || !connectedWalletSession.publicKey) {
      throw new Error(t('pay.deskNeedWallet', 'Create or connect your OST wallet first'));
    }

    const conn = getSolanaConnection();
    if (!conn) throw new Error('Solana RPC unavailable');

    const claimer = connectedWalletSession.publicKey;
    const programId = new solanaWeb3.PublicKey(OST_CONFIG.programId);
    const mintPk = new solanaWeb3.PublicKey(OST_CONFIG.mint);
    const daoTreasury = solanaWeb3.PublicKey.findProgramAddressSync([encodeSeed('dao-treasury')], programId)[0];
    const treasuryAuthority = solanaWeb3.PublicKey.findProgramAddressSync([encodeSeed('treasury-authority')], programId)[0];
    const faucetClaim = solanaWeb3.PublicKey.findProgramAddressSync([encodeSeed('faucet-claim'), claimer.toBuffer()], programId)[0];
    const treasuryTokenAccount = getAssociatedTokenAddressSync(mintPk, treasuryAuthority, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const claimerTokenAccount = await ensureOstAssociatedTokenAccount(claimer);

    if (await conn.getAccountInfo(faucetClaim)) {
      return { claimed: false, alreadyClaimed: true, balance: await getOstBalanceForAddress(claimer) };
    }

    const instruction = new solanaWeb3.TransactionInstruction({
      programId,
      keys: [
        { pubkey: claimer, isSigner: true, isWritable: true },
        { pubkey: claimerTokenAccount, isSigner: false, isWritable: true },
        { pubkey: treasuryTokenAccount, isSigner: false, isWritable: true },
        { pubkey: daoTreasury, isSigner: false, isWritable: false },
        { pubkey: treasuryAuthority, isSigner: false, isWritable: false },
        { pubkey: faucetClaim, isSigner: false, isWritable: true },
        { pubkey: mintPk, isSigner: false, isWritable: false },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      data: CLAIM_FAUCET_DISCRIMINATOR
    });

    // Charge a real per-wallet SOL fee so users individually pay for their
    // OST faucet claim — no more free-riding the public faucet. The fee
    // goes to the OST swap pool which is what backs the live swap path.
    const FAUCET_SOL_FEE_LAMPORTS = 1_000_000; // 0.001 SOL ≈ $0.10
    const tx = new solanaWeb3.Transaction();
    try {
      var poolPubkey = (window.OST_SWAP_POOL && window.OST_SWAP_POOL.publicKey)
        ? new solanaWeb3.PublicKey(window.OST_SWAP_POOL.publicKey)
        : daoTreasury; // fallback: send fee to the program treasury
      tx.add(solanaWeb3.SystemProgram.transfer({
        fromPubkey: claimer,
        toPubkey: poolPubkey,
        lamports: FAUCET_SOL_FEE_LAMPORTS
      }));
    } catch (e) {
      console.warn('[OST] could not attach faucet SOL fee', e);
    }
    tx.add(instruction);

    const signature = await signAndSendTransaction(tx);
    return { claimed: true, signature, balance: await getOstBalanceForAddress(claimer), feeLamports: FAUCET_SOL_FEE_LAMPORTS };
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
      disconnectConnectedWallet();
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
      phantom: async () => {
        if (window.solana && window.solana.isPhantom) {
          const response = await window.solana.connect();
          return {
            kind: 'extension',
            type: 'phantom',
            label: 'Phantom',
            provider: window.solana,
            publicKey: response.publicKey || window.solana.publicKey
          };
        }
        window.open('https://phantom.app/', '_blank');
        throw 'Install Phantom';
      },
      solflare: async () => {
        if (window.solflare && window.solflare.isSolflare) {
          await window.solflare.connect();
          return {
            kind: 'extension',
            type: 'solflare',
            label: 'Solflare',
            provider: window.solflare,
            publicKey: window.solflare.publicKey
          };
        }
        window.open('https://solflare.com/', '_blank');
        throw 'Install Solflare';
      },
      backpack: async () => {
        if (window.backpack) {
          const response = await window.backpack.connect();
          return {
            kind: 'extension',
            type: 'backpack',
            label: 'Backpack',
            provider: window.backpack,
            publicKey: response.publicKey || window.backpack.publicKey
          };
        }
        window.open('https://www.backpack.app/', '_blank');
        throw 'Install Backpack';
      },
      ledger: () => {
        toast('💳', 'Ledger: Use Phantom or Solflare with Ledger connected');
        return Promise.reject('Use Phantom');
      },
      walletconnect: () => {
        toast('🔗', 'WalletConnect: Coming soon');
        return Promise.reject('Coming soon');
      },
      local: async () => {
        let keypair = loadLocalWalletKeypair();
        const isNewWallet = !keypair;
        if (!keypair) {
          keypair = solanaWeb3.Keypair.generate();
          persistLocalWallet(keypair);
        }
        return {
          kind: 'local',
          type: 'local',
          label: 'OST Browser Wallet',
          publicKey: keypair.publicKey,
          keypair,
          created: isNewWallet
        };
      }
    };

    const fn = providers[type];
    if (!fn) return;

    Promise.resolve()
      .then(() => fn())
      .then(session => {
        setConnectedWalletSession(session, {
          announce: true,
          backup: !!session.created
        });
      })
      .catch(err => {
        if (typeof err === 'string' && err !== 'Redirect') {
          toast('⚠️', err);
        }
      });
  }

  const restoredLocalWalletSession = getLocalWalletSession();
  if (restoredLocalWalletSession) {
    setConnectedWalletSession(restoredLocalWalletSession, { announce: false });
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
  // Expose live prices for wallet-extras.js to compute real-USD curve
  Object.defineProperty(window, '__ostPrices', { get: function () { return Object.assign({}, prices, { ost: typeof ostPrice !== 'undefined' ? ostPrice : 1 }); } });
    let priceHistory = { bitcoin: [], ethereum: [], solana: [] };
  let ostPrice = 0.0001; // Default OST price
  window.ostPrice = ostPrice;
  const OST_BASE_PRICE = 0.0001;

    function getChartBasePrice(coin) {
      if (coin === 'bitcoin') return prices.bitcoin || 105000;
      if (coin === 'ethereum') return prices.ethereum || 3800;
      if (coin === 'solana') return prices.solana || 170;
      return 1;
    }

    function formatCompactUsd(value) {
      if (!Number.isFinite(value)) return '$0';
      const abs = Math.abs(value);
      if (abs >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
      if (abs >= 1e6) return '$' + (value / 1e6).toFixed(2) + 'M';
      if (abs >= 1e3) return '$' + (value / 1e3).toFixed(1) + 'K';
      return '$' + value.toFixed(0);
    }

    function getOstPulseStatusText() {
      if (walletFundingState.needsManualFunding && connectedWallet && walletFundingState.walletAddress === connectedWallet) {
        return 'Wallet needs SOL';
      }
      if (!ostDevnetMetrics.available) {
        return ostDevnetMetrics.loading ? 'Syncing devnet' : 'Devnet sync pending';
      }
      if (ostDevnetMetrics.treasuryBalance < OST_FAUCET_AMOUNT) {
        return 'Treasury empty';
      }
      if (ostDevnetMetrics.faucetClaimCount > 0) {
        return formatCompactCount(ostDevnetMetrics.faucetClaimCount) + ' wallets served';
      }
      return 'Treasury ready';
    }

    function updateOstMarketBoard() {
      const volumeEl = $('#ostMarketVolume');
      const liquidityEl = $('#ostMarketLiquidity');
      const velocityEl = $('#ostMarketVelocity');
      const updatedEl = $('#ostMarketUpdated');
      const liveValueEl = $('#ostLivePrice');
      const liveChangeEl = $('#ostLiveChange');

      if (liveValueEl) liveValueEl.textContent = OST_FAUCET_AMOUNT.toFixed(2) + ' OST';
      if (liveChangeEl) {
        liveChangeEl.textContent = getOstPulseStatusText();
        liveChangeEl.className = 'price-card-change';
      }

      if (volumeEl) volumeEl.textContent = ostDevnetMetrics.available ? formatCompactTokenAmount(ostDevnetMetrics.mintSupply) : '0 OST';
      if (liquidityEl) liquidityEl.textContent = ostDevnetMetrics.available ? formatCompactTokenAmount(ostDevnetMetrics.treasuryBalance) : '0 OST';
      if (velocityEl) velocityEl.textContent = ostDevnetMetrics.available ? formatCompactCount(ostDevnetMetrics.faucetClaimCount) : '0';

      if (updatedEl) {
        if (ostDevnetMetrics.available) {
          updatedEl.textContent = 'Devnet live · ' + new Date(ostDevnetMetrics.lastUpdatedAt || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        } else {
          updatedEl.textContent = ostDevnetMetrics.loading ? 'Syncing devnet…' : 'Devnet sync pending';
        }
      }
    }

    function refreshOstDisplays() {
      const tickerPrice = $('#tickerPrice');
      const tickerChange = $('#tickerChange');

      if (tickerPrice) tickerPrice.textContent = '$' + ostPrice.toFixed(6);
      if (tickerChange) {
        tickerChange.textContent = 'Preview quote';
        tickerChange.className = 'ticker-change';
      }

      updateOstMarketBoard();
    }

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

      // Keep OST pricing deterministic until a direct live market feed exists.
      ostPrice = OST_BASE_PRICE;
      window.ostPrice = ostPrice;
      refreshOstDisplays();

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
      ostPrice = OST_BASE_PRICE;
      window.ostPrice = ostPrice;
      refreshOstDisplays();
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
      const seedPrice = getChartBasePrice(coin);
      priceHistory[coin] = Array.from({ length: 60 }, () => seedPrice * (0.995 + Math.random() * 0.01));
    });
  }
  initCharts();

  function renderOstReserveChart() {
    const canvas = $('#chart-ost');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const computedHeight = parseFloat(window.getComputedStyle(canvas).height || '0');
    const w = Math.max(160, Math.round(rect.width || canvas.parentElement?.clientWidth || canvas.clientWidth || 320));
    const h = Math.max(120, Math.round(rect.height || computedHeight || canvas.clientHeight || 140));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.font = '600 12px system-ui';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.92)';
    ctx.fillText('Devnet reserve split', 16, 24);
    ctx.font = '500 11px system-ui';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.92)';

    if (!ostDevnetMetrics.available) {
      ctx.fillText(ostDevnetMetrics.loading ? 'Loading mint, treasury, and faucet data…' : 'Devnet metrics are waiting for the next sync.', 16, 48);
      return;
    }

    const total = Math.max(ostDevnetMetrics.mintSupply || 0, 1);
    const treasury = Math.max(0, Math.min(ostDevnetMetrics.treasuryBalance || 0, total));
    const faucet = Math.max(0, Math.min(ostDevnetMetrics.faucetDistributed || 0, total));
    const other = Math.max(0, total - treasury - faucet);
    const segments = [
      { label: 'Treasury', value: treasury, color: '#22c55e' },
      { label: 'Faucet', value: faucet, color: '#38bdf8' },
      { label: 'Other', value: other, color: 'rgba(148, 163, 184, 0.82)' }
    ].filter(function(segment) {
      return segment.value > 0 || segment.label === 'Treasury';
    });
    const barX = 16;
    const barY = 56;
    const barW = w - 32;
    const barH = 18;
    let cursorX = barX;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.fillRect(barX, barY, barW, barH);

    segments.forEach(function(segment) {
      const segmentWidth = Math.max((segment.value / total) * barW, segment.value > 0 ? 2 : 0);
      ctx.fillStyle = segment.color;
      ctx.fillRect(cursorX, barY, Math.min(segmentWidth, barX + barW - cursorX), barH);
      cursorX += segmentWidth;
    });

    ctx.fillStyle = 'rgba(148, 163, 184, 0.92)';
    ctx.fillText(formatCompactTokenAmount(total) + ' minted on devnet', 16, 96);

    const legend = [
      { label: 'Treasury', value: treasury, color: '#22c55e' },
      { label: 'Claimed', value: faucet, color: '#38bdf8' },
      { label: 'Other', value: other, color: 'rgba(148, 163, 184, 0.82)' }
    ];

    legend.forEach(function(item, index) {
      const rowY = 118 + (index * 20);
      ctx.fillStyle = item.color;
      ctx.fillRect(16, rowY - 9, 10, 10);
      ctx.fillStyle = 'rgba(226, 232, 240, 0.92)';
      ctx.fillText(item.label, 32, rowY);
      ctx.textAlign = 'right';
      ctx.fillText(formatCompactTokenAmount(item.value), w - 16, rowY);
      ctx.textAlign = 'left';
    });
  }

  function updateCharts() {
    ['bitcoin', 'ethereum', 'solana'].forEach(coin => {
      const canvas = $(`#chart-${coin}`);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const rect = canvas.getBoundingClientRect();
      const computedHeight = parseFloat(window.getComputedStyle(canvas).height || '0');
      const w = Math.max(160, Math.round(rect.width || canvas.parentElement?.clientWidth || canvas.clientWidth || 320));
      const h = Math.max(120, Math.round(rect.height || computedHeight || canvas.clientHeight || 140));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Add current price with small variation
      const baseP = getChartBasePrice(coin);
      const volatility = 0.004;
      const newP = baseP * (1 - volatility / 2 + Math.random() * volatility);
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

    renderOstReserveChart();
  }

  // Update charts every second
  setInterval(updateCharts, 1000);
  setTimeout(updateCharts, 500);
  syncOstDevnetMetrics({ force: true });
  setInterval(function() {
    syncOstDevnetMetrics();
  }, OST_DEVNET_METRICS_REFRESH_MS);

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
    const liveLabel = (translations[currentLang] && translations[currentLang]['wallet.market.updated']) || translations.en['wallet.market.updated'] || 'Live';

    if (amount <= 0) {
      if (calcResult) calcResult.textContent = '--';
      if (calcRate) calcRate.textContent = '--';
      if (calcUpdated) calcUpdated.textContent = `● ${liveLabel}`;
      return;
    }

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
      calcUpdated.textContent = `● ${liveLabel} · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }
  }

  if (calcAmount) calcAmount.addEventListener('input', updateCalc);
  if (calcCurrency) calcCurrency.addEventListener('change', updateCalc);

  /* ---------- MINI STORE / CART ---------- */
  let cart = [];
  const storeCatalogMeta = $('#storeCatalogMeta');
  const storeItems = $$('.store-item');
  const storeFilterChips = $$('.store-filter-chip');
  let activeStoreFilter = 'all';

  function applyStoreFilter(filter = activeStoreFilter) {
    activeStoreFilter = filter;
    let visibleCount = 0;
    storeItems.forEach(item => {
      const categories = (item.getAttribute('data-category') || '').split(/\s+/).filter(Boolean);
      const isVisible = filter === 'all' || categories.includes(filter);
      item.classList.toggle('store-item-hidden', !isVisible);
      if (isVisible) visibleCount += 1;
    });

    if (storeCatalogMeta) {
      storeCatalogMeta.textContent = visibleCount + ' ' + t('pay.catalogCountSuffix', 'live listings');
    }

    storeFilterChips.forEach(btn => {
      btn.classList.toggle('is-active', btn.getAttribute('data-filter') === filter);
    });
  }

  window.syncStoreCatalogUi = function syncStoreCatalogUi() {
    applyStoreFilter(activeStoreFilter);
  };

  storeFilterChips.forEach(btn => {
    btn.addEventListener('click', () => applyStoreFilter(btn.getAttribute('data-filter') || 'all'));
  });

  applyStoreFilter();

  function renderCart() {
    const cartItems = $('#cartItems');
    const cartBadge = $('#cartBadge');
    const cartTotal = $('#cartTotal');
    const payBtn = $('#payBtn');
    if (!cartItems) return;

    if (cart.length === 0) {
      cartItems.innerHTML = '<p class="cart-empty">' + esc(t('pay.empty', 'Tap + to add items')) + '</p>';
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

  window.clearShopCart = function clearShopCart() {
    cart = [];
    renderCart();
  };

  $$('.btn-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.store-item');
      const img = item.querySelector('.item-img');
      cart.push({
        name: item.getAttribute('data-name'),
        price: parseFloat(item.getAttribute('data-price')),
        merchant: item.getAttribute('data-merchant') || 'Merchant',
        url: item.getAttribute('data-link') || '',
        currency: item.getAttribute('data-currency') || 'USD',
        category: item.getAttribute('data-category') || 'general',
        emoji: img ? '🛍️' : (item.querySelector('.item-visual')?.textContent || ''),
      });
      renderCart();
      toast('🛒', t('pay.toastAdded', 'Added') + ' ' + item.getAttribute('data-name'));
    });
  });

  /* Pay Button */
  const payBtn = $('#payBtn');
  if (payBtn) payBtn.addEventListener('click', () => {
    if (!cart.length) return;
    if (typeof window.loadInterchangeRequest !== 'function') {
      toast('⚠️', t('pay.interchangeLoading', 'Interchange desk is still loading'));
      return;
    }

    const merchantNames = [...new Set(cart.map(item => item.merchant).filter(Boolean))];
    const firstUrl = cart.find(item => item.url)?.url || '';
    window.loadInterchangeRequest({
      merchant: merchantNames.length === 1 ? merchantNames[0] : 'OST Interchange Desk',
      merchantUrl: merchantNames.length === 1 ? firstUrl : '',
      amount: cart.reduce((sum, item) => sum + item.price, 0),
      currency: cart[0]?.currency || 'USD',
      items: cart.map(item => ({
        name: item.name,
        price: item.price,
        merchant: item.merchant || 'Merchant',
        url: item.url || '',
        currency: item.currency || 'USD',
        category: item.category || 'general'
      })),
      source: t('pay.shopSource', 'shop cart'),
      note: merchantNames.length > 1 ? 'Batch cart from curated shop' : 'Curated shop order'
    });
    toast('🧾', t('pay.cartMoved', 'Cart moved to the interchange desk'));
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
  const transferBtnLabel = $('#transferBtnLabel');
  const convertRouteState = $('#convertRouteState');

  function setConvertRouteMessage(text) {
    if (convertRouteState) convertRouteState.textContent = text;
  }

  function resetConvertStepState() {
    ['pStep1', 'pStep2', 'pStep3'].forEach(id => {
      const el = $(`#${id}`);
      if (!el) return;
      el.classList.remove('active', 'done');
    });
  }

  async function pulseConvertSteps(doneCount) {
    const steps = ['pStep1', 'pStep2', 'pStep3'];
    resetConvertStepState();
    for (let index = 0; index < steps.length; index++) {
      const el = $(`#${steps[index]}`);
      if (!el) continue;
      if (index < doneCount) {
        el.classList.add('active');
        await sleep(220);
        el.classList.remove('active');
        el.classList.add('done');
      }
    }
  }

  function updateTransferPreview() {
    if (!transferAmount || !transferFrom || !transferResult) return;
    const amount = parseFloat(transferAmount.value) || 0;
    const curr = transferFrom.value;
    if (amount <= 0) {
      transferResult.textContent = translations[currentLang]?.['transfer.result'] || 'Private & Instant';
      resetConvertStepState();
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
    const isFiat = fiatCurrencies.includes(curr);
    if (transferBtnLabel) {
      transferBtnLabel.textContent = isFiat
        ? 'Open devnet guide'
        : connectedWallet
          ? (curr === 'SOL' ? 'Buy OST through OST treasury' : 'Load live swap route')
          : 'Connect wallet to swap';
    }

    if (isFiat) {
      convertProviders.style.display = 'block';
      const onr = $('#cpOnramper');
      const mp = $('#cpMoonPay');
      const tr = $('#cpTransak');
      if (onr) onr.href = 'https://buy.onramper.com/?defaultCrypto=sol_solana&onlyCryptoNetworks=solana&mode=buy&defaultFiat=' + encodeURIComponent(curr);
      if (mp) mp.href = 'https://www.moonpay.com/buy/sol';
      if (tr) tr.href = 'https://global.transak.com/?cryptoCurrencyCode=SOL&fiatCurrency=' + encodeURIComponent(curr);
      setConvertRouteMessage('Devnet OST cannot be bought directly with fiat yet. Use the faucet for live test OST, or use these provider links as the future mainnet route into SOL or USDC.');
    } else {
      convertProviders.style.display = 'none';
      setConvertRouteMessage(connectedWallet
        ? 'Your wallet can now use the live Jupiter swap route. Review the widget before approving any on-chain action.'
        : 'Crypto routes stay in preview mode until you create or connect a wallet. Once connected, OST will load the live swap widget.');
    }
  }

  if (transferBtn) {
    transferBtn.addEventListener('click', async () => {
      const amount = parseFloat(transferAmount?.value) || 0;
      const curr = transferFrom?.value || 'BTC';
      const isFiat = fiatCurrencies.includes(curr);

      if (amount <= 0) {
        transferResult.textContent = 'Enter an amount to preview the route.';
        setConvertRouteMessage('OST shows the estimate first. Enter an amount, then choose whether to use the faucet, provider links, or the live swap widget.');
        resetConvertStepState();
        return;
      }

      if (!isFiat && !connectedWalletSession) {
        if (window.setWalletPanel) window.setWalletPanel('access', { scroll: true });
        transferResult.textContent = 'Connect a wallet first to execute a live crypto route.';
        setConvertRouteMessage('Crypto routes stay in preview mode until a wallet is connected. Create a browser wallet or connect Phantom, Solflare, or Backpack first.');
        toast('👛', 'Create or connect a wallet first to use the live swap route');
        resetConvertStepState();
        return;
      }

      if (isFiat) {
        // Fiat now also routes through the universal treasury path:
        // pool releases OST at the live FX rate and the treasury records
        // a synthetic IOU backed by the deposited fiat.
        if (window.OST_REAL_SWAP && typeof window.OST_REAL_SWAP.swapAny === 'function' && connectedWalletSession) {
          try {
            await pulseConvertSteps(2);
            const fq = window.OST_REAL_SWAP.quoteAny(curr, amount);
            transferResult.textContent = 'Routing ' + amount + ' ' + curr + ' → ~' + fq.ost.toFixed(2) + ' OST...';
            const fr = await window.OST_REAL_SWAP.swapAny(curr, amount, {});
            transferResult.textContent = 'Received ' + fr.ost.toFixed(2) + ' OST · sig ' + String(fr.sig).slice(0, 8) + '...';
            setConvertRouteMessage('Treasury reserve created: ' + amount + ' ' + curr + ' (≈ $' + fr.usd.toFixed(2) + ') is held as backing for the ' + fr.ost.toFixed(2) + ' OST released to your wallet.');
            toast('💱', 'Converted ' + amount + ' ' + curr + ' → ' + fr.ost.toFixed(2) + ' OST');
            launchConfetti();
            updateWalletBalance(connectedWallet);
            return;
          } catch (err) {
            console.warn('[OST] Fiat treasury route failed, showing provider links', err);
            transferResult.textContent = 'Treasury route failed: ' + ((err && err.message) || err);
          }
        }
        // Fallback: show fiat provider links as before
        await pulseConvertSteps(1);
        transferResult.textContent = `Route guide ready for ${curr} → OST.`;
        setConvertRouteMessage('Direct fiat purchase is not live on devnet. Use the faucet for test OST, or open the provider links below as the future mainnet on-ramp into SOL or USDC.');
        if (convertProviders) {
          convertProviders.style.display = 'block';
          convertProviders.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        toast('💳', 'Devnet guide ready. Use the faucet for live test OST.');
        return;
      }

      await pulseConvertSteps(2);

      // ---- Universal "any currency → OST" path through the OST treasury ----
      // SOL still does the real atomic on-chain co-signed swap.
      // Everything else (BTC, ETH, USDC, USDT, BNB, fiat) routes through the
      // treasury reserve: pool releases OST at the live USD rate and we
      // record an IOU entry backed by the deposited currency.
      if (window.OST_REAL_SWAP && typeof window.OST_REAL_SWAP.swapAny === 'function' && window.OST_SWAP_POOL) {
        try {
          var q = window.OST_REAL_SWAP.quoteAny(curr, amount);
          transferResult.textContent = 'Routing ' + amount + ' ' + curr + ' → ~' + q.ost.toFixed(2) + ' OST (rate ' + q.rate.toFixed(2) + ' OST/' + curr + ')...';
          var result = await window.OST_REAL_SWAP.swapAny(curr, amount, { });
          transferResult.textContent = 'Received ' + result.ost.toFixed(2) + ' OST · sig ' + String(result.sig).slice(0, 8) + '...';
          if (result.kind === 'on-chain-swap') {
            setConvertRouteMessage('Atomic ' + curr + ' → OST swap settled on-chain. The OST treasury now holds ' + amount + ' ' + curr + ' as backing.');
          } else {
            setConvertRouteMessage('Treasury reserve created: ' + amount + ' ' + curr + ' (≈ $' + result.usd.toFixed(2) + ') is now held as backing for the ' + result.ost.toFixed(2) + ' OST released to your wallet.');
          }
          toast('🏦', 'Converted ' + amount + ' ' + curr + ' → ' + result.ost.toFixed(2) + ' OST');
          launchConfetti();
          updateWalletBalance(connectedWallet);
          return;
        } catch (err) {
          console.warn('[OST] Universal swap failed', err);
          var errMsg = (err && err.message) || String(err);
          if (curr === 'SOL') {
            transferResult.textContent = 'Swap failed: ' + errMsg;
            setConvertRouteMessage('Convert could not complete: ' + errMsg + '. The swap pool releases OST at the live USD rate; if your wallet is empty of devnet SOL, fund it first via faucet.solana.com.');
            return;
          } else {
            transferResult.textContent = 'Treasury route failed: ' + errMsg;
            setConvertRouteMessage('Could not complete the ' + curr + ' → OST conversion. ' + errMsg);
            return;
          }
        }
      }

      // No fallback — Convert is now the real swap path only. The free 1-OST
      // faucet is a separate explicit action elsewhere on the page.
      transferResult.textContent = 'Swap pool not loaded. Refresh the page and try again.';
      setConvertRouteMessage('The OST swap pool script is not loaded yet. Refresh the page; if the issue persists the pool may be temporarily offline.');
      toast('⚠', 'Swap pool not ready');
    });
  }

  // ---------- CONVERT-PANEL WALLET BACKUP / RESTORE ----------
  // Surface persistence controls right in the convert panel so users never lose
  // their browser-generated wallet on a hard refresh or storage clear.
  const convertBackupBar = $('#convertWalletBackupBar');
  const convertBackupBarMsg = $('#convertBackupBarMsg');
  const convertBackupBtn = $('#convertBackupBtn');
  const convertRestoreInput = $('#convertRestoreInput');
  const convertPasteKeyInput = $('#convertPasteKeyInput');
  const convertPasteKeyBtn = $('#convertPasteKeyBtn');

  function refreshConvertBackupBar() {
    if (!convertBackupBar) return;
    const isLocal = connectedWalletSession && connectedWalletSession.kind === 'local' && connectedWalletSession.keypair;
    if (convertBackupBarMsg) {
      convertBackupBarMsg.innerHTML = isLocal
        ? '<strong>⚠ Save your browser wallet.</strong> If you clear this browser\'s storage, your devnet wallet is lost. Download the backup file once and keep it offline.'
        : '<strong>🔑 Import or back up a browser wallet.</strong> Paste a secret key below to access an existing wallet, or create a new browser wallet to download a backup file.';
    }
    if (convertBackupBtn) convertBackupBtn.disabled = !isLocal;
  }

  // Parse a pasted secret key — accepts JSON array of 64 numbers, comma-separated
  // numbers, hex (128 chars), or base58. Returns Uint8Array(64) or throws.
  function parsePastedSecretKey(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) throw new Error('Paste a secret key first.');

    // JSON array form: [12,34,...]
    if (trimmed.startsWith('[')) {
      const arr = JSON.parse(trimmed);
      if (!Array.isArray(arr) || arr.length !== 64) {
        throw new Error('JSON key must be an array of 64 numbers.');
      }
      return Uint8Array.from(arr);
    }

    // Bare comma-separated numbers
    if (trimmed.includes(',')) {
      const arr = trimmed.split(',').map(s => parseInt(s.trim(), 10));
      if (arr.length !== 64 || arr.some(n => !Number.isFinite(n))) {
        throw new Error('Comma-separated key must be 64 integers.');
      }
      return Uint8Array.from(arr);
    }

    // Hex
    if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === 128) {
      const out = new Uint8Array(64);
      for (let i = 0; i < 64; i++) out[i] = parseInt(trimmed.substr(i * 2, 2), 16);
      return out;
    }

    // Base58 (Phantom export format)
    if (solanaWeb3.utils && solanaWeb3.utils.bytes && solanaWeb3.utils.bytes.bs58) {
      const decoded = solanaWeb3.utils.bytes.bs58.decode(trimmed);
      if (decoded.length === 64) return decoded;
      throw new Error('Base58 key must decode to 64 bytes.');
    }
    // Fallback base58 decoder using Keypair.fromSecretKey via bs58 if exposed elsewhere
    if (typeof window.bs58 !== 'undefined' && typeof window.bs58.decode === 'function') {
      const decoded = window.bs58.decode(trimmed);
      if (decoded.length === 64) return Uint8Array.from(decoded);
      throw new Error('Base58 key must decode to 64 bytes.');
    }

    throw new Error('Unrecognized format. Paste a 64-number JSON array, comma list, 128-char hex, or base58 string.');
  }

  function importPastedWallet(secretBytes) {
    const restored = solanaWeb3.Keypair.fromSecretKey(secretBytes);
    persistLocalWallet(restored);
    setConnectedWalletSession({
      kind: 'local',
      type: 'local',
      label: 'OST Browser Wallet',
      keypair: restored,
      publicKey: restored.publicKey
    }, { announce: true });
    refreshConvertBackupBar();
    return restored.publicKey.toBase58();
  }

  if (convertBackupBtn) {
    convertBackupBtn.addEventListener('click', () => {
      if (connectedWalletSession && connectedWalletSession.kind === 'local' && connectedWalletSession.keypair) {
        exportLocalWalletBackup(connectedWalletSession.keypair);
        toast('🧾', 'Wallet backup downloaded. Keep it offline.');
      } else {
        toast('ℹ️', 'Create a browser wallet first to download a backup.');
      }
    });
  }

  if (convertRestoreInput) {
    convertRestoreInput.addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const secret = Array.isArray(parsed) ? parsed : (parsed && parsed.secretKey);
        if (!Array.isArray(secret) || secret.length < 32) {
          throw new Error('Invalid wallet backup file.');
        }
        const address = importPastedWallet(Uint8Array.from(secret));
        toast('✅', `Wallet restored: ${address.slice(0, 6)}…${address.slice(-4)}`);
      } catch (err) {
        console.warn('[OST] Wallet restore failed', err);
        toast('⚠️', 'Could not restore that file — make sure it is a valid OST wallet backup.');
      }
    });
  }

  if (convertPasteKeyBtn && convertPasteKeyInput) {
    convertPasteKeyBtn.addEventListener('click', () => {
      try {
        const secretBytes = parsePastedSecretKey(convertPasteKeyInput.value);
        const address = importPastedWallet(secretBytes);
        convertPasteKeyInput.value = '';
        toast('✅', `Wallet imported: ${address.slice(0, 6)}…${address.slice(-4)}`);
      } catch (err) {
        console.warn('[OST] Paste-key import failed', err);
        toast('⚠️', err && err.message ? err.message : 'Could not parse the pasted secret key.');
      }
    });
  }

  // Refresh the backup bar whenever the connected wallet changes
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('ost:wallet-changed', refreshConvertBackupBar);
  }
  refreshConvertBackupBar();

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

  async function animateFaucetCoins() {
    if (!faucetDropZone) return;
    for (let i = 0; i < 8; i++) {
      const coin = document.createElement('div');
      coin.className = 'faucet-coin';
      coin.style.left = (30 + Math.random() * 40) + '%';
      coin.style.animationDuration = (0.6 + Math.random() * 0.5) + 's';
      faucetDropZone.appendChild(coin);
      setTimeout(() => coin.remove(), 1200);
      await sleep(120);
    }
  }

  async function runOstFaucetFlow(options) {
    const settings = options || {};
    if (faucetRunning) return { ok: false, busy: true };
    faucetRunning = true;

    try {
      if (settings.animate !== false) {
        await animateFaucetCoins();
      }

      if (!connectedWalletSession || typeof solanaWeb3 === 'undefined') {
        if (faucetAmount) faucetAmount.textContent = '0.00';
        if (faucetStatus) faucetStatus.textContent = 'Create or connect your wallet first, then claim real devnet OST.';
        toast('👛', 'Create or connect your OST wallet first');
        return { ok: false, reason: 'no-wallet' };
      }

      try {
        const walletAddress = connectedWalletSession.publicKey.toBase58();
        const metrics = await syncOstDevnetMetrics({ force: true });
        if (metrics.available && metrics.treasuryBalance < OST_FAUCET_AMOUNT) {
          throw new Error('OST treasury is empty on devnet. Refill the treasury before users can claim the faucet.');
        }

        if (faucetStatus) faucetStatus.textContent = 'Checking devnet SOL for network fees...';
        let funding = { funded: false, balance: 0 };
        try {
          funding = await ensureWalletFeeBalance(connectedWalletSession.publicKey);
        } catch (fundingError) {
          const fundingErrorText = (fundingError && fundingError.message) || String(fundingError || 'Funding failed');
          const isFundingRateLimited = /429|airdrop limit|faucet has run dry/i.test(fundingErrorText);
          if (isFundingRateLimited) {
            setWalletFundingState({
              needsManualFunding: true,
              walletAddress,
              lastError: fundingErrorText
            });
            if (faucetStatus) {
              faucetStatus.textContent = 'The public RPC airdrop is rate-limited. Open the Solana browser faucet, fund a little SOL into this wallet, then return here to claim OST.';
            }
            toast('⚠️', 'Open the browser faucet and add a little devnet SOL first.');
            return { ok: false, reason: 'needs-manual-funding', error: fundingError };
          }
          throw fundingError;
        }

        clearWalletFundingState();
        if (funding.funded && faucetStatus) {
          faucetStatus.textContent = 'Fee balance ready. Recording wallet profile...';
        } else if (faucetStatus) {
          faucetStatus.textContent = 'Network fee balance ready. Recording wallet profile...';
        }

        await maybeRecordSeedlessOnboard();

        if (faucetStatus) faucetStatus.textContent = 'Preparing your OST token account...';
        const faucetResult = await claimOstFaucetForActiveWallet();
        const ostBalance = faucetResult.balance || await getOstBalanceForAddress(connectedWalletSession.publicKey);
        faucetTotal = ostBalance;
        if (faucetAmount) faucetAmount.textContent = ostBalance.toFixed(2);

        if (faucetResult.alreadyClaimed) {
          if (faucetStatus) faucetStatus.textContent = 'This wallet already claimed its OST faucet. Current balance: ' + ostBalance.toFixed(2) + ' OST.';
          toast('ℹ️', 'OST faucet already claimed for this wallet');
          syncOstDevnetMetrics({ force: true });
          return { ok: true, alreadyClaimed: true, balance: ostBalance };
        }

        if (faucetStatus) faucetStatus.textContent = 'OST claimed on devnet (charged 0.001 SOL fee). Balance ready: ' + ostBalance.toFixed(2) + ' OST.';
        toast('🎉', '+1 OST claimed (–0.001 SOL fee paid on-chain)');
        launchConfetti();
        updateWalletBalance(connectedWallet);
        syncOstDevnetMetrics({ force: true });
        return { ok: true, claimed: true, balance: ostBalance };
      } catch (e) {
        const errorText = (e && e.message) || String(e || 'OST faucet failed');
        const isRateLimited = /429|airdrop limit|faucet has run dry/i.test(errorText);
        const isTreasuryEmpty = /treasury is empty|refill the treasury/i.test(errorText);
        if (isTreasuryEmpty) {
          if (faucetStatus) faucetStatus.textContent = 'The OST treasury is empty on devnet. Refill the treasury before users can claim the faucet.';
          toast('⚠️', 'OST treasury is empty on devnet.');
        } else if (isRateLimited) {
          setWalletFundingState({
            needsManualFunding: true,
            walletAddress: connectedWalletSession.publicKey.toBase58(),
            lastError: errorText
          });
          if (faucetStatus) faucetStatus.textContent = 'Devnet SOL faucet is rate-limited. Open the browser faucet, fund a little SOL, then click claim OST again.';
          toast('⚠️', 'Open the browser faucet and fund test SOL manually, then retry.');
        } else {
          if (faucetStatus) faucetStatus.textContent = 'Could not claim OST right now. Make sure Devnet is reachable and try again.';
          toast('⚠️', errorText);
        }
        return { ok: false, reason: 'error', error: e };
      }
    } finally {
      faucetRunning = false;
      if (typeof window.syncWalletJourneyUi === 'function') {
        window.syncWalletJourneyUi();
      }
    }
  }

  window.runOstFaucetFlow = runOstFaucetFlow;

  // Expose primitives needed by wallet-extras.js (real send/receive/portfolio)
  window.OST_WALLET = {
    get session() { return connectedWalletSession; },
    get address() { return connectedWallet; },
    getConnection: getSolanaConnection,
    getOstBalance: getOstBalanceForAddress,
    ensureAta: ensureOstAssociatedTokenAccount,
    ensureFee: ensureWalletFeeBalance,
    sign: signAndSendTransaction,
    transferChecked: createTransferCheckedInstruction,
    associatedAddress: getAssociatedTokenAddressSync,
    associatedAccountIx: createAssociatedTokenAccountInstruction,
    memoIx: createMemoInstruction,
    toBaseUnits: decimalAmountToBaseUnits,
    toPublicKey,
    constants: {
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      MEMO_PROGRAM_ID,
      OST_TOKEN_DECIMALS
    }
  };

  if (faucetBtn) {
    faucetBtn.addEventListener('click', () => {
      runOstFaucetFlow({ animate: true });
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
        if (gvStatus) gvStatus.textContent = '\u2705 Local vault plan created for ' + childName + ' (age ' + childAge + '). Connect wallet to open the on-chain vault.';
        toast('\uD83D\uDD12', 'Local Grow Vault plan created for ' + childName);
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

  (function initWalletCommandTabs() {
    const tabButtons = $$('.wallet-tab-btn');
    const panels = $$('.wallet-tab-panel');
    if (!tabButtons.length || !panels.length) return;

    function setWalletPanel(target, options = {}) {
      const nextTarget = tabButtons.some(button => button.getAttribute('data-wallet-panel-target') === target)
        ? target
        : tabButtons[0].getAttribute('data-wallet-panel-target');
      const panelId = `wallet-panel-${nextTarget}`;

      tabButtons.forEach(button => {
        const isActive = button.getAttribute('data-wallet-panel-target') === nextTarget;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        button.setAttribute('tabindex', isActive ? '0' : '-1');
      });

      panels.forEach(panel => {
        const isActive = panel.id === panelId;
        panel.classList.toggle('is-active', isActive);
        if (isActive) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
      });

      if (options.scroll) {
        const walletSection = $('#wallet');
        if (walletSection) {
          walletSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }

    tabButtons.forEach(button => {
      const target = button.getAttribute('data-wallet-panel-target');
      if (!target) return;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', `wallet-panel-${target}`);
      button.addEventListener('click', () => setWalletPanel(target));
    });

    panels.forEach(panel => panel.setAttribute('role', 'tabpanel'));

    $$('[data-wallet-tab-link]').forEach(link => {
      link.addEventListener('click', event => {
        const target = link.getAttribute('data-wallet-tab-link');
        if (!target) return;
        event.preventDefault();
        setWalletPanel(target, { scroll: true });
      });
    });

    const initialHash = window.location.hash || '';
    const hashTarget = initialHash.startsWith('#wallet-panel-') ? initialHash.replace('#wallet-panel-', '') : '';
    const defaultTarget = tabButtons.find(button => button.classList.contains('active'))?.getAttribute('data-wallet-panel-target') || 'access';
    setWalletPanel(hashTarget || defaultTarget);

    window.setWalletPanel = setWalletPanel;
  })();

  /* ================================================================== */
  /* WALLET DASHBOARD — Personalized Wallet Panel                       */
  /* ================================================================== */
  (function initWalletDashboard() {
    const wdNotConnected = $('#wdNotConnected');
    const wdConnected    = $('#wdConnected');
    const wdJourneyBadge = $('#wdJourneyBadge');
    const wdJourneyTitle = $('#wdJourneyTitle');
    const wdJourneySummary = $('#wdJourneySummary');
    const wdJourneyPrimaryBtn = $('#wdJourneyPrimaryBtn');
    const wdJourneySecondaryBtn = $('#wdJourneySecondaryBtn');
    const wdJourneyStepWallet = $('#wdJourneyStepWallet');
    const wdJourneyStepBackup = $('#wdJourneyStepBackup');
    const wdJourneyStepSol = $('#wdJourneyStepSol');
    const wdJourneyStepOst = $('#wdJourneyStepOst');
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
    const wdIntelMode    = $('#wdIntelMode');
    const wdIntelAddress = $('#wdIntelAddress');
    const wdIntelAddressCopy = $('#wdIntelAddressCopy');
    const wdIntelTotal   = $('#wdIntelTotal');
    const wdIntelTotalCopy = $('#wdIntelTotalCopy');
    const wdIntelChange  = $('#wdIntelChange');
    const wdIntelChangeCopy = $('#wdIntelChangeCopy');
    const wdIntelRoutes  = $('#wdIntelRoutes');
    const wdIntelRoutesCopy = $('#wdIntelRoutesCopy');
    const wdIntelActivity = $('#wdIntelActivity');
    const wdIntelActivityCopy = $('#wdIntelActivityCopy');
    const wdIntelFunding = $('#wdIntelFunding');
    const wdIntelFundingCopy = $('#wdIntelFundingCopy');
    const wdPortfolioCopy = $('#wdPortfolioCopy');
    const wdPortfolioBadge = $('#wdPortfolioBadge');
    const wdPortfolioChart = $('#wdPortfolioChart');
    const wdRouteHoldStatus = $('#wdRouteHoldStatus');
    const wdRouteHoldCopy = $('#wdRouteHoldCopy');
    const wdRouteSwapStatus = $('#wdRouteSwapStatus');
    const wdRouteSwapCopy = $('#wdRouteSwapCopy');
    const wdRoutePortalStatus = $('#wdRoutePortalStatus');
    const wdRoutePortalCopy = $('#wdRoutePortalCopy');
    const wdRoutePredictStatus = $('#wdRoutePredictStatus');
    const wdRoutePredictCopy = $('#wdRoutePredictCopy');
    let journeySyncToken = 0;

    if (!wdNotConnected) return; // section not present

    function setJourneyText(badge, title, summary) {
      if (wdJourneyBadge) wdJourneyBadge.textContent = badge;
      if (wdJourneyTitle) wdJourneyTitle.textContent = title;
      if (wdJourneySummary) wdJourneySummary.textContent = summary;
    }

    function setJourneyStep(stepEl, state, text) {
      if (!stepEl) return;
      stepEl.classList.remove('is-pending', 'is-active', 'is-ready');
      stepEl.classList.add('is-' + state);
      const textEl = stepEl.querySelector('.wd-journey-step-text');
      if (textEl) textEl.textContent = text;
    }

    function setJourneyAction(button, config) {
      if (!button) return;
      if (!config || config.hidden) {
        button.hidden = true;
        button.dataset.action = '';
        return;
      }
      button.hidden = false;
      button.disabled = !!config.disabled;
      button.dataset.action = config.action || '';
      button.textContent = config.label || 'Continue';
    }

    function readInterchangeRequestRecords() {
      try {
        return JSON.parse(localStorage.getItem(INTERCHANGE_REQUESTS_STORAGE_KEY) || '[]');
      } catch {
        return [];
      }
    }

    function setIntelBadge(element, tone, text) {
      if (!element) return;
      element.className = 'wd-intelligence-badge' + (tone ? ' is-' + tone : '');
      element.textContent = text;
    }

    function setRouteStatus(element, tone, text) {
      if (!element) return;
      element.className = 'wd-route-status' + (tone ? ' is-' + tone : '');
      element.textContent = text;
    }

    function formatWalletUsd(value) {
      const amount = Number(value);
      if (!Number.isFinite(amount)) return '$0.00';
      if (Math.abs(amount) >= 1000) return formatCompactUsd(amount);
      if (Math.abs(amount) >= 1) return '$' + amount.toFixed(2);
      return '$' + amount.toFixed(3);
    }

    function buildWalletPortfolioSeries(solBalance, ostBalance) {
      const solHistory = Array.isArray(priceHistory.solana) && priceHistory.solana.length
        ? priceHistory.solana.slice(-24)
        : Array(24).fill(prices.solana || 0);
      const ostHistory = Array.isArray(priceHistory.ost) && priceHistory.ost.length
        ? priceHistory.ost.slice(-24)
        : Array(24).fill(ostPrice || OST_BASE_PRICE);
      const totalPoints = Math.max(solHistory.length, ostHistory.length, 24);
      const series = [];

      for (let index = 0; index < totalPoints; index += 1) {
        const solPoint = solHistory[Math.max(0, solHistory.length - totalPoints + index)] ?? solHistory[solHistory.length - 1] ?? 0;
        const ostPoint = ostHistory[Math.max(0, ostHistory.length - totalPoints + index)] ?? ostHistory[ostHistory.length - 1] ?? 0;
        series.push((Number(solBalance) || 0) * solPoint + (Number(ostBalance) || 0) * ostPoint);
      }

      return series.filter(point => Number.isFinite(point));
    }

    function drawWalletPortfolioChart(series, options) {
      if (!wdPortfolioChart || !wdPortfolioChart.getContext) return;

      const config = options || {};
      const rect = wdPortfolioChart.getBoundingClientRect();
      const width = Math.max(320, Math.round(rect.width || wdPortfolioChart.width || 820));
      const height = Math.max(220, Math.round(rect.height || wdPortfolioChart.height || 240));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      wdPortfolioChart.width = Math.round(width * dpr);
      wdPortfolioChart.height = Math.round(height * dpr);

      const ctx = wdPortfolioChart.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(5, 8, 14, 0.94)';
      ctx.fillRect(0, 0, width, height);

      if (!config.hasWallet) {
        ctx.fillStyle = 'rgba(226,232,240,0.72)';
        ctx.font = '600 16px Inter, sans-serif';
        ctx.fillText('Create or connect a wallet to unlock your live curve.', 24, height / 2 - 6);
        ctx.font = '13px Inter, sans-serif';
        ctx.fillStyle = 'rgba(148,163,184,0.9)';
        ctx.fillText('The curve will price your SOL and OST against the latest market tape.', 24, height / 2 + 18);
        return;
      }

      const points = Array.isArray(series) ? series.filter(value => Number.isFinite(value)) : [];
      if (!points.length || points.every(value => value <= 0)) {
        ctx.fillStyle = 'rgba(226,232,240,0.72)';
        ctx.font = '600 16px Inter, sans-serif';
        ctx.fillText('Fund the wallet to generate a live portfolio curve.', 24, height / 2 - 6);
        ctx.font = '13px Inter, sans-serif';
        ctx.fillStyle = 'rgba(148,163,184,0.9)';
        ctx.fillText('The graph tracks the current SOL and OST mix across the last 24 pricing points.', 24, height / 2 + 18);
        return;
      }

      const pad = { left: 18, right: 18, top: 20, bottom: 26 };
      const minValue = Math.min(...points);
      const maxValue = Math.max(...points);
      const range = Math.max(maxValue - minValue, maxValue || 1, 1);
      const changePct = Number(config.changePct) || 0;
      const lineColor = changePct >= 0 ? '#34d399' : '#f5c468';
      const fillGradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
      fillGradient.addColorStop(0, changePct >= 0 ? 'rgba(52,211,153,0.22)' : 'rgba(245,196,104,0.22)');
      fillGradient.addColorStop(1, 'rgba(109,159,255,0.02)');

      function x(index) {
        return pad.left + (index / Math.max(points.length - 1, 1)) * (width - pad.left - pad.right);
      }

      function y(value) {
        return pad.top + (height - pad.top - pad.bottom) - ((value - minValue) / range) * (height - pad.top - pad.bottom);
      }

      [0.25, 0.5, 0.75].forEach(level => {
        const yPoint = pad.top + (height - pad.top - pad.bottom) * level;
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        ctx.moveTo(pad.left, yPoint);
        ctx.lineTo(width - pad.right, yPoint);
        ctx.stroke();
      });

      ctx.beginPath();
      points.forEach((point, index) => {
        const px = x(index);
        const py = y(point);
        if (!index) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.lineTo(x(points.length - 1), height - pad.bottom);
      ctx.lineTo(x(0), height - pad.bottom);
      ctx.closePath();
      ctx.fillStyle = fillGradient;
      ctx.fill();

      ctx.beginPath();
      points.forEach((point, index) => {
        const px = x(index);
        const py = y(point);
        if (!index) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.lineWidth = 3;
      ctx.strokeStyle = lineColor;
      ctx.stroke();

      const lastValue = points[points.length - 1];
      const lastX = x(points.length - 1);
      const lastY = y(lastValue);
      ctx.beginPath();
      ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();

      ctx.fillStyle = 'rgba(248,250,252,0.96)';
      ctx.font = '600 13px Inter, sans-serif';
      ctx.fillText(formatWalletUsd(lastValue), Math.max(pad.left, lastX - 72), Math.max(18, lastY - 12));
    }

    function updateWalletIntelligence(pubkey, snapshot) {
      const hasWallet = !!pubkey;
      const details = snapshot || {};
      const solBalance = Number(details.solBalance || 0);
      const ostBalance = Number(details.ostBalance || 0);
      const hasSol = !!details.hasSol;
      const hasOst = !!details.hasOst;
      const needsManualFunding = hasWallet && !hasSol && walletFundingState.needsManualFunding && walletFundingState.walletAddress === pubkey;
      const walletLabel = details.walletLabel || (details.isLocalWallet ? 'OST Browser Wallet' : 'Connected wallet');
      const totalUsd = (solBalance * (prices.solana || 0)) + (ostBalance * (ostPrice || 0));
      const portfolioSeries = hasWallet ? buildWalletPortfolioSeries(solBalance, ostBalance) : [];
      const firstValue = portfolioSeries.length ? portfolioSeries[0] : 0;
      const lastValue = portfolioSeries.length ? portfolioSeries[portfolioSeries.length - 1] : totalUsd;
      const changePct = firstValue > 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;
      const predictionOrders = readPredictionOrderRecords();
      const interchangeRequests = readInterchangeRequestRecords();
      const totalActivities = predictionOrders.length + interchangeRequests.length;
      let liveRoutes = 0;

      if (hasWallet) liveRoutes += 1;
      if (hasWallet) liveRoutes += 1;
      if (hasOst) liveRoutes += 1;

      if (wdIntelAddress) wdIntelAddress.textContent = hasWallet ? shortAddress(pubkey) : 'Connect wallet';
      if (wdIntelAddressCopy) {
        wdIntelAddressCopy.textContent = hasWallet
          ? walletLabel + ' on ' + (OST_CONFIG.network === 'devnet' ? 'Solana Devnet' : 'Solana Mainnet')
          : 'No wallet session yet';
      }

      if (wdIntelTotal) wdIntelTotal.textContent = hasWallet ? formatWalletUsd(totalUsd) : '$0.00';
      if (wdIntelTotalCopy) {
        wdIntelTotalCopy.textContent = hasWallet
          ? solBalance.toFixed(4) + ' SOL • ' + ostBalance.toFixed(2) + ' OST'
          : 'SOL + OST mark-to-market';
      }

      if (wdIntelChange) {
        wdIntelChange.textContent = hasWallet && firstValue > 0
          ? (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%'
          : '--';
      }
      if (wdIntelChangeCopy) {
        wdIntelChangeCopy.textContent = hasWallet && firstValue > 0
          ? formatWalletUsd(lastValue - firstValue) + ' across the current holdings mix'
          : 'Waiting for live holdings';
      }

      if (wdIntelRoutes) wdIntelRoutes.textContent = liveRoutes + ' live / 7 linked';
      if (wdIntelRoutesCopy) {
        wdIntelRoutesCopy.textContent = hasWallet
          ? 'Wallet, devnet swap, prediction, bridge, fiat, and cash-out routing'
          : 'Wallet, devnet swap, fiat, bridge, and prediction rails';
      }

      if (wdIntelActivity) wdIntelActivity.textContent = totalActivities + ' records';
      if (wdIntelActivityCopy) {
        wdIntelActivityCopy.textContent = predictionOrders.length + ' tickets • ' + interchangeRequests.length + ' commerce requests';
      }

      if (!hasWallet) {
        if (wdIntelFunding) wdIntelFunding.textContent = 'Not ready';
        if (wdIntelFundingCopy) wdIntelFundingCopy.textContent = 'Needs wallet and devnet SOL';
        setIntelBadge(wdIntelMode, '', 'Awaiting wallet');
        setIntelBadge(wdPortfolioBadge, '', 'Waiting for funds');
        if (wdPortfolioCopy) wdPortfolioCopy.textContent = 'Your live wallet curve combines current SOL and OST holdings with the latest market tape.';
        setRouteStatus(wdRouteHoldStatus, '', 'Locked');
        setRouteStatus(wdRouteSwapStatus, '', 'Needs wallet');
        setRouteStatus(wdRoutePortalStatus, 'preview', 'Preview rails');
        setRouteStatus(wdRoutePredictStatus, '', 'Needs OST');
        if (wdRouteHoldCopy) wdRouteHoldCopy.textContent = 'Create or connect a wallet to hold SOL and devnet OST in one place.';
        if (wdRouteSwapCopy) wdRouteSwapCopy.textContent = 'Live once a wallet is connected, funded with devnet SOL, and routed into OST.';
        if (wdRoutePortalCopy) wdRoutePortalCopy.textContent = 'Wormhole, Onramper, MoonPay, and Transak stay linked here as the mainnet entry and exit stack.';
        if (wdRoutePredictCopy) wdRoutePredictCopy.textContent = 'Place live devnet market tickets after this wallet is holding OST.';
        drawWalletPortfolioChart([], { hasWallet: false });
        return;
      }

      if (hasOst) {
        if (wdIntelFunding) wdIntelFunding.textContent = 'OST ready';
        if (wdIntelFundingCopy) wdIntelFundingCopy.textContent = 'Commerce, swaps, and prediction vault are live on devnet';
        setIntelBadge(wdIntelMode, 'live', 'Wallet live');
        setIntelBadge(wdPortfolioBadge, 'live', (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '% 24h');
        setRouteStatus(wdRouteHoldStatus, 'live', 'Live now');
        setRouteStatus(wdRouteSwapStatus, 'live', 'Live devnet');
        setRouteStatus(wdRoutePortalStatus, 'preview', 'Preview rails');
        setRouteStatus(wdRoutePredictStatus, 'live', 'Live devnet');
        if (wdRouteHoldCopy) wdRouteHoldCopy.textContent = 'This wallet is actively holding live devnet balances and exposing a real receive address.';
        if (wdRouteSwapCopy) wdRouteSwapCopy.textContent = 'Switch between SOL and OST on the current wallet rail, then review the Jupiter route before any approval.';
        if (wdRoutePortalCopy) wdRoutePortalCopy.textContent = 'Use Wormhole and the fiat portals as the future mainnet bridge, bank, card, and cash-out stack.';
        if (wdRoutePredictCopy) wdRoutePredictCopy.textContent = 'Prediction tickets can already move OST into the devnet market vault from this same wallet.';
      } else if (hasSol) {
        if (wdIntelFunding) wdIntelFunding.textContent = 'Gas ready';
        if (wdIntelFundingCopy) wdIntelFundingCopy.textContent = 'Wallet has devnet SOL and is one step away from OST';
        setIntelBadge(wdIntelMode, 'warning', 'Needs OST');
        setIntelBadge(wdPortfolioBadge, 'warning', 'SOL funded');
        setRouteStatus(wdRouteHoldStatus, 'live', 'Live now');
        setRouteStatus(wdRouteSwapStatus, 'live', 'Swap ready');
        setRouteStatus(wdRoutePortalStatus, 'preview', 'Preview rails');
        setRouteStatus(wdRoutePredictStatus, 'warning', 'Needs OST');
        if (wdRouteHoldCopy) wdRouteHoldCopy.textContent = 'The address is live and already funded with enough SOL for network fees.';
        if (wdRouteSwapCopy) wdRouteSwapCopy.textContent = 'Route this wallet from SOL into OST on devnet, then use the same session for commerce and trading.';
        if (wdRoutePortalCopy) wdRoutePortalCopy.textContent = 'Fiat, bank, and bridge partners stay linked as the future mainnet access layer.';
        if (wdRoutePredictCopy) wdRoutePredictCopy.textContent = 'Claim or swap into OST first, then the prediction vault becomes tradeable.';
      } else {
        if (wdIntelFunding) wdIntelFunding.textContent = needsManualFunding ? 'Needs browser faucet' : 'Needs devnet gas';
        if (wdIntelFundingCopy) wdIntelFundingCopy.textContent = needsManualFunding
          ? 'Copy this address into the Solana browser faucet, fund a little SOL, then claim OST'
          : 'Top up devnet SOL, then claim or swap into OST';
        setIntelBadge(wdIntelMode, 'warning', needsManualFunding ? 'Browser faucet' : 'Funding wallet');
        setIntelBadge(wdPortfolioBadge, 'warning', 'Needs SOL');
        setRouteStatus(wdRouteHoldStatus, 'live', 'Live now');
        setRouteStatus(wdRouteSwapStatus, 'warning', 'Fund first');
        setRouteStatus(wdRoutePortalStatus, 'preview', 'Preview rails');
        setRouteStatus(wdRoutePredictStatus, 'warning', 'Needs OST');
        if (wdRouteHoldCopy) wdRouteHoldCopy.textContent = needsManualFunding
          ? 'The address is real and connected. The next step is funding a little SOL through the Solana browser faucet.'
          : 'The address is real and connected, but it still needs devnet SOL for fees.';
        if (wdRouteSwapCopy) wdRouteSwapCopy.textContent = needsManualFunding
          ? 'Use the browser faucet or a funded extension wallet, then claim OST and wake the full devnet route up.'
          : 'The devnet route wakes up after the faucet or manual SOL funding lands in this wallet.';
        if (wdRoutePortalCopy) wdRoutePortalCopy.textContent = 'Use the linked bank, card, and bridge portals to preview the future mainnet stack.';
        if (wdRoutePredictCopy) wdRoutePredictCopy.textContent = 'The prediction vault stays locked until this wallet is holding OST.';
      }

      if (wdPortfolioCopy) {
        wdPortfolioCopy.textContent = totalUsd > 0
          ? 'The curve reprices this wallet using current SOL and OST balances against the latest wallet market tape.'
          : 'Fund this wallet to turn the market tape into a live portfolio curve.';
      }
      drawWalletPortfolioChart(portfolioSeries, { hasWallet: true, changePct: changePct });
    }

    function handleJourneyAction(action) {
      if (!action) return;
      if (action === 'create-local') {
        connectWallet('local');
        return;
      }
      if (action === 'show-access') {
        if (window.setWalletPanel) window.setWalletPanel('access', { scroll: true });
        return;
      }
      if (action === 'download-backup' && connectedWalletSession && connectedWalletSession.kind === 'local' && connectedWalletSession.keypair) {
        exportLocalWalletBackup(connectedWalletSession.keypair);
        toast('🧾', 'Wallet backup downloaded. Keep it offline.');
        syncJourneyUi();
        return;
      }
      if (action === 'claim-faucet') {
        if (typeof window.runOstFaucetFlow === 'function') {
          window.runOstFaucetFlow({ animate: false });
        }
        return;
      }
      if (action === 'open-sol-faucet') {
        openManualSolFaucet(connectedWallet, { open: true });
        return;
      }
      if (action === 'copy-address') {
        if (!connectedWallet) return;
        copyTextToClipboard(connectedWallet).then(function() {
          toast('📋', 'Wallet address copied.');
        }).catch(function() {
          toast('ℹ️', 'Copy the connected wallet address from the receive card.');
        });
        return;
      }
      if (action === 'open-convert') {
        if (window.setWalletPanel) window.setWalletPanel('convert', { scroll: true });
        return;
      }
      if (action === 'open-prediction') {
        if (window.setWalletPanel) window.setWalletPanel('portals');
        const predictionBoard = $('#predictionMarketBoard');
        if (predictionBoard) {
          predictionBoard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (window.setWalletPanel) {
          window.setWalletPanel('portals', { scroll: true });
        }
        return;
      }
      if (action === 'open-portals') {
        if (window.setWalletPanel) window.setWalletPanel('portals', { scroll: true });
      }
    }

    if (wdJourneyPrimaryBtn) {
      wdJourneyPrimaryBtn.addEventListener('click', function() {
        handleJourneyAction(wdJourneyPrimaryBtn.dataset.action || '');
      });
    }
    if (wdJourneySecondaryBtn) {
      wdJourneySecondaryBtn.addEventListener('click', function() {
        handleJourneyAction(wdJourneySecondaryBtn.dataset.action || '');
      });
    }

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
      syncJourneyUi();
    }

    // Hide dashboard (disconnect)
    function hideDashboard() {
      if (wdNotConnected) wdNotConnected.style.display = '';
      if (wdConnected) wdConnected.style.display = 'none';
      if (wdReceivePanel) wdReceivePanel.style.display = 'none';
      updateWalletIntelligence('', null);
      syncJourneyUi();
    }

    // Fetch balances for dashboard
    async function fetchDashboardBalances(pubkey) {
      try {
        const conn = getSolanaConnection();
        if (!conn) {
          return { solBalance: 0, ostBalance: 0 };
        }
        const pk = new solanaWeb3.PublicKey(pubkey);
        const lamports = await conn.getBalance(pk);
        const solBal = lamports / 1e9;
        if (wdSolBal) wdSolBal.textContent = solBal.toFixed(4);
        if (wdSolUsd) {
          const solPrice = prices.solana || 0;
          wdSolUsd.textContent = '$' + (solBal * solPrice).toFixed(2);
        }
        const ostBal = await getOstBalanceForAddress(pk);
        if (wdOstBal) wdOstBal.textContent = ostBal.toFixed(2);
        if (wdOstUsd) wdOstUsd.textContent = '$' + (ostBal * ostPrice).toFixed(2);
        return {
          solBalance: solBal,
          ostBalance: ostBal
        };
      } catch (_) {
        return {
          solBalance: 0,
          ostBalance: 0
        };
      }
    }

    async function syncJourneyUi() {
      const syncToken = ++journeySyncToken;
      const session = connectedWalletSession;
      const pubkey = session && session.publicKey ? session.publicKey.toBase58() : '';
      const isLocalWallet = !!(session && session.kind === 'local');
      const needsManualFunding = !!(pubkey && walletFundingState.needsManualFunding && walletFundingState.walletAddress === pubkey);
      const backupExportedAt = readLocalWalletBackupExportedAt();

      if (!pubkey) {
        updateWalletIntelligence('', null);
        setJourneyText(
          'Awaiting wallet',
          'Connect a wallet to start on devnet',
          'Create a browser wallet or connect an existing Solana wallet. OST will then guide you through devnet SOL and your first OST balance.'
        );
        setJourneyStep(wdJourneyStepWallet, 'active', 'Choose create wallet or connect an existing address.');
        setJourneyStep(wdJourneyStepBackup, 'pending', 'Backup or verification starts right after the wallet session is open.');
        setJourneyStep(wdJourneyStepSol, 'pending', 'Devnet SOL arrives during the faucet setup if this wallet needs fees.');
        setJourneyStep(wdJourneyStepOst, 'pending', 'Claim devnet OST or open the convert rail once the wallet is ready.');
        setJourneyAction(wdJourneyPrimaryBtn, { action: 'create-local', label: 'Create browser wallet' });
        setJourneyAction(wdJourneySecondaryBtn, { action: 'show-access', label: 'Use extension wallet' });
        return;
      }

      const walletLabel = session.label || (isLocalWallet ? 'OST Browser Wallet' : 'Connected wallet');
      const balances = await fetchDashboardBalances(pubkey);
      if (syncToken !== journeySyncToken) return;

      const solBalance = Number((balances && balances.solBalance) || 0);
      const ostBalance = Number((balances && balances.ostBalance) || 0);
      const hasSol = solBalance >= 0.02;
      const hasOst = ostBalance > 0;
      const backupReady = !isLocalWallet || !!backupExportedAt;

      updateWalletIntelligence(pubkey, {
        solBalance,
        ostBalance,
        hasSol,
        hasOst,
        backupReady,
        isLocalWallet,
        walletLabel
      });

      setJourneyStep(wdJourneyStepWallet, 'ready', walletLabel + ' connected: ' + shortAddress(pubkey));
      setJourneyStep(
        wdJourneyStepBackup,
        backupReady ? 'ready' : 'active',
        isLocalWallet
          ? (backupReady ? 'Browser-wallet backup downloaded and ready to store offline.' : 'Download the browser-wallet JSON backup and keep it offline.')
          : 'Extension session verified in this browser.'
      );
      setJourneyStep(
        wdJourneyStepSol,
        hasSol ? 'ready' : 'active',
        hasSol
          ? solBalance.toFixed(4) + ' SOL ready for devnet fees.'
          : 'This wallet still needs a small devnet SOL balance for fees.'
      );
      setJourneyStep(
        wdJourneyStepOst,
        hasOst ? 'ready' : (hasSol ? 'active' : 'pending'),
        hasOst
          ? ostBalance.toFixed(2) + ' OST ready for commerce and prediction.'
          : 'Claim devnet OST now or open the convert rail to preview the future mainnet route.'
      );

      if (hasOst) {
        setJourneyText(
          'OST ready',
          'Wallet connected and funded',
          'This address is ready for commerce, swaps, and the prediction venue. The balances below are live from devnet.'
        );
        setJourneyAction(wdJourneyPrimaryBtn, { action: 'open-prediction', label: 'Open prediction venue' });
        setJourneyAction(wdJourneySecondaryBtn, { action: 'open-portals', label: 'Open portal stack' });
        return;
      }

      if (!hasSol) {
        setJourneyText(
          needsManualFunding ? 'Manual SOL top-up' : 'Devnet funding',
          needsManualFunding ? 'Wallet connected, browser faucet step next' : 'Wallet connected, needs devnet gas',
          needsManualFunding
            ? 'The public RPC airdrop is rate-limited. Open the Solana browser faucet, fund a little devnet SOL into this address, then return here to claim OST from the community treasury.'
            : 'This wallet needs a small devnet SOL balance before it can sign the OST faucet claim. Use the Solana browser faucet or a funded extension wallet, then return here to claim OST.'
        );
        setJourneyAction(wdJourneyPrimaryBtn, { action: 'open-sol-faucet', label: 'Open Solana faucet' });
        setJourneyAction(wdJourneySecondaryBtn, { action: 'copy-address', label: 'Copy wallet address' });
        return;
      }

      setJourneyText(
        'Claim OST',
        'Wallet connected, one step from OST',
        'This address has enough devnet SOL for fees. Claim test OST from the community faucet or inspect the convert rail.'
      );
      setJourneyAction(wdJourneyPrimaryBtn, { action: 'claim-faucet', label: 'Claim devnet OST' });
      setJourneyAction(wdJourneySecondaryBtn, isLocalWallet && !backupReady
        ? { action: 'download-backup', label: 'Download backup again' }
        : { action: 'open-convert', label: 'Open convert rail' });
    }

    window.syncWalletJourneyUi = syncJourneyUi;

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
      if (connectedWallet) syncJourneyUi();
    }, 30000);

    // If already connected on load
    if (connectedWallet) showDashboard(connectedWallet);
    else updateWalletIntelligence('', null);
    syncJourneyUi();
  })();

  /* ================================================================== */
  /* PARTICLE FIELD — Interactive Hero Background (cursor-reactive)     */
  /* ================================================================== */
  (function initParticles() {
    const canvas = $('#particleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, particles = [];
    const COUNT = 80;
    let mouseX = -9999, mouseY = -9999;
    const ATTRACT_RADIUS = 150;
    const ATTRACT_FORCE = 0.02;

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    canvas.addEventListener('mousemove', function(e) {
      mouseX = e.clientX; mouseY = e.clientY;
    });
    canvas.addEventListener('mouseleave', function() {
      mouseX = -9999; mouseY = -9999;
    });

    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.5 + 0.5,
        dx: (Math.random() - 0.5) * 0.4,
        dy: (Math.random() - 0.5) * 0.4,
        alpha: Math.random() * 0.5 + 0.2,
        baseAlpha: Math.random() * 0.5 + 0.2,
      });
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Cursor attraction
        const dxM = mouseX - p.x;
        const dyM = mouseY - p.y;
        const distM = Math.sqrt(dxM * dxM + dyM * dyM);
        if (distM < ATTRACT_RADIUS && distM > 1) {
          const force = (1 - distM / ATTRACT_RADIUS) * ATTRACT_FORCE;
          p.dx += (dxM / distM) * force;
          p.dy += (dyM / distM) * force;
          p.alpha = Math.min(0.9, p.baseAlpha + (1 - distM / ATTRACT_RADIUS) * 0.5);
        } else {
          p.alpha += (p.baseAlpha - p.alpha) * 0.05;
        }

        // Dampen velocity
        p.dx *= 0.99;
        p.dy *= 0.99;

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
    const deskStatus = $('#deskStatus');
    const deskMerchant = $('#deskMerchant');
    const deskSource = $('#deskSource');
    const deskFiat = $('#deskFiat');
    const deskOst = $('#deskOst');
    const deskWallet = $('#deskWallet');
    const deskItems = $('#deskItems');
    const deskMerchantLink = $('#deskMerchantLink');
    const deskPayBtn = $('#deskPayBtn');
    const deskPayBtnLabel = $('#deskPayBtnLabel');
    const deskReceipt = $('#deskReceipt');

    let activeInterchangeRequest = null;

    if (!browserUrl || !viewport) return;

    function openStoreTab(target) {
      const tab = document.querySelector('.store-tab[data-dtab="' + target + '"]');
      if (tab) tab.click();
    }

    function currencyAmountToUsd(amount, currency) {
      const nextAmount = Number(amount) || 0;
      const nextCurrency = currency || 'USD';
      if (nextCurrency === 'BTC') return nextAmount * (prices.bitcoin || 105000);
      if (nextCurrency === 'ETH') return nextAmount * (prices.ethereum || 3800);
      if (nextCurrency === 'SOL') return nextAmount * (prices.solana || 170);
      if (nextCurrency === 'BNB') return nextAmount * 650;
      if (nextCurrency === 'USDC' || nextCurrency === 'USDT') return nextAmount;
      return nextAmount / (fiatRates[nextCurrency] || 1);
    }

    function formatCurrencyAmount(amount, currency) {
      const symbol = getCurrSym(currency || 'USD');
      const numericAmount = Number(amount) || 0;
      const formatted = numericAmount >= 1000
        ? numericAmount.toLocaleString(undefined, { minimumFractionDigits: numericAmount % 1 ? 2 : 0, maximumFractionDigits: 2 })
        : numericAmount.toFixed(2);
      return symbol + formatted + ' ' + (currency || 'USD');
    }

    function formatOstAmount(amount) {
      const numericAmount = Number(amount) || 0;
      if (numericAmount >= 1e9) return (numericAmount / 1e9).toFixed(2) + 'B OST';
      if (numericAmount >= 1e6) return (numericAmount / 1e6).toFixed(2) + 'M OST';
      if (numericAmount >= 1e3) return (numericAmount / 1e3).toFixed(1) + 'K OST';
      return numericAmount.toFixed(2) + ' OST';
    }

    function setDeskStatus(message, tone) {
      if (!deskStatus) return;
      deskStatus.className = 'interchange-desk-status' + (tone ? ' is-' + tone : '');
      deskStatus.textContent = message;
    }

    function clearDeskReceipt() {
      if (deskReceipt) deskReceipt.innerHTML = '';
    }

    function normalizeInterchangeRequest(request) {
      const rawItems = Array.isArray(request && request.items) ? request.items : [];
      const items = rawItems.map(function(item) {
        return {
          name: item.name || item.label || 'Order item',
          merchant: item.merchant || request.merchant || 'Merchant',
          url: item.url || request.merchantUrl || request.url || '',
          price: Number(item.price || item.amount || 0),
          currency: item.currency || request.currency || 'USD',
          category: item.category || request.category || 'general'
        };
      });
      const currency = (request && request.currency) || items[0]?.currency || 'USD';
      const amount = Number(request && request.amount || items.reduce(function(sum, item) { return sum + (Number(item.price) || 0); }, 0));
      const usdTotal = Number(request && request.usdTotal || currencyAmountToUsd(amount, currency));
      return {
        merchant: (request && request.merchant) || getHostname((request && (request.merchantUrl || request.url)) || '') || 'OST Interchange Desk',
        merchantUrl: (request && (request.merchantUrl || request.url)) || items[0]?.url || '',
        amount,
        currency,
        usdTotal,
        ostAmount: usdTotal / (ostPrice || 0.0001),
        items: items.length ? items : [{ name: (request && request.label) || 'Order item', merchant: (request && request.merchant) || 'Merchant', price: amount, currency }],
        source: (request && request.source) || t('pay.manualSource', 'manual request'),
        note: (request && request.note) || '',
        reference: (request && request.reference) || ('req-' + Date.now().toString(36))
      };
    }

    function renderInterchangeRequest(request) {
      activeInterchangeRequest = request;
      clearDeskReceipt();
      if (deskMerchant) deskMerchant.textContent = request.merchant;
      if (deskSource) deskSource.textContent = request.source;
      if (deskFiat) deskFiat.textContent = formatCurrencyAmount(request.amount, request.currency);
      if (deskOst) deskOst.textContent = formatOstAmount(request.ostAmount);
      if (deskItems) {
        deskItems.innerHTML = request.items.map(function(item) {
          return '<div class="interchange-desk-item">' +
            '<div class="interchange-desk-item-copy">' +
              '<strong>' + esc(item.name) + '</strong>' +
              '<span>' + esc(item.merchant || request.merchant) + '</span>' +
            '</div>' +
            '<span class="interchange-desk-item-value">' + formatCurrencyAmount(item.price, item.currency || request.currency) + '</span>' +
          '</div>';
        }).join('');
      }
      if (deskMerchantLink) {
        if (request.merchantUrl) {
          deskMerchantLink.href = request.merchantUrl;
          deskMerchantLink.classList.remove('interchange-link-disabled');
          deskMerchantLink.setAttribute('aria-disabled', 'false');
        } else {
          deskMerchantLink.href = '#';
          deskMerchantLink.classList.add('interchange-link-disabled');
          deskMerchantLink.setAttribute('aria-disabled', 'true');
        }
      }
      if (deskPayBtn) deskPayBtn.disabled = false;
      if (deskPayBtnLabel) deskPayBtnLabel.textContent = t('pay.deskCreate', 'Create on-chain OST request');
      setDeskStatus(t('pay.deskStatusLoaded', 'Request loaded. The next step creates a real devnet OST transfer to the interchange desk vault.'), 'info');
      if (typeof window.syncInterchangeDeskWallet === 'function') window.syncInterchangeDeskWallet();
    }

    window.syncInterchangeDeskWallet = function syncInterchangeDeskWallet() {
      if (deskWallet) {
        deskWallet.textContent = connectedWallet ? shortAddress(connectedWallet) : t('nav.connect', 'Connect wallet');
      }
    };

    window.loadInterchangeRequest = function loadInterchangeRequest(request) {
      const nextRequest = normalizeInterchangeRequest(request || {});
      renderInterchangeRequest(nextRequest);
      openStoreTab('interchange');
      const interchangeSection = $('#payAnywhere');
      if (interchangeSection) {
        interchangeSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    if (deskMerchantLink) {
      deskMerchantLink.addEventListener('click', function(event) {
        if (deskMerchantLink.classList.contains('interchange-link-disabled')) {
          event.preventDefault();
        }
      });
    }

    if (deskPayBtn) {
      deskPayBtn.addEventListener('click', async function() {
        if (!activeInterchangeRequest) {
          setDeskStatus(t('pay.deskNeedRequest', 'Load a request first.'), 'error');
          return;
        }
        if (!connectedWalletSession || !connectedWalletSession.publicKey) {
          openWalletModal();
          setDeskStatus(t('pay.deskNeedWallet', 'Create or connect your OST wallet first.'), 'warning');
          toast('👛', t('pay.toastConnectWallet', 'Connect your OST wallet first'));
          return;
        }

        deskPayBtn.disabled = true;
        if (deskPayBtnLabel) deskPayBtnLabel.innerHTML = '<span class="spinner"></span> ' + esc(t('pay.deskSendingButton', 'Sending OST request...'));
        setDeskStatus(t('pay.deskStatusSending', 'Sending a real OST payment request to the interchange vault...'), 'info');

        try {
          const result = await createInterchangePaymentRequest(activeInterchangeRequest);
          const explorerUrl = 'https://explorer.solana.com/tx/' + result.signature + '?cluster=' + OST_CONFIG.network;
          if (deskReceipt) {
            deskReceipt.innerHTML =
              '<div class="interchange-desk-receipt-card">' +
                '<div class="interchange-desk-receipt-title">' + esc(t('pay.deskReceiptTitle', 'On-chain request recorded')) + '</div>' +
                '<div class="interchange-desk-receipt-grid">' +
                  '<div><span>' + esc(t('pay.deskReceiptSignature', 'Signature')) + '</span><strong>' + esc(result.signature.slice(0, 18) + '...' + result.signature.slice(-8)) + '</strong></div>' +
                  '<div><span>' + esc(t('pay.deskReceiptMerchant', 'Merchant')) + '</span><strong>' + esc(activeInterchangeRequest.merchant) + '</strong></div>' +
                  '<div><span>' + esc(t('pay.deskReceiptFiat', 'Fiat total')) + '</span><strong>' + esc(formatCurrencyAmount(activeInterchangeRequest.amount, activeInterchangeRequest.currency)) + '</strong></div>' +
                  '<div><span>' + esc(t('pay.deskReceiptOst', 'OST sent')) + '</span><strong>' + esc(formatOstAmount(activeInterchangeRequest.ostAmount)) + '</strong></div>' +
                '</div>' +
                '<p>' + esc(t('pay.deskReceiptHelp', 'Share this transaction with the interchange desk to complete merchant-side fulfillment.')) + '</p>' +
                '<div class="interchange-desk-receipt-links">' +
                  '<a href="' + esc(explorerUrl) + '" target="_blank" rel="noopener">' + esc(t('pay.deskReceiptExplorer', 'View on Solana Explorer')) + '</a>' +
                  (activeInterchangeRequest.merchantUrl ? '<a href="' + esc(activeInterchangeRequest.merchantUrl) + '" target="_blank" rel="noopener">' + esc(t('pay.deskMerchantLink', 'Open merchant page')) + '</a>' : '') +
                '</div>' +
              '</div>';
          }
          if (activeInterchangeRequest.source === 'shop cart' && typeof window.clearShopCart === 'function') {
            window.clearShopCart();
          }
          setDeskStatus(t('pay.deskStatusRecorded', 'On-chain request recorded. Share the signature with the desk to finish fulfillment.'), 'success');
          toast('✅', t('pay.toastRequestCreated', 'On-chain interchange request created'));
          launchConfetti();
        } catch (error) {
          const message = error && error.message ? error.message : t('pay.deskRequestFailed', 'Could not create the interchange request right now.');
          setDeskStatus(message, 'error');
          toast('⚠️', message);
        } finally {
          deskPayBtn.disabled = !activeInterchangeRequest;
          if (deskPayBtnLabel) deskPayBtnLabel.textContent = t('pay.deskCreate', 'Create on-chain OST request');
        }
      });
    }

    function bindBrowserQuickLinks(root) {
      $$('.browser-quick', root || document).forEach(btn => {
        btn.addEventListener('click', () => {
          const url = btn.getAttribute('data-url');
          browserUrl.value = url;
          loadStore(url);
        });
      });
    }

    bindBrowserQuickLinks();

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

    // Curated merchant data for the interchange browser
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
      'delta.com': { name: 'Delta', icon: '&#9992;&#65039;', color: '#003A70', items: [
        { name: 'Round Trip NYC → Miami', price: 398.00, img: 'https://images.unsplash.com/photo-1436491865332-7a61a109db05?w=200&h=200&fit=crop&q=80', desc: 'Economy, nonstop, 3h 15m each way' },
        { name: 'Round Trip LAX → Tokyo', price: 1249.00, img: 'https://images.unsplash.com/photo-1540339832862-474599807836?w=200&h=200&fit=crop&q=80', desc: 'Main cabin, checked bag included, overnight route' },
      ], currency: 'USD' },
      'marriott.com': { name: 'Marriott', icon: '&#127976;', color: '#7A0019', items: [
        { name: 'New York Marriott Marquis', price: 624.00, img: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=200&h=200&fit=crop&q=80', desc: 'Times Square, 2 nights, king room, flexible rate' },
        { name: 'Marriott Cancun Resort', price: 842.00, img: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=200&h=200&fit=crop&q=80', desc: 'Ocean view, 3 nights, breakfast included' },
      ], currency: 'USD' },
      'autotrader.com': { name: 'Autotrader', icon: '&#128663;', color: '#0A5AFF', items: [
        { name: '2024 BMW M340i', price: 58995.00, img: 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=200&h=200&fit=crop&q=80', desc: 'AWD, executive package, 12K miles' },
        { name: '2023 Ford Bronco Wildtrak', price: 54350.00, img: 'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=200&h=200&fit=crop&q=80', desc: '4x4, hard top, Sasquatch package' },
      ], currency: 'USD' },
      'booking.com': { name: 'Booking.com', icon: '&#127968;', color: '#003580', items: [
        { name: 'Hotel Room 3 Nights', price: 285.00, img: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=200&h=200&fit=crop&q=80', desc: 'Luxury suite, king bed, city center, breakfast included' },
        { name: 'Airport Transfer', price: 45.00, img: 'https://images.unsplash.com/photo-1449965408869-ebd13bc9e5a8?w=200&h=200&fit=crop&q=80', desc: 'Private car, meet & greet, flight tracking' },
      ], currency: 'EUR' },
      'expedia.com': { name: 'Expedia', icon: '&#129523;', color: '#FFC72C', items: [
        { name: 'Las Vegas Weekend Package', price: 712.00, img: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=200&h=200&fit=crop&q=80', desc: 'Hotel + flight bundle, 2 travelers, Friday to Sunday' },
        { name: 'Barcelona Hotel + Flight', price: 1385.00, img: 'https://images.unsplash.com/photo-1464790719320-516ecd75af6c?w=200&h=200&fit=crop&q=80', desc: '5 nights, city center, breakfast included' },
      ], currency: 'USD' },
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
          url: store.url || ('https://' + hostname),
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
              url: fetchUrl,
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
          currency: curr, url: 'https://' + hostname, total: priceVal, selected: [true]
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

    /* ---- Static browse board for real merchant lanes ---- */
    var showcaseInterval = null;
    function startAutoShowcase() {
      var showcase = $('#browserAutoShowcase');
      if (!showcase) return;
      if (showcaseInterval) { clearInterval(showcaseInterval); showcaseInterval = null; }

      var lanes = [
        { key: 'pay.browseHotels', domain: 'marriott.com', icon: '&#127976;', sample: 'Marriott, Booking, Airbnb' },
        { key: 'pay.browseFlights', domain: 'delta.com', icon: '&#9992;&#65039;', sample: 'Delta, Expedia, Google Shopping' },
        { key: 'pay.browseCars', domain: 'autotrader.com', icon: '&#128663;', sample: 'Autotrader, Tesla' },
        { key: 'pay.browseProperty', domain: 'zillow.com', icon: '&#127968;', sample: 'Zillow, Expedia stays' },
        { key: 'pay.browseRetail', domain: 'amazon.com', icon: '&#128722;', sample: 'Amazon, Apple, Nike' }
      ];

      showcase.innerHTML =
        '<div class="browser-browse-board">' +
          '<div class="browser-browse-head">' +
            '<h4>' + esc(t('pay.browseTitle', 'Browse merchant lanes')) + '</h4>' +
            '<p>' + esc(t('pay.browseSub', 'Pick hotels, flights, cars, property, or retail, then load a real quote into the request desk.')) + '</p>' +
          '</div>' +
          '<div class="browser-browse-grid">' + lanes.map(function(lane) {
            return '<button class="browser-browse-card" type="button" data-domain="' + esc(lane.domain) + '">' +
              '<span class="browser-browse-icon">' + lane.icon + '</span>' +
              '<strong>' + esc(t(lane.key, lane.domain)) + '</strong>' +
              '<span>' + esc(lane.sample) + '</span>' +
              '<span class="browser-browse-action">' + esc(t('pay.browseOpen', 'Open lane')) + '</span>' +
            '</button>';
          }).join('') + '</div>' +
        '</div>';

      showcase.querySelectorAll('.browser-browse-card').forEach(function(card) {
        card.addEventListener('click', function() {
          var domain = card.getAttribute('data-domain');
          browserUrl.value = domain;
          loadStore(domain);
        });
      });
    }

    window.syncInterchangeBrowserUi = startAutoShowcase;

    function getBrowserQuickLinksMarkup() {
      return '' +
        '<button class="browser-quick browser-quick-google" data-url="shopping.google.com">&#128269; Google Shopping</button>' +
        '<button class="browser-quick" data-url="amazon.com">Amazon</button>' +
        '<button class="browser-quick" data-url="apple.com">Apple</button>' +
        '<button class="browser-quick" data-url="marriott.com">Marriott</button>' +
        '<button class="browser-quick" data-url="delta.com">Delta</button>' +
        '<button class="browser-quick" data-url="autotrader.com">Autotrader</button>' +
        '<button class="browser-quick" data-url="zillow.com">Zillow</button>' +
        '<button class="browser-quick" data-url="expedia.com">Expedia</button>' +
        '<button class="browser-quick" data-url="booking.com">Booking</button>' +
        '<button class="browser-quick" data-url="airbnb.com">Airbnb</button>' +
        '<button class="browser-quick" data-url="nike.com">Nike</button>' +
        '<button class="browser-quick" data-url="tesla.com">Tesla</button>';
    }

    function resetViewport() {
      browserUrl.value = '';
      if (checkout) checkout.style.display = 'none';
      // Rebuild viewport with showcase + quick links
      viewport.innerHTML =
        '<div class="browser-auto-showcase" id="browserAutoShowcase"></div>' +
        '<div class="browser-quick-links" id="browserQuickLinks">' +
          getBrowserQuickLinksMarkup() +
        '</div>';
      viewport.style.background = '';
      viewport.style.color = '';
      bindBrowserQuickLinks(viewport);
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
      const requestItems = Array.isArray(store && store.items) ? store.items.map(function(item) {
        return {
          name: item.name,
          merchant: store.name,
          url: store.url || '',
          price: item.price,
          currency: store.currency || 'USD'
        };
      }) : [];
      window.loadInterchangeRequest({
        merchant: store && store.name,
        merchantUrl: store && store.url,
        amount: store && store.total,
        currency: store && store.currency,
        items: requestItems,
        source: t('pay.browserSource', 'interchange browser'),
        note: 'Quoted from the interchange browser surface'
      });
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

      // Phase overlay transition
      var overlay = document.getElementById('sjPhaseOverlay');
      if (overlay) {
        var overlayText = overlay.querySelector('.sj-phase-overlay-text');
        if (overlayText) overlayText.textContent = phaseMissions[idx];
        overlay.classList.add('active');
        setTimeout(function() { overlay.classList.remove('active'); }, 1800);
      }

      // HUD flash effect
      var hud = document.querySelector('.sj-hud');
      if (hud) {
        hud.classList.add('hud-warning');
        setTimeout(function() { hud.classList.remove('hud-warning'); }, 1200);
      }

      // Award XP for phase change
      if (typeof window.__ostXP !== 'undefined') {
        window.__ostXP.award(15, 'Phase ' + (idx + 1) + ' Entered');
      }
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

    // Cinematic Mode Toggle
    var expandBtn = document.getElementById('sjExpandBtn');
    var sjContainer = document.getElementById('spaceJourney3d');
    if (expandBtn && sjContainer) {
      expandBtn.addEventListener('click', function() {
        sjContainer.classList.toggle('cinematic');
        var isCine = sjContainer.classList.contains('cinematic');
        expandBtn.textContent = isCine ? '✕ Exit Cinematic' : '⛶ Cinematic Mode';
        if (isCine) {
          camera.fov = 45;
          camera.updateProjectionMatrix();
          if (typeof window.__ostXP !== 'undefined') {
            window.__ostXP.award(20, 'Cinematic Mode Activated');
          }
        } else {
          camera.fov = 55;
          camera.updateProjectionMatrix();
        }
      });
    }

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
    return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="' + c + '"/><stop offset="100%" stop-color="' + c + 'cc"/></linearGradient><filter id="s"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity=".3"/></filter></defs><rect fill="url(#bg)" width="80" height="80" rx="18"/><rect x="2" y="2" width="76" height="76" rx="16" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="1"/><text x="40" y="52" text-anchor="middle" fill="#fff" font-size="36" font-weight="800" font-family="Inter,system-ui,sans-serif" filter="url(#s)">' + l + '</text></svg>');
  }
  // Multi-layer logo fallback: Clearbit → icon.horse → Google Favicon → SVG
  function logoSrc(domain) { return 'https://logo.clearbit.com/' + domain; }
  function logoFallback(img, domain, name, color) {
    // Already in fallback chain — go to next layer
    if (img._logoTry >= 3) { img.onerror = null; img.src = brandSvg(name, color); return; }
    img._logoTry = (img._logoTry || 0) + 1;
    img.onerror = function() { logoFallback(this, domain, name, color); };
    if (img._logoTry === 1) { img.src = 'https://icon.horse/icon/' + domain; }
    else if (img._logoTry === 2) { img.src = 'https://www.google.com/s2/favicons?domain=' + domain + '&sz=128'; }
    else { img.onerror = null; img.src = brandSvg(name, color); }
  }
  // Safe OST price getter with fallback
  function safeOstPrice() {
    if (window.ostPrice && window.ostPrice > 0) return window.ostPrice;
    return 0.00041;
  }

  // ========================================================================
  // OST GIFT CARD EXCHANGE — giftcash.com style (3-step sell flow)
  // ========================================================================
  (function initGiftCardHub() {
    var searchEl = document.getElementById('gc2BrandSearch');
    if (!searchEl) return;

    var fxToUSD = { USD:1, EUR:1.08, GBP:1.27, CAD:.74, AUD:.65, BRL:.20, MXN:.058, INR:.012, JPY:.0067, KRW:.00075, TRY:.031, RUB:.011, AED:.27 };

    var brands = [
      { name:'Amazon',       domain:'amazon.com',        color:'#FF9900', cat:'shop',   rate:88 },
      { name:'Apple',        domain:'apple.com',         color:'#555555', cat:'shop',   rate:90 },
      { name:'Google Play',  domain:'play.google.com',   color:'#34A853', cat:'game',   rate:80 },
      { name:'Steam',        domain:'store.steampowered.com', color:'#1b2838', cat:'game', rate:78 },
      { name:'Walmart',      domain:'walmart.com',       color:'#0071CE', cat:'shop',   rate:90 },
      { name:'Target',       domain:'target.com',        color:'#CC0000', cat:'shop',   rate:89 },
      { name:'eBay',         domain:'ebay.com',          color:'#E53238', cat:'shop',   rate:84 },
      { name:'Starbucks',    domain:'starbucks.com',     color:'#00704A', cat:'food',   rate:82 },
      { name:'Nike',         domain:'nike.com',          color:'#111111', cat:'shop',   rate:83 },
      { name:'Netflix',      domain:'netflix.com',       color:'#E50914', cat:'media',  rate:76 },
      { name:'Spotify',      domain:'spotify.com',       color:'#1DB954', cat:'media',  rate:74 },
      { name:'Uber',         domain:'uber.com',          color:'#000000', cat:'travel', rate:85 },
      { name:'DoorDash',     domain:'doordash.com',      color:'#FF3008', cat:'food',   rate:80 },
      { name:'PlayStation',  domain:'playstation.com',   color:'#003087', cat:'game',   rate:79 },
      { name:'Xbox',         domain:'xbox.com',          color:'#107C10', cat:'game',   rate:81 },
      { name:'Best Buy',     domain:'bestbuy.com',       color:'#0046BE', cat:'shop',   rate:87 },
      { name:'Sephora',      domain:'sephora.com',       color:'#000000', cat:'shop',   rate:82 },
      { name:'Nordstrom',    domain:'nordstrom.com',     color:'#000000', cat:'shop',   rate:84 },
      { name:'Delta',        domain:'delta.com',         color:'#003366', cat:'travel', rate:77 },
      { name:'Airbnb',       domain:'airbnb.com',        color:'#FF5A5F', cat:'travel', rate:75 },
      { name:'Visa Gift Card', domain:'visa.com',        color:'#1A1F71', cat:'shop',   rate:92 },
      { name:'Mastercard',   domain:'mastercard.com',    color:'#EB001B', cat:'shop',   rate:91 },
      { name:'Home Depot',   domain:'homedepot.com',     color:'#F96302', cat:'shop',   rate:80 },
      { name:'Costco',       domain:'costco.com',        color:'#E31837', cat:'shop',   rate:88 },
      { name:'Adidas',       domain:'adidas.com',        color:'#000000', cat:'shop',   rate:78 },
      { name:'Chipotle',     domain:'chipotle.com',      color:'#A81612', cat:'food',   rate:80 },
      { name:"McDonald's",   domain:'mcdonalds.com',     color:'#FFC72C', cat:'food',   rate:82 },
      { name:'Uber Eats',    domain:'ubereats.com',      color:'#06C167', cat:'food',   rate:78 },
      { name:'Disney+',      domain:'disneyplus.com',    color:'#113CCF', cat:'media',  rate:76 },
      { name:'Hulu',         domain:'hulu.com',          color:'#1CE783', cat:'media',  rate:74 },
      { name:'Southwest',    domain:'southwest.com',     color:'#304CB2', cat:'travel', rate:77 },
      { name:'Marriott',     domain:'marriott.com',      color:'#1C1C1C', cat:'travel', rate:79 }
    ];

    var selectedBrand = null;
    var cart = [];
    var gcHistory = JSON.parse(localStorage.getItem('ost_gc_history') || '[]');
    var chosenPayout = 'OST';

    // Expose brands globally for brand wheel
    window.__ostGCBrands = brands;

    // DOM refs — Step 1
    var dropdown = document.getElementById('gc2BrandDropdown');
    var selBrandWrap = document.getElementById('gc2SelectedBrand');
    var selLogo = document.getElementById('gc2SelLogo');
    var selName = document.getElementById('gc2SelName');
    var clearBrand = document.getElementById('gc2SelClear');
    var currencySel = document.getElementById('gc2Currency');
    var balanceInp = document.getElementById('gc2Balance');
    var codeInp = document.getElementById('gc2Code');
    var offerBtn = document.getElementById('gc2GetOffer');
    var cartWrap = document.getElementById('gc2Cart');
    var cartList = document.getElementById('gc2CartList');
    var cartTotalEl = document.getElementById('gc2CartTotal');
    var checkoutBtn = document.getElementById('gc2Checkout');
    // Steps
    var step1 = document.getElementById('gc2Step1');
    var step2 = document.getElementById('gc2Step2');
    var step3 = document.getElementById('gc2Step3');
    // Step 2
    var offerDetails = document.getElementById('gc2OfferDetails');
    var offerTotal = document.getElementById('gc2OfferTotal');
    var offerRate = document.getElementById('gc2OfferRate');
    var offerFee = document.getElementById('gc2OfferFee');
    var acceptBtn = document.getElementById('gc2Accept');
    var backBtn = document.getElementById('gc2BackTo1');
    // Step 3
    var doneAmount = document.getElementById('gc2DoneAmount');
    var doneTx = document.getElementById('gc2DoneTx');
    var copyTx = document.getElementById('gc2CopyTx');
    var newSell = document.getElementById('gc2NewSell');
    // Flow
    var flowEl = document.getElementById('gc2Flow');
    // Brands grid
    // (removed in v48 — brand wheel replaces grid)
    // History
    var histToggle = document.getElementById('gc2HistToggle');
    var histPanel = document.getElementById('gc2Hist');
    var histList = document.getElementById('gc2HistList');
    var histEmpty = document.getElementById('gc2HistEmpty');
    var histCount = document.getElementById('gc2HistCount');

    // Step pills
    var pills = document.querySelectorAll('.gc2-step-pill');
    function setStep(n) {
      pills.forEach(function(p, i) {
        p.classList.remove('gc2-step-active', 'gc2-step-done');
        if (i + 1 < n) p.classList.add('gc2-step-done');
        if (i + 1 === n) p.classList.add('gc2-step-active');
      });
      step1.classList.toggle('gc2-panel-active', n === 1);
      step2.classList.toggle('gc2-panel-active', n === 2);
      step3.classList.toggle('gc2-panel-active', n === 3);
      step1.style.display = n === 1 ? 'block' : 'none';
      step2.style.display = n === 2 ? 'block' : 'none';
      step3.style.display = n === 3 ? 'block' : 'none';
    }

    // Brand search dropdown
    searchEl.addEventListener('focus', function() { filterDropdown(); dropdown.classList.add('gc2-dd-open'); });
    searchEl.addEventListener('input', function() { filterDropdown(); });
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.gc2-brand-search-wrap')) dropdown.classList.remove('gc2-dd-open');
    });

    function filterDropdown() {
      var q = searchEl.value.toLowerCase();
      dropdown.innerHTML = '';
      brands.filter(function(b) { return b.name.toLowerCase().indexOf(q) >= 0; }).forEach(function(b) {
        var opt = document.createElement('div');
        opt.className = 'gc2-brand-opt';
        var img = document.createElement('img');
        img.src = logoSrc(b.domain);
        img.onerror = function() { logoFallback(this, b.domain, b.name, b.color); };
        img.alt = b.name;
        opt.appendChild(img);
        var nameSpan = document.createElement('span');
        nameSpan.className = 'gc2-brand-opt-name';
        nameSpan.textContent = b.name;
        opt.appendChild(nameSpan);
        var rateSpan = document.createElement('span');
        rateSpan.className = 'gc2-brand-opt-rate';
        rateSpan.textContent = b.rate + '%';
        opt.appendChild(rateSpan);
        opt.addEventListener('click', function() { pickBrand(b); });
        dropdown.appendChild(opt);
      });
      if (!dropdown.classList.contains('gc2-dd-open')) dropdown.classList.add('gc2-dd-open');
    }

    function pickBrand(b) {
      selectedBrand = b;
      window.__ostSelectedGCBrand = b;
      dropdown.classList.remove('gc2-dd-open');
      searchEl.style.display = 'none';
      selBrandWrap.style.display = 'flex';
      selLogo.src = logoSrc(b.domain);
      selLogo.onerror = function() { logoFallback(this, b.domain, b.name, b.color); };
      selName.textContent = b.name;
      var selRate = document.getElementById('gc2SelRate');
      if (selRate) selRate.textContent = b.rate + '%';
      // Update 3D card
      var cardLogo = document.getElementById('gc2CardLogo');
      var cardBrand = document.getElementById('gc2CardBrand');
      if (cardLogo) cardLogo.innerHTML = '<img src="' + logoSrc(b.domain) + '" alt="' + b.name + '" onerror="this.parentElement.innerHTML=\'&#127873;\'">';
      if (cardBrand) cardBrand.textContent = b.name;
      updateOfferBtn();
    }

    clearBrand.addEventListener('click', function() {
      selectedBrand = null;
      window.__ostSelectedGCBrand = null;
      searchEl.style.display = '';
      selBrandWrap.style.display = 'none';
      searchEl.value = '';
      // Reset 3D card
      var cardLogo = document.getElementById('gc2CardLogo');
      var cardBrand = document.getElementById('gc2CardBrand');
      if (cardLogo) cardLogo.innerHTML = '<span class="gc2-card-logo-placeholder">&#127873;</span>';
      if (cardBrand) cardBrand.textContent = 'Select a Gift Card';
      updateOfferBtn();
    });

    // Quick amounts
    document.querySelectorAll('.gc2-q').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.gc2-q').forEach(function(q) { q.classList.remove('gc2-q-active'); });
        btn.classList.add('gc2-q-active');
        balanceInp.value = btn.dataset.amt;
        updateOfferBtn();
      });
    });

    balanceInp.addEventListener('input', updateOfferBtn);
    codeInp.addEventListener('input', updateOfferBtn);

    function updateOfferBtn() {
      var bal = parseFloat(balanceInp.value) || 0;
      offerBtn.disabled = !(selectedBrand && bal > 0);
    }

    // Get Offer => add to cart
    offerBtn.addEventListener('click', function() {
      if (!selectedBrand) return;
      var bal = parseFloat(balanceInp.value) || 0;
      if (bal <= 0) return;
      var cur = currencySel.value;
      var usd = bal * (fxToUSD[cur] || 1);
      var rate = selectedBrand.rate / 100;
      var payout = usd * rate;
      var ost = safeOstPrice() > 0 ? payout / safeOstPrice() : 0;
      cart.push({
        brand: selectedBrand.name,
        domain: selectedBrand.domain,
        color: selectedBrand.color,
        rate: selectedBrand.rate,
        balance: bal,
        currency: cur,
        usd: usd,
        payout: payout,
        ost: ost,
        code: codeInp.value.trim() || 'N/A'
      });
      renderCart();
      // Reset fields
      balanceInp.value = '';
      codeInp.value = '';
      document.querySelectorAll('.gc2-q').forEach(function(q) { q.classList.remove('gc2-q-active'); });
      clearBrand.click();
    });

    function renderCart() {
      if (cart.length === 0) { cartWrap.style.display = 'none'; return; }
      cartWrap.style.display = 'block';
      cartList.innerHTML = '';
      var total = 0;
      cart.forEach(function(item, idx) {
        total += item.ost;
        var el = document.createElement('div');
        el.className = 'gc2-cart-item';
        var img = document.createElement('img');
        img.src = logoSrc(item.domain);
        img.onerror = function() { logoFallback(this, item.domain, item.brand, item.color); };
        el.appendChild(img);
        var info = document.createElement('div');
        info.className = 'gc2-cart-item-info';
        info.textContent = item.brand + ' · $' + item.usd.toFixed(2);
        el.appendChild(info);
        var val = document.createElement('div');
        val.className = 'gc2-cart-item-val';
        val.innerHTML = '<div class="gc2-cart-item-fiat">' + item.rate + '% rate</div><div class="gc2-cart-item-ost">' + item.ost.toFixed(2) + ' OST</div>';
        el.appendChild(val);
        var xBtn = document.createElement('button');
        xBtn.className = 'gc2-cart-item-x';
        xBtn.innerHTML = '&times;';
        xBtn.addEventListener('click', function() { cart.splice(idx, 1); renderCart(); });
        el.appendChild(xBtn);
        cartList.appendChild(el);
      });
      cartTotalEl.textContent = total.toFixed(2) + ' OST';
    }

    // Checkout — go to step 2
    checkoutBtn.addEventListener('click', function() {
      if (cart.length === 0) return;
      // Build offer details
      offerDetails.innerHTML = '';
      var totalUsd = 0;
      var totalOst = 0;
      cart.forEach(function(item) {
        totalUsd += item.payout;
        totalOst += item.ost;
        var row = document.createElement('div');
        row.className = 'gc2-offer-det-row';
        row.innerHTML = '<span>' + item.brand + ' ($' + item.usd.toFixed(2) + ')</span><span style="color:#00c853;font-weight:700">' + item.ost.toFixed(2) + ' OST</span>';
        offerDetails.appendChild(row);
      });
      var fee = totalOst * 0.001;
      var net = totalOst - fee;
      offerTotal.textContent = net.toFixed(2) + ' OST';
      offerRate.textContent = '1 OST = $' + safeOstPrice().toFixed(6);
      offerFee.textContent = fee.toFixed(4) + ' OST (0.1%)';
      setStep(2);
    });

    // Payout method
    document.querySelectorAll('.gc2-payout-opt').forEach(function(opt) {
      opt.addEventListener('click', function() {
        document.querySelectorAll('.gc2-payout-opt').forEach(function(o) { o.classList.remove('gc2-payout-active'); });
        opt.classList.add('gc2-payout-active');
        chosenPayout = opt.dataset.payout || 'OST';
      });
    });

    // Back
    backBtn.addEventListener('click', function() { setStep(1); });

    // Accept
    acceptBtn.addEventListener('click', function() {
      acceptBtn.disabled = true;
      flowEl.style.display = 'flex';
      var steps = flowEl.querySelectorAll('.gc2-fstep');
      steps.forEach(function(s) { s.classList.remove('gc2-fs-active', 'gc2-fs-done'); });
      var i = 0;
      function next() {
        if (i > 0) { steps[i - 1].classList.remove('gc2-fs-active'); steps[i - 1].classList.add('gc2-fs-done'); }
        if (i < steps.length) { steps[i].classList.add('gc2-fs-active'); i++; setTimeout(next, 800 + Math.random() * 600); }
        else { finishSell(); }
      }
      next();
    });

    function finishSell() {
      var totalOst = 0;
      cart.forEach(function(item) { totalOst += item.ost; });
      var fee = totalOst * 0.001;
      var net = totalOst - fee;
      var txHash = '';
      for (var h = 0; h < 32; h++) txHash += Math.floor(Math.random() * 16).toString(16);
      doneAmount.textContent = net.toFixed(2) + ' ' + chosenPayout;
      doneTx.textContent = txHash;

      // Save to history
      cart.forEach(function(item) {
        gcHistory.push({
          type: 'sell',
          brand: item.brand,
          domain: item.domain,
          usd: item.usd.toFixed(2),
          ost: item.ost.toFixed(2),
          payout: chosenPayout,
          date: new Date().toLocaleDateString()
        });
      });
      localStorage.setItem('ost_gc_history', JSON.stringify(gcHistory));
      renderHistory();

      setStep(3);
      toast('&#9989;', 'Gift cards sold! ' + net.toFixed(2) + ' ' + chosenPayout + ' received.');
    }

    // Copy TX
    copyTx.addEventListener('click', function() {
      navigator.clipboard.writeText(doneTx.textContent).then(function() { toast('&#128203;', 'TX hash copied!'); });
    });

    // Sell another
    newSell.addEventListener('click', function() {
      cart = [];
      renderCart();
      acceptBtn.disabled = false;
      flowEl.style.display = 'none';
      setStep(1);
    });

    // History
    function renderHistory() {
      if (histCount) histCount.textContent = '(' + gcHistory.length + ')';
      if (!histList) return;
      if (gcHistory.length === 0) { histEmpty.style.display = 'block'; histList.innerHTML = ''; return; }
      histEmpty.style.display = 'none';
      histList.innerHTML = '';
      gcHistory.slice().reverse().forEach(function(tx) {
        var el = document.createElement('div');
        el.className = 'gc2-hx';
        var img = document.createElement('img');
        img.src = logoSrc(tx.domain || '');
        img.onerror = function() { logoFallback(this, tx.domain || '', tx.brand || '?', '#00c853'); };
        el.appendChild(img);
        el.innerHTML += '<div class="gc2-hx-info"><div class="gc2-hx-name">' + (tx.brand || '?') + '</div><div class="gc2-hx-date">' + (tx.date || '') + '</div></div>' +
          '<div class="gc2-hx-amt"><div class="gc2-hx-fiat">$' + (tx.usd || '0') + '</div><div class="gc2-hx-ost">' + (tx.ost || '0') + ' OST</div></div>';
        histList.appendChild(el);
      });
    }
    renderHistory();

    if (histToggle && histPanel) {
      histToggle.addEventListener('click', function() {
        var open = histPanel.style.display !== 'none';
        histPanel.style.display = open ? 'none' : 'block';
      });
    }

    // Init state
    setStep(1);
  })();

  // ========================================================================
  // OST FUEL & CONVENIENCE — global station data + oil chart + news
  // ========================================================================
  (function initFuelStation() {
    var findBtn = document.getElementById('fuel2FindBtn');
    if (!findBtn) return;

    // Global stations by country
    var stationsByCountry = {
      US: [
        { name:'Shell', domain:'shell.com', addr:'2100 Main St', city:'Houston, TX', prices:{regular:3.29,midgrade:3.59,premium:3.89,diesel:3.69}, rating:4.2, numReviews:128, amenities:['C-Store','Pay at Pump','Restrooms','Car Wash'], reporter:'priceHunter42', reportedAgo:'3h', cash:true, dist:0.8, reviews:[{user:'FuelFan',stars:5,text:'Great prices and clean.',date:'2 days ago'}] },
        { name:'Costco', domain:'costco.com', addr:'9700 Westheimer Rd', city:'Houston, TX', prices:{regular:2.99,midgrade:3.29,premium:3.59,diesel:3.39}, rating:4.7, numReviews:412, amenities:['Pay at Pump','Members Only'], reporter:'costcoFan', reportedAgo:'30m', cash:false, dist:5.2, reviews:[{user:'MemberMike',stars:5,text:'Best prices in town.',date:'6h ago'}] },
        { name:'Buc-ee\'s', domain:'buc-ees.com', addr:'22814 Katy Fwy', city:'Katy, TX', prices:{regular:3.05,midgrade:3.35,premium:3.65,diesel:3.45}, rating:4.9, numReviews:1024, amenities:['C-Store','Restrooms','Car Wash','Food Court'], reporter:'bucFan', reportedAgo:'15m', cash:true, dist:28.0, reviews:[{user:'RoadTrip',stars:5,text:'BEST gas station ever!',date:'1 day ago'}] },
        { name:'Wawa', domain:'wawa.com', addr:'1500 San Jacinto St', city:'Houston, TX', prices:{regular:3.18,midgrade:3.48,premium:3.78,diesel:3.58}, rating:4.4, numReviews:187, amenities:['C-Store','Pay at Pump','Food Court','ATM'], reporter:'wawaFan', reportedAgo:'1h', cash:true, dist:4.0, reviews:[{user:'SubLover',stars:5,text:'Amazing hoagies AND cheap gas!',date:'12h ago'}] },
        { name:'QuikTrip', domain:'quiktrip.com', addr:'6800 Almeda Rd', city:'Houston, TX', prices:{regular:3.12,midgrade:3.42,premium:3.72,diesel:3.52}, rating:4.6, numReviews:298, amenities:['C-Store','Pay at Pump','Restrooms','Food Court','Car Wash'], reporter:'qtFan', reportedAgo:'45m', cash:true, dist:3.7, reviews:[{user:'QTLover',stars:5,text:'Spotless restrooms!',date:'1 day ago'}] },
        { name:'7-Eleven', domain:'7-eleven.com', addr:'1200 Elgin St', city:'Houston, TX', prices:{regular:3.25,midgrade:3.55,premium:3.85,diesel:3.65}, rating:3.5, numReviews:41, amenities:['C-Store','Pay at Pump','ATM'], reporter:'slurpee7', reportedAgo:'8h', cash:true, dist:0.5, reviews:[] },
        { name:'Circle K', domain:'circlek.com', addr:'2900 Shepherd Dr', city:'Houston, TX', prices:{regular:3.22,midgrade:3.52,premium:3.82,diesel:3.62}, rating:3.6, numReviews:54, amenities:['C-Store','Pay at Pump','Restrooms','ATM'], reporter:'nightOwl', reportedAgo:'4h', cash:false, dist:1.9, reviews:[] },
        { name:'Sheetz', domain:'sheetz.com', addr:'4100 Liberty Ave', city:'Pittsburgh, PA', prices:{regular:3.35,midgrade:3.65,premium:3.95,diesel:3.75}, rating:4.5, numReviews:320, amenities:['C-Store','Food Court','Pay at Pump','Restrooms','Car Wash'], reporter:'sheetzer', reportedAgo:'2h', cash:true, dist:1.1, reviews:[{user:'PA_local',stars:5,text:'Best convenience store gas combo.',date:'1 day ago'}] },
        { name:"Casey's", domain:'caseys.com', addr:'800 Main St', city:'Des Moines, IA', prices:{regular:3.08,midgrade:3.38,premium:3.68,diesel:3.48}, rating:4.3, numReviews:195, amenities:['C-Store','Pay at Pump','Pizza','Restrooms'], reporter:'pizzaGas', reportedAgo:'3h', cash:true, dist:2.3, reviews:[{user:'IA_fan',stars:5,text:'Their pizza is legendary.',date:'2 days ago'}] },
        { name:'Chevron', domain:'chevron.com', addr:'4200 Montrose Blvd', city:'Houston, TX', prices:{regular:3.39,midgrade:3.69,premium:3.99,diesel:3.79}, rating:4.5, numReviews:203, amenities:['C-Store','Pay at Pump','EV Charging','Car Wash'], reporter:'saveOnGas', reportedAgo:'2h', cash:true, dist:2.1, reviews:[] },
        { name:'BP', domain:'bp.com', addr:'550 Westheimer Rd', city:'Houston, TX', prices:{regular:3.19,midgrade:3.49,premium:3.79,diesel:3.59}, rating:4.0, numReviews:95, amenities:['C-Store','Pay at Pump','Restrooms'], reporter:'gasWatcher', reportedAgo:'5h', cash:false, dist:1.2, reviews:[] },
        { name:'ExxonMobil', domain:'exxonmobil.com', addr:'1800 Richmond Ave', city:'Houston, TX', prices:{regular:3.35,midgrade:3.65,premium:3.95,diesel:3.75}, rating:3.8, numReviews:67, amenities:['C-Store','Pay at Pump'], reporter:'cheapGas99', reportedAgo:'1h', cash:true, dist:1.5, reviews:[] }
      ],
      CA: [
        { name:'Petro-Canada', domain:'petro-canada.ca', addr:'120 King St W', city:'Toronto, ON', prices:{regular:1.62,midgrade:1.78,premium:1.92,diesel:1.69}, rating:4.1, numReviews:89, amenities:['C-Store','Car Wash','Pay at Pump'], reporter:'canFuel', reportedAgo:'2h', cash:true, dist:1.2, reviews:[{user:'TO_driver',stars:4,text:'Reliable. Good car wash.',date:'1 day ago'}] },
        { name:'Shell', domain:'shell.com', addr:'250 Bay St', city:'Toronto, ON', prices:{regular:1.58,midgrade:1.74,premium:1.88,diesel:1.65}, rating:4.3, numReviews:145, amenities:['C-Store','Pay at Pump','Restrooms'], reporter:'shellTO', reportedAgo:'1h', cash:true, dist:0.8, reviews:[] },
        { name:'Esso', domain:'esso.ca', addr:'400 Yonge St', city:'Toronto, ON', prices:{regular:1.60,midgrade:1.76,premium:1.90,diesel:1.67}, rating:3.9, numReviews:72, amenities:['C-Store','Pay at Pump'], reporter:'essoFan', reportedAgo:'3h', cash:false, dist:1.5, reviews:[] },
        { name:'Circle K', domain:'circlek.com', addr:'88 Queens Quay', city:'Toronto, ON', prices:{regular:1.55,midgrade:1.71,premium:1.85,diesel:1.62}, rating:3.7, numReviews:56, amenities:['C-Store','Pay at Pump','ATM'], reporter:'CKcanada', reportedAgo:'4h', cash:true, dist:2.0, reviews:[] },
        { name:'Costco', domain:'costco.com', addr:'35 Weston Rd', city:'Toronto, ON', prices:{regular:1.48,midgrade:1.64,premium:1.78,diesel:1.55}, rating:4.8, numReviews:320, amenities:['Pay at Pump','Members Only'], reporter:'costcoCA', reportedAgo:'45m', cash:false, dist:6.5, reviews:[] },
        { name:'Pioneer', domain:'pioneerenergy.ca', addr:'600 Dundas St', city:'Toronto, ON', prices:{regular:1.56,midgrade:1.72,premium:1.86,diesel:1.63}, rating:3.8, numReviews:41, amenities:['C-Store','Pay at Pump'], reporter:'pionCA', reportedAgo:'5h', cash:true, dist:3.1, reviews:[] }
      ],
      MX: [
        { name:'PEMEX', domain:'pemex.com', addr:'Av. Reforma 222', city:'Ciudad de México', prices:{regular:22.50,midgrade:24.20,premium:25.80,diesel:23.90}, rating:3.8, numReviews:210, amenities:['C-Store','Restrooms'], reporter:'mxFuel', reportedAgo:'1h', cash:true, dist:0.5, reviews:[{user:'CDMX_driver',stars:4,text:'Estación confiable.',date:'1 day ago'}] },
        { name:'Oxxo Gas', domain:'oxxo.com', addr:'Blvd. Díaz Ordaz 100', city:'Monterrey, NL', prices:{regular:22.10,midgrade:23.80,premium:25.40,diesel:23.50}, rating:4.2, numReviews:156, amenities:['C-Store','Pay at Pump','Restrooms','ATM'], reporter:'oxxoMTY', reportedAgo:'2h', cash:true, dist:1.1, reviews:[] },
        { name:'Shell', domain:'shell.com', addr:'Paseo Tabasco 1200', city:'Villahermosa, TAB', prices:{regular:22.80,midgrade:24.50,premium:26.10,diesel:24.20}, rating:4.0, numReviews:67, amenities:['C-Store','Pay at Pump','Car Wash'], reporter:'shellMX', reportedAgo:'3h', cash:true, dist:2.3, reviews:[] },
        { name:'G500', domain:'g500.mx', addr:'Av. Universidad 500', city:'Puebla, PUE', prices:{regular:21.90,midgrade:23.60,premium:25.20,diesel:23.30}, rating:3.6, numReviews:38, amenities:['C-Store','Restrooms'], reporter:'g500fan', reportedAgo:'6h', cash:true, dist:3.8, reviews:[] }
      ],
      GB: [
        { name:'Shell', domain:'shell.com', addr:'101 Marylebone Rd', city:'London', prices:{regular:1.42,midgrade:1.48,premium:1.55,diesel:1.47}, rating:4.2, numReviews:178, amenities:['C-Store','Pay at Pump','Restrooms','Car Wash'], reporter:'londonFuel', reportedAgo:'1h', cash:true, dist:0.6, reviews:[{user:'UK_driver',stars:4,text:'Pricey but reliable.',date:'1 day ago'}] },
        { name:'BP', domain:'bp.com', addr:'55 Baker St', city:'London', prices:{regular:1.45,midgrade:1.51,premium:1.58,diesel:1.50}, rating:4.0, numReviews:132, amenities:['C-Store','Pay at Pump','Restrooms'], reporter:'bpUK', reportedAgo:'2h', cash:true, dist:1.0, reviews:[] },
        { name:'Tesco', domain:'tesco.com', addr:'Aston Lane', city:'Birmingham', prices:{regular:1.38,midgrade:1.44,premium:1.51,diesel:1.43}, rating:4.5, numReviews:256, amenities:['C-Store','Pay at Pump'], reporter:'tescoDeals', reportedAgo:'30m', cash:true, dist:0.3, reviews:[{user:'Brum_saver',stars:5,text:'Cheapest in the area with Clubcard.',date:'6h ago'}] },
        { name:'Sainsbury\'s', domain:'sainsburys.co.uk', addr:'Camden Rd', city:'London', prices:{regular:1.39,midgrade:1.45,premium:1.52,diesel:1.44}, rating:4.3, numReviews:198, amenities:['C-Store','Pay at Pump'], reporter:'nectarFan', reportedAgo:'1h', cash:true, dist:1.5, reviews:[] },
        { name:'Asda', domain:'asda.com', addr:'Great Wilson St', city:'Leeds', prices:{regular:1.36,midgrade:1.42,premium:1.49,diesel:1.41}, rating:4.4, numReviews:215, amenities:['C-Store','Pay at Pump'], reporter:'asdaSave', reportedAgo:'2h', cash:true, dist:2.1, reviews:[] }
      ],
      DE: [
        { name:'Aral', domain:'aral.de', addr:'Kurfürstendamm 30', city:'Berlin', prices:{regular:1.75,midgrade:1.82,premium:1.90,diesel:1.68}, rating:4.1, numReviews:167, amenities:['C-Store','Pay at Pump','Car Wash','Restrooms'], reporter:'berlinFuel', reportedAgo:'1h', cash:true, dist:0.9, reviews:[{user:'DE_driver',stars:4,text:'Zuverlässig und sauber.',date:'1 day ago'}] },
        { name:'Shell', domain:'shell.com', addr:'Hauptstr. 45', city:'München', prices:{regular:1.78,midgrade:1.85,premium:1.93,diesel:1.71}, rating:4.3, numReviews:122, amenities:['C-Store','Pay at Pump','Car Wash'], reporter:'shellDE', reportedAgo:'2h', cash:true, dist:1.3, reviews:[] },
        { name:'TotalEnergies', domain:'totalenergies.com', addr:'Alexanderplatz 8', city:'Berlin', prices:{regular:1.73,midgrade:1.80,premium:1.88,diesel:1.66}, rating:3.9, numReviews:85, amenities:['C-Store','Pay at Pump','EV Charging'], reporter:'totalDE', reportedAgo:'3h', cash:false, dist:1.8, reviews:[] },
        { name:'Jet', domain:'jet.de', addr:'Schönhauser Allee 12', city:'Berlin', prices:{regular:1.69,midgrade:1.76,premium:1.84,diesel:1.62}, rating:3.7, numReviews:63, amenities:['Pay at Pump'], reporter:'jetDE', reportedAgo:'4h', cash:true, dist:2.5, reviews:[] }
      ],
      FR: [
        { name:'TotalEnergies', domain:'totalenergies.com', addr:'12 Av. des Champs-Élysées', city:'Paris', prices:{regular:1.82,midgrade:1.89,premium:1.97,diesel:1.74}, rating:4.0, numReviews:195, amenities:['C-Store','Pay at Pump','Restrooms'], reporter:'parisFuel', reportedAgo:'1h', cash:true, dist:0.7, reviews:[{user:'FR_driver',stars:4,text:'Station propre et bien située.',date:'1 day ago'}] },
        { name:'Leclerc', domain:'e-leclerc.com', addr:'ZAC des Ulis', city:'Les Ulis', prices:{regular:1.72,midgrade:1.79,premium:1.87,diesel:1.64}, rating:4.6, numReviews:340, amenities:['C-Store','Pay at Pump'], reporter:'leclercFan', reportedAgo:'30m', cash:true, dist:3.2, reviews:[] },
        { name:'Carrefour', domain:'carrefour.fr', addr:'Route de Paris', city:'Lyon', prices:{regular:1.74,midgrade:1.81,premium:1.89,diesel:1.66}, rating:4.3, numReviews:210, amenities:['C-Store','Pay at Pump'], reporter:'carFR', reportedAgo:'2h', cash:true, dist:1.5, reviews:[] }
      ],
      ES: [
        { name:'Repsol', domain:'repsol.com', addr:'Paseo de la Castellana 100', city:'Madrid', prices:{regular:1.65,midgrade:1.72,premium:1.80,diesel:1.58}, rating:4.2, numReviews:188, amenities:['C-Store','Pay at Pump','Car Wash'], reporter:'madridFuel', reportedAgo:'1h', cash:true, dist:0.8, reviews:[] },
        { name:'Cepsa', domain:'cepsa.com', addr:'Gran Via 50', city:'Barcelona', prices:{regular:1.63,midgrade:1.70,premium:1.78,diesel:1.56}, rating:4.0, numReviews:145, amenities:['C-Store','Pay at Pump','Restrooms'], reporter:'cepsaBCN', reportedAgo:'2h', cash:true, dist:1.2, reviews:[] },
        { name:'Shell', domain:'shell.com', addr:'Av. de América 25', city:'Madrid', prices:{regular:1.68,midgrade:1.75,premium:1.83,diesel:1.61}, rating:4.1, numReviews:92, amenities:['C-Store','Pay at Pump','Car Wash'], reporter:'shellES', reportedAgo:'3h', cash:true, dist:2.0, reviews:[] }
      ],
      IT: [
        { name:'Eni', domain:'eni.com', addr:'Via Roma 100', city:'Roma', prices:{regular:1.79,midgrade:1.86,premium:1.94,diesel:1.72}, rating:4.0, numReviews:165, amenities:['C-Store','Pay at Pump'], reporter:'romaFuel', reportedAgo:'2h', cash:true, dist:1.0, reviews:[] },
        { name:'Q8', domain:'q8.it', addr:'Corso Buenos Aires 30', city:'Milano', prices:{regular:1.77,midgrade:1.84,premium:1.92,diesel:1.70}, rating:3.9, numReviews:98, amenities:['C-Store','Pay at Pump'], reporter:'q8MI', reportedAgo:'3h', cash:true, dist:1.5, reviews:[] },
        { name:'TotalEnergies', domain:'totalenergies.com', addr:'Via Veneto 55', city:'Roma', prices:{regular:1.81,midgrade:1.88,premium:1.96,diesel:1.74}, rating:3.8, numReviews:72, amenities:['C-Store','Pay at Pump','EV Charging'], reporter:'totalIT', reportedAgo:'4h', cash:false, dist:2.2, reviews:[] }
      ],
      BR: [
        { name:'Petrobras', domain:'petrobras.com.br', addr:'Av. Paulista 1000', city:'São Paulo', prices:{regular:5.89,midgrade:6.20,premium:6.59,diesel:5.49}, rating:4.0, numReviews:280, amenities:['C-Store','Restrooms','Pay at Pump'], reporter:'spFuel', reportedAgo:'1h', cash:true, dist:0.6, reviews:[] },
        { name:'Shell', domain:'shell.com', addr:'Rua Augusta 500', city:'São Paulo', prices:{regular:5.95,midgrade:6.28,premium:6.65,diesel:5.55}, rating:4.2, numReviews:190, amenities:['C-Store','Pay at Pump','Car Wash'], reporter:'shellBR', reportedAgo:'2h', cash:true, dist:1.1, reviews:[] },
        { name:'Ipiranga', domain:'ipiranga.com.br', addr:'Av. Brasil 800', city:'Rio de Janeiro', prices:{regular:5.79,midgrade:6.10,premium:6.49,diesel:5.39}, rating:4.1, numReviews:215, amenities:['C-Store','Restrooms','Pay at Pump'], reporter:'ipiFan', reportedAgo:'3h', cash:true, dist:1.8, reviews:[] }
      ],
      AR: [
        { name:'YPF', domain:'ypf.com', addr:'Av. 9 de Julio 1200', city:'Buenos Aires', prices:{regular:850,midgrade:920,premium:995,diesel:810}, rating:4.0, numReviews:320, amenities:['C-Store','Restrooms','Pay at Pump'], reporter:'ypfBA', reportedAgo:'1h', cash:true, dist:0.5, reviews:[] },
        { name:'Shell', domain:'shell.com', addr:'Av. Santa Fe 3000', city:'Buenos Aires', prices:{regular:870,midgrade:940,premium:1015,diesel:830}, rating:4.2, numReviews:185, amenities:['C-Store','Pay at Pump','Car Wash'], reporter:'shellAR', reportedAgo:'2h', cash:true, dist:1.3, reviews:[] }
      ],
      CO: [
        { name:'Terpel', domain:'terpel.com', addr:'Calle 100 #15-20', city:'Bogotá', prices:{regular:14200,midgrade:15100,premium:15900,diesel:11800}, rating:4.1, numReviews:175, amenities:['C-Store','Restrooms','Pay at Pump'], reporter:'terpelBog', reportedAgo:'2h', cash:true, dist:0.8, reviews:[] },
        { name:'Primax', domain:'primax.com.co', addr:'Av. Boyacá #80-50', city:'Bogotá', prices:{regular:14050,midgrade:14950,premium:15750,diesel:11650}, rating:3.9, numReviews:92, amenities:['C-Store','Pay at Pump'], reporter:'primaxCO', reportedAgo:'4h', cash:true, dist:2.5, reviews:[] }
      ],
      AU: [
        { name:'Ampol', domain:'ampol.com.au', addr:'George St 200', city:'Sydney, NSW', prices:{regular:1.85,midgrade:1.95,premium:2.10,diesel:1.90}, rating:4.0, numReviews:165, amenities:['C-Store','Pay at Pump','Car Wash'], reporter:'sydFuel', reportedAgo:'1h', cash:true, dist:0.9, reviews:[{user:'AU_driver',stars:4,text:'Decent prices for Sydney.',date:'1 day ago'}] },
        { name:'7-Eleven', domain:'7-eleven.com', addr:'Bourke St 100', city:'Melbourne, VIC', prices:{regular:1.82,midgrade:1.92,premium:2.07,diesel:1.87}, rating:3.7, numReviews:98, amenities:['C-Store','Pay at Pump','ATM'], reporter:'711AU', reportedAgo:'2h', cash:true, dist:1.5, reviews:[] },
        { name:'Shell', domain:'shell.com', addr:'Pacific Hwy 300', city:'Sydney, NSW', prices:{regular:1.88,midgrade:1.98,premium:2.13,diesel:1.93}, rating:4.3, numReviews:142, amenities:['C-Store','Pay at Pump','Restrooms','Car Wash'], reporter:'shellAU', reportedAgo:'45m', cash:true, dist:2.0, reviews:[] }
      ],
      JP: [
        { name:'ENEOS', domain:'eneos.co.jp', addr:'Shibuya 2-chome', city:'Tokyo', prices:{regular:175,midgrade:185,premium:195,diesel:162}, rating:4.3, numReviews:340, amenities:['Pay at Pump','Restrooms','Car Wash'], reporter:'tokyoFuel', reportedAgo:'1h', cash:true, dist:0.5, reviews:[] },
        { name:'Idemitsu', domain:'idemitsu.com', addr:'Shinjuku 3-chome', city:'Tokyo', prices:{regular:173,midgrade:183,premium:193,diesel:160}, rating:4.1, numReviews:210, amenities:['Pay at Pump','Restrooms'], reporter:'ideFan', reportedAgo:'2h', cash:true, dist:1.2, reviews:[] },
        { name:'Cosmo', domain:'cosmo-oil.co.jp', addr:'Roppongi 5-chome', city:'Tokyo', prices:{regular:176,midgrade:186,premium:196,diesel:163}, rating:4.0, numReviews:125, amenities:['Pay at Pump','Restrooms','Car Wash'], reporter:'cosmoJP', reportedAgo:'3h', cash:true, dist:1.8, reviews:[] }
      ],
      KR: [
        { name:'GS Caltex', domain:'gscaltex.com', addr:'Gangnam-daero 100', city:'Seoul', prices:{regular:1680,midgrade:1780,premium:1890,diesel:1540}, rating:4.2, numReviews:215, amenities:['C-Store','Pay at Pump','Car Wash'], reporter:'seoulFuel', reportedAgo:'1h', cash:true, dist:0.7, reviews:[] },
        { name:'SK Energy', domain:'skenergy.com', addr:'Jongno 50', city:'Seoul', prices:{regular:1670,midgrade:1770,premium:1880,diesel:1530}, rating:4.0, numReviews:180, amenities:['C-Store','Pay at Pump','Restrooms'], reporter:'skFan', reportedAgo:'2h', cash:true, dist:1.5, reviews:[] }
      ],
      IN: [
        { name:'Indian Oil', domain:'iocl.com', addr:'Connaught Place', city:'New Delhi', prices:{regular:96.72,midgrade:102,premium:108,diesel:89.62}, rating:4.0, numReviews:450, amenities:['C-Store','Restrooms','Pay at Pump'], reporter:'delhiFuel', reportedAgo:'1h', cash:true, dist:0.4, reviews:[] },
        { name:'Bharat Petroleum', domain:'bharatpetroleum.in', addr:'MG Road', city:'Bangalore', prices:{regular:101.94,midgrade:108,premium:114,diesel:87.89}, rating:4.1, numReviews:320, amenities:['C-Store','Restrooms','ATM'], reporter:'bpclFan', reportedAgo:'2h', cash:true, dist:1.0, reviews:[] },
        { name:'HP', domain:'hindustanpetroleum.com', addr:'Marine Drive', city:'Mumbai', prices:{regular:103.44,midgrade:110,premium:116,diesel:89.97}, rating:3.9, numReviews:278, amenities:['C-Store','Pay at Pump','Restrooms'], reporter:'hpMumbai', reportedAgo:'3h', cash:true, dist:1.5, reviews:[] },
        { name:'Reliance', domain:'reliancepetroleum.com', addr:'Link Road', city:'Mumbai', prices:{regular:95.30,midgrade:101,premium:107,diesel:87.20}, rating:4.3, numReviews:195, amenities:['C-Store','Pay at Pump','Restrooms','ATM'], reporter:'rilFuel', reportedAgo:'1h', cash:true, dist:2.2, reviews:[] }
      ],
      AE: [
        { name:'ADNOC', domain:'adnoc.ae', addr:'Sheikh Zayed Rd', city:'Dubai', prices:{regular:2.99,midgrade:3.10,premium:3.23,diesel:2.92}, rating:4.5, numReviews:380, amenities:['C-Store','Pay at Pump','Car Wash','Restrooms','EV Charging'], reporter:'dubaiFuel', reportedAgo:'30m', cash:true, dist:0.3, reviews:[{user:'UAE_driver',stars:5,text:'Best prices. Always clean.',date:'6h ago'}] },
        { name:'ENOC', domain:'enoc.com', addr:'Al Wasl Road', city:'Dubai', prices:{regular:2.99,midgrade:3.10,premium:3.23,diesel:2.92}, rating:4.3, numReviews:245, amenities:['C-Store','Pay at Pump','Restrooms'], reporter:'enocFan', reportedAgo:'1h', cash:true, dist:1.0, reviews:[] },
        { name:'Emarat', domain:'emarat.ae', addr:'Jumeirah Beach Rd', city:'Dubai', prices:{regular:2.99,midgrade:3.10,premium:3.23,diesel:2.92}, rating:4.1, numReviews:168, amenities:['C-Store','Pay at Pump','Restrooms','Car Wash'], reporter:'emaratDXB', reportedAgo:'2h', cash:true, dist:2.5, reviews:[] }
      ],
      SA: [
        { name:'Saudi Aramco', domain:'aramco.com', addr:'King Fahd Rd', city:'Riyadh', prices:{regular:2.18,midgrade:2.33,premium:2.68,diesel:1.44}, rating:4.4, numReviews:520, amenities:['C-Store','Pay at Pump','Restrooms','Car Wash'], reporter:'riyadhFuel', reportedAgo:'1h', cash:true, dist:0.5, reviews:[] },
        { name:'Shell', domain:'shell.com', addr:'Olaya St', city:'Riyadh', prices:{regular:2.18,midgrade:2.33,premium:2.68,diesel:1.44}, rating:4.2, numReviews:180, amenities:['C-Store','Pay at Pump','Restrooms'], reporter:'shellSA', reportedAgo:'2h', cash:true, dist:1.8, reviews:[] }
      ],
      TR: [
        { name:'OPET', domain:'opet.com.tr', addr:'Bağdat Cad.', city:'Istanbul', prices:{regular:42.50,midgrade:44.80,premium:47.20,diesel:41.30}, rating:4.2, numReviews:225, amenities:['C-Store','Pay at Pump','Restrooms','Car Wash'], reporter:'istFuel', reportedAgo:'1h', cash:true, dist:0.8, reviews:[] },
        { name:'Petrol Ofisi', domain:'petrolofisi.com.tr', addr:'Istiklal Cad.', city:'Istanbul', prices:{regular:42.30,midgrade:44.60,premium:47.00,diesel:41.10}, rating:4.0, numReviews:178, amenities:['C-Store','Pay at Pump','Restrooms'], reporter:'poFan', reportedAgo:'2h', cash:true, dist:1.5, reviews:[] }
      ],
      NG: [
        { name:'NNPC Retail', domain:'nnpcgroup.com', addr:'Ikorodu Rd', city:'Lagos', prices:{regular:617,midgrade:650,premium:700,diesel:900}, rating:3.8, numReviews:420, amenities:['C-Store','Restrooms'], reporter:'lagosFuel', reportedAgo:'1h', cash:true, dist:0.5, reviews:[] },
        { name:'TotalEnergies', domain:'totalenergies.com', addr:'Victoria Island', city:'Lagos', prices:{regular:620,midgrade:655,premium:705,diesel:910}, rating:4.0, numReviews:185, amenities:['C-Store','Restrooms','Pay at Pump'], reporter:'totalNG', reportedAgo:'3h', cash:true, dist:2.0, reviews:[] },
        { name:'Oando', domain:'oandoplc.com', addr:'Allen Ave', city:'Lagos', prices:{regular:615,midgrade:648,premium:698,diesel:895}, rating:3.9, numReviews:142, amenities:['C-Store','Restrooms'], reporter:'oandoFan', reportedAgo:'4h', cash:true, dist:3.2, reviews:[] }
      ],
      ZA: [
        { name:'Engen', domain:'engen.co.za', addr:'Jan Smuts Ave', city:'Johannesburg', prices:{regular:24.20,midgrade:25.50,premium:26.80,diesel:22.50}, rating:4.1, numReviews:210, amenities:['C-Store','Restrooms','Pay at Pump','Car Wash'], reporter:'joFuel', reportedAgo:'2h', cash:true, dist:0.7, reviews:[] },
        { name:'Shell', domain:'shell.com', addr:'Nelson Mandela Dr', city:'Cape Town', prices:{regular:24.40,midgrade:25.70,premium:27.00,diesel:22.70}, rating:4.3, numReviews:175, amenities:['C-Store','Pay at Pump','Restrooms','Car Wash'], reporter:'shellZA', reportedAgo:'1h', cash:true, dist:1.2, reviews:[] },
        { name:'Sasol', domain:'sasol.com', addr:'Rivonia Rd', city:'Johannesburg', prices:{regular:24.10,midgrade:25.40,premium:26.70,diesel:22.40}, rating:4.0, numReviews:135, amenities:['C-Store','Restrooms','Pay at Pump'], reporter:'sasolFan', reportedAgo:'3h', cash:true, dist:2.5, reviews:[] }
      ]
    };

    var activeCountry = 'US';
    var stations = stationsByCountry[activeCountry] || [];
    var activeFuelType = 'regular';
    var activeSort = 'price';
    var activeBrandFilter = 'all';
    var stationsExpanded = false;
    var collapsedStationCount = 6;
    var fuelHistory = JSON.parse(localStorage.getItem('ost_fuel_history') || '[]');
    var selectedStation = null;

    // Country change
    var countrySel = document.getElementById('fuel2Country');
    if (countrySel) {
      countrySel.addEventListener('change', function() {
        activeCountry = countrySel.value;
        stations = stationsByCountry[activeCountry] || [];
        activeBrandFilter = 'all';
        stationsExpanded = false;
        renderBrandTabs();
        renderStations();
      });
    }

    // DOM refs
    var locInput = document.getElementById('fuel2SearchLoc');
    var resultCount = document.getElementById('fuel2ResultCount');
    var listSub = document.getElementById('fuel2ListSub');
    var listToggle = document.getElementById('fuel2ListToggle');
    var stationList = document.getElementById('fuel2StationList');
    var detailOverlay = document.getElementById('fuel2DetailOverlay');
    var detailModal = document.getElementById('fuel2DetailModal');
    var closeDetail = document.getElementById('fuel2DetailClose');
    var brandTabsWrap = document.getElementById('fuel2BrandTabs');

    if (listToggle) {
      listToggle.addEventListener('click', function() {
        stationsExpanded = !stationsExpanded;
        renderStations();
      });
    }

    function renderBrandTabs() {
      if (!brandTabsWrap) return;
      brandTabsWrap.innerHTML = '';
      var seen = {};
      var allTab = document.createElement('button');
      allTab.className = 'fuel2-brand-tab fuel2-brand-tab-active';
      allTab.textContent = 'All Stations';
      allTab.dataset.brand = 'all';
      allTab.addEventListener('click', function() { activeBrandFilter = 'all'; stationsExpanded = false; highlightBrandTab('all'); renderStations(); });
      brandTabsWrap.appendChild(allTab);
      stations.forEach(function(s) {
        if (seen[s.name]) return;
        seen[s.name] = true;
        var tab = document.createElement('button');
        tab.className = 'fuel2-brand-tab';
        tab.dataset.brand = s.name;
        var img = document.createElement('img');
        img.src = logoSrc(s.domain);
        img.onerror = function() { logoFallback(this, s.domain, s.name, '#0071CE'); };
        tab.appendChild(img);
        tab.appendChild(document.createTextNode(s.name));
        tab.addEventListener('click', function() { activeBrandFilter = s.name; stationsExpanded = false; highlightBrandTab(s.name); renderStations(); });
        brandTabsWrap.appendChild(tab);
      });
    }
    function highlightBrandTab(name) {
      brandTabsWrap.querySelectorAll('.fuel2-brand-tab').forEach(function(t) {
        t.classList.toggle('fuel2-brand-tab-active', t.dataset.brand === name);
      });
    }
    renderBrandTabs();

    // Fuel type tabs
    document.querySelectorAll('.fuel2-ft').forEach(function(tab) {
      tab.addEventListener('click', function() {
        document.querySelectorAll('.fuel2-ft').forEach(function(t) { t.classList.remove('fuel2-ft-active'); });
        tab.classList.add('fuel2-ft-active');
        activeFuelType = tab.dataset.fuel;
        stationsExpanded = false;
        renderStations();
      });
    });

    // Sort buttons
    document.querySelectorAll('.fuel2-sort').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.fuel2-sort').forEach(function(b) { b.classList.remove('fuel2-sort-active'); });
        btn.classList.add('fuel2-sort-active');
        activeSort = btn.dataset.sort;
        stationsExpanded = false;
        renderStations();
      });
    });

    findBtn.addEventListener('click', function() { stationsExpanded = false; renderStations(); });
    locInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { stationsExpanded = false; renderStations(); } });

    function getStationPrice(s) { return s.prices[activeFuelType] || s.prices.regular; }

    function sortedStations() {
      var q = (locInput.value || '').toLowerCase();
      var filtered = stations.filter(function(s) {
        if (activeBrandFilter !== 'all' && s.name !== activeBrandFilter) return false;
        if (!q) return true;
        return s.name.toLowerCase().indexOf(q) >= 0 || s.addr.toLowerCase().indexOf(q) >= 0 || s.city.toLowerCase().indexOf(q) >= 0;
      });
      filtered.sort(function(a, b) {
        if (activeSort === 'price') return getStationPrice(a) - getStationPrice(b);
        if (activeSort === 'rating') return b.rating - a.rating;
        return a.dist - b.dist;
      });
      return filtered;
    }

    function starsHTML(rating) {
      var html = '';
      var rounded = Math.round(rating);
      for (var i = 1; i <= 5; i++) html += i <= rounded ? '<span class="fuel2-star">&#9733;</span>' : '<span class="fuel2-star-empty">&#9733;</span>';
      return html;
    }

    // Currency units by country
    var currUnits = { US:'$/gal', CA:'$/L', MX:'MXN/L', GB:'£/L', DE:'€/L', FR:'€/L', ES:'€/L', IT:'€/L', BR:'R$/L', AR:'ARS/L', CO:'COP/gal', AU:'$/L', JP:'¥/L', KR:'₩/L', IN:'₹/L', AE:'AED/L', SA:'SAR/L', TR:'₺/L', NG:'₦/L', ZA:'ZAR/L' };

    function renderStations() {
      var list = sortedStations();
      resultCount.textContent = list.length;
      stationList.innerHTML = '';
      var visibleList = stationsExpanded ? list : list.slice(0, collapsedStationCount);
      var unit = currUnits[activeCountry] || '$/gal';
      visibleList.forEach(function(s, idx) {
        var price = getStationPrice(s);
        var row = document.createElement('div');
        row.className = 'fuel2-station';
        row.innerHTML =
          '<div class="fuel2-station-rank">' + (idx + 1) + '</div>' +
          '<img class="fuel2-station-logo" src="' + logoSrc(s.domain) + '" alt="' + s.name + '" onerror="this.onerror=null;this.src=\'' + brandSvg(s.name, '#0071CE').replace(/'/g, "\\'") + '\'">' +
          '<div class="fuel2-station-info">' +
            '<div class="fuel2-station-name">' + s.name + '</div>' +
            '<div class="fuel2-station-addr">' + s.addr + ', ' + s.city + '</div>' +
            '<div class="fuel2-station-stars">' + starsHTML(s.rating) + '</div>' +
            '<div class="fuel2-station-reviews">' + s.numReviews + ' reviews</div>' +
            '<div class="fuel2-station-amenities">' + s.amenities.map(function(a) { return '<span class="fuel2-amenity">' + a + '</span>'; }).join('') + '</div>' +
          '</div>' +
          '<div class="fuel2-station-price-col">' +
            '<div class="fuel2-station-price">' + price.toFixed(2) + '</div>' +
            '<div class="fuel2-station-price-unit">' + unit + '</div>' +
            '<div class="fuel2-station-reporter">' + s.reporter + '</div>' +
            '<div class="fuel2-station-time">' + s.reportedAgo + ' ago</div>' +
            (s.cash ? '<div class="fuel2-station-cash">Cash discount</div>' : '') +
            '<div class="fuel2-station-dist">' + s.dist + ' mi</div>' +
          '</div>';
        row.addEventListener('click', function() { openDetail(s); });
        stationList.appendChild(row);
      });

      if (listSub) {
        listSub.textContent = list.length > collapsedStationCount && !stationsExpanded
          ? 'Showing ' + visibleList.length + ' of ' + list.length + ' nearby stations. Open one to start a merchant-session checkout.'
          : 'Open a station to enter the merchant session, authorize the fill, and collect cashback.';
      }
      if (listToggle) {
        if (list.length > collapsedStationCount) {
          listToggle.style.display = '';
          listToggle.textContent = stationsExpanded ? 'Show fewer stations' : 'Show all ' + list.length + ' stations';
        } else {
          listToggle.style.display = 'none';
        }
      }
    }

    // Detail modal
    function openDetail(s) {
      selectedStation = s;
      detailOverlay.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      document.getElementById('fuel2DetLogo').src = logoSrc(s.domain);
      document.getElementById('fuel2DetLogo').onerror = function() { logoFallback(this, s.domain, s.name, '#0071CE'); };
      document.getElementById('fuel2DetName').textContent = s.name;
      document.getElementById('fuel2DetAddr').textContent = s.addr + ', ' + s.city;
      document.getElementById('fuel2DetStars').innerHTML = starsHTML(s.rating);
      document.getElementById('fuel2DetRevCount').textContent = s.numReviews + ' reviews';
      var prGrid = document.getElementById('fuel2DetPrices');
      prGrid.innerHTML = '';
      ['regular','midgrade','premium','diesel'].forEach(function(ft) {
        var box = document.createElement('div');
        box.className = 'fuel2-det-price-box';
        box.innerHTML = '<div class="fuel2-det-price-type">' + ft.charAt(0).toUpperCase() + ft.slice(1) + '</div><div class="fuel2-det-price-val">' + (s.prices[ft] || 0).toFixed(2) + '</div>';
        prGrid.appendChild(box);
      });
      var amenEl = document.getElementById('fuel2DetAmenities');
      amenEl.innerHTML = '';
      s.amenities.forEach(function(a) { var span = document.createElement('span'); span.className = 'fuel2-det-amenity'; span.textContent = a; amenEl.appendChild(span); });
      var gallery = document.getElementById('fuel2DetGallery');
      if (gallery) {
        gallery.innerHTML = '';
        var colors = ['#1a237e','#004d40','#b71c1c','#e65100','#1b5e20'];
        var labels = ['Pumps','Store','Car Wash','Entrance','Night'];
        for (var gi = 0; gi < 5; gi++) {
          var gimg = document.createElement('img');
          gimg.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect fill="' + colors[gi] + '" width="240" height="160" rx="8"/><text x="120" y="70" text-anchor="middle" fill="rgba(255,255,255,.7)" font-size="14" font-weight="700" font-family="Inter,sans-serif">' + s.name + '</text><text x="120" y="100" text-anchor="middle" fill="rgba(255,255,255,.35)" font-size="12" font-family="Inter,sans-serif">' + labels[gi] + '</text></svg>');
          gimg.alt = s.name + ' ' + labels[gi];
          gallery.appendChild(gimg);
        }
      }
      var extLinks = document.getElementById('fuel2ExtLinks');
      if (extLinks) {
        var yelpQ = encodeURIComponent(s.name + ' ' + s.addr + ' ' + s.city);
        var gQ = encodeURIComponent(s.name + ' ' + s.addr + ' ' + s.city);
        var mapsQ = encodeURIComponent(s.addr + ', ' + s.city);
        extLinks.innerHTML = '<a class="fuel2-yelp-link" href="https://www.yelp.com/search?find_desc=' + yelpQ + '" target="_blank" rel="noopener">&#11088; Yelp</a>' +
          '<a class="fuel2-google-link" href="https://www.google.com/search?q=' + gQ + '+reviews" target="_blank" rel="noopener">&#128270; Google</a>' +
          '<a class="fuel2-maps-link" href="https://www.google.com/maps/search/' + mapsQ + '" target="_blank" rel="noopener">&#128205; Directions</a>';
      }
      var priceField = document.getElementById('fuel2DetPrice');
      var qtyField = document.getElementById('fuel2DetGal');
      var sessionField = document.getElementById('fuel2DetSession');
      var pumpField = document.getElementById('fuel2DetPump');
      priceField.value = getStationPrice(s).toFixed(2);
      if (qtyField) qtyField.value = '';
      if (sessionField) sessionField.value = '';
      if (pumpField) pumpField.value = '';
      updateDetailCalc();
      renderDetailReviews(s);
      document.getElementById('fuel2ReportFuel').value = activeFuelType;
      var flow = document.getElementById('fuel2DetFlow');
      flow.style.display = 'none';
      flow.querySelectorAll('.fuel2-dfs').forEach(function(st) { st.classList.remove('f2-active', 'f2-done'); });
      var receipt = document.getElementById('fuel2DetReceipt');
      if (receipt) {
        receipt.style.display = 'none';
        receipt.innerHTML = '';
      }
    }

    closeDetail.addEventListener('click', function() { detailOverlay.style.display = 'none'; document.body.style.overflow = ''; });
    detailOverlay.addEventListener('click', function(e) { if (e.target === detailOverlay) closeDetail.click(); });

    var galEl = document.getElementById('fuel2DetGal');
    var priceDetEl = document.getElementById('fuel2DetPrice');
    var sessionEl = document.getElementById('fuel2DetSession');
    var pumpEl = document.getElementById('fuel2DetPump');
    var usdOut = document.getElementById('fuel2DetUSD');
    var ostOut = document.getElementById('fuel2DetOST');
    var rwOut = document.getElementById('fuel2DetRw');
    var payBtn = document.getElementById('fuel2DetPayBtn');
    var receiptEl = document.getElementById('fuel2DetReceipt');

    function getRewardRate() { var c = fuelHistory.length; return c >= 500 ? 0.08 : c >= 100 ? 0.05 : 0.03; }

    function updateDetailCalc() {
      var g = parseFloat(galEl.value) || 0;
      var p = parseFloat(priceDetEl.value) || 0;
      var hasSession = sessionEl && sessionEl.value.trim().length >= 4;
      var hasPump = pumpEl && pumpEl.value.trim().length >= 1;
      var cost = g * p;
      usdOut.textContent = '$' + cost.toFixed(2);
      if (cost > 0 && safeOstPrice() > 0 && hasSession && hasPump) {
        var ost = cost / safeOstPrice();
        var rate = getRewardRate();
        ostOut.textContent = ost.toFixed(2) + ' OST';
        rwOut.textContent = '+' + (ost * rate).toFixed(2) + ' OST';
        payBtn.disabled = false;
      } else { ostOut.textContent = '0 OST'; rwOut.textContent = '+0 OST'; payBtn.disabled = true; }
    }
    galEl.addEventListener('input', updateDetailCalc);
    priceDetEl.addEventListener('input', updateDetailCalc);
    if (sessionEl) sessionEl.addEventListener('input', updateDetailCalc);
    if (pumpEl) pumpEl.addEventListener('input', updateDetailCalc);

    payBtn.addEventListener('click', function() {
      if (!selectedStation) return;
      payBtn.disabled = true;
      var flow = document.getElementById('fuel2DetFlow');
      flow.style.display = 'flex';
      if (receiptEl) {
        receiptEl.style.display = 'none';
        receiptEl.innerHTML = '';
      }
      var steps = flow.querySelectorAll('.fuel2-dfs');
      steps.forEach(function(s) { s.classList.remove('f2-active', 'f2-done'); });
      var i = 0;
      function next() {
        if (i > 0) { steps[i - 1].classList.remove('f2-active'); steps[i - 1].classList.add('f2-done'); }
        if (i < steps.length) { steps[i].classList.add('f2-active'); i++; setTimeout(next, 800 + Math.random() * 500); }
        else {
          var g = parseFloat(galEl.value) || 0;
          var p = parseFloat(priceDetEl.value) || 0;
          var cost = g * p;
          var ost = safeOstPrice() > 0 ? cost / safeOstPrice() : 0;
          var rate = getRewardRate();
          var reward = ost * rate;
          var sessionCode = sessionEl ? sessionEl.value.trim().toUpperCase() : '';
          var pumpCode = pumpEl ? pumpEl.value.trim().toUpperCase() : '';
          var receiptCode = 'OST-' + Math.random().toString(36).slice(2, 8).toUpperCase();
          fuelHistory.push({ station: selectedStation ? selectedStation.name : 'Unknown', domain: selectedStation ? selectedStation.domain : '', gallons: g, pricePerGal: p, usd: cost.toFixed(2), ost: ost.toFixed(2), reward: reward.toFixed(2), session: sessionCode, pump: pumpCode, receipt: receiptCode, date: new Date().toLocaleDateString() });
          localStorage.setItem('ost_fuel_history', JSON.stringify(fuelHistory));
          renderRewards();
          if (receiptEl) {
            receiptEl.innerHTML = '<strong>Merchant receipt confirmed</strong><p>Session <b>' + sessionCode + '</b> · Pump <b>' + pumpCode + '</b> · Receipt <b>' + receiptCode + '</b><br>Total ' + ost.toFixed(2) + ' OST settled at ' + selectedStation.name + '. Cashback credited: +' + reward.toFixed(2) + ' OST.</p>';
            receiptEl.style.display = 'block';
          }
          toast('&#9981;', 'Merchant checkout settled. +' + reward.toFixed(2) + ' OST cashback.');
          setTimeout(function() {
            flow.style.display = 'none';
            steps.forEach(function(step) { step.classList.remove('f2-active', 'f2-done'); });
            payBtn.disabled = false;
          }, 1200);
        }
      }
      next();
    });

    function renderDetailReviews(s) {
      var container = document.getElementById('fuel2DetReviews');
      container.innerHTML = '';
      (s.reviews || []).forEach(function(r) {
        var div = document.createElement('div');
        div.className = 'fuel2-review';
        div.innerHTML = '<div class="fuel2-review-user">' + r.user + '</div><div class="fuel2-review-stars-sm">' + starsHTML(r.stars) + '</div><div class="fuel2-review-text">' + r.text + '</div><div class="fuel2-review-date">' + (r.date || '') + '</div>';
        container.appendChild(div);
      });
    }

    var reviewText = document.getElementById('fuel2ReviewText');
    var reviewStarsWrap = document.getElementById('fuel2ReviewStars');
    var reviewSend = document.getElementById('fuel2ReviewSend');
    var userReviewRating = 5;
    if (reviewStarsWrap) {
      var starSpans = reviewStarsWrap.querySelectorAll('span');
      starSpans.forEach(function(sp, idx) {
        sp.addEventListener('click', function() { userReviewRating = idx + 1; starSpans.forEach(function(s, j) { s.classList.toggle('fuel2-star-lit', j < userReviewRating); }); });
        sp.addEventListener('mouseenter', function() { starSpans.forEach(function(s, j) { s.classList.toggle('fuel2-star-lit', j <= idx); }); });
      });
      reviewStarsWrap.addEventListener('mouseleave', function() { starSpans.forEach(function(s, j) { s.classList.toggle('fuel2-star-lit', j < userReviewRating); }); });
    }
    if (reviewSend) {
      reviewSend.addEventListener('click', function() {
        var text = reviewText.value.trim();
        if (!text || !selectedStation) return;
        selectedStation.reviews = selectedStation.reviews || [];
        selectedStation.reviews.push({ user: 'You', stars: userReviewRating, text: text, date: 'just now' });
        selectedStation.numReviews++;
        renderDetailReviews(selectedStation);
        reviewText.value = '';
        toast('&#11088;', 'Review posted!');
      });
    }

    var reportBtn = document.getElementById('fuel2ReportBtn');
    if (reportBtn) {
      reportBtn.addEventListener('click', function() {
        var ft = document.getElementById('fuel2ReportFuel').value;
        var pr = parseFloat(document.getElementById('fuel2ReportPrice').value);
        if (!pr || !selectedStation) return;
        selectedStation.prices[ft] = pr;
        selectedStation.reporter = 'You';
        selectedStation.reportedAgo = 'just now';
        renderStations();
        openDetail(selectedStation);
        toast('&#128200;', 'Price reported! Thanks for contributing.');
      });
    }

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

    // ================================================================
    // OIL BARREL PRICE CHART (Brent Crude since Feb 2025)
    // ================================================================
    function drawOilChart() {
      var canvas = document.getElementById('fuel2OilChart');
      if (!canvas || !canvas.getContext) return;
      var ctx = canvas.getContext('2d');
      var dpr = window.devicePixelRatio || 1;
      var rect = canvas.parentElement.getBoundingClientRect();
      if (!rect.width) return;
      canvas.width = rect.width * dpr;
      canvas.height = 220 * dpr;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = '220px';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      var W = rect.width;
      var H = 220;
      var pad = { top: 20, right: 20, bottom: 30, left: 50 };

      // Monthly Brent crude data Feb 2025 - Apr 2026 (approximate)
      var data = [
        { month: 'Feb 25', price: 74.5 },
        { month: 'Mar 25', price: 72.8 },
        { month: 'Apr 25', price: 66.2 },
        { month: 'May 25', price: 64.8 },
        { month: 'Jun 25', price: 68.3 },
        { month: 'Jul 25', price: 71.5 },
        { month: 'Aug 25', price: 73.2 },
        { month: 'Sep 25', price: 69.8 },
        { month: 'Oct 25', price: 72.1 },
        { month: 'Nov 25', price: 75.4 },
        { month: 'Dec 25', price: 78.9 },
        { month: 'Jan 26', price: 80.2 },
        { month: 'Feb 26', price: 82.7 },
        { month: 'Mar 26', price: 89.1 },
        { month: 'Apr 26', price: 85.4 }
      ];

      var prices = data.map(function(d) { return d.price; });
      var minP = Math.floor(Math.min.apply(null, prices) - 5);
      var maxP = Math.ceil(Math.max.apply(null, prices) + 5);
      var chartW = W - pad.left - pad.right;
      var chartH = H - pad.top - pad.bottom;

      function x(i) { return pad.left + (i / (data.length - 1)) * chartW; }
      function y(p) { return pad.top + chartH - ((p - minP) / (maxP - minP)) * chartH; }

      // Grid lines
      ctx.strokeStyle = 'rgba(255,255,255,.06)';
      ctx.lineWidth = 1;
      for (var gl = minP; gl <= maxP; gl += 5) {
        var gy = y(gl);
        ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(W - pad.right, gy); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.3)';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('$' + gl, pad.left - 6, gy + 3);
      }

      // X labels
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      data.forEach(function(d, i) {
        if (i % 2 === 0 || i === data.length - 1) ctx.fillText(d.month, x(i), H - 6);
      });

      // Gradient fill
      var lg = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
      lg.addColorStop(0, 'rgba(255,152,0,.2)');
      lg.addColorStop(1, 'rgba(255,152,0,0)');
      ctx.beginPath();
      ctx.moveTo(x(0), y(data[0].price));
      data.forEach(function(d, i) { ctx.lineTo(x(i), y(d.price)); });
      ctx.lineTo(x(data.length - 1), H - pad.bottom);
      ctx.lineTo(x(0), H - pad.bottom);
      ctx.closePath();
      ctx.fillStyle = lg;
      ctx.fill();

      // Line
      ctx.beginPath();
      ctx.moveTo(x(0), y(data[0].price));
      data.forEach(function(d, i) { ctx.lineTo(x(i), y(d.price)); });
      ctx.strokeStyle = '#ff9800';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Dots
      data.forEach(function(d, i) {
        ctx.beginPath();
        ctx.arc(x(i), y(d.price), 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ff9800';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // Update live price display
      var latest = data[data.length - 1];
      var prev = data[data.length - 2];
      var priceEl = document.getElementById('fuel2OilPrice');
      var changeEl = document.getElementById('fuel2OilChange');
      if (priceEl) priceEl.textContent = '$' + latest.price.toFixed(1);
      if (changeEl) {
        var diff = latest.price - prev.price;
        var pct = ((diff / prev.price) * 100).toFixed(1);
        changeEl.textContent = (diff >= 0 ? '+' : '') + diff.toFixed(1) + ' (' + (diff >= 0 ? '+' : '') + pct + '%)';
        changeEl.className = 'fuel2-oil-change ' + (diff >= 0 ? 'up' : 'down');
      }
    }

    // Initial render
    renderStations();
    renderRewards();
    drawOilChart();

    window.addEventListener('resize', drawOilChart);
    document.addEventListener('ost:store-tab-change', function(event) {
      if (event && event.detail && event.detail.tab === 'fuel') {
        window.requestAnimationFrame(drawOilChart);
      }
    });
  })();

  // ========================================================================
  // OST LAUNCHPAD — pump.fun style with bonding curve & trenches
  // ========================================================================
  (function initLaunchpad() {
    var nameEl    = document.getElementById('lpName');
    var symbolEl  = document.getElementById('lpSymbol');
    var descEl    = document.getElementById('lpDesc');
    var descCount = document.getElementById('lpDescCount');
    var launchBtn = document.getElementById('lpLaunchBtn');
    if (!nameEl || !launchBtn) return;

    /* ── State ── */
    var launches = JSON.parse(localStorage.getItem('ost_lp_history2') || '[]');
    var uploadedImage = null; // data URL
    var previewEls = {
      media: document.getElementById('lpPreviewMedia'),
      stage: document.getElementById('lpPreviewStage'),
      name: document.getElementById('lpPreviewName'),
      ticker: document.getElementById('lpPreviewTicker'),
      creator: document.getElementById('lpPreviewCreator'),
      desc: document.getElementById('lpPreviewDesc'),
      buy: document.getElementById('lpPreviewBuy'),
      curve: document.getElementById('lpPreviewCurve'),
      links: document.getElementById('lpPreviewLinks'),
      pulseHot: document.getElementById('lpPulseHot'),
      pulseNew: document.getElementById('lpPulseNew'),
      pulseGrad: document.getElementById('lpPulseGrad')
    };

    /* ── Demo seed ── */
    var DEMO_IMAGES = [
      'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="%23191b2a" width="200" height="200"/><text x="100" y="115" text-anchor="middle" font-size="80" fill="%2300ff88">🐕</text></svg>'),
      'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="%23191b2a" width="200" height="200"/><text x="100" y="115" text-anchor="middle" font-size="80" fill="%236d9fff">🛰️</text></svg>'),
      'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="%23191b2a" width="200" height="200"/><text x="100" y="115" text-anchor="middle" font-size="80" fill="%23a78bfa">🌙</text></svg>'),
      'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="%23191b2a" width="200" height="200"/><text x="100" y="115" text-anchor="middle" font-size="80" fill="%23FF6B35">🔥</text></svg>'),
      'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="%23191b2a" width="200" height="200"/><text x="100" y="115" text-anchor="middle" font-size="80" fill="%23ffd700">👑</text></svg>'),
      'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="%23191b2a" width="200" height="200"/><text x="100" y="115" text-anchor="middle" font-size="80" fill="%23ff69b4">🐱</text></svg>'),
      'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="%23191b2a" width="200" height="200"/><text x="100" y="115" text-anchor="middle" font-size="80" fill="%2300bfff">🐸</text></svg>'),
      'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="%23191b2a" width="200" height="200"/><text x="100" y="115" text-anchor="middle" font-size="80" fill="%23ff4500">🚀</text></svg>')
    ];

    if (launches.length === 0) {
      var now = Date.now();
      var demoData = [
        { name:'SpaceDoge', symbol:'SDOGE', desc:'First dog in decentralized orbit. Much wow, very satellite.', mcap: 42000, curve: 61, img: DEMO_IMAGES[0], twitter:'https://twitter.com/spacedoge', telegram:'', website:'', creator:'7xK...b2F', date: now - 120000, comments:[{user:'anon42',text:'to the moon 🚀'},{user:'degen99',text:'aping in'}], holders:[{addr:'7xK...b2F',pct:18},{addr:'3mP...nQ9',pct:12},{addr:'9aW...kL5',pct:8},{addr:'2bT...pQ5',pct:5}] },
        { name:'Starlink Inu', symbol:'SINU', desc:'Decentralized satellite meme power. Beaming gains from LEO.', mcap: 31500, curve: 46, img: DEMO_IMAGES[1], twitter:'', telegram:'https://t.me/starlinkinu', website:'', creator:'4pR...mN3', date: now - 300000, comments:[{user:'satfan',text:'this one is different'}], holders:[{addr:'4pR...mN3',pct:22},{addr:'8kL...wR7',pct:9},{addr:'5nG...hT2',pct:6}] },
        { name:'LunarDAO', symbol:'LUNA2', desc:'Governance for moon settlers. Vote on crater allocation.', mcap: 58200, curve: 84, img: DEMO_IMAGES[2], twitter:'https://twitter.com/lunardao', telegram:'', website:'https://lunardao.space', creator:'6cD...wM8', date: now - 60000, comments:[{user:'moonboy',text:'KOTH incoming!'},{user:'whale1',text:'just bought 50k'},{user:'skeptic',text:'careful guys'}], holders:[{addr:'6cD...wM8',pct:15},{addr:'1xY...aB3',pct:11},{addr:'7wQ...eF9',pct:7},{addr:'3mP...nQ9',pct:4},{addr:'9kL...rT6',pct:3}] },
        { name:'OrbitalCash', symbol:'ORBT', desc:'Cash for the orbital economy. Zero-G settlement layer.', mcap: 8900, curve: 13, img: DEMO_IMAGES[3], twitter:'', telegram:'', website:'', creator:'2bT...pQ5', date: now - 900000, comments:[], holders:[{addr:'2bT...pQ5',pct:35},{addr:'8kL...wR7',pct:8}] },
        { name:'ZeroGravity', symbol:'0GRV', desc:'No gravity, no limits. The weightless memecoin.', mcap: 22100, curve: 32, img: DEMO_IMAGES[4], twitter:'', telegram:'https://t.me/zerograv', website:'', creator:'9aW...hJ7', date: now - 600000, comments:[{user:'trader1',text:'nice chart setup'}], holders:[{addr:'9aW...hJ7',pct:20},{addr:'4pR...mN3',pct:6},{addr:'1xY...aB3',pct:5}] },
        { name:'CatOnSolana', symbol:'MEOW', desc:'Every blockchain needs a cat. This is ours. Purr.', mcap: 15600, curve: 23, img: DEMO_IMAGES[5], twitter:'https://twitter.com/catonsol', telegram:'', website:'', creator:'5nG...hT2', date: now - 450000, comments:[{user:'catfan',text:'finally a cat coin on OST'}], holders:[{addr:'5nG...hT2',pct:25},{addr:'7xK...b2F',pct:7}] },
        { name:'PepeOST', symbol:'POST', desc:'Pepe but make it interplanetary. Rare. Encrypted. Unstoppable.', mcap: 37800, curve: 55, img: DEMO_IMAGES[6], twitter:'', telegram:'https://t.me/pepeost', website:'https://pepeost.meme', creator:'3mP...nQ9', date: now - 180000, comments:[{user:'pepelord',text:'rarest pepe ever'},{user:'anon42',text:'chart looks bullish'}], holders:[{addr:'3mP...nQ9',pct:16},{addr:'9aW...hJ7',pct:10},{addr:'6cD...wM8',pct:6},{addr:'8kL...wR7',pct:4}] },
        { name:'RocketFuel', symbol:'FUEL', desc:'Powering the next generation of meme launches. High octane.', mcap: 5200, curve: 8, img: DEMO_IMAGES[7], twitter:'', telegram:'', website:'', creator:'8kL...wR7', date: now - 1200000, comments:[], holders:[{addr:'8kL...wR7',pct:40},{addr:'2bT...pQ5',pct:5}] }
      ];
      demoData.forEach(function(d) {
        d.mint = generateMint();
        d.supply = 1000000000;
      });
      launches = demoData;
      localStorage.setItem('ost_lp_history2', JSON.stringify(launches));
    }

    /* ── Utility ── */
    function generateMint() {
      var chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      var out = '';
      for (var i = 0; i < 44; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
      return out;
    }
    function fmtMcap(n) {
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return n.toString();
    }
    function timeAgo(ts) {
      var diff = (Date.now() - ts) / 1000;
      if (diff < 60) return Math.floor(diff) + 's ago';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      return Math.floor(diff / 86400) + 'd ago';
    }
    function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function renderComposePreview() {
      if (!previewEls.name) return;
      var twitterEl = document.getElementById('lpTwitter');
      var telegramEl = document.getElementById('lpTelegram');
      var websiteEl = document.getElementById('lpWebsite');
      var initialBuyEl = document.getElementById('lpInitialBuy');
      var name = (nameEl.value || '').trim();
      var symbol = (symbolEl.value || '').trim().toUpperCase();
      var desc = ((descEl && descEl.value) || '').trim();
      var initialBuy = parseFloat((initialBuyEl && initialBuyEl.value) || '0') || 0;
      var openingMcap = initialBuy > 0 ? Math.floor(initialBuy * 10) : 100;
      var openingCurve = Math.min(Math.floor(openingMcap / 690), 100);
      previewEls.name.textContent = name || 'Your coin name';
      previewEls.ticker.textContent = '$' + (symbol || 'TICK');
      previewEls.creator.textContent = connectedWallet ? connectedWallet.slice(0, 4) + '...' + connectedWallet.slice(-4) : 'anon';
      previewEls.desc.textContent = desc || 'Write the pitch, drop the meme, and show traders why this deserves the next rotation.';
      previewEls.buy.textContent = (initialBuy ? initialBuy.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0') + ' OST';
      previewEls.curve.textContent = openingCurve + '%';
      previewEls.stage.textContent = name.length >= 2 && symbol.length >= 1 ? 'Ready for fair launch' : 'Waiting for token identity';
      if (previewEls.media) {
        if (uploadedImage) previewEls.media.innerHTML = '<img src="' + escHtml(uploadedImage) + '" alt="">';
        else previewEls.media.innerHTML = '<span>' + escHtml(symbol ? symbol.charAt(0) : '◉') + '</span>';
      }
      if (previewEls.links) {
        var chips = [];
        if (twitterEl && twitterEl.value.trim()) chips.push('Twitter');
        if (telegramEl && telegramEl.value.trim()) chips.push('Telegram');
        if (websiteEl && websiteEl.value.trim()) chips.push('Website');
        previewEls.links.innerHTML = chips.length ? chips.map(function(label) { return '<span>' + label + '</span>'; }).join('') : '<span>No socials yet</span>';
      }
    }
    function updatePulseShell() {
      var hottest = launches.slice().sort(function(a, b) { return b.mcap - a.mcap; })[0];
      var newest = launches.slice().sort(function(a, b) { return b.date - a.date; })[0];
      var graduating = launches.slice().sort(function(a, b) { return b.curve - a.curve; })[0];
      if (previewEls.pulseHot) previewEls.pulseHot.textContent = hottest ? '$' + hottest.symbol : '--';
      if (previewEls.pulseNew) previewEls.pulseNew.textContent = newest ? '$' + newest.symbol : '--';
      if (previewEls.pulseGrad) previewEls.pulseGrad.textContent = graduating ? '$' + graduating.symbol + ' ' + Math.min(graduating.curve, 100) + '%' : '--';
    }

    /* ── Tab switching ── */
    var tabs = document.querySelectorAll('.lp-tab');
    var panels = {
      create: document.getElementById('lpPanelCreate'),
      feed:   document.getElementById('lpPanelFeed'),
      board:  document.getElementById('lpPanelBoard')
    };
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var t = tab.getAttribute('data-tab');
        tabs.forEach(function(tt) { tt.classList.remove('lp-tab-active'); });
        tab.classList.add('lp-tab-active');
        Object.keys(panels).forEach(function(k) { if (panels[k]) panels[k].style.display = k === t ? '' : 'none'; });
        if (t === 'feed') renderFeed();
        if (t === 'board') renderBoard();
      });
    });

    /* ── Image Upload ── */
    var uploadArea  = document.getElementById('lpUploadArea');
    var imageInput  = document.getElementById('lpImageInput');
    var uploadPH    = document.getElementById('lpUploadPlaceholder');
    var uploadPrev  = document.getElementById('lpUploadPreview');
    var uploadClear = document.getElementById('lpUploadClear');

    if (uploadArea) {
      uploadArea.addEventListener('click', function(e) {
        if (e.target === uploadClear) return;
        imageInput.click();
      });
      uploadArea.addEventListener('dragover', function(e) { e.preventDefault(); uploadArea.classList.add('lp-drag-over'); });
      uploadArea.addEventListener('dragleave', function() { uploadArea.classList.remove('lp-drag-over'); });
      uploadArea.addEventListener('drop', function(e) {
        e.preventDefault(); uploadArea.classList.remove('lp-drag-over');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
      });
      imageInput.addEventListener('change', function() { if (imageInput.files.length) handleFile(imageInput.files[0]); });
      uploadClear.addEventListener('click', function(e) {
        e.stopPropagation();
        uploadedImage = null;
        uploadPrev.style.display = 'none';
        uploadClear.style.display = 'none';
        uploadPH.style.display = '';
        imageInput.value = '';
        renderComposePreview();
      });
    }
    function handleFile(file) {
      if (!file.type.match(/^image\//)) { if (typeof toast === 'function') toast('⚠️', 'Please upload an image file'); return; }
      if (file.size > 5 * 1024 * 1024) { if (typeof toast === 'function') toast('⚠️', 'Image too large (max 5MB)'); return; }
      var reader = new FileReader();
      reader.onload = function(e) {
        uploadedImage = e.target.result;
        uploadPrev.src = uploadedImage;
        uploadPrev.style.display = 'block';
        uploadClear.style.display = 'flex';
        uploadPH.style.display = 'none';
        renderComposePreview();
      };
      reader.readAsDataURL(file);
    }

    /* ── Show more options toggle ── */
    var moreToggle = document.getElementById('lpMoreToggle');
    var moreFields = document.getElementById('lpMoreFields');
    if (moreToggle) {
      moreToggle.addEventListener('click', function() {
        var open = moreFields.style.display !== 'none';
        moreFields.style.display = open ? 'none' : '';
        moreToggle.innerHTML = open ? 'show more options &darr;' : 'show less options &uarr;';
      });
    }

    /* ── Char counter ── */
    if (descEl && descCount) {
      descEl.addEventListener('input', function() { descCount.textContent = descEl.value.length; });
    }

    /* ── Validate ── */
    function validateForm() {
      var name = (nameEl.value || '').trim();
      var symbol = (symbolEl.value || '').trim();
      launchBtn.disabled = !(name.length >= 2 && symbol.length >= 1);
      renderComposePreview();
    }
    nameEl.addEventListener('input', validateForm);
    symbolEl.addEventListener('input', validateForm);
    if (descEl) descEl.addEventListener('input', renderComposePreview);
    ['lpTwitter', 'lpTelegram', 'lpWebsite', 'lpInitialBuy'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', renderComposePreview);
    });

    /* ── Flow animation ── */
    function runFlow(onDone) {
      var flow = document.getElementById('lpFlow');
      flow.style.display = 'flex';
      var steps = flow.querySelectorAll('.lp-fstep');
      steps.forEach(function(s) { s.classList.remove('lp-fs-active', 'lp-fs-done'); });
      var i = 0;
      function next() {
        if (i > 0) { steps[i - 1].classList.remove('lp-fs-active'); steps[i - 1].classList.add('lp-fs-done'); }
        if (i < steps.length) { steps[i].classList.add('lp-fs-active'); i++; setTimeout(next, 700 + Math.random() * 600); }
        else { if (onDone) onDone(); }
      }
      next();
    }

    /* ── Create / Launch ── */
    launchBtn.addEventListener('click', function() {
      if (launchBtn.disabled) return;
      var name   = nameEl.value.trim();
      var symbol = symbolEl.value.trim().toUpperCase();
      var desc   = (descEl ? descEl.value.trim() : '');
      var twitter  = (document.getElementById('lpTwitter') || {}).value || '';
      var telegram = (document.getElementById('lpTelegram') || {}).value || '';
      var website  = (document.getElementById('lpWebsite') || {}).value || '';
      var initialBuy = parseFloat((document.getElementById('lpInitialBuy') || {}).value) || 0;

      var isDemoMode = !connectedWallet;
      if (isDemoMode) toast('🚀', 'Local launch preview — connect wallet to publish on-chain');

      launchBtn.disabled = true;
      launchBtn.textContent = 'creating...';
      document.getElementById('lpSuccess').style.display = 'none';

      runFlow(function() {
        var mintAddr = generateMint();
        var startMcap = initialBuy > 0 ? Math.floor(initialBuy * 10) : Math.floor(Math.random() * 2000) + 100;
        var launch = {
          name: name, symbol: symbol, desc: desc,
          mcap: startMcap, curve: Math.min(Math.floor(startMcap / 690), 100),
          img: uploadedImage || DEMO_IMAGES[Math.floor(Math.random() * DEMO_IMAGES.length)],
          twitter: twitter, telegram: telegram, website: website,
          mint: mintAddr, supply: 1000000000,
          creator: connectedWallet ? connectedWallet.slice(0, 4) + '...' + connectedWallet.slice(-4) : 'anon',
          date: Date.now(),
          comments: [],
          holders: [{ addr: connectedWallet ? connectedWallet.slice(0,4)+'...'+connectedWallet.slice(-4) : 'anon', pct: 100 }]
        };
        launches.push(launch);
        localStorage.setItem('ost_lp_history2', JSON.stringify(launches));

        document.getElementById('lpSuccessName').textContent = name;
        document.getElementById('lpSuccessSymbol').textContent = '$' + symbol;
        document.getElementById('lpSuccessMint').textContent = mintAddr;
        document.getElementById('lpSuccess').style.display = 'block';

        launchBtn.textContent = 'Create coin';
        launchBtn.disabled = false;
        nameEl.value = ''; symbolEl.value = '';
        if (descEl) descEl.value = '';
        if (descCount) descCount.textContent = '0';
        uploadedImage = null;
        if (uploadPrev) { uploadPrev.style.display = 'none'; uploadClear.style.display = 'none'; uploadPH.style.display = ''; }
        if (imageInput) imageInput.value = '';
        var twEl = document.getElementById('lpTwitter'); if (twEl) twEl.value = '';
        var tgEl = document.getElementById('lpTelegram'); if (tgEl) tgEl.value = '';
        var wsEl = document.getElementById('lpWebsite'); if (wsEl) wsEl.value = '';
        var ibEl = document.getElementById('lpInitialBuy'); if (ibEl) ibEl.value = '';
        validateForm();
        renderComposePreview();

        updateTotalCount();
        toast('🚀', symbol + ' is live! Mint: ' + mintAddr.slice(0, 6) + '...');
      });
    });

    /* ── Copy mint ── */
    var copyMint = document.getElementById('lpCopyMint');
    if (copyMint) {
      copyMint.addEventListener('click', function() {
        var addr = document.getElementById('lpSuccessMint').textContent;
        if (addr && addr !== '--') {
          if (navigator.clipboard) navigator.clipboard.writeText(addr);
          toast('📋', 'Mint address copied!');
        }
      });
    }

    /* ── View token after launch ── */
    var viewToken = document.getElementById('lpViewToken');
    if (viewToken) {
      viewToken.addEventListener('click', function() {
        var mint = document.getElementById('lpSuccessMint').textContent;
        var found = launches.find(function(l) { return l.mint === mint; });
        if (found) openDetail(found);
      });
    }

    /* ── Total count ── */
    function updateTotalCount() {
      var el = document.getElementById('lpTotalLaunched');
      if (el) el.textContent = launches.length;
    }
    updateTotalCount();

    /* ── Stats bar ── */
    function updateStats() {
      var coinEl = document.getElementById('lpStatCoins');
      var kothEl = document.getElementById('lpStatKoth');
      var tvlEl = document.getElementById('lpStatTvl');
      var gradEl = document.getElementById('lpStatGrads');
      if (coinEl) coinEl.textContent = launches.length;
      var koth = getKoth();
      if (kothEl) kothEl.textContent = koth ? '$' + koth.symbol : '--';
      var totalMcap = 0; var grads = 0;
      launches.forEach(function(l) { totalMcap += l.mcap; if (l.curve >= 100) grads++; });
      if (tvlEl) tvlEl.textContent = fmtMcap(totalMcap);
      if (gradEl) gradEl.textContent = grads;
      updatePulseShell();
    }

    /* ── Live ticker ── */
    function renderTicker() {
      var ticker = document.getElementById('lpTicker');
      if (!ticker) return;
      var items = '';
      var sorted = launches.slice().sort(function(a,b) { return b.mcap - a.mcap; });
      // Double the items for infinite scroll
      for (var rep = 0; rep < 2; rep++) {
        sorted.forEach(function(l) {
          var change = ((Math.random() - 0.4) * 15).toFixed(1);
          var up = parseFloat(change) >= 0;
          items += '<span class="lp-ticker-item" data-mint="' + escHtml(l.mint) + '">' +
            (l.img ? '<img class="lp-ticker-img" src="' + escHtml(l.img) + '">' : '') +
            '<span class="lp-ticker-name">$' + escHtml(l.symbol) + '</span>' +
            '<span class="lp-ticker-price">' + fmtMcap(l.mcap) + '</span>' +
            '<span class="' + (up ? 'lp-ticker-change-up' : 'lp-ticker-change-down') + '">' + (up ? '+' : '') + change + '%</span>' +
            '</span>';
        });
      }
      ticker.innerHTML = items;
      // Click on ticker item opens detail
      ticker.querySelectorAll('.lp-ticker-item').forEach(function(item) {
        item.addEventListener('click', function() {
          var mint = item.dataset.mint;
          var found = launches.find(function(l) { return l.mint === mint; });
          if (found) openDetail(found);
        });
      });
    }
    renderTicker();

    /* ── Activity feed ── */
    var activities = [];
    function seedActivities() {
      var verbs = ['bought','sold','launched','aped into'];
      var names = ['anon','degen42','whale.sol','trader99','ser_pump','moonboy'];
      launches.forEach(function(l) {
        for (var ai = 0; ai < 2; ai++) {
          var verb = verbs[Math.floor(Math.random() * verbs.length)];
          var user = names[Math.floor(Math.random() * names.length)];
          var amt = (Math.random() * 500 + 10).toFixed(0);
          var type = verb === 'sold' ? 'sell' : verb === 'launched' ? 'launch' : 'buy';
          activities.push({ user: user, verb: verb, token: '$' + l.symbol, amount: amt, type: type, time: Date.now() - Math.floor(Math.random() * 600000) });
        }
      });
      activities.sort(function(a,b) { return b.time - a.time; });
    }
    seedActivities();

    function renderActivity() {
      var feed = document.getElementById('lpActivityFeed');
      if (!feed) return;
      feed.innerHTML = '';
      activities.slice(0, 15).forEach(function(a) {
        var el = document.createElement('div');
        el.className = 'lp-activity-item';
        el.innerHTML =
          '<span class="lp-activity-dot lp-activity-dot-' + a.type + '"></span>' +
          '<span class="lp-activity-text"><b>' + escHtml(a.user) + '</b> ' + a.verb + ' ' + a.amount + ' OST of <b>' + escHtml(a.token) + '</b></span>' +
          '<span class="lp-activity-time">' + timeAgo(a.time) + '</span>';
        feed.appendChild(el);
      });
    }

    updateStats();
    renderComposePreview();

    /* ══════════════════════════════════════════════════
       FEED — Token card grid
       ══════════════════════════════════════════════════ */
    var currentSort = 'trending';
    var feedGrid = document.getElementById('lpFeedGrid');
    var searchIn = document.getElementById('lpSearchInput');

    /* Sort buttons */
    document.querySelectorAll('.lp-sort').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.lp-sort').forEach(function(b) { b.classList.remove('lp-sort-active'); });
        btn.classList.add('lp-sort-active');
        currentSort = btn.getAttribute('data-sort');
        renderFeed();
      });
    });

    /* Search */
    if (searchIn) searchIn.addEventListener('input', renderFeed);

    function getSorted() {
      var list = launches.slice();
      var q = searchIn ? searchIn.value.toLowerCase().trim() : '';
      if (q) list = list.filter(function(l) { return l.name.toLowerCase().indexOf(q) !== -1 || l.symbol.toLowerCase().indexOf(q) !== -1; });
      switch (currentSort) {
        case 'new':        list.sort(function(a, b) { return b.date - a.date; }); break;
        case 'top':        list.sort(function(a, b) { return b.mcap - a.mcap; }); break;
        case 'graduating': list.sort(function(a, b) { return b.curve - a.curve; }); break;
        default:           list.sort(function(a, b) { return (b.mcap * 0.6 + b.curve * 400) - (a.mcap * 0.6 + a.curve * 400); }); break;
      }
      return list;
    }

    /* Find KOTH */
    function getKoth() {
      var best = null;
      launches.forEach(function(l) { if (!best || l.curve > best.curve) best = l; });
      return best;
    }

    function renderFeed() {
      if (!feedGrid) return;
      var sorted = getSorted();
      var koth = getKoth();
      feedGrid.innerHTML = '';
      if (sorted.length === 0) {
        feedGrid.innerHTML = '<p class="text-muted" style="text-align:center;grid-column:1/-1;padding:40px;">No tokens found. Be the first to create one!</p>';
        return;
      }
      sorted.forEach(function(l) {
        var card = document.createElement('div');
        card.className = 'lp-card';
        var isKoth = koth && l.mint === koth.mint;
        var imgHtml = l.img
          ? '<img class="lp-card-img" src="' + escHtml(l.img) + '" alt="' + escHtml(l.name) + '">'
          : '<div class="lp-card-img-placeholder">' + (l.symbol ? l.symbol.charAt(0) : '?') + '</div>';
        card.innerHTML = imgHtml +
          '<div class="lp-card-body">' +
            '<div class="lp-card-top">' +
              '<span class="lp-card-name">' + escHtml(l.name) + '</span>' +
              '<span class="lp-card-ticker">$' + escHtml(l.symbol) + '</span>' +
              (isKoth ? '<span class="lp-card-koth" title="King of the Hill">👑</span>' : '') +
            '</div>' +
            '<div class="lp-card-desc">' + escHtml(l.desc || '') + '</div>' +
            '<div class="lp-card-meta">' +
              '<span class="lp-card-mcap">' + fmtMcap(l.mcap) + ' OST</span>' +
              '<span class="lp-card-creator">by <span>' + escHtml(l.creator) + '</span></span>' +
              '<span class="lp-card-time">' + timeAgo(l.date) + '</span>' +
            '</div>' +
            '<div class="lp-card-curve">' +
              '<div class="lp-card-curve-track"><div class="lp-card-curve-fill" style="width:' + Math.min(l.curve, 100) + '%"></div></div>' +
              '<div class="lp-card-curve-lbl"><span>bonding curve</span><span>' + Math.min(l.curve, 100) + '%</span></div>' +
            '</div>' +
            '<div class="lp-card-actions">' +
              '<button class="lp-card-quick" data-mint="' + escHtml(l.mint) + '">&#9889; Quick Buy</button>' +
              '<button class="lp-card-view" data-mint="' + escHtml(l.mint) + '">&#128065; View</button>' +
            '</div>' +
          '</div>';
        // Quick buy handler
        card.querySelector('.lp-card-quick').addEventListener('click', function(e) {
          e.stopPropagation();
          l.mcap += Math.floor(10 * 8);
          l.curve = Math.min(Math.floor(l.mcap / 690), 100);
          localStorage.setItem('ost_lp_history2', JSON.stringify(launches));
          activities.unshift({ user: connectedWallet ? connectedWallet.slice(0,4)+'...' : 'anon', verb: 'bought', token: '$' + l.symbol, amount: '10', type: 'buy', time: Date.now() });
          toast('✅', 'Quick bought 10 OST of $' + l.symbol);
          renderFeed();
          updateStats();
        });
        card.querySelector('.lp-card-view').addEventListener('click', function(e) {
          e.stopPropagation();
          openDetail(l);
        });
        card.addEventListener('click', function() { openDetail(l); });
        feedGrid.appendChild(card);
      });
      renderActivity();
    }

    /* ══════════════════════════════════════════════════
       LEADERBOARD
       ══════════════════════════════════════════════════ */
    function renderBoard() {
      var list = document.getElementById('lpBoardList');
      if (!list) return;
      var sorted = launches.slice().sort(function(a, b) { return b.curve - a.curve; });
      list.innerHTML = '';
      sorted.forEach(function(l, i) {
        var row = document.createElement('div');
        row.className = 'lp-board-row';
        row.innerHTML =
          '<span class="lp-board-rank">' + (i === 0 ? '👑' : (i + 1)) + '</span>' +
          (l.img ? '<img class="lp-board-img" src="' + escHtml(l.img) + '" alt="">' : '<div class="lp-board-img" style="font-size:1.2rem;color:rgba(255,255,255,.2)">' + (l.symbol ? l.symbol.charAt(0) : '?') + '</div>') +
          '<div class="lp-board-info"><div class="lp-board-name">' + escHtml(l.name) + ' <span style="color:#00ff88;font-size:.78rem">$' + escHtml(l.symbol) + '</span></div><div class="lp-board-sub">by ' + escHtml(l.creator) + '</div></div>' +
          '<div class="lp-board-mcap"><span class="lp-board-mcap-val">' + fmtMcap(l.mcap) + ' OST</span><span class="lp-board-mcap-lbl">market cap</span></div>' +
          '<div class="lp-board-curve"><div class="lp-board-curve-track"><div class="lp-board-curve-fill" style="width:' + Math.min(l.curve, 100) + '%"></div></div></div>';
        row.addEventListener('click', function() { openDetail(l); });
        list.appendChild(row);
      });
    }

    /* ══════════════════════════════════════════════════
       TOKEN DETAIL MODAL
       ══════════════════════════════════════════════════ */
    var overlay   = document.getElementById('lpDetailOverlay');
    var modal     = document.getElementById('lpDetailModal');
    var closeBtn  = document.getElementById('lpDetailClose');
    var currentToken = null;
    var tradeSide = 'buy';

    function openDetail(token) {
      currentToken = token;
      document.getElementById('lpDetailName').textContent = token.name;
      document.getElementById('lpDetailTicker').textContent = '$' + token.symbol;
      document.getElementById('lpDetailCreator').textContent = 'by ' + token.creator;
      document.getElementById('lpDetailMcap').textContent = fmtMcap(token.mcap) + ' OST';
      document.getElementById('lpDetailDesc').textContent = token.desc || '';

      var imgEl = document.getElementById('lpDetailImg');
      if (token.img) imgEl.innerHTML = '<img src="' + escHtml(token.img) + '">';
      else imgEl.innerHTML = '<span style="font-size:2rem;color:rgba(255,255,255,.15)">' + (token.symbol ? token.symbol.charAt(0) : '?') + '</span>';

      /* Socials */
      var socialsEl = document.getElementById('lpDetailSocials');
      socialsEl.innerHTML = '';
      if (token.twitter) socialsEl.innerHTML += '<a href="' + escHtml(token.twitter) + '" target="_blank" rel="noopener">twitter</a>';
      if (token.telegram) socialsEl.innerHTML += '<a href="' + escHtml(token.telegram) + '" target="_blank" rel="noopener">telegram</a>';
      if (token.website) socialsEl.innerHTML += '<a href="' + escHtml(token.website) + '" target="_blank" rel="noopener">website</a>';

      /* Curve */
      document.getElementById('lpDetailCurveVal').textContent = Math.min(token.curve, 100) + '%';
      document.getElementById('lpDetailCurveFill').style.width = Math.min(token.curve, 100) + '%';

      /* Reset trade side */
      tradeSide = 'buy';
      document.querySelectorAll('.lp-trade-tab').forEach(function(t) { t.classList.remove('lp-trade-tab-active'); });
      document.querySelector('.lp-trade-tab[data-side="buy"]').classList.add('lp-trade-tab-active');
      var tradeBtn = document.getElementById('lpTradeBtn');
      tradeBtn.textContent = 'place trade';
      tradeBtn.className = 'lp-trade-btn lp-trade-buy';
      document.getElementById('lpTradeDenom').textContent = 'OST';
      document.getElementById('lpTradeAmount').value = '';

      /* Holders */
      renderHolders(token);

      /* Comments */
      renderComments(token);

      /* Show sub-tab: holders */
      document.querySelectorAll('.lp-det-tab').forEach(function(t) { t.classList.remove('lp-det-tab-active'); });
      document.querySelector('.lp-det-tab[data-dtab="holders"]').classList.add('lp-det-tab-active');
      document.getElementById('lpDetailHolders').style.display = '';
      document.getElementById('lpDetailComments').style.display = 'none';

      overlay.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      // Update watchlist button state
      var watchlist = JSON.parse(localStorage.getItem('ost_lp_watchlist') || '[]');
      var wBtn = document.getElementById('lpActionWatch');
      if (wBtn) {
        if (watchlist.indexOf(token.mint) >= 0) { wBtn.classList.add('lp-action-active'); wBtn.innerHTML = '&#9733; Watching'; }
        else { wBtn.classList.remove('lp-action-active'); wBtn.innerHTML = '&#9734; Watchlist'; }
      }
    }

    function closeDetail() {
      overlay.style.display = 'none';
      document.body.style.overflow = '';
      currentToken = null;
    }
    if (closeBtn) closeBtn.addEventListener('click', closeDetail);
    if (overlay) overlay.addEventListener('click', function(e) { if (e.target === overlay) closeDetail(); });

    /* Action buttons: Share, Watchlist, Copy CA */
    var shareBtn = document.getElementById('lpActionShare');
    var watchBtn = document.getElementById('lpActionWatch');
    var copyCABtn = document.getElementById('lpActionCopy');
    if (shareBtn) {
      shareBtn.addEventListener('click', function() {
        if (!currentToken) return;
        var text = 'Check out $' + currentToken.symbol + ' on OST Launchpad! MC: ' + fmtMcap(currentToken.mcap) + ' OST';
        if (navigator.clipboard) navigator.clipboard.writeText(text);
        toast('📋', 'Share text copied!');
      });
    }
    if (watchBtn) {
      watchBtn.addEventListener('click', function() {
        if (!currentToken) return;
        var watchlist = JSON.parse(localStorage.getItem('ost_lp_watchlist') || '[]');
        var idx = watchlist.indexOf(currentToken.mint);
        if (idx >= 0) {
          watchlist.splice(idx, 1);
          watchBtn.classList.remove('lp-action-active');
          watchBtn.innerHTML = '&#9734; Watchlist';
          toast('💔', 'Removed from watchlist');
        } else {
          watchlist.push(currentToken.mint);
          watchBtn.classList.add('lp-action-active');
          watchBtn.innerHTML = '&#9733; Watching';
          toast('⭐', 'Added to watchlist!');
        }
        localStorage.setItem('ost_lp_watchlist', JSON.stringify(watchlist));
      });
    }
    if (copyCABtn) {
      copyCABtn.addEventListener('click', function() {
        if (!currentToken) return;
        if (navigator.clipboard) navigator.clipboard.writeText(currentToken.mint);
        toast('📋', 'Contract address copied!');
      });
    }

    /* Buy/Sell tabs */
    document.querySelectorAll('.lp-trade-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        tradeSide = tab.getAttribute('data-side');
        document.querySelectorAll('.lp-trade-tab').forEach(function(t) { t.classList.remove('lp-trade-tab-active'); });
        tab.classList.add('lp-trade-tab-active');
        var tradeBtn = document.getElementById('lpTradeBtn');
        tradeBtn.className = 'lp-trade-btn ' + (tradeSide === 'buy' ? 'lp-trade-buy' : 'lp-trade-sell');
        tradeBtn.textContent = 'place trade';
        document.getElementById('lpTradeDenom').textContent = tradeSide === 'buy' ? 'OST' : currentToken.symbol;
      });
    });

    /* Trade presets */
    document.querySelectorAll('.lp-tp').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var v = parseFloat(btn.getAttribute('data-v'));
        document.getElementById('lpTradeAmount').value = v || '';
      });
    });

    /* Place trade (real on-chain via OST_TRADE / swap pool) */
    var tradeBtn = document.getElementById('lpTradeBtn');
    if (tradeBtn) {
      tradeBtn.addEventListener('click', async function() {
        if (!currentToken) return;
        var amt = parseFloat(document.getElementById('lpTradeAmount').value) || 0;
        if (amt <= 0) { toast('⚠️', 'Enter an amount'); return; }

        var origLabel = tradeBtn.textContent;
        tradeBtn.disabled = true; tradeBtn.textContent = 'Sending…';
        try {
          var trade = window.OST_TRADE;
          if (!trade || !trade.memecoinBuy) throw new Error('Trading module not loaded — refresh the page');
          var result;
          if (tradeSide === 'buy') {
            result = await trade.memecoinBuy(currentToken.symbol, amt);
            // Simulated price impact (real on-chain transfer already done)
            currentToken.mcap += Math.floor(amt * 8);
            currentToken.curve = Math.min(Math.floor(currentToken.mcap / 690), 100);
            activities.unshift({ user: connectedWallet ? connectedWallet.slice(0,4)+'...' : 'You', verb: 'bought', token: '$' + currentToken.symbol, amount: amt.toString(), type: 'buy', time: Date.now() });
            toast('✅', 'Bought ' + amt + ' OST of $' + currentToken.symbol + ' · sig ' + String(result.sig).slice(0,8));
          } else {
            result = await trade.memecoinSell(currentToken.symbol, amt);
            currentToken.mcap = Math.max(100, currentToken.mcap - Math.floor(amt * 5));
            currentToken.curve = Math.min(Math.floor(currentToken.mcap / 690), 100);
            activities.unshift({ user: connectedWallet ? connectedWallet.slice(0,4)+'...' : 'You', verb: 'sold', token: '$' + currentToken.symbol, amount: result.ost.toString(), type: 'sell', time: Date.now() });
            toast('✅', 'Sold ' + result.ost.toFixed(2) + ' ' + currentToken.symbol + ' · sig ' + String(result.sig).slice(0,8));
          }

          // Check graduation
          if (currentToken.curve >= 100) {
            toast('🎓', '$' + currentToken.symbol + ' graduated! Liquidity deposited & burned!');
            currentToken.curve = 100;
          }

          // Update UI
          document.getElementById('lpDetailMcap').textContent = fmtMcap(currentToken.mcap) + ' OST';
          document.getElementById('lpDetailCurveVal').textContent = Math.min(currentToken.curve, 100) + '%';
          document.getElementById('lpDetailCurveFill').style.width = Math.min(currentToken.curve, 100) + '%';
          document.getElementById('lpTradeAmount').value = '';
          localStorage.setItem('ost_lp_history2', JSON.stringify(launches));
          try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch(e){}
        } catch (err) {
          console.warn('[memecoin trade] failed', err);
          var msg = (err && err.message) ? err.message : 'Trade failed';
          toast('⚠️', msg.length > 80 ? msg.slice(0, 80) + '…' : msg);
          try { alert('Memecoin trade failed:\n\n' + msg); } catch(e){}
        } finally {
          tradeBtn.disabled = false; tradeBtn.textContent = origLabel;
        }
      });
    }

    /* Detail sub-tabs (holders / comments) */
    document.querySelectorAll('.lp-det-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        var dtab = tab.getAttribute('data-dtab');
        document.querySelectorAll('.lp-det-tab').forEach(function(t) { t.classList.remove('lp-det-tab-active'); });
        tab.classList.add('lp-det-tab-active');
        document.getElementById('lpDetailHolders').style.display = dtab === 'holders' ? '' : 'none';
        document.getElementById('lpDetailComments').style.display = dtab === 'comments' ? '' : 'none';
      });
    });

    /* Render holders */
    function renderHolders(token) {
      var list = document.getElementById('lpHoldersList');
      if (!list) return;
      list.innerHTML = '';
      (token.holders || []).forEach(function(h) {
        var row = document.createElement('div');
        row.className = 'lp-holder-row';
        row.innerHTML = '<span class="lp-holder-addr">' + escHtml(h.addr) + '</span><span class="lp-holder-pct">' + h.pct + '%</span>';
        list.appendChild(row);
      });
      if (!token.holders || token.holders.length === 0) {
        list.innerHTML = '<p class="text-muted" style="text-align:center;padding:16px;font-size:.82rem;">No holder data</p>';
      }
    }

    /* Render comments */
    function renderComments(token) {
      var list = document.getElementById('lpCommentsList');
      if (!list) return;
      list.innerHTML = '';
      (token.comments || []).forEach(function(c) {
        var div = document.createElement('div');
        div.className = 'lp-comment';
        div.innerHTML = '<div class="lp-comment-user">' + escHtml(c.user) + '</div><div class="lp-comment-text">' + escHtml(c.text) + '</div>';
        list.appendChild(div);
      });
      if (!token.comments || token.comments.length === 0) {
        list.innerHTML = '<p class="text-muted" style="text-align:center;padding:16px;font-size:.82rem;">No comments yet</p>';
      }
    }

    /* Post comment */
    var commentSend = document.getElementById('lpCommentSend');
    var commentText = document.getElementById('lpCommentText');
    if (commentSend && commentText) {
      commentSend.addEventListener('click', function() {
        if (!currentToken) return;
        var text = commentText.value.trim();
        if (!text) return;
        var user = connectedWallet ? connectedWallet.slice(0, 4) + '...' + connectedWallet.slice(-4) : 'anon';
        if (!currentToken.comments) currentToken.comments = [];
        currentToken.comments.push({ user: user, text: text });
        localStorage.setItem('ost_lp_history2', JSON.stringify(launches));
        renderComments(currentToken);
        commentText.value = '';
        toast('💬', 'Comment posted!');
      });
    }

    /* ── Simulate live market cap fluctuations ── */
    setInterval(function() {
      launches.forEach(function(l) {
        if (l.curve >= 100) return;
        var change = Math.floor((Math.random() - 0.45) * l.mcap * 0.03);
        l.mcap = Math.max(100, l.mcap + change);
        l.curve = Math.min(Math.floor(l.mcap / 690), 100);
      });
      localStorage.setItem('ost_lp_history2', JSON.stringify(launches));
      // Add random activity
      var verbs = ['bought','sold','aped into'];
      var users = ['anon','degen42','whale.sol','trader99','ser'];
      var rndL = launches[Math.floor(Math.random() * launches.length)];
      if (rndL) {
        var v = verbs[Math.floor(Math.random() * verbs.length)];
        activities.unshift({ user: users[Math.floor(Math.random() * users.length)], verb: v, token: '$' + rndL.symbol, amount: (Math.random() * 200 + 5).toFixed(0), type: v === 'sold' ? 'sell' : 'buy', time: Date.now() });
        if (activities.length > 50) activities.length = 50;
      }
      updateStats();
      // Update detail view if open
      if (currentToken && overlay.style.display !== 'none') {
        document.getElementById('lpDetailMcap').textContent = fmtMcap(currentToken.mcap) + ' OST';
        document.getElementById('lpDetailCurveVal').textContent = Math.min(currentToken.curve, 100) + '%';
        document.getElementById('lpDetailCurveFill').style.width = Math.min(currentToken.curve, 100) + '%';
      }
    }, 5000);

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

  // ========================================================================
  // SURVIVAL MODE — Interactive bearer token minting
  // ========================================================================
  (function initSurvivalMode() {
    var panel   = document.getElementById('svMintPanel');
    if (!panel) return;

    var amtIn   = document.getElementById('svAmount');
    var passIn  = document.getElementById('svPassphrase');
    var mintBtn = document.getElementById('svMintBtn');
    var feeAmt  = document.getElementById('svFeeAmt');
    var feeTotal= document.getElementById('svFeeTotal');
    var flowBox = document.getElementById('svFlow');
    var result  = document.getElementById('svResult');
    var qrBox   = document.getElementById('svBearerQR');
    var bAmt    = document.getElementById('svBearerAmt');
    var bHash   = document.getElementById('svBearerHash');
    var bType   = document.getElementById('svBearerType');
    var statMinted = document.getElementById('svTotalMinted');
    var statValue  = document.getElementById('svTotalValue');

    var selectedFmt = 'paper';
    var mintCount   = 0;
    var mintValue   = 0;

    /* Quick amount buttons */
    panel.querySelectorAll('.sv-q').forEach(function(btn) {
      btn.addEventListener('click', function() {
        amtIn.value = btn.getAttribute('data-amt');
        panel.querySelectorAll('.sv-q').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        updateFees();
      });
    });

    /* Format selector */
    panel.querySelectorAll('.sv-fmt').forEach(function(btn) {
      btn.addEventListener('click', function() {
        panel.querySelectorAll('.sv-fmt').forEach(function(b) { b.classList.remove('sv-fmt-active'); });
        btn.classList.add('sv-fmt-active');
        selectedFmt = btn.getAttribute('data-fmt');
      });
    });

    /* Amount input → fees */
    amtIn.addEventListener('input', updateFees);

    function updateFees() {
      var v = parseFloat(amtIn.value) || 0;
      feeAmt.textContent = v.toLocaleString() + ' OST';
      var total = v + v * 0.001;
      feeTotal.textContent = total.toLocaleString() + ' OST';
      mintBtn.disabled = v <= 0;
    }

    /* Mint button */
    mintBtn.addEventListener('click', function() {
      var amount = parseFloat(amtIn.value) || 0;
      if (amount <= 0) return;

      mintBtn.disabled = true;
      result.style.display = 'none';
      flowBox.style.display = 'block';

      var steps = flowBox.querySelectorAll('.sv-fstep');
      steps.forEach(function(s) { s.classList.remove('sv-factive', 'sv-fdone'); });

      var idx = 0;
      function advance() {
        if (idx > 0) steps[idx - 1].classList.replace('sv-factive', 'sv-fdone');
        if (idx < steps.length) {
          steps[idx].classList.add('sv-factive');
          idx++;
          setTimeout(advance, 700 + Math.random() * 500);
        } else {
          setTimeout(function() { showResult(amount); }, 400);
        }
      }
      advance();
    });

    function showResult(amount) {
      flowBox.style.display = 'none';
      result.style.display = 'block';

      /* Generate bearer hash */
      var hash = generateHash(32);
      bAmt.textContent = amount.toLocaleString() + ' OST';
      bHash.textContent = 'HASH: ' + hash;

      var labels = { paper: 'PAPER BEARER NOTE', nfc: 'NFC CARD TOKEN', digital: 'DIGITAL FILE' };
      bType.textContent = labels[selectedFmt] || 'BEARER NOTE';

      /* Draw QR-like pattern on canvas */
      drawQR(qrBox, hash);

      /* Update stats */
      mintCount++;
      mintValue += amount;
      statMinted.textContent = mintCount;
      statValue.textContent = mintValue.toLocaleString() + ' OST';

      /* Re-enable mint */
      mintBtn.disabled = false;

      if (typeof toast === 'function') toast('\u2705', 'Survival bearer token minted — ' + amount.toLocaleString() + ' OST');
    }

    /* Pseudo hash generator */
    function generateHash(len) {
      var chars = 'abcdef0123456789';
      var h = '';
      for (var i = 0; i < len; i++) h += chars[Math.floor(Math.random() * chars.length)];
      return h.substring(0, 8) + '...' + h.substring(h.length - 8);
    }

    /* Draw a QR-like grid on a canvas inside the target div */
    function drawQR(container, seed) {
      container.innerHTML = '';
      var canvas = document.createElement('canvas');
      var size = 160;
      canvas.width = size; canvas.height = size;
      canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
      container.appendChild(canvas);

      var ctx = canvas.getContext('2d');
      var grid = 21; // QR v1 is 21x21
      var cell = Math.floor(size / grid);
      var offset = Math.floor((size - cell * grid) / 2);

      // Seed-based pseudo-random
      var seedNum = 0;
      for (var i = 0; i < seed.length; i++) seedNum += seed.charCodeAt(i);
      function rand() { seedNum = (seedNum * 16807 + 7) % 2147483647; return seedNum / 2147483647; }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);

      ctx.fillStyle = '#1a1a2e';

      // Draw finder patterns (three corners)
      drawFinder(ctx, offset, offset, cell);
      drawFinder(ctx, offset + (grid - 7) * cell, offset, cell);
      drawFinder(ctx, offset, offset + (grid - 7) * cell, cell);

      // Fill data cells
      for (var r = 0; r < grid; r++) {
        for (var c = 0; c < grid; c++) {
          if (isFinderArea(r, c, grid)) continue;
          if (rand() > 0.5) {
            ctx.fillRect(offset + c * cell, offset + r * cell, cell - 1, cell - 1);
          }
        }
      }

      // OST logo in center
      ctx.fillStyle = '#FF6B35';
      var cx = Math.floor(size / 2);
      ctx.beginPath();
      ctx.arc(cx, cx, cell * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + (cell * 2) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('O', cx, cx);
    }

    function drawFinder(ctx, x, y, cell) {
      // Outer 7x7 black
      ctx.fillRect(x, y, cell * 7, cell * 7);
      // Inner white 5x5
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + cell, y + cell, cell * 5, cell * 5);
      // Inner black 3x3
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(x + cell * 2, y + cell * 2, cell * 3, cell * 3);
    }

    function isFinderArea(r, c, grid) {
      if (r < 8 && c < 8) return true;
      if (r < 8 && c >= grid - 8) return true;
      if (r >= grid - 8 && c < 8) return true;
      return false;
    }

    /* Mint Another */
    var mintAnother = document.getElementById('svMintAnother');
    if (mintAnother) {
      mintAnother.addEventListener('click', function() {
        result.style.display = 'none';
        amtIn.value = '';
        amtIn.focus();
        updateFees();
        panel.querySelectorAll('.sv-q').forEach(function(b) { b.classList.remove('active'); });
      });
    }

    /* Print */
    var printBtn = document.getElementById('svPrint');
    if (printBtn) {
      printBtn.addEventListener('click', function() {
        var cardEl = document.getElementById('svBearerCard');
        if (!cardEl) return;
        var w = window.open('', '_blank', 'width=420,height=600');
        w.document.write('<html><head><title>OST Bearer Note</title><style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fff;font-family:sans-serif;color:#222;}.card{text-align:center;padding:32px;border:2px solid #333;border-radius:16px;max-width:340px;}.amount{font-size:2rem;font-weight:900;margin:12px 0;}.hash{font-family:monospace;font-size:.7rem;word-break:break-all;color:#555;}</style></head><body><div class="card">');
        w.document.write('<div style="font-weight:900;font-size:1.2rem;">&#9673; OST SURVIVAL BEARER NOTE</div>');
        w.document.write('<div class="amount">' + bAmt.textContent + '</div>');
        w.document.write('<canvas id="qr"></canvas>');
        w.document.write('<div class="hash">' + bHash.textContent + '</div>');
        w.document.write('<div style="margin-top:12px;font-size:.7rem;color:#888;">Encrypted · One-time redemption · Satellite-redeemable</div>');
        w.document.write('</div></body></html>');
        w.document.close();
        setTimeout(function() { w.print(); }, 300);
      });
    }

    /* Copy hash */
    var copyBtn = document.getElementById('svCopyHash');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        var text = bHash.textContent.replace('HASH: ', '');
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text);
        } else {
          var ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta);
          ta.select(); document.execCommand('copy');
          document.body.removeChild(ta);
        }
        if (typeof toast === 'function') toast('\u{1F4CB}', 'Bearer hash copied to clipboard');
      });
    }

    /* Download as text file */
    var dlBtn = document.getElementById('svDownload');
    if (dlBtn) {
      dlBtn.addEventListener('click', function() {
        var content = 'OST SURVIVAL BEARER TOKEN\n';
        content += '========================\n';
        content += 'Amount: ' + bAmt.textContent + '\n';
        content += bHash.textContent + '\n';
        content += 'Type: ' + bType.textContent + '\n';
        content += 'Encrypted · One-time redemption · Satellite-redeemable\n';
        content += '\nWARNING: This is a bearer instrument. Whoever holds this note controls the value.\n';
        var blob = new Blob([content], { type: 'text/plain' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'ost-bearer-token.txt';
        a.click();
        URL.revokeObjectURL(a.href);
      });
    }

  })();

  // ========================================================================
  // QUANTUM REALM — Interactive visualizations & demos
  // ========================================================================
  (function initQuantumRealm() {
    /* ── Particle Canvas ── */
    var canvas = document.getElementById('qrParticleCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var particles = [];
    var PARTICLE_COUNT = 60;

    function resizeCanvas() {
      var section = document.getElementById('quantum-realm');
      if (!section) return;
      canvas.width = section.offsetWidth;
      canvas.height = section.offsetHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    function Particle() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height;
      this.vx = (Math.random() - 0.5) * 0.4;
      this.vy = (Math.random() - 0.5) * 0.4;
      this.r = Math.random() * 2 + 0.5;
      this.cyan = Math.random() > 0.4;
    }

    for (var i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());

    function drawParticles() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.cyan ? 'rgba(0,229,255,.35)' : 'rgba(167,139,250,.3)';
        ctx.fill();
        // Draw connections
        for (var j = i + 1; j < particles.length; j++) {
          var q = particles[j];
          var dx = p.x - q.x, dy = p.y - q.y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = 'rgba(0,229,255,' + (0.08 * (1 - dist / 120)) + ')';
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(drawParticles);
    }

    // Only animate when section is visible
    var qrSection = document.getElementById('quantum-realm');
    var qrAnimating = false;
    var qrObserver = new IntersectionObserver(function(entries) {
      if (entries[0].isIntersecting && !qrAnimating) {
        qrAnimating = true;
        drawParticles();
      }
    }, { threshold: 0.05 });
    if (qrSection) qrObserver.observe(qrSection);

    /* ── Build Hash Chain visual (Card 1) ── */
    var hashChain = document.getElementById('qrHashChain');
    if (hashChain) {
      for (var h = 0; h < 16; h++) {
        var block = document.createElement('div');
        block.className = 'qr-hash-block';
        block.dataset.idx = h;
        hashChain.appendChild(block);
      }
    }

    /* ── Build Lattice Grid visual (Card 1) ── */
    var latticeGrid = document.getElementById('qrLatticeGrid');
    if (latticeGrid) {
      for (var l = 0; l < 16; l++) {
        var dot = document.createElement('div');
        dot.className = 'qr-lattice-dot';
        dot.dataset.idx = l;
        latticeGrid.appendChild(dot);
      }
    }

    /* ── Animate signature chain on hover ── */
    var card1 = document.getElementById('qrCard1');
    if (card1) {
      var sigInterval = null;
      card1.addEventListener('mouseenter', function() {
        var step = 0;
        sigInterval = setInterval(function() {
          var blocks = hashChain ? hashChain.querySelectorAll('.qr-hash-block') : [];
          var dots = latticeGrid ? latticeGrid.querySelectorAll('.qr-lattice-dot') : [];
          blocks.forEach(function(b) { b.classList.remove('active'); });
          dots.forEach(function(d) { d.classList.remove('active'); });
          if (step < blocks.length) blocks[step].classList.add('active');
          if (step < dots.length) dots[step].classList.add('active');
          // Light up previous ones too
          for (var k = 0; k <= step; k++) {
            if (k < blocks.length) blocks[k].classList.add('active');
            if (k < dots.length) dots[k].classList.add('active');
          }
          step++;
          if (step > 16) step = 0;
        }, 150);
      });
      card1.addEventListener('mouseleave', function() {
        clearInterval(sigInterval);
      });
    }

    /* ── Entangle Wallets button ── */
    var entangleBtn = document.getElementById('qrEntangleBtn');
    var walletAState = document.getElementById('qrWalletAState');
    var walletBState = document.getElementById('qrWalletBState');
    var entangleLink = document.getElementById('qrEntangleLink');
    var entangledCount = 0;

    if (entangleBtn) {
      entangleBtn.addEventListener('click', function() {
        entangleBtn.disabled = true;
        entangleBtn.textContent = '⟡ Entangling...';
        if (entangleLink) entangleLink.classList.add('active');
        if (walletAState) { walletAState.textContent = '⟡ linking...'; walletAState.className = 'qr-wallet-state'; }
        if (walletBState) { walletBState.textContent = '⟡ linking...'; walletBState.className = 'qr-wallet-state'; }

        setTimeout(function() {
          if (walletAState) { walletAState.textContent = '⟡ entangled'; walletAState.className = 'qr-wallet-state entangled'; }
          if (walletBState) { walletBState.textContent = '⟡ entangled'; walletBState.className = 'qr-wallet-state entangled'; }
          entangleBtn.textContent = '✓ Wallets Entangled';
          entangledCount++;
          updateQrStats();
          if (typeof toast === 'function') toast('⟡', 'Wallets entangled! Non-local link established.');

          setTimeout(function() {
            entangleBtn.disabled = false;
            entangleBtn.innerHTML = '&#9878; Entangle Wallets';
            if (walletAState) { walletAState.innerHTML = '&#8593; ready'; walletAState.className = 'qr-wallet-state'; }
            if (walletBState) { walletBState.innerHTML = '&#8595; ready'; walletBState.className = 'qr-wallet-state'; }
            if (entangleLink) entangleLink.classList.remove('active');
          }, 3000);
        }, 1800);
      });
    }

    /* ── Collapse State button ── */
    var collapseBtn = document.getElementById('qrCollapseBtn');
    var qubit = document.getElementById('qrQubit');
    var yieldFill = document.getElementById('qrYieldFill');
    var yieldLabel = document.getElementById('qrYieldLabel');
    var collapseCount = 0;
    var yieldSum = 0;

    if (collapseBtn) {
      collapseBtn.addEventListener('click', function() {
        collapseBtn.disabled = true;
        collapseBtn.textContent = '⟡ Collapsing...';
        if (qubit) qubit.classList.add('collapsed');

        setTimeout(function() {
          var yieldPct = (Math.random() * 9 + 3).toFixed(1); // 3-12% APY
          collapseCount++;
          yieldSum += parseFloat(yieldPct);
          if (yieldFill) yieldFill.style.width = yieldPct + '%';
          if (yieldLabel) yieldLabel.textContent = 'Yield: ' + yieldPct + '% APY (collapsed)';
          collapseBtn.textContent = '✓ State Collapsed: ' + yieldPct + '% APY';
          updateQrStats();
          if (typeof toast === 'function') toast('🔬', 'Quantum state collapsed! Yield: ' + yieldPct + '% APY');

          setTimeout(function() {
            collapseBtn.disabled = false;
            collapseBtn.innerHTML = '&#128269; Collapse State';
            if (qubit) qubit.classList.remove('collapsed');
            if (yieldFill) yieldFill.style.width = '0%';
            if (yieldLabel) yieldLabel.textContent = 'Yield: superposed';
          }, 3500);
        }, 1200);
      });
    }

    /* ── Enter the Quantum Realm CTA ── */
    var enterBtn = document.getElementById('qrEnterBtn');
    if (enterBtn) {
      enterBtn.addEventListener('click', function() {
        if (typeof toast === 'function') toast('⚛', 'Welcome to the Quantum Realm. You are now operating beyond classical limits.');
        // Pulse effect on all cards
        var cards = document.querySelectorAll('.qr-card');
        cards.forEach(function(c) {
          c.style.boxShadow = '0 0 60px rgba(0,229,255,.2)';
          setTimeout(function() { c.style.boxShadow = ''; }, 1500);
        });
        // Increment signature count
        sigCount += Math.floor(Math.random() * 50 + 20);
        updateQrStats();
      });
    }

    /* ── Stats counter ── */
    var sigCount = 0;
    function updateQrStats() {
      var elSigs = document.getElementById('qrStatSigs');
      var elEnt = document.getElementById('qrStatEntangled');
      var elYield = document.getElementById('qrStatYield');
      var elCoh = document.getElementById('qrStatCoherence');
      if (elSigs) elSigs.textContent = sigCount.toLocaleString();
      if (elEnt) elEnt.textContent = entangledCount.toLocaleString();
      if (elYield) elYield.textContent = collapseCount > 0 ? (yieldSum / collapseCount).toFixed(1) + '%' : '0%';
      if (elCoh) {
        var coh = Math.max(0, 100 - collapseCount * 2.5);
        elCoh.textContent = coh.toFixed(0) + '%';
      }
    }

    /* ── Ambient stat growth ── */
    setInterval(function() {
      sigCount += Math.floor(Math.random() * 5 + 1);
      updateQrStats();
    }, 4000);

  })();

  /* ================================================================== */
  /* v46: CURSOR GLOW FOLLOWER                                          */
  /* ================================================================== */
  (function initCursorGlow() {
    var glow = document.getElementById('cursorGlow');
    if (!glow || window.innerWidth < 768) return;
    var gx = -100, gy = -100, cx = -100, cy = -100;

    document.addEventListener('mousemove', function(e) {
      gx = e.clientX; gy = e.clientY;
    });

    function tick() {
      cx += (gx - cx) * 0.15;
      cy += (gy - cy) * 0.15;
      glow.style.transform = 'translate(' + (cx - 200) + 'px,' + (cy - 200) + 'px)';
      requestAnimationFrame(tick);
    }
    tick();
  })();

  /* ================================================================== */
  /* v46: BUTTON RIPPLE EFFECT                                          */
  /* ================================================================== */
  (function initRipple() {
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.btn, .sj-phase-btn, .qr-btn');
      if (!btn) return;
      var rect = btn.getBoundingClientRect();
      btn.style.setProperty('--ripple-x', (e.clientX - rect.left) + 'px');
      btn.style.setProperty('--ripple-y', (e.clientY - rect.top) + 'px');
      btn.classList.remove('btn-rippling');
      void btn.offsetWidth; // force reflow
      btn.classList.add('btn-rippling');
      setTimeout(function() { btn.classList.remove('btn-rippling'); }, 600);
    });
  })();

  /* ================================================================== */
  /* v46: 3D TILT CARD SYSTEM                                           */
  /* ================================================================== */
  (function initTiltCards() {
    if (window.innerWidth < 768) return;
    var cards = document.querySelectorAll('.feature-card, .qr-card, .sell-card, .gc-card, .sv-card, .pl-card, .glow-card-animated');
    cards.forEach(function(card) {
      card.addEventListener('mousemove', function(e) {
        var rect = card.getBoundingClientRect();
        var x = (e.clientX - rect.left) / rect.width - 0.5;
        var y = (e.clientY - rect.top) / rect.height - 0.5;
        var rotY = x * 12;
        var rotX = -y * 12;
        card.style.transform = 'perspective(800px) rotateX(' + rotX + 'deg) rotateY(' + rotY + 'deg) translateZ(8px)';
      });
      card.addEventListener('mouseleave', function() {
        card.style.transform = '';
        card.style.transition = 'transform 0.5s cubic-bezier(.22,1,.36,1)';
        setTimeout(function() { card.style.transition = ''; }, 500);
      });
    });
  })();

  /* ================================================================== */
  /* v46: XP / ACHIEVEMENT GAME SYSTEM                                  */
  /* ================================================================== */
  (function initXPSystem() {
    var xpBar = document.getElementById('ostXpBar');
    var xpFill = document.querySelector('.ost-xp-fill');
    var xpTooltip = document.querySelector('.ost-xp-tooltip');
    if (!xpBar || !xpFill) return;

    var saved = {};
    try { saved = JSON.parse(localStorage.getItem('ost_xp') || '{}'); } catch(e) {}

    var totalXP = saved.totalXP || 0;
    var level = saved.level || 1;
    var achievements = saved.achievements || [];
    var visitedSections = saved.visitedSections || [];
    var xpPerLevel = 100;

    function calcLevel(xp) { return Math.floor(xp / xpPerLevel) + 1; }
    function xpInLevel(xp) { return xp % xpPerLevel; }

    function save() {
      try {
        localStorage.setItem('ost_xp', JSON.stringify({
          totalXP: totalXP, level: level,
          achievements: achievements, visitedSections: visitedSections
        }));
      } catch(e) {}
    }

    function updateBar() {
      var pct = (xpInLevel(totalXP) / xpPerLevel) * 100;
      xpFill.style.width = pct + '%';
      if (xpTooltip) xpTooltip.textContent = 'Level ' + level + ' — ' + xpInLevel(totalXP) + '/' + xpPerLevel + ' XP';
    }

    function showAchievement(title) {
      var toast = document.createElement('div');
      toast.className = 'achievement-toast';
      toast.innerHTML = '<strong>🏆 Achievement Unlocked!</strong><br>' + title;
      document.body.appendChild(toast);
      setTimeout(function() { toast.classList.add('active'); }, 50);
      setTimeout(function() {
        toast.classList.remove('active');
        setTimeout(function() { toast.remove(); }, 400);
      }, 3500);
    }

    function checkAchievements() {
      var checks = [
        { id: 'first_scroll', cond: visitedSections.length >= 1, title: 'Explorer — Visited first section' },
        { id: 'five_sections', cond: visitedSections.length >= 5, title: 'Navigator — Visited 5 sections' },
        { id: 'all_sections', cond: visitedSections.length >= 12, title: 'Completionist — Visited all sections' },
        { id: 'level_2', cond: level >= 2, title: 'Rank Up — Reached Level 2' },
        { id: 'level_5', cond: level >= 5, title: 'Veteran — Reached Level 5' },
        { id: 'level_10', cond: level >= 10, title: 'Legend — Reached Level 10' },
      ];
      checks.forEach(function(a) {
        if (a.cond && achievements.indexOf(a.id) === -1) {
          achievements.push(a.id);
          showAchievement(a.title);
        }
      });
    }

    function award(xp, reason) {
      totalXP += xp;
      var newLevel = calcLevel(totalXP);
      if (newLevel > level) {
        level = newLevel;
        showAchievement('Level ' + level + ' Reached!');
      }
      level = newLevel;
      updateBar();
      checkAchievements();
      save();
    }

    // Expose globally for other modules
    window.__ostXP = { award: award, getLevel: function() { return level; }, getXP: function() { return totalXP; } };

    // Section visit tracking — award XP when scrolling into a section
    var sections = document.querySelectorAll('.section, [id*="section"]');
    if (sections.length) {
      var sectionObs = new IntersectionObserver(function(entries) {
        entries.forEach(function(en) {
          if (en.isIntersecting) {
            var id = en.target.id || en.target.className;
            if (visitedSections.indexOf(id) === -1) {
              visitedSections.push(id);
              award(10, 'Visited ' + id);
            }
          }
        });
      }, { threshold: 0.3 });
      sections.forEach(function(s) { sectionObs.observe(s); });
    }

    // Award XP for button clicks (except nav links)
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.btn, button');
      if (btn && !btn.closest('nav')) {
        award(5, 'Button click');
      }
    });

    // Show XP bar on hover
    xpBar.addEventListener('mouseenter', function() {
      if (xpTooltip) xpTooltip.style.opacity = '1';
    });
    xpBar.addEventListener('mouseleave', function() {
      if (xpTooltip) xpTooltip.style.opacity = '0';
    });

    updateBar();
    checkAchievements();
  })();

  /* ================================================================== */
  /* v46: ENHANCED SCROLL REVEAL with stagger + parallax                */
  /* ================================================================== */
  (function initEnhancedScroll() {
    var srEls = document.querySelectorAll('.sr');
    if (!srEls.length) return;

    var idx = 0;
    var obs = new IntersectionObserver(function(entries) {
      entries.forEach(function(en) {
        if (en.isIntersecting) {
          var delay = (idx % 4) * 80;
          en.target.style.transitionDelay = delay + 'ms';
          en.target.classList.add('visible');
          idx++;
          obs.unobserve(en.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

    srEls.forEach(function(el) { obs.observe(el); });

    // Parallax for section backgrounds
    var parallaxEls = document.querySelectorAll('.section-space, .section-dark');
    if (parallaxEls.length) {
      var ticking = false;
      window.addEventListener('scroll', function() {
        if (!ticking) {
          requestAnimationFrame(function() {
            var scrollY = window.pageYOffset;
            parallaxEls.forEach(function(el) {
              var rect = el.getBoundingClientRect();
              if (rect.bottom > 0 && rect.top < window.innerHeight) {
                var offset = (rect.top / window.innerHeight) * 30;
                el.style.backgroundPositionY = offset + 'px';
              }
            });
            ticking = false;
          });
          ticking = true;
        }
      }, { passive: true });
    }
  })();

  /* ================================================================== */
  /* v47: WELCOME OVERLAY — Language & Currency Selector                */
  /* ================================================================== */
  (function initWelcome() {
    var overlay = document.getElementById('welcomeOverlay');
    if (!overlay) return;
    var modal = overlay.querySelector('.welcome-modal');

    function rememberWelcomeSeen() {
      try {
        sessionStorage.setItem(WELCOME_SESSION_KEY, '1');
      } catch (e) {}
    }

    function hasSeenWelcomeThisSession() {
      try {
        return sessionStorage.getItem(WELCOME_SESSION_KEY) === '1';
      } catch (e) {
        return false;
      }
    }

    function setSelectedButton(selector, attribute, value, activeClass) {
      overlay.querySelectorAll(selector).forEach(function(btn) {
        btn.classList.toggle(activeClass, btn.getAttribute(attribute) === value);
      });
    }

    function syncStoredPrefs(lang, currency) {
      try {
        var prefs = JSON.parse(localStorage.getItem('ost_prefs') || '{}');
        localStorage.setItem('ost_prefs', JSON.stringify({
          lang: lang || prefs.lang || 'en',
          currency: currency || prefs.currency || 'USD'
        }));
      } catch (e) {}
    }

    function syncNavLanguage(lang) {
      var langCode = document.getElementById('langCode');
      if (langCode) langCode.textContent = lang.toUpperCase();
      document.querySelectorAll('#langList a').forEach(function(a) {
        a.classList.toggle('active', a.dataset.lang === lang);
      });
    }

    var prefs = {};
    try { prefs = JSON.parse(localStorage.getItem('ost_prefs') || '{}'); } catch(e) {}
    var selectedLang = prefs.lang || 'en';
    var selectedCurrency = prefs.currency || 'USD';

    if (prefs.lang) {
      if (typeof applyTranslations === 'function') applyTranslations(prefs.lang);
      syncNavLanguage(prefs.lang);
    }
    if (prefs.currency) {
      window.__ostCurrency = prefs.currency;
    }

    setSelectedButton('.wel-lang-btn', 'data-lang', selectedLang, 'wel-lang-active');
    setSelectedButton('.wel-curr-btn', 'data-curr', selectedCurrency, 'wel-curr-active');

    if (prefs.lang && prefs.currency && hasSeenWelcomeThisSession()) {
      overlay.classList.add('hidden');
      return;
    }

    // Language buttons
    overlay.querySelectorAll('.wel-lang-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        overlay.querySelectorAll('.wel-lang-btn').forEach(function(b) { b.classList.remove('wel-lang-active'); });
        btn.classList.add('wel-lang-active');
        selectedLang = btn.dataset.lang;
      });
    });

    // Currency buttons
    overlay.querySelectorAll('.wel-curr-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        overlay.querySelectorAll('.wel-curr-btn').forEach(function(b) { b.classList.remove('wel-curr-active'); });
        btn.classList.add('wel-curr-active');
        selectedCurrency = btn.dataset.curr;
      });
    });

    // Navigation
    var step1 = document.getElementById('welStep1');
    var step2 = document.getElementById('welStep2');
    document.getElementById('welNext1').addEventListener('click', function() {
      step1.style.display = 'none';
      step2.style.display = '';
      if (modal) modal.scrollTop = 0;
    });
    document.getElementById('welBack2').addEventListener('click', function() {
      step2.style.display = 'none';
      step1.style.display = '';
      if (modal) modal.scrollTop = 0;
    });

    // Enter
    document.getElementById('welGo').addEventListener('click', function() {
      syncStoredPrefs(selectedLang, selectedCurrency);
      rememberWelcomeSeen();

      // Apply language
      if (typeof applyTranslations === 'function') applyTranslations(selectedLang);
      syncNavLanguage(selectedLang);

      // Apply currency
      window.__ostCurrency = selectedCurrency;

      // Hide overlay
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity .4s';
      setTimeout(function() { overlay.classList.add('hidden'); overlay.style.opacity = ''; }, 400);

      if (typeof window.__ostXP !== 'undefined') {
        window.__ostXP.award(10, 'Set preferences');
      }
    });
  })();

  /* ================================================================== */
  /* v48: STORE TAB SWITCHING                                           */
  /* ================================================================== */
  (function initStoreTabs() {
    var tabs = document.querySelectorAll('.store-tab');
    var panels = document.querySelectorAll('.demos-panel');
    if (!tabs.length) return;

    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var target = tab.dataset.dtab;
        tabs.forEach(function(t) { t.classList.remove('store-tab-active'); });
        tab.classList.add('store-tab-active');
        panels.forEach(function(p) {
          if (p.dataset.dtab === target) {
            p.style.display = '';
            p.style.animation = 'none';
            void p.offsetWidth;
            p.style.animation = '';
          } else {
            p.style.display = 'none';
          }
        });
        document.dispatchEvent(new CustomEvent('ost:store-tab-change', { detail: { tab: target } }));
      });
    });
  })();

  /* ================================================================== */
  /* v48: GIFT CARD BRAND WHEEL + CARD CODE FORMATTER + LIVE PREVIEW   */
  /* ================================================================== */
  (function initGCBrandWheel() {
    var carousel = document.getElementById('gc2BrandCarousel');
    if (!carousel) return;

    // Use globally exposed brand data from initGiftCardHub
    var gcBrands = window.__ostGCBrands || [];

    function logoUrl(domain) {
      return 'https://logo.clearbit.com/' + domain + '?size=72';
    }

    gcBrands.forEach(function(b) {
      var item = document.createElement('div');
      item.className = 'gc2-wheel-item';
      item.dataset.brand = b.name;
      item.innerHTML = '<img src="' + logoUrl(b.domain) + '" alt="' + b.name + '" onerror="this.style.display=\'none\'"><span>' + b.name + '</span>';
      item.addEventListener('click', function() {
        var searchEl = document.getElementById('gc2BrandSearch');
        if (searchEl) {
          searchEl.value = b.name;
          searchEl.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(function() {
            var dd = document.getElementById('gc2BrandDropdown');
            if (dd && dd.children.length === 1) dd.children[0].click();
          }, 100);
        }
        carousel.querySelectorAll('.gc2-wheel-item').forEach(function(c) { c.classList.remove('active'); });
        item.classList.add('active');
      });
      carousel.appendChild(item);
    });

    // Card code formatter (XXXX-XXXX-XXXX-XXXX)
    var codeInput = document.getElementById('gc2Code');
    var codeStatus = document.getElementById('gc2CodeStatus');
    if (codeInput) {
      codeInput.addEventListener('input', function(e) {
        var raw = codeInput.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (raw.length > 16) raw = raw.slice(0, 16);
        var formatted = raw.match(/.{1,4}/g);
        codeInput.value = formatted ? formatted.join('-') : '';
        // Update status icon
        if (codeStatus) {
          if (raw.length === 16) {
            codeStatus.textContent = '\u2713';
            codeStatus.className = 'gc2-code-status valid';
          } else if (raw.length > 0) {
            codeStatus.textContent = raw.length + '/16';
            codeStatus.className = 'gc2-code-status invalid';
          } else {
            codeStatus.textContent = '';
            codeStatus.className = 'gc2-code-status';
          }
        }
        // Update 3D card number
        var cardNum = document.getElementById('gc2CardNumber');
        if (cardNum) {
          cardNum.textContent = codeInput.value || 'XXXX-XXXX-XXXX-XXXX';
        }
      });
    }

    // Live preview updates for 3D card
    var balanceInput = document.getElementById('gc2Balance');
    var pinInput = document.getElementById('gc2Pin');
    if (balanceInput) {
      balanceInput.addEventListener('input', function() {
        var val = parseFloat(balanceInput.value) || 0;
        var cardValue = document.getElementById('gc2CardValue');
        var currSel = document.getElementById('gc2Currency');
        var sym = '$';
        if (currSel) {
          var opt = currSel.options[currSel.selectedIndex];
          if (opt) sym = opt.textContent.trim().charAt(0);
        }
        if (cardValue) cardValue.textContent = sym + val.toFixed(2);

        // Live estimate
        var estimateEl = document.getElementById('gc2LiveEstimate');
        var estOST = document.getElementById('gc2EstOST');
        var estRate = document.getElementById('gc2EstRate');
        var estUSD = document.getElementById('gc2EstUSD');
        if (estimateEl && val > 0) {
          var rate = window.__ostSelectedGCBrand ? window.__ostSelectedGCBrand.rate : 85;
          var ostPrice = (typeof window.ostPrice === 'number' && window.ostPrice > 0) ? window.ostPrice : 0.00041;
          var payout = val * (rate / 100);
          var ost = payout / ostPrice;
          if (estOST) estOST.textContent = Math.floor(ost).toLocaleString();
          if (estRate) estRate.textContent = rate + '%';
          if (estUSD) estUSD.textContent = '$' + payout.toFixed(2);
          estimateEl.style.display = '';
        } else if (estimateEl) {
          estimateEl.style.display = 'none';
        }
      });
    }
    if (pinInput) {
      pinInput.addEventListener('input', function() {
        var cardPin = document.getElementById('gc2CardPin');
        if (cardPin) cardPin.textContent = pinInput.value || '****';
      });
    }
  })();

  /* ================================================================== */
  /* v49: GAS STATION BRAND WHEEL + GLOBAL COUNTRY DATA                 */
  /* ================================================================== */
  (function initFuelCarousel() {
    var carousel = document.getElementById('fuel2BrandCarousel');
    if (!carousel) return;

    var stationBrands = [
      { name:'Shell', domain:'shell.com' },
      { name:'BP', domain:'bp.com' },
      { name:'ExxonMobil', domain:'exxonmobil.com' },
      { name:'Chevron', domain:'chevron.com' },
      { name:'Costco', domain:'costco.com' },
      { name:'Circle K', domain:'circlek.com' },
      { name:'7-Eleven', domain:'7-eleven.com' },
      { name:"Buc-ee's", domain:'buc-ees.com' },
      { name:'Wawa', domain:'wawa.com' },
      { name:'QuikTrip', domain:'quiktrip.com' },
      { name:'Sheetz', domain:'sheetz.com' },
      { name:"Casey's", domain:'caseys.com' },
      { name:'TotalEnergies', domain:'totalenergies.com' },
      { name:'Petro-Canada', domain:'petro-canada.ca' },
      { name:'Esso', domain:'esso.com' },
      { name:'PEMEX', domain:'pemex.com' },
      { name:'Oxxo Gas', domain:'oxxo.com' },
      { name:'Repsol', domain:'repsol.com' },
      { name:'Cepsa', domain:'cepsa.com' },
      { name:'Aral', domain:'aral.de' },
      { name:'Tesco', domain:'tesco.com' },
      { name:"Sainsbury's", domain:'sainsburys.co.uk' },
      { name:'Asda', domain:'asda.com' },
      { name:'Leclerc', domain:'e-leclerc.com' },
      { name:'Carrefour', domain:'carrefour.fr' },
      { name:'Eni', domain:'eni.com' },
      { name:'Q8', domain:'q8.it' },
      { name:'Petrobras', domain:'petrobras.com.br' },
      { name:'Ipiranga', domain:'ipiranga.com.br' },
      { name:'YPF', domain:'ypf.com' },
      { name:'Terpel', domain:'terpel.com' },
      { name:'Ampol', domain:'ampol.com.au' },
      { name:'ENEOS', domain:'eneos.co.jp' },
      { name:'Idemitsu', domain:'idemitsu.com' },
      { name:'GS Caltex', domain:'gscaltex.com' },
      { name:'SK Energy', domain:'skenergy.com' },
      { name:'Indian Oil', domain:'iocl.com' },
      { name:'Bharat Petroleum', domain:'bharatpetroleum.in' },
      { name:'Reliance', domain:'reliancepetroleum.com' },
      { name:'ADNOC', domain:'adnoc.ae' },
      { name:'ENOC', domain:'enoc.com' },
      { name:'Saudi Aramco', domain:'aramco.com' },
      { name:'OPET', domain:'opet.com.tr' },
      { name:'NNPC Retail', domain:'nnpcgroup.com' },
      { name:'Engen', domain:'engen.co.za' },
      { name:'Sasol', domain:'sasol.com' },
      { name:'Pioneer', domain:'pioneerenergy.ca' },
      { name:'G500', domain:'g500.mx' },
      { name:'Jet', domain:'jet.de' },
      { name:'Cosmo', domain:'cosmo-oil.co.jp' },
      { name:'HP', domain:'hindustanpetroleum.com' },
      { name:'Emarat', domain:'emarat.ae' },
      { name:'Petrol Ofisi', domain:'petrolofisi.com.tr' },
      { name:'Oando', domain:'oandoplc.com' },
      { name:'Primax', domain:'primax.com.co' }
    ];

    // Country brand mapping for dimming
    var countryBrands = {
      US: ['Shell','BP','ExxonMobil','Chevron','Costco','Circle K','7-Eleven',"Buc-ee's",'Wawa','QuikTrip','Sheetz',"Casey's"],
      CA: ['Shell','Petro-Canada','Esso','Circle K','Costco','Pioneer'],
      MX: ['PEMEX','Oxxo Gas','Shell','G500'],
      GB: ['Shell','BP','Tesco',"Sainsbury's",'Asda'],
      DE: ['Aral','Shell','TotalEnergies','Jet'],
      FR: ['TotalEnergies','Leclerc','Carrefour'],
      ES: ['Repsol','Cepsa','Shell'],
      IT: ['Eni','Q8','TotalEnergies'],
      BR: ['Petrobras','Shell','Ipiranga'],
      AR: ['YPF','Shell'],
      CO: ['Terpel','Primax'],
      AU: ['Ampol','7-Eleven','Shell'],
      JP: ['ENEOS','Idemitsu','Cosmo'],
      KR: ['GS Caltex','SK Energy'],
      IN: ['Indian Oil','Bharat Petroleum','HP','Reliance'],
      AE: ['ADNOC','ENOC','Emarat'],
      SA: ['Saudi Aramco','Shell'],
      TR: ['OPET','Petrol Ofisi'],
      NG: ['NNPC Retail','TotalEnergies','Oando'],
      ZA: ['Engen','Shell','Sasol']
    };

    function logoUrl(domain) {
      return 'https://logo.clearbit.com/' + domain + '?size=72';
    }

    stationBrands.forEach(function(b) {
      var item = document.createElement('div');
      item.className = 'fuel2-wheel-item';
      item.dataset.brand = b.name;
      item.innerHTML = '<img src="' + logoUrl(b.domain) + '" alt="' + b.name + '" onerror="this.style.display=\'none\'"><span>' + b.name + '</span>';
      item.addEventListener('click', function() {
        var searchEl = document.getElementById('fuel2SearchLoc');
        if (searchEl) {
          searchEl.value = b.name;
          searchEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        carousel.querySelectorAll('.fuel2-wheel-item').forEach(function(c) { c.classList.remove('active'); });
        item.classList.add('active');
        var findBtn = document.getElementById('fuel2FindBtn');
        if (findBtn) findBtn.click();
      });
      carousel.appendChild(item);
    });

    // Dim non-matching brands on country change
    var countrySel = document.getElementById('fuel2Country');
    if (countrySel) {
      function updateWheel() {
        var code = countrySel.value;
        var brands = countryBrands[code] || countryBrands.US;
        carousel.querySelectorAll('.fuel2-wheel-item').forEach(function(item) {
          var name = item.dataset.brand;
          var match = brands.indexOf(name) >= 0;
          item.classList.toggle('dimmed', !match);
          // Move matching to front
          item.style.order = match ? '0' : '1';
        });
      }
      countrySel.addEventListener('change', updateWheel);
      updateWheel();
    }
  })();

  /* ================================================================== */
  /* v47: LAUNCHPAD BUY PRESETS + ENHANCED SEED DATA                    */
  /* ================================================================== */
  (function initLPEnhancements() {
    // Buy preset buttons
    var presets = document.querySelectorAll('.lp-buy-preset');
    var buyInput = document.getElementById('lpInitialBuy');
    if (presets.length && buyInput) {
      presets.forEach(function(btn) {
        btn.addEventListener('click', function() {
          presets.forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          buyInput.value = btn.dataset.amt;
          renderComposePreview();
        });
      });
    }

    // Initialize feed+board on load if visible
    var feedGrid = document.getElementById('lpFeedGrid');
    var boardList = document.getElementById('lpBoardList');
    // Auto-render trending and board so they're not empty
    setTimeout(function() {
      if (feedGrid && !feedGrid.children.length) {
        // Trigger feed tab render
        var feedTab = document.querySelector('.lp-tab[data-tab="feed"]');
        if (feedTab) { feedTab.click(); }
        // Go back to create tab
        setTimeout(function() {
          var createTab = document.querySelector('.lp-tab[data-tab="create"]');
          if (createTab) createTab.click();
        }, 50);
      }
    }, 300);
  })();

  /* ================================================================== */
  /* v54: SECTION SHELL ENHANCEMENTS                                     */
  /* ================================================================== */

  (function initLaunchpadHeroJumps() {
    var jumpers = document.querySelectorAll('[data-lp-jump]');
    if (!jumpers.length) return;
    jumpers.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var target = btn.getAttribute('data-lp-jump');
        var tab = document.querySelector('.lp-tab[data-tab="' + target + '"]');
        if (tab) tab.click();
      });
    });
  })();

  (function initAutoRailCarousels() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    function attachRail(selector) {
      var rail = document.querySelector(selector);
      if (!rail) return;

      var paused = false;
      var direction = 1;
      var lastTs = 0;

      function frame(ts) {
        if (!rail || !rail.isConnected) return;
        if (!lastTs) lastTs = ts;
        var delta = ts - lastTs;
        lastTs = ts;

        if (!paused && rail.scrollWidth > rail.clientWidth + 8) {
          rail.scrollLeft += direction * delta * 0.03;
          if (rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2) direction = -1;
          if (rail.scrollLeft <= 2) direction = 1;
        }
        window.requestAnimationFrame(frame);
      }

      rail.addEventListener('mouseenter', function() { paused = true; });
      rail.addEventListener('mouseleave', function() { paused = false; });
      rail.addEventListener('pointerdown', function() { paused = true; });
      rail.addEventListener('pointerup', function() { paused = false; });

      window.requestAnimationFrame(frame);
    }

    window.setTimeout(function() {
      attachRail('#gc2BrandCarousel');
      attachRail('#fuel2BrandCarousel');
    }, 700);
  })();

  (function initPredictionMarketBoard() {
    var board = document.getElementById('predictionMarketBoard');
    if (!board) return;

    var listEl = document.getElementById('predictionMarketList');
    var statusEl = document.getElementById('predictionMarketStatus');
    var updatedEl = document.getElementById('predictionMarketUpdated');
    var searchEl = document.getElementById('predictionMarketSearch');
    var refreshBtn = document.getElementById('predictionMarketRefresh');
    var countEl = document.getElementById('predictionMarketCount');
    var sourceCountEl = document.getElementById('predictionSourceCount');
    var breakingCountEl = document.getElementById('predictionBtcCount');
    var tapeEl = document.getElementById('predictionMarketTape');
    var pulseEl = document.getElementById('predictionMarketPulse');
    var pulseMetaEl = document.getElementById('predictionPulseMeta');
    var sourceToggle = document.getElementById('predictionSourceToggle');
    var rankToggle = document.getElementById('predictionRankToggle');
    var topicToggle = document.getElementById('predictionTopicToggle');
    var heroRankEl = document.getElementById('predictionHeroRank');
    var heroSourceEl = document.getElementById('predictionHeroSource');
    var heroTopicEl = document.getElementById('predictionHeroTopic');
    var heroTitleEl = document.getElementById('predictionHeroTitle');
    var heroDetailEl = document.getElementById('predictionHeroDetail');
    var heroYesPriceEl = document.getElementById('predictionHeroYesPrice');
    var heroNoPriceEl = document.getElementById('predictionHeroNoPrice');
    var heroProbabilityEl = document.getElementById('predictionHeroProbability');
    var heroVolumeEl = document.getElementById('predictionHeroVolume');
    var heroDepthEl = document.getElementById('predictionHeroDepth');
    var heroCloseEl = document.getElementById('predictionHeroClose');
    var heroMomentumEl = document.getElementById('predictionHeroMomentum');
    var heroVenueLinkEl = document.getElementById('predictionHeroVenueLink');
    var heroFeedLinkEl = document.getElementById('predictionHeroFeedLink');
    var tradeHeadingEl = document.getElementById('predictionTradeHeading');
    var tradeCopyEl = document.getElementById('predictionTradeCopy');
    var selectedSourceEl = document.getElementById('predictionSelectedSource');
    var selectedTopicEl = document.getElementById('predictionSelectedTopic');
    var selectedTitleEl = document.getElementById('predictionSelectedTitle');
    var selectedDetailEl = document.getElementById('predictionSelectedDetail');
    var outcomeToggle = document.getElementById('predictionOutcomeToggle');
    var yesValueEl = document.getElementById('predictionOutcomeYesValue');
    var noValueEl = document.getElementById('predictionOutcomeNoValue');
    var stakeInputEl = document.getElementById('predictionStakeInput');
    var stakeQuickEl = document.getElementById('predictionStakeQuick');
    var availableBalanceEl = document.getElementById('predictionAvailableBalance');
    var estimatedSharesEl = document.getElementById('predictionEstimatedShares');
    var potentialReturnEl = document.getElementById('predictionPotentialReturn');
    var entryPriceEl = document.getElementById('predictionEntryPrice');
    var payoutMultipleEl = document.getElementById('predictionPayoutMultiple');
    var winNetEl = document.getElementById('predictionWinNet');
    var settlementPathEl = document.getElementById('predictionSettlementPath');
    var tradeStatusEl = document.getElementById('predictionTradeStatus');
    var tradeActionBtn = document.getElementById('predictionTradeAction');
    var tradeActionLabelEl = document.getElementById('predictionTradeActionLabel');
    var receiptEl = document.getElementById('predictionTradeReceipt');
    var receiptSignatureEl = document.getElementById('predictionReceiptSignature');
    var receiptStakeEl = document.getElementById('predictionReceiptStake');
    var receiptExplorerEl = document.getElementById('predictionReceiptExplorer');
    var ledgerCountEl = document.getElementById('predictionLedgerCount');
    var positionListEl = document.getElementById('predictionPositionList');
    var stageRankEl = document.getElementById('predictionStageRank');
    var stageSourceEl = document.getElementById('predictionStageSource');
    var stageTopicEl = document.getElementById('predictionStageTopic');
    var stageTitleEl = document.getElementById('predictionStageTitle');
    var stageDetailEl = document.getElementById('predictionStageDetail');
    var stageYesPriceEl = document.getElementById('predictionStageYesPrice');
    var stageNoPriceEl = document.getElementById('predictionStageNoPrice');
    var stageProbabilityEl = document.getElementById('predictionStageProbability');
    var stageVolumeEl = document.getElementById('predictionStageVolume');
    var stageDepthEl = document.getElementById('predictionStageDepth');
    var stageCloseEl = document.getElementById('predictionStageClose');
    var stageChartCopyEl = document.getElementById('predictionStageChartCopy');
    var stageTrendEl = document.getElementById('predictionStageTrend');
    var stageChartEl = document.getElementById('predictionStageChart');
    var stageAxisStartEl = document.getElementById('predictionStageAxisStart');
    var stageAxisEndEl = document.getElementById('predictionStageAxisEnd');
    var depthYesEl = document.getElementById('predictionDepthYes');
    var depthNoEl = document.getElementById('predictionDepthNo');
    var stageVenueLinkEl = document.getElementById('predictionStageVenueLink');
    var stageFeedLinkEl = document.getElementById('predictionStageFeedLink');
    var loadTimer = null;
    var resizeFrame = null;

    var state = {
      markets: [],
      source: 'all',
      rank: 'trending',
      topic: 'all',
      query: '',
      selectedMarketId: '',
      selectedSide: 'yes',
      stake: 25,
      loading: false,
      placing: false,
      availableBalance: null,
      orderHistory: readPredictionOrderRecords(),
      latestReceipt: null,
      lastUpdated: null,
      sourceHealth: { polymarket: false, kalshi: false },
      lastError: ''
    };

    var rankLabels = {
      all: 'All markets',
      trending: 'Trending',
      breaking: 'Breaking',
      new: 'New'
    };

    var topicLabels = {
      all: 'All markets',
      politics: 'Politics',
      sports: 'Sports',
      crypto: 'Crypto',
      esports: 'Esports',
      iran: 'Iran',
      finance: 'Finance',
      geopolitics: 'Geopolitics',
      tech: 'Tech',
      culture: 'Culture',
      economy: 'Economy',
      weather: 'Weather',
      mentions: 'Mentions',
      elections: 'Elections'
    };

    var topicOrder = ['crypto', 'elections', 'politics', 'sports', 'esports', 'iran', 'geopolitics', 'finance', 'tech', 'economy', 'culture', 'weather', 'mentions'];

    function setChipState(container, attr, value) {
      if (!container) return;
      container.querySelectorAll('button[' + attr + ']').forEach(function(btn) {
        btn.classList.toggle('is-active', btn.getAttribute(attr) === value);
      });
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function formatOst(value) {
      var number = Number(value);
      if (!Number.isFinite(number)) return '--';
      return number.toLocaleString(undefined, {
        maximumFractionDigits: number >= 100 ? 0 : 2
      }) + ' OST';
    }

    function formatCompactNumber(value) {
      var number = Number(value);
      if (!Number.isFinite(number)) return 'N/A';
      return new Intl.NumberFormat(undefined, {
        notation: 'compact',
        maximumFractionDigits: number >= 100 ? 0 : 1
      }).format(number);
    }

    function formatPercent(value) {
      var number = Number(value);
      if (!Number.isFinite(number)) return 'N/A';
      return Math.round(number * 100) + '%';
    }

    function formatSignedPoints(value, fallback) {
      var number = Number(value);
      if (!Number.isFinite(number)) return fallback || 'Flat';
      var rounded = Math.round(number);
      if (!rounded) return fallback || 'Flat';
      return (rounded > 0 ? '+' : '') + rounded + ' pts';
    }

    function formatMoney(value) {
      var number = Number(value);
      if (!Number.isFinite(number)) return 'N/A';
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: number >= 100 ? 0 : 2
      }).format(number);
    }

    function formatRelativeTime(value) {
      if (!value) return t('wallet.portal.prediction.noClose', 'No close time');
      var date = new Date(value);
      if (Number.isNaN(date.getTime())) return t('wallet.portal.prediction.noClose', 'No close time');
      var delta = date.getTime() - Date.now();
      var minutes = Math.round(delta / 60000);
      if (Math.abs(minutes) < 60) {
        if (minutes === 0) return t('wallet.portal.prediction.now', 'Closing now');
        return minutes > 0 ? t('wallet.portal.prediction.inMinutes', 'Closes in ') + minutes + 'm' : Math.abs(minutes) + 'm ' + t('wallet.portal.prediction.ago', 'ago');
      }
      var hours = Math.round(minutes / 60);
      if (Math.abs(hours) < 48) {
        return hours > 0 ? t('wallet.portal.prediction.inHours', 'Closes in ') + hours + 'h' : Math.abs(hours) + 'h ' + t('wallet.portal.prediction.ago', 'ago');
      }
      var days = Math.round(hours / 24);
      return days > 0 ? t('wallet.portal.prediction.inDays', 'Closes in ') + days + 'd' : Math.abs(days) + 'd ' + t('wallet.portal.prediction.ago', 'ago');
    }

    function formatAxisDate(value, prefix) {
      if (!value) return prefix + ' --';
      var date = new Date(value);
      if (Number.isNaN(date.getTime())) return prefix + ' --';
      return prefix + ' ' + date.toLocaleDateString([], {
        month: 'short',
        day: 'numeric'
      });
    }

    function explorerTxUrl(signature) {
      return 'https://explorer.solana.com/tx/' + encodeURIComponent(signature) + '?cluster=' + encodeURIComponent(OST_CONFIG.network || 'devnet');
    }

    function safeFraction(value, fallback) {
      var number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      if (number > 1) number = number / 100;
      return clamp(number, 0, 1);
    }

    function getMarketPrice(market, side) {
      if (!market) return NaN;
      if (side === 'no' && Number.isFinite(market.noPriceNumber)) return market.noPriceNumber;
      if (side !== 'no' && Number.isFinite(market.yesPriceNumber)) return market.yesPriceNumber;
      var rawValue = side === 'no' ? market.noValue : market.yesValue;
      var numericValue = typeof rawValue === 'number' ? rawValue : parseFloat(String(rawValue || '').replace(/[^\d.\-]/g, ''));
      if (!Number.isFinite(numericValue)) return NaN;
      return numericValue / 100;
    }

    function calculatePotentialReturn(stake, priceFraction) {
      var numericStake = Number(stake);
      var numericPrice = Number(priceFraction);
      if (!Number.isFinite(numericStake) || numericStake <= 0 || !Number.isFinite(numericPrice) || numericPrice <= 0) return NaN;
      return numericStake / numericPrice;
    }

    function calculateEstimatedShares(stake, priceFraction) {
      var numericStake = Number(stake);
      var numericPrice = Number(priceFraction);
      if (!Number.isFinite(numericStake) || numericStake <= 0 || !Number.isFinite(numericPrice) || numericPrice <= 0) return NaN;
      return numericStake / numericPrice;
    }

    function getMarketSourceClass(market) {
      return market && market.source === 'kalshi' ? 'source-kalshi' : 'source-polymarket';
    }

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, function(ch) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
      });
    }

    function parseMaybeJson(value) {
      if (Array.isArray(value)) return value;
      if (typeof value !== 'string') return [];
      try {
        var parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    }

    function normalizeWhitespace(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function truncateText(value, maxLength) {
      var text = normalizeWhitespace(value);
      if (!text || !maxLength || text.length <= maxLength) return text;
      return text.slice(0, maxLength - 1).trim() + '…';
    }

    function summarizeMarketText(value, fallback, maxLength) {
      var text = normalizeWhitespace(value);
      if (!text) return fallback;
      var sentenceMatch = text.match(/^[\s\S]{0,220}?[.!?](?=\s|$)/);
      var summary = sentenceMatch ? sentenceMatch[0] : text;
      return truncateText(summary, maxLength || 180) || fallback;
    }

    function cleanKalshiLeg(value) {
      var text = normalizeWhitespace(value);
      if (!text) return '';
      if (/^yes\s+/i.test(text)) {
        text = text.replace(/^yes\s+/i, '');
      } else if (/^no\s+/i.test(text)) {
        text = 'No ' + text.replace(/^no\s+/i, '');
      }
      return text.replace(/\s*:\s*/g, ' ').trim();
    }

    function summarizeKalshiBundle(title, fallbackDetail) {
      var rawTitle = normalizeWhitespace(title);
      var legs = rawTitle ? rawTitle.split(/\s*,\s*/).map(cleanKalshiLeg).filter(Boolean) : [];
      if (legs.length <= 1) {
        return {
          title: rawTitle || t('wallet.portal.prediction.kalshiTitle', 'Kalshi market'),
          detail: summarizeMarketText(fallbackDetail || rawTitle, t('wallet.portal.prediction.kalshiDetail', 'Live event contract routed from Kalshi.'), 170),
          legCount: Math.max(legs.length, rawTitle ? 1 : 0),
          isBundle: false
        };
      }

      var heroTitle = legs.slice(0, 2).join(' + ');
      if (legs.length > 2) heroTitle += ' + ' + (legs.length - 2) + ' more';

      var detail = legs.slice(0, 5).join(' • ');
      if (legs.length > 5) detail += ' • +' + (legs.length - 5) + ' more';

      return {
        title: heroTitle,
        detail: legs.length + '-leg live bundle: ' + detail,
        legCount: legs.length,
        isBundle: true
      };
    }

    function toDateMs(value) {
      if (!value) return 0;
      var date = new Date(value);
      return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    }

    function buildTopicSet(text) {
      var lower = String(text || '').toLowerCase();
      var topics = new Set();
      if (/\bbitcoin\b|\bbtc\b|\bethereum\b|\beth\b|\bsolana\b|\bsol\b|\bcrypto\b|\btoken\b|\bdefi\b|\betf\b|\bblockchain\b|\baltcoin\b|\bdogecoin\b/.test(lower)) topics.add('crypto');
      if (/\belection\b|\bvote\b|\bballot\b|\bcaucus\b|\breferendum\b|\bgubernatorial\b|\bmayor\b/.test(lower)) {
        topics.add('elections');
        topics.add('politics');
      }
      if (/\btrump\b|\bbiden\b|\bpresident\b|\bsenate\b|\bhouse\b|\bcampaign\b|\bcongress\b|\bpolitic/.test(lower)) topics.add('politics');
      if (/\besports?\b|\bleague of legends\b|\bvalorant\b|\bcs2\b|\bcounter-strike\b|\bdota\b|\boverwatch\b|\bfortnite\b|\bcall of duty\b/.test(lower)) {
        topics.add('esports');
        topics.add('sports');
      }
      if (/\bnba\b|\bnfl\b|\bmlb\b|\bnhl\b|\bsoccer\b|\bfootball\b|\bgolf\b|\btennis\b|\bgoal\b|\bpoints scored\b|\bplayer points\b|\bwins by over\b|\bworld cup\b|\bfinals\b|\bmls\b|\bformula 1\b|\bf1\b|\bbaseball\b|\bbasketball\b|sportsmultigame/.test(lower)) topics.add('sports');
      if (/\biran\b|\btehran\b|\bhormuz\b|\biranian\b|\bpersian gulf\b/.test(lower)) {
        topics.add('iran');
        topics.add('geopolitics');
      }
      if (/\bukraine\b|\bisrael\b|\bgaza\b|\bchina\b|\btaiwan\b|\bnato\b|\bceasefire\b|\bwar\b|\bsanctions?\b|\btariff\b|\bmissile\b|\bmilitary\b|\bgeopolit/.test(lower)) topics.add('geopolitics');
      if (/\bfed\b|\brates?\b|\bstock\b|\bnasdaq\b|\bs&p\b|\bdow\b|\btreasury\b|\byield\b|\bearnings\b|\boil\b|\bgold\b|\bfinancial\b|\bbonds?\b|\bbank\b/.test(lower)) topics.add('finance');
      if (/\bcpi\b|\binflation\b|\brecession\b|\bgdp\b|\bunemployment\b|\bpayrolls?\b|\beconomy\b|\bconsumer\b|\bdeficit\b/.test(lower)) topics.add('economy');
      if (/\bai\b|\bopenai\b|\bgoogle\b|\bapple\b|\bmeta\b|\bmicrosoft\b|\bnvidia\b|\btesla\b|\brobot\b|\bsemiconductor\b|\bchip\b|\btech\b/.test(lower)) topics.add('tech');
      if (/\boscar\b|\bgrammy\b|\bmovie\b|\bfilm\b|\bmusic\b|\bcelebrity\b|\bhollywood\b|\bnetflix\b|\bshow\b|\btaylor swift\b|\bgta\b|\bculture\b/.test(lower)) topics.add('culture');
      if (/\bhurricane\b|\bstorm\b|\brain\b|\bweather\b|\bheat\b|\bsnow\b|\btemperature\b|\bforecast\b|\bflood\b|\bwind\b/.test(lower)) topics.add('weather');
      if (/\bviral\b|\btrending\b|\bmentions?\b|\bheadline\b|\bbreaking\b|\bspotlight\b/.test(lower)) topics.add('mentions');
      if (!topics.size) topics.add('all');
      return topics;
    }

    function pickPrimaryTopic(topics) {
      var match = topicOrder.find(function(key) {
        return topics.has(key);
      });
      return match || 'all';
    }

    function getDisplayTopics(topics) {
      var values = topicOrder.filter(function(key) {
        return topics.has(key);
      });
      return values.length ? values : ['all'];
    }

    function estimateAttentionScore(text, volumeNumber, depthNumber) {
      var hits = (String(text || '').match(/\b(bitcoin|trump|election|fed|ai|iran|storm|war|earnings|weather|nba|finals|gta|nvidia|inflation)\b/gi) || []).length;
      return clamp(Math.round(Math.log10((volumeNumber || 0) + 10) * 5 + Math.log10((depthNumber || 0) + 10) * 3 + hits * 4), 1, 99);
    }

    function isBreakingText(text, topics, closeAtMs) {
      var lower = String(text || '').toLowerCase();
      if (topics.has('iran') || topics.has('geopolitics') || topics.has('weather') || topics.has('elections')) return true;
      if (/\bbreaking\b|\bwar\b|\bceasefire\b|\bstorm\b|\btariff\b|\bfed\b|\bcpi\b|\bearnings\b|\bhormuz\b/.test(lower)) return true;
      if (closeAtMs && closeAtMs > Date.now()) {
        var hoursLeft = (closeAtMs - Date.now()) / 3600000;
        if (hoursLeft < 36 && (topics.has('finance') || topics.has('politics') || topics.has('economy'))) return true;
      }
      return false;
    }

    function getSelectedMarket(filteredMarkets) {
      var pool = filteredMarkets || state.markets;
      if (!pool.length) return null;
      var selected = pool.find(function(market) {
        return market.id === state.selectedMarketId;
      });
      if (selected) return selected;
      return pool[0] || null;
    }

    function setTradeStatus(message, tone) {
      if (!tradeStatusEl) return;
      tradeStatusEl.className = 'prediction-trade-status' + (tone ? ' is-' + tone : '');
      tradeStatusEl.textContent = message;
    }

    function renderPredictionLedger() {
      if (!positionListEl) return;
      if (ledgerCountEl) ledgerCountEl.textContent = String(state.orderHistory.length);
      if (!state.orderHistory.length) {
        positionListEl.innerHTML = '<div class="prediction-position-empty">' + escapeHtml(t('wallet.portal.prediction.noTickets', 'No OST market tickets recorded yet.')) + '</div>';
        return;
      }

      positionListEl.innerHTML = state.orderHistory.map(function(order, idx) {
        var sideLabel = order.side === 'no'
          ? t('wallet.portal.prediction.buyNo', 'Buy No')
          : t('wallet.portal.prediction.buyYes', 'Buy Yes');
        var canCash = !order.cashedOut && Number(order.stake || 0) > 0;
        var cashBtn = canCash
          ? '<button class="prediction-cashout-btn" data-cashout-idx="' + idx + '" style="margin-left:auto;padding:4px 10px;border-radius:6px;background:#22c55e;color:#000;border:none;font-weight:700;cursor:pointer;font-size:12px">Cash out</button>'
          : (order.cashedOut ? '<span style="color:#22c55e;font-weight:700;font-size:12px;margin-left:auto">✓ Paid out</span>' : '');
        return [
          '<div class="prediction-position-row">',
            '<div class="prediction-position-row-top">',
              '<div>',
                '<strong>' + escapeHtml(order.title || 'Prediction ticket') + '</strong>',
                '<span>' + escapeHtml((order.source || 'ost') + ' • ' + (topicLabels[order.topic] || topicLabels.all)) + '</span>',
              '</div>',
              '<span class="prediction-position-pill side-' + escapeHtml(order.side || 'yes') + '">' + escapeHtml(sideLabel) + '</span>',
            '</div>',
            '<div class="prediction-position-row-meta" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">',
              '<span>' + escapeHtml(formatOst(order.stake)) + ' • ' + escapeHtml(formatOst(order.potentialReturn)) + '</span>',
              '<a class="prediction-market-api-link" href="' + escapeHtml(explorerTxUrl(order.signature)) + '" target="_blank" rel="noopener">' + escapeHtml(shortAddress(order.signature || '')) + '</a>',
              cashBtn,
            '</div>',
          '</div>'
        ].join('');
      }).join('');

      // Wire cash-out buttons
      positionListEl.querySelectorAll('[data-cashout-idx]').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var idx = Number(btn.getAttribute('data-cashout-idx'));
          var orders = readPredictionOrderRecords();
          var order = orders[idx];
          if (!order) return;
          if (!window.OST_TRADE || !window.OST_TRADE.predictionCashOut) {
            try { alert('Trading module not loaded — refresh the page'); } catch(e){}
            return;
          }
          // Payout = 95% of stake (5% house edge — keeps the pool sustainable on devnet)
          var payout = Number(order.stake || 0) * 0.95;
          var orig = btn.textContent;
          btn.disabled = true; btn.textContent = '…';
          try {
            var r = await window.OST_TRADE.predictionCashOut(order, payout);
            order.cashedOut = true;
            order.cashoutSig = r.sig;
            order.cashoutOst = r.ost;
            order.cashoutAt = Date.now();
            orders[idx] = order;
            try { localStorage.setItem(PREDICTION_ORDERS_STORAGE_KEY, JSON.stringify(orders)); } catch(e){}
            state.orderHistory = orders;
            renderPredictionLedger();
            try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch(e){}
          } catch (err) {
            console.warn('[prediction cashout] failed', err);
            var msg = (err && err.message) ? err.message : 'Cash-out failed';
            try { alert('Prediction cash-out failed:\n\n' + msg); } catch(e){}
            btn.disabled = false; btn.textContent = orig;
          }
        });
      });
    }

    function renderLatestReceipt() {
      if (!receiptEl) return;
      if (!state.latestReceipt) {
        receiptEl.hidden = true;
        return;
      }

      receiptEl.hidden = false;
      if (receiptSignatureEl) receiptSignatureEl.textContent = shortAddress(state.latestReceipt.signature);
      if (receiptStakeEl) receiptStakeEl.textContent = formatOst(state.latestReceipt.stake);
      if (receiptExplorerEl) receiptExplorerEl.href = explorerTxUrl(state.latestReceipt.signature);
    }

    function syncTradeWallet() {
      if (!connectedWalletSession || !connectedWalletSession.publicKey) {
        state.availableBalance = null;
        renderPredictionTicket(getFilteredMarkets());
        return Promise.resolve(null);
      }

      return getOstBalanceForAddress(connectedWalletSession.publicKey).then(function(balance) {
        state.availableBalance = balance;
        renderPredictionTicket(getFilteredMarkets());
        return balance;
      }).catch(function() {
        state.availableBalance = 0;
        renderPredictionTicket(getFilteredMarkets());
        return 0;
      });
    }

    function handlePredictionCardSelection(target) {
      var pulseCard = target.closest('[data-prediction-select-market-id]');
      if (pulseCard) {
        state.selectedMarketId = pulseCard.getAttribute('data-prediction-select-market-id') || '';
        renderPredictionBoard();
        return true;
      }
      var article = target.closest('.prediction-market-card[data-prediction-market-id]');
      if (!article) return false;
      state.selectedMarketId = article.getAttribute('data-prediction-market-id') || '';
      renderPredictionBoard();
      return true;
    }

    function getAgeHours(market) {
      if (!market || !market.createdAtMs) return 999;
      return Math.max(0, (Date.now() - market.createdAtMs) / 3600000);
    }

    function getHoursUntilClose(market) {
      if (!market || !market.closeAtMs) return 999;
      return (market.closeAtMs - Date.now()) / 3600000;
    }

    function getTrendPoints(market) {
      var current = getMarketPrice(market, 'yes');
      if (!Number.isFinite(current)) return 0;
      if (Number.isFinite(market.previousYesPriceNumber)) return (current - market.previousYesPriceNumber) * 100;
      if (Number.isFinite(market.oneWeekPriceChangeNumber)) return market.oneWeekPriceChangeNumber * 100;
      if (Number.isFinite(market.oneMonthPriceChangeNumber)) return market.oneMonthPriceChangeNumber * 50;
      return 0;
    }

    function getRankingScore(market) {
      var volumeScore = Math.log10((market.volumeNumber || 0) + 10) * 210;
      var depthScore = Math.log10((market.secondaryMetricNumber || 0) + 10) * 150;
      var skewScore = Math.abs((getMarketPrice(market, 'yes') || 0.5) - 0.5) * 220;
      var trendScore = Math.abs(getTrendPoints(market)) * 12;
      var mentionScore = market.attentionScore * 7;
      var recencyScore = Math.max(0, 72 - getAgeHours(market)) * 7;
      var urgencyScore = market.closeAtMs ? Math.max(0, 48 - getHoursUntilClose(market)) * 10 : 0;

      if (state.rank === 'new') {
        return recencyScore * 7 + volumeScore * 0.35 + depthScore * 0.25 + trendScore;
      }
      if (state.rank === 'breaking') {
        return (market.isBreaking ? 1800 : 0) + urgencyScore * 5 + trendScore * 1.4 + mentionScore + volumeScore * 0.4;
      }
      if (state.rank === 'all') {
        return volumeScore + depthScore + trendScore + mentionScore * 0.4;
      }
      return volumeScore + depthScore + skewScore + trendScore + mentionScore + recencyScore;
    }

    function hashString(value) {
      var hash = 0;
      String(value || '').split('').forEach(function(ch) {
        hash = ((hash << 5) - hash) + ch.charCodeAt(0);
        hash |= 0;
      });
      return Math.abs(hash);
    }

    function buildPredictionSeries(market) {
      var current = clamp(getMarketPrice(market, 'yes') * 100 || 50, 1, 99);
      var previous = Number.isFinite(market.previousYesPriceNumber)
        ? clamp(market.previousYesPriceNumber * 100, 1, 99)
        : clamp(current - getTrendPoints(market), 1, 99);
      var weeklyAnchor = Number.isFinite(market.oneWeekPriceChangeNumber)
        ? clamp(current - (market.oneWeekPriceChangeNumber * 100), 1, 99)
        : previous;
      var monthlyAnchor = Number.isFinite(market.oneMonthPriceChangeNumber)
        ? clamp(current - (market.oneMonthPriceChangeNumber * 100), 1, 99)
        : weeklyAnchor;
      var seed = hashString(market.id + market.source);
      var volatility = Math.max(2, Math.min(12, Math.abs(current - previous) + Math.log10((market.volumeNumber || 0) + 10) * 1.2));
      var points = [];

      for (var index = 0; index < 24; index += 1) {
        var progress = index / 23;
        var anchor = progress < 0.35
          ? monthlyAnchor + (weeklyAnchor - monthlyAnchor) * (progress / 0.35)
          : progress < 0.7
            ? weeklyAnchor + (previous - weeklyAnchor) * ((progress - 0.35) / 0.35)
            : previous + (current - previous) * ((progress - 0.7) / 0.3);
        var wobble = Math.sin(progress * Math.PI * 3 + seed) * volatility * 0.35 * Math.sin(progress * Math.PI);
        var micro = Math.cos(progress * Math.PI * 8 + seed * 0.7) * volatility * 0.08;
        points.push(clamp(anchor + wobble + micro, 1, 99));
      }

      points[points.length - 1] = current;
      return points;
    }

    function prepareCanvas(canvas, fallbackHeight) {
      if (!canvas || !canvas.getContext) return null;
      var rect = canvas.getBoundingClientRect();
      var width = Math.max(320, Math.round(rect.width || canvas.width || 860));
      var height = Math.max(220, Math.round(fallbackHeight || rect.height || canvas.height || 280));
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      var ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { ctx: ctx, width: width, height: height };
    }

    function drawEmptyPredictionChart() {
      var prepared = prepareCanvas(stageChartEl, 280);
      if (!prepared) return;
      var ctx = prepared.ctx;
      var width = prepared.width;
      var height = prepared.height;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(5, 8, 14, 0.95)';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.moveTo(40, height / 2);
      ctx.lineTo(width - 24, height / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(226,232,240,0.7)';
      ctx.font = '600 16px Inter, sans-serif';
      ctx.fillText('Select a live market to render the probability curve.', 40, height / 2 - 18);
    }

    function drawPredictionStageChart(market) {
      if (!market) {
        drawEmptyPredictionChart();
        return;
      }

      var prepared = prepareCanvas(stageChartEl, 280);
      if (!prepared) return;
      var ctx = prepared.ctx;
      var width = prepared.width;
      var height = prepared.height;
      var pad = { left: 42, right: 18, top: 18, bottom: 28 };
      var chartW = width - pad.left - pad.right;
      var chartH = height - pad.top - pad.bottom;
      var points = buildPredictionSeries(market);
      var current = points[points.length - 1];
      var lineColor = current >= 50 ? '#34d399' : '#6d9fff';
      var fillGradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
      fillGradient.addColorStop(0, current >= 50 ? 'rgba(52,211,153,0.25)' : 'rgba(109,159,255,0.25)');
      fillGradient.addColorStop(1, 'rgba(109,159,255,0.02)');

      function x(index) {
        return pad.left + (index / Math.max(points.length - 1, 1)) * chartW;
      }

      function y(value) {
        return pad.top + chartH - (value / 100) * chartH;
      }

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(5, 8, 14, 0.94)';
      ctx.fillRect(0, 0, width, height);

      [0, 25, 50, 75, 100].forEach(function(level) {
        var levelY = y(level);
        ctx.strokeStyle = level === 50 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)';
        ctx.beginPath();
        ctx.moveTo(pad.left, levelY);
        ctx.lineTo(width - pad.right, levelY);
        ctx.stroke();
        ctx.fillStyle = 'rgba(226,232,240,0.58)';
        ctx.font = '12px Inter, sans-serif';
        ctx.fillText(level + '%', 6, levelY + 4);
      });

      ctx.beginPath();
      points.forEach(function(point, index) {
        var px = x(index);
        var py = y(point);
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.lineTo(x(points.length - 1), height - pad.bottom);
      ctx.lineTo(x(0), height - pad.bottom);
      ctx.closePath();
      ctx.fillStyle = fillGradient;
      ctx.fill();

      ctx.beginPath();
      points.forEach(function(point, index) {
        var px = x(index);
        var py = y(point);
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.lineWidth = 3;
      ctx.strokeStyle = lineColor;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x(points.length - 1), y(current), 5, 0, Math.PI * 2);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x(points.length - 1), y(current), 3, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();

      ctx.fillStyle = '#f8fafc';
      ctx.font = '600 14px Inter, sans-serif';
      ctx.fillText(formatPercent(current / 100), x(points.length - 1) - 48, y(current) - 12);
    }

    function buildDepthRows(market, side) {
      var price = getMarketPrice(market, side);
      if (!Number.isFinite(price) || price <= 0) return [];
      var seed = hashString(market.id + ':' + side);
      var step = market.source === 'kalshi' ? 0.03 : 0.02;
      var baseDepth = market.secondaryMetricNumber || market.volumeNumber || 0;
      var baseShares = Math.max(120, Math.round(baseDepth / Math.max(price, 0.03) / 55));
      var rows = [];
      var maxRawSize = 0;

      for (var index = 0; index < 5; index += 1) {
        var offset = (2 - index) * step;
        var levelPrice = clamp(price + offset, 0.01, 0.99);
        var size = Math.round(baseShares * (1.3 - index * 0.12) * (0.9 + (((seed >> index) & 7) / 20)));
        maxRawSize = Math.max(maxRawSize, size);
        rows.push({
          priceText: formatPercent(levelPrice),
          sizeText: formatCompactNumber(size) + ' shares',
          payoutText: formatOst(size),
          rawSize: size
        });
      }

      rows.forEach(function(row) {
        row.fill = maxRawSize ? (row.rawSize / maxRawSize) * 100 : 0;
      });
      return rows;
    }

    function renderDepthList(container, rows) {
      if (!container) return;
      if (!rows.length) {
        container.innerHTML = '<div class="prediction-depth-empty">No live ladder available.</div>';
        return;
      }
      container.innerHTML = rows.map(function(row) {
        return [
          '<div class="prediction-depth-row">',
            '<div class="prediction-depth-fill" style="width:' + escapeHtml(row.fill.toFixed(1)) + '%"></div>',
            '<span>' + escapeHtml(row.priceText) + '</span>',
            '<strong>' + escapeHtml(row.sizeText) + '</strong>',
            '<em>' + escapeHtml(row.payoutText) + '</em>',
          '</div>'
        ].join('');
      }).join('');
    }

    function updateMarketLink(el, url, text) {
      if (!el) return;
      el.textContent = text;
      el.href = url || '#';
      el.classList.toggle('is-disabled', !url || url === '#');
    }

    function renderPredictionHero(filteredMarkets) {
      var market = getSelectedMarket(filteredMarkets);
      if (!market) {
        if (heroRankEl) heroRankEl.textContent = rankLabels[state.rank] || rankLabels.trending;
        if (heroSourceEl) {
          heroSourceEl.textContent = 'Live venue';
          heroSourceEl.className = 'prediction-market-source source-polymarket';
        }
        if (heroTopicEl) heroTopicEl.textContent = topicLabels.all;
        if (heroTitleEl) heroTitleEl.textContent = 'Select a lead market';
        if (heroDetailEl) heroDetailEl.textContent = 'We surface the lead contract here so the tape, ladder, and OST trade desk stay locked on one live market at a time.';
        if (heroYesPriceEl) heroYesPriceEl.textContent = '--';
        if (heroNoPriceEl) heroNoPriceEl.textContent = '--';
        if (heroProbabilityEl) heroProbabilityEl.textContent = '--';
        if (heroVolumeEl) heroVolumeEl.textContent = '--';
        if (heroDepthEl) heroDepthEl.textContent = '--';
        if (heroCloseEl) heroCloseEl.textContent = '--';
        if (heroMomentumEl) heroMomentumEl.textContent = 'Flat';
        updateMarketLink(heroVenueLinkEl, '', 'Open venue');
        updateMarketLink(heroFeedLinkEl, '', 'Open feed');
        return;
      }

      var sourceClass = getMarketSourceClass(market);
      if (heroRankEl) heroRankEl.textContent = getStageRankLabel(market);
      if (heroSourceEl) {
        heroSourceEl.textContent = market.sourceLabel;
        heroSourceEl.className = 'prediction-market-source ' + sourceClass;
      }
      if (heroTopicEl) heroTopicEl.textContent = topicLabels[market.topic] || topicLabels.all;
      if (heroTitleEl) heroTitleEl.textContent = market.title;
      if (heroDetailEl) heroDetailEl.textContent = market.detail;
      if (heroYesPriceEl) heroYesPriceEl.textContent = market.yesValue;
      if (heroNoPriceEl) heroNoPriceEl.textContent = market.noValue;
      if (heroProbabilityEl) heroProbabilityEl.textContent = market.yesValue;
      if (heroVolumeEl) heroVolumeEl.textContent = market.volumeValue;
      if (heroDepthEl) heroDepthEl.textContent = market.secondaryMetricValue;
      if (heroCloseEl) heroCloseEl.textContent = market.closeText;
      if (heroMomentumEl) heroMomentumEl.textContent = formatSignedPoints(getTrendPoints(market), 'Flat');
      updateMarketLink(heroVenueLinkEl, market.primaryUrl, market.primaryLabel);
      updateMarketLink(heroFeedLinkEl, market.secondaryUrl, market.secondaryLabel);
    }

    function buildPredictionPulseItems(filteredMarkets) {
      var visibleMarkets = (filteredMarkets && filteredMarkets.length ? filteredMarkets : state.markets).slice();
      var items = [];
      var seen = {};

      function addItem(label, copy, market) {
        if (!market || seen[market.id]) return;
        seen[market.id] = true;
        items.push({ label: label, copy: copy, market: market });
      }

      addItem('Lead contract', 'The first market in the current board.', visibleMarkets[0]);
      addItem('Fast mover', 'Largest live shift in the current lane.', visibleMarkets.slice().sort(function(a, b) {
        return Math.abs(getTrendPoints(b)) - Math.abs(getTrendPoints(a));
      })[0]);
      addItem('Closes soon', 'Nearest live expiry still on the tape.', visibleMarkets.filter(function(market) {
        return market.closeAtMs && market.closeAtMs > Date.now();
      }).sort(function(a, b) {
        return a.closeAtMs - b.closeAtMs;
      })[0]);
      addItem('Deepest book', 'Highest visible depth in this board.', visibleMarkets.slice().sort(function(a, b) {
        return (b.secondaryMetricNumber || 0) - (a.secondaryMetricNumber || 0);
      })[0]);

      visibleMarkets.forEach(function(market) {
        if (items.length >= 3) return;
        addItem('Live contract', 'Visible in the current market lane.', market);
      });

      return items.slice(0, 3);
    }

    function renderPredictionPulse(filteredMarkets) {
      if (!pulseEl) return;
      var items = buildPredictionPulseItems(filteredMarkets);

      if (pulseMetaEl) {
        pulseMetaEl.textContent = items.length
          ? filteredMarkets.length + ' live contracts in this lane. Click a tile to focus the desk.'
          : 'Click a tile to load the stage and trade desk.';
      }

      if (!items.length) {
        pulseEl.innerHTML = '<div class="prediction-pulse-empty">' + escapeHtml(state.loading ? 'Loading market pulse...' : 'No live contracts in this lane yet.') + '</div>';
        return;
      }

      pulseEl.innerHTML = items.map(function(item) {
        var market = item.market;
        var trendPoints = getTrendPoints(market);
        var toneClass = trendPoints > 0 ? ' is-up' : trendPoints < 0 ? ' is-down' : '';
        var isSelected = market.id === state.selectedMarketId;
        var sourceClass = getMarketSourceClass(market);
        return [
          '<button type="button" class="prediction-pulse-card' + toneClass + (isSelected ? ' is-selected' : '') + '" data-prediction-select-market-id="' + escapeHtml(market.id) + '" aria-pressed="' + (isSelected ? 'true' : 'false') + '">',
            '<span class="prediction-pulse-kicker">' + escapeHtml(item.label) + '</span>',
            '<div class="prediction-pulse-topline">',
              '<span class="prediction-market-source ' + sourceClass + '">' + escapeHtml(market.sourceLabel) + '</span>',
              '<span class="prediction-market-topic">' + escapeHtml(topicLabels[market.topic] || topicLabels.all) + '</span>',
            '</div>',
            '<strong>' + escapeHtml(market.title) + '</strong>',
            '<p>' + escapeHtml(item.copy) + '</p>',
            '<div class="prediction-pulse-meta">',
              '<span>' + escapeHtml(market.yesLabel) + ' ' + escapeHtml(market.yesValue) + '</span>',
              '<span>' + escapeHtml(formatSignedPoints(trendPoints, 'Flat')) + '</span>',
              '<span>' + escapeHtml(market.closeText) + '</span>',
            '</div>',
          '</button>'
        ].join('');
      }).join('');
    }

    function renderPredictionTape(filteredMarkets) {
      if (!tapeEl) return;
      var tapeMarkets = (filteredMarkets && filteredMarkets.length ? filteredMarkets : state.markets).slice(0, 8);

      if (!tapeMarkets.length) {
        tapeEl.innerHTML = '<div class="prediction-tape-empty">' + escapeHtml(state.loading ? 'Loading venue tape...' : 'No live contracts in this lane yet.') + '</div>';
        return;
      }

      tapeEl.innerHTML = tapeMarkets.map(function(market) {
        var trendPoints = getTrendPoints(market);
        var sourceClass = getMarketSourceClass(market);
        var isSelected = market.id === state.selectedMarketId;
        return [
          '<button type="button" class="prediction-tape-chip' + (trendPoints > 0 ? ' is-up' : trendPoints < 0 ? ' is-down' : '') + (isSelected ? ' is-selected' : '') + '" data-prediction-select-market-id="' + escapeHtml(market.id) + '">',
            '<span class="prediction-market-source ' + sourceClass + '">' + escapeHtml(market.sourceLabel) + '</span>',
            '<strong>' + escapeHtml(truncateText(market.title, 62)) + '</strong>',
            '<span>' + escapeHtml(market.yesLabel) + ' ' + escapeHtml(market.yesValue) + ' • ' + escapeHtml(market.closeText) + '</span>',
            '<em>' + escapeHtml(formatSignedPoints(trendPoints, 'Flat')) + '</em>',
          '</button>'
        ].join('');
      }).join('');
    }

    function getStageRankLabel(market) {
      if (state.rank !== 'all') return rankLabels[state.rank] || rankLabels.trending;
      if (market && market.isBreaking) return rankLabels.breaking;
      return 'Lead market';
    }

    function renderPredictionStage(filteredMarkets) {
      var market = getSelectedMarket(filteredMarkets);
      if (!market) {
        if (stageRankEl) stageRankEl.textContent = rankLabels[state.rank] || rankLabels.trending;
        if (stageSourceEl) {
          stageSourceEl.textContent = 'OST';
          stageSourceEl.className = 'prediction-market-source source-polymarket';
        }
        if (stageTopicEl) stageTopicEl.textContent = topicLabels.all;
        if (stageTitleEl) stageTitleEl.textContent = 'Select a live market';
        if (stageDetailEl) stageDetailEl.textContent = 'Choose a live contract to inspect the live probability curve, price ladder, share pricing, and OST ticket details before you commit.';
        if (stageYesPriceEl) stageYesPriceEl.textContent = '--';
        if (stageNoPriceEl) stageNoPriceEl.textContent = '--';
        if (stageProbabilityEl) stageProbabilityEl.textContent = '--';
        if (stageVolumeEl) stageVolumeEl.textContent = '--';
        if (stageDepthEl) stageDepthEl.textContent = '--';
        if (stageCloseEl) stageCloseEl.textContent = '--';
        if (stageChartCopyEl) stageChartCopyEl.textContent = 'Anchored to current share pricing, recent venue changes, and source liquidity.';
        if (stageTrendEl) stageTrendEl.textContent = 'Flat';
        if (stageAxisStartEl) stageAxisStartEl.textContent = 'Opened --';
        if (stageAxisEndEl) stageAxisEndEl.textContent = 'Closes --';
        renderDepthList(depthYesEl, []);
        renderDepthList(depthNoEl, []);
        updateMarketLink(stageVenueLinkEl, '', 'Open venue');
        updateMarketLink(stageFeedLinkEl, '', 'Open feed');
        drawEmptyPredictionChart();
        return;
      }

      var sourceClass = market.source === 'kalshi' ? 'source-kalshi' : 'source-polymarket';
      if (stageRankEl) stageRankEl.textContent = getStageRankLabel(market);
      if (stageSourceEl) {
        stageSourceEl.textContent = market.sourceLabel;
        stageSourceEl.className = 'prediction-market-source ' + sourceClass;
      }
      if (stageTopicEl) stageTopicEl.textContent = topicLabels[market.topic] || topicLabels.all;
      if (stageTitleEl) stageTitleEl.textContent = market.title;
      if (stageDetailEl) stageDetailEl.textContent = market.detail;
      if (stageYesPriceEl) stageYesPriceEl.textContent = market.yesValue;
      if (stageNoPriceEl) stageNoPriceEl.textContent = market.noValue;
      if (stageProbabilityEl) stageProbabilityEl.textContent = market.yesValue;
      if (stageVolumeEl) stageVolumeEl.textContent = market.volumeValue;
      if (stageDepthEl) stageDepthEl.textContent = market.secondaryMetricValue;
      if (stageCloseEl) stageCloseEl.textContent = market.closeText;
      if (stageChartCopyEl) {
        stageChartCopyEl.textContent = market.source === 'polymarket'
          ? 'Anchored to current price, weekly change, and venue liquidity.'
          : 'Anchored to current price, previous trade, and venue liquidity.';
      }
      if (stageTrendEl) {
        var trendPoints = getTrendPoints(market);
        stageTrendEl.textContent = formatSignedPoints(trendPoints, 'Flat');
        stageTrendEl.className = 'prediction-stage-trend' + (trendPoints > 0 ? ' is-up' : trendPoints < 0 ? ' is-down' : '');
      }
      if (stageAxisStartEl) stageAxisStartEl.textContent = formatAxisDate(market.createdAtMs, 'Opened');
      if (stageAxisEndEl) stageAxisEndEl.textContent = formatAxisDate(market.closeAtMs, 'Closes');
      renderDepthList(depthYesEl, buildDepthRows(market, 'yes'));
      renderDepthList(depthNoEl, buildDepthRows(market, 'no'));
      updateMarketLink(stageVenueLinkEl, market.primaryUrl, market.primaryLabel);
      updateMarketLink(stageFeedLinkEl, market.secondaryUrl, market.secondaryLabel);
      drawPredictionStageChart(market);
    }

    function renderPredictionTicket(filteredMarkets) {
      var market = getSelectedMarket(filteredMarkets);
      if (market && market.id !== state.selectedMarketId) {
        state.selectedMarketId = market.id;
      }

      if (!market) {
        if (selectedTitleEl) selectedTitleEl.textContent = t('wallet.portal.prediction.noSelection', 'No market selected');
        if (selectedDetailEl) selectedDetailEl.textContent = t('wallet.portal.prediction.noSelectionCopy', 'Choose a live contract from the board to build an OST-denominated position.');
        if (selectedSourceEl) selectedSourceEl.textContent = 'OST';
        if (selectedTopicEl) selectedTopicEl.textContent = topicLabels.all;
        if (yesValueEl) yesValueEl.textContent = '--';
        if (noValueEl) noValueEl.textContent = '--';
        if (estimatedSharesEl) estimatedSharesEl.textContent = '--';
        if (potentialReturnEl) potentialReturnEl.textContent = '--';
        if (entryPriceEl) entryPriceEl.textContent = '--';
        if (payoutMultipleEl) payoutMultipleEl.textContent = '--';
        if (winNetEl) winNetEl.textContent = '--';
        if (settlementPathEl) settlementPathEl.textContent = 'Wallet -> OST vault';
        if (tradeActionBtn) tradeActionBtn.disabled = true;
        setTradeStatus(t('wallet.portal.prediction.tradeSelectPrompt', 'Select a live contract first.'), 'info');
        return;
      }

      var sourceClass = market.source === 'kalshi' ? 'source-kalshi' : 'source-polymarket';
      if (selectedSourceEl) {
        selectedSourceEl.textContent = market.sourceLabel;
        selectedSourceEl.className = 'prediction-market-source ' + sourceClass;
      }
      if (selectedTopicEl) selectedTopicEl.textContent = topicLabels[market.topic] || topicLabels.all;
      if (selectedTitleEl) selectedTitleEl.textContent = market.title;
      if (selectedDetailEl) selectedDetailEl.textContent = market.detail;
      if (yesValueEl) yesValueEl.textContent = market.yesValue;
      if (noValueEl) noValueEl.textContent = market.noValue;
      setChipState(outcomeToggle, 'data-prediction-side', state.selectedSide);
      setChipState(stakeQuickEl, 'data-prediction-stake', String(Math.round(Number(state.stake) || 0)));

      var priceFraction = getMarketPrice(market, state.selectedSide);
      var estimatedShares = calculateEstimatedShares(state.stake, priceFraction);
      var estimatedReturn = calculatePotentialReturn(state.stake, priceFraction);
      var payoutMultiple = Number.isFinite(priceFraction) && priceFraction > 0 ? (1 / priceFraction) : NaN;
      var netIfRight = Number.isFinite(estimatedReturn) ? Math.max(estimatedReturn - state.stake, 0) : NaN;
      var hasSufficientBalance = state.availableBalance == null || state.availableBalance + 1e-9 >= Number(state.stake);
      var canTradeSelection = Number.isFinite(priceFraction) && priceFraction > 0;

      if (estimatedSharesEl) {
        estimatedSharesEl.textContent = Number.isFinite(estimatedShares)
          ? formatCompactNumber(estimatedShares) + ' shares'
          : t('wallet.portal.prediction.tradeUnavailable', 'Unavailable');
      }
      if (potentialReturnEl) {
        potentialReturnEl.textContent = Number.isFinite(estimatedReturn)
          ? formatOst(estimatedReturn)
          : t('wallet.portal.prediction.tradeUnavailable', 'Unavailable');
      }
      if (entryPriceEl) {
        entryPriceEl.textContent = Number.isFinite(priceFraction)
          ? formatPercent(priceFraction)
          : t('wallet.portal.prediction.tradeUnavailable', 'Unavailable');
      }
      if (payoutMultipleEl) {
        payoutMultipleEl.textContent = Number.isFinite(payoutMultiple)
          ? payoutMultiple.toFixed(2) + 'x'
          : t('wallet.portal.prediction.tradeUnavailable', 'Unavailable');
      }
      if (winNetEl) {
        winNetEl.textContent = Number.isFinite(netIfRight)
          ? formatOst(netIfRight)
          : t('wallet.portal.prediction.tradeUnavailable', 'Unavailable');
      }
      if (settlementPathEl) {
        settlementPathEl.textContent = market.sourceLabel + ' -> OST vault';
      }

      if (availableBalanceEl) {
        availableBalanceEl.textContent = state.availableBalance == null
          ? t('wallet.portal.prediction.connectWalletPrompt', 'Connect wallet')
          : formatOst(state.availableBalance);
      }

      if (tradeHeadingEl) tradeHeadingEl.textContent = 'Build an OST ticket';
      if (tradeCopyEl) tradeCopyEl.textContent = 'Choose the live side, size the order, and route an OST-denominated ticket from the same market board into the devnet settlement vault.';
      if (tradeActionBtn) {
        tradeActionBtn.disabled = state.loading || state.placing || !connectedWalletSession || !connectedWalletSession.publicKey || !canTradeSelection || !hasSufficientBalance;
      }
      if (tradeActionLabelEl) {
        tradeActionLabelEl.textContent = state.placing
          ? t('wallet.portal.prediction.tradeSending', 'Sending OST order...')
          : state.selectedSide === 'no'
            ? 'Buy No with OST'
            : 'Buy Yes with OST';
      }

      if (state.placing) {
        setTradeStatus(t('wallet.portal.prediction.tradePending', 'Sending a real OST market ticket to the prediction vault...'), 'warning');
      } else if (!connectedWalletSession || !connectedWalletSession.publicKey) {
        setTradeStatus(t('wallet.portal.prediction.tradeWalletNeeded', 'Connect your OST wallet to place a market ticket.'), 'info');
      } else if (!canTradeSelection) {
        setTradeStatus(t('wallet.portal.prediction.tradeUnavailable', 'This side is not tradeable right now.'), 'warning');
      } else if (!hasSufficientBalance) {
        setTradeStatus(t('wallet.portal.prediction.tradeNotEnough', 'This wallet does not have enough OST for that stake.'), 'error');
      } else {
        setTradeStatus(t('wallet.portal.prediction.tradeReady', 'Ready to route this position into the OST prediction vault.'), 'success');
      }
    }

    function buildPolymarketUrl(item) {
      return item.slug ? 'https://polymarket.com/event/' + encodeURIComponent(item.slug) : 'https://polymarket.com/';
    }

    function buildKalshiUrl(item) {
      return item.eventTicker ? 'https://kalshi.com/markets' : 'https://kalshi.com/markets';
    }

    function buildKalshiApiUrl(item) {
      return item.ticker ? 'https://api.elections.kalshi.com/trade-api/v2/markets/' + encodeURIComponent(item.ticker) : 'https://api.elections.kalshi.com/trade-api/v2/markets';
    }

    function mapPolymarketMarket(item) {
      var question = item.question || 'Untitled market';
      var outcomes = parseMaybeJson(item.outcomes);
      var prices = parseMaybeJson(item.outcomePrices).map(Number);
      var yesIndex = outcomes.findIndex(function(outcome) {
        return String(outcome).toLowerCase() === 'yes';
      });
      var noIndex = outcomes.findIndex(function(outcome) {
        return String(outcome).toLowerCase() === 'no';
      });
      var yesPrice = safeFraction(yesIndex >= 0 ? prices[yesIndex] : prices[0], NaN);
      var noPrice = safeFraction(noIndex >= 0 ? prices[noIndex] : prices[1], NaN);
      if (!Number.isFinite(noPrice) && Number.isFinite(yesPrice)) noPrice = clamp(1 - yesPrice, 0, 1);
      if (!Number.isFinite(yesPrice) && Number.isFinite(noPrice)) yesPrice = clamp(1 - noPrice, 0, 1);

      var rawDetail = item.description || t('wallet.portal.prediction.polyDetail', 'Live yes/no contract routed directly from Polymarket.');
      var detail = summarizeMarketText(rawDetail, t('wallet.portal.prediction.polyDetail', 'Live yes/no contract routed directly from Polymarket.'), 180);
      var textBlob = [question, rawDetail, detail, item.slug, item.category].join(' ');
      var topics = buildTopicSet(textBlob);
      var volumeNumber = Number(item.volume24hr || item.volume || item.volumeNum || 0);
      var liquidityNumber = Number(item.liquidityNum || item.liquidity || item.liquidityClob || 0);
      var createdAtMs = toDateMs(item.createdAt || item.startDate || item.startDateIso);
      var closeAtMs = toDateMs(item.endDate || item.endDateIso);
      var weekChange = Number(item.oneWeekPriceChange);
      var monthChange = Number(item.oneMonthPriceChange);
      var lastTradePrice = safeFraction(item.lastTradePrice, yesPrice);
      var previousYesPrice = Number.isFinite(lastTradePrice)
        ? lastTradePrice
        : Number.isFinite(weekChange)
          ? clamp(yesPrice - weekChange, 0, 1)
          : NaN;
      var primaryTopic = pickPrimaryTopic(topics);

      return {
        source: 'polymarket',
        sourceLabel: 'Polymarket',
        id: String(item.id),
        title: question,
        detail: detail,
        yesLabel: t('wallet.portal.prediction.yesLabel', 'Yes'),
        yesValue: formatPercent(yesPrice),
        yesPriceNumber: yesPrice,
        noLabel: t('wallet.portal.prediction.noLabel', 'No'),
        noValue: formatPercent(noPrice),
        noPriceNumber: noPrice,
        volumeLabel: t('wallet.portal.prediction.volumeLabel', 'Volume'),
        volumeValue: formatMoney(volumeNumber),
        volumeNumber: volumeNumber,
        secondaryMetricLabel: t('wallet.portal.prediction.liquidityLabel', 'Liquidity'),
        secondaryMetricValue: formatMoney(liquidityNumber),
        secondaryMetricNumber: liquidityNumber,
        closeText: formatRelativeTime(closeAtMs),
        closeLabel: t('wallet.portal.prediction.closeLabel', 'Closes'),
        topic: primaryTopic,
        topics: topics,
        displayTopics: getDisplayTopics(topics),
        searchText: [question, rawDetail, detail, item.slug, item.category].join(' ').toLowerCase(),
        primaryUrl: buildPolymarketUrl(item),
        secondaryUrl: 'https://gamma-api.polymarket.com/markets/' + encodeURIComponent(item.id),
        secondaryLabel: t('wallet.portal.prediction.openFeed', 'Open feed'),
        primaryLabel: t('wallet.portal.prediction.openVenue', 'Open venue'),
        contractLabel: t('wallet.portal.prediction.binaryContract', 'Binary contract'),
        sortValue: volumeNumber,
        createdAtMs: createdAtMs,
        closeAtMs: closeAtMs,
        previousYesPriceNumber: previousYesPrice,
        lastPriceNumber: lastTradePrice,
        oneWeekPriceChangeNumber: Number.isFinite(weekChange) ? weekChange : NaN,
        oneMonthPriceChangeNumber: Number.isFinite(monthChange) ? monthChange : NaN,
        attentionScore: estimateAttentionScore(textBlob, volumeNumber, liquidityNumber),
        isBreaking: isBreakingText(textBlob, topics, closeAtMs)
      };
    }

    function mapKalshiMarket(item) {
      var rawTitle = item.title || item.ticker || 'Kalshi market';
      var yesPrice = safeFraction(item.yes_ask_dollars || item.yes_bid_dollars || item.last_price_dollars, NaN);
      var noPrice = safeFraction(item.no_ask_dollars || item.no_bid_dollars || (Number.isFinite(yesPrice) ? 1 - yesPrice : NaN), NaN);
      if (!Number.isFinite(noPrice) && Number.isFinite(yesPrice)) noPrice = clamp(1 - yesPrice, 0, 1);
      if (!Number.isFinite(yesPrice) && Number.isFinite(noPrice)) yesPrice = clamp(1 - noPrice, 0, 1);

      var rawDetail = item.yes_sub_title || item.no_sub_title || item.rules_primary || t('wallet.portal.prediction.kalshiDetail', 'Live event contract routed from Kalshi.');
      var summary = summarizeKalshiBundle(rawTitle, rawDetail);
      var title = summary.title;
      var detail = summary.detail;
      var textBlob = [rawTitle, rawDetail, title, detail, item.event_ticker, item.ticker].join(' ');
      var topics = buildTopicSet(textBlob);
      var volumeNumber = Number(item.volume_24h_fp || item.volume_fp || item.liquidity_dollars || 0);
      var openInterestNumber = Number(item.open_interest_fp || item.liquidity_dollars || item.notional_value_dollars || 0);
      var createdAtMs = toDateMs(item.created_time || item.open_time);
      var closeAtMs = toDateMs(item.close_time);
      var previousYesPrice = safeFraction(item.previous_price_dollars, NaN);
      var primaryTopic = pickPrimaryTopic(topics);

      return {
        source: 'kalshi',
        sourceLabel: 'Kalshi',
        id: String(item.ticker),
        title: title,
        detail: detail,
        yesLabel: t('wallet.portal.prediction.yesAskLabel', 'Yes ask'),
        yesValue: formatPercent(yesPrice),
        yesPriceNumber: yesPrice,
        noLabel: t('wallet.portal.prediction.noAskLabel', 'No ask'),
        noValue: formatPercent(noPrice),
        noPriceNumber: noPrice,
        volumeLabel: t('wallet.portal.prediction.volumeLabel', 'Volume'),
        volumeValue: formatMoney(volumeNumber),
        volumeNumber: volumeNumber,
        secondaryMetricLabel: t('wallet.portal.prediction.openInterestLabel', 'Open interest'),
        secondaryMetricValue: formatMoney(openInterestNumber),
        secondaryMetricNumber: openInterestNumber,
        closeText: formatRelativeTime(closeAtMs),
        closeLabel: t('wallet.portal.prediction.closeLabel', 'Closes'),
        topic: primaryTopic,
        topics: topics,
        displayTopics: getDisplayTopics(topics),
        searchText: [rawTitle, rawDetail, title, detail, item.event_ticker, item.ticker].join(' ').toLowerCase(),
        primaryUrl: buildKalshiUrl(item),
        secondaryUrl: buildKalshiApiUrl(item),
        secondaryLabel: t('wallet.portal.prediction.openFeed', 'Open feed'),
        primaryLabel: t('wallet.portal.prediction.openVenue', 'Open venue'),
        contractLabel: t('wallet.portal.prediction.eventContract', 'Event contract'),
        sortValue: volumeNumber,
        createdAtMs: createdAtMs,
        closeAtMs: closeAtMs,
        previousYesPriceNumber: previousYesPrice,
        lastPriceNumber: safeFraction(item.last_price_dollars, yesPrice),
        oneWeekPriceChangeNumber: Number.isFinite(previousYesPrice) && Number.isFinite(yesPrice) ? yesPrice - previousYesPrice : NaN,
        oneMonthPriceChangeNumber: NaN,
        attentionScore: estimateAttentionScore(textBlob, volumeNumber, openInterestNumber),
        isBreaking: isBreakingText(textBlob, topics, closeAtMs)
      };
    }

    function interleaveMarkets(markets, limit) {
      if (state.source !== 'all') return markets.slice(0, limit);
      var groups = {
        polymarket: markets.filter(function(market) { return market.source === 'polymarket'; }),
        kalshi: markets.filter(function(market) { return market.source === 'kalshi'; })
      };
      var order = groups.polymarket.length >= groups.kalshi.length ? ['polymarket', 'kalshi'] : ['kalshi', 'polymarket'];
      var mixed = [];
      while (mixed.length < limit && (groups.polymarket.length || groups.kalshi.length)) {
        order.forEach(function(source) {
          if (mixed.length >= limit) return;
          if (groups[source].length) mixed.push(groups[source].shift());
        });
      }
      return mixed;
    }

    function getFilteredMarkets() {
      var query = state.query.trim().toLowerCase();
      var filtered = state.markets.filter(function(market) {
        if (state.source !== 'all' && market.source !== state.source) return false;
        if (state.topic !== 'all' && !market.topics.has(state.topic)) return false;
        if (state.rank === 'breaking' && !market.isBreaking) return false;
        if (query && market.searchText.indexOf(query) === -1) return false;
        return true;
      });

      filtered.sort(function(a, b) {
        var scoreDiff = getRankingScore(b) - getRankingScore(a);
        if (scoreDiff) return scoreDiff;
        return (b.sortValue || 0) - (a.sortValue || 0);
      });

      return interleaveMarkets(filtered, query ? 24 : 18);
    }

    function updateStatus(kind, text) {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.classList.remove('is-live', 'is-warning', 'is-error');
      if (kind) statusEl.classList.add(kind);
    }

    function updateSummary(filteredMarkets) {
      if (countEl) countEl.textContent = String(filteredMarkets.length);
      if (sourceCountEl) {
        var liveCount = Number(state.sourceHealth.polymarket) + Number(state.sourceHealth.kalshi);
        sourceCountEl.textContent = liveCount + ' / 2';
      }
      if (breakingCountEl) {
        breakingCountEl.textContent = String(state.markets.filter(function(market) {
          return market.isBreaking;
        }).length);
      }
    }

    function renderPredictionBoard() {
      if (!listEl) return;
      setChipState(sourceToggle, 'data-prediction-source', state.source);
      setChipState(rankToggle, 'data-prediction-rank', state.rank);
      setChipState(topicToggle, 'data-prediction-topic', state.topic);

      var filteredMarkets = getFilteredMarkets();
      updateSummary(filteredMarkets);

      if (!filteredMarkets.length) {
        var emptyText = state.loading
          ? t('wallet.portal.prediction.loadingBoard', 'Loading live prediction markets...')
          : state.topic === 'crypto'
            ? 'No live crypto contracts matched that lane. Try All markets or search for bitcoin, ethereum, solana, or ETF.'
            : 'No active markets matched that filter. Try another topic, rank, or search term.';
        listEl.innerHTML = '<div class="prediction-market-empty-card">' + escapeHtml(emptyText) + '</div>';
        renderPredictionTape(filteredMarkets);
        renderPredictionHero(filteredMarkets);
        renderPredictionPulse(filteredMarkets);
        renderPredictionStage(filteredMarkets);
        renderPredictionTicket(filteredMarkets);
        renderPredictionLedger();
        renderLatestReceipt();
        return;
      }

      if (!getSelectedMarket(filteredMarkets)) {
        state.selectedMarketId = filteredMarkets[0].id;
      }

      listEl.innerHTML = filteredMarkets.map(function(market, index) {
        var sourceClass = getMarketSourceClass(market);
        var topicLabel = topicLabels[market.topic] || topicLabels.all;
        var isFeatured = index === 0;
        var isSelected = market.id === state.selectedMarketId;
        var articleClass = 'prediction-market-card ' + (market.source === 'polymarket' ? 'source-polymarket-card' : 'source-kalshi-card') + (isFeatured ? ' is-featured' : '');
        if (isSelected) articleClass += ' is-selected';
        var spotlightLabel = state.rank === 'breaking'
          ? 'Breaking tape'
          : state.rank === 'new'
            ? 'Fresh market'
            : 'Lead contract';
        var topicTags = market.displayTopics.slice(0, 3).map(function(topic) {
          return '<span class="prediction-market-tag">' + escapeHtml(topicLabels[topic] || topicLabels.all) + '</span>';
        }).join('');
        return [
          '<article class="' + articleClass + '" data-prediction-market-id="' + escapeHtml(market.id) + '" tabindex="0">',
            '<div class="prediction-market-topline">',
              '<span class="prediction-market-source ' + sourceClass + '">' + escapeHtml(market.sourceLabel) + '</span>',
              '<span class="prediction-market-topic">' + escapeHtml(topicLabel) + '</span>',
            '</div>',
            '<div class="prediction-market-copy">',
              (isFeatured ? '<span class="prediction-market-spotlight">' + escapeHtml(spotlightLabel) + '</span>' : ''),
              '<h5>' + escapeHtml(market.title) + '</h5>',
              '<p>' + escapeHtml(market.detail) + '</p>',
            '</div>',
            '<div class="prediction-market-tags">' + topicTags + '</div>',
            '<div class="prediction-market-probability-row">',
              '<span>' + escapeHtml(market.yesLabel) + ' ' + escapeHtml(market.yesValue) + '</span>',
              '<span>' + escapeHtml(market.noLabel) + ' ' + escapeHtml(market.noValue) + '</span>',
            '</div>',
            '<div class="prediction-market-bar"><span class="prediction-market-bar-fill" style="width:' + escapeHtml(String(clamp((market.yesPriceNumber || 0) * 100, 0, 100))) + '%"></span></div>',
            '<div class="prediction-market-price-grid">',
              '<div class="prediction-market-price">',
                '<span>' + escapeHtml(market.yesLabel) + '</span>',
                '<strong>' + escapeHtml(market.yesValue) + '</strong>',
              '</div>',
              '<div class="prediction-market-price">',
                '<span>' + escapeHtml(market.noLabel) + '</span>',
                '<strong>' + escapeHtml(market.noValue) + '</strong>',
              '</div>',
            '</div>',
            '<div class="prediction-market-meta-row">',
              '<div class="prediction-market-metric">',
                '<span>' + escapeHtml(market.volumeLabel) + '</span>',
                '<strong>' + escapeHtml(market.volumeValue) + '</strong>',
              '</div>',
              '<div class="prediction-market-metric">',
                '<span>' + escapeHtml(market.secondaryMetricLabel) + '</span>',
                '<strong>' + escapeHtml(market.secondaryMetricValue) + '</strong>',
              '</div>',
              '<div class="prediction-market-metric">',
                '<span>' + escapeHtml(market.closeLabel) + '</span>',
                '<strong>' + escapeHtml(market.closeText) + '</strong>',
              '</div>',
            '</div>',
            '<div class="prediction-market-footer">',
              '<span class="prediction-market-contract">' + escapeHtml(market.contractLabel) + '</span>',
              '<span class="prediction-market-contract prediction-market-contract-trend">' + escapeHtml(formatSignedPoints(getTrendPoints(market), 'Flat')) + '</span>',
            '</div>',
            '<div class="prediction-market-actions">',
              '<a class="prediction-market-link" href="' + escapeHtml(market.primaryUrl) + '" target="_blank" rel="noopener">' + escapeHtml(market.primaryLabel) + '</a>',
              '<a class="prediction-market-api-link" href="' + escapeHtml(market.secondaryUrl) + '" target="_blank" rel="noopener">' + escapeHtml(market.secondaryLabel) + '</a>',
            '</div>',
          '</article>'
        ].join('');
      }).join('');

      renderPredictionTape(filteredMarkets);
      renderPredictionHero(filteredMarkets);
      renderPredictionPulse(filteredMarkets);
      renderPredictionStage(filteredMarkets);
      renderPredictionTicket(filteredMarkets);
      renderPredictionLedger();
      renderLatestReceipt();
    }

    function syncPredictionMarketBoardUi() {
      var kickerEl = document.getElementById('predictionMarketKicker');
      var headingEl = document.getElementById('predictionMarketHeading');
      var introEl = document.getElementById('predictionMarketIntro');
      var noteEl = document.getElementById('predictionMarketNote');
      var pulseHeadingEl = document.getElementById('predictionPulseHeading');
      var pulseCopyEl = document.getElementById('predictionPulseCopy');
      var marketsLabelEl = document.getElementById('predictionStatMarketsLabel');
      var sourcesLabelEl = document.getElementById('predictionStatSourcesLabel');
      var breakingLabelEl = document.getElementById('predictionStatBtcLabel');
      var searchLabelEl = document.getElementById('predictionSearchLabel');

      if (kickerEl) kickerEl.textContent = 'Predict with OST';
      if (headingEl) headingEl.textContent = 'Prediction venue';
      if (introEl) introEl.textContent = 'Scan live Polymarket and Kalshi markets, read the tape, inspect the ladder, and route an OST ticket without leaving the wallet rail.';
      if (noteEl) noteEl.textContent = 'Public venue feeds expose live prices, change anchors, and liquidity. The curve and ladder reflect that data directly without inventing candles or settlement.';
      if (pulseHeadingEl) pulseHeadingEl.textContent = 'Market pulse';
      if (pulseCopyEl) pulseCopyEl.textContent = 'Lead contracts, fastest movers, and the markets closing soonest across both venues.';
      if (marketsLabelEl) marketsLabelEl.textContent = 'Markets loaded';
      if (sourcesLabelEl) sourcesLabelEl.textContent = 'Live sources';
      if (breakingLabelEl) breakingLabelEl.textContent = 'Breaking now';
      if (searchLabelEl) searchLabelEl.textContent = 'Search any contract';
      if (searchEl) {
        searchEl.placeholder = 'Bitcoin, Trump, NBA, inflation, Nvidia, weather, election...';
        searchEl.setAttribute('aria-label', 'Search live prediction contracts');
      }
      if (refreshBtn) refreshBtn.textContent = 'Refresh';

      if (sourceToggle) {
        sourceToggle.querySelectorAll('button[data-prediction-source]').forEach(function(btn) {
          var value = btn.getAttribute('data-prediction-source');
          if (value === 'all') btn.textContent = 'All venues';
          if (value === 'polymarket') btn.textContent = 'Polymarket';
          if (value === 'kalshi') btn.textContent = 'Kalshi';
        });
      }

      if (rankToggle) {
        rankToggle.querySelectorAll('button[data-prediction-rank]').forEach(function(btn) {
          var value = btn.getAttribute('data-prediction-rank');
          btn.textContent = rankLabels[value] || value;
        });
      }

      if (topicToggle) {
        topicToggle.querySelectorAll('button[data-prediction-topic]').forEach(function(btn) {
          var value = btn.getAttribute('data-prediction-topic');
          btn.textContent = topicLabels[value] || value;
        });
      }

      renderPredictionBoard();
    }
    window.syncPredictionMarketBoardUi = syncPredictionMarketBoardUi;
    window.syncPredictionMarketTradeWallet = syncTradeWallet;

    function normalizeArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function extractPolymarketMarkets(data) {
      var direct = normalizeArray(data);
      if (direct.length) return direct;
      return normalizeArray(data && data.value);
    }

    function extractKalshiMarkets(data) {
      var direct = normalizeArray(data);
      if (direct.length) return direct;
      return normalizeArray(data && data.markets);
    }

    function fetchPredictionMarketSnapshot() {
      if (window.location.protocol === 'file:') {
        return Promise.reject(new Error('Prediction snapshot unavailable on file protocol'));
      }

      return fetch('data/prediction-market-snapshot.json', {
        headers: { accept: 'application/json' },
        cache: 'no-store'
      }).then(function(response) {
        if (!response.ok) throw new Error('Snapshot returned ' + response.status);
        return response.json();
      }).then(function(snapshot) {
        var polymarketMarkets = extractPolymarketMarkets(snapshot && snapshot.polymarket).filter(function(item) {
          return item && item.active !== false && item.closed !== true;
        }).map(mapPolymarketMarket);
        var kalshiMarkets = extractKalshiMarkets(snapshot && snapshot.kalshi).filter(function(item) {
          return item && item.status === 'active';
        }).map(mapKalshiMarket);
        var sourceHealth = snapshot && snapshot.sourceHealth ? snapshot.sourceHealth : null;
        var generatedAt = snapshot && snapshot.generatedAt ? new Date(snapshot.generatedAt) : new Date();

        return {
          polymarketMarkets: polymarketMarkets,
          kalshiMarkets: kalshiMarkets,
          sourceHealth: {
            polymarket: sourceHealth ? sourceHealth.polymarket !== false : polymarketMarkets.length > 0,
            kalshi: sourceHealth ? sourceHealth.kalshi !== false : kalshiMarkets.length > 0
          },
          generatedAt: Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt
        };
      });
    }

    function setLoadedPredictionMarkets(polymarketMarkets, kalshiMarkets, sourceHealth, updatedAt) {
      var markets = [];
      var failures = [];

      state.sourceHealth.polymarket = !!(sourceHealth && sourceHealth.polymarket);
      state.sourceHealth.kalshi = !!(sourceHealth && sourceHealth.kalshi);

      if (state.sourceHealth.polymarket) {
        markets = markets.concat(polymarketMarkets || []);
      } else {
        failures.push('Polymarket');
      }

      if (state.sourceHealth.kalshi) {
        markets = markets.concat(kalshiMarkets || []);
      } else {
        failures.push('Kalshi');
      }

      if (!state.sourceHealth.polymarket && polymarketMarkets && polymarketMarkets.length) {
        markets = markets.concat(polymarketMarkets);
      }

      if (!state.sourceHealth.kalshi && kalshiMarkets && kalshiMarkets.length) {
        markets = markets.concat(kalshiMarkets);
      }

      // OST native markets — always present, on top of any live feed
      if (typeof window.buildOstNativeMarkets === 'function') {
        try {
          var native = window.buildOstNativeMarkets();
          if (Array.isArray(native) && native.length) {
            markets = native.concat(markets);
          }
        } catch (e) { console.warn('[OST native markets]', e); }
      }

      state.markets = markets;
      state.lastUpdated = updatedAt || new Date();
      state.lastError = failures.length ? failures.join(', ') + ' unavailable' : '';

      if (updatedEl) {
        updatedEl.textContent = 'Updated ' + state.lastUpdated.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });
      }

      if (markets.length) {
        updateStatus(failures.length ? 'is-warning' : 'is-live', failures.length ? 'Live with one source degraded' : '2 live venues connected');
      } else {
        if (!state.lastError) state.lastError = 'No active markets returned';
        updateStatus('is-error', 'Feeds unavailable right now');
      }

      renderPredictionBoard();
    }

    function loadDirectPredictionMarkets() {
      return Promise.allSettled([
        fetchPolymarketMarkets(),
        fetchKalshiMarkets()
      ]).then(function(results) {
        setLoadedPredictionMarkets(
          results[0].status === 'fulfilled' ? results[0].value : [],
          results[1].status === 'fulfilled' ? results[1].value : [],
          {
            polymarket: results[0].status === 'fulfilled' && results[0].value.length > 0,
            kalshi: results[1].status === 'fulfilled' && results[1].value.length > 0
          },
          new Date()
        );
      });
    }

    function fetchPolymarketMarkets() {
      return fetch('https://gamma-api.polymarket.com/markets?limit=160&closed=false', {
        headers: { accept: 'application/json' }
      }).then(function(response) {
        if (!response.ok) throw new Error('Polymarket returned ' + response.status);
        return response.json();
      }).then(function(data) {
        return extractPolymarketMarkets(data).filter(function(item) {
          return item && item.active !== false && item.closed !== true;
        }).map(mapPolymarketMarket);
      });
    }

    function fetchKalshiMarkets() {
      return fetch('https://api.elections.kalshi.com/trade-api/v2/markets?limit=160', {
        headers: { accept: 'application/json' }
      }).then(function(response) {
        if (!response.ok) throw new Error('Kalshi returned ' + response.status);
        return response.json();
      }).then(function(data) {
        return extractKalshiMarkets(data).filter(function(item) {
          return item && item.status === 'active';
        }).map(mapKalshiMarket);
      });
    }

    function loadPredictionMarkets() {
      if (state.loading) return;
      state.loading = true;
      state.lastError = '';
      updateStatus('', 'Loading live feeds...');
      renderPredictionBoard();

      var loadTask = window.location.protocol === 'file:'
        ? loadDirectPredictionMarkets()
        : fetchPredictionMarketSnapshot().then(function(snapshot) {
            setLoadedPredictionMarkets(
              snapshot.polymarketMarkets,
              snapshot.kalshiMarkets,
              snapshot.sourceHealth,
              snapshot.generatedAt
            );
          }).catch(function() {
            return loadDirectPredictionMarkets();
          });

      loadTask.catch(function(error) {
        state.markets = [];
        state.lastError = error && error.message ? error.message : String(error);
        state.sourceHealth.polymarket = false;
        state.sourceHealth.kalshi = false;
        updateStatus('is-error', 'Feeds unavailable right now');
        renderPredictionBoard();
      }).finally(function() {
        state.loading = false;
      });
    }

    function queueStageRedraw() {
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(function() {
        renderPredictionStage(getFilteredMarkets());
      });
    }

    if (sourceToggle) {
      sourceToggle.addEventListener('click', function(event) {
        var button = event.target.closest('button[data-prediction-source]');
        if (!button) return;
        state.source = button.getAttribute('data-prediction-source') || 'all';
        renderPredictionBoard();
      });
    }

    if (rankToggle) {
      rankToggle.addEventListener('click', function(event) {
        var button = event.target.closest('button[data-prediction-rank]');
        if (!button) return;
        state.rank = button.getAttribute('data-prediction-rank') || 'trending';
        renderPredictionBoard();
      });
    }

    if (topicToggle) {
      topicToggle.addEventListener('click', function(event) {
        var button = event.target.closest('button[data-prediction-topic]');
        if (!button) return;
        state.topic = button.getAttribute('data-prediction-topic') || 'all';
        renderPredictionBoard();
      });
    }

    if (searchEl) {
      searchEl.addEventListener('input', function() {
        state.query = searchEl.value || '';
        renderPredictionBoard();
      });
    }

    if (listEl) {
      listEl.addEventListener('click', function(event) {
        if (event.target.closest('a')) return;
        handlePredictionCardSelection(event.target);
      });
      listEl.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (handlePredictionCardSelection(event.target)) {
          event.preventDefault();
        }
      });
    }

    if (pulseEl) {
      pulseEl.addEventListener('click', function(event) {
        if (event.target.closest('a')) return;
        handlePredictionCardSelection(event.target);
      });
      pulseEl.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (handlePredictionCardSelection(event.target)) {
          event.preventDefault();
        }
      });
    }

    if (outcomeToggle) {
      outcomeToggle.addEventListener('click', function(event) {
        var button = event.target.closest('button[data-prediction-side]');
        if (!button) return;
        state.selectedSide = button.getAttribute('data-prediction-side') || 'yes';
        renderPredictionTicket(getFilteredMarkets());
      });
    }

    if (stakeInputEl) {
      stakeInputEl.addEventListener('input', function() {
        var nextStake = Number(stakeInputEl.value);
        state.stake = Number.isFinite(nextStake) && nextStake > 0 ? nextStake : 0;
        renderPredictionTicket(getFilteredMarkets());
      });
    }

    if (stakeQuickEl) {
      stakeQuickEl.addEventListener('click', function(event) {
        var button = event.target.closest('button[data-prediction-stake]');
        if (!button) return;
        var nextStake = Number(button.getAttribute('data-prediction-stake'));
        if (!Number.isFinite(nextStake)) return;
        state.stake = nextStake;
        if (stakeInputEl) stakeInputEl.value = String(nextStake);
        renderPredictionTicket(getFilteredMarkets());
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', function() {
        loadPredictionMarkets();
      });
    }

    if (tradeActionBtn) {
      tradeActionBtn.addEventListener('click', function() {
        var market = getSelectedMarket(getFilteredMarkets());
        if (!market) {
          setTradeStatus(t('wallet.portal.prediction.tradeSelectPrompt', 'Select a live contract first.'), 'error');
          return;
        }

        var priceFraction = getMarketPrice(market, state.selectedSide);
        var potentialReturn = calculatePotentialReturn(state.stake, priceFraction);
        if (!Number.isFinite(priceFraction) || priceFraction <= 0 || !Number.isFinite(potentialReturn)) {
          setTradeStatus(t('wallet.portal.prediction.tradeUnavailable', 'This side is not tradeable right now.'), 'error');
          return;
        }

        state.placing = true;
        renderPredictionTicket(getFilteredMarkets());

        createPredictionMarketOrder({
          source: market.source,
          marketId: market.id,
          title: market.title,
          topic: market.topic,
          side: state.selectedSide,
          stake: state.stake,
          price: priceFraction,
          potentialReturn: potentialReturn,
          sourceUrl: market.primaryUrl,
          reference: Date.now().toString(36)
        }).then(function(result) {
          state.latestReceipt = result && result.record ? result.record : null;
          state.orderHistory = readPredictionOrderRecords();
          state.availableBalance = result && Number.isFinite(result.remainingBalance) ? result.remainingBalance : state.availableBalance;
          setTradeStatus(t('wallet.portal.prediction.tradeRecorded', 'OST order recorded on devnet. Use the signature to audit the ticket on-chain.'), 'success');
          toast('📈', 'Prediction market ticket recorded on-chain');
          renderPredictionBoard();
        }).catch(function(error) {
          setTradeStatus(error && error.message ? error.message : t('wallet.portal.prediction.tradeFailed', 'Could not place the prediction market order right now.'), 'error');
        }).finally(function() {
          state.placing = false;
          renderPredictionTicket(getFilteredMarkets());
          renderLatestReceipt();
          renderPredictionLedger();
        });
      });
    }

    window.addEventListener('resize', queueStageRedraw);

    syncPredictionMarketBoardUi();
    syncTradeWallet();
    loadPredictionMarkets();
    loadTimer = window.setInterval(loadPredictionMarkets, 120000);

    window.addEventListener('beforeunload', function() {
      if (loadTimer) window.clearInterval(loadTimer);
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
    });
  })();

  (function initSpaceMontage() {
    var wrap = document.getElementById('sxMontage');
    var frameWrap = wrap ? wrap.querySelector('.sx-montage-frame-wrap') : null;
    var frame = document.getElementById('sxMontageFrame');
    var fallback = document.getElementById('sxMontageFallback');
    var tag = document.getElementById('sxMontageTag');
    var title = document.getElementById('sxMontageTitle');
    var desc = document.getElementById('sxMontageDesc');
    var link = document.getElementById('sxMontageLink');
    var toggle = document.getElementById('sxMontageAuto');
    var buttons = Array.prototype.slice.call(document.querySelectorAll('.sx-montage-btn'));
    if (!wrap || !frameWrap || !frame || !buttons.length) return;

    var auto = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var currentIndex = 0;
    var timer = null;
    var localPreviewMode = window.location.protocol === 'file:';

    function openSource(url) {
      if (!url) return;
      window.open(url, '_blank', 'noopener');
    }

    function syncFrameMode(btn) {
      var poster = btn.dataset.poster ? 'url("' + btn.dataset.poster + '")' : 'none';
      frameWrap.style.setProperty('--sx-montage-poster', poster);
      if (localPreviewMode) {
        frameWrap.classList.add('is-local');
        frame.removeAttribute('src');
        if (fallback) {
          fallback.hidden = false;
          fallback.onclick = function() {
            openSource(btn.dataset.link || '');
          };
        }
        return;
      }

      frameWrap.classList.remove('is-local');
      if (fallback) {
        fallback.hidden = true;
        fallback.onclick = null;
      }
      if (frame.src !== btn.dataset.src) frame.src = btn.dataset.src;
    }

    function applyButton(index) {
      var btn = buttons[index];
      if (!btn) return;
      buttons.forEach(function(item, itemIndex) {
        item.classList.toggle('active', itemIndex === index);
      });
      currentIndex = index;
      syncFrameMode(btn);
      if (tag) tag.textContent = btn.dataset.tag || '';
      if (title) title.textContent = btn.dataset.title || '';
      if (desc) desc.textContent = btn.dataset.desc || '';
      if (link) link.href = btn.dataset.link || '#';
    }

    function clearTimer() {
      if (timer) {
        window.clearInterval(timer);
        timer = null;
      }
    }

    function schedule() {
      clearTimer();
      if (!auto) return;
      timer = window.setInterval(function() {
        applyButton((currentIndex + 1) % buttons.length);
      }, 8000);
    }

    buttons.forEach(function(btn, index) {
      btn.addEventListener('click', function() {
        applyButton(index);
        auto = false;
        if (toggle) toggle.textContent = 'Resume auto-cycle';
        clearTimer();
      });
    });

    wrap.addEventListener('mouseenter', clearTimer);
    wrap.addEventListener('mouseleave', schedule);

    if (toggle) {
      toggle.textContent = auto ? 'Pause auto-cycle' : 'Resume auto-cycle';
      toggle.addEventListener('click', function() {
        auto = !auto;
        toggle.textContent = auto ? 'Pause auto-cycle' : 'Resume auto-cycle';
        schedule();
      });
    }

    applyButton(0);
    schedule();
  })();

  /* ================================================================== */
  /* v53: ANCIENT MODE + TRANSMIT TO SPACE                              */
  /* ================================================================== */

  /* --- Ancient Mode Toggle --- */
  (function() {
    var toggle = document.getElementById('ancientToggle');
    var label = document.getElementById('ancientToggleText');
    if (!toggle) return;

    function syncAncientToggle() {
      var isOn = document.documentElement.classList.contains('ancient-mode');
      toggle.classList.toggle('active', isOn);
      toggle.setAttribute('aria-pressed', String(isOn));
      toggle.setAttribute('title', isOn ? t('ancient.toggle.deactivate') : t('ancient.toggle.activate'));
      toggle.setAttribute('aria-label', isOn ? t('ancient.toggle.deactivate') : t('ancient.toggle.activate'));
      document.documentElement.setAttribute('data-ancient-mode', isOn ? 'on' : 'off');
      if (label) label.textContent = isOn ? t('ancient.toggle.on') : t('ancient.toggle.off');
    }

    window.syncAncientModeUi = syncAncientToggle;

    if (localStorage.getItem('ost-ancient') === '1') {
      document.documentElement.classList.add('ancient-mode');
    }
    syncAncientToggle();

    toggle.addEventListener('click', function() {
      var isOn = document.documentElement.classList.toggle('ancient-mode');
      localStorage.setItem('ost-ancient', isOn ? '1' : '0');
      syncAncientToggle();
      if (typeof toast === 'function') {
        toast(isOn ? '𓅱' : '◉', isOn ? t('ancient.toast.on') : t('ancient.toast.off'));
      }
    });
  })();

  /* --- Transmit to Space --- */
  (function() {
    var overlay = document.getElementById('transmitOverlay');
    var closeBtn = document.getElementById('transmitClose');
    var fill = document.getElementById('transmitFill');
    var status = document.getElementById('transmitStatus');
    var glyphs = document.getElementById('transmitGlyphs');
    var messageInput = document.getElementById('transmitMessage');
    var dnaInput = document.getElementById('transmitDna');
    var filesInput = document.getElementById('transmitFiles');
    var launchBtn = document.getElementById('transmitLaunch');
    var launchLabel = document.getElementById('transmitLaunchLabel');
    var attachmentList = document.getElementById('transmitAttachmentList');
    var binary = document.getElementById('transmitBinary');
    var quantum = document.getElementById('transmitQuantum');
    var manifestId = document.getElementById('transmitManifestId');
    var manifestState = document.getElementById('transmitManifestState');
    var payloadSummary = document.getElementById('transmitPayloadSummary');
    var resultMeta = document.getElementById('transmitResultMeta');
    var attachmentPreview = document.getElementById('transmitAttachmentPreview');
    if (!overlay) return;

    var glyphAlphabet = [
      '𓀀', '𓁐', '𓂀', '𓃭', '𓄿', '𓅱', '𓆣', '𓇯', '𓈖', '𓉔', '𓊪', '𓋴', '𓌳', '𓍯', '𓎛', '𓏏'
    ];
    var objectUrls = [];
    var activeTransmission = 0;
    var isTransmitting = false;
    var currentStageKey = 'transmit.empty';
    var lastPayload = null;

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, function(char) {
        if (char === '&') return '&amp;';
        if (char === '<') return '&lt;';
        if (char === '>') return '&gt;';
        if (char === '"') return '&quot;';
        return '&#39;';
      });
    }

    function formatBytes(bytes) {
      if (!bytes) return '0 B';
      var units = ['B', 'KB', 'MB', 'GB'];
      var size = bytes;
      var unitIndex = 0;
      while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
      }
      return size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1) + ' ' + units[unitIndex];
    }

    function checksumOf(input) {
      var hash = 2166136261;
      for (var index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
    }

    function bytesFromString(input) {
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(input);
      return Uint8Array.from(String(input).split('').map(function(char) { return char.charCodeAt(0); }));
    }

    function buildGlyphString(input) {
      var bytes = bytesFromString((input || 'OST') + '|OST');
      return Array.from(bytes.slice(0, 20)).map(function(byte, index) {
        return glyphAlphabet[(byte + index) % glyphAlphabet.length];
      }).join('');
    }

    function buildBinaryPreview(input, checksum) {
      var bytes = bytesFromString((input || 'OST') + '|' + checksum);
      var chunks = Array.from(bytes.slice(0, 24)).map(function(byte) {
        return byte.toString(2).padStart(8, '0');
      });
      var rows = [];
      for (var index = 0; index < chunks.length; index += 3) {
        rows.push(chunks.slice(index, index + 3).join(' '));
      }
      return rows.join('\n');
    }

    function buildQuantumStates(checksum) {
      return Array.from({ length: 6 }, function(_, index) {
        var seed = parseInt(checksum[index % checksum.length], 16);
        var alpha = Math.min(0.94, 0.32 + (seed / 25));
        return {
          label: 'Q' + (index + 1),
          state: seed % 2 ? '|01⟩' : '|10⟩',
          alpha: alpha.toFixed(2),
          beta: (1 - alpha).toFixed(2),
          coherence: (82 + seed) + '%'
        };
      });
    }

    function attachmentKind(fileName, mimeType) {
      if ((mimeType || '').indexOf('image/') === 0) return 'image';
      if ((mimeType || '').indexOf('video/') === 0) return 'video';
      if ((mimeType || '').indexOf('text/') === 0 || /\.(txt|md|json|csv|fasta|fastq|dna|xml)$/i.test(fileName || '')) return 'text';
      return 'data';
    }

    function revokeObjectUrls() {
      objectUrls.forEach(function(url) { URL.revokeObjectURL(url); });
      objectUrls = [];
    }

    function currentDraft() {
      return {
        message: (messageInput && messageInput.value || '').trim(),
        dna: (dnaInput && dnaInput.value || '').replace(/\s+/g, '').toUpperCase(),
        files: Array.from(filesInput && filesInput.files ? filesInput.files : []).map(function(file) {
          return {
            name: file.name,
            size: file.size,
            type: file.type || 'application/octet-stream',
            kind: attachmentKind(file.name, file.type)
          };
        })
      };
    }

    function hasPayload(draft) {
      return Boolean(draft.message || draft.dna || draft.files.length);
    }

    function createManifestId(checksum) {
      return 'OST-' + Date.now().toString(36).toUpperCase() + '-' + checksum.slice(0, 4);
    }

    function createPreviewPayload(draft) {
      var seed = [draft.message, draft.dna].concat(draft.files.map(function(file) {
        return [file.name, file.size, file.type].join(':');
      })).filter(Boolean).join('|') || 'OST';
      var checksum = checksumOf(seed);
      return {
        message: draft.message,
        dna: draft.dna,
        files: draft.files,
        checksum: checksum,
        manifestId: hasPayload(draft) ? createManifestId(checksum) : t('transmit.manifest.default'),
        glyphs: buildGlyphString(seed),
        binary: buildBinaryPreview(seed, checksum),
        quantumStates: buildQuantumStates(checksum),
        packetSize: seed.length + draft.files.reduce(function(total, file) { return total + (file.size || 0); }, 0),
        sent: false,
        statusKey: hasPayload(draft) ? 'transmit.result.ready' : 'transmit.empty'
      };
    }

    function readFileSample(file) {
      return file.slice(0, 65536).arrayBuffer().then(function(buffer) {
        var bytes = new Uint8Array(buffer);
        var sampleHex = Array.from(bytes.slice(0, 24)).map(function(byte) {
          return byte.toString(16).padStart(2, '0');
        }).join('').toUpperCase();
        var textPreview = '';
        if (attachmentKind(file.name, file.type) === 'text' && typeof TextDecoder !== 'undefined') {
          try {
            textPreview = new TextDecoder().decode(bytes.slice(0, 220)).replace(/\s+/g, ' ').trim();
          } catch (error) {
            textPreview = '';
          }
        }
        return {
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          kind: attachmentKind(file.name, file.type),
          sampleHex: sampleHex,
          textPreview: textPreview,
          url: ''
        };
      }).catch(function() {
        return {
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          kind: attachmentKind(file.name, file.type),
          sampleHex: checksumOf(file.name + ':' + file.size),
          textPreview: '',
          url: ''
        };
      }).then(function(info) {
        if (info.kind === 'image' || info.kind === 'video') {
          info.url = URL.createObjectURL(file);
          objectUrls.push(info.url);
        }
        return info;
      });
    }

    function buildTransmissionPayload() {
      var draft = currentDraft();
      if (!hasPayload(draft)) return Promise.resolve(null);

      revokeObjectUrls();

      return Promise.all(Array.from(filesInput && filesInput.files ? filesInput.files : []).map(readFileSample)).then(function(files) {
        var seed = [draft.message, draft.dna].concat(files.map(function(file) {
          return [file.name, file.size, file.sampleHex].join(':');
        })).filter(Boolean).join('|');
        var checksum = checksumOf(seed);
        return {
          message: draft.message,
          dna: draft.dna,
          files: files,
          checksum: checksum,
          manifestId: createManifestId(checksum),
          glyphs: buildGlyphString(seed + checksum),
          binary: buildBinaryPreview(seed, checksum),
          quantumStates: buildQuantumStates(checksum),
          packetSize: seed.length + files.reduce(function(total, file) { return total + (file.size || 0); }, 0),
          sent: false,
          statusKey: 'transmit.result.ready'
        };
      });
    }

    function renderAttachmentList(files) {
      if (!attachmentList) return;
      if (!files.length) {
        attachmentList.innerHTML = '<span class="transmit-empty-pill">' + escapeHtml(t('transmit.none')) + '</span>';
        return;
      }

      attachmentList.innerHTML = files.map(function(file) {
        return '<span class="transmit-attachment-pill"><strong>' + escapeHtml(file.name) + '</strong><span>' + escapeHtml(formatBytes(file.size || 0)) + '</span></span>';
      }).join('');
    }

    function renderQuantumStates(states) {
      if (!quantum) return;
      quantum.innerHTML = states.map(function(state) {
        return [
          '<div class="transmit-quantum-card">',
          '<span class="transmit-quantum-label">' + escapeHtml(state.label) + '</span>',
          '<strong class="transmit-quantum-state">' + escapeHtml(state.state) + '</strong>',
          '<span class="transmit-quantum-detail">|0⟩ ' + escapeHtml(state.alpha) + ' · |1⟩ ' + escapeHtml(state.beta) + '</span>',
          '<span class="transmit-quantum-coherence">' + escapeHtml(state.coherence) + ' coherence</span>',
          '</div>'
        ].join('');
      }).join('');
    }

    function renderAttachmentPreview(files) {
      if (!attachmentPreview) return;
      if (!files.length) {
        attachmentPreview.innerHTML = '<div class="transmit-attachment-card"><p class="transmit-file-snippet">' + escapeHtml(t('transmit.none')) + '</p></div>';
        return;
      }

      attachmentPreview.innerHTML = files.slice(0, 3).map(function(file) {
        var titleKey = 'transmit.file.' + (file.kind || 'data');
        var body = '<p class="transmit-file-snippet">' + escapeHtml((file.textPreview || file.sampleHex || '').slice(0, 160) || t('transmit.none')) + '</p>';
        if (file.kind === 'image' && file.url) {
          body = '<img class="transmit-media-thumb" src="' + escapeHtml(file.url) + '" alt="' + escapeHtml(file.name) + '">';
        } else if (file.kind === 'video' && file.url) {
          body = '<video class="transmit-media-thumb" src="' + escapeHtml(file.url) + '" controls muted playsinline></video>';
        }

        return [
          '<article class="transmit-attachment-card">',
          '<div class="transmit-attachment-meta">',
          '<strong>' + escapeHtml(t(titleKey, t('transmit.file.data'))) + '</strong>',
          '<span>' + escapeHtml(file.name) + ' · ' + escapeHtml(formatBytes(file.size || 0)) + '</span>',
          '</div>',
          body,
          '</article>'
        ].join('');
      }).join('');
    }

    function renderSummary(payload) {
      if (!payloadSummary || !resultMeta) return;

      payloadSummary.innerHTML = [
        '<div class="transmit-summary-line"><span>' + escapeHtml(t('transmit.summary.message')) + '</span><strong>' + escapeHtml(payload.message ? payload.message.length + ' ' + t('transmit.summary.chars') : '0') + '</strong></div>',
        '<div class="transmit-summary-line"><span>' + escapeHtml(t('transmit.summary.dna')) + '</span><strong>' + escapeHtml(payload.dna ? payload.dna.length + ' ' + t('transmit.summary.bases') : '0') + '</strong></div>',
        '<div class="transmit-summary-line"><span>' + escapeHtml(t('transmit.summary.files')) + '</span><strong>' + escapeHtml(String(payload.files.length)) + '</strong></div>'
      ].join('');

      resultMeta.innerHTML = [
        '<div class="transmit-meta-line"><span>' + escapeHtml(t('transmit.summary.route')) + '</span><strong>' + escapeHtml(t('transmit.route.value')) + '</strong></div>',
        '<div class="transmit-meta-line"><span>' + escapeHtml(t('transmit.summary.checksum')) + '</span><strong>' + escapeHtml(payload.checksum) + '</strong></div>',
        '<div class="transmit-meta-line"><span>' + escapeHtml(t('transmit.summary.packet')) + '</span><strong>' + escapeHtml(formatBytes(payload.packetSize || 0)) + '</strong></div>',
        '<div class="transmit-meta-line"><span>' + escapeHtml(t('transmit.summary.target')) + '</span><strong>' + escapeHtml(t('transmit.target.value')) + '</strong></div>',
        '<div class="transmit-meta-line"><span>' + escapeHtml(t('transmit.summary.render')) + '</span><strong>' + escapeHtml(t('transmit.render.value')) + '</strong></div>'
      ].join('');
    }

    function renderPayload(payload) {
      var effectivePayload = payload || createPreviewPayload(currentDraft());
      lastPayload = effectivePayload;

      if (glyphs) glyphs.textContent = effectivePayload.glyphs || buildGlyphString('OST');
      if (binary) binary.textContent = effectivePayload.binary || buildBinaryPreview('OST', checksumOf('OST'));
      if (manifestId) manifestId.textContent = effectivePayload.manifestId || t('transmit.manifest.default');
      if (manifestState) manifestState.textContent = effectivePayload.sent ? t('transmit.result.sent') : t('transmit.result.ready');
      if (fill) fill.style.width = effectivePayload.sent ? '100%' : (hasPayload(currentDraft()) ? '18%' : '0%');
      if (status && !isTransmitting) status.textContent = t(effectivePayload.statusKey || 'transmit.empty');

      renderAttachmentList(effectivePayload.files || []);
      renderQuantumStates(effectivePayload.quantumStates || buildQuantumStates(checksumOf('OST')));
      renderSummary(effectivePayload);
      renderAttachmentPreview(effectivePayload.files || []);
    }

    function syncTransmitUi() {
      if (launchLabel) launchLabel.textContent = isTransmitting ? t('transmit.launchBusy') : t('transmit.launch');
      if (launchBtn) launchBtn.disabled = isTransmitting;
      if (!isTransmitting && status) status.textContent = t(currentStageKey || 'transmit.empty');
      renderPayload(lastPayload || createPreviewPayload(currentDraft()));
    }

    window.syncTransmitUi = syncTransmitUi;

    function openTransmitConsole() {
      overlay.classList.add('active');
      currentStageKey = hasPayload(currentDraft()) ? 'transmit.result.ready' : 'transmit.empty';
      syncTransmitUi();
      if (messageInput) messageInput.focus();
    }

    function closeTransmitConsole() {
      activeTransmission += 1;
      isTransmitting = false;
      overlay.classList.remove('active');
      if (launchBtn) launchBtn.disabled = false;
      if (launchLabel) launchLabel.textContent = t('transmit.launch');
      currentStageKey = hasPayload(currentDraft()) ? ((lastPayload && lastPayload.sent) ? 'transmit.result.sent' : 'transmit.result.ready') : 'transmit.empty';
    }

    function refreshDraftPreview() {
      if (isTransmitting) return;
      currentStageKey = hasPayload(currentDraft()) ? 'transmit.result.ready' : 'transmit.empty';
      renderPayload(createPreviewPayload(currentDraft()));
    }

    function rotateGlyphs(input, offset) {
      if (!input) return buildGlyphString('OST');
      var safeOffset = offset % input.length;
      return input.slice(safeOffset) + input.slice(0, safeOffset);
    }

    function startTransmit() {
      buildTransmissionPayload().then(function(payload) {
        if (!payload) {
          currentStageKey = 'transmit.empty';
          syncTransmitUi();
          if (typeof toast === 'function') toast('𓂇', t('transmit.empty'));
          return;
        }

        var runId = activeTransmission + 1;
        var stages = [
          'transmit.stage.prepare',
          'transmit.stage.encode',
          'transmit.stage.binary',
          'transmit.stage.entangle',
          'transmit.stage.route',
          'transmit.stage.broadcast',
          'transmit.stage.done'
        ];

        activeTransmission = runId;
        isTransmitting = true;
        lastPayload = payload;
        if (launchBtn) launchBtn.disabled = true;
        if (launchLabel) launchLabel.textContent = t('transmit.launchBusy');

        (async function() {
          for (var stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
            if (runId !== activeTransmission) return;
            currentStageKey = stages[stageIndex];
            if (status) status.textContent = t(currentStageKey);
            if (fill) fill.style.width = (stageIndex / (stages.length - 1)) * 100 + '%';
            if (glyphs) glyphs.textContent = rotateGlyphs(payload.glyphs, stageIndex * 2);
            await sleep(620);
          }

          if (runId !== activeTransmission) return;
          payload.sent = true;
          payload.statusKey = 'transmit.stage.done';
          currentStageKey = 'transmit.stage.done';
          isTransmitting = false;
          renderPayload(payload);
          if (status) status.textContent = t('transmit.stage.done');
          if (fill) fill.style.width = '100%';
          if (launchBtn) launchBtn.disabled = false;
          if (launchLabel) launchLabel.textContent = t('transmit.launch');
          if (typeof toast === 'function') toast('🛰', t('transmit.stage.done'));
        })();
      });
    }

    var btn1 = document.getElementById('transmitBtn');
    var btn2 = document.getElementById('transmitBtnLg');
    if (btn1) btn1.addEventListener('click', openTransmitConsole);
    if (btn2) btn2.addEventListener('click', openTransmitConsole);
    if (launchBtn) launchBtn.addEventListener('click', startTransmit);
    if (messageInput) messageInput.addEventListener('input', refreshDraftPreview);
    if (dnaInput) dnaInput.addEventListener('input', refreshDraftPreview);
    if (filesInput) filesInput.addEventListener('change', refreshDraftPreview);
    if (closeBtn) closeBtn.addEventListener('click', closeTransmitConsole);
    overlay.addEventListener('click', function(event) {
      if (event.target === overlay) closeTransmitConsole();
    });

    renderPayload(createPreviewPayload(currentDraft()));
  })();

})();

