/* Torreto's Garage — RU / ES switch, instant, no reload.
 *
 * The HTML is the RU source (exactly the mockup). Switching to ES walks the page's text
 * nodes and a few attributes and swaps every string found in the ES dictionary below;
 * switching back restores the original nodes. Pop-ups render their own RU/ES content
 * (popups.js) and listen for the `langchange` event.
 *
 * Choice is remembered per browser (localStorage) and can be forced with ?lang=es|ru.
 */
(function () {
  'use strict';

  var ES = {
    /* header */
    'О нас': 'Nosotros',
    'Преимущества': 'Ventajas',
    'Услуги': 'Servicios',
    'Контакты': 'Contacto',
    'Alicante Unit · Online': 'Alicante Unit · En línea',
    'Night': 'Noche',
    'Day': 'Día',
    'High-End': 'Alta gama',
    'Записаться / Book service': 'Pedir cita / Reservar',

    /* rails */
    'Precision': 'Precisión',
    'Performance': 'Rendimiento',
    'Power': 'Potencia',
    'Integrity': 'Integridad',
    'Service': 'Servicio',

    /* scene 1 */
    "Torreto's Standard": "Estándar Torreto's",
    'Эталон': 'El estándar',
    'качества.': 'de calidad.',
    'Chassis scan': 'Escáner de chasis',
    'Live': 'En vivo',
    'Torsional rigidity': 'Rigidez torsional',
    'Wheel alignment': 'Alineación',
    'Precise Maintenance': 'Mantenimiento preciso',
    'Main Garage Unit': 'Taller principal',
    'Original Components': 'Componentes originales',
    'Expert': 'Expertos',
    'Master Certified': 'Maestros certificados',

    /* scene 2 */
    'Behind the Performance': 'Detrás del rendimiento',
    'Бескомпромиссный': 'Servicio',
    'сервис.': 'sin concesiones.',
    'Pistons · forged Ø102 mm': 'Pistones · forjados Ø102 mm',
    'Cylinder head · 4V DOHC': 'Culata · 4V DOHC',
    'Crankshaft · 4.0 L': 'Cigüeñal · 4.0 L',
    'Dry-sump oil system': 'Lubricación por cárter seco',
    'Fig. 01 — Flat-6 4.0 L · exploded view': 'Fig. 01 — Bóxer 6 cil. 4.0 L · despiece',
    "Scale 1:4 · Rev. B · Torreto's Lab": "Escala 1:4 · Rev. B · Torreto's Lab",
    'Computer Scanning': 'Escaneo por ordenador',
    '0 Logs': '0 Fallos',
    'Zero Error Tolerance': 'Tolerancia cero',
    'Telemetry & Tuning': 'Telemetría y ajuste',
    'Fluids': 'Fluidos',
    'Official Homologation': 'Homologación oficial',

    /* scene 3 */
    'Suspension & Brakes': 'Suspensión y frenos',
    'Абсолютный': 'Control',
    'контроль.': 'absoluto.',
    'Brake thermal': 'Temp. de frenos',
    'Front left': 'Delantera izq.',
    'Optimal 350-650°C': 'Óptimo 350-650°C',
    'Pad wear': 'Desgaste pastillas',
    'Status': 'Estado',
    'Optimal window': 'Rango óptimo',
    'Align': 'Geometría',
    '3D Geometry Setup': 'Alineación 3D',
    'Brakes': 'Frenos',
    'High-Load Calibration': 'Calibración alta carga',
    'Safety': 'Seguridad',
    'Track & Street Standard': 'Circuito y calle',
    'Rigor': 'Rigor',
    'Strict Protocol': 'Protocolo estricto',

    /* scene 4 */
    'Full Maintenance': 'Mantenimiento integral',
    'Технический': 'Mantenimiento',
    'регламент.': 'programado.',
    'Scheduled service': 'Revisión',
    'Oil · Motul': 'Aceite · Motul',
    'Filters': 'Filtros',
    'Brake fluid': 'Líq. de frenos',
    'Spark plugs': 'Bujías',
    'Approved Lubricants': 'Lubricantes aprobados',
    'Express': 'Exprés',
    'Scheduled Pit-Stop': 'Parada programada',
    'Filter': 'Filtros',
    'OEM Replacement': 'Recambio OEM',
    'Full Vehicle Check': 'Revisión completa',

    /* scene 5 */
    '[ Забронировать визит → ]': '[ Reservar visita → ]',
    'Твой автомобиль.': 'Tu coche.',
    'Наш стандарт.': 'Nuestro estándar.',
    '360° check': 'Revisión 360°',
    'Inspection points': 'Puntos de inspección',
    'DTC errors': 'Errores DTC',
    'Ready for pickup': 'Listo para entrega',
    'Next slot': 'Próxima cita',
    'Mon · 09:00': 'Lun · 09:00',
    'Service bay': 'Box de servicio',
    '02 · Ready': '02 · Listo',
    'Concierge': 'Conserjería',
    'On call': 'Disponible',
    'Lead time': 'Plazo',
    'Mon–Fri': 'Lun–Vie',
    'Working Hours': 'Horario',
    'Instant Booking': 'Reserva inmediata',
    'Personal Concierge': 'Conserje personal',
    'Garage': 'Taller',
    "Torreto's Unit": "Unidad Torreto's",
    'Contact': 'Contacto',
    'Scroll': 'Desliza',
    'Swipe': 'Desliza',
    'Записаться': 'Pedir cita',
    'Меню': 'Menú',

    /* counter / system */
    'Блок 1 из 5': 'Bloque 1 de 5',
    'Движок не запустился': 'El motor no ha arrancado',

    /* attributes */
    'Основное меню': 'Menú principal',
    "Torreto's Garage — на главную": "Torreto's Garage — inicio",
    'Matrix LED: ночь / день': 'Matrix LED: noche / día',
    'High-end sound: включить / выключить': 'Sonido de alta gama: activar / desactivar',
    'Стандарт качества': 'Estándar de calidad',
    'Сервисная сеть': 'Red de servicio',
    'Эталон качества': 'El estándar de calidad',
    'Бескомпромиссный сервис': 'Servicio sin concesiones',
    'Схема двигателя Flat-6 4.0 L': 'Esquema del motor bóxer de 6 cilindros 4.0 L',
    'Абсолютный контроль': 'Control absoluto',
    'Технический регламент': 'Mantenimiento programado',
    'Запись на сервис': 'Reserva de servicio',
  };

  var ATTRS = ['aria-label', 'alt', 'title', 'placeholder'];
  var root = document.documentElement;
  var textOrig = new WeakMap();   // text node → original (RU) value
  var attrOrig = new WeakMap();   // element → { attr: original }
  var current = 'ru';

  function skip(el) { return !el || el.closest('script, style, noscript, #pcm'); }

  function translate(src, lang) {
    if (lang !== 'es') return src;
    var key = src.trim();
    if (!key) return src;
    var tr = ES[key];
    return tr == null ? src : src.replace(key, tr);
  }

  /* blueprint call-out chips: resize the pill behind each label to its text */
  var chipOrig = new WeakMap();
  function fitChips(lang) {
    var chips = document.querySelectorAll('.bp-chip');
    for (var i = 0; i < chips.length; i++) {
      var rect = chips[i].querySelector('rect'), text = chips[i].querySelector('text');
      if (!chipOrig.has(rect)) chipOrig.set(rect, rect.getAttribute('width'));
      if (lang === 'ru') { rect.setAttribute('width', chipOrig.get(rect)); continue; }
      try {
        var w = text.getComputedTextLength();
        var pad = +text.getAttribute('x') - +rect.getAttribute('x');
        if (w > 0) rect.setAttribute('width', (w + pad * 2 + 4).toFixed(1));
      } catch (e) { /* not rendered yet */ }
    }
  }

  function apply(lang) {
    lang = lang === 'es' ? 'es' : 'ru';
    var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return skip(n.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
    });
    var n;
    while ((n = tw.nextNode())) {
      if (!textOrig.has(n)) textOrig.set(n, n.nodeValue);
      var next = translate(textOrig.get(n), lang);
      if (n.nodeValue !== next) n.nodeValue = next;
    }
    var els = document.querySelectorAll('[' + ATTRS.join('],[') + ']');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (skip(el)) continue;
      var o = attrOrig.get(el);
      if (!o) { o = {}; attrOrig.set(el, o); }
      for (var j = 0; j < ATTRS.length; j++) {
        var a = ATTRS[j];
        if (!el.hasAttribute(a)) continue;
        if (!(a in o)) o[a] = el.getAttribute(a);
        el.setAttribute(a, translate(o[a], lang));
      }
    }
    current = lang;
    root.lang = lang;
    var btns = document.querySelectorAll('[data-lang]');
    for (var k = 0; k < btns.length; k++) btns[k].setAttribute('aria-pressed', String(btns[k].dataset.lang === lang));
    fitChips(lang);
    try { localStorage.setItem('torreto.lang', lang); } catch (e) { /* storage blocked */ }
    root.dispatchEvent(new CustomEvent('langchange', { bubbles: true, detail: { lang: lang } }));
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-lang]');
    if (b && b.dataset.lang !== current) apply(b.dataset.lang);
  });

  var initial = new URLSearchParams(location.search).get('lang');
  if (!initial) { try { initial = localStorage.getItem('torreto.lang'); } catch (e) { initial = null; } }
  if (initial === 'es') apply('es');
  /* SVG text metrics are only right once the fonts are in */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (current === 'es') fitChips('es'); });

  window.TorretoI18n = {
    get lang() { return current; },
    set: apply,
    t: function (ru) { return translate(ru, current); },
    dictionary: ES,
  };
})();
