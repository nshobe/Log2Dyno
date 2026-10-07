/**
 * vehiclePicker.js - shared searchable vehicle picker for Log2Dyno.
 *
 * Progressive enhancement over a native <select>: the <select> stays in the DOM as
 * the value holder and still fires `change`, so existing controller code is untouched.
 * The custom combobox adds:
 *   - type-to-search across make / model / trim / years / transmission
 *   - ★ Favorites and ↺ Recent sections (persisted in localStorage)
 *   - make-grouped catalog with per-row transmission badges
 *   - ⚠ flag for vehicles whose gear data is incomplete
 *   - full keyboard + ARIA combobox support
 *
 * Usage:
 *   const picker = createVehiclePicker({
 *     select: document.getElementById('runACarSelect'),
 *     getCars: () => availableCars,
 *     onSelect: (car) => {}
 *   });
 *   picker.refresh();   // after the underlying <select> options/values change
 */
(function (global) {
  'use strict';

  const FAV_KEY = 'log2dyno_fav_cars';
  const RECENT_KEY = 'log2dyno_recent_cars';
  const MAX_RECENT = 8;

  let uid = 0;

  // --- localStorage helpers -------------------------------------------------
  function readIds(key) {
    try {
      const raw = global.localStorage.getItem(key);
      const val = raw ? JSON.parse(raw) : [];
      return Array.isArray(val) ? val.filter(x => typeof x === 'string') : [];
    } catch (e) {
      return [];
    }
  }

  function writeIds(key, ids) {
    try {
      global.localStorage.setItem(key, JSON.stringify(ids));
    } catch (e) {
      /* storage unavailable - favorites/recent are best-effort */
    }
  }

  // --- formatting ----------------------------------------------------------
  function gearOrdinal(n) {
    const num = Number(n);
    const suffix = (num % 100 >= 11 && num % 100 <= 13) ? 'th'
      : num % 10 === 1 ? 'st' : num % 10 === 2 ? 'nd' : num % 10 === 3 ? 'rd' : 'th';
    return num + suffix;
  }

  function yearLabel(car) {
    if (car.yearStart == null) return '';
    if (car.yearEnd != null && car.yearEnd !== car.yearStart) {
      return car.yearStart + '-' + car.yearEnd;
    }
    return String(car.yearStart);
  }

  function transBadge(car) {
    const t = car.transmission || {};
    if (t.type === 'single') return 'EV';
    const suffix = { manual: 'MT', automatic: 'AT', dct: 'DCT', cvt: 'CVT' }[t.type] ||
      (t.type ? String(t.type).toUpperCase() : '');
    return t.speeds ? t.speeds + suffix : suffix;
  }

  function knownGears(car) {
    return Object.keys((car && car.gears) || {})
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  }

  function incompleteNote(car) {
    const gears = knownGears(car);
    if (!gears.length) return 'no gear data';
    return 'only ' + gears.map(gearOrdinal).join(', ') + ' known';
  }

  /** Lowercased search corpus for one car. */
  function haystack(car) {
    const t = car.transmission || {};
    const speedTag = t.speeds
      ? t.speeds + (t.type === 'manual' ? 'mt' : t.type === 'automatic' ? 'at' : '')
      : '';
    return [
      car.name, car.make, car.model, car.trim, car.generation,
      car.yearStart, car.yearEnd,
      t.type, t.code, t.speeds, speedTag,
      car.gearDataComplete === false ? 'incomplete partial missing' : '',
      car.origin === 'user' ? 'garage mine custom' : ''
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function displayTitle(car, showMake) {
    const head = yearLabel(car);
    const body = showMake
      ? [car.make, car.model].filter(Boolean).join(' ')
      : (car.model || '');
    const structured = [head, body, car.trim || ''].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    // User-created garage profiles have no make/model, only a free-text name.
    return structured || car.name || car.id;
  }

  // --- component -----------------------------------------------------------
  function createVehiclePicker(options) {
    const opts = options || {};
    const select = opts.select;
    if (!select) throw new Error('createVehiclePicker: options.select is required');

    const getCars = typeof opts.getCars === 'function' ? opts.getCars : () => [];
    const onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : () => {};
    const placeholder = opts.placeholder || 'Search vehicles…';

    const id = 'vp' + (++uid);
    const listId = id + '-list';

    let isOpen = false;
    let activeIndex = -1;
    let rows = [];
    let query = '';
    let score = new Map();
    let fav = readIds(FAV_KEY);
    let recent = readIds(RECENT_KEY);

    // --- DOM scaffold ---
    const root = document.createElement('div');
    root.className = 'vp' + (opts.wide ? ' vp-wide' : '');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'vp-input';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');

    const caret = document.createElement('span');
    caret.className = 'vp-caret';
    caret.textContent = '▾';
    caret.setAttribute('aria-hidden', 'true');

    const pop = document.createElement('div');
    pop.className = 'vp-pop';
    const list = document.createElement('div');
    list.className = 'vp-list';
    list.id = listId;
    list.setAttribute('role', 'listbox');
    const foot = document.createElement('div');
    foot.className = 'vp-foot';
    pop.appendChild(list);
    pop.appendChild(foot);

    root.appendChild(input);
    root.appendChild(caret);
    root.appendChild(pop);
    select.parentNode.insertBefore(root, select);

    // The native select becomes a hidden value holder for the existing controller.
    select.classList.add('vp-native');
    select.setAttribute('tabindex', '-1');
    select.setAttribute('aria-hidden', 'true');

    // --- data helpers ---
    function currentCar() {
      const cars = getCars();
      return cars.find(c => c.id === select.value) || null;
    }

    function labelFor(car) {
      return car ? (car.name || car.id) : '';
    }

    function syncInput() {
      const car = currentCar();
      input.value = car ? labelFor(car) : '';
      input.placeholder = car ? '' : placeholder;
      input.title = car ? labelFor(car) : placeholder;
    }

    function remember(carId) {
      recent = [carId].concat(recent.filter(x => x !== carId)).slice(0, MAX_RECENT);
      writeIds(RECENT_KEY, recent);
    }

    function toggleFavorite(carId) {
      fav = fav.includes(carId) ? fav.filter(x => x !== carId) : [carId].concat(fav);
      writeIds(FAV_KEY, fav);
      if (isOpen) render();
    }

    function arrange(items) {
      const sorted = items.slice().sort((a, b) => {
        const am = a.make || '';
        const bm = b.make || '';
        if (am !== bm) return am.localeCompare(bm);
        const amo = a.model || '';
        const bmo = b.model || '';
        if (amo !== bmo) return amo.localeCompare(bmo);
        const ay = a.yearStart == null ? -Infinity : a.yearStart;
        const by = b.yearStart == null ? -Infinity : b.yearStart;
        if (ay !== by) return ay - by;
        return (a.trim || '').localeCompare(b.trim || '');
      });
      if (query) {
        // Stable sort keeps the make/model ordering within equal scores.
        sorted.sort((a, b) => (score.get(a.id) || 9) - (score.get(b.id) || 9));
      }
      return sorted;
    }

    // --- row rendering ---
    function optionRow(car, showMake) {
      const row = document.createElement('div');
      row.className = 'vp-opt';
      row.id = listId + '-opt-' + car.id;
      row.setAttribute('role', 'option');
      row.dataset.id = car.id;
      row.setAttribute('aria-selected', car.id === select.value ? 'true' : 'false');
      if (car.id === select.value) row.classList.add('is-selected');

      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'vp-star';
      star.tabIndex = -1;
      const isFav = fav.includes(car.id);
      star.textContent = isFav ? '★' : '☆';
      star.title = isFav ? 'Remove from favorites' : 'Add to favorites';
      star.setAttribute('aria-label', star.title);
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(car.id);
      });

      const main = document.createElement('span');
      main.className = 'vp-opt-main';
      const title = document.createElement('span');
      title.className = 'vp-opt-title';
      title.textContent = displayTitle(car, showMake);
      main.appendChild(title);

      const badges = document.createElement('span');
      badges.className = 'vp-badges';
      if (car.origin === 'user') {
        const b = document.createElement('span');
        b.className = 'vp-badge is-garage';
        b.textContent = 'Garage';
        badges.appendChild(b);
      }
      if (car.gearDataComplete === false) {
        const b = document.createElement('span');
        b.className = 'vp-badge is-warn';
        b.textContent = '⚠';
        b.title = 'Gear data incomplete — ' + incompleteNote(car);
        badges.appendChild(b);
      }
      const badgeText = transBadge(car);
      if (badgeText) {
        const b = document.createElement('span');
        b.className = 'vp-badge is-trans';
        b.textContent = badgeText;
        badges.appendChild(b);
      }

      row.appendChild(star);
      row.appendChild(main);
      row.appendChild(badges);
      row.addEventListener('click', () => selectCar(car));
      row.addEventListener('mousemove', () => highlight(row));
      return row;
    }

    // --- rendering ---
    function render() {
      list.textContent = '';
      rows = [];
      activeIndex = -1;

      const cars = getCars();
      const raw = query.trim().toLowerCase();
      const tokens = raw.split(/\s+/).filter(Boolean);

      score = new Map();
      const matched = [];
      for (const car of cars) {
        const hay = haystack(car);
        if (tokens.length && !tokens.every(t => hay.includes(t))) continue;
        matched.push(car);
        const name = (car.name || '').toLowerCase();
        const model = (car.model || '').toLowerCase();
        if (!raw) score.set(car.id, 9);
        else if (name.startsWith(raw)) score.set(car.id, 0);
        else if (model.startsWith(raw)) score.set(car.id, 1);
        else if (name.includes(raw)) score.set(car.id, 2);
        else score.set(car.id, 3);
      }

      if (!cars.length) {
        list.appendChild(emptyState('No vehicles available'));
        foot.textContent = '';
        return;
      }
      if (!matched.length) {
        list.appendChild(emptyState('No vehicles match “' + query.trim() + '”'));
        foot.textContent = '0 matches';
        return;
      }

      const byId = new Map(cars.map(c => [c.id, c]));
      const matchedIds = new Set(matched.map(c => c.id));
      const seen = new Set();
      const sections = [];

      function addSection(title, cls, items, showMake) {
        const out = [];
        for (const car of items) {
          if (!car || seen.has(car.id)) continue;
          seen.add(car.id);
          out.push(car);
        }
        if (out.length) sections.push({ title, cls, items: out, showMake });
      }

      addSection('★ Favorites', 'is-fav',
        arrange(fav.map(cid => byId.get(cid)).filter(c => c && matchedIds.has(c.id))), true);
      addSection('↺ Recent', 'is-recent',
        arrange(recent.map(cid => byId.get(cid)).filter(c => c && matchedIds.has(c.id))), true);
      addSection('Your Garage', 'is-garage',
        arrange(matched.filter(c => c.origin === 'user')), true);

      const byMake = new Map();
      for (const car of matched) {
        if (seen.has(car.id)) continue;
        const make = car.make || 'Other';
        if (!byMake.has(make)) byMake.set(make, []);
        byMake.get(make).push(car);
      }
      for (const make of Array.from(byMake.keys()).sort((a, b) => a.localeCompare(b))) {
        const items = byMake.get(make);
        addSection(make + ' · ' + items.length, 'is-make', arrange(items), false);
      }

      const frag = document.createDocumentFragment();
      for (const section of sections) {
        const head = document.createElement('div');
        head.className = 'vp-group ' + section.cls;
        head.setAttribute('role', 'presentation');
        head.textContent = section.title;
        frag.appendChild(head);
        for (const car of section.items) frag.appendChild(optionRow(car, section.showMake));
      }
      list.appendChild(frag);
      rows = Array.from(list.querySelectorAll('.vp-opt'));

      foot.textContent = matched.length === cars.length
        ? cars.length + ' vehicles'
        : matched.length + ' of ' + cars.length + ' vehicles';
    }

    function emptyState(text) {
      const el = document.createElement('div');
      el.className = 'vp-empty';
      el.textContent = text;
      return el;
    }

    function highlight(row) {
      const index = rows.indexOf(row);
      if (index < 0) return;
      activeIndex = index;
      rows.forEach((r, i) => r.classList.toggle('is-active', i === index));
      input.setAttribute('aria-activedescendant', row.id);
      if (typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'nearest' });
      }
    }

    // --- open / close --------------------------------------------------------
    function position() {
      root.classList.remove('vp-up');
      const rect = root.getBoundingClientRect();
      const popHeight = Math.min(pop.offsetHeight || 300, Math.round(global.innerHeight * 0.5));
      if (rect.bottom + popHeight > global.innerHeight && rect.top > popHeight) {
        root.classList.add('vp-up');
      }
    }

    function openPop() {
      if (isOpen) return;
      isOpen = true;
      query = '';
      root.classList.add('vp-open');
      input.setAttribute('aria-expanded', 'true');
      render();
      input.value = '';
      input.placeholder = placeholder;
      position();
      const car = currentCar();
      if (car) {
        const row = rows.find(r => r.dataset.id === car.id);
        if (row) highlight(row);
      }
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      query = '';
      root.classList.remove('vp-open', 'vp-up');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      syncInput();
    }

    function selectCar(car) {
      if (!car) return;
      remember(car.id);
      select.value = car.id;
      close();
      syncInput();
      select.dispatchEvent(new Event('change', { bubbles: true }));
      onSelect(car);
    }

    // --- events --------------------------------------------------------------
    input.addEventListener('focus', () => {
      input.select();
      openPop();
    });

    input.addEventListener('click', () => {
      if (!isOpen) openPop();
    });

    input.addEventListener('input', () => {
      if (!isOpen) openPop();
      const car = currentCar();
      query = (car && input.value === labelFor(car)) ? '' : input.value;
      render();
    });

    input.addEventListener('blur', () => {
      if (isOpen) close();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen) { openPop(); return; }
        if (!rows.length) return;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const next = activeIndex < 0
          ? (step > 0 ? 0 : rows.length - 1)
          : Math.min(Math.max(activeIndex + step, 0), rows.length - 1);
        highlight(rows[next]);
      } else if (e.key === 'Enter') {
        if (!isOpen) return;
        e.preventDefault();
        const row = rows[activeIndex];
        if (row) {
          const car = getCars().find(c => c.id === row.dataset.id);
          if (car) selectCar(car);
        } else {
          close();
        }
      } else if (e.key === 'Escape') {
        if (isOpen) {
          e.preventDefault();
          close();
        }
      } else if (e.key === 'Tab') {
        if (isOpen) close();
      }
    });

    caret.addEventListener('mousedown', (e) => e.preventDefault());
    caret.addEventListener('click', () => {
      input.focus();
      if (!isOpen) openPop();
    });

    // Keep focus in the input while interacting with the popup (rows, stars,
    // scrollbar) so `blur` only fires for genuine outside clicks.
    pop.addEventListener('mousedown', (e) => e.preventDefault());

    document.addEventListener('mousedown', (e) => {
      if (isOpen && !root.contains(e.target)) close();
    });

    global.addEventListener('resize', () => {
      if (isOpen) position();
    });

    // --- public API ----------------------------------------------------------
    syncInput();

    return {
      refresh() {
        fav = readIds(FAV_KEY);
        recent = readIds(RECENT_KEY);
        syncInput();
        if (isOpen) render();
      },
      setValue(carId) {
        select.value = carId == null ? '' : carId;
        syncInput();
      },
      getValue() {
        return select.value;
      },
      focus() {
        input.focus();
      },
      close,
      element: root,
      input
    };
  }

  global.createVehiclePicker = createVehiclePicker;
})(typeof window !== 'undefined' ? window : globalThis);
