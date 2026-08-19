#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <FastLED.h>
#include <driver/i2s.h>
#include "config.h"

// =============================================================================
// Глобальные переменные и объекты
// =============================================================================
WebSocketsClient webSocket;
CRGB leds[NUM_LEDS];
volatile SpeakerState currentState = STATE_CONNECTING;

// Буферы для воспроизведения и записи аудио
TaskHandle_t audioTaskHandle = NULL;
QueueHandle_t audioPlaybackQueue = NULL;

volatile bool isWsConnected = false;
volatile bool isRecording = false;
volatile bool isPlayingAudio = false;

// Таймеры
unsigned long lastWifiCheckMs = 0;
unsigned long lastPirTriggerMs = 0;
unsigned long speechStartTimeMs = 0;
unsigned long lastVoiceActivityMs = 0;

// Структура пакета воспроизведения аудио
struct AudioChunk {
    uint8_t* data;
    size_t length;
};

// =============================================================================
// 1. Инициализация I2S Микрофона (INMP441) и Динамика (MAX98357A)
// =============================================================================

void setupI2SMicrophone() {
    i2s_config_t i2s_mic_config = {
        .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
        .sample_rate = AUDIO_SAMPLE_RATE,
        .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT, // INMP441 передает 24/32 бита
        .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
        .communication_format = I2S_COMM_FORMAT_STAND_I2S,
        .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count = 8,
        .dma_buf_len = I2S_READ_CHUNK_SIZE,
        .use_apll = false,
        .tx_desc_auto_clear = false,
        .fixed_mclk = 0
    };

    i2s_pin_config_t mic_pins = {
        .bck_io_num = I2S_MIC_SCK_IO,
        .ws_io_num = I2S_MIC_WS_IO,
        .data_out_num = I2S_PIN_NO_CHANGE,
        .data_in_num = I2S_MIC_SD_IO
    };

    esp_err_t err = i2s_driver_install(I2S_MIC_PORT, &i2s_mic_config, 0, NULL);
    if (err != ESP_OK) {
        Serial.printf("❌ [I2S Mic] Driver install error: %d\n", err);
    }
    err = i2s_set_pin(I2S_MIC_PORT, &mic_pins);
    if (err != ESP_OK) {
        Serial.printf("❌ [I2S Mic] Set pin error: %d\n", err);
    }
    Serial.println("✅ [I2S Mic] INMP441 initialized successfully.");
}

void setupI2SSpeaker() {
    i2s_config_t i2s_spk_config = {
        .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
        .sample_rate = AUDIO_SAMPLE_RATE,
        .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
        .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
        .communication_format = I2S_COMM_FORMAT_STAND_I2S,
        .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count = 8,
        .dma_buf_len = 512,
        .use_apll = false,
        .tx_desc_auto_clear = true,
        .fixed_mclk = 0
    };

    i2s_pin_config_t spk_pins = {
        .bck_io_num = I2S_SPK_BCLK_IO,
        .ws_io_num = I2S_SPK_LRC_IO,
        .data_out_num = I2S_SPK_DOUT_IO,
        .data_in_num = I2S_PIN_NO_CHANGE
    };

    esp_err_t err = i2s_driver_install(I2S_SPK_PORT, &i2s_spk_config, 0, NULL);
    if (err != ESP_OK) {
        Serial.printf("❌ [I2S Spk] Driver install error: %d\n", err);
    }
    err = i2s_set_pin(I2S_SPK_PORT, &spk_pins);
    if (err != ESP_OK) {
        Serial.printf("❌ [I2S Spk] Set pin error: %d\n", err);
    }
    Serial.println("✅ [I2S Spk] MAX98357A DAC initialized successfully.");
}

// =============================================================================
// 2. Светодиодные анимации (WS2812 / FastLED)
// =============================================================================

void updateLeds() {
    static uint8_t hue = 0;
    static uint8_t breathBrightness = 20;
    static int8_t breathDirection = 1;

    switch (currentState) {
        case STATE_CONNECTING:
            // Вращающийся синий огонек
            fill_solid(leds, NUM_LEDS, CRGB::Black);
            leds[millis() / 80 % NUM_LEDS] = CRGB::Blue;
            break;

        case STATE_IDLE:
            // Мягкое бирюзовое дыхание
            breathBrightness += breathDirection;
            if (breathBrightness <= 15 || breathBrightness >= LED_BRIGHTNESS) {
                breathDirection = -breathDirection;
            }
            fill_solid(leds, NUM_LEDS, CHSV(130, 200, breathBrightness));
            break;

        case STATE_MOTION_DETECTED:
            // Оранжевое мерцание
            fill_solid(leds, NUM_LEDS, CRGB::Orange);
            break;

        case STATE_LISTENING:
            // Пульсирующий изумрудно-зеленый (запись голоса)
            fill_solid(leds, NUM_LEDS, CHSV(96, 255, 120 + sin8(millis() / 4) / 2));
            break;

        case STATE_THINKING:
            // Быстро вращающийся желто-золотой луч (ИИ думает)
            fill_solid(leds, NUM_LEDS, CRGB::Black);
            for (int i = 0; i < 3; i++) {
                int pos = (millis() / 50 + i) % NUM_LEDS;
                leds[pos] = CRGB::Gold;
            }
            break;

        case STATE_SPEAKING:
            // Радужная волна при воспроизведении звука
            for (int i = 0; i < NUM_LEDS; i++) {
                leds[i] = CHSV(hue + (i * 20), 220, LED_BRIGHTNESS);
            }
            hue += 3;
            break;

        case STATE_ERROR:
            // Мигающий красный сигнал ошибки
            if ((millis() / 300) % 2 == 0) {
                fill_solid(leds, NUM_LEDS, CRGB::Red);
            } else {
                fill_solid(leds, NUM_LEDS, CRGB::Black);
            }
            break;
    }

    FastLED.show();
}

// =============================================================================
// 3. WebSocket Обработчики
// =============================================================================

void playAudioBuffer(const uint8_t* data, size_t length) {
    if (!data || length == 0) return;

    currentState = STATE_SPEAKING;
    isPlayingAudio = true;

    size_t bytesWritten = 0;
    size_t offset = 0;

    // Если аудио содержит WAV заголовок (44 байта), пропускаем его для I2S PCM
    if (length > 44 && memcmp(data, "RIFF", 4) == 0) {
        offset = 44;
    }

    while (offset < length) {
        size_t chunk = min((size_t)1024, length - offset);
        i2s_write(I2S_SPK_PORT, data + offset, chunk, &bytesWritten, portMAX_DELAY);
        offset += bytesWritten;
    }

    isPlayingAudio = false;
    currentState = STATE_IDLE;
}

void handleWebSocketMessage(uint8_t* payload, size_t length) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload, length);

    if (error) {
        Serial.printf("❌ [WS] JSON parse error: %s\n", error.c_str());
        return;
    }

    const char* type = doc["type"] | "";

    if (strcmp(type, "connected") == 0) {
        Serial.println("🔊 [WS] Server confirmed smart speaker connection.");
        currentState = STATE_IDLE;
    } 
    else if (strcmp(type, "response") == 0) {
        const char* text = doc["text"] | "";
        const char* audioBase64 = doc["audioBase64"] | "";
        Serial.printf("🤖 [Selin AI Response]: %s\n", text);

        if (strlen(audioBase64) > 0) {
            // Декодируем Base64 в аудио буфер
            size_t decodedLen = 0;
            // Рассчитываем приблизительный размер
            size_t b64Len = strlen(audioBase64);
            size_t maxRawLen = (b64Len * 3) / 4 + 4;
            uint8_t* audioBuf = (uint8_t*)malloc(maxRawLen);

            if (audioBuf) {
                // Декодирование base64
                int ret = mbedtls_base64_decode(audioBuf, maxRawLen, &decodedLen, (const unsigned char*)audioBase64, b64Len);
                if (ret == 0 && decodedLen > 0) {
                    Serial.printf("🔊 [Speaker] Playing synthesized audio (%d bytes)...\n", decodedLen);
                    playAudioBuffer(audioBuf, decodedLen);
                }
                free(audioBuf);
            }
        } else {
            currentState = STATE_IDLE;
        }
    } 
    else if (strcmp(type, "error") == 0) {
        const char* msg = doc["message"] | "Unknown error";
        Serial.printf("❌ [WS Server Error]: %s\n", msg);
        currentState = STATE_ERROR;
        delay(1500);
        currentState = STATE_IDLE;
    }
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
    switch (type) {
        case WStype_DISCONNECTED:
            Serial.println("❌ [WS] Disconnected from Selin AI Server");
            isWsConnected = false;
            currentState = STATE_CONNECTING;
            break;

        case WStype_CONNECTED:
            Serial.printf("✅ [WS] Connected to ws://%s:%d%s\n", WS_SERVER_HOST, WS_SERVER_PORT, WS_SERVER_PATH);
            isWsConnected = true;
            currentState = STATE_IDLE;

            // Отправляем приветственный пакет с ID устройства
            {
                JsonDocument initDoc;
                initDoc["type"] = "register";
                initDoc["deviceId"] = WS_DEVICE_ID;
                initDoc["sampleRate"] = AUDIO_SAMPLE_RATE;
                initDoc["channels"] = AUDIO_CHANNELS;

                String initStr;
                serializeJson(initDoc, initStr);
                webSocket.sendTXT(initStr);
            }
            break;

        case WStype_TEXT:
            handleWebSocketMessage(payload, length);
            break;

        case WStype_BIN:
            // Прямой бинарный поток аудио от сервера
            playAudioBuffer(payload, length);
            break;

        case WStype_ERROR:
            Serial.println("⚠️ [WS] WebSocket communication error");
            break;
        default:
            break;
    }
}

// =============================================
// 4. Поток захвата аудио и детекции речи (VAD)
// =============================================

void audioCaptureTask(void* parameter) {
    int32_t raw_samples[I2S_READ_CHUNK_SIZE];
    int16_t pcm16_samples[I2S_READ_CHUNK_SIZE];
    size_t bytesRead = 0;

    while (true) {
        if (!isWsConnected || isPlayingAudio) {
            vTaskDelay(pdMS_TO_TICKS(20));
            continue;
        }

        // Читаем сырые данные с микрофона
        esp_err_t res = i2s_read(I2S_MIC_PORT, raw_samples, sizeof(raw_samples), &bytesRead, portMAX_DELAY);
        if (res != ESP_OK || bytesRead == 0) {
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        size_t samplesCount = bytesRead / sizeof(int32_t);
        int64_t energySum = 0;

        // Преобразуем 32-битный сэмпл INMP441 в стандартный 16-битный PCM и вычисляем RMS
        for (size_t i = 0; i < samplesCount; i++) {
            // INMP441 отдает 24 бита в старших разрядах 32-битного слова
            int16_t sample16 = (int16_t)(raw_samples[i] >> 14);
            pcm16_samples[i] = sample16;
            energySum += (int32_t)sample16 * (int32_t)sample16;
        }

        int32_t rms = sqrt(energySum / samplesCount);

        // Голосовая активность (VAD)
        if (rms > VAD_SILENCE_THRESHOLD) {
            lastVoiceActivityMs = millis();

            if (!isRecording) {
                isRecording = true;
                speechStartTimeMs = millis();
                currentState = STATE_LISTENING;
                Serial.println("🎙️ [VAD] Voice detected! Recording started...");
            }
        }

        // Если идет запись — передаем бинарные аудиоблоки на сервер
        if (isRecording) {
            webSocket.sendBIN((uint8_t*)pcm16_samples, samplesCount * sizeof(int16_t));

            unsigned long speechDuration = millis() - speechStartTimeMs;
            unsigned long silenceDuration = millis() - lastVoiceActivityMs;

            // Завершение фразы по тишине или превышению лимита
            if (silenceDuration > VAD_SILENCE_HOLD_MS || speechDuration > (VAD_MAX_SPEECH_SEC * 1000)) {
                isRecording = false;
                currentState = STATE_THINKING;
                Serial.printf("🛑 [VAD] Speech ended (%lu ms). Sending audio_end to server...\n", speechDuration);

                JsonDocument endDoc;
                endDoc["type"] = "audio_end";
                endDoc["speakerId"] = WS_DEVICE_ID;

                String jsonStr;
                serializeJson(endDoc, jsonStr);
                webSocket.sendTXT(jsonStr);
            }
        }

        vTaskDelay(pdMS_TO_TICKS(1));
    }
}

// =============================================================================
// 5. Обработка датчика присутствия / движения (PIR)
// =============================================================================

void checkPirSensor() {
    int pirState = digitalRead(PIR_PIN);

    if (pirState == HIGH && (millis() - lastPirTriggerMs > PIR_COOLDOWN_MS)) {
        lastPirTriggerMs = millis();
        Serial.println("🚶 [PIR] Motion detected! Room presence triggered.");

        if (currentState == STATE_IDLE) {
            currentState = STATE_MOTION_DETECTED;

            if (isWsConnected) {
                JsonDocument motionDoc;
                motionDoc["type"] = "motion_event";
                motionDoc["deviceId"] = WS_DEVICE_ID;
                motionDoc["event"] = "presence_detected";

                String str;
                serializeJson(motionDoc, str);
                webSocket.sendTXT(str);
            }

            delay(800);
            currentState = STATE_IDLE;
        }
    }
}

// =============================================================================
// 6. Подключение Wi-Fi
// =============================================================================

void connectToWiFi() {
    Serial.printf("📡 [WiFi] Connecting to %s...\n", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 25) {
        delay(300);
        Serial.print(".");
        updateLeds();
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n✅ [WiFi] Connected!");
        Serial.print("🌐 IP Address: ");
        Serial.println(WiFi.localIP());
    } else {
        Serial.println("\n❌ [WiFi] Connection Failed! Will retry in background...");
        currentState = STATE_ERROR;
    }
}

// =============================================================================
// 7. Главный Setup и Loop
// =============================================================================

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("\n==================================================");
    Serial.println("🚀 Selin AI 2.0 - ESP32-S3 Smart Speaker Booting");
    Serial.println("==================================================");

    // 1. Инициализация светодиодов WS2812
    FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, NUM_LEDS);
    FastLED.setBrightness(LED_BRIGHTNESS);
    fill_solid(leds, NUM_LEDS, CRGB::Blue);
    FastLED.show();

    // 2. Инициализация PIR датчика
    pinMode(PIR_PIN, INPUT_PULLDOWN);

    // 3. Инициализация I2S аудио
    setupI2SMicrophone();
    setupI2SSpeaker();

    // 4. Подключение к Wi-Fi
    connectToWiFi();

    // 5. Настройка WebSocket клиента
    webSocket.begin(WS_SERVER_HOST, WS_SERVER_PORT, WS_SERVER_PATH);
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(WIFI_RECONNECT_MS);
    webSocket.enableHeartbeat(15000, 3000, 2);

    // 6. Запуск фоновой FreeRTOS задачи для захвата аудио на ядре 0
    xTaskCreatePinnedToCore(
        audioCaptureTask,
        "AudioCaptureTask",
        8192,
        NULL,
        1,
        &audioTaskHandle,
        0 // Запуск на Core 0
    );

    Serial.println("🎉 System initialization complete. Ready for voice interaction.");
}

void loop() {
    // 1. Обслуживание WebSocket событий
    webSocket.loop();

    // 2. Проверка состояния Wi-Fi
    if (WiFi.status() != WL_CONNECTED && (millis() - lastWifiCheckMs > WIFI_RECONNECT_MS)) {
        lastWifiCheckMs = millis();
        Serial.println("⚠️ [WiFi] Reconnecting...");
        WiFi.reconnect();
    }

    // 3. Проверка датчика движения PIR
    checkPirSensor();

    // 4. Обновление светодиодной индикации
    updateLeds();

    // Короткая пауза для yield
    vTaskDelay(pdMS_TO_TICKS(15));
}
