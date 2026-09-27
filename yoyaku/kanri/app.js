/* &.&～日々の食パン～ ご予約の管理（お店専用）
 *
 * 仕組みと手順は C:\Users\kchic\claude code\LINE\design.md を参照。
 * サーバー側は同フォルダの gas\Code.gs が「正」。
 *
 * 1日ずつめくって見る。1画面に複数日を混ぜない。
 * 作業中に開くので、いま見ているのがいつの分かを取り違えないことを優先する。
 *
 * このページは URL の # 以降に入れた鍵で開く。鍵は初回に端末へ保存し、
 * アドレスからは消す（履歴や共有で鍵が漏れないようにするため）。
 */

/* ▼▼ GASをデプロイしたら、ここにウェブアプリのURLを貼る（お客様用と同じURL） ▼▼ */
const API_URL = 'https://script.google.com/macros/s/AKfycbyggmGYQnjH77zXWvWeuqfwoEHyOu8dfQA1kGE2v2tDJV7j37eJjyJh9gjSaQvULAyD/exec';
/* ▲▲ https://script.google.com/macros/s/……/exec の形 ▲▲ */

const KEY_STORE = 'hibino-kanri-key';
const CANCELLED = 'キャンセル';

const $ = (id) => document.getElementById(id);

let KEY = '';
let kinPerLoaf = 2;
let days = [];       // いま表示している月の、全部の日
let index = 0;       // いま見ている日
let ym = '';         // 表示中の月 'yyyy-MM'
let todayYmd = '';   // サーバー（日本時間）での今日
let hasPrev = false; // 前の月へ行けるか
let hasNext = false;

// 定期のお客様
let regulars = [];   // 一覧
let slots = [];      // 受取時間の選択肢
let editingId = '';  // 変更中の定期ID。空なら新規追加
const regCuts = { cut4: 0, cut5: 0, cut0: 0 };

const CUT_KEYS = ['cut4', 'cut5', 'cut0'];
const CUT_NAMES = { cut4: '4枚切り', cut5: '5枚切り', cut0: 'カットなし' };
const WD = ['日', '月', '火', '水', '木', '金', '土'];

const qtyText = (kin) => kin + '斤（' + kin / kinPerLoaf + '本）';

/** 「4枚切り 2斤 ／ カットなし 1斤」。Code.gs の cutsText_ と同じ形にそろえる */
function cutsText(c) {
  const parts = CUT_KEYS.filter((k) => Number(c[k]) > 0)
    .map((k) => CUT_NAMES[k] + ' ' + Number(c[k]) + '斤');
  return parts.length ? parts.join(' ／ ') : '（カット指定なし）';
}

// ───────────────────────── 鍵 ─────────────────────────

function saveKey(key) {
  try { localStorage.setItem(KEY_STORE, key); } catch (e) { /* 保存できなくても今回は動く */ }
}

function loadKey() {
  const fromHash = (location.hash.match(/key=([A-Za-z0-9_-]+)/) || [])[1];
  if (fromHash) {
    saveKey(fromHash);
    // アドレスバーから鍵を消す。履歴やスクリーンショットから漏れないように
    history.replaceState(null, '', location.pathname + location.search);
    return fromHash;
  }
  try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
}

/** 貼り付けられた文字から鍵を取り出す。URLごと貼られても、鍵だけでも受ける。 */
function extractKey(text) {
  const s = String(text || '').trim();
  const inUrl = s.match(/key=([A-Za-z0-9_-]+)/);
  if (inUrl) return inUrl[1];
  return /^[A-Za-z0-9_-]{16,}$/.test(s) ? s : '';
}

function showUnlock(message) {
  $('unlock').hidden = false;
  $('board').hidden = true;
  if (message) {
    $('unlock-error').textContent = message;
    $('unlock-error').hidden = false;
  } else {
    $('unlock-error').hidden = true;
  }
}

async function unlock() {
  const key = extractKey($('unlock-input').value);
  if (!key) {
    showUnlock('鍵が読み取れませんでした。届いたURLか鍵を、そのまま貼り付けてください。');
    return;
  }
  // 実際に通るか確かめてから保存する。間違った鍵を覚えてしまわないように
  const btn = $('unlock-go');
  btn.disabled = true;
  btn.textContent = '確認中…';
  try {
    const res = await api({ action: 'admin', key: key });
    if (!res.ok) { showUnlock(res.error || 'この鍵では開けませんでした。'); return; }
    saveKey(key);
    KEY = key;
    $('unlock').hidden = true;
    $('board').hidden = false;
    await load();
  } catch (e) {
    showUnlock(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '開く';
  }
}

// ───────────────────────── 通信 ─────────────────────────

async function api(params, body) {
  if (API_URL.indexOf('http') !== 0) {
    throw new Error('予約システムの設定が終わっていません。');
  }
  const url = API_URL + (params ? '?' + new URLSearchParams(params) : '');
  const opt = body
    ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }
    : { method: 'GET' };

  let res;
  try {
    res = await fetch(url, opt);
  } catch (e) {
    throw new Error('通信できませんでした。電波のよい場所でもう一度お試しください。');
  }
  if (!res.ok) throw new Error('通信に失敗しました（' + res.status + '）。少し待ってお試しください。');
  return res.json();
}

// ───────────────────────── 表示の部品 ─────────────────────────

function say(id, message) {
  const el = $(id);
  if (!message) { el.hidden = true; return; }
  el.textContent = message;
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ───────────────────────── 読み込み ─────────────────────────

/**
 * 1か月ぶんを読み込む。
 *   targetYm … 'yyyy-MM'。省略すると今月
 *   want     … 表示したい日。'first' / 'last' / 'yyyy-MM-dd' / 省略（いまの日を保つ）
 */
async function load(quiet, targetYm, want) {
  if (!quiet) $('updated').textContent = '読み込み中…';
  say('error', '');
  try {
    const params = { action: 'admin', key: KEY };
    if (targetYm) params.ym = targetYm;
    const data = await api(params);
    if (!data.ok) throw new Error(data.error || '読み込めませんでした。');

    kinPerLoaf = data.kinPerLoaf;
    todayYmd = data.todayYmd || '';
    ym = data.ym || ym;
    hasPrev = !!data.hasPrev;
    hasNext = !!data.hasNext;

    const keeping = (want && want !== 'first' && want !== 'last')
      ? want
      : (days[index] ? days[index].date : todayYmd);

    days = data.days || [];

    if (want === 'first') index = 0;
    else if (want === 'last') index = days.length - 1;
    else {
      // 見ていた日を保つ。月が変わって無ければ今日、それも無ければ1日
      let at = days.findIndex((d) => d.date === keeping);
      if (at < 0) at = days.findIndex((d) => d.date === todayYmd);
      index = at < 0 ? 0 : at;
    }
    if (index < 0) index = 0;

    render();
    if (!$('daycal').hidden) renderCal();
    const now = new Date();
    $('updated').textContent = '最終更新 '
      + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  } catch (e) {
    $('updated').textContent = '';
    $('grid').innerHTML = '';
    $('day-label').textContent = '—';
    say('error', e.message);
  }
}

// ───────────────────────── 描画 ─────────────────────────

function render() {
  const day = days[index];
  $('prev-day').disabled = index <= 0 && !hasPrev;
  $('next-day').disabled = index >= days.length - 1 && !hasNext;

  if (!day) {
    $('day-label').textContent = '—';
    $('day-rel').hidden = true;
    $('day-sum').textContent = '';
    $('grid').innerHTML = '';
    $('empty').hidden = true;
    return;
  }

  $('day-label').textContent = day.label;
  $('day-rel').textContent = day.rel || '';
  $('day-rel').hidden = !day.rel;

  const live = day.items.filter((i) => i.status !== CANCELLED);
  const kin = live.reduce((s, i) => s + i.kin, 0);
  const regs = day.regulars || [];
  const regKin = regs.reduce((s, g) => s + (g.skipped ? 0 : g.kin), 0);

  $('day-sum').innerHTML = day.closed
    ? '<b>定休日</b>'
    : 'ご予約 <b>' + qtyText(kin) + '</b>　' + live.length + '件'
      + (regKin ? '<span class="day-reg">定期 <b>' + qtyText(regKin) + '</b></span>' : '')
      + '<span class="day-left">残り ' + qtyText(day.remaining) + '</span>';

  const grid = $('grid');
  grid.innerHTML = '';
  // 定期を先に出す。毎回来る方なので、その日に必ず用意するものとして上に置く
  regs.forEach((g) => grid.appendChild(regularCard(g, day)));
  day.items.forEach((item) => grid.appendChild(card(item, day)));

  const count = day.items.length + regs.length;
  $('empty').hidden = count > 0;
  $('empty').textContent = day.closed ? 'この日は定休日です。' : 'ご予約なし';
}

function card(item, day) {
  const cancelled = item.status === CANCELLED;
  const node = el('article', 'card' + (cancelled ? ' is-cancelled' : ''));

  node.appendChild(el('p', 'card-time', item.time));
  node.appendChild(el('p', 'card-name', item.name + ' 様'));
  node.appendChild(el('p', 'card-kin', qtyText(item.kin)));
  node.appendChild(el('p', 'card-cuts', item.cuts || cutsText(item)));

  const tel = el('a', 'card-tel', item.phone);
  tel.href = 'tel:' + item.phone.replace(/-/g, '');
  node.appendChild(tel);

  if (item.note) node.appendChild(el('p', 'card-note', item.note));
  node.appendChild(el('p', 'card-id', item.id));

  if (cancelled) {
    node.appendChild(el('span', 'cancelled-tag', 'キャンセル済み'));
    const undo = el('button', 'btn btn-undo', '取り消す');
    undo.type = 'button';
    undo.addEventListener('click', () => setStatus(undo, item, day, '予約済'));
    node.appendChild(undo);
  } else {
    const cancel = el('button', 'btn btn-cancel', 'キャンセル');
    cancel.type = 'button';
    cancel.addEventListener('click', () => setStatus(cancel, item, day, CANCELLED));
    node.appendChild(cancel);
  }
  return node;
}

/** ご予約の画面に出す、定期のお客様のカード */
function regularCard(g, day) {
  const node = el('article', 'card is-regular' + (g.skipped ? ' is-skipped' : ''));

  node.appendChild(el('span', 'reg-tag', '定期'));
  node.appendChild(el('p', 'card-time', g.time));
  node.appendChild(el('p', 'card-name', g.name + ' 様'));
  node.appendChild(el('p', 'card-kin', qtyText(g.kin)));
  node.appendChild(el('p', 'card-cuts', g.cuts));

  if (g.phone) {
    const tel = el('a', 'card-tel', g.phone);
    tel.href = 'tel:' + g.phone.replace(/-/g, '');
    node.appendChild(tel);
  }
  if (g.note) node.appendChild(el('p', 'card-note', g.note));
  node.appendChild(el('p', 'card-id', g.whenText));

  if (g.skipped) {
    node.appendChild(el('span', 'cancelled-tag', 'この日はお休み'));
    const undo = el('button', 'btn btn-undo', 'お休みをやめる');
    undo.type = 'button';
    undo.addEventListener('click', () => setSkip(undo, g, day, false));
    node.appendChild(undo);
  } else {
    const skip = el('button', 'btn btn-cancel', 'この日はお休み');
    skip.type = 'button';
    skip.addEventListener('click', () => setSkip(skip, g, day, true));
    node.appendChild(skip);
  }
  return node;
}

// ───────────────────────── 操作 ─────────────────────────

/** 定期の方を、その日だけ休みにする／戻す */
async function setSkip(btn, g, day, on) {
  const ask = day.label + '\n' + g.name + ' 様（定期）\n' + qtyText(g.kin) + '\n\n'
    + (on ? 'この日はお休みにしますか？\nその分は、ご予約の枠に戻ります。'
          : 'お休みをやめて、いつも通りにしますか？');
  if (!window.confirm(ask)) return;

  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '処理中…';
  say('error', '');
  say('notice', '');
  try {
    const res = await api(null, { action: 'reg_skip', key: KEY, id: g.id, date: day.date, on: on });
    if (!res.ok) {
      await load(true);
      say('error', res.error || '変更できませんでした。');
      return;
    }
    await load(true);
    say('notice', res.message);
  } catch (e) {
    say('error', e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function setStatus(btn, item, day, status) {
  const ask = day.label + '\n' + item.name + ' 様\n' + qtyText(item.kin) + '\n\n'
    + (status === CANCELLED
        ? 'このご予約をキャンセルしますか？'
        : 'キャンセルを取り消して、ご予約に戻しますか？');
  if (!window.confirm(ask)) return;

  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '処理中…';
  say('error', '');
  say('notice', '');

  try {
    const res = await api(null, { action: 'admin_status', key: KEY, id: item.id, status });
    if (!res.ok) {
      // load() が先にエラー表示を消してしまうので、読み直してから出す
      await load(true);
      say('error', res.error || '変更できませんでした。');
      return;
    }
    await load(true);
    say('notice', res.message);
  } catch (e) {
    say('error', e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function move(step) {
  const next = index + step;
  say('notice', '');
  say('error', '');

  // 月末・月初を越えるときは、隣の月を読み込んでその端の日を出す
  if (next < 0) {
    if (hasPrev) load(true, shiftYm(ym, -1), 'last');
    return;
  }
  if (next >= days.length) {
    if (hasNext) load(true, shiftYm(ym, 1), 'first');
    return;
  }
  index = next;
  render();
  if (!$('daycal').hidden) renderCal();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function shiftYm(v, step) {
  const [y, m] = v.split('-').map(Number);
  const d = new Date(y, m - 1 + step, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// ───────────────────── カレンダー ─────────────────────

function toggleCal() {
  if ($('daycal').hidden) {
    $('daycal').hidden = false;
    $('day-pick').setAttribute('aria-expanded', 'true');
    renderCal();
    $('daycal').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    closeCal();
  }
}

function closeCal() {
  $('daycal').hidden = true;
  $('day-pick').setAttribute('aria-expanded', 'false');
}

function renderCal() {
  if (!days.length) return;
  const [y, m] = ym.split('-').map(Number);
  $('cal-title').textContent = y + '年 ' + m + '月';
  $('cal-prev').disabled = !hasPrev;
  $('cal-next').disabled = !hasNext;

  const grid = $('daycal-grid');
  grid.innerHTML = '';
  // 1日の曜日まで空きマスを置く
  for (let i = 0; i < days[0].dow; i++) grid.appendChild(el('span', 'dc-blank'));

  days.forEach((d, i) => {
    const cell = el('button', 'dc-day');
    cell.type = 'button';
    if (d.closed) cell.classList.add('is-closed');
    if (d.past) cell.classList.add('is-past');
    if (d.date === todayYmd) cell.classList.add('is-today');
    if (i === index) cell.classList.add('is-selected');

    cell.appendChild(el('span', 'dc-d', String(Number(d.date.slice(8)))));
    if (d.closed) {
      cell.appendChild(el('span', 'dc-off', '休'));
    } else {
      // 予約が入っている日だけ色を付ける。0が並ぶ中から拾えるように
      cell.appendChild(el('span', 'dc-b' + (d.total > 0 ? ' has' : ''), '予' + d.total));
      cell.appendChild(el('span', 'dc-r' + (d.remaining > 0 ? '' : ' none'), '残' + d.remaining));
    }
    cell.setAttribute('aria-label', d.label + (d.closed
      ? ' 定休日'
      : ' ご予約' + d.total + '斤、残り' + d.remaining + '斤'));
    cell.addEventListener('click', () => pickDay(i));
    grid.appendChild(cell);
  });
}

function pickDay(i) {
  index = i;
  say('notice', '');
  say('error', '');
  closeCal();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ───────────────── 定期のお客様（一覧と登録） ─────────────────

function showView(which) {
  const isReg = which === 'reg';
  $('view-day').hidden = isReg;
  $('view-reg').hidden = !isReg;
  $('tab-day').classList.toggle('is-on', !isReg);
  $('tab-reg').classList.toggle('is-on', isReg);
  // 見出しの説明文は「ご予約」の画面の話なので、定期の画面では出さない
  document.querySelector('.head-note').hidden = isReg;
  if (isReg) closeCal();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (isReg && !regulars.length) loadRegulars();
}

async function loadRegulars() {
  say('reg-error', '');
  try {
    const data = await api({ action: 'regulars', key: KEY });
    if (!data.ok) throw new Error(data.error || '読み込めませんでした。');
    regulars = data.regulars || [];
    slots = data.slots || [];
    fillRegChoices();
    renderRegulars();
  } catch (e) {
    say('reg-error', e.message);
  }
}

function renderRegulars() {
  const box = $('reg-list');
  box.innerHTML = '';
  regulars.forEach((g) => box.appendChild(regRow(g)));
  $('reg-empty').hidden = regulars.length > 0;
}

function regRow(g) {
  const paused = g.status === '停止';
  const node = el('article', 'reg-card' + (paused ? ' is-paused' : ''));

  node.appendChild(el('p', 'reg-name', g.name + ' 様'));
  node.appendChild(el('p', 'reg-when', g.whenText + '　' + g.time));
  node.appendChild(el('p', 'reg-kin', qtyText(g.kin)));
  node.appendChild(el('p', 'reg-cuts', g.cuts));

  if (g.phone) {
    const tel = el('a', 'card-tel', g.phone);
    tel.href = 'tel:' + g.phone.replace(/-/g, '');
    node.appendChild(tel);
  }
  if (g.note) node.appendChild(el('p', 'card-note', g.note));
  if (g.start || g.end) {
    node.appendChild(el('p', 'reg-term',
      (g.start || '今日') + ' 〜 ' + (g.end || 'ずっと')));
  }

  if (paused) {
    node.appendChild(el('span', 'cancelled-tag', '停止中'));
  } else if (g.next && g.next.length) {
    // 「本当にこの人は来るのか」を、設定ではなく実際の日付で確かめられるようにする
    node.appendChild(el('p', 'reg-next', '次は ' + g.next.join('、')));
  }

  const actions = el('div', 'reg-actions');
  const edit = el('button', 'btn btn-sub btn-small', '変更');
  edit.type = 'button';
  edit.addEventListener('click', () => openRegForm(g));

  const toggle = el('button', 'btn btn-small ' + (paused ? 'btn-undo' : 'btn-cancel'),
    paused ? '再開する' : '停止する');
  toggle.type = 'button';
  toggle.addEventListener('click', () => regStatus(toggle, g, paused ? '有効' : '停止'));

  const del = el('button', 'btn btn-sub btn-small', '削除');
  del.type = 'button';
  del.addEventListener('click', () => regDelete(del, g));

  actions.append(edit, toggle, del);
  node.appendChild(actions);
  return node;
}

/** 選択肢は一度だけ作る */
function fillRegChoices() {
  const t = $('reg-time');
  if (!t.options.length) slots.forEach((x) => t.add(new Option(x, x)));
  const d = $('reg-dom');
  if (!d.options.length) for (let i = 1; i <= 31; i++) d.add(new Option(i + '日', String(i)));
}

function openRegForm(g) {
  editingId = g ? g.id : '';
  $('reg-form-title').textContent = g ? g.name + ' 様の内容を変える' : '定期のお客様を追加';
  $('reg-name').value = g ? g.name : '';
  $('reg-phone').value = g ? g.phone : '';
  $('reg-repeat').value = g ? g.repeat : '毎週';
  // 繰り返しごとに欄が違う。まず全部を既定に戻してから、使う欄だけ入れ直す。
  // 戻さないと前に開いた人の曜日が残り、別の人の設定に化ける
  $('reg-dow').value = '4';
  $('reg-dom').value = '1';
  $('reg-nth').value = '2';
  $('reg-nthdow').value = '5';
  if (g && g.repeat === '毎月') {
    $('reg-dom').value = g.when;
  } else if (g && g.repeat === '第N曜日') {
    const p = parseNthDow(g.when);
    if (p) { $('reg-nth').value = p.nth; $('reg-nthdow').value = p.dow; }
  } else if (g) {
    $('reg-dow').value = g.when;
  }
  $('reg-time').value = g ? g.time : (slots[0] || '');
  CUT_KEYS.forEach((k) => { regCuts[k] = g ? Number(g[k]) || 0 : 0; });
  $('reg-start').value = g ? g.start : '';
  $('reg-end').value = g ? g.end : '';
  $('reg-note').value = g ? g.note : '';

  syncRepeat();
  renderRegCuts();
  say('reg-form-error', '');
  $('reg-form').hidden = false;
  $('reg-new').hidden = true;
  $('reg-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeRegForm() {
  $('reg-form').hidden = true;
  $('reg-new').hidden = false;
  editingId = '';
}

/* 第N曜日は '2-5'（第2金曜日）の形でまとめて1つの値として送る。
   Code.gs の parseNthDow_ と同じ形。片方だけ変えると保存した内容が読めなくなる。 */
function parseNthDow(when) {
  const m = /^([1-5])-([0-6])$/.exec(String(when || '').trim());
  return m ? { nth: m[1], dow: m[2] } : null;
}

/** いま選ばれている繰り返しに合わせて「曜日/日」の値を作る */
function regWhenValue() {
  const r = $('reg-repeat').value;
  if (r === '毎月') return $('reg-dom').value;
  if (r === '第N曜日') return $('reg-nth').value + '-' + $('reg-nthdow').value;
  return $('reg-dow').value;
}

/** 繰り返しに関係のある欄だけを出す */
function syncRepeat() {
  const r = $('reg-repeat').value;
  $('reg-field-dow').hidden = r !== '毎週';
  $('reg-field-nth').hidden = r !== '第N曜日';
  $('reg-field-dom').hidden = r !== '毎月';
}

function renderRegCuts() {
  const total = CUT_KEYS.reduce((n, k) => n + regCuts[k], 0);
  document.querySelectorAll('#reg-cuts .cut').forEach((row) => {
    const key = row.dataset.cut;
    row.querySelector('[data-num]').textContent = regCuts[key];
    row.classList.toggle('is-on', regCuts[key] > 0);
    row.querySelectorAll('.cut-btn').forEach((b) => {
      // 上限はその日の残りではなく1日の上限。定期は日を特定しないので、ここでは止めない
      b.disabled = Number(b.dataset.step) < 0 && regCuts[key] <= 0;
    });
  });
  const box = $('reg-cut-total');
  box.classList.toggle('is-zero', total === 0);
  box.textContent = total === 0 ? 'カット数を入れてください' : '合計 ' + qtyText(total);
}

async function saveRegular(btn) {
  const reg = {
    id: editingId,
    name: $('reg-name').value.trim(),
    phone: $('reg-phone').value.trim(),
    repeat: $('reg-repeat').value,
    when: regWhenValue(),
    time: $('reg-time').value,
    cut4: regCuts.cut4, cut5: regCuts.cut5, cut0: regCuts.cut0,
    start: $('reg-start').value,
    end: $('reg-end').value,
    note: $('reg-note').value.trim(),
    status: '有効',
  };
  // 変更のときは、いまの状態（停止中かどうか）を保つ。勝手に再開させない
  if (editingId) {
    const cur = regulars.filter((g) => g.id === editingId)[0];
    if (cur) reg.status = cur.status;
  }

  btn.disabled = true;
  btn.textContent = '保存中…';
  say('reg-form-error', '');
  try {
    const res = await api(null, { action: 'reg_save', key: KEY, reg: reg });
    if (!res.ok) { say('reg-form-error', res.error || '保存できませんでした。'); return; }
    closeRegForm();
    await loadRegulars();
    await load(true);        // 定期を変えると日ごとの残数も変わる
    say('reg-notice', res.message);
  } catch (e) {
    say('reg-form-error', e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '保存する';
  }
}

async function regStatus(btn, g, status) {
  const ask = g.name + ' 様（' + g.whenText + '）\n\n'
    + (status === '停止'
        ? 'この方の定期を止めますか？\nこれから先の分が、ご予約の枠に戻ります。'
        : 'この方の定期を再開しますか？');
  if (!window.confirm(ask)) return;
  await regAction(btn, { action: 'reg_status', key: KEY, id: g.id, status: status });
}

async function regDelete(btn, g) {
  if (!window.confirm(g.name + ' 様（' + g.whenText + '）\n\nこの定期を削除しますか？\n'
    + '記録も消えます。しばらく来られないだけなら「停止する」のほうが安全です。')) return;
  await regAction(btn, { action: 'reg_delete', key: KEY, id: g.id });
}

async function regAction(btn, body) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '処理中…';
  say('reg-error', '');
  say('reg-notice', '');
  try {
    const res = await api(null, body);
    if (!res.ok) { say('reg-error', res.error || '変更できませんでした。'); return; }
    await loadRegulars();
    await load(true);
    say('reg-notice', res.message);
  } catch (e) {
    say('reg-error', e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ───────────────────────── 起動 ─────────────────────────

$('prev-day').addEventListener('click', () => move(-1));
$('next-day').addEventListener('click', () => move(1));
$('reload').addEventListener('click', () => { say('notice', ''); load(); });
$('unlock-go').addEventListener('click', unlock);
$('unlock-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });

$('day-pick').addEventListener('click', toggleCal);
$('cal-close').addEventListener('click', closeCal);
$('cal-prev').addEventListener('click', () => { if (hasPrev) load(true, shiftYm(ym, -1)); });
$('cal-next').addEventListener('click', () => { if (hasNext) load(true, shiftYm(ym, 1)); });

$('tab-day').addEventListener('click', () => showView('day'));
$('tab-reg').addEventListener('click', () => showView('reg'));
$('reg-new').addEventListener('click', () => openRegForm(null));
$('reg-cancel').addEventListener('click', closeRegForm);
$('reg-save').addEventListener('click', (e) => saveRegular(e.currentTarget));
$('reg-repeat').addEventListener('change', syncRepeat);

// 増減ボタンは3行ぶんあるので、まとめて1か所で受ける
$('reg-cuts').addEventListener('click', (e) => {
  const btn = e.target.closest('.cut-btn');
  if (!btn || btn.disabled) return;
  const key = btn.closest('.cut').dataset.cut;
  const next = regCuts[key] + Number(btn.dataset.step);
  if (next < 0) return;
  regCuts[key] = next;
  say('reg-form-error', '');
  renderRegCuts();
});

KEY = loadKey();
if (!KEY) {
  // 鍵は端末ごとに保存される。PCで開けていても、電話では最初にここを通る
  showUnlock('');
} else {
  $('board').hidden = false;
  load();
}
