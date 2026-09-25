/* &.&～日々の食パン～ ご予約ページ
 *
 * 仕組みと手順は C:\Users\kchic\claude code\LINE\design.md を参照。
 * サーバー側（Google Apps Script）のソースは同フォルダの gas\Code.gs が「正」。
 *
 * 数量は「斤」で扱う。注文は1斤単位で、本数は 斤÷2（0.5刻み）の表示用。
 */

/* ▼▼ GASをデプロイしたら、ここにウェブアプリのURLを貼る ▼▼ */
const API_URL = 'https://script.google.com/macros/s/AKfycbyggmGYQnjH77zXWvWeuqfwoEHyOu8dfQA1kGE2v2tDJV7j37eJjyJh9gjSaQvULAyD/exec';
/* ▲▲ https://script.google.com/macros/s/……/exec の形 ▲▲ */

const TEL = '0986-51-0511';

const $ = (id) => document.getElementById(id);
const DOW = ['日', '月', '火', '水', '木', '金', '土'];

let slowTimer = null;    // 「時間がかかっています」を出すまでのタイマー

const CUT_KEYS = ['cut4', 'cut5', 'cut0'];
const CUT_NAMES = { cut4: '4枚切り', cut5: '5枚切り', cut0: 'カットなし' };

const state = {
  ym: null,        // 表示中の月 'yyyy-MM'
  cal: null,       // サーバーから受け取った月データ
  date: null,      // 選んだ受取日 'yyyy-MM-dd'
  remaining: 0,    // その日の残り（斤）
  cuts: { cut4: 0, cut5: 0, cut0: 0 },   // 厚さごとの斤数。合計が注文の斤数になる
  entry: null,     // 確認画面に出している内容
};

/** いま積んである合計（斤） */
const cutTotal = () => CUT_KEYS.reduce((n, k) => n + state.cuts[k], 0);

/** 「4枚切り 2斤 ／ カットなし 1斤」。0のものは出さない。Code.gs の cutsText_ と揃えること */
function cutsText(c) {
  const parts = CUT_KEYS.filter((k) => c[k] > 0).map((k) => CUT_NAMES[k] + ' ' + c[k] + '斤');
  return parts.length ? parts.join(' ／ ') : '—';
}

/** 「3斤（1.5本）」の形にそろえる。Code.gs の qty_() と同じ */
const qtyText = (kin) => kin + '斤（' + kin / state.cal.kinPerLoaf + '本）';

// ───────────────────────── 通信 ─────────────────────────

/* サーバー（GAS）は起動に時間がかかり、初回は20秒近いこともある。
   いつまでも待たせず、かといって数秒で諦めもしない値にしてある。 */
const TIMEOUT_MS = 40000;

async function api(params, body) {
  if (API_URL.indexOf('http') !== 0) {
    throw new Error('予約システムの設定が未完了です。お手数ですがお電話（' + TEL + '）でご注文ください。');
  }
  const url = API_URL + (params ? '?' + new URLSearchParams(params) : '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const opt = body
    // text/plain で送ると事前確認（プリフライト）が走らず、GASと通信できる
    ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctrl.signal }
    : { method: 'GET', signal: ctrl.signal };

  let res;
  try {
    res = await fetch(url, opt);
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error('サーバーの応答がありませんでした。もう一度お試しいただくか、'
        + 'お急ぎの場合はお電話（' + TEL + '）でご注文ください。');
    }
    throw new Error('通信できませんでした。電波の良い場所でもう一度お試しください。');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error('通信に失敗しました（' + res.status + '）。少し時間をおいてお試しください。');
  return res.json();
}

// ───────────────────────── ステップの切り替え ─────────────────────────

function showStep(id) {
  ['step-date', 'step-form', 'step-confirm', 'step-done'].forEach((s) => { $(s).hidden = (s !== id); });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showError(id, message) {
  const el = $(id);
  if (!message) { el.hidden = true; return; }
  el.textContent = message;
  el.hidden = false;
  // ボタンの下に出るため、そのままだと画面外で気づかれない
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ───────────────────────── カレンダー ─────────────────────────

/** 待っているのか止まっているのか分かるようにする */
function setLoading(on) {
  $('cal-loading').hidden = !on;
  // 空の枠（min-height 260px）を残すと、読み込み表示が画面の下に押しやられる
  $('cal-grid').hidden = on;
  $('loading-slow').hidden = true;
  if (slowTimer) { clearTimeout(slowTimer); slowTimer = null; }
  if (on) {
    // 数秒で出すと、速いときに不安を煽るだけになる
    slowTimer = setTimeout(() => { $('loading-slow').hidden = false; }, 6000);
  }
}

async function loadCalendar(ym) {
  showError('cal-error', '');
  $('cal-retry').hidden = true;     // 隠すのはここだけ。setLoading では触らない
  $('cal-title').textContent = '読み込み中';
  $('cal-grid').innerHTML = '';
  setLoading(true);
  try {
    const data = await api(ym ? { action: 'calendar', ym } : { action: 'calendar' });
    if (!data.ok) throw new Error(data.error || 'カレンダーを読み込めませんでした。');
    state.cal = data;
    state.ym = data.ym;
    renderCalendar();
  } catch (e) {
    $('cal-title').textContent = '—';
    $('cal-grid').innerHTML = '';
    showError('cal-error', e.message);
    $('cal-retry').hidden = false;
  } finally {
    setLoading(false);
  }
}

function renderCalendar() {
  const cal = state.cal;
  const [y, m] = cal.ym.split('-').map(Number);
  $('cal-title').textContent = y + '年 ' + m + '月';
  $('prev-month').disabled = !cal.hasPrev;
  $('next-month').disabled = !cal.hasNext;

  const grid = $('cal-grid');
  grid.innerHTML = '';

  // 1日の曜日まで空きマスを置く
  for (let i = 0; i < cal.days[0].dow; i++) {
    const blank = document.createElement('div');
    blank.className = 'day is-blank';
    grid.appendChild(blank);
  }

  cal.days.forEach((day) => {
    const open = day.status === 'open';
    const cell = document.createElement(open ? 'button' : 'div');
    cell.className = 'day ' + (open ? 'is-open' : 'is-off');
    if (open) cell.type = 'button';
    // 選択中の日が完売・休みに変わることがある。選べない日に選択状態を残すと、
    // 白抜きの文字が背景に溶けて「×」が消えてしまう
    if (open && day.date === state.date) cell.classList.add('is-selected');

    const d = document.createElement('span');
    d.className = 'd';
    d.textContent = Number(day.date.slice(8));
    cell.appendChild(d);

    // 空いている日は、残りを斤数の実数で出す（記号より、あと何斤買えるかが直に分かる）
    const mark = document.createElement('i');
    const many = day.remaining > Math.floor(cal.dailyLimit / 3);
    mark.className = 'mk ' + ({
      open: many ? 'mk-many' : 'mk-few',
      full: 'mk-full',
      closed: 'mk-closed',
    }[day.status] || 'mk-closed');
    // 凡例を置いていないので、記号ではなく言葉で出す
    mark.textContent = ({
      open: '残り' + day.remaining + '斤',
      full: '完売',
      closed: '休',
    }[day.status] || '');
    cell.appendChild(mark);

    if (open) {
      cell.setAttribute('aria-label',
        m + '月' + Number(day.date.slice(8)) + '日 ' + DOW[day.dow] + '曜日 残り'
        + day.remaining + '斤、' + day.remaining / cal.kinPerLoaf + '本');
      cell.addEventListener('click', () => selectDate(day));
    }
    grid.appendChild(cell);
  });
}

function shiftMonth(step) {
  const [y, m] = state.ym.split('-').map(Number);
  const d = new Date(y, m - 1 + step, 1);
  loadCalendar(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
}

// ───────────────────────── 入力 ─────────────────────────

function selectDate(day) {
  state.date = day.date;
  state.remaining = day.remaining;

  $('chosen-date').textContent = formatDateJa(day.date);
  $('chosen-remaining').textContent = 'この日の残り ' + qtyText(day.remaining);

  // 日を変えたら積んだ斤数は捨てる。前の日の残数に合わせた数が残ると辻褄が合わない
  CUT_KEYS.forEach((k) => { state.cuts[k] = 0; });
  renderCuts();

  const time = $('time');
  if (!time.options.length) {
    state.cal.slots.forEach((s) => time.add(new Option(s, s)));
  }

  showError('form-error', '');
  showStep('step-form');
}

/** 画面の数字・合計・ボタンの押せる押せないを、いまの state に合わせる */
function renderCuts() {
  const total = cutTotal();
  const left = state.remaining - total;

  document.querySelectorAll('.cut').forEach((row) => {
    const key = row.dataset.cut;
    const n = state.cuts[key];
    row.querySelector('[data-num]').textContent = n;
    row.classList.toggle('is-on', n > 0);
    row.querySelectorAll('.cut-btn').forEach((btn) => {
      const step = Number(btn.dataset.step);
      // その日の残りを超えて積めないようにする。減らす側は0で止める
      btn.disabled = step > 0 ? left <= 0 : n <= 0;
    });
  });

  const el = $('cut-total');
  el.classList.toggle('is-zero', total === 0);
  // 「6斤（3本）（残り4斤）」とカッコが二重になると読みにくいので、間は全角space
  el.textContent = total === 0
    ? 'カット数をお選びください'
    : '合計 ' + qtyText(total) + '　この日の残り ' + left + '斤';
}

function stepCut(key, step) {
  const next = state.cuts[key] + step;
  if (next < 0) return;
  if (step > 0 && cutTotal() >= state.remaining) return;
  state.cuts[key] = next;
  showError('form-error', '');
  renderCuts();
}

function readForm() {
  const cuts = Object.assign({}, state.cuts);
  return {
    date: state.date,
    time: $('time').value,
    name: $('name').value.trim(),
    phone: $('phone').value.trim(),
    note: $('note').value.trim(),
    kin: cutTotal(),
    cut4: cuts.cut4,
    cut5: cuts.cut5,
    cut0: cuts.cut0,
  };
}

/** 画面側の確認。サーバー側でも同じ内容を必ず検査している。 */
function validate(v) {
  if (!v.date) return '受取日を選んでください。';
  if (!v.time) return 'お受け取りの時間を選んでください。';
  // カット数を1つも選んでいなければ合計0斤。ここで止めるので確定まで進めない
  if (!v.kin) return 'カット数をお選びください。4枚切り・5枚切り・カットなしのいずれかに、斤数を入れてください。';
  if (v.kin > state.remaining) return 'この日の残りは ' + qtyText(state.remaining) + ' です。数量を減らしてください。';
  if (!v.name) return 'お名前をフルネームでご記入ください。';
  const digits = v.phone.replace(/-/g, '');
  if (!/^\d{10,11}$/.test(digits)) return 'お電話番号は数字10桁または11桁でご記入ください。';
  return null;
}

// ───────────────────────── 確認・送信 ─────────────────────────

function renderSummary(el, v) {
  const rows = [
    ['受取日', formatDateJa(v.date)],
    ['お時間', v.time],
    ['数量', qtyText(v.kin)],
    ['カット', cutsText(v)],
    ['お名前', v.name + ' 様'],
    ['お電話', v.phone],
    ['備考', v.note || '—'],
  ];
  el.innerHTML = '';
  rows.forEach(([k, value]) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = k;
    dd.textContent = value;
    row.append(dt, dd);
    el.appendChild(row);
  });
}

async function submit() {
  const btn = $('submit');
  btn.disabled = true;
  btn.textContent = '送信中…';
  showError('confirm-error', '');

  try {
    const res = await api(null, Object.assign({ action: 'reserve' }, state.entry));
    if (!res.ok) {
      // 送信するまでの間に他の方の予約で埋まった場合など。
      // 断られた理由が何であれ、手元のカレンダーは古い可能性があるので読み直す
      showError('confirm-error', res.error || 'ご予約をお受けできませんでした。');
      await loadCalendar(state.ym);
      return;
    }
    $('done-id').textContent = res.id;
    renderSummary($('done-list'), state.entry);
    showStep('step-done');
  } catch (e) {
    showError('confirm-error', e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '予約を確定する';
  }
}

function formatDateJa(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return m + '月' + d + '日（' + DOW[new Date(y, m - 1, d).getDay()] + '）';
}

// ───────────────────────── 起動 ─────────────────────────

// 増減ボタンは3行ぶんあるので、まとめて1か所で受ける
$('cuts').addEventListener('click', (e) => {
  const btn = e.target.closest('.cut-btn');
  if (!btn || btn.disabled) return;
  stepCut(btn.closest('.cut').dataset.cut, Number(btn.dataset.step));
});

$('cal-retry').addEventListener('click', () => loadCalendar(state.ym));
$('prev-month').addEventListener('click', () => shiftMonth(-1));
$('next-month').addEventListener('click', () => shiftMonth(1));
$('change-date').addEventListener('click', () => showStep('step-date'));
$('back').addEventListener('click', () => showStep('step-form'));
$('submit').addEventListener('click', submit);

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = readForm();
  const problem = validate(v);
  if (problem) { showError('form-error', problem); return; }

  state.entry = v;
  renderSummary($('confirm-list'), v);
  showError('confirm-error', '');
  showStep('step-confirm');
});

loadCalendar();
