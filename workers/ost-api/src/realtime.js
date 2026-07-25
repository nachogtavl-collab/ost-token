/* workers/ost-api/src/realtime.js
   Durable Object-backed realtime event hub for OST clients.
   WebSocket clients subscribe to public channels plus their wallet channel;
   API routes and browser fallbacks publish typed events into the hub.
*/

const HUB_NAME = 'ost-realtime-hub-v1';
const MAX_RECENT_EVENTS = 220;
const MAX_CLIENTS = 1200;
const MAX_CHANNELS = 64;
const MAX_PAYLOAD_BYTES = 48_000;
const MAX_TEXT = 500;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-OST-Realtime-Key',
  'Access-Control-Max-Age': '86400'
};

function cors(extra = {}) {
  return { ...CORS_HEADERS, ...extra };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors({ 'Content-Type': 'application/json; charset=utf-8', ...extra })
  });
}

function text(value, max = MAX_TEXT) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function number(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function channel(value) {
  const clean = text(value, 140).toLowerCase().replace(/[^a-z0-9:_./-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return clean || '';
}

function walletChannel(wallet) {
  const clean = text(wallet, 80);
  return clean ? 'wallet:' + clean : '';
}

function eventId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function payloadForStorage(payload) {
  if (!payload || typeof payload !== 'object') return payload == null ? null : payload;
  try {
    const raw = JSON.stringify(payload);
    if (raw.length <= MAX_PAYLOAD_BYTES) return payload;
    return { truncated: true, bytes: raw.length, preview: raw.slice(0, 2400) };
  } catch (_) {
    return { unavailable: true };
  }
}

function mergeChannels(input) {
  const out = new Set();
  if (Array.isArray(input)) {
    input.forEach((item) => {
      const clean = channel(item);
      if (clean) out.add(clean);
    });
  } else if (typeof input === 'string') {
    input.split(',').forEach((item) => {
      const clean = channel(item);
      if (clean) out.add(clean);
    });
  }
  return Array.from(out).slice(0, MAX_CHANNELS);
}

function inferChannels(event) {
  const explicit = mergeChannels(event.channels || event.channel);
  const out = new Set(explicit);
  const type = channel(event.type || 'event');
  const wallet = text(event.wallet || '', 80);
  const marketId = text(event.marketId || '', 160);
  const gameId = text(event.gameId || event.game || '', 120);
  const mint = text(event.mint || '', 120);
  const symbol = text(event.symbol || '', 48).toUpperCase();
  const isPublic = event.public === true || event.broadcast === true || (!wallet && event.private !== true);

  if (isPublic) out.add('all');
  if (type && isPublic) out.add(type.split('.')[0]);
  if (wallet) out.add(walletChannel(wallet));
  if (marketId) {
    out.add('market:' + channel(marketId));
    if (isPublic) out.add('prediction');
  }
  if (gameId) out.add('game:' + channel(gameId));
  if (mint) out.add('launchpad:' + channel(mint));
  if (symbol) out.add('stock:' + channel(symbol));
  if (!out.size) out.add('all');
  return Array.from(out).filter(Boolean).slice(0, MAX_CHANNELS);
}

function normalizeEvent(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const type = channel(raw.type || raw.kind || 'event');
  const wallet = text(raw.wallet || '', 80);
  const marketId = text(raw.marketId || '', 160);
  const gameId = text(raw.gameId || raw.game || '', 120);
  const event = {
    id: text(raw.id || raw.eventId || eventId(), 140),
    type,
    channel: channel(raw.channel || type),
    channels: [],
    wallet,
    walletShort: raw.walletShort || (wallet ? wallet.slice(0, 4) + '...' + wallet.slice(-4) : ''),
    marketId,
    gameId,
    mint: text(raw.mint || '', 120),
    symbol: text(raw.symbol || '', 48).toUpperCase(),
    amount: number(raw.amount, null),
    token: text(raw.token || 'OST', 32),
    title: text(raw.title || raw.label || '', 180),
    message: text(raw.message || raw.body || '', 260),
    severity: channel(raw.severity || raw.level || 'info'),
    silent: !!raw.silent,
    public: raw.public === true || raw.broadcast === true,
    private: raw.private === true,
    payload: payloadForStorage(raw.payload || raw.data || null),
    ts: number(raw.ts || raw.createdAt, Date.now()) || Date.now(),
    iso: new Date(number(raw.ts || raw.createdAt, Date.now()) || Date.now()).toISOString()
  };
  event.channels = inferChannels(Object.assign({}, raw, event, {
    channel: raw.channel || event.channel,
    channels: raw.channels || raw.channel || event.channels
  }));
  if (!event.channel && event.channels.length) event.channel = event.channels[0];
  return event;
}

function eventMatchesChannel(event, wanted) {
  if (!wanted) return true;
  const clean = channel(wanted);
  if (!clean) return true;
  return (event.channels || []).indexOf(clean) >= 0;
}

function publishAuthorized(request, env) {
  const token = text(env && env.REALTIME_PUBLISH_TOKEN || '', 500);
  if (!token) return true;
  const header = request.headers.get('x-ost-realtime-key') || '';
  const auth = request.headers.get('authorization') || '';
  return header === token || auth === 'Bearer ' + token;
}

function realtimeHub(env) {
  if (!env || !env.REALTIME_HUB) return null;
  try {
    return env.REALTIME_HUB.get(env.REALTIME_HUB.idFromName(HUB_NAME));
  } catch (_) {
    return null;
  }
}

// Event types the PUBLIC (unauthenticated) publish endpoint may emit. These are
// social/cosmetic and drive no money action on the receiver. Everything else -
// wallet.*, transaction.*, topup.*, payout.*, faucet.* - is PRIVILEGED: the
// receiver dispatches those to ost:wallet-changed / transaction alerts, so a
// spoofed one fakes a payment. Privileged events may ONLY originate server-side
// (publishRealtimeEvent calls the hub directly and never passes through here).
const PUBLIC_PUBLISH_TYPES = new Set(['game.result', 'presence', 'presence.update', 'mesh.presence']);

export async function handleRealtimeRequest(request, env, { path, method }) {
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  const hub = realtimeHub(env);
  if (!hub) return json({ ok: false, error: 'realtime_hub_not_configured' }, 503);

  if (path === '/realtime/v1/publish' && method === 'POST') {
    const authed = publishAuthorized(request, env);
    if (!authed) {
      // Read the body to classify the event; forward the SAME bytes onward.
      const raw = await request.text();
      let type = '';
      try { const b = JSON.parse(raw); type = String((b.event && b.event.type) || b.type || ''); } catch (_) {}
      if (!PUBLIC_PUBLISH_TYPES.has(type)) {
        return json({ ok: false, error: 'unauthorized',
          note: 'This event type is server-authoritative; the public endpoint only accepts social events.' }, 401);
      }
      return hub.fetch(new Request(request.url, { method: 'POST', headers: request.headers, body: raw }));
    }
  }
  return hub.fetch(request);
}

export async function publishRealtimeEvent(env, event) {
  const hub = realtimeHub(env);
  if (!hub || !event) return false;
  try {
    const response = await hub.fetch('https://ost-realtime-hub.local/realtime/v1/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event })
    });
    return !!(response && response.ok);
  } catch (_) {
    return false;
  }
}

export class RealtimeHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = new Map();
    this.recent = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

    if ((path === '/realtime/v1/health' || path === '/health') && method === 'GET') {
      await this.ensureRecent();
      return json({
        ok: true,
        realtime: 'v1',
        hub: 'durable-object',
        clients: this.clients.size,
        recent: this.recent.length,
        ts: new Date().toISOString()
      }, 200, { 'cache-control': 'no-store' });
    }

    if ((path === '/realtime/v1/ws' || path === '/ws') && method === 'GET') {
      return this.handleWebSocket(request, url);
    }

    if ((path === '/realtime/v1/publish' || path === '/publish') && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const event = await this.publish(body.event || body);
      return json({ ok: true, event, clients: this.clients.size }, 200, { 'cache-control': 'no-store' });
    }

    if ((path === '/realtime/v1/events' || path === '/events') && method === 'GET') {
      await this.ensureRecent();
      const since = number(url.searchParams.get('since'), 0) || 0;
      const wantedChannel = url.searchParams.get('channel') || '';
      const limit = Math.min(200, Math.max(1, number(url.searchParams.get('limit'), 80) || 80));
      const events = this.recent
        .filter((event) => (!since || Number(event.ts || 0) > since) && eventMatchesChannel(event, wantedChannel))
        .slice(0, limit);
      return json({ ok: true, events, count: events.length, ts: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
    }

    if ((path === '/realtime/v1/ping' || path === '/ping') && method === 'GET') {
      return json({ ok: true, pong: Date.now() }, 200, { 'cache-control': 'no-store' });
    }

    return json({ ok: false, error: 'realtime_route_not_found', path }, 404);
  }

  handleWebSocket(request, url) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return json({ ok: false, error: 'websocket_upgrade_required' }, 426);
    }
    if (this.clients.size >= MAX_CLIENTS) {
      return json({ ok: false, error: 'realtime_hub_full' }, 503);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const id = eventId();
    const wallet = text(url.searchParams.get('wallet') || '', 80);
    const channels = new Set(mergeChannels(url.searchParams.get('channels') || 'all,price,price:btc,prediction,orderbook,faucet,game,launchpad,stock,topup'));
    if (wallet) channels.add(walletChannel(wallet));
    const session = { id, socket: server, wallet, channels, connectedAt: Date.now(), lastSeen: Date.now() };
    this.clients.set(id, session);

    server.accept();
    this.send(session, {
      type: 'realtime.ready',
      id,
      channels: Array.from(channels),
      clients: this.clients.size,
      ts: Date.now()
    });

    server.addEventListener('message', (message) => this.onClientMessage(session, message.data));
    server.addEventListener('close', () => this.clients.delete(id));
    server.addEventListener('error', () => this.clients.delete(id));

    return new Response(null, { status: 101, webSocket: client });
  }

  async ensureRecent() {
    if (this.recent) return this.recent;
    const stored = await this.state.storage.get('recent-events').catch(() => null);
    this.recent = Array.isArray(stored) ? stored.slice(0, MAX_RECENT_EVENTS) : [];
    return this.recent;
  }

  async saveRecent() {
    await this.state.storage.put('recent-events', this.recent.slice(0, MAX_RECENT_EVENTS)).catch(() => {});
  }

  async publish(raw) {
    await this.ensureRecent();
    const event = normalizeEvent(raw);
    this.recent = [event].concat(this.recent.filter((item) => item && item.id !== event.id)).slice(0, MAX_RECENT_EVENTS);
    this.saveRecent();
    this.broadcast({ type: 'event', event });
    return event;
  }

  onClientMessage(session, raw) {
    session.lastSeen = Date.now();
    let msg = null;
    try { msg = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { msg = null; }
    if (!msg || typeof msg !== 'object') return this.send(session, { type: 'error', error: 'invalid_message' });

    if (msg.type === 'ping') {
      return this.send(session, { type: 'pong', ts: Date.now() });
    }
    if (msg.type === 'hello' || msg.type === 'subscribe') {
      const next = mergeChannels(msg.channels || msg.channel);
      if (msg.type === 'hello') session.channels = new Set();
      next.forEach((item) => session.channels.add(item));
      const wallet = text(msg.wallet || '', 80);
      if (wallet) {
        session.wallet = wallet;
        session.channels.add(walletChannel(wallet));
      }
      if (!session.channels.size) session.channels.add('all');
      while (session.channels.size > MAX_CHANNELS) session.channels.delete(Array.from(session.channels).pop());
      return this.send(session, { type: 'subscribed', channels: Array.from(session.channels), ts: Date.now() });
    }
    if (msg.type === 'unsubscribe') {
      mergeChannels(msg.channels || msg.channel).forEach((item) => session.channels.delete(item));
      return this.send(session, { type: 'subscribed', channels: Array.from(session.channels), ts: Date.now() });
    }
    if (msg.type === 'publish' && msg.event) {
      return this.publish(Object.assign({}, msg.event, { clientId: session.id })).then((event) => this.send(session, { type: 'published', id: event.id }));
    }
  }

  send(session, payload) {
    try {
      session.socket.send(JSON.stringify(payload));
      return true;
    } catch (_) {
      this.clients.delete(session.id);
      return false;
    }
  }

  broadcast(payload) {
    const event = payload && payload.event;
    const eventChannels = new Set((event && event.channels) || ['all']);
    for (const session of this.clients.values()) {
      const channels = session.channels || new Set(['all']);
      let match = false;
      for (const item of eventChannels) {
        if (channels.has(item)) { match = true; break; }
      }
      if (match) this.send(session, payload);
    }
  }
}