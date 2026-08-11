import { test, describe } from "node:test";
import assert from "node:assert";
import { connectorRegistry } from "../src/connectors";

describe("ServiceConnectors Unit & Fallback Tests", () => {
  test("1. TaxiConnector execution & Deep Link fallback", async () => {
    const res = await connectorRegistry.execute("taxi_connector", {
      fromAddress: "Москва, Тверская 1",
      toAddress: "Аэропорт Шереметьево",
      carClass: "comfort"
    }, "tenant_test_1");

    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.ok(res.data.deepLink);
    assert.ok(res.data.deepLink.includes("yandex.ru/route"));
    assert.ok(res.data.priceRub > 0);
  });

  test("2. FoodDeliveryConnector execution & Deep Link fallback", async () => {
    const res = await connectorRegistry.execute("food_delivery_connector", {
      items: ["Пепперони 30см", "Додстер"],
      address: "ул. Ленина, д. 10"
    }, "tenant_test_1");

    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.ok(res.data.items.length === 2);
    assert.ok(res.data.trackingUrl);
  });

  test("3. TravelConnector execution & Aviasales fallback", async () => {
    const res = await connectorRegistry.execute("travel_connector", {
      from: "Москва",
      to: "Дубай",
      departureDate: "2026-09-01"
    }, "tenant_test_1");

    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.ok(res.data.options.length > 0);
    assert.ok(res.data.deepLink.includes("aviasales.ru"));
  });

  test("4. InstagramConnector execution & Draft generation", async () => {
    const res = await connectorRegistry.execute("instagram_connector", {
      task: "content_plan",
      niche: "Автосервис премиум"
    }, "tenant_test_1");

    assert.strictEqual(res.success, true);
    assert.ok(res.data);
  });

  test("5. BusinessPlanConnector execution & SMART plan", async () => {
    const res = await connectorRegistry.execute("business_plan_connector", {
      businessIdea: "Автономная кофейня с ИИ-бариста"
    }, "tenant_test_1");

    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.ok(res.data.planTitle);
    assert.ok(res.data.visualPrompts.length > 0);
  });
});
