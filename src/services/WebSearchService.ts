import { logger } from "../logger";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

function cleanHtml(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRealUrl(href: string): string {
  if (!href) return '';
  const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
  if (uddgMatch) {
    try {
      return decodeURIComponent(uddgMatch[1]);
    } catch {
      return uddgMatch[1];
    }
  }
  if (href.startsWith('//')) {
    return 'https:' + href;
  }
  return href;
}

async function searchDuckDuckGoHtml(query: string): Promise<WebSearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo HTML returned HTTP ${response.status}`);
  }

  const html = await response.text();
  const results: WebSearchResult[] = [];

  // Разбиваем HTML на блоки результатов
  const blocks = html.split(/class="[^"]*(?:results_links|web-result|result__body)[^"]*"/i);

  for (let i = 1; i < blocks.length && results.length < 5; i++) {
    const block = blocks[i];
    
    // Заголовок и ссылка из a.result__a
    const aMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!aMatch) continue;

    const rawHref = aMatch[1];
    const title = cleanHtml(aMatch[2]);
    const finalUrl = extractRealUrl(rawHref);

    if (!title || !finalUrl || finalUrl.includes('duckduckgo.com/y.js')) continue;

    // Описание из .result__snippet
    const snippetMatch = block.match(/<(?:a|div|span|p)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span|p)>/i);
    const snippet = snippetMatch ? cleanHtml(snippetMatch[1]) : '';

    results.push({
      title,
      url: finalUrl,
      snippet
    });
  }

  // Запасной парсинг если разбиение блоков вернуло пусто
  if (results.length === 0) {
    const titleRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<(?:a|div|span|p)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span|p)>/gi;

    const titles: { href: string; title: string }[] = [];
    let tMatch: RegExpExecArray | null;
    while ((tMatch = titleRegex.exec(html)) !== null && titles.length < 5) {
      titles.push({
        href: extractRealUrl(tMatch[1]),
        title: cleanHtml(tMatch[2])
      });
    }

    const snippets: string[] = [];
    let sMatch: RegExpExecArray | null;
    while ((sMatch = snippetRegex.exec(html)) !== null && snippets.length < 5) {
      snippets.push(cleanHtml(sMatch[1]));
    }

    for (let i = 0; i < titles.length; i++) {
      if (titles[i].title && titles[i].href) {
        results.push({
          title: titles[i].title,
          url: titles[i].href,
          snippet: snippets[i] || ''
        });
      }
    }
  }

  return results;
}

async function searchDuckDuckGoApi(query: string): Promise<WebSearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo API returned HTTP ${response.status}`);
  }

  const data: any = await response.json();
  const results: WebSearchResult[] = [];

  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: cleanHtml(data.Heading || query),
      url: data.AbstractURL,
      snippet: cleanHtml(data.AbstractText)
    });
  }

  const topics = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
  for (const item of topics) {
    if (results.length >= 5) break;

    if (item.Topics && Array.isArray(item.Topics)) {
      for (const subItem of item.Topics) {
        if (results.length >= 5) break;
        if (subItem.Text && subItem.FirstURL) {
          const text = cleanHtml(subItem.Text);
          const parts = text.split(' - ');
          const title = parts.length > 1 ? parts[0] : text.slice(0, 60);
          const snippet = parts.length > 1 ? parts.slice(1).join(' - ') : text;
          results.push({
            title,
            url: subItem.FirstURL,
            snippet
          });
        }
      }
    } else if (item.Text && item.FirstURL) {
      const text = cleanHtml(item.Text);
      const parts = text.split(' - ');
      const title = parts.length > 1 ? parts[0] : text.slice(0, 60);
      const snippet = parts.length > 1 ? parts.slice(1).join(' - ') : text;
      results.push({
        title,
        url: item.FirstURL,
        snippet
      });
    }
  }

  return results;
}

export async function searchWeb(query: string): Promise<WebSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  let results: WebSearchResult[] = [];

  // Движок 1: DuckDuckGo HTML
  try {
    results = await searchDuckDuckGoHtml(trimmed);
  } catch (err: any) {
    logger.warn(`⚠️ [WebSearch] Engine 1 (HTML) failed: ${err?.message || err}, falling back to Engine 2`);
  }

  // Движок 2: DuckDuckGo JSON API (если Движок 1 вернул пусто или упал)
  if (results.length === 0) {
    try {
      results = await searchDuckDuckGoApi(trimmed);
    } catch (err: any) {
      logger.error(`❌ [WebSearch] Engine 2 (API) failed: ${err?.message || err}`);
    }
  }

  const topResults = results.slice(0, 5);
  console.log(`🌐 [WebSearch] results: ${topResults.length}`);
  return topResults;
}
