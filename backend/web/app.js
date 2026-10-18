/* Plain static client. All authoritative scores, messages, auth and merges come from the server. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const read = (key, fallback) => { try { return JSON.parse(sessionStorage.getItem(key)) || fallback; } catch (_) { return fallback; } };
  const save = (key, value) => { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* Private browsing can disable storage. */ } };
  const initialToken = read('skorly.guest-token', 'guest_anon_tok_7721');
  const state = { guestToken: initialToken, member: null, cart: read('skorly.guest-cart:' + initialToken, []), matchId: null, room: null, version: -1, source: null, poll: null, chatPoll: null, fetching: false, chatFetching: false, playback: null, hls: null, chatKeys: new Set(), dialogReturn: null, dialogMedia: null, closed: false };
  if (!Array.isArray(state.cart)) state.cart = [];
  state.cart = state.cart.filter((i) => i && i.variant_id === 'var-jersey-001-L' && Number.isSafeInteger(i.quantity) && i.quantity > 0);
  const video = $('video');
  const api = async (path, options) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const headers = { Accept: 'application/json', Authorization: 'Bearer ' + (options && options.authToken || (state.member ? state.member.token : state.guestToken)) };
      if (options && options.body) headers['Content-Type'] = 'application/json';
      const requestOptions = Object.assign({}, options); delete requestOptions.authToken;
      const response = await fetch(path, Object.assign(requestOptions, { headers, signal: controller.signal, cache: 'no-store' }));
      let body;
      try { body = await response.json(); } catch (_) { body = {}; }
      if (!response.ok) { const error = new Error(body.error && body.error.message || 'Request failed (' + response.status + ').'); error.status = response.status; error.code = body.error && body.error.code; throw error; }
      return body;
    } finally { clearTimeout(timeout); }
  };
  function renderCart() {
    const count = state.member && state.member.cartCount !== undefined ? state.member.cartCount : state.cart.reduce((sum, item) => sum + item.quantity, 0);
    $('cart-count').textContent = String(count);
  }
  function rememberCart() { save('skorly.guest-cart:' + state.guestToken, state.cart); renderCart(); }
  function mediaURL(value) {
    if (!value) return null;
    try { const url = new URL(value, location.origin); return /^(https?:)$/.test(url.protocol) ? url.href : null; } catch (_) { return null; }
  }
  function setPlayback(value) {
    const url = mediaURL(value);
    if (!url || url === state.playback) return;
    state.playback = url;
    if (state.hls) { state.hls.destroy(); state.hls = null; }
    if (window.Hls && window.Hls.isSupported() && /\.m3u8(?:[?#]|$)/i.test(url) && !video.canPlayType('application/vnd.apple.mpegurl')) {
      state.hls = new window.Hls({ lowLatencyMode: true, backBufferLength: 30, maxBufferLength: 10 });
      state.hls.loadSource(url); state.hls.attachMedia(video);
      state.hls.on(window.Hls.Events.ERROR, function (_, data) { if (data.fatal) { $('video-empty').hidden = false; $('video-status').textContent = 'The broadcast is unavailable. Waiting for the broadcaster to reconnect.'; } });
    } else { video.src = url; }
    video.play().catch(() => { $('video-status').textContent = 'Press Play to start the stream.'; });
  }
  function appendMessages(messages) {
    if (!Array.isArray(messages)) return;
    messages.forEach((message) => {
      if (!message || typeof message.text !== 'string' || message.blocked || message.dropped || message.reason === 'flood_character_repeat' || message.reason === 'rate_limit_exceeded') return;
      const key = String(message.message_id || message.id || String(message.sequence) + ':' + String(message.sender) + ':' + message.text);
      if (state.chatKeys.has(key)) return;
      state.chatKeys.add(key);
      $('chat-empty').hidden = true;
      const row = document.createElement('div'); row.className = 'chat-message'; row.dataset.messageId = key;
      const author = document.createElement('strong'); author.textContent = String(message.sender_name || message.sender || 'Club member');
      const text = document.createElement('p'); text.textContent = message.text;
      row.append(author, text); $('chat-list').append(row);
      if (state.chatKeys.size > 150) { const first = $('chat-list').querySelector('.chat-message'); if (first) { state.chatKeys.delete(first.dataset.messageId); first.remove(); } }
      $('chat-list').scrollTop = $('chat-list').scrollHeight;
    });
  }
  function applySnapshot(payload) {
    if (!payload || typeof payload !== 'object') return;
    const data = payload.data || payload.match || payload;
    if (data.guest_token && typeof data.guest_token === 'string' && data.guest_token.startsWith('guest_')) {
      if (data.guest_token !== state.guestToken) {
        state.guestToken = data.guest_token; save('skorly.guest-token', state.guestToken); rememberCart();
      }
    }
    const score = data.score && typeof data.score === 'object' ? data.score : data;
    const numeric = (side) => typeof side === 'number' ? side : side && side.score;
    const home = numeric(score.home), away = numeric(score.away);
    const version = Number(data.version);
    if (home !== undefined && away !== undefined && home !== null && away !== null && (!Number.isFinite(version) || version >= state.version)) {
      $('score').textContent = String(home) + ' - ' + String(away);
      if (Number.isFinite(version)) state.version = version;
    } else if (typeof data.score === 'string' && /^\d+\s*-\s*\d+$/.test(data.score)) { $('score').textContent = data.score; }
    if (data.home && (data.home.name || data.home.team_id)) $('home-name').textContent = data.home.name || data.home.team_id;
    if (data.away && (data.away.name || data.away.team_id)) $('away-name').textContent = data.away.name || data.away.team_id;
    if (data.title || data.name) $('page-title').textContent = data.title || data.name;
    setPlayback(data.composite_playback_url || data.playback_url || data.hls_url || (data.stream && (data.stream.playback_url || data.stream.hls_url)));
    if (data.chat_room_id) state.room = data.chat_room_id;
    appendMessages(data.filtered_messages || data.messages || (data.chat && data.chat.messages));
    if (data.message && typeof data.message === 'object') appendMessages([data.message]);
    if (data.pinned_merchandise) applyProduct(Array.isArray(data.pinned_merchandise) ? data.pinned_merchandise[0] : data.pinned_merchandise);
  }
  function applyProduct(product) {
    if (!product) return;
    if (product.name) $('product-name').textContent = product.name;
    if (product.description) $('product-description').textContent = product.description;
    const variant = (product.variants || []).find((item) => item.variant_id === 'var-jersey-001-L') || product;
    const price = variant.price_minor !== undefined ? variant.price_minor : variant.unit_price_minor;
    if (typeof price === 'number') $('product-price').textContent = new Intl.NumberFormat('en-PK', { style: 'currency', currency: variant.currency || 'PKR' }).format(price / 100);
  }
  async function fetchScore() {
    if (state.fetching || !state.matchId || state.closed) return;
    state.fetching = true;
    try { applySnapshot(await api('/api/v1/matches/' + encodeURIComponent(state.matchId))); $('page-feedback').textContent = ''; }
    catch (error) { $('page-feedback').textContent = 'Score unavailable: ' + error.message; }
    finally { state.fetching = false; }
  }
  function beginPolling() { if (!state.poll && !state.closed) { $('connection-status').textContent = 'Score feed · polling'; fetchScore(); state.poll = setInterval(fetchScore, 300); } }
  function connectScore(id) {
    if (state.source) state.source.close();
    if (state.poll) clearInterval(state.poll); state.poll = null;
    state.matchId = id; state.version = -1; fetchScore();
    if (!window.EventSource) { beginPolling(); return; }
    const source = new EventSource('/api/v1/matches/' + encodeURIComponent(id) + '/stream');
    state.source = source;
    source.onopen = () => { $('connection-status').textContent = 'Score feed · connected'; if (state.poll) clearInterval(state.poll); state.poll = null; };
    const receive = (event) => { try { applySnapshot(JSON.parse(event.data)); } catch (_) { $('connection-status').textContent = 'Waiting for a valid score update'; } };
    source.onmessage = receive;
    ['score', 'score_update', 'match', 'match_update', 'update', 'chat'].forEach((name) => source.addEventListener(name, receive));
    source.onerror = beginPolling;
  }
  async function fetchChat() {
    if (!state.room || state.chatFetching || state.closed) return;
    state.chatFetching = true;
    try { const data = await api('/api/v1/chat?chat_room_id=' + encodeURIComponent(state.room)); appendMessages(Array.isArray(data) ? data : data.filtered_messages || data.messages); }
    catch (_) { /* Chat history is optional until its read endpoint is available; no fake messages. */ }
    finally { state.chatFetching = false; }
  }
  function openAuth(trigger) {
    if (!$('auth-modal').hidden) return;
    state.dialogReturn = trigger || document.activeElement;
    state.dialogMedia = { time: Number.isFinite(video.currentTime) ? video.currentTime : 0, playing: !video.paused };
    video.pause();
    $('auth-cart-note').textContent = state.cart.reduce((n, item) => n + item.quantity, 0) + ' item(s) saved in your guest cart.';
    $('auth-error').textContent = ''; $('auth-modal').hidden = false;
    $('main').inert = true; document.body.classList.add('modal-open'); $('email').focus();
  }
  function closeAuth() {
    $('auth-modal').hidden = true; $('main').inert = false; document.body.classList.remove('modal-open');
    if (state.dialogMedia) { try { video.currentTime = state.dialogMedia.time; } catch (_) { /* No seekable media yet. */ } if (state.dialogMedia.playing) video.play().catch(() => {}); }
    if (state.dialogReturn && state.dialogReturn.isConnected) state.dialogReturn.focus();
  }
  $('auth-close').addEventListener('click', closeAuth); $('keep-watching').addEventListener('click', closeAuth);
  $('auth-modal').addEventListener('click', (event) => { if (event.target === $('auth-modal')) closeAuth(); });
  document.addEventListener('keydown', (event) => {
    if ($('auth-modal').hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closeAuth(); }
    if (event.key === 'Tab') {
      const controls = Array.from($('auth-modal').querySelectorAll('button,input,a[href]')).filter((node) => !node.disabled && node.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  $('add-cart').addEventListener('click', () => {
    if (state.member) { $('cart-note').textContent = 'Your staged items are now saved in your member cart.'; return; }
    const item = state.cart.find((entry) => entry.variant_id === 'var-jersey-001-L');
    if (item) item.quantity += 1; else state.cart.push({ variant_id: 'var-jersey-001-L', quantity: 1 });
    rememberCart(); $('cart-note').textContent = 'Added to your guest cart. Keep watching or sign in at checkout.';
  });
  $('checkout').addEventListener('click', () => { if (!state.cart.length && !state.member) { $('cart-note').textContent = 'Add an item first to continue to checkout.'; return; } if (state.member) $('cart-note').textContent = 'Your cart is saved to your member account.'; else openAuth($('checkout')); });
  $('chat-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = $('chat-input').value.trim(); if (!text) { $('chat-feedback').textContent = 'Write a message first.'; $('chat-input').focus(); return; }
    $('chat-send').disabled = true; $('chat-feedback').textContent = 'Sending for moderation…';
    try {
      const data = await api('/api/v1/chat', { method: 'POST', body: JSON.stringify({ chat_room_id: state.room, message_id: 'web-' + Date.now() + '-' + Math.random().toString(16).slice(2), text }) });
      if (state.member) { appendMessages(data.filtered_messages || data.messages || (data.message ? [data.message] : [])); $('chat-input').value = ''; $('chat-feedback').textContent = 'Message submitted for moderation.'; }
      else { $('chat-feedback').textContent = 'The server accepted a guest write unexpectedly. Your message was not added here.'; }
    } catch (error) {
      if (error.status === 403 && error.code === 'GUEST_WRITE_FORBIDDEN') { $('chat-feedback').textContent = 'Sign in to join the conversation. Your message has not been posted.'; openAuth($('chat-send')); }
      else $('chat-feedback').textContent = 'Message not sent: ' + error.message;
    } finally { $('chat-send').disabled = false; }
  });
  $('auth-form').addEventListener('submit', async (event) => {
    event.preventDefault(); $('auth-submit').disabled = true; $('auth-error').textContent = '';
    try {
      const login = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value }) });
      if (!login.token) throw new Error('The server did not return a member token.');
      const user = login.user || {};
      const userId = login.registered_user_id || user.player_id || user.id;
      if (state.cart.length && !userId) throw new Error('The server did not identify the cart owner.');
      const member = { token: login.token, cartCount: 0 };
      if (state.cart.length) {
        const merged = await api('/audit/v1/guest/cart-merge', { method: 'POST', authToken: login.token, body: JSON.stringify({ guest_token: state.guestToken, registered_user_id: userId, guest_cart: state.cart, test_write_block: true }) });
        if (!merged.cart_merged || !merged.active_cart) throw new Error('The server has not confirmed the cart merge. Your staged cart is kept.');
        member.cartCount = merged.active_cart.total_items; state.cart = []; rememberCart();
      }
      state.member = member; renderCart(); $('password').value = ''; closeAuth();
      $('chat-feedback').textContent = 'Signed in. You can now submit your message.'; $('cart-note').textContent = 'Your cart is saved to your member account.';
    } catch (error) { $('auth-error').textContent = error.message + ' Your staged cart is kept. Retry with the same account if the connection was lost.'; }
    finally { $('auth-submit').disabled = false; }
  });
  $('play-toggle').addEventListener('click', () => { if (video.paused) video.play().catch(() => { $('video-status').textContent = 'Playback is not available yet. The broadcaster may be offline.'; }); else video.pause(); });
  $('mute-toggle').addEventListener('click', () => { video.muted = !video.muted; $('mute-toggle').textContent = video.muted ? 'Unmute' : 'Mute'; $('mute-toggle').setAttribute('aria-label', video.muted ? 'Unmute video' : 'Mute video'); $('mute-toggle').setAttribute('aria-pressed', String(video.muted)); });
  $('fullscreen').addEventListener('click', () => { const action = video.requestFullscreen || video.webkitEnterFullscreen; if (action) { try { const result = action.call(video); if (result && result.catch) result.catch(() => {}); } catch (_) {} } });
  video.addEventListener('playing', () => { $('video-empty').hidden = true; $('play-toggle').textContent = 'Pause'; $('play-toggle').setAttribute('aria-label', 'Pause video'); });
  video.addEventListener('pause', () => { $('play-toggle').textContent = 'Play'; $('play-toggle').setAttribute('aria-label', 'Play video'); });
  video.addEventListener('error', () => { $('video-empty').hidden = false; $('video-status').textContent = 'Stream unavailable. The broadcaster may be reconnecting.'; });
  async function loadProfile(kind, id) {
    $('watch-layout').hidden = true; $('profile-panel').hidden = false; $('route-badge').textContent = 'PUBLIC ' + kind.toUpperCase();
    $('profile-title').textContent = id; $('page-title').textContent = kind === 'player' ? 'The people behind the game.' : 'A club. A community.';
    try {
      const data = await api('/api/v1/' + (kind === 'player' ? 'players/' : 'clubs/') + encodeURIComponent(id));
      $('profile-title').textContent = data.name || data.display_name || id; $('profile-description').textContent = data.description || 'Public ' + kind + ' profile';
      ['club_affiliations', 'career_records', 'upcoming_fixtures', 'vod_archive', 'roster', 'staff'].forEach((field) => {
        if (!Array.isArray(data[field])) return;
        const heading = document.createElement('h3'); heading.textContent = field.replace(/_/g, ' ');
        const list = document.createElement('ul');
        if (!data[field].length) { const li = document.createElement('li'); li.textContent = 'No entries yet.'; list.append(li); }
        data[field].forEach((entry) => { const li = document.createElement('li'); li.textContent = typeof entry === 'string' ? entry : entry.name || entry.title || entry.player_id || entry.match_id || entry.club_id || 'Club record'; list.append(li); });
        $('profile-details').append(heading, list);
      });
    } catch (error) { $('profile-description').textContent = 'Profile unavailable: ' + error.message; }
  }
  async function route() {
    const parts = location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    if (parts[0] !== 'web') { $('page-title').textContent = 'This page belongs at /web/.'; return; }
    let id; try { id = decodeURIComponent(parts[2] || 'match-m1'); } catch (_) { id = 'invalid-link'; }
    if (parts[1] === 'players' || parts[1] === 'clubs') { await loadProfile(parts[1] === 'players' ? 'player' : 'club', id); return; }
    const view = parts[3] || 'live', co = parts[1] === 'costream';
    if (parts[1] && parts[1] !== 'matches' && !co) { $('watch-layout').hidden = true; $('page-title').textContent = 'This matchday link was not found.'; return; }
    if (!co && !['live','preview','vod','notice'].includes(view)) { $('watch-layout').hidden = true; $('page-title').textContent = 'This match view was not found.'; return; }
    state.room = 'chat-' + id;
    $('route-badge').textContent = co ? 'CO-STREAM' : view === 'vod' ? 'MATCH REPLAY' : view === 'preview' ? 'MATCH PREVIEW' : view === 'notice' ? 'MATCH UPDATE' : 'LIVE MATCH';
    $('stream-label').textContent = co ? 'THE SHARED STREAM' : view === 'vod' ? 'MATCH REPLAY' : 'MATCH STREAM';
    if (view === 'preview' || view === 'notice') {
      $('route-notice').hidden = false;
      $('notice-title').textContent = view === 'preview' ? 'The best is still to come.' : 'An update from the club.';
      const status = new URLSearchParams(location.search).get('state') || 'postponed';
      $('notice-text').textContent = view === 'preview' ? 'This match has not started yet. Keep this link for the live broadcast.' : 'This match is ' + status + '. Keep this link for the latest club update.';
      $('video-empty-title').textContent = view === 'preview' ? 'Kick-off is on the way.' : 'Play is on hold.';
    }
    if (co) {
      $('page-title').textContent = 'One game. Every perspective.';
      connectScore('match-m1');
      try { const data = await api('/api/v1/costream/' + encodeURIComponent(id)); applySnapshot(data); if (data.match_id && data.match_id !== state.matchId) connectScore(data.match_id); }
      catch (error) { $('page-feedback').textContent = 'Co-stream details unavailable: ' + error.message; }
    } else connectScore(id);
    fetchChat(); state.chatPoll = setInterval(fetchChat, 1000);
    api('/api/v1/products').then((data) => applyProduct((data.products || []).find((product) => product.product_id === 'prod-jersey-001'))).catch(() => {});
  }
  function dispose() { state.closed = true; if (state.source) state.source.close(); clearInterval(state.poll); clearInterval(state.chatPoll); if (state.hls) state.hls.destroy(); }
  window.addEventListener('pagehide', dispose);
  window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
  renderCart(); route().catch((error) => { $('page-feedback').textContent = error.message; });
})();

