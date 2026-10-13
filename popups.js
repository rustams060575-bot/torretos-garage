/* Torreto's Garage — cockpit pop-ups (О нас · Преимущества · Услуги · Контакты).
 * Look: Porsche 911 digital cluster — matte black, graphite, orange LEDs, hairlines, mono readouts.
 * Content is bilingual (RU / ES) and re-renders on the i18n `langchange` event.
 * While a pop-up is open the scroll engine ignores wheel / keys / swipes (engine.js checks dialog[open]).
 */
(function () {
  'use strict';

  var dlg = document.getElementById('pcm');
  if (!dlg || !dlg.showModal) return;
  var root = document.documentElement;
  var C = (window.SITE_CONTENT && window.SITE_CONTENT.contacts) || {};
  var TABS = ['about', 'advantages', 'services', 'contacts'];

  var T = {
    ru: {
      brand: "Torreto's · <b>PCM</b>",
      close: 'ESC ✕', closeLabel: 'Закрыть',
      tabs: { about: 'О нас', advantages: 'Преимущества', services: 'Услуги', contacts: 'Контакты' },
      ro: { mode: 'Режим', unit: 'Unit', std: 'Стандарт', sec: 'Раздел' },
      bar: 'Alicante Unit · Sport+',
      notSet: 'не задано · content.config.js',
      about: {
        k: 'О нас',
        t: 'Премиальный сервис<br><em>в Аликанте.</em>',
        p: [
          "Torreto's Garage — премиальный сервис и автоателье в Аликанте для спортивных и люксовых автомобилей.",
          'Работаем по стандартам OEM: оригинальные компоненты, регламенты производителя, дилерское оборудование. К каждой машине — индивидуальный подход.',
        ],
        cards: [
          ['OEM', 'Стандарты OEM', 'Оригинальные компоненты и регламенты производителя.'],
          ['1:1', 'Индивидуально', 'Программа работ под ваш автомобиль и стиль езды.'],
          ['Sport+', 'Sport & Luxury', 'Спортивные и люксовые автомобили всех марок.'],
        ],
      },
      advantages: {
        k: 'Преимущества',
        t: 'Почему<br><em>Torreto’s.</em>',
        cards: [
          ['3D Diag', '3D Diag-сканирование', 'Компьютерная диагностика всех систем и геометрии за один визит.'],
          ['Dealer', 'Дилерское оборудование', 'Оригинальные сканеры и стенды — как у официального дилера.'],
          ['OEM', 'Оригинальные запчасти OEM', 'Только оригинальные и OEM-компоненты.'],
          ['1:1', 'Персональный шеф-механик', 'Один ответственный специалист на весь цикл работ.'],
          ['Warranty', 'Гарантия', 'Гарантия на выполненные работы и установленные запчасти.'],
        ],
      },
      services: {
        k: 'Услуги',
        t: 'Полный<br><em>спектр работ.</em>',
        p: ['Обслуживаем спортивные и люксовые автомобили целиком — от регламентного ТО до чип-тюнинга.'],
        list: ['Техническое обслуживание (ТО)', 'Замена масла и технических жидкостей', 'Компьютерная диагностика', 'Ремонт электроники',
          'Ремонт ходовой части', 'Тормозная система', 'Чип-тюнинг'],
        ok: 'Доступно',
        warnK: 'Исключение',
        warn: 'Выполняем все виды работ, <b style="display:inline;font:inherit;letter-spacing:0;color:inherit">кроме кузовной покраски</b>.',
      },
      contacts: {
        k: 'Контакты',
        t: 'Alicante<br><em>Unit.</em>',
        p: ['Запишитесь на визит — мы подтвердим время и подготовим бокс под ваш автомобиль.'],
        dl: { loc: 'Локация', phone: 'Телефон', wa: 'WhatsApp', mail: 'E-mail', hours: 'График' },
        closed: 'выходной',
        map: 'на карте ↗',
        waBtn: 'Написать в WhatsApp',
        form: { name: 'Имя', phone: 'Телефон', car: 'Автомобиль', service: 'Услуга', date: 'Желаемая дата', comment: 'Комментарий',
          carPh: 'Porsche 911 Carrera S', any: 'Не выбрано', send: 'Отправить заявку →' },
        sentWa: 'Открываем WhatsApp с вашей заявкой…',
        sentHook: 'Заявка отправлена. Мы свяжемся с вами для подтверждения.',
        sentDemo: 'Заявка сформирована, но канал отправки не подключён: укажите WhatsApp в content.config.js или window.onBookingSubmit.',
        required: 'Укажите имя и телефон.',
        weekend: 'В субботу и воскресенье мы закрыты — выберите день с понедельника по пятницу.',
        f: { name: 'Имя', phone: 'Телефон', car: 'Автомобиль', service: 'Услуга', date: 'Дата', comment: 'Комментарий' },
        waText: 'Здравствуйте! Заявка на визит в Torreto\'s Garage:',
      },
    },
    es: {
      brand: "Torreto's · <b>PCM</b>",
      close: 'ESC ✕', closeLabel: 'Cerrar',
      tabs: { about: 'Nosotros', advantages: 'Ventajas', services: 'Servicios', contacts: 'Contacto' },
      ro: { mode: 'Modo', unit: 'Unidad', std: 'Estándar', sec: 'Sección' },
      bar: 'Alicante Unit · Sport+',
      notSet: 'sin definir · content.config.js',
      about: {
        k: 'Nosotros',
        t: 'Servicio premium<br><em>en Alicante.</em>',
        p: [
          "Torreto's Garage es un servicio premium y taller boutique en Alicante para coches deportivos y de lujo.",
          'Trabajamos con estándares OEM: componentes originales, protocolos del fabricante y equipamiento de concesionario. Cada coche recibe un trato individual.',
        ],
        cards: [
          ['OEM', 'Estándares OEM', 'Componentes originales y protocolos del fabricante.'],
          ['1:1', 'A medida', 'Plan de trabajo adaptado a tu coche y a tu forma de conducir.'],
          ['Sport+', 'Sport & Luxury', 'Deportivos y coches de lujo de todas las marcas.'],
        ],
      },
      advantages: {
        k: 'Ventajas',
        t: 'Por qué<br><em>Torreto’s.</em>',
        cards: [
          ['3D Diag', 'Escaneo 3D Diag', 'Diagnóstico por ordenador de todos los sistemas y de la geometría en una sola visita.'],
          ['Dealer', 'Equipamiento de concesionario', 'Escáneres y bancos originales, como en un servicio oficial.'],
          ['OEM', 'Recambios originales OEM', 'Solo componentes originales y OEM.'],
          ['1:1', 'Jefe de mecánicos personal', 'Un único especialista responsable de todo el trabajo.'],
          ['Warranty', 'Garantía', 'Garantía sobre los trabajos realizados y las piezas instaladas.'],
        ],
      },
      services: {
        k: 'Servicios',
        t: 'Servicio<br><em>integral.</em>',
        p: ['Cuidamos tu deportivo o coche de lujo de principio a fin: del mantenimiento oficial a la reprogramación.'],
        list: ['Mantenimiento periódico', 'Cambio de aceite y fluidos', 'Diagnóstico por ordenador', 'Reparación de electrónica',
          'Suspensión y tren de rodaje', 'Sistema de frenos', 'Reprogramación (chip tuning)'],
        ok: 'Disponible',
        warnK: 'Excepción',
        warn: 'Realizamos todo tipo de trabajos, <b style="display:inline;font:inherit;letter-spacing:0;color:inherit">excepto pintura de carrocería</b>.',
      },
      contacts: {
        k: 'Contacto',
        t: 'Alicante<br><em>Unit.</em>',
        p: ['Reserva tu visita: confirmaremos la hora y prepararemos el box para tu coche.'],
        dl: { loc: 'Ubicación', phone: 'Teléfono', wa: 'WhatsApp', mail: 'E-mail', hours: 'Horario' },
        closed: 'cerrado',
        map: 'ver mapa ↗',
        waBtn: 'Escribir por WhatsApp',
        form: { name: 'Nombre', phone: 'Teléfono', car: 'Coche', service: 'Servicio', date: 'Fecha preferida', comment: 'Comentario',
          carPh: 'Porsche 911 Carrera S', any: 'Sin elegir', send: 'Enviar solicitud →' },
        sentWa: 'Abriendo WhatsApp con tu solicitud…',
        sentHook: 'Solicitud enviada. Te contactaremos para confirmarla.',
        sentDemo: 'Solicitud preparada, pero no hay canal de envío: indica el WhatsApp en content.config.js o window.onBookingSubmit.',
        required: 'Indica tu nombre y teléfono.',
        weekend: 'Sábados y domingos cerrado: elige un día de lunes a viernes.',
        f: { name: 'Nombre', phone: 'Teléfono', car: 'Coche', service: 'Servicio', date: 'Fecha', comment: 'Comentario' },
        waText: 'Hola, solicitud de cita en Torreto\'s Garage:',
      },
    },
  };

  var lang = function () { return root.lang === 'es' ? 'es' : 'ru'; };
  var active = 'about';
  var opener = null;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(n) { return String(n).padStart(2, '0'); }

  /* ── instrument dial (left column) ── */
  function dial(idx) {
    var ticks = '', R1 = 74, R2 = 82, start = -135, sweep = 270, n = 28;
    var lit = Math.round(n * (idx + 1) / TABS.length);
    for (var i = 0; i <= n; i++) {
      var a = (start + sweep * i / n - 90) * Math.PI / 180, big = i % 4 === 0, r1 = big ? R1 - 5 : R1;
      var cls = 'tk' + (i <= lit ? ' tk--on' : '') + (i >= n - 4 ? ' tk--hi' : '');
      ticks += '<line class="' + cls + '" x1="' + (Math.cos(a) * r1).toFixed(1) + '" y1="' + (Math.sin(a) * r1).toFixed(1) +
        '" x2="' + (Math.cos(a) * R2).toFixed(1) + '" y2="' + (Math.sin(a) * R2).toFixed(1) + '"/>';
    }
    var frac = sweep * (idx + 1) / TABS.length;
    return '<svg viewBox="-92 -92 184 184" aria-hidden="true">' +
      '<circle class="rim" r="88"/>' + ticks +
      '<circle class="arc" r="62" pathLength="360" stroke-dasharray="' + frac + ' 360" transform="rotate(' + (start - 90) + ')"/>' +
      '</svg>';
  }

  function readouts(L, idx) {
    return '<dl class="pcm__ro">' +
      '<div><dt>' + L.ro.mode + '</dt><dd>Sport+</dd></div>' +
      '<div><dt>' + L.ro.unit + '</dt><dd>Alicante</dd></div>' +
      '<div><dt>' + L.ro.std + '</dt><dd>OEM</dd></div>' +
      '<div><dt>' + L.ro.sec + '</dt><dd>' + pad(idx + 1) + ' / ' + pad(TABS.length) + '</dd></div></dl>';
  }

  /* ── panels ── */
  function head(P, idx) {
    return '<p class="pcm__k"><span class="led"></span>' + pad(idx + 1) + ' · ' + P.k + '</p><h2 class="pcm__t" id="pcmTitle-' + TABS[idx] + '">' + P.t + '</h2>' +
      (P.p || []).map(function (x) { return '<p class="pcm__p">' + x + '</p>'; }).join('');
  }
  function cards(list) {
    return '<div class="pcm__grid">' + list.map(function (c, i) {
      return '<article class="pcm__card"><div class="pcm__card-h"><span>' + pad(i + 1) + ' · ' + c[0] + '</span><span class="led led--g"></span></div><b>' + c[1] + '</b><p>' + c[2] + '</p></article>';
    }).join('') + '</div>';
  }
  function services(P) {
    return '<ul class="pcm__list">' + P.list.map(function (s, i) {
      return '<li><span class="i">' + pad(i + 1) + '</span><span class="n">' + s + '</span><span class="s"><span class="led led--g"></span>' + P.ok + '</span></li>';
    }).join('') + '</ul>' +
      '<div class="pcm__warn" role="note"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19z M12 9.5v5 M12 17.2v.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>' +
      '<div><b>' + P.warnK + '</b><p>' + P.warn + '</p></div></div>';
  }
  /* shared contact bits (pop-up, footer strip, phone card on scene 5) */
  var waNum = String(C.whatsapp || '').replace(/\D/g, '');
  var waUrl = waNum ? 'https://wa.me/' + waNum : '';
  var telUrl = C.phone ? 'tel:' + String(C.phone).replace(/[^\d+]/g, '') : '';
  function hoursTable(P) {
    return '<table class="pcm__hours">' + (C.hours || []).map(function (h) {
      return '<tr' + (h.time ? '' : ' class="off"') + '><td>' + esc(h.days[lang()] || h.days.ru) + '</td><td>' + (h.time ? esc(h.time) : P.closed) + '</td></tr>';
    }).join('') + '</table>';
  }
  function contacts(L, P) {
    var loc = '<b class="pcm__name">' + esc(C.name || "Torreto's Garage") + '</b><br>' + esc(C.street || '') + '<br>' + esc(C.postal || '') +
      (C.country ? ', ' + esc(C.country[lang()] || C.country.ru) : '') +
      (C.mapUrl ? '<br><a href="' + esc(C.mapUrl) + '" target="_blank" rel="noopener">' + P.map + '</a>' : '');
    var rows = '<div><dt>' + P.dl.loc + '</dt><dd>' + loc + '</dd></div>';
    if (telUrl) rows += '<div><dt>' + P.dl.phone + '</dt><dd><a href="' + esc(telUrl) + '">' + esc(C.phone) + '</a></dd></div>';
    if (waUrl) rows += '<div><dt>' + P.dl.wa + '</dt><dd><a href="' + esc(waUrl) + '" target="_blank" rel="noopener">' + esc(C.phone || '+' + waNum) + '</a></dd></div>';
    if (C.email) rows += '<div><dt>' + P.dl.mail + '</dt><dd><a href="mailto:' + esc(C.email) + '">' + esc(C.email) + '</a></dd></div>';
    rows += '<div><dt>' + P.dl.hours + '</dt><dd>' + hoursTable(P) + '</dd></div>';
    var opts = '<option value="">' + P.form.any + '</option>' + T[lang()].services.list.map(function (s) { return '<option>' + s + '</option>'; }).join('');
    var today = new Date().toISOString().slice(0, 10);
    return '<div class="pcm__cols"><div>' +
      '<dl class="pcm__dl">' + rows + '</dl>' +
      '<a class="pcm__wa" ' + (waUrl ? 'href="' + esc(waUrl) + '" target="_blank" rel="noopener"' : 'role="link" aria-disabled="true"') + '>' +
      '<span class="led led--g"></span>' + P.waBtn + '</a></div>' +
      '<form class="pcm__form" id="pcmForm" novalidate>' +
      '<label>' + P.form.name + ' *<input name="name" autocomplete="name" required></label>' +
      '<label>' + P.form.phone + ' *<input name="phone" type="tel" autocomplete="tel" required></label>' +
      '<label class="full">' + P.form.car + '<input name="car" placeholder="' + P.form.carPh + '"></label>' +
      '<label>' + P.form.service + '<select name="service">' + opts + '</select></label>' +
      '<label>' + P.form.date + '<input name="date" type="date" min="' + today + '"></label>' +
      '<label class="full">' + P.form.comment + '<textarea name="comment" rows="2"></textarea></label>' +
      '<button class="pcm__send full" type="submit">' + P.form.send + '</button>' +
      '<p class="pcm__note full" id="pcmNote" role="status" hidden></p>' +
      '</form></div>';
  }

  function panel(L, id, idx) {
    var P = L[id], body = head(P, idx);
    if (id === 'about' || id === 'advantages') body += cards(P.cards);
    if (id === 'services') body += services(P);
    if (id === 'contacts') body += contacts(L, P);
    return '<section class="pcm__panel" role="tabpanel" id="pcm-' + id + '" aria-labelledby="pcmTab-' + id + '" data-panel="' + id + '"' + (id === active ? '' : ' hidden') + '>' + body + '</section>';
  }

  function shift(idx) {
    var n = 15, lit = Math.round(n * (idx + 1) / TABS.length), out = '';
    for (var i = 0; i < n; i++) out += '<i class="' + (i < lit ? 'on' : '') + (i >= 10 ? ' r' : i >= 5 ? ' o' : '') + '"></i>';
    return out;
  }

  /* keep typed form values across a language switch */
  function formState() {
    var f = dlg.querySelector('#pcmForm');
    return f ? Object.fromEntries(new FormData(f)) : null;
  }

  function render() {
    var L = T[lang()], idx = TABS.indexOf(active), keep = formState();
    dlg.setAttribute('aria-labelledby', 'pcmTitle-' + active);
    dlg.innerHTML =
      '<div class="pcm__frame">' +
      '<header class="pcm__top"><div class="pcm__brand"><span class="led"></span>' + L.brand + '</div>' +
      '<div class="pcm__tabs" role="tablist">' + TABS.map(function (id, i) {
        return '<button type="button" class="pcm__tab" role="tab" id="pcmTab-' + id + '" aria-controls="pcm-' + id + '" aria-selected="' + (id === active) + '" tabindex="' + (id === active ? 0 : -1) + '" data-tab="' + id + '"><i>' + pad(i + 1) + '</i>' + L.tabs[id] + '</button>';
      }).join('') + '</div>' +
      '<div class="pcm__lang" role="group" aria-label="Idioma / Язык"><button type="button" data-lang="es" lang="es" aria-pressed="' + (lang() === 'es') + '">ES</button><span aria-hidden="true">|</span><button type="button" data-lang="ru" lang="ru" aria-pressed="' + (lang() === 'ru') + '">RU</button></div>' +
      '<button type="button" class="pcm__x" data-close aria-label="' + L.closeLabel + '">' + L.close + '</button></header>' +
      '<div class="pcm__body"><aside class="pcm__gauge" aria-hidden="true"><div class="pcm__dial">' + dial(idx) +
      '<div class="pcm__dial-v"><b>' + pad(idx + 1) + '</b><span>' + L.tabs[active] + '</span></div></div>' + readouts(L, idx) + '</aside>' +
      '<div class="pcm__screen" tabindex="-1">' + TABS.map(function (id, i) { return panel(L, id, i); }).join('') + '</div></div>' +
      '<footer class="pcm__bar" aria-hidden="true"><div class="pcm__shift">' + shift(idx) + '</div><span>' + L.bar + '</span><span>PCM · ' + lang().toUpperCase() + '</span></footer>' +
      '</div>';
    if (keep) {
      var f = dlg.querySelector('#pcmForm');
      if (f) Object.keys(keep).forEach(function (k) { if (f.elements[k]) f.elements[k].value = keep[k]; });
    }
  }

  function select(id, focusTab) {
    if (TABS.indexOf(id) < 0) return;
    active = id;
    render();
    syncNav();
    if (focusTab) dlg.querySelector('#pcmTab-' + id).focus();
  }

  function syncNav() {
    document.querySelectorAll('[data-pop]').forEach(function (a) {
      a.setAttribute('aria-expanded', String(dlg.open && a.dataset.pop === active));
    });
  }

  function open(id, focusForm) {
    opener = document.activeElement;
    active = TABS.indexOf(id) >= 0 ? id : 'about';
    render();
    if (!dlg.open) dlg.showModal();
    syncNav();
    root.dataset.popup = active;
    if (focusForm) {
      var inp = dlg.querySelector('#pcmForm input');
      if (inp) inp.focus();
    } else {
      dlg.querySelector('#pcmTab-' + active).focus();
    }
  }

  var closing = false;
  function close() {
    if (!dlg.open || closing) return;
    closing = true;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    dlg.classList.add('is-closing');
    setTimeout(function () {
      dlg.classList.remove('is-closing');
      dlg.close();
      closing = false;
    }, reduce ? 0 : 230);
  }
  dlg.addEventListener('close', function () {
    delete root.dataset.popup;
    syncNav();
    if (opener && opener.focus) opener.focus();
  });
  dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); }); // ESC → animated close

  dlg.addEventListener('click', function (e) {
    if (e.target === dlg) return close();                    // click on the backdrop
    if (e.target.closest('[data-close]')) return close();
    var tab = e.target.closest('[data-tab]');
    if (tab) select(tab.dataset.tab, true);
    if (e.target.closest('.pcm__wa[aria-disabled="true"]')) e.preventDefault();
  });
  dlg.addEventListener('keydown', function (e) {
    var tab = e.target.closest && e.target.closest('[role="tab"]');
    if (!tab || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    e.preventDefault();
    var i = (TABS.indexOf(tab.dataset.tab) + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    select(TABS[i], true);
  });

  /* opening days from content.config.js (weekdays: 1 = Monday … 7 = Sunday) */
  function isClosedDay(iso) {
    if (!iso) return false;
    var d = new Date(iso + 'T12:00:00'), wd = d.getDay() || 7;
    return !(C.hours || []).some(function (h) { return h.time && (h.weekdays || []).indexOf(wd) >= 0; });
  }
  dlg.addEventListener('change', function (e) {
    if (e.target.name !== 'date') return;
    var note = dlg.querySelector('#pcmNote'), P = T[lang()].contacts;
    if (isClosedDay(e.target.value)) { note.hidden = false; note.dataset.kind = 'err'; note.textContent = P.weekend; }
    else if (note.dataset.kind === 'err') { note.hidden = true; }
  });

  dlg.addEventListener('submit', function (e) {
    if (e.target.id !== 'pcmForm') return;
    e.preventDefault();
    var P = T[lang()].contacts, f = e.target, note = dlg.querySelector('#pcmNote');
    var data = Object.fromEntries(new FormData(f));
    data.lang = lang();
    note.hidden = false;
    note.removeAttribute('data-kind');
    if (!data.name.trim() || !data.phone.trim()) {
      note.dataset.kind = 'err'; note.textContent = P.required;
      (data.name.trim() ? f.elements.phone : f.elements.name).focus();
      return;
    }
    if (isClosedDay(data.date)) {
      note.dataset.kind = 'err'; note.textContent = P.weekend;
      f.elements.date.focus();
      return;
    }
    if (typeof window.onBookingSubmit === 'function') {
      Promise.resolve(window.onBookingSubmit(data)).then(function () { note.textContent = P.sentHook; f.reset(); },
        function () { note.dataset.kind = 'err'; note.textContent = P.sentDemo; });
    } else if (waNum) {
      var lines = [P.waText].concat(['name', 'phone', 'car', 'service', 'date', 'comment'].filter(function (k) { return data[k]; })
        .map(function (k) { return P.f[k] + ': ' + data[k]; }));
      window.open(waUrl + '?text=' + encodeURIComponent(lines.join('\n')), '_blank', 'noopener');
      note.textContent = P.sentWa;
    } else {
      note.dataset.kind = 'err'; note.textContent = P.sentDemo;
    }
  });

  /* triggers: header menu, both «book» buttons */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-pop]');
    if (a) { e.preventDefault(); open(a.dataset.pop); return; }
    var b = e.target.closest && e.target.closest('[data-book]');
    if (b) { e.preventDefault(); open('contacts', true); }
  });

  function fillContacts() {
    var L = T[lang()], P = L.contacts;
    var set = function (sel, fn) { document.querySelectorAll(sel).forEach(fn); };
    set('[data-c="name"]', function (el) { el.textContent = C.name || "Torreto's Garage"; });
    set('[data-c="address"]', function (el) { el.textContent = (C.street || '') + ', ' + (C.postal || ''); if (el.tagName === 'A' && C.mapUrl) el.href = C.mapUrl; });
    set('[data-c="phone"]', function (el) { el.textContent = C.phone || ''; if (el.tagName === 'A') el.href = telUrl; el.hidden = !telUrl; });
    set('[data-c="wa"]', function (el) { if (waUrl) el.href = waUrl; el.hidden = !waUrl; });
    set('[data-c="hours"]', function (el) { el.textContent = C.hoursShort ? (C.hoursShort[lang()] || C.hoursShort.ru) : ''; });
    set('[data-c="hours-table"]', function (el) { el.innerHTML = hoursTable(P); });
  }
  fillContacts();
  root.addEventListener('langchange', function (e) { if (!(e instanceof CustomEvent)) return; fillContacts(); if (dlg.open) { render(); syncNav(); } });

  window.TorretoPopups = { open: open, close: close, select: select, get active() { return dlg.open ? active : null; } };
})();
