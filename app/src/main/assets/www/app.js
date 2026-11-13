/* Hosam TV mobile — Xtream player UI for the Android app (WebView) with a native ExoPlayer.
   Inside the app every server request goes through the app's local proxy (/proxy?u=…), so there are
   no CORS / mixed-content problems and posters can be saved on the phone. */
(function () {
'use strict';

// ================= helpers =================
const $ = id => document.getElementById(id);
function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); }
function on(id, b) { $(id).classList.toggle('on', !!b); }
function vis(id) { return $(id).classList.contains('on'); }
const pad2 = n => (n < 10 ? '0' : '') + n;
function mins(t) { const m = Math.round(t / 60); return m >= 60 ? Math.floor(m / 60) + ' س ' + (m % 60) + ' د' : m + ' د'; }
function norm(s) {
  return String(s || '').toLowerCase().replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
}
function b64(s) { try { return decodeURIComponent(escape(atob(s))); } catch (e) { return s || ''; } }
const first = v => Array.isArray(v) ? (v[0] || '') : (v || '');
const arr = d => Array.isArray(d) ? d : [];
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
let toastT = null;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }
const loading = b => on('loading', b);

const IN_APP = !!(window.Android && window.Android.play);
const net = url => IN_APP ? '/proxy?u=' + encodeURIComponent(url) : url;
const thumb = (url, size) => url ? String(url).replace(/(image\.tmdb\.org\/t\/p\/)[^\/]+\//, '$1' + size + '/') : url;

// ================= state =================
const DEFAULTS = { server: 'http://hydraa.cc:2095', user: '', pass: '' };
let cfg = store.get('cfg', null);
let prog = store.get('prog', {});
let epProg = store.get('ep', {});
let favs = store.get('fav', { live: {}, movie: {}, series: {} });
let account = null;

// ================= IndexedDB =================
const idb = {
  _p: null,
  open() {
    if (idb._p) return idb._p;
    idb._p = new Promise(res => {
      try {
        const r = indexedDB.open('hosamtv', 2);
        r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); if (!db.objectStoreNames.contains('img')) db.createObjectStore('img'); };
        r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
      } catch (e) { res(null); }
    });
    return idb._p;
  },
  get(k, st = 'kv') { return idb.open().then(db => !db ? null : new Promise(res => { try { const q = db.transaction(st).objectStore(st).get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); } })); },
  set(k, v, st = 'kv') { return idb.open().then(db => { if (db) try { db.transaction(st, 'readwrite').objectStore(st).put(v, k); } catch (e) {} }); },
  count(st) { return idb.open().then(db => !db ? 0 : new Promise(res => { try { const q = db.transaction(st).objectStore(st).count(); q.onsuccess = () => res(q.result || 0); q.onerror = () => res(0); } catch (e) { res(0); } })); },
  clear(st) { return idb.open().then(db => { if (db) try { db.transaction(st, 'readwrite').objectStore(st).clear(); } catch (e) {} }); }
};

// ================= api (lists saved on the phone, refreshed in the background) =================
const cache = {};
function getJSON(url) {
  return fetch(net(url)).then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }).then(t => { try { return JSON.parse(t); } catch (e) { throw new Error('رد غير مفهوم من السيرفر'); } },
    e => { throw (e && e.message && e.message.indexOf('HTTP') === 0) ? e : new Error('تعذر الاتصال بالسيرفر'); });
}
const LIST = { get_vod_categories: 1, get_series_categories: 1, get_live_categories: 1, get_vod_streams: 1, get_series: 1, get_live_streams: 1 };
function api(action, params, noCache) {
  let q = '';
  if (params) Object.keys(params).forEach(k => { q += '&' + k + '=' + encodeURIComponent(params[k]); });
  const key = (action || '') + q;
  if (!noCache && cache[key]) return cache[key];
  const url = cfg.server + '/player_api.php?username=' + encodeURIComponent(cfg.user) + '&password=' + encodeURIComponent(cfg.pass) + (action ? '&action=' + action : '') + q;
  let p;
  if (!noCache && LIST[action]) {
    const ck = 'api:' + cfg.server + '|' + cfg.user + '|' + key;
    p = idb.get(ck).then(saved => {
      const fresh = getJSON(url).then(d => { idb.set(ck, { ts: Date.now(), d }); return d; });
      if (saved && saved.d) { fresh.catch(() => {}); return saved.d; }
      return fresh;
    });
  } else p = getJSON(url);
  if (!noCache) { cache[key] = p; p.catch(() => { delete cache[key]; }); }
  return p;
}
const streamUrl = (kind, id, ext) => cfg.server + '/' + kind + '/' + encodeURIComponent(cfg.user) + '/' + encodeURIComponent(cfg.pass) + '/' + id + '.' + ext;
const mkLive = r => ({ t: 'live', id: r.stream_id, name: r.name || '', icon: r.stream_icon || '', num: r.num });
const mkMovie = r => ({ t: 'movie', id: r.stream_id, name: r.name || '', icon: r.stream_icon || '', ext: r.container_extension || 'mp4', rating: parseFloat(r.rating) || 0, added: parseInt(r.added, 10) || 0 });
const mkSeries = r => ({ t: 'series', id: r.series_id, name: r.name || '', icon: r.cover || '', bd: first(r.backdrop_path), plot: r.plot || '', genre: r.genre || '', year: String(r.releaseDate || r.release_date || '').slice(0, 4), rating: parseFloat(r.rating) || 0, added: parseInt(r.last_modified, 10) || 0 });
function vodInfo(m) {
  return api('get_vod_info', { vod_id: m.id }).then(d => {
    const i = (d && d.info && !Array.isArray(d.info)) ? d.info : {};
    if (d && d.movie_data && d.movie_data.container_extension) m.ext = d.movie_data.container_extension;
    return { plot: i.plot || i.description || '', bd: first(i.backdrop_path), genre: i.genre || '', year: String(i.releasedate || i.release_date || '').slice(0, 4),
      dur: i.duration || '', rating: parseFloat(i.rating) || m.rating || 0, cast: i.cast || i.actors || '', director: i.director || '' };
  });
}

// ================= images: saved small on the phone after first view =================
const imgc = { q: [], saving: false };
idb.count('img').then(n => { if (n > 5000) idb.clear('img'); });
const current = (im, url) => im.dataset.src === url;
function showBlob(im, blob, url) {
  if (!current(im, url)) return;
  const u = URL.createObjectURL(blob);
  im.onload = () => URL.revokeObjectURL(u);
  im.src = u;
}
function saveNext() {
  const job = imgc.q.shift();
  if (!job) { imgc.saving = false; return; }
  try {
    const im = job.im, nw = im.naturalWidth, nh = im.naturalHeight;
    if (nw && nh) {
      const w = Math.min(job.w, nw), hh = Math.round(nh * (w / nw));
      const c = document.createElement('canvas'); c.width = w; c.height = hh;
      c.getContext('2d').drawImage(im, 0, 0, w, hh);
      c.toBlob(b => { if (b) idb.set(job.key, b, 'img'); }, 'image/jpeg', 0.82);
    }
  } catch (e) {}
  setTimeout(() => requestIdleCallback(saveNext, { timeout: 2000 }), 30);
}
function loadImg(im) {
  const url = im.dataset.src, w = parseInt(im.dataset.w, 10) || 240, key = w + '|' + url;
  idb.get(key, 'img').then(b => {
    if (!current(im, url)) return;
    if (b) { showBlob(im, b, url); return; }
    if (!IN_APP) im.crossOrigin = 'anonymous';
    im.onload = () => {
      im.onload = null;
      imgc.q.push({ im, key, w });
      if (!imgc.saving) { imgc.saving = true; requestIdleCallback(saveNext, { timeout: 2000 }); }
    };
    im.onerror = () => { im.style.display = 'none'; };
    im.src = net(url);
  });
}
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); loadImg(e.target); } }), { rootMargin: '400px 300px' });
function img(src, size, w, cls) {
  const im = h('img', cls || '');
  im.alt = '';
  if (!src) { im.style.display = 'none'; return im; }
  im.dataset.src = size ? thumb(src, size) : src;
  im.dataset.w = w || 240;
  io.observe(im);
  return im;
}
function setImg(im, src, size, w, blur) {
  im.className = blur ? 'blur' : '';
  im.removeAttribute('src'); im.style.display = '';
  if (!src) { im.style.display = 'none'; delete im.dataset.src; return; }
  im.dataset.src = size ? thumb(src, size) : src;
  im.dataset.w = w;
  loadImg(im);
}

// ================= favourites & progress =================
const isFav = (t, id) => !!favs[t][id];
function toggleFav(t, it) {
  if (favs[t][it.id]) { delete favs[t][it.id]; toast('اتشال من المفضلة'); }
  else { favs[t][it.id] = { t: it.t, id: it.id, name: it.name, icon: it.icon, ext: it.ext, rating: it.rating, bd: it.bd, num: it.num }; toast('اتضاف للمفضلة'); }
  store.set('fav', favs);
  setTimeout(syncNow, 300);
}
const favList = t => Object.keys(favs[t]).map(k => favs[t][k]);
const contList = type => Object.keys(prog).map(k => prog[k]).filter(p => p.type === type).sort((a, b) => b.ts - a.ts).slice(0, 20);
const progKey = p => p.type === 'movie' ? 'm:' + p.id : 's:' + p.sid;

// ================= navigation stack (Android back button) =================
const stack = [];
function push(id) { stack.push(id); on(id, true); }
function pop() {
  const id = stack.pop(); if (!id) return false;
  on(id, false);
  if (id === 'wplayer') { const v = $('wvideo'); webPlayerClose(); v.pause(); v.removeAttribute('src'); v.load(); }
  if (id === 'details' || id === 'wplayer') refreshTabs();
  return true;
}
window.hostBack = function () {
  if (vis('sheet')) { closeSheet(); return true; }
  if (pop()) return true;
  if (curTab !== 'home' && vis('main')) { showTab('home'); return true; }
  return false;
};
document.addEventListener('click', e => { if (e.target.closest('[data-back]')) { e.preventDefault(); window.hostBack(); } });

// ================= action sheet =================
function sheet(title, buttons) {
  $('sheet-t').textContent = title;
  const box = $('sheet-btns'); clear(box);
  buttons.forEach(b => {
    const el = h('button', 'btn' + (b.cls ? ' ' + b.cls : ''), b.label);
    el.onclick = () => { closeSheet(); if (b.cb) b.cb(); };
    box.appendChild(el);
  });
  on('sheet', true);
}
function closeSheet() { on('sheet', false); }
$('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });

// ================= cards & rows =================
function longPress(el, fn) {
  let t = null, fired = false;
  el.addEventListener('touchstart', () => { fired = false; t = setTimeout(() => { fired = true; if (navigator.vibrate) navigator.vibrate(15); fn(); }, 550); }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach(ev => el.addEventListener(ev, () => clearTimeout(t), { passive: true }));
  el.addEventListener('contextmenu', e => { e.preventDefault(); if (!fired) fn(); });
  el.addEventListener('click', e => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
}
function makeCard(o) {
  const c = h('div', 'card ' + (o.kind || ''));
  const a = h('div', 'art');
  a.appendChild(h('div', 'ph', o.name));
  const wide = o.kind === 'wide' || o.kind === 'epc';
  a.appendChild(img(o.icon, wide ? 'w300' : 'w185', wide ? 480 : 240));
  if (o.tag) a.appendChild(h('div', 'tag', o.tag));
  if (o.pct) { const pb = h('div', 'pb'), i = h('i'); i.style.width = o.pct + '%'; pb.appendChild(i); a.appendChild(pb); }
  c.appendChild(a);
  const cap = h('div', 'cap', o.name);
  if (o.sub) cap.appendChild(h('small', '', o.sub));
  c.appendChild(cap);
  if (o.ok) c.onclick = o.ok;
  if (o.long) longPress(c, o.long);
  return c;
}
const itemCard = it => makeCard({ name: it.name, icon: it.icon, tag: it.rating ? '★ ' + it.rating.toFixed(1) : '', ok: () => openDetails(it) });
function contCard(p) {
  const pct = p.d ? Math.max(3, Math.round(p.t / p.d * 100)) : 0;
  const sub = p.type === 'series' ? p.label + (p.d ? ' · باقي ' + mins(Math.max(0, p.d - p.t)) : '') : 'باقي ' + mins(Math.max(0, p.d - p.t));
  const go = () => p.type === 'movie' ? playMovie({ t: 'movie', id: p.id, name: p.name, icon: p.icon, ext: p.ext, bd: p.bd }, p.t) : resumeSeries(p);
  return makeCard({ kind: 'wide', name: p.name, sub, icon: p.bd || p.icon, pct, ok: go, long: () => sheet(p.name + (p.type === 'series' ? '\n' + p.label : ''), [
    { label: '▶ كمّل', cls: 'primary', cb: go },
    { label: 'شيل من كمّل المشاهدة', cls: 'danger', cb: () => { delete prog[progKey(p)]; store.set('prog', prog); toast('اتشال'); refreshTabs(); } },
    { label: 'إلغاء' }]) });
}
function favCard(it) {
  const c = itemCard(it);
  longPress(c, () => sheet(it.name, [
    { label: 'التفاصيل', cb: () => openDetails(it) },
    { label: 'شيل من المفضلة', cls: 'danger', cb: () => { delete favs[it.t][it.id]; store.set('fav', favs); toast('اتشال من المفضلة'); refreshTabs(); } },
    { label: 'إلغاء' }]));
  return c;
}
const ROW = 12;
function row(parent, title, opts = {}) {
  const r = h('section', 'row');
  const hd = h('div', 'row-h'), t = h('h3', '', title);
  if (opts.sub) t.appendChild(h('small', '', opts.sub));
  hd.appendChild(t);
  const all = h('button', 'all', 'عرض الكل ›'); all.style.display = 'none'; hd.appendChild(all);
  r.appendChild(hd);
  const sv = h('div', 'row-sv'); r.appendChild(sv);
  parent.appendChild(r);
  const api_ = {
    el: r,
    set(cards, more) {
      clear(sv); sv.scrollLeft = 0;
      r.classList.toggle('hidden', !cards.length);
      cards.forEach(c => sv.appendChild(c));
      all.style.display = more ? '' : 'none';
      if (more) all.onclick = more;
    },
    items(items, title2) {
      const cards = items.slice(0, ROW).map(itemCard);
      const more = items.length > ROW ? () => openGrid(title2 || title, items) : null;
      if (more) { const m = makeCard({ name: '' }); m.classList.add('more'); clear(m.firstChild); m.firstChild.textContent = 'عرض الكل\n(' + items.length + ')'; m.removeChild(m.lastChild); m.onclick = more; cards.push(m); }
      api_.set(cards, more);
    },
    title(tt) { t.firstChild.nodeValue = tt; },
    sub(s) { t.appendChild(h('small', '', s)); },
    hide() { r.classList.add('hidden'); }
  };
  return api_;
}
function lazyRow(parent, title, loader) {
  const r = row(parent, title);
  const sk = h('div', 'skel'); r.el.appendChild(sk);
  const ob = new IntersectionObserver(es => {
    if (!es[0].isIntersecting) return;
    ob.disconnect();
    loader(r).then(() => sk.remove(), () => { sk.remove(); r.hide(); });
  }, { rootMargin: '600px 0px' });
  ob.observe(r.el);
  return r;
}

// ================= hero (swipeable featured) =================
function hero(parent, kicker) {
  const el = h('section', 'hero'); el.style.display = 'none';
  const sv = h('div', 'hero-sv'), dots = h('div', 'dots');
  el.appendChild(sv); el.appendChild(dots);
  const top = h('div', 'hero-top');
  top.appendChild(h('div', 'brand', '')); top.firstChild.innerHTML = 'Hosam <b>TV</b>';
  const gear = h('button', 'icon-btn', '⚙'); gear.style.fontSize = '18px'; gear.onclick = openSettings; top.appendChild(gear);
  el.appendChild(top);
  parent.insertBefore(el, parent.firstChild);
  sv.addEventListener('scroll', () => {
    const i = Math.round(Math.abs(sv.scrollLeft) / sv.clientWidth);
    Array.from(dots.children).forEach((d, k) => d.classList.toggle('on', k === i));
  }, { passive: true });
  return {
    set(items) {
      items = items.slice(0, 6);
      el.style.display = items.length ? '' : 'none';
      clear(sv); clear(dots);
      items.forEach((it, i) => {
        const c = h('div', 'hero-card');
        const bg = h('img'); c.appendChild(bg);
        const post = h('img', 'post'); post.style.display = 'none'; c.appendChild(post);
        c.appendChild(h('div', 'shade'));
        const tx = h('div', 'hero-txt');
        tx.appendChild(h('div', 'k', kicker));
        tx.appendChild(h('h2', '', it.name));
        const m = h('div', 'm', metaLine(it)); tx.appendChild(m);
        const btns = h('div', 'btns');
        const play = h('button', 'btn primary', '▶ ' + (it.t === 'series' ? 'شاهد' : 'تشغيل'));
        play.onclick = () => it.t === 'movie' ? playMovie(it, 0) : openDetails(it);
        const more = h('button', 'btn', 'التفاصيل'); more.onclick = () => openDetails(it);
        btns.appendChild(play); btns.appendChild(more); tx.appendChild(btns);
        c.appendChild(tx);
        sv.appendChild(c);
        dots.appendChild(h('i', i === 0 ? 'on' : ''));
        const paint = () => {
          if (it.bd) { setImg(bg, it.bd, 'w780', 900, false); post.style.display = 'none'; }
          else if (it.icon) { setImg(bg, it.icon, 'w342', 342, true); setImg(post, it.icon, 'w342', 342, false); post.style.display = ''; }
        };
        paint();
        if (it.t === 'movie' && !it._info) vodInfo(it).then(inf => { it._info = inf; Object.assign(it, { plot: inf.plot, genre: inf.genre, year: inf.year, dur: inf.dur }); if (inf.bd) it.bd = inf.bd; m.textContent = metaLine(it); paint(); }).catch(() => {});
      });
    }
  };
}
function metaLine(it) {
  const m = [it.t === 'series' ? 'مسلسل' : 'فيلم'];
  if (it.year) m.push(it.year);
  if (it.genre) m.push(it.genre);
  if (it.rating) m.push('★ ' + it.rating.toFixed(1));
  return m.join(' · ');
}
function pickFeatured(items) {
  return items.filter(it => it.icon).sort((a, b) => b.added - a.added).slice(0, 12).sort((a, b) => b.rating - a.rating).slice(0, 6);
}

// ================= login =================
function showLogin(msg) {
  const c = cfg || DEFAULTS;
  $('in-server').value = c.server; $('in-user').value = c.user; $('in-pass').value = c.pass;
  $('login-msg').textContent = msg || ''; $('login-msg').className = 'msg' + (msg ? ' err' : '');
  on('main', false); on('login', true);
}
$('btn-login').onclick = function () {
  let s = $('in-server').value.trim().replace(/\/+$/, '');
  if (s && !/^https?:\/\//i.test(s)) s = 'http://' + s;
  const u = $('in-user').value.trim(), p = $('in-pass').value.trim();
  if (!s || !u || !p) { $('login-msg').textContent = 'كمّل البيانات الأول'; $('login-msg').className = 'msg err'; return; }
  cfg = { server: s, user: u, pass: p };
  $('login-msg').textContent = 'جاري الاتصال…'; $('login-msg').className = 'msg';
  loading(true);
  api('', null, true).then(d => {
    loading(false);
    if (!d || !d.user_info || String(d.user_info.auth) !== '1') throw new Error('اسم المستخدم أو كلمة السر غلط');
    account = d; store.set('cfg', cfg);
    on('login', false); startMain();
  }).catch(e => { loading(false); $('login-msg').textContent = e.message; $('login-msg').className = 'msg err'; });
};

// ================= tabs =================
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  movies: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5M16 4v5"/></svg>',
  series: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M8 2l4 4 4-4"/></svg>',
  live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>'
};
const TABS = [['home', 'الرئيسية'], ['movies', 'أفلام'], ['series', 'مسلسلات'], ['live', 'لايف'], ['search', 'بحث']];
const pages = {}; let curTab = null, built = false;
let syncOn = false;
function startSync() {
  if (syncOn || !window.HSync || !cfg) return;
  syncOn = true;
  window.HSync.start({
    get: () => ({ prog, ep: epProg, fav: favs }),
    set: st => { prog = st.prog; epProg = st.ep; favs = st.fav; store.set('prog', prog); store.set('ep', epProg); store.set('fav', favs); },
    changed: () => { refreshTabs(); refreshDetails(); }
  }, cfg.server + '|' + cfg.user + '|' + cfg.pass);
}
const syncNow = () => { if (window.HSync && syncOn) window.HSync.now(); };
function startMain() {
  startSync();
  on('main', true);
  if (!built) {
    built = true;
    const bar = $('tabbar'); clear(bar);
    TABS.forEach(([k, label]) => {
      const b = h('button', 'tab'); b.innerHTML = ICONS[k]; b.appendChild(h('span', '', label));
      b.onclick = () => { if (curTab === k) $('pg-' + k).scrollTo({ top: 0, behavior: 'smooth' }); else showTab(k); };
      b.id = 'tab-' + k; bar.appendChild(b);
    });
    pages.home = buildHome($('pg-home'));
    pages.movies = buildBrowse($('pg-movies'), 'movie');
    pages.series = buildBrowse($('pg-series'), 'series');
    pages.live = buildLive($('pg-live'));
    pages.search = buildSearch($('pg-search'));
  }
  showTab('home');
}
function showTab(k) {
  curTab = k;
  TABS.forEach(([t]) => { $('pg-' + t).classList.toggle('on', t === k); $('tab-' + t).classList.toggle('sel', t === k); });
  pages[k].enter();
}
function refreshTabs() { if (pages.home) pages.home.refresh(); }

// ---- home ----
function buildHome(el) {
  const hr = hero(el, 'مختارات');
  const cs = row(el, 'كمّل المسلسلات', { sub: 'اضغط مطوّل للحذف' });
  const cm = row(el, 'كمّل الأفلام', { sub: 'اضغط مطوّل للحذف' });
  const nm = row(el, 'أحدث الأفلام'), ns = row(el, 'أحدث المسلسلات');
  const fs = row(el, 'مسلسلاتك المفضلة'), fm = row(el, 'أفلامك المفضلة');
  [nm, ns].forEach(r => r.el.appendChild(h('div', 'skel')));
  let loaded = false;
  function newest(type) {
    return api(type === 'movie' ? 'get_vod_categories' : 'get_series_categories').then(c => {
      c = arr(c); if (!c.length) return null;
      return api(type === 'movie' ? 'get_vod_streams' : 'get_series', { category_id: c[0].category_id })
        .then(d => ({ cat: c[0].category_name, items: arr(d).map(type === 'movie' ? mkMovie : mkSeries).sort((a, b) => b.added - a.added) }));
    });
  }
  const refresh = () => {
    cs.set(contList('series').map(contCard)); cm.set(contList('movie').map(contCard));
    fs.set(favList('series').map(favCard)); fm.set(favList('movie').map(favCard));
  };
  return {
    refresh,
    enter() {
      refresh();
      if (loaded) return; loaded = true;
      newest('movie').then(r => { nm.el.querySelector('.skel').remove(); if (!r) return nm.hide(); nm.title(r.cat); nm.items(r.items, r.cat); hr.set(pickFeatured(r.items)); })
        .catch(e => { nm.hide(); toast(e.message); });
      newest('series').then(r => { ns.el.querySelector('.skel').remove(); if (!r) return ns.hide(); ns.title(r.cat); ns.items(r.items, r.cat); })
        .catch(() => ns.hide());
    }
  };
}

// ---- movies / series: hero + a row per category (rows load as you scroll) ----
function buildBrowse(el, type) {
  const head = h('div', 'page-head'); head.appendChild(h('h1', '', type === 'movie' ? 'أفلام' : 'مسلسلات'));
  el.appendChild(head);
  const hr = hero(el, type === 'movie' ? 'أفلام مختارة' : 'مسلسلات مختارة');
  let built_ = false;
  return {
    refresh() {},
    enter() {
      if (built_) return; built_ = true;
      loading(true);
      api(type === 'movie' ? 'get_vod_categories' : 'get_series_categories').then(cats => {
        loading(false);
        arr(cats).forEach((c, ci) => lazyRow(el, c.category_name, r =>
          api(type === 'movie' ? 'get_vod_streams' : 'get_series', { category_id: c.category_id }).then(d => {
            const items = arr(d).map(type === 'movie' ? mkMovie : mkSeries);
            if (!items.length) { r.hide(); return; }
            r.sub(items.length + '');
            r.items(items, c.category_name);
            if (ci === 0) { hr.set(pickFeatured(items)); head.style.display = 'none'; }
          })));
      }).catch(e => { loading(false); built_ = false; toast(e.message); });
    }
  };
}

// ---- live ----
function buildLive(el) {
  const top = h('div', 'live-chips'); top.appendChild(h('h1', '', 'قنوات لايف'));
  const chips = h('div', 'chips'); top.appendChild(chips); el.appendChild(top);
  const list = h('div'); el.appendChild(list);
  let built_ = false, token = 0, items = [];
  function render() {
    clear(list); el.scrollTop = 0;
    if (!items.length) { list.appendChild(h('div', 'empty', 'مفيش قنوات هنا')); return; }
    let n = 0;
    const more = () => {
      const end = Math.min(items.length, n + 60);
      for (; n < end; n++) {
        const i = n, ch = items[i], r = h('div', 'ch-row');
        const lg = h('div', 'ch-logo', String(i + 1)); lg.appendChild(img(ch.icon, null, 120)); r.appendChild(lg);
        const t = h('div', 'ch-t'); t.appendChild(h('b', '', ch.name)); const ep = h('span', '', ''); t.appendChild(ep); r.appendChild(t);
        const fv = h('button', 'ch-fav' + (isFav('live', ch.id) ? ' on' : ''), '★');
        fv.onclick = e => { e.stopPropagation(); toggleFav('live', ch); fv.classList.toggle('on', isFav('live', ch.id)); };
        r.appendChild(fv);
        r.onclick = () => playLive(items, i);
        epgObs.observe(r); r._ch = ch; r._ep = ep;
        list.appendChild(r);
      }
      if (n < items.length) { const s = h('div', '', ''); s.style.height = '1px'; list.appendChild(s); const o = new IntersectionObserver(es => { if (es[0].isIntersecting) { o.disconnect(); s.remove(); more(); } }, { rootMargin: '800px' }); o.observe(s); }
    };
    more();
  }
  const epgObs = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; epgObs.unobserve(e.target);
    const r = e.target;
    api('get_short_epg', { stream_id: r._ch.id, limit: 1 }).then(d => {
      const l = arr(d && d.epg_listings)[0];
      if (l) r._ep.textContent = 'الآن: ' + b64(l.title);
    }).catch(() => {});
  }), { rootMargin: '200px' });
  function pick(c, chip) {
    chips.querySelectorAll('.chip').forEach(x => x.classList.remove('sel')); chip.classList.add('sel');
    const my = ++token;
    if (c.id === '__fav') { items = favList('live'); render(); return; }
    loading(true);
    api('get_live_streams', { category_id: c.id }).then(d => { loading(false); if (my !== token) return; items = arr(d).map(mkLive); render(); })
      .catch(e => { loading(false); toast(e.message); });
  }
  return {
    refresh() {},
    enter() {
      if (built_) return; built_ = true;
      api('get_live_categories').then(d => {
        const cats = [{ id: '__fav', name: '★ المفضلة' }].concat(arr(d).map(c => ({ id: c.category_id, name: c.category_name })));
        cats.forEach(c => { const b = h('button', 'chip', c.name); b.onclick = () => pick(c, b); chips.appendChild(b); });
        if (cats[1]) pick(cats[1], chips.children[1]);
      }).catch(e => { built_ = false; toast(e.message); });
    }
  };
}

// ---- search (index saved on the phone) ----
function buildSearch(el) {
  const top = h('div', 'search-top'); top.appendChild(h('h1', '', 'بحث'));
  const input = h('input'); input.type = 'search'; input.placeholder = 'أفلام ومسلسلات…'; input.id = 'q';
  top.appendChild(input); el.appendChild(top);
  const msg = h('div', 's-msg', 'اكتب اسم فيلم أو مسلسل بالعربي أو الإنجليزي'); el.appendChild(msg);
  const res = h('div'); el.appendChild(res);
  let index = null, idxN = null, building = null, qT = null, lastQ = '';
  const key = () => 'idx:' + cfg.server + '|' + cfg.user;
  const setIndex = rows => { index = rows; idxN = rows.map(r => norm(r[2])); };
  const fromRow = r => r[0] === 0 ? { t: 'movie', id: r[1], name: r[2], icon: r[3], ext: r[4] || 'mp4', rating: r[5] || 0, added: r[6] || 0 } : { t: 'series', id: r[1], name: r[2], icon: r[3], rating: r[5] || 0, added: r[6] || 0 };
  function fetchFresh() {
    const rows = [];
    return api('get_vod_streams', null, true).then(d => arr(d).forEach(r => rows.push([0, r.stream_id, r.name || '', r.stream_icon || '', r.container_extension || 'mp4', parseFloat(r.rating) || 0, parseInt(r.added, 10) || 0])))
      .then(() => api('get_series', null, true)).then(d => arr(d).forEach(r => rows.push([1, r.series_id, r.name || '', r.cover || '', '', parseFloat(r.rating) || 0, parseInt(r.last_modified, 10) || 0])))
      .then(() => { idb.set(key(), { ts: Date.now(), rows }); return rows; });
  }
  function build() {
    if (index) return Promise.resolve();
    if (building) return building;
    building = idb.get(key()).then(saved => {
      if (saved && saved.rows && saved.rows.length) {
        setIndex(saved.rows);
        if (Date.now() - saved.ts > 12 * 3600e3) fetchFresh().then(setIndex).catch(() => {});
        return;
      }
      msg.textContent = 'بجهّز البحث لأول مرة بس… بعد كده هيبقى فوري';
      return fetchFresh().then(rows => { setIndex(rows); if (!lastQ) msg.textContent = 'اكتب اسم فيلم أو مسلسل'; });
    }).then(() => { building = null; }, e => { building = null; msg.textContent = e.message; throw e; });
    return building;
  }
  function run() {
    const q = norm(input.value.trim());
    if (q === lastQ) return; lastQ = q;
    clear(res);
    if (q.length < 2) { msg.textContent = 'اكتب حرفين على الأقل'; return; }
    build().then(() => {
      if (q !== lastQ) return;
      const words = q.split(/\s+/), mv = [], sr = [];
      for (let i = 0; i < index.length && (mv.length < 60 || sr.length < 60); i++) {
        const n = idxN[i]; if (!words.every(w => n.indexOf(w) >= 0)) continue;
        const o = fromRow(index[i]); o.n = n;
        (o.t === 'movie' ? mv : sr).length < 60 && (o.t === 'movie' ? mv : sr).push(o);
      }
      const rank = (a, b) => (a.n.indexOf(words[0]) === 0 ? 0 : 1) - (b.n.indexOf(words[0]) === 0 ? 0 : 1);
      mv.sort(rank); sr.sort(rank);
      clear(res);
      msg.textContent = (mv.length || sr.length) ? '' : 'مفيش نتائج لـ "' + input.value.trim() + '"';
      [['أفلام', mv], ['مسلسلات', sr]].forEach(([t, l]) => {
        if (!l.length) return;
        res.appendChild(h('div', 'sec-h', t));
        const g = h('div', 'grid'); l.forEach(it => g.appendChild(itemCard(it))); res.appendChild(g);
      });
    }).catch(() => {});
  }
  input.addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(run, 350); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { input.blur(); run(); } });
  return { refresh() {}, enter() { build().catch(() => {}); } };
}

// ================= see-all grid with search =================
const SORTS = ['الأحدث', 'التقييم', 'الاسم', 'الافتراضي'];
const gv = { items: [], norms: null, sort: 0, q: '' };
function openGrid(title, items) {
  Object.assign(gv, { items, norms: null, sort: 0, q: '' });
  $('gv-title').textContent = title; $('gv-sort').textContent = SORTS[0]; $('gv-q').value = '';
  push('gridv'); renderGrid();
}
function renderGrid() {
  let items = gv.items.slice();
  if (gv.q) {
    if (!gv.norms) gv.norms = gv.items.map(it => norm(it.name));
    const words = gv.q.split(/\s+/);
    items = gv.items.filter((it, i) => words.every(w => gv.norms[i].indexOf(w) >= 0));
  }
  if (gv.sort === 0) items.sort((a, b) => b.added - a.added);
  else if (gv.sort === 1) items.sort((a, b) => b.rating - a.rating);
  else if (gv.sort === 2) items.sort((a, b) => a.name.localeCompare(b.name));
  const box = $('gv-grid'); clear(box); $('gv-box').scrollTop = 0;
  $('gv-count').textContent = items.length + (gv.q ? ' نتيجة' : ' عنوان');
  if (!items.length) { box.appendChild(h('div', 'empty', gv.q ? 'مفيش نتائج في القسم ده' : 'مفيش محتوى')); return; }
  let n = 0;
  const more = () => {
    const end = Math.min(items.length, n + 45);
    for (; n < end; n++) box.appendChild(itemCard(items[n]));
    if (n < items.length) { const s = h('div'); s.style.gridColumn = '1 / -1'; box.appendChild(s); const o = new IntersectionObserver(es => { if (es[0].isIntersecting) { o.disconnect(); s.remove(); more(); } }, { root: $('gv-box'), rootMargin: '600px' }); o.observe(s); }
  };
  more();
}
$('gv-sort').onclick = () => { gv.sort = (gv.sort + 1) % SORTS.length; $('gv-sort').textContent = SORTS[gv.sort]; renderGrid(); };
let gvT = null;
$('gv-q').addEventListener('input', () => { clearTimeout(gvT); gvT = setTimeout(() => { gv.q = norm($('gv-q').value.trim()); renderGrid(); }, 250); });

// ================= details =================
const det = { it: null, ctx: null, season: null, token: 0 };
function openDetails(it) {
  det.it = it; det.ctx = null; det.season = null;
  const my = ++det.token;
  $('d-title').textContent = it.name; $('d-plot').textContent = it.plot || '';
  clear($('d-btns')); clear($('d-extra')); $('d-scroll').scrollTop = 0;
  detailBg(it);
  renderMeta(it);
  if (!vis('details')) push('details');
  if (it.t === 'movie') {
    movieButtons();
    vodInfo(it).then(inf => {
      if (my !== det.token) return;
      Object.assign(it, { plot: inf.plot, genre: inf.genre, year: inf.year, dur: inf.dur }); if (inf.rating) it.rating = inf.rating; if (inf.bd) it.bd = inf.bd;
      detailBg(it); $('d-plot').textContent = inf.plot || ''; renderMeta(it); infoBlock(inf.director, inf.cast);
    }).catch(() => {});
  } else {
    seriesButtons(null);
    loading(true);
    api('get_series_info', { series_id: it.id }).then(d => {
      loading(false); if (my !== det.token) return;
      const inf = (d && d.info && !Array.isArray(d.info)) ? d.info : {};
      it.plot = inf.plot || it.plot; it.genre = inf.genre || it.genre; it.year = String(inf.releaseDate || inf.release_date || it.year || '').slice(0, 4);
      if (parseFloat(inf.rating)) it.rating = parseFloat(inf.rating);
      const bd = first(inf.backdrop_path) || it.bd; if (bd) it.bd = bd;
      detailBg(it); $('d-plot').textContent = it.plot || ''; renderMeta(it);
      det.ctx = { sid: it.id, name: it.name, icon: it.icon, bd: it.bd, eps: parseEpisodes(d) };
      const p = prog['s:' + it.id];
      det.season = det.ctx.eps.length ? (p ? det.ctx.eps[indexOfId(det.ctx.eps, p.epId)].season : det.ctx.eps[0].season) : null;
      seriesButtons(det.ctx); drawEpisodes(); infoBlock(inf.director, inf.cast);
    }).catch(e => { loading(false); toast(e.message); });
  }
}
function detailBg(it) { const im = $('d-bg'); if (it.bd) setImg(im, it.bd, 'w780', 900, false); else setImg(im, it.icon, 'w342', 342, true); }
function renderMeta(it) {
  const m = $('d-meta'); clear(m);
  const parts = [it.genre, it.year, it.dur && it.dur !== '00:00:00' ? it.dur.replace(/^00:/, '') : ''].filter(Boolean);
  m.appendChild(document.createTextNode(parts.join(' · ') + ' '));
  if (it.rating) m.appendChild(h('span', 'rate', '★ ' + it.rating.toFixed(1)));
}
function infoBlock(director, cast) {
  if (!director && !cast) return;
  const box = h('div', 'd-info');
  if (director) { const r = h('div'); r.appendChild(h('b', '', 'إخراج')); r.appendChild(document.createTextNode(director)); box.appendChild(r); }
  if (cast) { const r = h('div'); r.appendChild(h('b', '', 'بطولة')); r.appendChild(document.createTextNode(cast)); box.appendChild(r); }
  $('d-extra').appendChild(box);
}
function favBtn(it) {
  const b = h('button', 'btn sq', isFav(it.t, it.id) ? '✓' : '+');
  b.onclick = () => { toggleFav(it.t, it); b.textContent = isFav(it.t, it.id) ? '✓' : '+'; };
  return b;
}
function movieButtons() {
  const it = det.it, box = $('d-btns'); clear(box);
  const p = prog['m:' + it.id];
  if (p && p.t > 30) {
    const b = h('button', 'btn primary', '▶ كمّل · باقي ' + mins(Math.max(0, p.d - p.t))); b.onclick = () => playMovie(it, p.t); box.appendChild(b);
    const r = h('button', 'btn sq', '↺'); r.onclick = () => playMovie(it, 0); box.appendChild(r);
  } else { const b = h('button', 'btn primary', '▶ تشغيل'); b.onclick = () => playMovie(it, 0); box.appendChild(b); }
  box.appendChild(favBtn(it));
}
function seriesButtons(ctx) {
  const it = det.it, box = $('d-btns'); clear(box);
  if (ctx && ctx.eps.length) {
    const p = prog['s:' + it.id];
    if (p) { const idx = indexOfId(ctx.eps, p.epId), e = ctx.eps[idx]; const b = h('button', 'btn primary', '▶ كمّل م' + e.season + ' · ح' + e.num); b.onclick = () => playEpisode(ctx, idx, p.t); box.appendChild(b); }
    else { const b = h('button', 'btn primary', '▶ شاهد الحلقة الأولى'); b.onclick = () => playEpisode(ctx, 0, 0); box.appendChild(b); }
  } else if (ctx) box.appendChild(h('div', 'muted', 'مفيش حلقات متاحة'));
  box.appendChild(favBtn(it));
}
function drawEpisodes() {
  const ctx = det.ctx; if (!ctx || !ctx.eps.length) return;
  const ex = $('d-extra'), info = ex.querySelector('.d-info'); clear(ex);
  const seasons = [...new Set(ctx.eps.map(e => e.season))];
  if (seasons.length > 1) {
    const ch = h('div', 'chips');
    seasons.forEach(n => { const b = h('button', 'chip' + (n === det.season ? ' sel' : ''), 'الموسم ' + n); b.onclick = () => { det.season = n; drawEpisodes(); }; ch.appendChild(b); });
    ex.appendChild(ch);
  }
  const list = h('div', 'ep-list');
  const p = prog['s:' + ctx.sid];
  ctx.eps.forEach((e, i) => {
    if (e.season !== det.season) return;
    const ep = epProg[e.id]; let pct = 0, sub = e.dur ? e.dur.replace(/^00:/, '') : '';
    if (ep && ep.d) { pct = ep.t / ep.d > 0.93 ? 100 : Math.round(ep.t / ep.d * 100); if (pct === 100) sub = 'اتشافت ✓'; }
    const r = h('div', 'ep' + (p && String(p.epId) === String(e.id) ? ' now' : ''));
    const c = makeCard({ kind: 'epc', name: '', icon: e.img || ctx.bd || ctx.icon, pct }); c.removeChild(c.lastChild); r.appendChild(c);
    const t = h('div', 'ep-t'); t.appendChild(h('b', '', e.num + '. ' + (e.title || 'الحلقة ' + e.num))); t.appendChild(h('span', '', sub)); r.appendChild(t);
    r.onclick = () => { const q = epProg[e.id]; playEpisode(ctx, i, (q && q.d && q.t / q.d < 0.93) ? q.t : 0); };
    list.appendChild(r);
  });
  ex.appendChild(list);
  if (info) ex.appendChild(info);
}
function parseEpisodes(d) {
  const eps = [], src = d && d.episodes;
  if (!src) return eps;
  Object.keys(src).forEach(k => arr(src[k]).forEach(e => {
    const inf = e.info || {};
    eps.push({ id: e.id, ext: e.container_extension || 'mp4', title: e.title || '', season: parseInt(e.season, 10) || parseInt(k, 10) || 1,
      num: parseInt(e.episode_num, 10) || 0, dur: inf.duration || '', img: inf.movie_image || '' });
  }));
  return eps.sort((a, b) => a.season - b.season || a.num - b.num);
}
function indexOfId(list, id) { for (let i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return i; return 0; }
function resumeSeries(p) {
  loading(true);
  api('get_series_info', { series_id: p.sid }).then(d => {
    loading(false);
    const ctx = { sid: p.sid, name: p.name, icon: p.icon, bd: p.bd, eps: parseEpisodes(d) };
    if (!ctx.eps.length) return toast('مفيش حلقات متاحة');
    playEpisode(ctx, indexOfId(ctx.eps, p.epId), p.t);
  }).catch(e => { loading(false); toast(e.message); });
}
function refreshDetails() {
  if (!vis('details') || !det.it) return;
  if (det.it.t === 'movie') movieButtons(); else if (det.ctx) { seriesButtons(det.ctx); drawEpisodes(); }
}

// ================= player =================
let playing = null;
function playLive(list, idx) {
  const ch = list[idx];
  startPlay({ kind: 'live', url: streamUrl('live', ch.id, 'm3u8'), title: ch.name, sub: 'لايف', item: ch, list, idx, start: 0 });
}
function playMovie(m, at) { startPlay({ kind: 'movie', url: streamUrl('movie', m.id, m.ext || 'mp4'), title: m.name, sub: 'فيلم', item: m, start: at || 0 }); }
function playEpisode(ctx, idx, at) {
  const e = ctx.eps[idx]; if (!e) return;
  startPlay({ kind: 'episode', url: streamUrl('series', e.id, e.ext), title: ctx.name, sub: 'الموسم ' + e.season + ' · الحلقة ' + e.num + (e.title ? ' · ' + e.title : ''), ctx, idx, item: e, start: at || 0 });
}
function startPlay(o) {
  playing = o;
  if (IN_APP) {
    const next = o.kind === 'episode' && o.ctx.eps[o.idx + 1];
    window.Android.play(JSON.stringify({ url: o.url, title: o.title, sub: o.sub, startMs: Math.round((o.start || 0) * 1000), live: o.kind === 'live', hasNext: !!next }));
  } else {
    const v = $('wvideo'); v.src = o.url; v.currentTime = 0;
    v.onloadedmetadata = () => { if (o.start > 0 && o.start < v.duration - 10) v.currentTime = o.start; };
    v.onended = () => { window.onPlayerResult({ pos: Math.round(v.currentTime * 1000), dur: Math.round(v.duration * 1000), ended: true }); };
    if (!vis('wplayer')) push('wplayer');
    v.play().catch(() => {});
  }
}
function webPlayerClose() { const v = $('wvideo'); if (playing && isFinite(v.duration)) saveProgress(playing, v.currentTime, v.duration); playing = null; }
function saveProgress(o, t, d) {
  if (!o || o.kind === 'live' || !isFinite(d) || d < 60 || t < 5) return;
  const done = t / d > 0.93;
  if (o.kind === 'movie') {
    const m = o.item;
    if (done) delete prog['m:' + m.id];
    else prog['m:' + m.id] = { type: 'movie', id: m.id, name: m.name, icon: m.icon, bd: m.bd || '', ext: m.ext, t, d, ts: Date.now() };
  } else {
    const e = o.item, ctx = o.ctx, next = ctx.eps[o.idx + 1];
    epProg[e.id] = { t, d }; store.set('ep', epProg);
    if (done && !next) delete prog['s:' + ctx.sid];
    else { const tg = done ? next : e; prog['s:' + ctx.sid] = { type: 'series', sid: ctx.sid, name: ctx.name, icon: ctx.icon, bd: tg.img || ctx.bd || '', epId: tg.id, t: done ? 0 : t, d, label: 'م' + tg.season + ' · ح' + tg.num, ts: Date.now() }; }
  }
  store.set('prog', prog);
}
// called by the native player when it closes: {pos, dur, ended, next}
window.onPlayerResult = function (r) {
  const o = playing; if (!o) return;
  saveProgress(o, (r.pos || 0) / 1000, (r.dur || 0) / 1000);
  if ((r.ended || r.next) && o.kind === 'episode' && o.ctx.eps[o.idx + 1]) { toast('الحلقة التالية'); playEpisode(o.ctx, o.idx + 1, 0); return; }
  if (r.error) toast('تعذر التشغيل: ' + r.error);
  playing = null;
  setTimeout(syncNow, 300);
  if (vis('wplayer')) { stack.splice(stack.indexOf('wplayer'), 1); on('wplayer', false); }
  refreshDetails(); refreshTabs();
};

// ================= settings =================
function openSettings() {
  const box = $('acct'); clear(box);
  const u = (account && account.user_info) || {}, exp = parseInt(u.exp_date, 10);
  const d = exp ? new Date(exp * 1000) : null;
  ['المستخدم: ' + (u.username || cfg.user), 'الحالة: ' + (u.status || '—'), 'ينتهي: ' + (d ? d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) : '—'),
    'عدد الأجهزة المسموح: ' + (u.max_connections || '—'), 'السيرفر: ' + cfg.server, window.HSync ? window.HSync.status() : ''].forEach(l => box.appendChild(h('div', '', l)));
  push('settings');
}
$('s-clear').onclick = () => sheet('تمسح سجل المشاهدة؟', [{ label: 'امسح', cls: 'danger', cb: () => { prog = {}; epProg = {}; store.set('prog', prog); store.set('ep', epProg); toast('اتمسح'); refreshTabs(); } }, { label: 'إلغاء' }]);
$('s-cache').onclick = () => { idb.clear('img'); toast('الصور المحفوظة اتمسحت'); };
$('s-logout').onclick = () => sheet('تسجّل الخروج؟', [{ label: 'خروج', cls: 'danger', cb: () => { localStorage.removeItem('cfg'); location.reload(); } }, { label: 'إلغاء' }]);

// ================= boot =================
if (cfg) {
  loading(true);
  api('', null, true).then(d => {
    loading(false);
    if (!d || !d.user_info || String(d.user_info.auth) !== '1') return showLogin('بيانات الدخول مش شغالة، راجعها');
    account = d; startMain();
  }).catch(e => {
    loading(false);
    // offline or server down: still open with the saved lists
    toast(e.message); startMain();
  });
} else showLogin('');

})();
