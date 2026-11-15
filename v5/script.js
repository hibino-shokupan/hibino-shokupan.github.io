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

  // ---- 最初の画面のスライド（今のサイトと同じ順。5秒ごと。ボタンは置かない＝2026-11-15 本人） ----
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
      onMediaChange(reduceMotion, () => setPaused(reduceMotion.matches));
      document.addEventListener('visibilitychange', start);
      root.dataset.activeSlide = slides[0].dataset.slide;
      if (progress) progress.style.width = `${1 / slides.length * 100}%`;
      controls.hidden = false;
      setPaused(paused);
    }
  } catch (error) { /* 1枚目の写真のまま */ }

  // ---- Instagram の投稿を横に流す（列を2つ続けて、切れ目なく回す） ----
  try {
    const marquee = document.querySelector('.ig-marquee');
    const track = marquee ? marquee.querySelector('.ig-marquee__track') : null;
    if (track) {
      Array.prototype.slice.call(track.children).forEach(item => {
        const copy = item.cloneNode(true);
        copy.setAttribute('aria-hidden', 'true');
        Array.prototype.forEach.call(copy.querySelectorAll('a'), link => link.setAttribute('tabindex', '-1'));
        track.appendChild(copy);
      });
      marquee.classList.add('is-running');
    }
  } catch (error) { /* 横にずらせる列のまま */ }
})();
