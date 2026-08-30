import { logger } from "../logger";
import { getUserLocation } from "./ProfileService";

const OSRM_URL = process.env.OSRM_URL || 'https://router.project-osrm.org';

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
 * Геокодинг адреса через Nominatim OpenStreetMap
 */
export async function geocodeAddress(query: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return null;

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleanQuery)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'SelinAI/1.0',
        'Accept-Language': 'ru,en'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) {
      logger.warn(`⚠️ [Nav] Nominatim HTTP error: ${res.status}`);
      return null;
    }

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
  } catch (err: any) {
    logger.error(`❌ [Nav] Geocoding error for "${cleanQuery}":`, err?.message || err);
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
 * Построение маршрута Точка А -> Точка Б через OSRM
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

  // 3. Геокодинг точки Б
  const destLoc = await geocodeAddress(destinationQuery);
  if (!destLoc) {
    return {
      success: false,
      textMsg: `❌ Не удалось найти адрес «${destinationQuery}». Уточните название города, улицы или объекта.`
    };
  }

  const { lat: latA, lon: lonA } = userLoc;
  const { lat: latB, lon: lonB, name: destName } = destLoc;

  // 4. Запрос к OSRM с альтернативами и шагами
  const osrmEndpoint = `${OSRM_URL}/route/v1/driving/${lonA},${latA};${lonB},${latB}?alternatives=true&steps=true&overview=false`;
  logger.info(`🚗 [Nav Request] Fetching OSRM route: ${osrmEndpoint}`);

  let osrmData: any = null;
  try {
    const response = await fetch(osrmEndpoint, {
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) {
      throw new Error(`OSRM HTTP error ${response.status}`);
    }

    osrmData = await response.json();
  } catch (err: any) {
    logger.error(`❌ [Nav] OSRM routing failed: ${err?.message || err}`);
    return {
      success: false,
      textMsg: '⚠️ Не удалось рассчитать маршрут. Проверьте соединение или повторите попытку позже.'
    };
  }

  if (!osrmData || !Array.isArray(osrmData.routes) || osrmData.routes.length === 0) {
    logger.warn(`⚠️ [Nav] OSRM returned no routes for ${latA},${lonA} -> ${latB},${lonB}`);
    return {
      success: false,
      textMsg: '❌ Маршрут между этими точками не найден.'
    };
  }

  // 5. Обработка вариантов маршрута
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

  // Фиксируем cooldown и кэш
  userNavCooldowns.set(cleanId, now);
  lastRouteCache.set(cleanId, {
    voiceText,
    textMsg,
    extra,
    timestamp: now
  });

  // 6. Логирование по регламенту
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
