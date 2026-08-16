# Архитектура системы Selin AI

## 1. Обзор
Selin AI — это голосовой ассистент с архитектурой Voice-First, работающий в экосистеме MAX Messenger. Разработчик: Селин Вадим Юрьевич.

## 2. Технологический стек
- **Backend:** Node.js, Express, TypeScript
- **LLM Core:** Groq API (Llama-3.3-70b)
- **STT (Распознавание):** Groq Whisper-large-v3
- **TTS (Синтез):** Microsoft Edge TTS (ru-RU-SvetlanaNeural)
- **Database:** SQLite (WAL mode) + Firebase Firestore
- **Hosting:** Railway.app

## 3. Поток данных (Data Flow)
1. **Ingress:** Webhook от MAX API получает аудио-вложение.
2. **Processing:** Аудио скачивается, транскрибируется через Whisper.
3. **Logic:** Текст передается в LLM с системным промптом "Voice-First".
4. **Egress:** Ответ LLM очищается от Markdown, синтезируется в MP3 через Edge TTS.
5. **Delivery:** MP3 загружается в MAX через двухшаговый Upload API и отправляется пользователю.

## 4. Безопасность
- Использование переменных окружения для хранения API ключей.
- Валидация входных данных через Zod schemas.
- Rate limiting для защиты от DDoS.
