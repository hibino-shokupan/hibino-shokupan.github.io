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
const LAYOUT_STORE = 'hibino-kanri-layout';
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
let regulars = [];   // 一覧。1件＝お一人（来られる日が複数あることもある）
let slots = [];      // 受取時間の選択肢

/* 定期の入力中の状態。
   同じ方が「第2木曜」「第3金曜」のように複数の日に来られることがあるので、
   来られる日は配列で持つ。1つにしか対応しない作りにすると、
   2つ目を足したときにお名前やお電話を2回入れることになる。 */
let editingKey = '';         // 変更中のカード。空なら新規追加
let editingCustomerId = '';
let regPatterns = [];        // [{id, repeat, when, time, cut4, cut5, cut0, status}]
let regRemoved = [];         // 画面から消した予定のID。保存のときに一緒に送る

// 店頭で母が代わりに入れるご予約
const resCuts = { cut4: 0, cut5: 0, cut0: 0 };
let searchTimer = null;

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

// ───────────────────────── 見え方 ─────────────────────────

/* 電話は2列、iPadは広く。端末ごとに別々に覚える。
   サーバーに持たせると、電話とiPadで同じ見え方に引きずられる。
   一度選んだら、更新しても何日あけても同じ見え方で開くこと。 */
const LAYOUTS = ['narrow', 'wide', 'table'];

function loadLayout() {
  try {
    const v = localStorage.getItem(LAYOUT_STORE);
    if (LAYOUTS.indexOf(v) >= 0) return v;
  } catch (e) { /* 読めなくても、画面幅から決められる */ }
  // まだ選んでいないときだけ画面幅で決める。iPad 10.2インチは縦810px・横1080px
  return window.innerWidth >= 760 ? 'wide' : 'narrow';
}

function setLayout(v, remember) {
  const pick = LAYOUTS.indexOf(v) >= 0 ? v : 'narrow';
  document.body.dataset.layout = pick;
  document.querySelectorAll('.lay').forEach((b) => {
    const on = b.dataset.layout === pick;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  if (!remember) return;
  try { localStorage.setItem(LAYOUT_STORE, pick); } catch (e) { /* 覚えられなくても今回は効く */ }
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
    if (data.slots && data.slots.length) slots = data.slots;
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
    $('new-res').hidden = true;
    return;
  }

  // 定休日と、もう空きの無い日には入れられない。押せるボタンを出すと期待させる
  $('new-res').hidden = !$('res-form').hidden || day.closed || day.remaining <= 0;

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

// ───────────── 店頭で代わりに入れるご予約 ─────────────

/* スマホ操作に慣れていないお客様が、来店時に「次は◯日に」と言われる。
   予約ページへ案内せず、母がその場で入れる。
   前日18時の締切は見ない（対面で聞いているため）が、1日の上限は必ず守る。 */

function fillResChoices() {
  const t = $('res-time');
  if (t.options.length === slots.length && slots.length) return;
  t.innerHTML = '';
  slots.forEach((x) => t.add(new Option(x, x)));
}

function openResForm() {
  const day = days[index];
  if (!day) return;
  $('res-form-day').textContent = day.label + '　残り ' + qtyText(day.remaining);
  $('res-search').value = '';
  hideHits();
  $('res-name').value = '';
  $('res-phone').value = '';
  fillResChoices();
  $('res-time').value = slots[0] || '';
  $('res-note').value = '';
  CUT_KEYS.forEach((k) => { resCuts[k] = 0; });
  renderResCuts();
  say('res-form-error', '');
  $('res-form').hidden = false;
  $('new-res').hidden = true;
  $('res-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeResForm() {
  $('res-form').hidden = true;
  hideHits();
  if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
  const day = days[index];
  $('new-res').hidden = !day || day.closed || day.remaining <= 0;
}

function hideHits() {
  $('res-hits').hidden = true;
  $('res-hits').innerHTML = '';
}

function renderResCuts() {
  const total = CUT_KEYS.reduce((n, k) => n + resCuts[k], 0);
  document.querySelectorAll('#res-cuts .cut').forEach((row) => {
    const key = row.dataset.cut;
    row.querySelector('[data-num]').textContent = resCuts[key];
    row.classList.toggle('is-on', resCuts[key] > 0);
    row.querySelectorAll('.cut-btn').forEach((b) => {
      b.disabled = Number(b.dataset.step) < 0 && resCuts[key] <= 0;
    });
  });
  const day = days[index];
  const box = $('res-cut-total');
  box.classList.toggle('is-zero', total === 0);
  if (total === 0) { box.textContent = 'カット数を入れてください'; return; }
  // その日の残りを超えていることは、押した時点で分かるようにする
  const over = day && total > day.remaining;
  box.classList.toggle('is-zero', !!over);
  box.textContent = over
    ? '合計 ' + qtyText(total) + '　この日の残り（' + qtyText(day.remaining) + '）を超えています'
    : '合計 ' + qtyText(total);
}

/** お名前の一部で、前に来られた方をさがす */
async function searchCustomers() {
  const q = $('res-search').value.trim();
  if (!q) { hideHits(); return; }
  try {
    const res = await api({ action: 'customers', key: KEY, q: q });
    if (!res.ok) { hideHits(); return; }
    const hits = res.customers || [];
    const box = $('res-hits');
    box.innerHTML = '';
    if (!hits.length) {
      box.appendChild(el('p', 'res-hit-none', '見つかりませんでした。下に直接書いてください。'));
    } else {
      hits.slice(0, 8).forEach((c) => {
        const b = el('button', 'res-hit');
        b.type = 'button';
        b.appendChild(el('span', 'res-hit-name', c.name + ' 様'));
        b.appendChild(el('span', 'res-hit-tel', c.phone || '（お電話なし）'));
        if (c.last) b.appendChild(el('span', 'res-hit-last', '前回 ' + c.last));
        b.addEventListener('click', () => {
          $('res-name').value = c.name;
          $('res-phone').value = c.phone;
          $('res-search').value = '';
          hideHits();
          say('res-form-error', '');
        });
        box.appendChild(b);
      });
    }
    box.hidden = false;
  } catch (e) {
    hideHits();   // さがせなくても、下に直接書けば入れられる
  }
}

async function saveReservation(btn) {
  const day = days[index];
  if (!day) return;
  const body = {
    action: 'admin_reserve', key: KEY,
    date: day.date,
    time: $('res-time').value,
    name: $('res-name').value.trim(),
    phone: $('res-phone').value.trim(),
    note: $('res-note').value.trim(),
    cut4: resCuts.cut4, cut5: resCuts.cut5, cut0: resCuts.cut0,
  };

  btn.disabled = true;
  btn.textContent = '入れています…';
  say('res-form-error', '');
  try {
    const res = await api(null, body);
    if (!res.ok) { say('res-form-error', res.error || '入れられませんでした。'); return; }
    closeResForm();
    await load(true);
    say('notice', res.message);
  } catch (e) {
    say('res-form-error', e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'この内容で入れる';
  }
}

function move(step) {
  const next = index + step;
  say('notice', '');
  say('error', '');
  // 入力中のご予約は、その日のものなので持ち越さない
  if (!$('res-form').hidden) closeResForm();

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
  if (!$('res-form').hidden) closeResForm();
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
  if (isReg) { closeCal(); if (!$('res-form').hidden) closeResForm(); }
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

  // 来られる日は複数あることがある。1行ずつ、いつ・何時・いくつ を並べる
  const list = el('div', 'reg-plans');
  (g.patterns || []).forEach((x) => {
    const plan = el('div', 'reg-plan' + (x.status === '停止' ? ' is-paused' : ''));
    plan.appendChild(el('p', 'reg-when', x.whenText + '　' + x.time));
    plan.appendChild(el('p', 'reg-kin', qtyText(x.kin)));
    plan.appendChild(el('p', 'reg-cuts', x.cuts));
    // 「本当にこの人は来るのか」を、設定ではなく実際の日付で確かめられるようにする
    if (!paused && x.next && x.next.length) {
      plan.appendChild(el('p', 'reg-next', '次は ' + x.next.join('、')));
    }
    list.appendChild(plan);
  });
  node.appendChild(list);

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
  if (paused) node.appendChild(el('span', 'cancelled-tag', '停止中'));

  const actions = el('div', 'reg-actions');
  const edit = el('button', 'btn btn-sub btn-small', '変更');
  edit.type = 'button';
  edit.addEventListener('click', () => openRegForm(g));

  const toggle = el('button', 'btn btn-small ' + (paused ? 'btn-undo' : 'btn-cancel'),
    paused ? '再開する' : '停止する');
  toggle.type = 'button';
  toggle.addEventListener('click', () => regStatus(toggle, g, paused ? '有効' : '停止'));

  // 削除は戻せない。停止と同じ「やめる側」の色にして、ふつうの操作と区別する
  const del = el('button', 'btn btn-cancel btn-small', '削除');
  del.type = 'button';
  del.addEventListener('click', () => regDelete(del, g));

  actions.append(edit, toggle, del);
  node.appendChild(actions);
  return node;
}

/** そのカードの予定のIDをぜんぶ。停止・削除はカード単位で行う */
const planIds = (g) => (g.patterns || []).map((x) => x.id).filter(Boolean);

/** 来られる日を1行でまとめた文。確認の問いかけに出す */
const planText = (g) => (g.patterns || []).map((x) => x.whenText).join('、');

// ───────────── 定期の入力（来られる日は何個でも） ─────────────

/* 第N曜日は '2-5'（第2金曜日）の形でまとめて1つの値として送る。
   Code.gs の parseNthDow_ と同じ形。片方だけ変えると保存した内容が読めなくなる。 */
function parseNthDow(when) {
  const m = /^([1-5])-([0-6])$/.exec(String(when || '').trim());
  return m ? { nth: m[1], dow: m[2] } : null;
}

function blankPattern() {
  return {
    id: '', repeat: '毎週', when: '4', time: slots[0] || '',
    cut4: 0, cut5: 0, cut0: 0, status: '有効',
  };
}

function fillRegChoices() {
  // 日にちの選択肢は型（template）の中にあるので、複製するたびに入れる
  const t = $('tpl-pattern').content.querySelector('.p-dom');
  if (!t.options.length) for (let i = 1; i <= 31; i++) t.add(new Option(i + '日', String(i)));
}

function openRegForm(g) {
  editingKey = g ? g.key : '';
  editingCustomerId = g ? (g.customerId || '') : '';
  regRemoved = [];
  $('reg-form-title').textContent = g ? g.name + ' 様の内容を変える' : '定期のお客様を追加';
  $('reg-name').value = g ? g.name : '';
  $('reg-phone').value = g ? g.phone : '';
  $('reg-start').value = g ? g.start : '';
  $('reg-end').value = g ? g.end : '';
  $('reg-note').value = g ? g.note : '';

  regPatterns = (g && g.patterns && g.patterns.length)
    ? g.patterns.map((x) => ({
        id: x.id, repeat: x.repeat, when: x.when, time: x.time,
        cut4: Number(x.cut4) || 0, cut5: Number(x.cut5) || 0, cut0: Number(x.cut0) || 0,
        status: x.status || '有効',
      }))
    : [blankPattern()];

  renderPatterns();
  say('reg-form-error', '');
  $('reg-form').hidden = false;
  $('reg-new').hidden = true;
  $('reg-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeRegForm() {
  $('reg-form').hidden = true;
  $('reg-new').hidden = false;
  editingKey = '';
  editingCustomerId = '';
  regPatterns = [];
  regRemoved = [];
}

/* 来られる日の欄を、いまの regPatterns のぶんだけ作り直す。
   選択肢を触るたびに作り直すと入力中の欄から指が外れるので、
   作り直すのは「増やす・消す・開く」のときだけ。
   選んだ内容はその場で regPatterns に書き戻すので、作り直しても消えない。 */
function renderPatterns() {
  const box = $('reg-patterns');
  box.innerHTML = '';
  regPatterns.forEach((p, i) => box.appendChild(patternBlock(p, i)));
  // 1つしか無いときに消せると、来られる日が0の定期ができてしまう
  box.querySelectorAll('.pattern-del').forEach((b) => { b.hidden = regPatterns.length < 2; });
}

function patternBlock(p, i) {
  const node = $('tpl-pattern').content.firstElementChild.cloneNode(true);
  const pick = (sel) => node.querySelector(sel);

  node.querySelector('.pattern-no').textContent = (i + 1) + 'つ目';

  const time = pick('.p-time');
  slots.forEach((x) => time.add(new Option(x, x)));
  time.value = p.time || slots[0] || '';
  time.addEventListener('change', () => { p.time = time.value; });

  const repeat = pick('.p-repeat');
  repeat.value = p.repeat;

  const dow = pick('.p-dow');
  const dom = pick('.p-dom');
  const nth = pick('.p-nth');
  const nthdow = pick('.p-nthdow');

  // 使わない欄も既定のままにしておく。前の値が残ると、繰り返しを変えた瞬間に化ける
  dow.value = '4';
  dom.value = '1';
  nth.value = '2';
  nthdow.value = '5';
  if (p.repeat === '毎月') {
    dom.value = p.when;
  } else if (p.repeat === '第N曜日') {
    const q = parseNthDow(p.when);
    if (q) { nth.value = q.nth; nthdow.value = q.dow; }
  } else {
    dow.value = p.when;
  }

  const sync = () => {
    p.repeat = repeat.value;
    pick('.p-field-dow').hidden = p.repeat !== '毎週';
    pick('.p-field-nth').hidden = p.repeat !== '第N曜日';
    pick('.p-field-dom').hidden = p.repeat !== '毎月';
    p.when = p.repeat === '毎月' ? dom.value
      : (p.repeat === '第N曜日' ? nth.value + '-' + nthdow.value : dow.value);
  };
  [repeat, dow, dom, nth, nthdow].forEach((s) => s.addEventListener('change', sync));
  sync();

  const total = node.querySelector('.p-cut-total');
  const paint = () => {
    const sum = CUT_KEYS.reduce((n, k) => n + p[k], 0);
    node.querySelectorAll('.p-cuts .cut').forEach((row) => {
      const key = row.dataset.cut;
      row.querySelector('[data-num]').textContent = p[key];
      row.classList.toggle('is-on', p[key] > 0);
      row.querySelectorAll('.cut-btn').forEach((b) => {
        b.disabled = Number(b.dataset.step) < 0 && p[key] <= 0;
      });
    });
    total.classList.toggle('is-zero', sum === 0);
    total.textContent = sum === 0 ? 'カット数を入れてください' : '合計 ' + qtyText(sum);
  };
  node.querySelector('.p-cuts').addEventListener('click', (e) => {
    const btn = e.target.closest('.cut-btn');
    if (!btn || btn.disabled) return;
    const key = btn.closest('.cut').dataset.cut;
    const next = p[key] + Number(btn.dataset.step);
    if (next < 0) return;
    p[key] = next;
    say('reg-form-error', '');
    paint();
  });
  paint();

  node.querySelector('.pattern-del').addEventListener('click', () => {
    if (regPatterns.length < 2) return;
    // 保存済みの予定は、サーバー側でも消してもらう必要がある
    if (p.id) regRemoved.push(p.id);
    regPatterns.splice(regPatterns.indexOf(p), 1);
    say('reg-form-error', '');
    renderPatterns();
  });

  return node;
}

function addPattern() {
  if (regPatterns.length >= 6) {
    say('reg-form-error', '来られる日は6つまでです。');
    return;
  }
  const last = regPatterns[regPatterns.length - 1];
  // 2つ目以降は、直前の内容を写してから直すほうが早い
  regPatterns.push(last
    ? { id: '', repeat: last.repeat, when: last.when, time: last.time,
        cut4: last.cut4, cut5: last.cut5, cut0: last.cut0, status: '有効' }
    : blankPattern());
  say('reg-form-error', '');
  renderPatterns();
  $('reg-patterns').lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function saveRegular(btn) {
  const reg = {
    customerId: editingCustomerId,
    name: $('reg-name').value.trim(),
    phone: $('reg-phone').value.trim(),
    start: $('reg-start').value,
    end: $('reg-end').value,
    note: $('reg-note').value.trim(),
    patterns: regPatterns.map((p) => ({
      id: p.id, repeat: p.repeat, when: p.when, time: p.time,
      cut4: p.cut4, cut5: p.cut5, cut0: p.cut0,
      // 停止中の予定は、内容を直しても停止したまま。勝手に再開させない
      status: p.status || '有効',
    })),
    removed: regRemoved,
  };

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
  const ask = g.name + ' 様（' + planText(g) + '）\n\n'
    + (status === '停止'
        ? 'この方の定期を止めますか？\nこれから先の分が、ご予約の枠に戻ります。'
        : 'この方の定期を再開しますか？');
  if (!window.confirm(ask)) return;
  await regAction(btn, { action: 'reg_status', key: KEY, ids: planIds(g), status: status });
}

async function regDelete(btn, g) {
  if (!window.confirm(g.name + ' 様（' + planText(g) + '）\n\n'
    + 'この方の定期を、来られる日ごと すべて削除しますか？\n'
    + '記録も消えます。しばらく来られないだけなら「停止する」のほうが安全です。')) return;
  await regAction(btn, { action: 'reg_delete', key: KEY, ids: planIds(g) });
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
$('reg-add-pattern').addEventListener('click', addPattern);

// 店頭で代わりに入れるご予約
$('new-res').addEventListener('click', openResForm);
$('res-cancel').addEventListener('click', closeResForm);
$('res-save').addEventListener('click', (e) => saveReservation(e.currentTarget));
$('res-search').addEventListener('input', () => {
  // 1文字ごとに問い合わせると、打ち終わる前に何度も待たされる
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(searchCustomers, 350);
});

// 増減ボタンは3行ぶんあるので、まとめて1か所で受ける
$('res-cuts').addEventListener('click', (e) => {
  const btn = e.target.closest('.cut-btn');
  if (!btn || btn.disabled) return;
  const key = btn.closest('.cut').dataset.cut;
  const next = resCuts[key] + Number(btn.dataset.step);
  if (next < 0) return;
  resCuts[key] = next;
  say('res-form-error', '');
  renderResCuts();
});

// 見え方。押した瞬間に変わり、その端末に覚える
document.querySelectorAll('.lay').forEach((b) => {
  b.addEventListener('click', () => setLayout(b.dataset.layout, true));
});
setLayout(loadLayout(), false);
fillRegChoices();

KEY = loadKey();
if (!KEY) {
  // 鍵は端末ごとに保存される。PCで開けていても、電話では最初にここを通る
  showUnlock('');
} else {
  $('board').hidden = false;
  load();
}
