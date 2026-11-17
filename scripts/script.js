'use strict';

const dataUrl = './data/videos.json'; // TODO: путь к JSON из прекода.
const form = document.querySelector('.search-form');
const fromInput = form.elements.from;
const toInput = form.elements.to;
const searchButton = form.querySelector('button[type="submit"]');
const errorField = document.querySelector('#search-error');
const results = document.querySelector('.results');
const list = document.querySelector('.content__list');
const summary = document.querySelector('.results__summary');
const loader = document.querySelector('.preloader');
const errorBox = document.querySelector('.results__error');
const retryButton = document.querySelector('.results__retry');
const template = document.querySelector('#video-card-template');
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
let busy = false;
let lastFilters = { from: '', to: '', periods: [] };

function minutes(value) {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
}

function clearErrors() {
  errorField.textContent = '';
  [fromInput, toInput].forEach((input) => {
    input.setCustomValidity('');
    input.removeAttribute('aria-invalid');
  });
}

function validateRange() {
  clearErrors();
  const from = fromInput.value.trim();
  const to = toInput.value.trim();
  let message = '';
  let invalid = [];
  if (from && !timePattern.test(from)) {
    message = 'Введите время «с» в формате ЧЧ:ММ, от 00:00 до 23:59.';
    invalid = [fromInput];
  } else if (to && !timePattern.test(to)) {
    message = 'Введите время «по» в формате ЧЧ:ММ, от 00:00 до 23:59.';
    invalid = [toInput];
  } else if (Boolean(from) !== Boolean(to)) {
    message = 'Заполните оба поля диапазона или оставьте оба пустыми.';
    invalid = [from ? toInput : fromInput];
  } else if (from && minutes(from) > minutes(to)) {
    message = 'Время «с» должно быть не позже времени «по». Диапазон через полночь разделите на два поиска.';
    invalid = [fromInput, toInput];
  }
  if (message) {
    errorField.textContent = message;
    invalid.forEach((input) => {
      input.setCustomValidity(message);
      input.setAttribute('aria-invalid', 'true');
    });
    invalid[0].focus();
    return null;
  }
  return { from, to, periods: [...form.querySelectorAll('[name="period"]:checked')].map((input) => input.value) };
}

function localMediaPath(path, folder) {
  if (typeof path !== 'string' || !path.startsWith(`./${folder}/`)) {
    throw new Error('В каталоге указан некорректный локальный путь к медиа.');
  }
  const url = new URL(path, document.baseURI);
  const allowed = new URL(`./${folder}/`, document.baseURI);
  if (url.origin !== allowed.origin || !url.pathname.startsWith(allowed.pathname)) {
    throw new Error('В каталоге допускаются только локальные медиа проекта.');
  }
  return url.href;
}

function validateData(data) {
  if (!Array.isArray(data)) throw new Error('Файл данных должен содержать массив видео.');
  const ids = new Set();
  data.forEach((video) => {
    if (!video || typeof video.id !== 'string' || ids.has(video.id) ||
        typeof video.title !== 'string' || typeof video.description !== 'string' ||
        !timePattern.test(video.time) || !['day', 'night'].includes(video.period)) {
      throw new Error('Проверьте структуру, время и уникальность id в файле данных.');
    }
    ids.add(video.id);
    localMediaPath(video.src, 'videos');
    localMediaPath(video.poster, 'images');
  });
  return data;
}

function renderVideos(videos) {
  const fragment = document.createDocumentFragment();
  videos.forEach((data) => {
    const item = template.content.firstElementChild.cloneNode(true);
    const video = item.querySelector('video');
    const error = item.querySelector('.video-card__error');
    video.poster = localMediaPath(data.poster, 'images');
    video.addEventListener('error', () => { error.hidden = false; });
    video.src = localMediaPath(data.src, 'videos');
    video.setAttribute('aria-label', data.title);
    video.addEventListener('play', () => {
      list.querySelectorAll('video').forEach((other) => { if (other !== video) other.pause(); });
    });
    item.querySelector('.video-card__title').textContent = data.title;
    item.querySelector('.video-card__description').textContent = data.description;
    item.querySelector('.video-card__time').textContent = `Время съёмки: ${data.time}`;
    item.querySelector('.video-card__label').textContent = data.period === 'day' ? 'День' : 'Ночь';
    fragment.append(item);
  });
  list.replaceChildren(fragment);
}

async function search(filters, resetForm = false) {
  if (busy) return;
  busy = true;
  lastFilters = filters;
  searchButton.disabled = true;
  retryButton.disabled = true;
  searchButton.textContent = 'Ищем…';
  results.setAttribute('aria-busy', 'true');
  loader.hidden = false;
  errorBox.hidden = true;
  list.hidden = true;
  summary.textContent = '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    if (location.protocol === 'file:') {
      throw new Error('Откройте проект через локальный HTTP-сервер: браузер не разрешает fetch JSON по file://. Инструкция находится в LOCAL-START.txt.');
    }
    const response = await fetch(dataUrl, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`Не удалось загрузить каталог (HTTP ${response.status}). Проверьте путь ${dataUrl}.`);
    const data = validateData(await response.json());
    const matches = data.filter((video) =>
      (!filters.periods.length || filters.periods.includes(video.period)) &&
      (!filters.from || (minutes(video.time) >= minutes(filters.from) && minutes(video.time) <= minutes(filters.to)))
    );
    renderVideos(matches);
    const periodText = filters.periods.length === 1 ? (filters.periods[0] === 'day' ? 'день' : 'ночь') : 'любое время суток';
    summary.textContent = `Найдено: ${matches.length}. ${filters.from ? `${filters.from}–${filters.to}` : 'Весь день'}, ${periodText}.`;
    list.hidden = false;
    if (resetForm) form.reset();
    clearErrors();
  } catch (error) {
    errorBox.querySelector('p').textContent = error.name === 'AbortError'
      ? 'Загрузка заняла слишком много времени. Попробуйте ещё раз.'
      : error instanceof SyntaxError ? 'В файле каталога некорректный JSON.'
      : error.message || 'Не удалось загрузить видео. Проверьте локальный сервер.';
    errorBox.hidden = false;
  } finally {
    clearTimeout(timeout);
    loader.hidden = true;
    searchButton.disabled = false;
    retryButton.disabled = false;
    searchButton.textContent = 'Найти';
    results.setAttribute('aria-busy', 'false');
    busy = false;
  }
}

form.addEventListener('input', clearErrors);
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const filters = validateRange();
  if (filters) search(filters, true);
});
retryButton.addEventListener('click', () => search(lastFilters, true));
search(lastFilters);
