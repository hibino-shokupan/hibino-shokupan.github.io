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
let days = [];       // サーバーから受け取った日の一覧
let index = 0;       // いま見ている日

const qtyText = (kin) => kin + '斤（' + kin / kinPerLoaf + '本）';

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

async function load(quiet) {
  if (!quiet) $('updated').textContent = '読み込み中…';
  say('error', '');
  try {
    const data = await api({ action: 'admin', key: KEY });
    if (!data.ok) throw new Error(data.error || '読み込めませんでした。');
    kinPerLoaf = data.kinPerLoaf;

    // 見ていた日をできるだけ保つ。消えていたら近い日へ寄せる
    const keeping = days[index] ? days[index].date : null;
    days = data.dates || [];
    if (keeping) {
      const found = days.findIndex((d) => d.date === keeping);
      index = found >= 0 ? found : Math.min(index, days.length - 1);
    }
    if (index < 0 || index >= days.length) index = 0;

    render();
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
  $('prev-day').disabled = index <= 0;
  $('next-day').disabled = index >= days.length - 1;

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
  $('day-sum').innerHTML = day.closed
    ? '<b>定休日</b>'
    : 'ご予約 <b>' + qtyText(kin) + '</b>　' + live.length + '件'
      + '<span class="day-left">残り ' + qtyText(day.remaining) + '</span>';

  const grid = $('grid');
  grid.innerHTML = '';
  day.items.forEach((item) => grid.appendChild(card(item, day)));

  $('empty').hidden = day.items.length > 0;
  $('empty').textContent = day.closed ? 'この日は定休日です。' : 'この日のご予約はまだありません。';
}

function card(item, day) {
  const cancelled = item.status === CANCELLED;
  const node = el('article', 'card' + (cancelled ? ' is-cancelled' : ''));

  node.appendChild(el('p', 'card-time', item.time));
  node.appendChild(el('p', 'card-name', item.name + ' 様'));
  node.appendChild(el('p', 'card-kin', qtyText(item.kin)));

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

// ───────────────────────── 操作 ─────────────────────────

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
  if (next < 0 || next >= days.length) return;
  index = next;
  say('notice', '');
  say('error', '');
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ───────────────────────── 起動 ─────────────────────────

$('prev-day').addEventListener('click', () => move(-1));
$('next-day').addEventListener('click', () => move(1));
$('reload').addEventListener('click', () => { say('notice', ''); load(); });
$('unlock-go').addEventListener('click', unlock);
$('unlock-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });

KEY = loadKey();
if (!KEY) {
  // 鍵は端末ごとに保存される。PCで開けていても、電話では最初にここを通る
  showUnlock('');
} else {
  $('board').hidden = false;
  load();
}
