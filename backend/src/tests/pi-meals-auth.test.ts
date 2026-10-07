import { createHmac } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { installMealAuth, getMealActorId } from "../pi-meals/auth.js";
const secret = "isolated-fake-session-secret-long-enough";
let app: FastifyInstance, ip: string;
let counter = 1;
const login = (payload: unknown, origin?: string) =>
  app.inject({
    method: "POST",
    url: "/api/pi-meals/auth/login",
    payload: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    remoteAddress: ip,
  });
const cookie = (r: { headers: Record<string, unknown> }) =>
  String(r.headers["set-cookie"]).split(";")[0];
const signed = (actor: string, expires: number) => {
  const body = Buffer.from(JSON.stringify({ actor, expires })).toString(
    "base64url",
  );
  return `pi_meals_session=${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
};
beforeEach(async () => {
  vi.stubEnv("PI_MEALS_SESSION_SECRET", secret);
  vi.stubEnv("PI_MEALS_JAMES_PIN", "fake-james");
  vi.stubEnv("PI_MEALS_MANON_PIN", "fake-manon");
  vi.stubEnv("PI_MEALS_AUTH_DISABLED", "");
  vi.stubEnv("PI_MEALS_ALLOWED_ORIGINS", "http://localhost:3100");
  vi.stubEnv("PI_MEALS_SECURE_COOKIE", "true");
  ip = `192.0.2.${counter++}`;
  app = Fastify();
  await installMealAuth(app);
  app.get("/health", async () => ({ ok: true }));
  app.get("/api/legacy/recipes", async (request) => ({
    actor: getMealActorId(request),
  }));
  app.post("/api/legacy/order", async () => ({ ok: true }));
});
afterEach(async () => {
  await app.close();
  vi.unstubAllEnvs();
});
it.each([
  ["James", "fake-james", "james"],
  ["MANON", "fake-manon", "manon"],
])("signs in %s and restores signed session", async (member, pin, actorId) => {
  const response = await login({ member, pin });
  expect(response.statusCode).toBe(200);
  expect(response.json().actorId).toBe(actorId);
  expect(response.headers["set-cookie"]).toContain(
    "HttpOnly; SameSite=Strict; Max-Age=1209600; Secure",
  );
  const session = await app.inject({
    url: "/api/pi-meals/auth/session",
    headers: { cookie: cookie(response) },
  });
  expect(session.statusCode).toBe(200);
  expect(session.json().actorId).toBe(actorId);
});
it.each([
  {},
  null,
  [],
  { member: 1 },
  { member: {} },
  { member: [] },
  { member: "james", pin: 1 },
  { member: "other", pin: "fake-james" },
  { member: "james", pin: "wrong" },
])("rejects malformed or invalid credentials: %j", async (value) => {
  const response = await login(value);
  expect(response.statusCode).toBe(401);
  expect(response.headers["set-cookie"]).toBeUndefined();
});
it("protects current and legacy routes and leaves health public", async () => {
  for (const url of ["/api/pi-meals/auth/session", "/api/legacy/recipes"])
    expect((await app.inject({ url })).statusCode).toBe(401);
  expect(
    (await app.inject({ method: "POST", url: "/api/legacy/order" })).statusCode,
  ).toBe(401);
  expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
});
it("rejects tampered, expired and unsupported sessions", async () => {
  const valid = cookie(await login({ member: "james", pin: "fake-james" }));
  for (const value of [
    valid + ".extra",
    valid.replace(/.$/, "!"),
    signed("james", Date.now() - 1),
    signed("other", Date.now() + 10000),
  ]) {
    expect(
      (
        await app.inject({
          url: "/api/pi-meals/auth/session",
          headers: { cookie: value },
        })
      ).statusCode,
    ).toBe(401);
  }
});
it("rejects foreign origins for login and authenticated legacy mutations", async () => {
  expect(
    (
      await login(
        { member: "james", pin: "fake-james" },
        "https://foreign.example",
      )
    ).statusCode,
  ).toBe(403);
  const value = cookie(
    await login(
      { member: "james", pin: "fake-james" },
      "http://localhost:3100",
    ),
  );
  for (const [origin, status] of [
    ["https://foreign.example", 403],
    ["http://localhost:3100", 200],
  ] as const) {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/legacy/order",
          headers: { cookie: value, origin },
        })
      ).statusCode,
    ).toBe(status);
  }
});
it("clears the browser cookie on logout", async () => {
  const value = cookie(await login({ member: "james", pin: "fake-james" }));
  const response = await app.inject({
    method: "POST",
    url: "/api/pi-meals/auth/logout",
    headers: { cookie: value },
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers["set-cookie"]).toBe(
    "pi_meals_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure",
  );
  expect(
    (
      await app.inject({
        url: "/api/pi-meals/auth/session",
        headers: { cookie: cookie(response) },
      })
    ).statusCode,
  ).toBe(401);
});
it("allows explicit bypass only under NODE_ENV test", async () => {
  vi.stubEnv("PI_MEALS_AUTH_DISABLED", "test");
  vi.stubEnv("NODE_ENV", "production");
  expect((await app.inject({ url: "/api/legacy/recipes" })).statusCode).toBe(
    401,
  );
  vi.stubEnv("NODE_ENV", "test");
  expect((await app.inject({ url: "/api/legacy/recipes" })).json()).toEqual({
    actor: "james",
  });
});
it("bounds failed attempts then releases after ten minutes", async () => {
  for (let i = 0; i < 8; i++)
    expect((await login({ member: "james", pin: "wrong" })).statusCode).toBe(
      401,
    );
  expect((await login({ member: "james", pin: "fake-james" })).statusCode).toBe(
    429,
  );
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 600001);
  try {
    expect(
      (await login({ member: "james", pin: "fake-james" })).statusCode,
    ).toBe(200);
  } finally {
    clock.mockRestore();
  }
});
it("fails closed without a signing secret", async () => {
  vi.stubEnv("PI_MEALS_SESSION_SECRET", "");
  expect((await login({ member: "james", pin: "fake-james" })).statusCode).toBe(
    503,
  );
});
it("does not lock the other member behind the same household proxy", async () => {
  for (let i = 0; i < 8; i++) await login({ member: "james", pin: "wrong" });
  expect((await login({ member: "james", pin: "fake-james" })).statusCode).toBe(
    429,
  );
  expect((await login({ member: "manon", pin: "fake-manon" })).statusCode).toBe(
    200,
  );
});
