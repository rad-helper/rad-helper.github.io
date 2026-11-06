/* =====================================================================
   «Что я нашёл»: инструменты-находки (папка tools/).
   Вводишь признаки — сайт показывает вывод, что учесть и диф ряд.
   Ничего из этого не копируется в заключение: это повод задуматься.

   Формат файла tools/*.md — см. README.md, раздел «Находки».
   Коротко:
     # Параметры   имя: Подпись = число            — поле для числа
                   имя: Подпись = а | б | в        — кнопки, первая выбрана по умолчанию
                   … ; если risk = нет             — строка видна только при условии;
                                                    скрытая — как пустая («не знаю»)
     # Расчёты     имя: Подпись = формула           — + − * / ( ) и имена параметров;
                                                    [условие] — 1, если выполнено, иначе 0;
                                                    имя с _ в начале — считается, но не показывается
     # Вывод       - условие → текст                — срабатывает ПЕРВОЕ подходящее сверху
     # Учесть      - условие → текст                — показываются ВСЕ подходящие
     # Диф ряд     - Диагноз | ссылка               — «- ! Диагноз» = не пропустить
                     + условие: пояснение           — за (++ — весомее)
                     - условие: пояснение           — против (-- — весомее)
                     > текст                        — заметка, видна всегда
   Условие: имя = значение, имя != значение, имя < 10, <=, >, >=,
            «и», «или» («и» связывает сильнее), «иначе» — всегда да,
            просто «имя» — значение введено/посчиталось.
   Пустое поле — «не знаю»: условие с ним не срабатывает.
   ===================================================================== */
window.RH_FINDINGS = (function () {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = s => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  const num = v => parseFloat(String(v).replace(",", "."));
  const lower = s => s.toLowerCase().replace(/ё/g, "е");

  /* ---------- Разбор файла ---------- */
  function parse(text) {
    const tool = { intro: "", params: [], calcs: [], rules: [], notes: [], ddx: [], src: "", errors: [] };
    let part = "";
    let dx = null;
    text.replace(/\r/g, "").split("\n").forEach((raw, n) => {
      const t = raw.trim();
      if (!t) return;
      if (/^# /.test(t)) { part = lower(t.slice(2).trim()); dx = null; return; }
      if (/^Источник:/.test(t)) { tool.src = t; return; }
      if (/^> ?/.test(t) && !part) { tool.intro = t.replace(/^> ?/, ""); return; }
      const bad = () => tool.errors.push("строка " + (n + 1) + ": " + t);

      if (part === "параметры") {
        const when = t.match(/\s*;\s*если\s+(.+)$/i);
        const line = when ? t.slice(0, when.index) : t;
        const m = line.match(/^([\wа-яё]+)\s*:\s*(.+?)\s*=\s*(.+)$/i);
        if (!m) return bad();
        const kind = lower(m[3]) === "число" ? "num" : "pick";
        tool.params.push({ id: m[1], label: m[2], kind, when: when ? when[1] : "",
          options: kind === "pick" ? m[3].split("|").map(s => s.trim()) : [] });
      } else if (part === "расчеты") {
        const m = t.match(/^([\wа-яё]+)\s*:\s*(.+?)\s*=\s*(.+)$/i);
        if (!m) return bad();
        tool.calcs.push({ id: m[1], label: m[2], expr: m[3] });
      } else if (part === "вывод" || part === "учесть") {
        const m = t.match(/^-\s+(.+?)\s*→\s*(.+)$/);
        if (!m) return;                       // строка-пояснение без стрелки — пропускаем
        (part === "вывод" ? tool.rules : tool.notes).push({ cond: m[1], text: m[2] });
      } else if (part === "диф ряд") {
        const indented = /^\s/.test(raw);
        if (!indented) {
          const m = t.match(/^-\s+(!\s*)?(.+?)(?:\s*\|\s*(https?:\/\/\S+))?$/);
          if (!m) return bad();
          dx = { name: m[2], url: m[3] || "", must: !!m[1], signs: [], notes: [] };
          tool.ddx.push(dx);
          return;
        }
        if (!dx) return bad();
        let m;
        if ((m = t.match(/^>\s*(.+)$/))) dx.notes.push(m[1]);
        else if ((m = t.match(/^(\+\+|\+|--|-|−−|−)\s+(.+?)\s*:\s*(.+)$/))) {
          const w = m[1].replace(/−/g, "-");
          dx.signs.push({ w: w === "++" ? 2 : w === "+" ? 1 : w === "--" ? -2 : -1, cond: m[2], text: m[3] });
        } else bad();
      }
    });
    return tool;
  }

  /* ---------- Значения и условия ---------- */
  // какие строки видны: условие «; если …» считается по уже видимым строкам
  function visible(tool, state) {
    const shown = {};
    tool.params.forEach(p => { shown[p.id] = !p.when; });
    for (let pass = 0; pass < 3; pass++) {
      const v = values(tool, state, shown, true);
      tool.params.forEach(p => { if (p.when) shown[p.id] = test(p.when, v); });
    }
    return shown;
  }

  function values(tool, state, shown, noCalc) {
    const v = {};
    tool.params.forEach(p => {
      if (shown && !shown[p.id]) return;
      const x = state[p.id];
      if (p.kind === "num") { const n = num(x); if (isFinite(n)) v[p.id] = n; }
      else if (x) v[p.id] = x;
    });
    if (noCalc) return v;
    tool.calcs.forEach(c => {
      const x = evalExpr(c.expr, v);
      if (x !== undefined) v[c.id] = x;
    });
    return v;
  }

  function evalExpr(expr, v) {
    let missing = false;
    // [условие] → 1 или 0: так считают, сколько признаков есть
    expr = expr.replace(/\[([^\]]+)\]/g, (_, c) => test(c, v) ? "1" : "0");
    const js = expr.replace(/[a-zа-яё_][\wа-яё]*/gi, name => {
      if (typeof v[name] !== "number") { missing = true; return "0"; }
      return "(" + v[name] + ")";
    });
    if (missing || !/^[\d.\s+\-*/()e]+$/.test(js)) return undefined;
    try {
      const x = Function('"use strict"; return (' + js + ")")();
      return isFinite(x) ? x : undefined;
    } catch (e) { return undefined; }
  }

  function test(cond, v) {
    return cond.split(/\s+или\s+/).some(any =>
      any.split(/\s+и\s+/).every(one => atom(one.trim(), v)));
  }
  function atom(s, v) {
    if (lower(s) === "иначе") return true;
    const m = s.match(/^([\wа-яё]+)\s*(<=|>=|!=|=|<|>)\s*(.+)$/i);
    if (!m) return v[s] !== undefined;          // просто имя — значение есть
    const have = v[m[1]];
    if (have === undefined) return false;       // не введено — не знаем
    const want = m[3].trim();
    if (typeof have === "number") {
      const w = num(want);
      return m[2] === "<" ? have < w : m[2] === "<=" ? have <= w : m[2] === ">" ? have > w :
        m[2] === ">=" ? have >= w : m[2] === "!=" ? have !== w : have === w;
    }
    const same = lower(have) === lower(want);
    return m[2] === "!=" ? !same : m[2] === "=" ? same : false;
  }

  /* ---------- Отрисовка ---------- */
  function render(tool, el) {
    const state = {};
    tool.params.forEach(p => { state[p.id] = p.kind === "pick" ? p.options[0] : ""; });

    el.innerHTML =
      (tool.errors.length ? '<p class="err">Не разобраны строки файла: ' + tool.errors.map(esc).join("; ") + "</p>" : "") +
      (tool.intro ? '<p class="fx-intro">' + inline(tool.intro) + "</p>" : "") +
      '<div class="fx-form">' + tool.params.map(p =>
        '<div class="fx-row" data-row="' + esc(p.id) + '"><span class="fx-label">' + esc(p.label) + "</span>" +
        (p.kind === "num"
          ? '<input class="fx-num" type="text" inputmode="decimal" autocomplete="off" data-id="' + esc(p.id) + '" placeholder="—">'
          : '<span class="fx-opts">' + p.options.map((o, i) =>
              '<button type="button" class="fx-opt" data-id="' + esc(p.id) + '" data-o="' + esc(o) + '" aria-pressed="' + (i === 0) + '">' +
              esc(o) + "</button>").join("") + "</span>") +
        "</div>").join("") + "</div>" +
      '<div class="fx-calc"></div><div class="fx-out"></div>' +
      (tool.src ? '<div class="fx-src"><div class="fx-src-h">Работает строго по источникам</div><ul>' +
        tool.src.replace(/^Источник:\s*/, "").split(/;\s+(?=[A-ZА-ЯЁ])/).map(x => "<li>" + inline(x.trim()) + "</li>").join("") +
        '</ul><div class="fx-src-n">Пороги и тактика — по этим источникам. Диф ряд «Подумать о» — справочно, вне источников.</div></div>' : "");

    const calcEl = el.querySelector(".fx-calc");
    const outEl = el.querySelector(".fx-out");

    function update() {
      const shown = visible(tool, state);
      el.querySelectorAll(".fx-row").forEach(r => { r.hidden = !shown[r.dataset.row]; });
      const v = values(tool, state, shown);

      calcEl.innerHTML = tool.calcs.filter(c => v[c.id] !== undefined && c.id[0] !== "_").map(c =>
        '<span class="fx-val">' + esc(c.label) + ": <b>" + String(Math.round(v[c.id])) + "</b></span>").join("");

      const rule = tool.rules.find(r => test(r.cond, v));
      const notes = tool.notes.filter(r => test(r.cond, v));

      const scored = tool.ddx.map((d, i) => {
        const hit = d.signs.filter(s => test(s.cond, v));
        return { d, i, hit, sc: hit.reduce((a, s) => a + s.w, 0) };
      }).sort((a, b) => b.sc - a.sc || a.i - b.i);

      outEl.innerHTML =
        (rule ? '<div class="fx-verdict">' + inline(rule.text) + "</div>" : "") +
        (notes.length ? '<div class="fx-h">Учесть</div><ul class="fx-notes">' +
          notes.map(r => "<li>" + inline(r.text) + "</li>").join("") + "</ul>" : "") +
        '<div class="fx-h">Подумать о</div><ol class="fx-ddx">' + scored.map(({ d, hit, sc }) =>
          '<li class="' + (sc < 0 ? "fx-down" : "") + '">' +
          '<div class="fx-dx">' + (d.url ? '<a href="' + esc(d.url) + '" target="_blank" rel="noopener">' + esc(d.name) + "</a>" : esc(d.name)) +
          (d.must ? '<span class="fx-must">не пропустить</span>' : "") + "</div>" +
          (hit.length ? '<div class="fx-signs">' + hit.map(s =>
            '<span class="' + (s.w > 0 ? "fx-pro" : "fx-con") + '">' + (s.w > 0 ? "за: " : "против: ") + inline(s.text) + "</span>").join("") + "</div>" : "") +
          d.notes.map(n => '<div class="fx-note">' + inline(n) + "</div>").join("") +
          "</li>").join("") + "</ol>";
    }

    el.querySelectorAll(".fx-num").forEach(inp => inp.addEventListener("input", () => {
      state[inp.dataset.id] = inp.value; update();
    }));
    el.querySelectorAll(".fx-opt").forEach(b => b.addEventListener("click", () => {
      state[b.dataset.id] = b.dataset.o;
      el.querySelectorAll('.fx-opt[data-id="' + CSS.escape(b.dataset.id) + '"]').forEach(x =>
        x.setAttribute("aria-pressed", String(x === b)));
      update();
    }));
    update();
  }

  return { parse, render, test, values, visible };
})();
