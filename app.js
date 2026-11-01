// Screens and buttons for the single-phone offer app. Rules and storage live in core.js.
(function () {
  // The page and this script must come from the same release. If the phone mixed an old saved
  // page with new code (or the reverse), reload once to fetch a matching set.
  const BUILD = '10';
  const pageBuild = (document.querySelector('meta[name="app-build"]') || {}).content;
  if (pageBuild !== BUILD) {
    let reloaded = false;
    try { reloaded = sessionStorage.getItem('sq7-reloaded') === BUILD; sessionStorage.setItem('sq7-reloaded', BUILD); } catch (e) { /* ignore */ }
    if (!reloaded) { location.reload(); return; }
  }

  const C = window.Core;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let store;
  try { store = window.localStorage; store.getItem('x'); } catch (e) { store = null; }
  const memory = { v: null, getItem() { return this.v; }, setItem(k, v) { this.v = v; } };
  let state = C.load(store || memory);

  // Ask the browser not to clear this app's data when the phone is low on space
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  function persist() {
    try {
      C.save(store || memory, state);
      return true;
    } catch (e) {
      $('formErr').textContent = 'Could not save on this phone. Free some space, then save a backup.';
      return false;
    }
  }

  const igUrl = () => state.settings.instagramId ? `https://instagram.com/${state.settings.instagramId}` : '';

  function qrSvg(text) {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch (e) {
      return '';
    }
  }

  // ---------- Header & customer screen ----------

  let follow = { wa: false, ig: false };
  let current = null; // token being shown on the token screen

  function renderHeader() {
    const st = C.campaignStatus(state);
    $('shopName').textContent = state.settings.shopName;
    document.title = state.settings.shopName;
    $('statusLine').textContent = st.active ? `${st.message} · ${C.niceDate(C.todayStr())}` : st.message;
  }

  function renderCustomer() {
    renderHeader();
    const st = C.campaignStatus(state);
    $('closedCard').classList.toggle('hidden', st.active);
    $('openArea').classList.toggle('hidden', !st.active);
    if (!st.active) {
      $('closedTitle').textContent = st.message;
      const dates = C.campaignDates(state);
      $('closedNote').textContent = `Campaign: ${C.niceDate(dates[0])} to ${C.niceDate(dates[dates.length - 1])}`;
    }

    // Prize list for today, hiding prizes whose numbers are all gone
    const next = C.nextSerial(state);
    const open = C.parsePrizeRules(state.settings.prizeRules).filter(p => p.to >= next);
    $('prizeBanner').innerHTML = open.length
      ? open.map(p => `<div class="prize-line"><span>${p.from === p.to ? 'Token #' + p.from : `Tokens #${p.from}–${p.to}`}</span><b>${esc(p.prize)}</b></div>`).join('')
      : `<div class="prize-line"><span>Today's offer</span><b>${esc(state.settings.offerTitle)}</b></div>`;
    $('prizeBanner').classList.toggle('hidden', !st.active);

    const { offer } = C.offerFor(state, next);
    $('nextInfo').textContent = `#${next} · ${offer}`;

    // QR codes
    const ch = state.settings.channelUrl;
    $('qrWa').innerHTML = ch ? qrSvg(ch) : 'Add the WhatsApp link in Settings';
    $('qrWa').classList.toggle('empty', !ch);
    const ig = igUrl();
    $('qrIg').innerHTML = ig ? qrSvg(ig) : 'Add your Instagram ID in Settings';
    $('qrIg').classList.toggle('empty', !ig);
    $('igName').textContent = ig ? '@' + state.settings.instagramId : 'Instagram';
    $('tIg').disabled = !ig;
    renderFollow();
  }

  function renderFollow() {
    $('tileWa').classList.toggle('done', follow.wa);
    $('tileIg').classList.toggle('done', follow.ig);
    $('tWa').textContent = follow.wa ? 'Followed ✓' : 'Followed?';
    $('tIg').textContent = follow.ig ? 'Followed ✓' : 'Followed?';
    checkForm();
  }

  function checkForm() {
    const phone = C.normalizePhone($('cPhone').value);
    const dup = phone && C.findByPhone(state, phone);
    $('dupWarn').classList.toggle('hidden', !dup);
    if (dup) $('dupWarn').textContent = '⚠ ' + C.alreadyMessage(state, dup);
    const needIg = Boolean(state.settings.instagramId);
    $('giveBtn').disabled = !($('cName').value.trim() && phone && !dup && follow.wa && (follow.ig || !needIg));
  }

  function resetForm() {
    $('cName').value = $('cPhone').value = '';
    $('formErr').textContent = '';
    follow = { wa: false, ig: false };
    renderCustomer();
  }

  $('cName').addEventListener('input', checkForm);
  $('cPhone').addEventListener('input', checkForm);
  $('tWa').addEventListener('click', () => { follow.wa = !follow.wa; renderFollow(); });
  $('tIg').addEventListener('click', () => { follow.ig = !follow.ig; renderFollow(); });

  $('giveBtn').addEventListener('click', () => {
    const res = C.issue(state, { name: $('cName').value, phone: $('cPhone').value });
    if (res.error) { $('formErr').textContent = res.error; return; }
    if (!persist()) { C.cancel(state, res.entry.token); return; }
    showToken(res.entry);
  });

  // ---------- Photos & videos (kept in IndexedDB; too large for localStorage) ----------

  const Media = (() => {
    let opening, seq = 0;
    const db = () => opening || (opening = new Promise((resolve, reject) => {
      const req = indexedDB.open('sq7-media', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
    async function run(mode, fn) {
      const d = await db();
      return new Promise((resolve, reject) => {
        const t = d.transaction('files', mode);
        const req = fn(t.objectStore('files'));
        t.oncomplete = () => resolve(req.result);
        t.onerror = t.onabort = () => reject(t.error || new Error('Phone storage is full'));
      });
    }
    return {
      list: () => run('readonly', s => s.getAll()).then(all => all.sort((a, b) => a.addedAt - b.addedAt)),
      add: file => run('readwrite', s => s.put({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: file.name, type: file.type, size: file.size, blob: file, addedAt: Date.now() * 1000 + (seq++ % 1000), // keeps the order they were picked
      })),
      remove: id => run('readwrite', s => s.delete(id)),
    };
  })();

  // Ready-made File objects, so tapping Send can open the share screen instantly
  // (it only opens straight from a tap, with no slow work in between)
  let mediaFiles = [];

  async function refreshMedia() {
    try {
      const items = await Media.list();
      mediaFiles = items.map(m => new File([m.blob], m.name, { type: m.type }));
      return items;
    } catch (e) {
      mediaFiles = [];
      return [];
    }
  }

  const sendsMedia = () => Boolean(mediaFiles.length && navigator.canShare && navigator.canShare({ files: mediaFiles }));

  function renderMediaList(items) {
    const list = $('mediaList');
    list.querySelectorAll('img, video').forEach(el => URL.revokeObjectURL(el.src));
    list.innerHTML = '';
    for (const m of items) {
      const box = document.createElement('div');
      box.className = 'thumb';
      const view = document.createElement(m.type.startsWith('video/') ? 'video' : 'img');
      view.src = URL.createObjectURL(m.blob);
      if (view.tagName === 'VIDEO') { view.muted = true; view.preload = 'metadata'; }
      const mb = m.size / 1048576;
      const tooBig = m.type.startsWith('video/') && mb > 16;
      box.append(view);
      box.insertAdjacentHTML('beforeend', `<span class="tag${tooBig ? ' big' : ''}">${m.type.startsWith('video/') ? '▶ ' : ''}${mb.toFixed(1)} MB</span>
        <button class="del" data-del="${m.id}" aria-label="Remove">✕</button>`);
      list.append(box);
    }
    const total = items.reduce((n, m) => n + m.size, 0) / 1048576;
    const msg = $('mediaMsg');
    msg.className = 'msg';
    msg.textContent = !items.length ? 'No photos or videos yet.'
      : `${items.length} file${items.length > 1 ? 's' : ''} · ${total.toFixed(1)} MB${total > 64 ? ' — large; WhatsApp may take time to send' : ''}`
        + (sendsMedia() ? '' : ' · This phone cannot attach files from the app, so only the message will be sent.');
  }

  async function loadMediaSettings() {
    renderMediaList(await refreshMedia());
  }

  $('addMediaBtn').addEventListener('click', () => $('mediaFile').click());
  $('mediaFile').addEventListener('change', async () => {
    const files = [...$('mediaFile').files];
    $('mediaFile').value = '';
    const rejected = [];
    for (const f of files) {
      if (!/^(image|video)\//.test(f.type) || (navigator.canShare && !navigator.canShare({ files: [f] }))) { rejected.push(f.name); continue; }
      try { await Media.add(f); } catch (e) { rejected.push(`${f.name} (${e.message})`); }
    }
    await loadMediaSettings();
    if (rejected.length) {
      $('mediaMsg').className = 'msg err';
      $('mediaMsg').textContent = `Not added: ${rejected.join(', ')}. Use JPG/PNG photos and MP4 videos.`;
    }
  });

  $('mediaList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.textContent = 'Remove?';
      setTimeout(() => { if (btn.isConnected) { btn.classList.remove('armed'); btn.textContent = '✕'; } }, 4000);
      return;
    }
    await Media.remove(btn.dataset.del);
    loadMediaSettings();
  });

  // ---------- Token screen ----------

  // One WhatsApp message with the token and every shop link that's been set.
  // WhatsApp previews only the first link, so the offer photos link goes first.
  function tokenMessage(t) {
    const s = state.settings;
    const lines = [
      `*${s.shopName}*`,
      `Hi ${t.name}, thank you for following us! 🙏`,
      '',
      `🎟️ Token: *#${t.serial}* (${t.token})`,
      `🎁 Prize: *${t.offer}*`,
      `📅 Day ${t.day} · ${C.niceDate(t.date)}`,
    ];
    const links = [
      s.offerLink && `🛍️ Today's offers (photos & videos): ${s.offerLink}`,
      s.instagramId && `📸 Instagram: ${igUrl()}`,
      s.channelUrl && `💬 Join us on WhatsApp: ${s.channelUrl}`,
      s.whatsappNumber && `📞 Call / WhatsApp: +${s.whatsappNumber}`,
    ].filter(Boolean);
    if (links.length) lines.push('', ...links);
    return lines.join('\n');
  }

  function showToken(t) {
    current = t;
    $('tDay').textContent = `Day ${t.day} · ${C.niceDate(t.date)} · Token number`;
    $('tNo').textContent = '#' + t.serial;
    $('tPrize').textContent = t.prize ? `🎉 ${t.offer}` : t.offer;
    $('tCode').textContent = t.token;
    $('tName').textContent = t.name;
    $('tPhone').textContent = t.phone.replace(/(\d{5})(\d{5})/, '$1 $2');
    $('tSend').href = `https://wa.me/91${t.phone}?text=${encodeURIComponent(tokenMessage(t))}`;
    setSendStep('message');
    renderGiven();
    show('screenToken');
  }

  // One Send button, used in up to two steps:
  //  'message' — opens the customer's own chat by number with the token message (works for unsaved numbers)
  //  'media'   — the same button then attaches the photos/videos through WhatsApp's share screen;
  //              the customer's chat is at the top of that list because the message was just sent
  let sendStep = 'message';

  function mediaLabel() {
    const n = mediaFiles.length, photos = mediaFiles.filter(f => f.type.startsWith('image/')).length;
    return [photos && `${photos} photo${photos > 1 ? 's' : ''}`, n - photos && `${n - photos} video${n - photos > 1 ? 's' : ''}`].filter(Boolean).join(' & ');
  }

  function setSendStep(step) {
    sendStep = step;
    const btn = $('tSend'), note = $('sendNote'), name = current.name;
    btn.classList.toggle('wa-next', step === 'media');
    if (step === 'message') {
      btn.textContent = 'Send on WhatsApp';
      note.textContent = sendsMedia() ? `Opens ${name}'s chat with the token. Send it, come back, and tap this button again for the ${mediaLabel()}.` : '';
    } else if (step === 'media') {
      btn.textContent = `Send ${mediaLabel()} to ${name}`;
      note.textContent = `In WhatsApp, tap ${name}'s chat at the top of the list, then Send.`;
    } else {
      btn.textContent = 'Sent ✓ — tap to send again';
      note.textContent = '';
    }
  }

  $('tSend').addEventListener('click', e => {
    if (sendStep === 'media') {
      e.preventDefault();
      navigator.share({ files: mediaFiles, text: `*${state.settings.shopName}* — today's offers for you, ${current.name} 🎁` })
        .then(() => setSendStep('done'))
        .catch(err => { if (err.name !== 'AbortError') $('sendNote').textContent = 'Could not attach the photos: ' + err.message; });
      return;
    }
    // 'message' or 'done': let the link open the customer's chat, then offer the photos next
    setTimeout(() => setSendStep(sendsMedia() ? 'media' : 'done'), 300);
  });

  function renderGiven() {
    $('tGiven').disabled = Boolean(current.givenAt);
    $('tGiven').textContent = current.givenAt ? 'Prize handed over ✓' : 'Prize handed over';
  }

  $('tGiven').addEventListener('click', () => {
    C.markGiven(state, current.token);
    persist();
    renderGiven();
  });
  $('tNext').addEventListener('click', () => { resetForm(); show('screenCustomer'); });

  // ---------- Screens ----------

  function show(id) {
    for (const s of ['screenCustomer', 'screenToken', 'screenAdmin']) $(s).classList.toggle('hidden', s !== id);
    window.scrollTo(0, 0);
  }

  // ---------- Admin PIN ----------

  $('lockBtn').addEventListener('click', () => {
    if (!$('screenAdmin').classList.contains('hidden')) { lockAdmin(); return; }
    $('pinIn').value = '';
    $('pinMsg').textContent = state.settings.pin === '1234' ? 'PIN is 1234 — change it in Settings.' : 'Each phone has its own PIN (1234 on a new phone).';
    $('pinModal').classList.remove('hidden');
    setTimeout(() => $('pinIn').focus(), 50);
  });
  $('pinCancel').addEventListener('click', () => $('pinModal').classList.add('hidden'));
  $('pinForm').addEventListener('submit', e => {
    e.preventDefault();
    if ($('pinIn').value !== state.settings.pin) { $('pinMsg').textContent = 'Wrong PIN'; $('pinIn').value = ''; return; }
    $('pinModal').classList.add('hidden');
    openAdmin();
  });

  function openAdmin() {
    show('screenAdmin');
    selectTab('today');
  }

  function lockAdmin() {
    resetForm();
    show('screenCustomer');
  }
  $('exitBtn').addEventListener('click', lockAdmin);

  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => selectTab(b.dataset.tab)));

  function selectTab(tab) {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== tab));
    ({ today: renderToday, customers: renderCustomers, download: renderDownloads, settings: fillSettings })[tab]();
  }

  // ---------- Admin: Today ----------

  function renderToday() {
    renderHeader();
    const list = C.tokensOn(state, C.todayStr());
    const dates = new Set(C.campaignDates(state));
    $('sToday').textContent = list.length;
    $('sGiven').textContent = list.filter(t => t.givenAt).length;
    $('sTotal').textContent = state.tokens.filter(t => dates.has(t.date)).length;
    const next = C.nextSerial(state);
    $('cNext').textContent = '#' + next;
    $('cPrize').textContent = C.offerFor(state, next).offer;
    $('decBtn').disabled = next <= 1;
    const backedUpToday = state.lastBackup && C.todayStr(new Date(state.lastBackup)) === C.todayStr();
    $('backupWarn').classList.toggle('hidden', backedUpToday || !list.length);
    $('backupWarn').textContent = '⚠ No backup saved today. Go to Download → Save backup before closing the shop.';
  }
  $('incBtn').addEventListener('click', () => { C.moveCounter(state, 1); persist(); renderToday(); });
  $('decBtn').addEventListener('click', () => { C.moveCounter(state, -1); persist(); renderToday(); });

  $('buildNote').textContent = `App version ${BUILD}`;
  $('repairBtn').addEventListener('click', () => {
    const btn = $('repairBtn');
    // Without internet the files can't be fetched again, so don't throw the saved copy away
    if (!navigator.onLine) { $('buildNote').textContent = 'Turn on internet first, then tap Refresh app.'; return; }
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = 'Tap again to refresh (customers are kept)';
      setTimeout(() => { delete btn.dataset.armed; btn.textContent = 'Refresh app (keeps all customers)'; }, 5000);
      return;
    }
    persist();
    btn.disabled = true;
    btn.textContent = 'Refreshing…';
    window.sq7Repair();
  });

  // ---------- Admin: Customers ----------

  function renderCustomers() {
    const pick = $('dayPick');
    const chosen = pick.value || C.todayStr();
    pick.innerHTML = C.daySummaries(state).map(d =>
      `<option value="${d.date}">Day ${d.day} · ${C.niceDate(d.date)} (${d.issued})</option>`).join('');
    pick.value = C.campaignDates(state).includes(chosen) ? chosen : C.campaignDates(state)[0];
    renderList();
  }

  function renderList() {
    const q = $('search').value.trim().toLowerCase();
    let rows;
    if (q) {
      const digits = q.replace(/\D/g, '');
      rows = state.tokens.filter(t => t.name.toLowerCase().includes(q) || t.token.toLowerCase().includes(q) || (digits.length >= 3 && t.phone.includes(digits)));
      $('listNote').textContent = `${rows.length} found across all days`;
    } else {
      rows = C.tokensOn(state, $('dayPick').value);
      $('listNote').textContent = rows.length ? `${rows.length} customers · ${rows.filter(t => t.givenAt).length} prizes given` : 'No customers on this day.';
    }
    rows = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.serial - b.serial);
    $('list').innerHTML = rows.map(t => `
      <div class="item">
        <span class="no">#${t.serial}</span>
        <div class="main">
          <b>${esc(t.name)}</b>
          <small>${t.phone} · ${esc(t.offer)}${q ? ` · Day ${C.dayNumber(state, t.date)}` : ''}</small><br>
          <small>${t.token}</small> ${t.givenAt ? '<span class="pill ok">Given</span>' : '<span class="pill">Not given</span>'}
        </div>
        <div class="acts">
          ${t.givenAt ? '' : `<button class="btn slate small" data-give="${t.token}">Give</button>`}
          <button class="linkbtn" data-cancel="${t.token}">Cancel</button>
        </div>
      </div>`).join('');
  }

  $('dayPick').addEventListener('change', renderList);
  $('search').addEventListener('input', renderList);
  $('list').addEventListener('click', e => {
    const give = e.target.closest('[data-give]');
    if (give) { C.markGiven(state, give.dataset.give); persist(); renderList(); return; }
    const btn = e.target.closest('[data-cancel]');
    if (!btn) return;
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = 'Sure? Tap again';
      setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Cancel'; } }, 4000);
      return;
    }
    C.cancel(state, btn.dataset.cancel);
    persist();
    renderCustomers();
  });

  // ---------- Admin: Download ----------

  function renderDownloads() {
    const today = C.todayStr();
    $('dayDownloads').innerHTML = C.daySummaries(state).map(d => `
      <div class="daydl${d.date === today ? ' today' : ''}">
        <div><b>Day ${d.day} · ${C.niceDate(d.date)}</b><small>${d.issued} tokens · ${d.given} prizes given</small></div>
        <button class="btn light small" data-dl="${d.date}" ${d.issued ? '' : 'disabled'}>Excel</button>
      </div>`).join('');
    $('bkMsg').className = 'msg';
    $('bkMsg').textContent = state.lastBackup ? `Last backup: ${new Date(state.lastBackup).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : 'No backup saved yet.';
  }

  const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // Saves the file to the phone's Downloads folder
  function saveFile(filename, data, type, msgEl) {
    const blob = new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    msgEl.className = 'msg ok';
    msgEl.textContent = `✔ Saved ${filename} to Downloads`;
  }

  $('dlAll').addEventListener('click', () => {
    const { filename, bytes } = C.exportWorkbook(state);
    saveFile(filename, bytes, XLSX_TYPE, $('dlMsg'));
  });
  $('dayDownloads').addEventListener('click', e => {
    const b = e.target.closest('[data-dl]');
    if (!b) return;
    const { filename, bytes } = C.exportWorkbook(state, b.dataset.dl);
    saveFile(filename, bytes, XLSX_TYPE, $('dlMsg'));
  });

  $('backupBtn').addEventListener('click', () => {
    state.lastBackup = new Date().toISOString();
    persist();
    const name = `backup-${state.settings.shopName.replace(/[^\w]+/g, '-')}-${C.todayStr()}.json`;
    saveFile(name, JSON.stringify(state), 'application/json', $('bkMsg'));
  });

  // Restoring replaces everything on this phone, so the file is held until a second tap confirms it
  let pendingRestore = null, restoreTimer = null;

  function clearPendingRestore() {
    pendingRestore = null;
    clearTimeout(restoreTimer);
    $('restoreBtn').textContent = 'Restore backup';
    $('restoreBtn').classList.replace('red', 'light');
  }

  $('restoreBtn').addEventListener('click', () => {
    if (!pendingRestore) { $('restoreFile').click(); return; }
    state = C.load({ getItem: () => JSON.stringify(pendingRestore) });
    clearPendingRestore();
    persist();
    $('bkMsg').className = 'msg ok';
    $('bkMsg').textContent = `✔ Restored ${state.tokens.length} customers`;
  });

  $('restoreFile').addEventListener('change', async () => {
    const file = $('restoreFile').files[0];
    $('restoreFile').value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !data.settings || !Array.isArray(data.tokens)) throw new Error('This is not a backup file from this app');
      pendingRestore = data;
      $('restoreBtn').textContent = `Tap again to replace with ${data.tokens.length} customers`;
      $('restoreBtn').classList.replace('light', 'red');
      restoreTimer = setTimeout(clearPendingRestore, 8000);
    } catch (e) {
      $('bkMsg').className = 'msg err';
      $('bkMsg').textContent = '✖ ' + (e instanceof SyntaxError ? 'This is not a backup file from this app' : e.message);
    }
  });

  // ---------- Admin: Settings ----------

  const SETTING_FIELDS = { startDate: 'startDate', days: 'days', prizeRules: 'prizeRules', offerTitle: 'offerTitle', dailyLimit: 'dailyLimit',
    shopName: 'shopNameIn', channelUrl: 'channelUrl', instagramId: 'instagramId', whatsappNumber: 'whatsappNumber', offerLink: 'offerLink' };

  function fillSettings() {
    for (const [key, id] of Object.entries(SETTING_FIELDS)) $(id).value = state.settings[key];
    $('newPin').value = '';
    $('setMsg').textContent = '';
    updateRangeNote();
    loadMediaSettings();
  }

  function updateRangeNote() {
    const start = $('startDate').value, days = parseInt($('days').value, 10);
    $('rangeNote').textContent = start && days > 0 ? `Runs ${C.niceDate(start)} to ${C.niceDate(C.addDays(start, days - 1))}. One mobile number can take part only once in this period.` : '';
  }
  $('startDate').addEventListener('input', updateRangeNote);
  $('days').addEventListener('input', updateRangeNote);

  $('settingsForm').addEventListener('submit', e => {
    e.preventDefault();
    const msg = $('setMsg');
    const pin = $('newPin').value.trim();
    if (pin && !/^\d{4,8}$/.test(pin)) { msg.className = 'msg err'; msg.textContent = 'PIN must be 4 to 8 digits'; return; }
    const s = state.settings;
    for (const [key, id] of Object.entries(SETTING_FIELDS)) s[key] = $(id).value.trim();
    s.days = Math.min(60, Math.max(1, parseInt(s.days, 10) || 8));
    s.dailyLimit = Math.max(0, parseInt(s.dailyLimit, 10) || 0);
    s.instagramId = s.instagramId.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
    const wa = s.whatsappNumber.replace(/\D/g, '');
    s.whatsappNumber = wa.length === 10 ? '91' + wa : wa;
    if (s.offerLink && !/^https?:\/\//i.test(s.offerLink)) s.offerLink = 'https://' + s.offerLink;
    if (pin) s.pin = pin;
    persist();
    fillSettings();
    renderHeader();
    msg.className = 'msg ok';
    msg.textContent = pin ? '✔ Saved. New PIN is active.' : '✔ Saved';
  });

  // ---------- Start ----------

  // Move to the next day automatically if the app stays open past midnight
  let shownDate = C.todayStr();
  setInterval(() => {
    if (C.todayStr() === shownDate) return;
    shownDate = C.todayStr();
    if (!$('screenCustomer').classList.contains('hidden')) renderCustomer(); else renderHeader();
  }, 30000);

  renderCustomer();

  refreshMedia().then(() => { if (!$('screenCustomer').classList.contains('hidden')) renderCustomer(); });

  // Tells the page the app started; otherwise it shows a "could not start" message
  window.sq7Ready = true;

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
