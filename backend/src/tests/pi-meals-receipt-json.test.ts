import { expect, test } from "vitest";
import { canonical } from "../pi-meals/store.js";
test("operation fingerprints survive PostgreSQL JSON receipt round trips", () => {
  const prepared = {
    items: [
      {
        source: undefined,
        name: "Lunch",
        ingredients: [{ name: "rice", raw: undefined, quantity: 250 }],
        notes: null,
      },
    ],
    flags: [undefined, null],
  };
  expect(canonical(prepared)).toBe(
    canonical(JSON.parse(JSON.stringify(prepared))),
  );
  expect(canonical({ quantity: null })).not.toBe(canonical({}));
});
