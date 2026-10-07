/* ==========================================================================
 * OST · Money errors — ONE place that turns a failure into plain English
 * --------------------------------------------------------------------------
 * Contract C3 (money-plan §6). Every money surface (send, convert, bridge,
 * swap, faucet, markets, Mesh pay) hands its error or response body here and
 * shows what comes back. Nothing else decides the wording.
 *
 *   OST_MONEY_ERRORS.humanize(errOrBody, opts?) ->
 *     { state: 'refused'|'pending'|'failed', title, body, action?, retryable,
 *       code, sig? }
 *
 *   state   refused  the request was turned down before anything moved
 *           pending  it may have been sent; the outcome is not known yet
 *                    ("Still confirming — check your balance before retrying")
 *           failed   it did not go through
 *   opts    { stage: 'build'|'submit', asset: 'OST'|'OSTG'|'SOL' }
 *           stage 'submit' means the transaction may already be on chain, so
 *           a lost answer is reported as pending, never as failed.
 *
 * Raw JSON, Durable Object / platform strings, program logs and the bare words
 * "error" / "daily-cooldown" are never returned. Unknown codes get a neutral,
 * honest sentence instead of the server's text.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_MONEY_ERRORS) return;

  var RENT_MIN_SOL = 0.00089088;

  function str(v) { return v == null ? '' : String(v); }
  function shortSig(sig) { sig = str(sig); return sig.length > 12 ? sig.slice(0, 4) + '…' + sig.slice(-4) : sig; }
  function fmtNum(n, dp) {
    var v = Number(n);
    if (!Number.isFinite(v)) return '';
    return v.toLocaleString(undefined, { maximumFractionDigits: dp == null ? 4 : dp });
  }
  function fmtWait(ms) {
    var s = Math.ceil(Number(ms) / 1000);
    if (!Number.isFinite(s) || s <= 0) return 'a moment';
    if (s < 60) return s + ' s';
    var m = Math.ceil(s / 60);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), mm = m % 60;
    return h + 'h ' + (mm < 10 ? '0' : '') + mm + 'm';
  }
  function untilText(at) {
    var t = typeof at === 'number' ? at : Date.parse(at);
    if (!Number.isFinite(t)) return '';
    return fmtWait(t - Date.now());
  }

  // Text that must never reach a person: JSON, program logs, platform strings.
  function isRaw(text) {
    var t = str(text).trim();
    if (!t) return true;
    if (t.length > 240) return true;
    if (/^(error|failed|undefined|null|internal_error|daily-cooldown)\.?$/i.test(t)) return true;
    if (/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/.test(t)) return true;          // a bare code like rate_limited
    if (/[{}\[\]]/.test(t)) return true;                                 // JSON fragments
    if (/durable object|InstructionError|Custom"?\s*:|simulation|program log|Program [1-9A-HJ-NP-Za-km-z]{32,}|0x[0-9a-f]{2,}|TypeError|ReferenceError|SyntaxError|at [A-Za-z_$][\w$]*\s*\(|Failed to fetch|NetworkError|Load failed|AbortError|status code|HTTP \d{3}|error code:|exceeded CPU|Worker threw|cloudflare|Too Many Requests|On-chain failure|\(\d{3}\)/i.test(t)) return true;
    return false;
  }

  function lowerText(errOrBody) {
    var parts = [];
    try {
      if (typeof errOrBody === 'string') parts.push(errOrBody);
      if (errOrBody && typeof errOrBody === 'object') {
        // Our own wording (human) is not evidence of anything: decode the server's text.
        parts.push(str(errOrBody.human ? errOrBody.serverMessage : errOrBody.message), str(errOrBody.error), str(errOrBody.code), str(errOrBody.reason));
        if (errOrBody.rawMessage) parts.push(str(errOrBody.rawMessage));
        if (errOrBody.body && typeof errOrBody.body === 'object') parts.push(str(errOrBody.body.message), str(errOrBody.body.error), str(errOrBody.body.reason));
        if (Array.isArray(errOrBody.logs)) parts.push(errOrBody.logs.join(' '));
        if (errOrBody.cause) parts.push(str(errOrBody.cause && errOrBody.cause.message));
      }
    } catch (_) {}
    return parts.join(' | ');
  }

  // A code is one token ("rate_limited", "Custom-1"); an old worker sometimes
  // put a whole sentence in `error`, which is text to decode, not a code.
  function codeLike(v) { return typeof v === 'string' && /^[a-z0-9][a-z0-9_.:-]{0,63}$/i.test(v.trim()) ? v.trim() : ''; }

  // Pull every useful field out of an Error, a parsed body, or a string.
  function extract(errOrBody) {
    var o = errOrBody;
    var body = (o && typeof o === 'object' && o.body && typeof o.body === 'object') ? o.body : (o && typeof o === 'object' ? o : {});
    var code = '';
    if (typeof o === 'string' && /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$/i.test(o.trim())) code = o.trim();
    if (o && typeof o === 'object') {
      if (typeof o.code === 'number') code = o.code === 4001 ? 'user_rejected' : String(o.code);
      else code = codeLike(o.code);
      if (!code) code = codeLike(body.error);
      if (!code) code = codeLike(body.code);
      if (!code) code = codeLike(o.error);
    }
    var sig = (o && o.sig) || body.sig || body.signature || (o && o.signature) || null;
    if (sig && typeof sig !== 'string') sig = null;
    // An error this file already worded (devnet-rescue / bridge / swap set
    // `human`) carries our own "Title — body" as its message: re-using it would
    // print the title twice. Use the server's own sentence instead.
    var human = !!(o && typeof o === 'object' && o.human);
    var ownBody = (o && typeof o === 'object' && o.body && typeof o.body === 'object') ? o.body : null;
    // For our own worded errors `body` may be the error itself: never read
    // our own wording back as the server's.
    var serverText = human
      ? str(o.serverMessage || (ownBody && (ownBody.message || ownBody.note)) || '')
      : str((o && o.message) || body.message || body.note || '');
    var msg = serverText;
    return {
      code: str(code).toLowerCase().replace(/-/g, '_'),
      status: Number((o && o.status) || body.status || 0) || 0,
      reason: str(body.reason || (o && o.reason)).toLowerCase(),
      message: msg,
      text: lowerText(o),
      sig: sig,
      body: body,
      // The failing step, when the error knows it: 'build' (nothing was signed
      // or sent) or 'submit' (it may be on chain). Beats the caller's guess.
      stage: (o && typeof o === 'object' && (o.stage === 'build' || o.stage === 'submit')) ? o.stage : '',
      asset: str((o && typeof o === 'object' && o.asset) || body.asset || '').toUpperCase(),
      // The server said in words that nothing went out.
      nothingSent: /nothing was (?:signed or )?sent|nothing was paid|nothing moved|before sending/i.test(serverText + ' ' + str(ownBody ? (ownBody.message || ownBody.note || '') : '')),
      pending: !!((o && o.pending) || body.pending)
    };
  }

  // Map the raw on-chain / RPC wording to a worker code (SRV-6 decoding).
  function codeFromText(text) {
    var t = str(text);
    if (/insufficientfundsforrent|insufficient funds for rent/i.test(t)) return 'below_rent_minimum';
    if (/no record of a prior credit/i.test(t)) return 'no_sol';
    if (/insufficient lamports/i.test(t)) return 'no_sol';
    // Custom 1 is ambiguous: Token "insufficient funds" OR System "not enough
    // lamports" (e.g. a sender paying a recipient's account rent). Say only
    // what is certain.
    if (/"?custom"?\s*:\s*1\b|custom program error:\s*0x1\b/i.test(t)) return 'insufficient_funds';
    if (/insufficient funds/i.test(t)) return 'insufficient_balance';
    if (/incorrectprogramid|invalidaccountdata|could not find account|account not found/i.test(t)) return 'no_token_account';
    if (/illegalowner/i.test(t)) return 'network_rejected';
    if (/blockhash not found|block height exceeded|blockhash_expired|has expired|transactionexpired/i.test(t)) return 'blockhash_expired';
    if (/transaction simulation failed|simulation failed/i.test(t)) return 'simulation_failed';
    if (/user rejected|rejected the request|user denied|declined|cancell?ed by user|4001/i.test(t)) return 'user_rejected';
    if (/error code:\s*1027|daily request budget/i.test(t)) return 'cf_1027';
    if (/durable object|code was updated|object reset|storage operation/i.test(t)) return 'gate_reset';
    if (/stale_timestamp|clock/i.test(t)) return 'stale_timestamp';
    if (/too many|rate.?limit|\b429\b/i.test(t)) return 'rate_limited';
    if (/aborterror|took too long|timed? ?out|timeout/i.test(t)) return 'timeout';
    if (/failed to fetch|networkerror|load failed|could not reach|network request failed/i.test(t)) return 'network_error';
    if (/connect a wallet|no wallet|wallet not connected/i.test(t)) return 'no_wallet';
    if (/wallet cannot sign/i.test(t)) return 'wallet_cannot_sign';
    return '';
  }

  function walletAction(reason) {
    return {
      label: 'Create free wallet',
      run: function () {
        try {
          var W = window.OST_WALLET;
          if (W && typeof W.requireWallet === 'function') return W.requireWallet({ reason: reason || 'money' });
          if (window.OST_WALLET_HOME && typeof window.OST_WALLET_HOME.open === 'function') return window.OST_WALLET_HOME.open('start');
        } catch (_) {}
      }
    };
  }

  var PENDING_BODY = 'Check your balance before retrying.';

  function build(code, x, opts) {
    var b = x.body || {};
    // The error's own asset (set where the amount was checked) beats the
    // caller's guess: a SOL tip that is short must say SOL, not OST.
    var asset = x.asset || (opts && opts.asset) || '';
    var unit = asset || 'OST';
    // The error's own stage beats the caller's: a failed quote/build (nothing
    // signed) is never "still confirming", even when the caller passed submit.
    var stage = x.stage || (opts && opts.stage) || '';
    var submit = stage === 'submit';
    var R = function (title, body, extra) { return Object.assign({ state: 'refused', title: title, body: body, retryable: false }, extra || {}); };
    var F = function (title, body, extra) { return Object.assign({ state: 'failed', title: title, body: body, retryable: true }, extra || {}); };
    var P = function (title, body, extra) { return Object.assign({ state: 'pending', title: title || 'Still confirming', body: body || PENDING_BODY, retryable: false }, extra || {}); };

    switch (code) {
      // ---- refused before anything moved -------------------------------
      case 'insufficient_balance':
      case 'not_enough_ost':
        return R('Not enough ' + unit, b.have != null ? 'You have ' + fmtNum(b.have) + ' ' + unit + '.' : 'This wallet doesn’t hold enough ' + unit + ' for that. Nothing was sent.');
      case 'insufficient_funds':
        return R('Not enough funds', 'This wallet doesn’t hold enough for that transfer. Nothing moved.');
      case 'no_token_account':
        return R('No ' + unit + ' in this wallet yet', 'This wallet has no ' + unit + ' account yet. Claim free OST first, then try again.');
      case 'no_sol':
      case 'insufficient_sol':
        return R('Not enough SOL', 'This needs devnet SOL in your wallet. Get SOL by cashing out 10 OST → SOL in Convert.');
      case 'below_rent_minimum':
        return R('Amount too small for a new Solana account',
          (b.minOst != null
            ? 'Solana requires a new account to hold at least ' + RENT_MIN_SOL.toFixed(5) + ' SOL, so your first cash-out must be at least ' + fmtNum(b.minOst, 2) + ' OST.'
            : 'Solana requires at least ' + RENT_MIN_SOL.toFixed(5) + ' SOL in a new account. Send more, or send to an address that already holds SOL.'));
      case 'keep_rent_reserve':
        return R('Leave a little SOL behind', 'Solana needs at least ' + RENT_MIN_SOL.toFixed(5) + ' SOL left in your wallet. ' +
          (Number(b.maxSol) > 0 ? 'Send at most ' + fmtNum(b.maxSol, 6) + ' SOL' + (Number(b.allSol) > 0 ? ', or all ' + fmtNum(b.allSol, 6) + ' SOL' : '') + '.' : 'Use a smaller amount, or all of it.'));
      case 'recipient_needs_account':
        if (x.reason === 'off_curve') return R('That address can’t receive ' + unit, 'It is a program address without an ' + unit + ' account. Send to a person’s wallet address instead. Nothing was sent.');
        if (x.reason === 'sender_daily_cap') return R('Recipient needs an account first', 'You’ve used today’s free account set-ups for new recipients. Ask them to claim free OST first (that opens their account), or try again tomorrow. Nothing was sent.');
        return R('Recipient needs an account first', 'This address has no ' + unit + ' account yet and today’s free account allowance is used up. Ask them to claim free OST first, then send again. Nothing was sent.');
      case 'rate_limited':
      case 'slow_down':
        return R('Too many requests', 'Try again in ' + fmtWait(b.retryAfterMs || (b.retryAfter ? b.retryAfter * 1000 : 60000)) + '. Nothing was sent.', { retryable: true });
      case 'daily_wallet_cap':
      case 'cap_reached':
        return R('Daily limit reached', (b.remaining != null ? 'Remaining today for this wallet: ' + fmtNum(b.remaining) + ' OST.' : 'This wallet reached today’s limit.') + ' Try again tomorrow.');
      case 'already_paid':
        return R('Already paid', 'This was paid earlier' + ((x.sig) ? ' (tx ' + shortSig(x.sig) + ').' : '.') + ' Nothing more to do.', { sig: x.sig || undefined });
      case 'wallet_auth_required':
      case 'unauthorized':
      case 'stale_timestamp':
      case 'bad_signature':
      case 'bad_session':
      case 'replay':
      case 'wallet_mismatch': {
        var reason = code === 'wallet_auth_required' || code === 'unauthorized' ? (x.reason || '') : code;
        if (reason === 'stale_timestamp') {
          var off = Number(b.serverTime) ? Math.round(Math.abs(Date.now() - Number(b.serverTime)) / 60000) : 0;
          return R('Your device clock is off', (off ? 'It is about ' + off + ' min off. ' : '') + 'Turn on automatic date & time, then try again.', { retryable: true });
        }
        if (reason === 'replay') return F('Please try again', 'That sign-in was already used. Try once more.');
        if (reason === 'wallet_mismatch') return R('Wrong wallet', 'This action must be signed by the wallet it pays from.');
        return R('Sign in with your wallet', 'This action must be approved by your wallet. Reconnect it and try again.', { retryable: true });
      }
      case 'auth_unavailable':
        return F('Sign-in is busy', 'The sign-in service is busy. Try again in a few seconds.');
      case 'credits_retired':
        return R('Legacy credits are retired', 'Old vault credits have no cash value and can’t be cashed out. Claim free devnet OST instead.');
      case 'daily_cooldown':
      case 'cooldown': {
        var next = b.nextAt || b.nextDailyClaimAt || b.next || null;
        var wait = next ? untilText(next) : '';
        return R('Already claimed today', wait ? 'Next free OST in ' + wait + '.' : 'Come back tomorrow for more free OST.');
      }
      case 'welcome_claimed':
      case 'already_claimed':
        return R('Already claimed', 'This wallet already got its free OST.');
      case 'claim_in_progress':
      case 'payout_in_progress':
        return P('Already in progress', 'Your earlier request is still being processed. Check your balance in a moment.');
      case 'user_rejected':
      case 'cancelled':
        return R('Cancelled', 'You cancelled in your wallet. Nothing was sent.', { retryable: true });
      case 'not_installed':
        return R('Wallet app not found', 'Install the wallet app, or create a free OST browser wallet.', { action: walletAction('install') });
      case 'no_wallet':
      case 'missing_wallet':
        return R('No wallet connected', 'Create a free devnet wallet or connect one to continue.', { action: walletAction('money') });
      case 'wallet_cannot_sign':
        return R('This wallet can’t sign here', 'Use the OST browser wallet, Phantom, Solflare or Backpack.');
      case 'send_in_flight':
      case 'in_progress':
        return R('Already sending', 'A payment is already on its way — wait for it to finish.', { retryable: true });
      case 'sign_failed':
        return F('Your wallet didn’t sign it', 'Nothing was sent. Unlock your wallet and try again.');
      case 'invalid_destination':
      case 'invalid_wallet':
      case 'invalid_owner':
      case 'invalid_recipient':
        if (x.reason === 'self') return R('That’s your own wallet', 'Send to a different address.');
        if (x.reason === 'mint') return R('Use a wallet address', 'That is a token address, not a person’s wallet. Ask for their wallet address.');
        if (x.reason === 'not_a_wallet') return R('Use a wallet address', 'That address is not a person’s wallet (it may be a token account or a program). Ask for their wallet address.');
        return R('Check the address', 'That isn’t a valid Solana wallet address.');
      case 'self_send':
        return R('That’s your own wallet', 'Send to a different address.');
      case 'mint_address':
      case 'token_account_address':
        return R('Use a wallet address', 'That is a token or token-account address, not a person’s wallet. Ask for their wallet address.');
      case 'invalid_amount':
      case 'bad_amount':
      case 'quote_too_small':
      case 'amount_too_low':
        return R('Amount too small', 'Enter a larger amount.');
      case 'mint_not_sponsored':
      case 'unsupported_asset':
        return R('Not supported', 'This token can’t be sent or converted here.');
      case 'needs_new_service':
        return R('Not available yet', 'This needs the updated OST service, which is rolling out. Nothing was sent.');
      case 'insufficient_pool_sol':
        return R('OST fees are paused', 'The OST fee payer is out of devnet SOL right now. Nothing was sent — try again later.', { retryable: true });
      case 'payment_pending':
        return R('A payment is still being checked', 'Your earlier payment' + (x.sig ? ' (tx ' + shortSig(x.sig) + ')' : '') + ' is still being verified, so no new order was made and nothing was paid. Tap Refresh status — don’t pay again.', { sig: x.sig || undefined, retryable: true });
      case 'rpc_unavailable':
        return F('Solana is unreachable', 'Solana couldn’t be reached, so nothing was signed or sent. Try again in a moment.');
      case 'verify_unavailable':
        return F('Couldn’t verify right now', 'The ticket couldn’t be checked on chain, so nothing was paid. Try again shortly.');
      case 'server_settled':
        return R('Already settled', 'The OST server already settled this ticket. Check your play balance.');
      case 'ticket_unverified':
        return R('Ticket not verified', 'This ticket doesn’t match a confirmed stake, so nothing was paid.');
      case 'payout_exceeds_ticket':
        return R('More than this ticket can pay', (b.maxOst != null ? 'This ticket can pay at most ' + fmtNum(b.maxOst, 4) + ' OST.' : 'That is more than this ticket can pay.') + ' Nothing was paid.');
      case 'payout_id_conflict':
        return R('Already being paid', 'This ticket already has a payout on record. Nothing more was sent.');
      case 'invalid_signature':
        return R('Wallet signature missing', 'The wallet signature was missing or invalid. Nothing was sent — try again.', { retryable: true });
      case 'daily_global_cap':
        return R('Daily OST limit reached', 'Today’s service-wide limit is used up. Try again after 00:00 UTC. Nothing was sent.');
      case 'insufficient_pool':
      case 'solvency_cap':
      case 'reserve_protected':
      case 'cap_exceeded':
        return R('Pool limit', 'The OST pool can’t cover that amount right now. Try a smaller amount.');
      case 'server_only_kind':
        return R('Not allowed here', 'That payment can only be issued by the OST server.');
      case 'cf_1027':
      case 'daily_cap':
        return R('OST is resting until 00:00 UTC', 'The service is over its daily request budget. Your funds are safe; nothing was taken.', { retryable: true });
      case 'jurisdiction_not_served':
        return R('Not available in your region', 'This service isn’t offered where you are.');
      case 'amount_mismatch':
        return R('Amount changed', 'The amount to sign didn’t match what you typed, so nothing was signed. Try again.', { retryable: true });

      // ---- maybe sent: never call it a failure --------------------------
      case 'state_unknown':
      case 'submit_unconfirmed':
      case 'payout_unconfirmed':
      case 'payout_unknown_state':
      case 'pending':
        return P('Still confirming', PENDING_BODY, { sig: x.sig || undefined });

      // ---- did not go through ------------------------------------------
      case 'blockhash_expired':
      case 'cosign_not_found':
        return F('Quote expired', 'The quote expired before it was sent. Nothing moved — try again.');
      case 'network_rejected':
      case 'simulation_failed':
      case 'transaction_failed':
        return F('The network rejected it', 'Nothing moved. Try again in a moment.');
      case 'tx_failed':
        return F('It failed on chain', 'The transaction failed on chain, so nothing moved. Try again in a moment.', { sig: x.sig || undefined });
      case 'gate_reset':
      case 'internal_error':
        // The worker says so when the reset happened before anything was sent.
        if (x.nothingSent) return F('OST restarted', 'The OST service restarted before sending. Nothing was sent — try again in a few seconds.');
        if (submit || x.sig) return P('Still confirming', 'The OST service restarted mid-request. ' + PENDING_BODY, { sig: x.sig || undefined });
        return F('OST restarted', 'The OST service restarted. ' + (stage === 'build' ? 'Nothing was sent — try' : 'Try') + ' again in a few seconds.');
      case 'timeout':
      case 'network_error':
        if (submit) return P('Still confirming', 'We lost contact while it was being sent. ' + PENDING_BODY, { sig: x.sig || undefined });
        return F(code === 'timeout' ? 'Taking too long' : 'Can’t reach OST', (stage === 'build' ? 'Nothing was sent. ' : '') + 'Check your connection and try again.');
      case 'submit_failed':
      case 'payout_failed':
      case 'send_failed':
      case 'relay_failed':
      case 'payout_unreachable':
      case 'solana_rpc_failed':
      case 'rpc_read_failed':
      case 'balance_unknown':
      case 'blockhash_unavailable':
      case 'upstream_failed':
      case 'fetch_failed':
        return F('Network busy', 'The Solana devnet connection is busy. Try again in a moment.');
      case 'price_unavailable':
      case 'quote_unavailable':
      case 'no_price':
        return F('Price unavailable', 'We couldn’t get a price right now. Try again in a moment.');
      case 'bad_response':
        return F('Unexpected answer', 'OST returned an unexpected response. Try again shortly.');
      default:
        return null;
    }
  }

  var GENERIC_TITLE = 'That didn’t go through';

  // Drop a leading copy of the title from the body ("Not enough OST — Not
  // enough OST — …" / "That didn’t go through — That didn’t go through — …").
  function dedupe(out) {
    if (!out || !out.title || !out.body) return out;
    var t = str(out.title).trim(), b = str(out.body).trim();
    var low = b.toLowerCase(), lt = t.toLowerCase().replace(/[.!]+$/, '');
    while (lt && low.indexOf(lt) === 0) {
      b = b.slice(lt.length).replace(/^[\s.!:—–-]+/, '').trim();
      low = b.toLowerCase();
    }
    out.body = b;
    return out;
  }

  function humanize(errOrBody, opts) {
    opts = opts || {};
    var x = extract(errOrBody == null ? '' : errOrBody);
    var stage = x.stage || opts.stage || '';
    var code = x.code;
    // simulation_failed / tx_failed carry the decoded reason in `code` of the body.
    if ((code === 'simulation_failed' || code === 'tx_failed') && x.body && typeof x.body.code === 'string' && x.body.code &&
        x.body.code !== code && x.body.code !== 'simulation_failed' && x.body.code !== 'tx_failed') {
      var inner = x.body.code.toLowerCase();
      if (build(inner, x, opts)) code = inner;
    }
    var out = code ? build(code, x, opts) : null;
    // submit_failed / internal_error often wrap an on-chain reason: decode it.
    if (!out || code === 'submit_failed' || code === 'internal_error' || code === 'simulation_failed' || code === 'transaction_failed') {
      var guess = codeFromText(x.text);
      // An old worker's "Durable Object reset" text is a restart, not a reason.
      if (guess && !(guess === 'gate_reset' && code === 'internal_error')) {
        var g = build(guess, x, opts);
        if (g) { out = g; code = guess; }
      }
    }
    if (!out && x.status === 401) out = build('wallet_auth_required', x, opts);
    if (!out && x.status === 429) out = build('rate_limited', x, opts);
    if (!out && x.status >= 500) out = build(stage === 'submit' && !x.nothingSent ? 'state_unknown' : 'submit_failed', x, opts);
    if (!out) {
      // Unknown code. Use the server's sentence only when it is plainly human.
      var msg = x.message && !isRaw(x.message) ? x.message.replace(/\s+/g, ' ').trim() : '';
      if (x.pending || (stage === 'submit' && x.sig && !x.nothingSent)) out = build('state_unknown', x, opts);
      else out = { state: 'failed', title: GENERIC_TITLE, body: msg || 'Try again in a moment. If it keeps happening, check your balance first.', retryable: true };
    }
    // A known signature means it was broadcast: never present that as a plain failure.
    if (x.sig && !x.nothingSent && stage !== 'build' && out.state === 'failed' && (code === 'gate_reset' || code === 'internal_error' || code === 'timeout' || code === 'network_error')) {
      out = build('state_unknown', x, opts);
    }
    out = dedupe(out);
    if (!out.body && out.title === GENERIC_TITLE) out.body = 'Try again in a moment.';
    out.code = code || 'unknown';
    if (x.sig && !out.sig) out.sig = x.sig;
    return out;
  }

  // One-line form for status lines: "Title — body". Callers append nothing:
  // the body already ends with its own punctuation.
  function text(errOrBody, opts) {
    var h = humanize(errOrBody, opts);
    return h.title + (h.body ? ' — ' + h.body : '');
  }

  // Show it through the shared notifier (C2) when present, else window.toast.
  function notify(errOrBody, opts) {
    var h = humanize(errOrBody, opts);
    try {
      if (typeof window.OST_NOTIFY === 'function') {
        window.OST_NOTIFY({ id: opts && opts.id, kind: h.state === 'pending' ? 'pending' : (h.state === 'refused' ? 'warn' : 'error'), title: h.title, body: h.body, sig: h.sig, action: h.action });
      } else if (typeof window.toast === 'function') {
        window.toast(h.state === 'pending' ? '⏳' : '⚠️', h.title + (h.body ? ' — ' + h.body : ''));
      } else if (window.OST_OPTIMISTIC && typeof window.OST_OPTIMISTIC.toast === 'function') {
        window.OST_OPTIMISTIC.toast(h.title + (h.body ? ' — ' + h.body : ''), h.state === 'pending' ? 'info' : 'error');
      }
    } catch (_) {}
    return h;
  }

  window.OST_MONEY_ERRORS = {
    humanize: humanize,
    text: text,
    notify: notify,
    isRaw: isRaw,
    codeFromText: codeFromText,
    RENT_MIN_SOL: RENT_MIN_SOL
  };
})();
