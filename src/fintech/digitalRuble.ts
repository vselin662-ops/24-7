// Фундамент под цифровой рубль: при появлении ключей реализовать провайдер и подключить в payments.ts

export interface DigitalRubleProvider {
  createInvoice(chatId: string, plan: string): Promise<{ url: string }>;
}

export const digitalRuble: DigitalRubleProvider | null = null; // TODO: реализовать при появлении ключей Robokassa или API ЦБ

export function isDigitalRubleReady(): boolean {
  return Boolean(process.env.ROBOKASSA_MERCHANT_ID && process.env.ROBOKASSA_SECRET_KEY);
}
