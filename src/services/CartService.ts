import { llmService } from "../core/LLMService";
import { logger } from "../logger";
import { UserProfile } from "./ProfileService";

const BASE_PRICES: Record<string, { price: number; unit: string }> = {
  // Овощи и зелень
  'свёкла': { price: 40, unit: 'кг' },
  'свекла': { price: 40, unit: 'кг' },
  'капуста': { price: 50, unit: 'кг' },
  'картофель': { price: 35, unit: 'кг' },
  'картошка': { price: 35, unit: 'кг' },
  'морковь': { price: 45, unit: 'кг' },
  'морковка': { price: 45, unit: 'кг' },
  'лук': { price: 40, unit: 'кг' },
  'лук репчатый': { price: 40, unit: 'кг' },
  'зеленый лук': { price: 40, unit: 'шт' },
  'чеснок': { price: 20, unit: 'шт' },
  'укроп': { price: 30, unit: 'шт' },
  'петрушка': { price: 30, unit: 'шт' },
  'зелень': { price: 35, unit: 'шт' },
  'помидоры': { price: 200, unit: 'кг' },
  'томаты': { price: 200, unit: 'кг' },
  'огурцы': { price: 150, unit: 'кг' },
  'перец': { price: 150, unit: 'кг' },
  'перец болгарский': { price: 180, unit: 'кг' },
  'болгарский перец': { price: 180, unit: 'кг' },
  'кабачки': { price: 100, unit: 'кг' },
  'баклажаны': { price: 150, unit: 'кг' },

  // Мясо и птица
  'говядина': { price: 650, unit: 'кг' },
  'говядина на кости': { price: 550, unit: 'кг' },
  'говяжья грудинка': { price: 550, unit: 'кг' },
  'курица': { price: 350, unit: 'кг' },
  'куриное филе': { price: 380, unit: 'кг' },
  'свинина': { price: 450, unit: 'кг' },
  'фарш': { price: 400, unit: 'кг' },
  'индейка': { price: 450, unit: 'кг' },
  'колбаса': { price: 300, unit: 'шт' },
  'сосиски': { price: 250, unit: 'шт' },

  // Бакалея, приправы, специи
  'томатная паста': { price: 90, unit: 'шт' },
  'перец горошком': { price: 15, unit: 'шт' },
  'перец черный горошком': { price: 15, unit: 'шт' },
  'черный перец горошком': { price: 15, unit: 'шт' },
  'лавровый лист': { price: 10, unit: 'шт' },
  'лаврушка': { price: 10, unit: 'шт' },
  'уксус': { price: 40, unit: 'шт' },
  'уксус столовый': { price: 40, unit: 'шт' },
  'уксус 9%': { price: 40, unit: 'шт' },
  'перец черный молотый': { price: 25, unit: 'шт' },
  'перец черный': { price: 25, unit: 'шт' },
  'соль': { price: 20, unit: 'кг' },
  'сахар': { price: 60, unit: 'кг' },
  'масло растительное': { price: 110, unit: 'шт' },
  'масло подсолнечное': { price: 110, unit: 'шт' },
  'масло сливочное': { price: 180, unit: 'шт' },
  'мука': { price: 50, unit: 'кг' },
  'рис': { price: 90, unit: 'кг' },
  'гречка': { price: 80, unit: 'кг' },
  'макароны': { price: 70, unit: 'шт' },

  // Молочка и выпечка
  'сметана': { price: 80, unit: 'шт' },
  'хлеб': { price: 45, unit: 'шт' },
  'батон': { price: 40, unit: 'шт' },
  'молоко': { price: 75, unit: 'шт' },
  'яйца': { price: 120, unit: '10шт' },
  'сыр': { price: 250, unit: 'шт' },
  'творог': { price: 130, unit: 'шт' },
  'кефир': { price: 80, unit: 'шт' },

  // Фрукты и напитки
  'лимон': { price: 30, unit: 'шт' },
  'яблоки': { price: 100, unit: 'кг' },
  'бананы': { price: 140, unit: 'кг' },
  'грибы': { price: 180, unit: 'шт' },
  'шампиньоны': { price: 180, unit: 'шт' },
  'вода': { price: 40, unit: 'шт' },
  'сок': { price: 100, unit: 'шт' },
  'чай': { price: 120, unit: 'шт' },
  'кофе': { price: 250, unit: 'шт' }
};

const lastUserCartLists = new Map<string, string>();

interface CartItem {
  name: string;
  qty: string | number;
}

interface LLMCartResponse {
  items: CartItem[];
  note?: string;
}

export async function buildCart(
  message: string,
  profile: UserProfile | null,
  chatId?: string | number
): Promise<{ text: string; totalSum: number; extra: any; rawListText?: string }> {
  const cleanId = chatId ? String(chatId).replace(/^[a-z_]+/, '') : 'default';
  const profileStr = profile ? JSON.stringify(profile) : 'нет данных';

  const systemPrompt = `Составь список продуктов для запроса пользователя с учётом его профиля: ${profileStr}.
Учитывай число людей (family_size) и ограничения в еде (diet_restrictions). Если есть ограничение (например, без свинины), ЗАМЕНИ запрещенные продукты на разрешенные альтернативы (например, свинину на говядину или курицу).
Верни СТРОГО JSON следующей структуры:
{
  "items": [
    { "name": "название продукта на русском", "qty": "количество (например, '0.5 кг', '1 кг', '1 шт', '2 шт', '100 г')" }
  ],
  "note": "краткое примечание с учетом замен и ограничений"
}
Цены в JSON НЕ выдумывай. Только список предметов и их количество. Возвращай исключительно чистый JSON.`;

  try {
    const rawRes = await llmService.smartCall("cart_builder_service", message, systemPrompt);
    const cleaned = rawRes.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned) as LLMCartResponse;

    let totalSum = 0;
    const lines: string[] = [];

    for (const item of parsed.items) {
      const lowerName = item.name.toLowerCase().trim();
      let matchedPriceObj = BASE_PRICES[lowerName];

      if (!matchedPriceObj) {
        // Поиск совпадения по ключам (сначала длинные ключи)
        const keys = Object.keys(BASE_PRICES).sort((a, b) => b.length - a.length);
        const key = keys.find(k => lowerName.includes(k) || k.includes(lowerName));
        if (key) {
          matchedPriceObj = BASE_PRICES[key];
        }
      }

      // Специфические фиксы цен для специй и приправ:
      // перец горошком = 15₽, лавровый лист = 10₽, уксус = 40₽, томатная паста = 90₽
      if (lowerName.includes('горошком') || (lowerName.includes('перец') && lowerName.includes('черн') && lowerName.includes('горош'))) {
        matchedPriceObj = { price: 15, unit: 'шт' };
      } else if (lowerName.includes('лавровый') || lowerName.includes('лаврушк')) {
        matchedPriceObj = { price: 10, unit: 'шт' };
      } else if (lowerName.includes('уксус')) {
        matchedPriceObj = { price: 40, unit: 'шт' };
      } else if (lowerName.includes('томатная паста') || lowerName.includes('томат-паста')) {
        matchedPriceObj = { price: 90, unit: 'шт' };
      }

      const isFixedSpice = lowerName.includes('горошком') || lowerName.includes('лавровый') || lowerName.includes('лаврушк') || lowerName.includes('уксус') || lowerName.includes('томатная паста');

      let itemCost: number;

      if (isFixedSpice && matchedPriceObj) {
        itemCost = matchedPriceObj.price;
      } else {
        // Определение числового коэффициента количества
        let factor = 1;
        const qtyStr = String(item.qty).toLowerCase();
        const numMatch = qtyStr.match(/(\d+(?:[.,]\d+)?)/);
        if (numMatch) {
          factor = parseFloat(numMatch[1].replace(',', '.'));
        }

        // Корректировка единиц измерения
        if (qtyStr.includes('г') && !qtyStr.includes('кг')) {
          factor = factor / 1000;
        } else if (qtyStr.includes('мл') && !qtyStr.includes('л')) {
          factor = Math.max(0.2, factor / 1000);
        } else if (qtyStr.includes('зубч')) {
          factor = 0.5; // Несколько зубчиков чеснока
        } else if (qtyStr.includes('ст. л') || qtyStr.includes('ч. л') || qtyStr.includes('ложк') || qtyStr.includes('щепот')) {
          factor = 0.25;
        } else if (qtyStr.includes('шт') && matchedPriceObj && matchedPriceObj.unit === 'кг') {
          // Если указано в шт, а цена за кг (например, 2 свеклы или 3 картошки ~150г каждая)
          factor = factor * 0.15;
        }

        const unitPrice = matchedPriceObj ? matchedPriceObj.price : 60;
        itemCost = Math.max(10, Math.round(unitPrice * factor));
      }

      totalSum += itemCost;
      lines.push(`- ${item.name} (${item.qty}) — ${itemCost}₽`);
    }

    const rawListOnly = lines.map(l => l.replace(/ — \d+₽$/, '')).join('\n');
    lastUserCartLists.set(cleanId, rawListOnly || lines.join('\n'));

    let responseText = `🛒 **Список продуктов по вашему запросу**:\n\n${lines.join('\n')}\n\n`;
    responseText += `📊 **Итоговая смета**: ≈ ${totalSum}₽ (смета приблизительная)\n`;
    if (parsed.note) {
      responseText += `📝 *Примечание*: ${parsed.note}\n`;
    }

    const extra = {
      attachments: [
        {
          type: 'inline_keyboard',
          payload: {
            buttons: [
              [
                { type: 'link', text: '🏪 Пятёрочка', url: 'https://5ka.ru' },
                { type: 'link', text: '🥑 ВкусВилл', url: 'https://vkusvill.ru' },
                { type: 'link', text: '🛒 Перекрёсток', url: 'https://www.perekrestok.ru' }
              ],
              [
                { type: 'link', text: '🚕 Купер', url: 'https://kuper.ru' },
                { type: 'link', text: '🥦 Лавка', url: 'https://lavka.yandex.ru' }
              ],
              [
                { type: 'callback', text: '📋 Скопировать список', payload: 'copy_cart', callback_data: 'copy_cart' }
              ]
            ]
          }
        }
      ]
    };

    return { text: responseText, totalSum, extra, rawListText: rawListOnly };
  } catch (err) {
    logger.error("❌ [CartService] Error building cart:", err);
    return {
      text: "Извините, не удалось собрать корзину продуктов. Пожалуйста, попробуйте еще раз.",
      totalSum: 0,
      extra: {
        attachments: [
          {
            type: 'inline_keyboard',
            payload: {
              buttons: [
                [
                  { type: 'link', text: '🏪 Пятёрочка', url: 'https://5ka.ru' },
                  { type: 'link', text: '🥑 ВкусВилл', url: 'https://vkusvill.ru' },
                  { type: 'link', text: '🛒 Перекрёсток', url: 'https://www.perekrestok.ru' }
                ],
                [
                  { type: 'link', text: '🚕 Купер', url: 'https://kuper.ru' },
                  { type: 'link', text: '🥦 Лавка', url: 'https://lavka.yandex.ru' }
                ],
                [
                  { type: 'callback', text: '📋 Скопировать список', payload: 'copy_cart', callback_data: 'copy_cart' }
                ]
              ]
            }
          }
        ]
      }
    };
  }
}

export function getLastCartList(chatId: string | number): string | null {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  return lastUserCartLists.get(cleanId) || null;
}
