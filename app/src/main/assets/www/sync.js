/* Hosam TV sync — keeps "continue watching", episode progress and favourites the same on the TV and the phone.
   Plain ES5 (runs on the LG TV's Chrome 53 too). Storage: Supabase table tv_sync, reached only through the
   tv_pull / tv_push functions. The account id is a SHA-256 of the subscription login, so both devices that use
   the same subscription share the same data automatically and nobody else can read it. */
(function () {
'use strict';
var SB_URL = 'https://fvsueucybrxozrxglcye.supabase.co';
var SB_KEY = 'sb_publishable_EJupgUdF_iV11wiH1RljLw_29nUnqsl';

// ---- SHA-256 (hex) ----
function sha256(str) {
  var s = unescape(encodeURIComponent(str)), i, j;
  var K = [], H = [], isP = function (n) { for (var f = 2; f * f <= n; f++) if (n % f === 0) return false; return true; };
  var frac = function (x) { return ((x - Math.floor(x)) * 4294967296) | 0; };
  for (var n = 2, c = 0; c < 64; n++) if (isP(n)) { if (c < 8) H[c] = frac(Math.pow(n, 1 / 2)); K[c++] = frac(Math.pow(n, 1 / 3)); }
  var words = [], bl = s.length * 8;
  for (i = 0; i < s.length; i++) words[i >> 2] |= s.charCodeAt(i) << (24 - (i % 4) * 8);
  words[bl >> 5] |= 0x80 << (24 - bl % 32);
  words[((bl + 64 >> 9) << 4) + 15] = bl;
  var rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
  for (j = 0; j < words.length; j += 16) {
    var w = [], a = H[0], b = H[1], cc = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (i = 0; i < 64; i++) {
      if (i < 16) w[i] = words[j + i] | 0;
      else {
        var w15 = w[i - 15], w2 = w[i - 2];
        w[i] = (w[i - 16] + (rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10))) | 0;
      }
      var t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      var t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & cc) ^ (b & cc))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = cc; cc = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + cc) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  var out = '';
  for (i = 0; i < 8; i++) for (j = 3; j >= 0; j--) { var bt = (H[i] >>> (j * 8)) & 255; out += (bt < 16 ? '0' : '') + bt.toString(16); }
  return out;
}

function rpc(fn, body) {
  return new Promise(function (res, rej) {
    var x = new XMLHttpRequest();
    x.open('POST', SB_URL + '/rest/v1/rpc/' + fn, true);
    x.setRequestHeader('apikey', SB_KEY);
    x.setRequestHeader('Content-Type', 'application/json');
    x.timeout = 20000;
    x.onload = function () {
      if (x.status < 200 || x.status >= 300) return rej(new Error('sync HTTP ' + x.status));
      try { res(x.responseText ? JSON.parse(x.responseText) : null); } catch (e) { res(null); }
    };
    x.onerror = function () { rej(new Error('sync offline')); };
    x.ontimeout = function () { rej(new Error('sync timeout')); };
    x.send(JSON.stringify(body));
  });
}
function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

// adapter: { get: () => ({prog, ep, fav}), set: ({prog, ep, fav}) => void, changed: () => void }
function flatten(st) {
  var o = {};
  Object.keys(st.prog || {}).forEach(function (k) { o['p:' + k] = st.prog[k]; });
  Object.keys(st.ep || {}).forEach(function (k) { o['e:' + k] = st.ep[k]; });
  ['live', 'movie', 'series'].forEach(function (t) {
    var m = (st.fav && st.fav[t]) || {};
    Object.keys(m).forEach(function (id) { o['f:' + t + ':' + id] = m[id]; });
  });
  return o;
}
function unflatten(o) {
  var st = { prog: {}, ep: {}, fav: { live: {}, movie: {}, series: {} } };
  Object.keys(o).forEach(function (k) {
    if (k.indexOf('p:') === 0) st.prog[k.slice(2)] = o[k];
    else if (k.indexOf('e:') === 0) st.ep[k.slice(2)] = o[k];
    else if (k.indexOf('f:') === 0) {
      var rest = k.slice(2), i = rest.indexOf(':'), t = rest.slice(0, i), id = rest.slice(i + 1);
      if (st.fav[t]) st.fav[t][id] = o[k];
    }
  });
  return st;
}

var S = window.HSync = { acct: null, ad: null, busy: false, last: 0, err: '' };
var keySnap, keySince;
S.start = function (adapter, login) {
  S.ad = adapter;
  S.acct = sha256('hosamtv|' + login);
  keySnap = 'sync_snap_' + S.acct.slice(0, 12);
  keySince = 'sync_since_' + S.acct.slice(0, 12);
  S.now();
  if (!S._t) {
    S._t = setInterval(S.now, 60000);
    document.addEventListener('visibilitychange', function () { if (document.hidden) S.now(); else setTimeout(S.now, 500); });
  }
};
S.now = function () {
  if (!S.acct || S.busy) return Promise.resolve();
  S.busy = true;
  var cur = flatten(S.ad.get()), snap = lsGet(keySnap, {}), since = lsGet(keySince, 0), now = Date.now();
  var rows = [];
  Object.keys(cur).forEach(function (k) {
    var j = JSON.stringify(cur[k]);
    if (snap[k] !== j) rows.push({ k: k, v: cur[k], ts: (k.indexOf('p:') === 0 && cur[k] && cur[k].ts) ? cur[k].ts : now });
  });
  Object.keys(snap).forEach(function (k) { if (!(k in cur)) rows.push({ k: k, v: null, ts: now, del: true }); });
  var push = Promise.resolve();
  for (var i = 0; i < rows.length; i += 500) (function (chunk) {
    push = push.then(function () { return rpc('tv_push', { p_acct: S.acct, p_rows: chunk }); });
  })(rows.slice(i, i + 500));
  return push.then(function () {
    rows.forEach(function (r) { if (r.del) delete snap[r.k]; else snap[r.k] = JSON.stringify(r.v); });
    return rpc('tv_pull', { p_acct: S.acct, p_since: since });
  }).then(function (got) {
    got = Array.isArray(got) ? got : [];
    var changed = false;
    got.forEach(function (r) {
      if (r.sq > since) since = r.sq;
      var j = r.del ? undefined : JSON.stringify(r.v);
      if (r.del) { if (r.k in cur) { delete cur[r.k]; changed = true; } delete snap[r.k]; }
      else { if (JSON.stringify(cur[r.k]) !== j) { cur[r.k] = r.v; changed = true; } snap[r.k] = j; }
    });
    lsSet(keySnap, snap); lsSet(keySince, since);
    if (changed) { S.ad.set(unflatten(cur)); if (S.ad.changed) S.ad.changed(); }
    S.last = Date.now(); S.err = ''; S.busy = false;
  }).catch(function (e) { S.err = e.message; S.busy = false; });
};
S.status = function () {
  if (!S.acct) return 'المزامنة: مش شغالة';
  if (S.err) return 'المزامنة: مفيش اتصال (' + S.err + ')';
  if (!S.last) return 'المزامنة: جاري…';
  var d = new Date(S.last);
  return 'المزامنة: شغالة · آخر مرة ' + (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
};
S._sha = sha256;
})();
