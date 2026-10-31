// Data and rules for the single-phone offer app. No DOM code here, so it can be tested in Node.
(function (root) {
  const STORAGE_KEY = 'sq7-offer-v1';

  const todayStr = (d = new Date()) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00');
    d.setDate(d.getDate() + n);
    return todayStr(d);
  }

  function defaultState() {
    return {
      settings: {
        shopName: '7 SQUARE DIGITAL HUB',
        channelUrl: '',
        instagramId: '',
        whatsappNumber: '',
        offerLink: '',  // web page with the offer photos/videos; WhatsApp shows it as a preview
        offerTitle: '10% OFF',
        prizeRules: '1 = EarBuds\n2-8 = Neck Band\n9-85 = Earphone or Tempered Glass',
        startDate: todayStr(),
        days: 8,
        dailyLimit: 0,
        pin: '1234',
      },
      tokens: [],
      counters: {}, // date -> next customer number, adjustable by the admin
      lastBackup: null,
    };
  }

  // ---- Campaign days ----

  const campaignDates = s => Array.from({ length: s.settings.days }, (_, i) => addDays(s.settings.startDate, i));

  // 1-based day of the campaign; 0 before it starts, > days after it ends
  function dayNumber(s, date = todayStr()) {
    const ms = new Date(date + 'T00:00') - new Date(s.settings.startDate + 'T00:00');
    return Math.round(ms / 86400000) + 1;
  }

  function campaignStatus(s, date = todayStr()) {
    const day = dayNumber(s, date);
    if (day < 1) return { active: false, day, message: `Offer starts on ${niceDate(s.settings.startDate)}` };
    if (day > s.settings.days) return { active: false, day, message: 'This offer has ended. Thank you!' };
    return { active: true, day, message: `Day ${day} of ${s.settings.days}` };
  }

  const niceDate = d => new Date(d + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  // ---- Customers ----

  function normalizePhone(input) {
    let digits = String(input || '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    return /^[6-9]\d{9}$/.test(digits) ? digits : null;
  }

  // One mobile number = one person for the whole campaign
  function findByPhone(s, phone) {
    const dates = new Set(campaignDates(s));
    return s.tokens.find(t => t.phone === phone && dates.has(t.date)) || null;
  }

  function parsePrizeRules(text) {
    return String(text || '').split('\n').map(line => {
      const m = line.match(/^\s*#?(\d+)\s*(?:-\s*#?(\d+))?\s*[=:]\s*(.+?)\s*$/);
      if (!m) return null;
      const from = +m[1], to = m[2] ? +m[2] : from;
      return { from: Math.min(from, to), to: Math.max(from, to), prize: m[3] };
    }).filter(Boolean);
  }

  function offerFor(s, serial) {
    const rule = parsePrizeRules(s.settings.prizeRules).find(r => serial >= r.from && serial <= r.to);
    return rule ? { offer: rule.prize, prize: true } : { offer: s.settings.offerTitle, prize: false };
  }

  const tokensOn = (s, date) => s.tokens.filter(t => t.date === date);

  function nextSerial(s, date = todayStr()) {
    if (s.counters[date]) return s.counters[date];
    return Math.max(0, ...tokensOn(s, date).map(t => t.serial)) + 1;
  }

  function moveCounter(s, delta, date = todayStr()) {
    s.counters[date] = Math.max(1, nextSerial(s, date) + delta);
    return s.counters[date];
  }

  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function randomCode(s, date) {
    const [, mm, dd] = date.split('-');
    let code;
    do {
      let r = '';
      for (let i = 0; i < 4; i++) r += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      code = `${dd}${mm}-${r}`;
    } while (s.tokens.some(t => t.token === code));
    return code;
  }

  // Returns { entry } or { error, existing }
  function issue(s, { name, phone }, now = new Date()) {
    const date = todayStr(now);
    const status = campaignStatus(s, date);
    if (!status.active) return { error: status.message };
    name = String(name || '').trim().slice(0, 60);
    if (!name) return { error: 'Enter the customer name' };
    const mobile = normalizePhone(phone);
    if (!mobile) return { error: 'Enter a valid 10-digit mobile number' };
    const existing = findByPhone(s, mobile);
    if (existing) return { error: alreadyMessage(s, existing), existing };

    const taken = new Set(tokensOn(s, date).map(t => t.serial));
    let serial = nextSerial(s, date);
    while (taken.has(serial)) serial++;
    const limit = s.settings.dailyLimit;
    if (limit > 0 && serial > limit) return { error: `Today's ${limit} tokens are all given. Come back tomorrow!` };

    const entry = {
      day: status.day, date, serial, token: randomCode(s, date), name, phone: mobile,
      ...offerFor(s, serial), createdAt: now.toISOString(), givenAt: null,
    };
    s.tokens.push(entry);
    s.counters[date] = serial + 1;
    return { entry };
  }

  const alreadyMessage = (s, t) =>
    `This number already took part on Day ${dayNumber(s, t.date)} (${niceDate(t.date)}) — token #${t.serial}, ${t.name}`;

  function markGiven(s, token, now = new Date()) {
    const t = s.tokens.find(x => x.token === token);
    if (t && !t.givenAt) t.givenAt = now.toISOString();
    return t;
  }

  function cancel(s, token) {
    const i = s.tokens.findIndex(x => x.token === token);
    return i === -1 ? null : s.tokens.splice(i, 1)[0];
  }

  function daySummaries(s) {
    return campaignDates(s).map((date, i) => {
      const list = tokensOn(s, date);
      return { day: i + 1, date, issued: list.length, given: list.filter(t => t.givenAt).length };
    });
  }

  // ---- Storage ----

  function load(storage) {
    const base = defaultState();
    try {
      const saved = JSON.parse(storage.getItem(STORAGE_KEY));
      if (saved && saved.settings) {
        return { ...base, ...saved, settings: { ...base.settings, ...saved.settings } };
      }
    } catch (e) { /* fall through to a fresh state */ }
    return base;
  }

  function save(storage, s) {
    storage.setItem(STORAGE_KEY, JSON.stringify(s));
  }

  // ---- Excel (.xlsx) writer: a zip of XML files, stored without compression ----

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      const dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true);
      dir.setUint16(4, 20, true);
      dir.setUint16(6, 20, true);
      dir.setUint16(8, 0x0800, true);
      dir.setUint32(16, crc, true);
      dir.setUint32(20, data.length, true);
      dir.setUint32(24, data.length, true);
      dir.setUint16(28, name.length, true);
      dir.setUint32(42, offset, true);
      parts.push(new Uint8Array(local.buffer), name, data);
      central.push(new Uint8Array(dir.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const dirSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, dirSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let pos = 0;
    for (const p of all) { out.set(p, pos); pos += p.length; }
    return out;
  }

  const xmlEscape = v => String(v ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  function colName(i) {
    let s = '';
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  // Numbers stay numbers; everything else (including phone numbers) is text so Excel keeps it exact
  function cell(ref, v, style) {
    const s = style ? ` s="${style}"` : '';
    if (typeof v === 'number') return `<c r="${ref}"${s}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
  }

  function sheetXml({ columns, rows }) {
    const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join('');
    const header = `<row r="1">${columns.map((c, i) => cell(colName(i) + 1, c.header, 1)).join('')}</row>`;
    const body = rows.map((r, ri) => `<row r="${ri + 2}">${r.map((v, ci) => cell(colName(ci) + (ri + 2), v)).join('')}</row>`).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      + `<cols>${cols}</cols><sheetData>${header}${body}</sheetData></worksheet>`;
  }

  // sheets: [{ name, columns: [{ header, width }], rows: [[...]] }]
  function buildXlsx(sheets) {
    const ns = 'http://schemas.openxmlformats.org/';
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + `<Types xmlns="${ns}package/2006/content-types">`
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
        + '</Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + `<Relationships xmlns="${ns}package/2006/relationships">`
        + `<Relationship Id="rId1" Type="${ns}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + `<workbook xmlns="${ns}spreadsheetml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships"><sheets>`
        + sheets.map((sh, i) => `<sheet name="${xmlEscape(sheetName(sh.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
        + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + `<Relationships xmlns="${ns}package/2006/relationships">`
        + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
        + `<Relationship Id="rId${sheets.length + 1}" Type="${ns}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + `<styleSheet xmlns="${ns}spreadsheetml/2006/main">`
        + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
        + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FF3B4550"/><bgColor indexed="64"/></patternFill></fill></fills>'
        + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>'
        + '</styleSheet>' },
      ...sheets.map((sh, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sh) })),
    ];
    return zip(files);
  }

  const sheetName = n => String(n).replace(/[\[\]:*?/\\]/g, '-').slice(0, 31);

  const timeOf = iso => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '');

  const CUSTOMER_COLUMNS = [
    { header: 'Day', width: 6 }, { header: 'Date', width: 12 }, { header: 'No.', width: 6 },
    { header: 'Token', width: 12 }, { header: 'Customer name', width: 24 }, { header: 'Mobile', width: 14 },
    { header: 'Prize / Offer', width: 28 }, { header: 'Token time', width: 11 },
    { header: 'Prize given', width: 11 }, { header: 'Given time', width: 11 },
  ];

  const customerRow = (s, t) => [dayNumber(s, t.date), t.date, t.serial, t.token, t.name, t.phone, t.offer,
    timeOf(t.createdAt), t.givenAt ? 'Yes' : 'No', timeOf(t.givenAt)];

  const sortTokens = list => [...list].sort((a, b) => a.date.localeCompare(b.date) || a.serial - b.serial);

  // One day's file, or (date omitted) the whole campaign with a summary, an "All" sheet and one sheet per day
  function exportWorkbook(s, date) {
    const shop = s.settings.shopName.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
    if (date) {
      const day = dayNumber(s, date);
      return {
        filename: `${shop}_Day${day}_${date}.xlsx`,
        bytes: buildXlsx([{ name: `Day ${day} (${date})`, columns: CUSTOMER_COLUMNS, rows: sortTokens(tokensOn(s, date)).map(t => customerRow(s, t)) }]),
      };
    }
    const dates = campaignDates(s);
    const inCampaign = sortTokens(s.tokens.filter(t => dates.includes(t.date)));
    const summary = {
      name: 'Summary',
      columns: [{ header: 'Day', width: 6 }, { header: 'Date', width: 12 }, { header: 'Tokens', width: 9 }, { header: 'Prizes given', width: 13 }],
      rows: [...daySummaries(s).map(d => [d.day, d.date, d.issued, d.given]),
        ['Total', '', inCampaign.length, inCampaign.filter(t => t.givenAt).length]],
    };
    const perDay = dates.map((d, i) => ({ name: `Day ${i + 1}`, columns: CUSTOMER_COLUMNS, rows: tokensOn(s, d).sort((a, b) => a.serial - b.serial).map(t => customerRow(s, t)) }));
    return {
      filename: `${shop}_All-${s.settings.days}-days_${dates[0]}_to_${dates[dates.length - 1]}.xlsx`,
      bytes: buildXlsx([summary, { name: 'All customers', columns: CUSTOMER_COLUMNS, rows: inCampaign.map(t => customerRow(s, t)) }, ...perDay]),
    };
  }

  const api = {
    STORAGE_KEY, todayStr, addDays, niceDate, defaultState, campaignDates, dayNumber, campaignStatus,
    normalizePhone, findByPhone, alreadyMessage, parsePrizeRules, offerFor, tokensOn, nextSerial, moveCounter,
    issue, markGiven, cancel, daySummaries, load, save, buildXlsx, exportWorkbook,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(this);
