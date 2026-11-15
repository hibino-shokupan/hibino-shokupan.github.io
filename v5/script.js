(() => {
  'use strict';
  // JS は「足すだけ」。最初の画面のスライドと、Instagram の流れる列だけを動かす。
  // JS が無い時・止まった時は、1枚目の写真と、横にずらせる投稿の列のまま。
  document.documentElement.classList.add('js');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const onMediaChange = (query, handler) => {
    if (query.addEventListener) query.addEventListener('change', handler);
    else if (query.addListener) query.addListener(handler);
  };

  // ---- 最初の画面のスライド（今のサイトと同じ順。5秒ごと。横にすべらせても動く。ボタンは置かない＝2026-11-15 本人） ----
  try {
    const root = document.querySelector('.hero__slides');
    const slides = root ? Array.prototype.slice.call(root.querySelectorAll('.hero__slide')) : [];
    const controls = root ? root.querySelector('.hero__controls') : null;
    if (slides.length > 1 && controls) {
      const progress = controls.querySelector('.hero__progress span');
      let index = 0, timer = null, paused = reduceMotion.matches;
      const show = next => {
        slides[index].classList.remove('is-active');
        index = (next + slides.length) % slides.length;
        slides[index].classList.add('is-active');
        root.dataset.activeSlide = slides[index].dataset.slide;
        if (progress) progress.style.width = `${(index + 1) / slides.length * 100}%`;
      };
      const stop = () => { if (timer) clearInterval(timer); timer = null; };
      const start = () => { stop(); if (!paused && !document.hidden) timer = setInterval(() => show(index + 1), 5000); };
      const setPaused = value => { paused = value; start(); };
      // 指で横にすべらせると、前・次の写真へ（2026-11-15 本人）。縦のすべりはページのスクロールのまま
      let startX = null, startY = null;
      root.addEventListener('pointerdown', event => { startX = event.clientX; startY = event.clientY; });
      root.addEventListener('pointerup', event => {
        if (startX === null) return;
        const dx = event.clientX - startX, dy = event.clientY - startY;
        startX = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { show(index + (dx < 0 ? 1 : -1)); start(); }
      });
      root.addEventListener('pointercancel', () => { startX = null; });
      root.addEventListener('dragstart', event => event.preventDefault());
      onMediaChange(reduceMotion, () => setPaused(reduceMotion.matches));
      document.addEventListener('visibilitychange', start);
      root.dataset.activeSlide = slides[0].dataset.slide;
      if (progress) progress.style.width = `${1 / slides.length * 100}%`;
      controls.hidden = false;
      setPaused(paused);
    }
  } catch (error) { /* 1枚目の写真のまま */ }

  // ---- Instagram の投稿・ジャムの写真を横に流す（列を2つ続けて、切れ目なく回す） ----
  // 指・トラックパッドで横にすべらせたり、マウスでドラッグしたりもできる。止めずに流れ続ける（2026-11-15 本人「スライドしたら流れが止まるのはやめて」）。
  // 指で触っている間・すべりの勢いが残っている間だけは、指の動きに任せる
  Array.prototype.forEach.call(document.querySelectorAll('.marquee'), marquee => {
    try {
      const track = marquee.querySelector('.marquee__track');
      if (!track) return;
      Array.prototype.slice.call(track.children).forEach(item => {
        const copy = item.cloneNode(true);
        copy.setAttribute('aria-hidden', 'true');
        Array.prototype.forEach.call(copy.querySelectorAll('a'), link => link.setAttribute('tabindex', '-1'));
        track.appendChild(copy);
      });
      marquee.classList.add('is-running');
      const reverse = marquee.classList.contains('ig-marquee');  // Instagram は右へ、ジャムは左へ
      const seconds = reverse ? 45 : 50;  // 元の列の長さを流すのにかかる時間
      let half = 0, pos = 0, expected = 0, last = 0, touching = false, drag = null, moved = false;
      const measure = () => { half = track.scrollWidth / 2; };
      const wrap = () => { if (half > 0) { while (pos >= half) pos -= half; while (pos < 0) pos += half; } };
      measure();
      marquee.addEventListener('touchstart', () => { touching = true; }, {passive: true});
      marquee.addEventListener('touchend', () => { touching = false; }, {passive: true});
      marquee.addEventListener('touchcancel', () => { touching = false; }, {passive: true});
      // マウスでつかんで横に動かす（指は、ふつうの横すべりで動く）
      marquee.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'mouse' || event.button !== 0) return;
        drag = {x: event.clientX, left: marquee.scrollLeft};
        moved = false;
      });
      addEventListener('pointermove', event => {
        if (!drag) return;
        const dx = event.clientX - drag.x;
        if (Math.abs(dx) > 4) { moved = true; marquee.classList.add('is-dragging'); }
        if (moved) marquee.scrollLeft = drag.left - dx;
      });
      addEventListener('pointerup', () => { drag = null; marquee.classList.remove('is-dragging'); });
      marquee.addEventListener('click', event => { if (moved) { event.preventDefault(); event.stopPropagation(); moved = false; } }, true);
      marquee.addEventListener('dragstart', event => event.preventDefault());
      const frame = now => {
        measure();  // 写真の読み込みや画面の幅で列の長さが変わるので、毎こま測る（最初に1回だけだと短く測れて、位置が巻き戻った）
        const actual = marquee.scrollLeft;
        const userMoved = Math.abs(actual - expected) > 1.5;  // 指・すべりの勢い・トラックパッドで動いている
        if (userMoved) pos = actual;
        const dt = last ? Math.min(now - last, 100) / 1000 : 0;
        last = now;
        if (!reduceMotion.matches && !touching && !drag && !userMoved && half > 0) {
          pos += (reverse ? -1 : 1) * half / seconds * dt;
          wrap();
          marquee.scrollLeft = pos;
        } else {
          pos = marquee.scrollLeft;
        }
        expected = marquee.scrollLeft;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    } catch (error) { /* 横にずらせる列のまま */ }
  });
})();
