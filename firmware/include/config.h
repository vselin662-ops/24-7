#pragma once

#include <Arduino.h>

// =============================================================================
// Selin AI 2.0 - Конфигурация умной голосовой колонки на ESP32-S3
// =============================================================================

// 1. Настройки Wi-Fi
#define WIFI_SSID             "YOUR_WIFI_SSID"
#define WIFI_PASSWORD         "YOUR_WIFI_PASSWORD"
#define WIFI_RECONNECT_MS     5000

// 2. Настройки WebSocket сервера Selin AI 2.0
#define WS_SERVER_HOST        "192.168.1.100"      // IP-адрес или домен вашего сервера
#define WS_SERVER_PORT        3000                 // Порт сервера Selin AI
#define WS_SERVER_PATH        "/ws/colonna"        // Путь WebSocket для колонки
#define WS_DEVICE_ID          "selin_speaker_s3_1"

// 3. Пины микрофона I2S (INMP441) -> ESP32-S3
#define I2S_MIC_PORT          I2S_NUM_0
#define I2S_MIC_SCK_IO        4                    // BCLK / SCK (Bit Clock)
#define I2S_MIC_WS_IO         5                    // LRCL / WS (Word Select / Left-Right Clock)
#define I2S_MIC_SD_IO         6                    // DOUT / SD (Serial Data Out от микрофона)

// 4. Пины усилителя I2S (MAX98357A) -> ESP32-S3
#define I2S_SPK_PORT          I2S_NUM_1
#define I2S_SPK_BCLK_IO       15                   // BCLK (Bit Clock к усилителю)
#define I2S_SPK_LRC_IO        16                   // LRC / WS (Word Select)
#define I2S_SPK_DOUT_IO       7                    // DIN (Data In к усилителю)

// 5. Адресная светодиодная лента / кольцо WS2812B (NeoPixel)
#define LED_PIN               48                   // Встроенный или внешний RGB PIN
#define NUM_LEDS              12                   // Количество светодиодов (например, кольцо на 12 LED)
#define LED_BRIGHTNESS        80                   // Яркость от 0 до 255

// 6. Датчик движения PIR (HC-SR501 / AM312)
#define PIR_PIN               14                   // Цифровой вход датчика присутствия
#define PIR_COOLDOWN_MS       15000                // Задержка между срабатываниями датчика

// 7. Параметры звука и VAD (Voice Activity Detection)
#define AUDIO_SAMPLE_RATE     16000                // 16 кГц (стандарт для распознавания речи)
#define AUDIO_SAMPLE_BITS     16                   // 16 бит
#define AUDIO_CHANNELS        1                    // Моно
#define I2S_READ_CHUNK_SIZE   512                  // Размер одного буфера чтения микрофона (в сэмплах)

// Порог срабатывания детекции голоса (Voice Activity Detection RMS)
#define VAD_SILENCE_THRESHOLD 1200                 // Порог шума/тишины
#define VAD_SILENCE_HOLD_MS   900                  // Длительность паузы (мс) перед завершением фразы
#define VAD_MAX_SPEECH_SEC    12                   // Максимальная длительность одной фразы (сек)

// Состояния устройства для светодиодной индикации
enum SpeakerState {
    STATE_IDLE,               // Ожидание (мягкое бирюзовое дыхание)
    STATE_MOTION_DETECTED,    // Замечено движение (оранжевая вспышка приветствия)
    STATE_LISTENING,          // Запись голоса пользователя (зеленая пульсация)
    STATE_THINKING,           // Обработка запроса сервером/ИИ (вращающийся желтый луч)
    STATE_SPEAKING,           // Воспроизведение ответа ассистента (сине-фиолетовая волна)
    STATE_ERROR,              // Ошибка подключения (красное мигание)
    STATE_CONNECTING          // Подключение к Wi-Fi / WebSocket (синяя анимация)
};
