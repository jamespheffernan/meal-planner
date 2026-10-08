// Run against a built local frontend. Every API request is intercepted: no retailer writes.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../../backend/package.json", import.meta.url),
);
const { chromium } = require("playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const calls = [];
const errors = [];
const line = {
  id: "rice",
  name: "rice",
  quantity: 200,
  unit: "g",
  buyQuantity: 200,
  haveQuantity: 0,
  sources: [],
  warnings: [],
};
const selection = {
  id: "test-shop",
  title: "Aside flow check",
  revision: 1,
  items: [
    {
      id: "meal",
      name: "Rice bowl",
      baseServings: 2,
      servings: 2,
      ingredients: [line],
    },
  ],
  lines: [line],
  stock: [],
  updatedAt: new Date().toISOString(),
};
let draft = {
  id: "test-instagram",
  name: "Saved Instagram recipe",
  source: "https://www.instagram.com/reel/synthetic/",
  revision: 1,
  servings: null,
  ingredients: [],
  instructions: [],
  evidence: [],
  gaps: ["Yield missing"],
  status: "draft",
};
let basket;
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/api/**", async (route) => {
  const request = route.request(),
    path = new URL(request.url()).pathname.replace(/^\/api/, "");
  const method = request.method();
  const input = method === "GET" ? undefined : request.postDataJSON();
  calls.push({ path, method, input });
  let result;
  if (path === "/pi-meals/auth/session")
    result = { actorId: "james", name: "James" };
  else if (path === "/pi-meals/assistant/status")
    result = { available: false, status: "unavailable" };
  else if (path === "/recipes") result = [];
  else if (path === "/pi-meals/intake" && method === "GET") result = [draft];
  else if (path === "/pi-meals/intake/test-instagram" && method === "PATCH")
    result = draft = { ...draft, ...input.draft, revision: draft.revision + 1 };
  else if (path === "/pi-meals/intake/aside-tabs")
    result = {
      tabs: Array.from({ length: 21 }, (_, i) => ({
        targetId: `tab-${i}`,
        title: `Open recipe ${i + 1}`,
        url: `https://cooking.nytimes.com/recipes/${100 + i}`,
      })),
    };
  else if (path === "/pi-meals/selections") result = [selection];
  else if (path === "/pi-meals/selections/test-shop") result = selection;
  else if (path === "/pi-meals/shopping/test-shop")
    result = {
      id: "cycle",
      revision: 1,
      selectionId: selection.id,
      selectionRevision: 1,
      lines: [
        {
          ...line,
          route: "supermarket",
          remainingQuantity: 200,
          boughtQuantity: 0,
        },
      ],
      purchases: [],
      orphanPurchases: [],
    };
  else if (path === "/pi-meals/baskets" && method === "GET")
    result = { baskets: basket ? [basket] : [] };
  else if (path === "/pi-meals/baskets" && method === "POST") {
    assert.equal(input.executor, "aside");
    result = basket = {
      id: "test-basket",
      revision: 1,
      selectionId: selection.id,
      selectionRevision: 1,
      executor: "aside",
      status: "draft",
      lines: [line],
      unresolved: [],
    };
  } else if (path === "/pi-meals/baskets/test-basket/open-aside") {
    result = basket = {
      ...basket,
      revision: 2,
      status: "needs_review",
      taskId: "session-test",
      receipt: { sessionId: "session-test", processState: "started" },
    };
  } else if (path === "/pi-meals/baskets/test-basket/stop-aside") {
    result = basket = {
      ...basket,
      revision: 3,
      receipt: {
        ...basket.receipt,
        reviewToken: "review",
        sessionStopped: { status: "idle" },
      },
    };
  } else if (path === "/pi-meals/baskets/test-basket/finish-aside") {
    assert.equal(input.confirmedTrolley, true);
    assert.equal(input.reviewToken, "review");
    result = basket = {
      ...basket,
      revision: 4,
      status: "complete",
      receipt: { ...basket.receipt, verification: "user" },
    };
  } else if (path === "/pi-meals/baskets/test-basket/handoff")
    result = {
      basketId: basket.id,
      revision: basket.revision,
      text: "Synthetic shopping instructions",
    };
  else if (path === "/pi-meals/baskets/test-basket")
    result = { ...basket, asideSession: { status: "idle" } };
  else {
    errors.push(`Unexpected API call: ${method} ${path}`);
    return route.fulfill({
      status: 500,
      json: { error: "Unexpected test request" },
    });
  }
  await route.fulfill({ json: result });
});
try {
  await page.goto(
    process.env.PI_MEALS_TEST_URL || "http://127.0.0.1:3100/shop-recipes",
  );
  await page
    .getByRole("heading", { name: selection.title, exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Import a recipe", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Find recipes open in Aside", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import 20 recipes", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("checkbox").filter({ visible: true }).count(),
    21,
  );
  assert.equal(
    await page
      .getByRole("checkbox", { name: "Open recipe 21", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByText(draft.name, { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Recipe name", exact: true })
    .fill("Corrected Instagram recipe");
  await page.getByText("Changes not saved yet", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Save draft changes", exact: true })
    .click();
  await page.getByText("Draft changes saved.", { exact: true }).waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "Import a recipe", exact: true })
    .click();
  await page.getByText("Corrected Instagram recipe", { exact: true }).click();
  await page
    .getByText("Draft saved in your shared kitchen", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: /^Shop\s+\d+$/ }).click();
  await page
    .getByRole("button", { name: "Shop with Aside", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "Shopping task opened in Aside",
      exact: true,
    })
    .waitFor();
  assert.equal(
    calls.filter((call) => call.path.endsWith("/open-aside")).length,
    1,
  );
  assert.equal(
    await page.getByRole("textbox", { name: "Search Ocado for rice" }).count(),
    0,
  );
  await page.reload();
  await page.getByRole("button", { name: /^Shop\s+\d+$/ }).click();
  await page
    .getByRole("heading", {
      name: "Shopping task opened in Aside",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Shop with Aside", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    calls.filter((call) => call.path.endsWith("/open-aside")).length,
    1,
  );
  await page
    .getByRole("button", {
      name: "Stop shopping & review trolley",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "I’ve checked the trolley", exact: true })
    .waitFor();
  assert.equal(
    calls.filter((call) => call.path.endsWith("/finish-aside")).length,
    0,
  );
  await page
    .getByRole("button", { name: "I’ve checked the trolley", exact: true })
    .click();
  await page
    .getByRole("link", {
      name: "Open Ocado to place your order ↗",
      exact: true,
    })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: import limit, saved draft reload, one-click launch, task reload, optional picker, separate trolley review, mobile width; retailer APIs mocked.",
  );
} finally {
  await browser.close();
}
