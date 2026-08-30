import { logger } from "../logger";
import { getUserLocation, saveUserLastRoute, getUserLastRoute, SavedRoute } from "./ProfileService";

// Rate limit: 1 запрос в минуту на пользователя
const userNavCooldowns = new Map<string, number>();

// Хранилище последнего сгенерированного маршрута для повторного воспроизведения голоса
export interface LastRouteData {
  voiceText: string;
  textMsg: string;
  extra: any;
  timestamp: number;
}
const lastRouteCache = new Map<string, LastRouteData>();

export interface RouteResult {
  success: boolean;
  voiceText?: string;
  textMsg?: string;
  extra?: any;
  error?: string;
  needLocation?: boolean;
}

/**
 * Геокодинг адреса через Nominatim OpenStreetMap с fallback на photon.komoot.io
 */
export async function geocodeAddress(query: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return null;

  // 1. Попытка через Nominatim
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleanQuery)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'SelinAI/1.0',
        'Accept-Language': 'ru,en'
      },
      signal: AbortSignal.timeout(5000)
    });

    if (res.ok) {
      const data: any = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const item = data[0];
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        if (!isNaN(lat) && !isNaN(lon)) {
          return {
            lat,
            lon,
            name: item.display_name || cleanQuery
          };
        }
      }
    } else {
      logger.warn(`⚠️ [Nav] Nominatim HTTP error: ${res.status}. Falling back to Photon...`);
    }
  } catch (err: any) {
    logger.warn(`⚠️ [Nav] Nominatim error for "${cleanQuery}": ${err?.message || err}. Falling back to Photon...`);
  }

  // 2. Fallback через photon.komoot.io
  try {
    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(cleanQuery)}&limit=1`;
    const res = await fetch(photonUrl, {
      headers: {
        'User-Agent': 'SelinAI/1.0',
        'Accept-Language': 'ru,en'
      },
      signal: AbortSignal.timeout(5000)
    });

    if (res.ok) {
      const data: any = await res.json();
      if (data && Array.isArray(data.features) && data.features.length > 0) {
        const feat = data.features[0];
        const coords = feat.geometry?.coordinates; // GeoJSON format: [lon, lat]
        if (Array.isArray(coords) && coords.length >= 2) {
          const lon = parseFloat(coords[0]);
          const lat = parseFloat(coords[1]);
          if (!isNaN(lat) && !isNaN(lon)) {
            const props = feat.properties || {};
            const nameParts = [props.name, props.street, props.city, props.country].filter(Boolean);
            const name = nameParts.length > 0 ? nameParts.join(', ') : cleanQuery;
            logger.info(`🗺 [Nav] Geocoded via Photon fallback: "${cleanQuery}" -> ${lat}, ${lon}`);
            return { lat, lon, name };
          }
        }
      }
    }
  } catch (err: any) {
    logger.error(`❌ [Nav] Photon geocoding error for "${cleanQuery}":`, err?.message || err);
  }

  return null;
}

/**
 * Преобразование OSRM шага в понятную русскую инструкцию
 */
function formatStepManeuver(step: any, index: number): string {
  if (!step) return '';
  const maneuver = step.maneuver || {};
  const type = String(maneuver.type || '').toLowerCase();
  const modifier = String(maneuver.modifier || '').toLowerCase();
  const streetName = (step.name || '').trim();
  const distanceM = Math.round(step.distance || 0);

  const streetPhrase = streetName ? ` на ${streetName}` : '';
  const onStreetPhrase = streetName ? ` по ${streetName}` : '';
  const distPhrase = distanceM > 0 && index > 0 ? `через ${distanceM < 1000 ? distanceM + ' м' : (distanceM / 1000).toFixed(1) + ' км'} ` : '';

  if (type === 'depart') {
    return `начните движение${onStreetPhrase}`;
  }
  if (type === 'arrive') {
    return 'вы прибудете в пункт назначения';
  }

  let turnAction = 'двигайтесь прямо';
  if (modifier === 'left') turnAction = 'поверните налево';
  else if (modifier === 'right') turnAction = 'поверните направо';
  else if (modifier === 'slight left') turnAction = 'плавно поверните налево';
  else if (modifier === 'slight right') turnAction = 'плавно поверните направо';
  else if (modifier === 'sharp left') turnAction = 'крутой поворот налево';
  else if (modifier === 'sharp right') turnAction = 'крутой поворот направо';
  else if (modifier === 'uturn') turnAction = 'развернитесь';
  else if (type.includes('roundabout') || type.includes('rotary')) turnAction = 'на круге съезжайте';
  else if (type.includes('merge')) turnAction = 'перестройтесь';
  else if (type.includes('ramp')) turnAction = 'держитесь съезда';
  else if (type.includes('fork')) turnAction = modifier.includes('left') ? 'на развилке держитесь левее' : 'на развилке держитесь правее';

  if (index === 0) {
    return `${turnAction}${streetPhrase || onStreetPhrase}`;
  }
  return `${distPhrase}${turnAction}${streetPhrase}`;
}

/**
 * Извлечение первых 2 манёвров из маршрута
 */
function extractFirstManeuvers(steps: any[]): string {
  if (!Array.isArray(steps) || steps.length === 0) {
    return 'двигайтесь по навигатору';
  }

  const validSteps = steps.filter(s => s && s.maneuver);
  if (validSteps.length === 0) return 'двигайтесь прямо';

  const m1 = formatStepManeuver(validSteps[0], 0);
  if (validSteps.length > 1) {
    const m2 = formatStepManeuver(validSteps[1], 1);
    return `${m1}, затем ${m2}`;
  }
  return m1;
}

/**
 * Создание inline кнопок навигации для MAX Messenger
 */
export function createNavButtons(latA: number, lonA: number, latB: number, lonB: number) {
  return {
    attachments: [
      {
        type: 'inline_keyboard',
        payload: {
          buttons: [
            [
              {
                type: 'link',
                text: '🚗 Яндекс Навигатор',
                url: `https://yandex.ru/maps/?rtext=${latA},${lonA}~${latB},${lonB}&rtt=auto`
              }
            ],
            [
              {
                type: 'link',
                text: '🗺 2ГИС',
                url: `https://2gis.ru/moscow/route/rsType/auto/to/${lonB},${latB}`
              }
            ],
            [
              {
                type: 'callback',
                text: '🔊 Озвучить ещё раз',
                payload: 'nav_repeat'
              }
            ]
          ]
        }
      }
    ]
  };
}

/**
 * Построение маршрута Точка А -> Точка Б через OSRM с fallback и кэшированием
 */
export async function buildRoute(chatId: string | number, destinationQuery: string): Promise<RouteResult> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');

  // 1. Проверка локации пользователя (Точка А)
  const userLoc = getUserLocation(cleanId);
  if (!userLoc) {
    return {
      success: false,
      needLocation: true,
      textMsg: '📍 Пришлите геолокацию (скрепка → местоположение).'
    };
  }

  // 2. Лимит: 1 маршрут в минуту на пользователя
  const now = Date.now();
  const lastTime = userNavCooldowns.get(cleanId) || 0;
  if (now - lastTime < 60000) {
    const remainingSec = Math.ceil((60000 - (now - lastTime)) / 1000);
    const lastCached = lastRouteCache.get(cleanId);
    if (lastCached) {
      return {
        success: true,
        voiceText: lastCached.voiceText,
        textMsg: `${lastCached.textMsg}\n\n⏳ Следующий маршрут можно запросить через ${remainingSec} сек.`,
        extra: lastCached.extra
      };
    }
    return {
      success: false,
      textMsg: `⏳ Запрос маршрута доступен раз в минуту. Подождите ${remainingSec} сек.`
    };
  }

  // 3. Геокодинг точки Б (Nominatim с fallback на Photon)
  const destLoc = await geocodeAddress(destinationQuery);
  if (!destLoc) {
    return {
      success: false,
      textMsg: `❌ Не удалось найти адрес «${destinationQuery}». Уточните название города, улицы или объекта.`
    };
  }

  const { lat: latA, lon: lonA } = userLoc;
  const { lat: latB, lon: lonB, name: destName } = destLoc;

  // 4. Запрос к OSRM (список серверов с fallback, таймаут 5 сек)
  const OSRM_SERVERS = [
    process.env.OSRM_URL || 'https://router.project-osrm.org',
    'https://router2.project-osrm.org'
  ];

  let osrmData: any = null;
  for (let i = 0; i < OSRM_SERVERS.length; i++) {
    const baseServer = OSRM_SERVERS[i].replace(/\/$/, '');
    const osrmEndpoint = `${baseServer}/route/v1/driving/${lonA},${latA};${lonB},${latB}?alternatives=true&steps=true&overview=false`;
    logger.info(`🚗 [Nav Request] Trying OSRM server [${baseServer}]: ${osrmEndpoint}`);

    try {
      const response = await fetch(osrmEndpoint, {
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        throw new Error(`OSRM HTTP error ${response.status}`);
      }

      const data: any = await response.json();
      if (data && Array.isArray(data.routes) && data.routes.length > 0) {
        osrmData = data;
        break;
      } else {
        throw new Error('Empty routes in response');
      }
    } catch (err: any) {
      logger.warn(`⚠️ [Nav] OSRM server [${baseServer}] failed: ${err?.message || err}`);
      if (i === 0 && OSRM_SERVERS.length > 1) {
        logger.info('🚗 [Nav] fallback to backup OSRM');
      }
    }
  }

  // 5. Если оба OSRM упали -> читаем из постоянного кэша (user_profiles.last_route)
  if (!osrmData || !Array.isArray(osrmData.routes) || osrmData.routes.length === 0) {
    logger.warn(`⚠️ [Nav] Both OSRM servers failed for ${latA},${lonA} -> ${latB},${lonB}. Checking persistent cache...`);
    const savedRoute = getUserLastRoute(cleanId);
    if (savedRoute) {
      const { km, min } = savedRoute;
      const textMsg = `⚠️ Серверы маршрутов недоступны. Вот последний сохранённый маршрут: ${km} км, ${min} мин.`;
      const voiceText = `Серверы маршрутов недоступны. Вот последний сохранённый маршрут: ${km} километров, ${min} минут.`;
      const extra = createNavButtons(savedRoute.latA, savedRoute.lonA, savedRoute.latB, savedRoute.lonB);

      userNavCooldowns.set(cleanId, now);
      lastRouteCache.set(cleanId, {
        voiceText,
        textMsg,
        extra,
        timestamp: now
      });

      return {
        success: true,
        voiceText,
        textMsg,
        extra
      };
    }

    return {
      success: false,
      textMsg: '⚠️ Серверы маршрутов недоступны. Попробуйте повторить запрос позже.'
    };
  }

  // 6. Обработка вариантов маршрута
  const routes = osrmData.routes;
  const r1 = routes[0];
  const km1 = Math.round((r1.distance || 0) / 1000);
  const min1 = Math.round((r1.duration || 0) / 60);

  const steps1 = r1.legs?.[0]?.steps || [];
  const maneuversText = extractFirstManeuvers(steps1);

  let voiceText = '';
  let textLines: string[] = [];

  if (routes.length > 1) {
    const r2 = routes[1];
    const km2 = Math.round((r2.distance || 0) / 1000);
    const min2 = Math.round((r2.duration || 0) / 60);

    voiceText = `Маршрут готов. Вариант первый: ${km1} километров, ${min1} минут — быстрее. Вариант второй: ${km2} километров, ${min2} минут. Первые манёвры: ${maneuversText}.`;
    textLines = [
      `🚗 Вариант 1: ${km1} км · ${min1} мин (быстрее)`,
      `🚗 Вариант 2: ${km2} км · ${min2} мин`
    ];
  } else {
    voiceText = `Маршрут готов. Вариант один: ${km1} километров, примерно ${min1} минут. Первые манёвры: ${maneuversText}.`;
    textLines = [
      `🚗 Вариант 1: ${km1} км · ${min1} мин`
    ];
  }

  const textMsg = textLines.join('\n');
  const extra = createNavButtons(latA, lonA, latB, lonB);

  // Фиксируем cooldown, оперативный кэш и базу данных (user_profiles.last_route)
  userNavCooldowns.set(cleanId, now);
  lastRouteCache.set(cleanId, {
    voiceText,
    textMsg,
    extra,
    timestamp: now
  });

  saveUserLastRoute(cleanId, {
    latA,
    lonA,
    latB,
    lonB,
    destName,
    km: km1,
    min: min1,
    voiceText,
    textMsg,
    maneuversText,
    timestamp: now
  });

  // 7. Логирование по регламенту
  logger.info(`🚗 [Nav] ${latA.toFixed(4)},${lonA.toFixed(4)}→${destName.substring(0, 30)}: ${routes.length} routes, best ${km1}km/${min1}min`);

  return {
    success: true,
    voiceText,
    textMsg,
    extra
  };
}

/**
 * Получить последний закэшированный маршрут (для кнопки «Озвучить ещё раз»)
 */
export function getLastRoute(chatId: string | number): LastRouteData | null {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  return lastRouteCache.get(cleanId) || null;
}

/**
 * Проверка текста на команду установки домашнего адреса / ручной точки А
 */
export function extractManualLocationQuery(text: string): string | null {
  if (!text) return null;
  const trimmed = text.trim();

  // Регулярные выражения для команд задания местоположения
  const patterns = [
    /^(?:я\s+нахожусь|мой\s+адрес|я\s+живу|точка\s+а|моё\s+местоположение|мое\s+местоположение|установить\s+адрес|сохранить\s+адрес)\s*[:—–-]?\s*(.+)$/i,
    /^\/(?:set_home|home|location|address)\s+(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      const address = match[1].replace(/^[:—–-]\s*/, '').replace(/^[,\s.?!]+|[,\s.?!]+$/g, '').trim();
      if (address.length > 1) {
        return address;
      }
    }
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('я нахожусь ') || lower.startsWith('мой адрес ') || lower.startsWith('я живу ')) {
    const address = trimmed.replace(/^(?:я\s+нахожусь|мой\s+адрес|я\s+живу)\s*[:—–-]?\s*/i, '').trim();
    if (address.length > 1) {
      return address;
    }
  }

  return null;
}

/**
 * Ручная установка точки А через адрес с геокодингом
 */
export async function setManualLocation(
  chatId: string | number,
  addressQuery: string
): Promise<{ success: boolean; textMsg: string; lat?: number; lon?: number; address?: string }> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const geocoded = await geocodeAddress(addressQuery);

  if (!geocoded) {
    return {
      success: false,
      textMsg: `❌ Не удалось найти адрес «${addressQuery}». Пожалуйста, уточните город, улицу или номер дома.`
    };
  }

  const { setUserLocation } = await import("./ProfileService");
  setUserLocation(cleanId, geocoded.lat, geocoded.lon);

  const displayAddress = geocoded.name || addressQuery;
  const reply = `✅ Запомнил! Буду строить маршруты отсюда: ${displayAddress}. Обновить: «я нахожусь <новый адрес>» или прислать геолокацию.`;

  return {
    success: true,
    textMsg: reply,
    lat: geocoded.lat,
    lon: geocoded.lon,
    address: displayAddress
  };
}

/**
 * Проверка текста на команду навигации и извлечение адреса
 */
export function extractNavigationQuery(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  // Регулярные выражения для команд построения маршрута
  const patterns = [
    /^(?:как\s+(?:доехать|добраться|проехать)\s+(?:до|в|к)?)\s*(.+)$/i,
    /^(?:проложи\s+маршрут\s+(?:до|в|к)?)\s*(.+)$/i,
    /^(?:построй\s+маршрут\s+(?:до|в|к)?)\s*(.+)$/i,
    /^(?:маршрут\s+(?:до|в|к))\s*(.+)$/i,
    /^(?:поехали\s+(?:до|в|к)?)\s*(.+)$/i,
    /^(?:дорога\s+(?:до|в|к))\s*(.+)$/i,
    /^(?:навигатор\s+(?:до|в|к)?)\s*(.+)$/i,
    /^\/(?:route|nav|map)\s+(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const dest = match[1].replace(/^[,\s.?!]+|[,\s.?!]+$/g, '').trim();
      if (dest.length > 1) {
        return dest;
      }
    }
  }

  // Нестрогая проверка если содержит фразы
  if (lower.includes('как доехать до') || lower.includes('как добраться до') || lower.includes('маршрут до')) {
    const splitIndex = Math.max(
      lower.indexOf('как доехать до'),
      lower.indexOf('как добраться до'),
      lower.indexOf('маршрут до')
    );
    if (splitIndex !== -1) {
      const remainder = text.substring(splitIndex).replace(/^.*?\s+до\s+/i, '').trim();
      if (remainder.length > 1) return remainder;
    }
  }

  return null;
}
