/* Torreto's Garage — business data. Single source for: the «Контакты / Contacto» pop-up,
 * the footer strip, the phone contact card on scene 5 and the booking form.
 *
 * Booking form: «Отправить заявку» opens WhatsApp (wa.me) with the request pre-filled.
 * To send it to your own backend instead, define
 *   window.onBookingSubmit = async (data) => { ... }   // data: { name, phone, car, service, date, comment, lang }
 */
window.SITE_CONTENT = {
  contacts: {
    name: "Torreto's Garage",
    unit: 'Alicante Unit',
    street: 'Calle de la Cruz del Sur, 14',
    postal: '03006 Alicante',
    country: { ru: 'Испания', es: 'España' },
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent("Torreto's Garage, Calle de la Cruz del Sur 14, 03006 Alicante"),
    phone: '+34 637 95 83 63',
    whatsapp: '34637958363',          // → https://wa.me/34637958363
    email: '',                        // empty = row hidden

    /* opening hours; time: null = closed. weekdays: 1 = Monday … 7 = Sunday (booking form check) */
    hours: [
      { days: { ru: 'Пн – Пт', es: 'Lun – Vie' }, time: '09:00 – 20:00', weekdays: [1, 2, 3, 4, 5] },
      { days: { ru: 'Сб – Вс', es: 'Sáb – Dom' }, time: null, weekdays: [6, 7] },
    ],
    hoursShort: { ru: 'Пн–Пт 09:00–20:00 · Сб–Вс выходной', es: 'Lun–Vie 09:00–20:00 · Sáb–Dom cerrado' },
  },
};
