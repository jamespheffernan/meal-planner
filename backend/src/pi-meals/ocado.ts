import type { Page } from "playwright";
import type { PrismaClient } from "@prisma/client";
import { OcadoAutomation } from "../services/stores/ocado/ocado-automation.js";
import type { BasketManifestLine } from "./contracts.js";
import type { BasketExecutor, CartObservation } from "./baskets.js";

/** A deliberately strict DOM contract: a declared trolley item count and one
 * unambiguous product/quantity row per item. Unknown layouts fail closed. */
export async function readVerifiedCart(page: Page): Promise<CartObservation> {
  await page.goto("https://www.ocado.com/webshop/trolley/trolley.do", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle", { timeout: 15000 });
  const result = await page.evaluate(() => {
    const document = (globalThis as any).document;
    const body: string = document.body.innerText;
    if (
      /sign in|log in|captcha|verify you are human|unusual traffic/i.test(body)
    )
      throw new Error("Ocado login or access check requires attention.");
    const counts = [
      ...body.matchAll(/(?:trolley|basket)\s*\(?\s*(\d+)\s*items?\)?/gi),
    ].map((m) => Number(m[1]));
    const empty = /your (?:trolley|basket) is empty/i.test(body);
    const declared = empty ? 0 : counts[0];
    if (declared === undefined || counts.some((n) => n !== declared))
      throw new Error("Cannot verify complete trolley item count.");
    const inputs = Array.from(
      document.querySelectorAll('input[type="number"]'),
    ) as any[];
    const items: Array<{ productId: string; quantity: number }> = [];
    for (const input of inputs) {
      let parent: any = input.parentElement,
        match: string | undefined;
      for (
        let depth = 0;
        parent && depth < 8;
        depth++, parent = parent.parentElement
      ) {
        const ids = new Set(
          (
            Array.from(
              parent.querySelectorAll('a[href*="/products/"]'),
            ) as any[]
          )
            .map((a) => a.pathname.match(/(\d{4,})(?:\/)?$/)?.[1])
            .filter(Boolean),
        );
        if (ids.size === 1) {
          match = [...ids][0] as string;
          break;
        }
        if (ids.size > 1) break;
      }
      if (!match) throw new Error("Unidentified trolley quantity control.");
      const quantity = Number(input.value);
      if (!Number.isSafeInteger(quantity) || quantity < 1)
        throw new Error("Unverified trolley quantity.");
      items.push({ productId: match, quantity });
    }
    if (
      items.length !== declared ||
      new Set(items.map((i) => i.productId)).size !== items.length
    )
      throw new Error("Trolley read does not cover its declared items.");
    return { items, declared, url: (globalThis as any).location.href };
  });
  return {
    verified: true,
    items: result.items,
    evidence: {
      source: "complete-dom-controls",
      declaredCount: result.declared,
      url: result.url,
      observedAt: new Date().toISOString(),
    },
  };
}
export function pageExecutor(
  page: Page,
  lines: BasketManifestLine[],
): BasketExecutor {
  return {
    readCart: () => readVerifiedCart(page),
    addPacks: async (productId, packs, beforeWrite) => {
      if (
        !/^\d{4,}$/.test(productId) ||
        !Number.isSafeInteger(packs) ||
        packs < 1
      )
        throw new Error("Invalid reviewed product or pack count.");
      const reviewed = lines.find((line) => line.productId === productId);
      if (
        !reviewed?.productName ||
        !reviewed.packQuantity ||
        !reviewed.packUnit
      )
        throw new Error("Missing reviewed product details.");
      for (let i = 0; i < packs; i++) {
        const before = await readVerifiedCart(page);
        await page.goto(`https://www.ocado.com/products/${productId}`, {
          waitUntil: "domcontentloaded",
        });
        await page.waitForLoadState("networkidle", { timeout: 15000 });
        const canonical = await page
          .locator('link[rel="canonical"]')
          .getAttribute("href");
        if (
          !canonical ||
          !new URL(canonical, "https://www.ocado.com").pathname.match(
            new RegExp(`(?:/|-)${productId}/?$`),
          )
        )
          throw new Error("Product identity could not be verified.");
        const body = await page.locator("body").innerText();
        if (
          /captcha|verify you are human|sign in|log in|unusual traffic/i.test(
            body,
          )
        )
          throw new Error(
            "Ocado requires attention before adding this product.",
          );
        const heading = (await page.locator("h1").innerText())
          .replace(/\s+/g, " ")
          .trim();
        if (
          heading.toLowerCase() !==
          reviewed.productName.replace(/\s+/g, " ").trim().toLowerCase()
        )
          throw new Error("Product name differs from the reviewed product.");
        const normalized = body.replace(/\s+/g, "").toLowerCase();
        const packText = `${reviewed.packQuantity}${reviewed.packUnit}`
          .replace(/\s+/g, "")
          .toLowerCase()
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (
          !new RegExp(`(?:^|[^0-9.])${packText}(?:$|[^a-z])`).test(normalized)
        )
          throw new Error(
            "Reviewed pack size could not be verified on the product page.",
          );
        // One chosen locator. A failed click is never retried through another selector.
        const add = page.getByRole("button", {
          name: /^add(?: to trolley| to basket)?$/i,
        });
        if ((await add.count()) !== 1)
          throw new Error("Product add control is ambiguous.");
        // Recheck the durable account owner and reviewed selection for every pack,
        // after product-page reads and immediately before the irreversible click.
        if (beforeWrite) await beforeWrite();
        await add.click({ timeout: 5000 });
        await page.waitForLoadState("networkidle", { timeout: 15000 });
        const after = await readVerifiedCart(page);
        const expected = new Map(
          before.items.map((item) => [item.productId, item.quantity]),
        );
        expected.set(productId, (expected.get(productId) ?? 0) + 1);
        if (
          after.items.length !== expected.size ||
          after.items.some(
            (item) => expected.get(item.productId) !== item.quantity,
          )
        )
          throw new Error(
            "Single add readback differs from its intent. Stop without retry.",
          );
      }
    },
  };
}
export async function withOcadoExecutor<T>(
  prisma: PrismaClient,
  lines: BasketManifestLine[],
  run: (executor: BasketExecutor) => Promise<T>,
): Promise<T> {
  return new OcadoAutomation(prisma).withPage({}, ({ page }) =>
    run(pageExecutor(page, lines)),
  );
}

export interface MealProduct {
  productId: string;
  name: string;
  price: number | null;
  imageUrl: string | null;
  productUrl: string;
  packLabel?: string;
  packQuantity?: number;
  packUnit?: string;
}
/** Accept explicit pack labels only. Marketing numbers and unit prices are not pack sizes. */
export function parsePackLabel(
  label: string,
): { packQuantity: number; packUnit: string } | undefined {
  const value = label.trim().toLowerCase();
  if (/\b(?:per|each)\b|\//.test(value)) return undefined;
  const weight = value.match(
    /^(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|ml|l)$/,
  );
  if (weight) {
    const amount = Number(weight[2]) * Number(weight[1] ?? 1);
    return amount > 0
      ? { packQuantity: amount, packUnit: weight[3] }
      : undefined;
  }
  const count = value.match(/^(\d+)\s*(?:pack|pieces?|count)$/);
  return count && Number(count[1]) > 0
    ? { packQuantity: Number(count[1]), packUnit: "piece" }
    : undefined;
}
export function validateProductQuery(input: unknown): string {
  if (typeof input !== "string" || !input.trim() || input.trim().length > 160)
    throw Object.assign(
      new Error("Enter a product search between 1 and 160 characters."),
      { statusCode: 400 },
    );
  return input.trim();
}
export async function searchMealProducts(
  prisma: PrismaClient,
  input: unknown,
): Promise<MealProduct[]> {
  const query = validateProductQuery(input),
    automation = new OcadoAutomation(prisma);
  return automation
    .withPage({}, async ({ page }) => {
      const results = await automation.searchProducts(page, query, 8);
      // Explicit size nodes keep nutrition, price-per-unit, and promotional text out of the pack parser.
      const labels = (await page.evaluate(`(() => {
      const out = {};
      for (const a of document.querySelectorAll('a[href*="/products/"]')) {
        const id = new URL(a.href).pathname.match(/(?:\/|-)(\\d{4,})\\/?$/)?.[1];
        if (!id) continue;
        let parent = a;
        for (let depth=0; parent && depth<7; depth++, parent=parent.parentElement) {
          const ids = new Set([...parent.querySelectorAll('a[href*="/products/"]')].map(link=>new URL(link.href).pathname.match(/(?:\/|-)(\\d{4,})\\/?$/)?.[1]).filter(Boolean));
          if (ids.size > 1) break;
          const sizes = [...parent.querySelectorAll('[data-test*="size"], [data-testid*="size"], [class*="pack-size"], [class*="fop-size"]')].map(node=>node.textContent.trim()).filter(Boolean);
          if (sizes.length === 1) { out[id]=sizes[0]; break; }
        }
      }
      return out;
    })()`)) as Record<string, string>;
      return results
        .filter(
          (product) =>
            /^\d{4,}$/.test(product.providerProductId) &&
            !!product.name &&
            !/^Ocado product \d+$/.test(product.name),
        )
        .map((product) => {
          const packLabel = labels[product.providerProductId];
          return {
            productId: product.providerProductId,
            name: product.name,
            price: product.price,
            imageUrl: product.imageUrl,
            productUrl:
              product.productUrl ??
              `https://www.ocado.com/products/${product.providerProductId}`,
            ...(packLabel ? { packLabel, ...parsePackLabel(packLabel) } : {}),
          };
        });
    })
    .catch((error) => {
      throw Object.assign(
        new Error(
          `Ocado search unavailable. Connect or reconnect Ocado in Settings; complete any login or access check there. ${error instanceof Error ? error.message : "Unknown provider error"}`,
        ),
        { statusCode: 503 },
      );
    });
}
