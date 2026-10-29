(() => {
  "use strict";

  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const japanDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit"
  });
  let midnightTimer;

  // 日本の日付をUTCの器に入れ、閲覧する地域の時差を避ける。
  function todayInJapan(now) {
    const parts = Object.fromEntries(japanDate.formatToParts(now).map(part => [part.type, part.value]));
    return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  }

  function isBusinessDay(date) {
    const day = date.getUTCDay();
    return (day >= 4 || day === 0) && !(day === 0 && date.getUTCDate() >= 29);
  }

  function dateLabel(date) {
    return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日（${weekdays[date.getUTCDay()]}）`;
  }

  // 「次の5回」は今日を含めず、翌日から数える。
  function nextBusinessDays(today) {
    const dates = [];
    const date = new Date(today.getTime());
    while (dates.length < 5) {
      date.setUTCDate(date.getUTCDate() + 1);
      if (isBusinessDay(date)) dates.push(new Date(date.getTime()));
    }
    return dates;
  }

  function updateCalendar() {
    const now = new Date();
    const today = todayInJapan(now);
    const open = isBusinessDay(today);
    const nextDates = nextBusinessDays(today);
    const status = document.querySelector("[data-status]");

    document.querySelector("[data-status-title]").textContent = open ? "きょうは営業日です" : "きょうはお休みです";
    document.querySelector("[data-status-detail]").textContent = open
      ? "11:00〜15:00（売り切れ次第おわり）"
      : `次の営業日は${dateLabel(nextDates[0])}`;
    status.setAttribute("data-open", String(open));

    document.querySelectorAll("[data-weekday]").forEach(cell => {
      if (Number(cell.dataset.weekday) === today.getUTCDay()) {
        cell.setAttribute("aria-current", "date");
      } else {
        cell.removeAttribute("aria-current");
      }
    });

    // 第5日曜は、こよみの「今日」も休みの表示に揃える。
    const fifthSunday = today.getUTCDay() === 0 && today.getUTCDate() >= 29;
    document.querySelector("[data-sunday-label]").textContent = fifthSunday ? "休" : "営業";
    const sunday = document.querySelector("[data-weekday='0']");
    if (fifthSunday) sunday.setAttribute("data-exception", "true");
    else sunday.removeAttribute("data-exception");

    const items = nextDates.map(date => {
      const item = document.createElement("li");
      const time = document.createElement("time");
      time.setAttribute("datetime", date.toISOString().slice(0, 10));
      time.textContent = dateLabel(date);
      item.append(time);
      return item;
    });
    document.querySelector("[data-open-days]").replaceChildren(...items);
    document.querySelector("[data-upcoming]").hidden = false;

    // ページを開いたまま日付が変わっても、札を更新する。
    clearTimeout(midnightTimer);
    const nextMidnight = today.getTime() + 24 * 60 * 60 * 1000 - 9 * 60 * 60 * 1000;
    midnightTimer = setTimeout(updateCalendar, nextMidnight - now.getTime() + 1000);
  }

  updateCalendar();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateCalendar();
  });
})();
