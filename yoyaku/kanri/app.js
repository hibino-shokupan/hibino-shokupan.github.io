/* &.&～日々の食パン～ ご予約の管理（お店専用）
 *
 * 仕組みと手順は C:\Users\kchic\claude code\LINE\design.md を参照。
 * サーバー側は同フォルダの gas\Code.gs が「正」。
 *
 * このページは URL の # 以降に入れた鍵で開く。鍵は初回に端末へ保存し、
 * アドレスからは消す（履歴や共有で鍵が漏れないようにするため）。
 */

/* ▼▼ GASをデプロイしたら、ここにウェブアプリのURLを貼る（お客様用と同じURL） ▼▼ */
const API_URL = 'ここにGASのウェブアプリURLを貼る';
/* ▲▲ https://script.google.com/macros/s/……/exec の形 ▲▲ */

const KEY_STORE = 'hibino-kanri-key';

const $ = (id) => document.getElementById(id);
let KEY = '';
let kinPerLoaf = 2;

const qtyText = (kin) => kin + '斤（' + kin / kinPerLoaf + '本）';

// ───────────────────────── 鍵 ─────────────────────────

function loadKey() {
  const fromHash = (location.hash.match(/key=([A-Za-z0-9_-]+)/) || [])[1];
  if (fromHash) {
    try { localStorage.setItem(KEY_STORE, fromHash); } catch (e) { /* 保存できなくても今回は動く */ }
    // アドレスバーから鍵を消す。履歴やスクリーンショットから漏れないように
    history.replaceState(null, '', location.pathname + location.search);
    return fromHash;
  }
  try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
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

// ───────────────────────── 表示 ─────────────────────────

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

async function load(quiet) {
  if (!quiet) $('updated').textContent = '読み込み中…';
  say('error', '');
  try {
    const data = await api({ action: 'admin', key: KEY });
    if (!data.ok) throw new Error(data.error || '読み込めませんでした。');
    kinPerLoaf = data.kinPerLoaf;
    render(data);
    const now = new Date();
    $('updated').textContent = '最終更新 '
      + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  } catch (e) {
    $('updated').textContent = '';
    $('list').innerHTML = '';
    say('error', e.message);
  }
}

function render(data) {
  const list = $('list');
  list.innerHTML = '';
  $('empty').hidden = data.dates.length > 0;

  data.dates.forEach((day) => {
    const block = el('section', 'day-block');

    const head = el('div', 'day-head');
    head.appendChild(el('span', 'day-label', day.label));
    const sum = el('span', 'day-sum');
    sum.innerHTML = 'ご予約 <b>' + qtyText(day.total) + '</b> ／ 残り ' + qtyText(day.remaining);
    head.appendChild(sum);
    block.appendChild(head);

    day.items.forEach((item) => block.appendChild(card(item, day)));
    list.appendChild(block);
  });
}

function card(item, day) {
  const cancelled = item.status === 'キャンセル';
  const node = el('article', 'card' + (cancelled ? ' is-cancelled' : ''));

  const top = el('div', 'card-top');
  top.appendChild(el('span', 'card-time', item.time));
  top.appendChild(el('span', 'card-name', item.name + ' 様'));
  top.appendChild(el('span', 'card-kin', qtyText(item.kin)));
  node.appendChild(top);

  const sub = el('p', 'card-sub');
  const tel = el('a', null, item.phone);
  tel.href = 'tel:' + item.phone.replace(/-/g, '');
  sub.appendChild(tel);
  node.appendChild(sub);

  if (item.note) node.appendChild(el('p', 'card-note', item.note));
  node.appendChild(el('p', 'card-id', '予約番号 ' + item.id));

  if (cancelled) {
    node.appendChild(el('span', 'cancelled-tag', 'キャンセル済み'));
    const undo = el('button', 'btn btn-undo', 'キャンセルを取り消す');
    undo.type = 'button';
    undo.addEventListener('click', () => setStatus(undo, item, day, '予約済'));
    node.appendChild(undo);
  } else {
    const cancel = el('button', 'btn btn-cancel', 'キャンセル');
    cancel.type = 'button';
    cancel.addEventListener('click', () => setStatus(cancel, item, day, 'キャンセル'));
    node.appendChild(cancel);
  }
  return node;
}

// ───────────────────────── 操作 ─────────────────────────

async function setStatus(btn, item, day, status) {
  const toCancel = status === 'キャンセル';
  const ask = toCancel
    ? day.label + '\n' + item.name + ' 様\n' + qtyText(item.kin) + '\n\nこのご予約をキャンセルしますか？'
    : day.label + '\n' + item.name + ' 様\n' + qtyText(item.kin) + '\n\nキャンセルを取り消して、ご予約に戻しますか？';
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

// ───────────────────────── 起動 ─────────────────────────

$('reload').addEventListener('click', () => { say('notice', ''); load(); });

KEY = loadKey();
if (!KEY) {
  say('error', 'このページを開くための鍵がありません。お店専用のURLから開いてください。');
  $('updated').textContent = '';
} else {
  load();
}
