import Fastify from "fastify";
import { test, expect } from "vitest";
import { installLegacyEffectBoundary } from "../pi-meals/legacy-effects.js";

test("old assistant/cart/checkout writers cannot bypass the reviewed basket", async () => {
  const app = Fastify();
  installLegacyEffectBoundary(app);
  const retired = [
    "/api/stores/ocado/cart/add",
    "/api/stores/ocado/checkout/dry-run",
    "/api/stores/ocado/place-order",
    "/api/shopping-lists/list/order/add-to-cart",
    "/api/shopping-lists/list/order/checkout/dry-run",
    "/api/shopping-lists/list/order/place-order",
    "/api/shopping-assistant/message",
  ];
  let effects = 0;
  for (const path of [
    ...retired,
    "/api/stores/ocado/search",
    "/api/pi-meals/baskets/basket/fill",
  ])
    app.post(path, async () => {
      effects++;
      return { ok: true };
    });
  for (const path of retired)
    expect((await app.inject({ method: "POST", url: path })).statusCode).toBe(
      410,
    );
  for (const path of [
    "/api/stores/ocado/%63art/add",
    "/api/shopping-lists/list/order/%61dd-to-cart",
    "/api/shopping-assistant/%6dessage",
  ]) {
    const response = await app.inject({ method: "POST", url: path });
    // A router that rejects an encoded static path is also safe.
    expect([404, 410]).toContain(response.statusCode);
  }
  expect(effects).toBe(0);
  expect(
    (await app.inject({ method: "POST", url: "/api/stores/ocado/search" }))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/pi-meals/baskets/basket/fill",
      })
    ).statusCode,
  ).toBe(200);
  await app.close();
});
