import type { SelectionItem } from "./pi-meals-api";

export interface RecipeGroup {
  key: string;
  name: string;
  source?: string;
  photoUrl?: string;
  recipeId?: string;
  items: SelectionItem[];
  servings: number;
  baseServings: number;
}

export function isRecipeItem(item: SelectionItem): boolean {
  return Boolean(
    item.recipeId || item.draftId || !item.id.startsWith("routine:"),
  );
}

function identities(item: SelectionItem): string[] {
  const ids: string[] = [];
  if (item.source) {
    try {
      const url = new URL(item.source);
      if (url.hostname === "cooking.nytimes.com") {
        const match = url.pathname.match(/^\/recipes\/(\d+)(?:-|\/|$)/);
        if (match) ids.push(`nyt:${match[1]}`);
      }
    } catch {
      /* Non-URL source labels carry no recipe identity. */
    }
  }
  if (item.recipeId) ids.push(`recipe:${item.recipeId}`);
  if (item.draftId) ids.push(`draft:${item.draftId}`);
  return ids.length ? ids : [`item:${item.id}`];
}

/** Group snapshots for display while retaining every original contribution. */
export function groupRecipes(items: SelectionItem[]): RecipeGroup[] {
  const buckets: { ids: Set<string>; items: SelectionItem[] }[] = [];
  for (const item of items.filter(isRecipeItem)) {
    const ids = identities(item);
    const nytIdentity = ids.find((id) => id.startsWith("nyt:"));
    let matches = buckets.filter((bucket) => {
      const existingNyt = [...bucket.ids].find((id) => id.startsWith("nyt:"));
      return (
        !(nytIdentity && existingNyt && nytIdentity !== existingNyt) &&
        ids.some((id) => bucket.ids.has(id))
      );
    });
    const matchingNytIds = new Set(
      matches.flatMap((bucket) =>
        [...bucket.ids].filter((id) => id.startsWith("nyt:")),
      ),
    );
    // An alias shared by different NYT recipes cannot identify which one a
    // source-less snapshot belongs to. Keep it in a separate alias-only group.
    if (matchingNytIds.size > 1) {
      matches = matches.filter(
        (bucket) => ![...bucket.ids].some((id) => id.startsWith("nyt:")),
      );
    }
    const bucket = matches[0] ?? { ids: new Set<string>(), items: [] };
    if (!matches.length) buckets.push(bucket);
    for (const other of matches.slice(1)) {
      other.ids.forEach((id) => bucket.ids.add(id));
      bucket.items.push(...other.items);
      buckets.splice(buckets.indexOf(other), 1);
    }
    ids.forEach((id) => bucket.ids.add(id));
    bucket.items.push(item);
  }
  return buckets.map((bucket) => {
    // Restore selection order after joining identities through another snapshot.
    const members = items.filter((item) => bucket.items.includes(item));
    const first = members[0];
    return {
      key: identities(first)[0],
      name: first.name,
      source: first.source,
      photoUrl: members.find((item) => item.photoUrl)?.photoUrl,
      recipeId: members.find((item) => item.recipeId)?.recipeId,
      items: members,
      servings: members.reduce((total, item) => total + item.servings, 0),
      baseServings: first.baseServings,
    };
  });
}

export function totalRecipeServings(items: SelectionItem[]): number {
  return items
    .filter(isRecipeItem)
    .reduce((total, item) => total + item.servings, 0);
}

export function resizeRecipeGroup(
  items: SelectionItem[],
  group: RecipeGroup,
  servings: number,
): SelectionItem[] {
  if (!Number.isFinite(servings) || servings <= 0 || servings > 1000) {
    throw new RangeError(
      "Recipe servings must be finite, positive, and at most 1000.",
    );
  }
  const ids = new Set(group.items.map((item) => item.id));
  const members = items.filter((item) => ids.has(item.id));
  const total = members.reduce((sum, item) => sum + item.servings, 0);
  if (!members.length) return items;
  if (!Number.isFinite(total) || total <= 0)
    throw new RangeError(
      "Existing recipe servings must be finite and positive.",
    );
  return items.map((item) =>
    ids.has(item.id)
      ? { ...item, servings: servings * (item.servings / total) }
      : item,
  );
}

export function removeRecipeGroup(
  items: SelectionItem[],
  group: RecipeGroup,
): SelectionItem[] {
  const ids = new Set(group.items.map((item) => item.id));
  return items.filter((item) => !ids.has(item.id));
}
