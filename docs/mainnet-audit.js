/* ============================================================
   mainnet-audit.js — boot-time pre-launch self-check
   Runs after app.js, surveys the live state, and logs a single
   green/yellow/red summary to console + window.OST_AUDIT.
   Non-intrusive: never throws, never blocks UI.
   ============================================================ */
(function () {
  'use strict';
  if (window.__OST_AUDIT_LOADED__) return;
  window.__OST_AUDIT_LOADED__ = true;

  var REQUIRED_GLOBALS = [
    'OST_CONFIG', 'OST_ICON', 'OST_API_BASE'
  ];
  var OPTIONAL_GLOBALS = [
    'OST_MESH', 'OST_VEIL', 'OST_GHOST', 'OST_REDESIGN',
    'OST_RPC_ACTIVE_ENDPOINTS', 'solanaWeb3', 'Buffer'
  ];
  var REQUIRED_SECTIONS = [
    'home','new-here','commerce','wallet','stock-market','ai','offline',
    'censorship','spacex','about','story','roadmap','build','launchpad',
    'survival','quantum-realm','legacy','transparency'
  ];

  function ready(fn) {
    if (document.readyState === 'complete') { setTimeout(fn, 800); return; }
    window.addEventListener('load', function () { setTimeout(fn, 800); }, { once: true });
  }

  function isPlaceholderAddr(addr) {
    if (!addr || typeof addr !== 'string') return true;
    if (addr.length < 32) return true;
    if (/^(11111|0000|XXXX|YOUR|PLACEHOLDER)/i.test(addr)) return true;
    return false;
  }

  function audit() {
    var report = {
      ts: new Date().toISOString(),
      network: '',
      rpc: '',
      addresses: { programId: '', mint: '', wostMint: '' },
      globals: { missing: [], present: [] },
      sections: { missing: [], present: 0 },
      assets: { brokenScripts: [], brokenStyles: [] },
      mesh: { ready: false, peer: '', sessionReady: false, rtcOpen: false },
      veil: { active: false, transport: '' },
      ghost: { ready: false, awareness: false },
      mainnetReadiness: 'unknown',
      warnings: [],
      errors: []
    };

    // ---- Globals
    REQUIRED_GLOBALS.forEach(function (k) {
      if (window[k] != null) report.globals.present.push(k);
      else { report.globals.missing.push(k); report.errors.push('Missing required global: ' + k); }
    });
    OPTIONAL_GLOBALS.forEach(function (k) {
      if (window[k] != null) report.globals.present.push(k);
      else report.warnings.push('Optional global not set: ' + k);
    });

    // ---- Network / addresses
    if (window.OST_CONFIG) {
      report.network = window.OST_CONFIG.network || '';
      report.rpc = window.OST_CONFIG.rpcUrl || '';
      report.addresses.programId = window.OST_CONFIG.programId || '';
      report.addresses.mint = window.OST_CONFIG.mint || '';
      report.addresses.wostMint = window.OST_CONFIG.wostMint || '';
      if (isPlaceholderAddr(report.addresses.programId)) report.errors.push('OST_CONFIG.programId looks like a placeholder');
      if (isPlaceholderAddr(report.addresses.mint))      report.errors.push('OST_CONFIG.mint looks like a placeholder');
    }

    // ---- Mainnet readiness
    if (report.network === 'mainnet-beta' || report.network === 'mainnet') {
      var devnetMint = '383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ';
      var devnetProg = 'J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY';
      var rpcOk = /mainnet/i.test(report.rpc);
      var mintOk = report.addresses.mint && report.addresses.mint !== devnetMint;
      var progOk = report.addresses.programId && report.addresses.programId !== devnetProg;
      if (rpcOk && mintOk && progOk) {
        report.mainnetReadiness = 'green';
      } else {
        report.mainnetReadiness = 'red';
        if (!rpcOk)  report.errors.push('Network=mainnet-beta but rpcUrl is not a mainnet endpoint: ' + report.rpc);
        if (!mintOk) report.errors.push('Network=mainnet-beta but mint is still the devnet OST mint');
        if (!progOk) report.errors.push('Network=mainnet-beta but programId is still the devnet program');
      }
    } else {
      report.mainnetReadiness = 'devnet';
    }

    // ---- Sections
    var missingSections = REQUIRED_SECTIONS.filter(function (id) { return !document.getElementById(id); });
    report.sections.missing = missingSections;
    report.sections.present = REQUIRED_SECTIONS.length - missingSections.length;
    if (missingSections.length) report.errors.push('Missing page sections: ' + missingSections.join(', '));

    // ---- Asset failure detection (check <link>/<script> network errors via Performance API)
    try {
      var perf = (performance && performance.getEntriesByType) ? performance.getEntriesByType('resource') : [];
      var byUrl = {};
      perf.forEach(function (e) { byUrl[e.name] = e; });
      var scripts = document.querySelectorAll('script[src]');
      var styles = document.querySelectorAll('link[rel="stylesheet"]');
      scripts.forEach(function (s) {
        var url = s.src;
        if (!url) return;
        var entry = byUrl[url];
        if (entry && entry.transferSize === 0 && entry.decodedBodySize === 0 && entry.duration === 0) {
          report.assets.brokenScripts.push(url);
        }
      });
      styles.forEach(function (s) {
        var url = s.href;
        if (!url) return;
        var entry = byUrl[url];
        if (entry && entry.transferSize === 0 && entry.decodedBodySize === 0 && entry.duration === 0) {
          report.assets.brokenStyles.push(url);
        }
      });
    } catch (_) {}

    // ---- Mesh / Veil / Ghost
    try {
      if (window.OST_MESH && window.OST_MESH.pavilion) {
        var pav = window.OST_MESH.pavilion;
        report.mesh.ready = true;
        report.mesh.peer = pav.peerAddr || '';
        report.mesh.sessionReady = !!pav.sessionKey;
        report.mesh.rtcOpen = !!(pav.rtc && pav.rtc.isOpen && pav.rtc.isOpen());
      }
    } catch (_) {}
    try {
      if (window.OST_VEIL && typeof window.OST_VEIL.status === 'function') {
        var v = window.OST_VEIL.status() || {};
        report.veil.active = !!v.active;
        report.veil.transport = v.transport || '';
      }
    } catch (_) {}
    try {
      if (window.OST_GHOST) {
        report.ghost.ready = !!window.OST_GHOST.circle;
        report.ghost.awareness = !!window.OST_GHOST.awareness;
      }
    } catch (_) {}

    // ---- Final color
    var color;
    if (report.errors.length === 0 && report.warnings.length <= 2) color = 'green';
    else if (report.errors.length === 0) color = 'yellow';
    else color = 'red';
    report.color = color;

    return report;
  }

  function paint(report) {
    var prefix = '%c[OST AUDIT] ';
    var styleByColor = {
      green:  'color:#00ff9f;font-weight:bold;background:#0a1f15;padding:2px 6px;border-radius:4px;',
      yellow: 'color:#ffd066;font-weight:bold;background:#1f1a0a;padding:2px 6px;border-radius:4px;',
      red:    'color:#ff7777;font-weight:bold;background:#1f0a0a;padding:2px 6px;border-radius:4px;'
    };
    var headline = prefix + report.color.toUpperCase() + ' · network=' + (report.network || '?')
      + ' · sections ' + report.sections.present + '/' + 18
      + ' · errors=' + report.errors.length
      + ' · warnings=' + report.warnings.length
      + ' · mainnetReadiness=' + report.mainnetReadiness;
    try { console.log(headline, styleByColor[report.color] || ''); } catch (_) {}
    if (report.errors.length) {
      try { console.warn('[OST AUDIT] errors:', report.errors); } catch (_) {}
    }
    if (report.warnings.length) {
      try { console.info('[OST AUDIT] warnings:', report.warnings); } catch (_) {}
    }
  }

  ready(function () {
    var r;
    try { r = audit(); } catch (e) {
      r = { color: 'red', errors: ['Audit threw: ' + (e && e.message)] };
    }
    window.OST_AUDIT = r;
    window.OST_AUDIT_RUN = function () {
      var fresh = audit();
      window.OST_AUDIT = fresh;
      paint(fresh);
      return fresh;
    };
    paint(r);
  });
})();
