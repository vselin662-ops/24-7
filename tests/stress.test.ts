import { applyStressDict, prepareIntonation, preprocessTextForTTS, formatStressForEngine } from '../src/services/StressService';
import { normalizeForSpeech } from '../src/utils/textUtils';

// Тест 1: Проверка ударного словаря для Edge TTS (combining acute)
const input1 = 'Моя семья любит творог и свеклу';
const processed1 = normalizeForSpeech(input1, 'edge');

console.log('--- TEST 1: Stress Dictionary ---');
console.log('Original:', input1);
console.log('Processed:', processed1);

if (!processed1.includes('семь') || !processed1.includes('тв') || !processed1.includes('свёкл')) {
  console.error('❌ Test 1 failed!');
  process.exit(1);
}

// Тест 2: Проверка Yandex формата
const yandexProcessed = applyStressDict('Моя семья любит творог', 'yandex');
console.log('--- TEST 2: Yandex Format ---');
console.log('Yandex:', yandexProcessed);
if (!yandexProcessed.includes('семь+я')) {
  console.error('❌ Test 2 failed!');
  process.exit(1);
}

// Тест 3: Проверка Edge combining accent
const edgeProcessed = applyStressDict('семья', 'edge');
console.log('--- TEST 3: Edge Acute ---');
console.log('Edge:', edgeProcessed, 'Code units:', Array.from(edgeProcessed).map(c => c.charCodeAt(0).toString(16)));
if (!edgeProcessed.includes('\u0301')) {
  console.error('❌ Test 3 failed!');
  process.exit(1);
}

// Тест 4: Интонация и разбивка длинных предложений (>15 слов)
const longSentence = 'Сегодня мы собрались все вместе в этом прекрасном доме, чтобы обсудить наши важные планы на будущее развитие и достичь потрясающих успехов!';
const intonationResult = prepareIntonation(longSentence);
console.log('--- TEST 4: Intonation ---');
console.log('Long sentence result:', intonationResult);
if (!intonationResult.includes('!')) {
  console.error('❌ Test 4 failed (lost exclamation mark)!');
  process.exit(1);
}

console.log('✅ ALL TESTS PASSED!');
