import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { EvidenceLine } from "./contracts.js";

export class AsideRecipeError extends Error {
  statusCode = 400;
}
export function nytRecipeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AsideRecipeError("Use a valid NYT Cooking recipe URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "cooking.nytimes.com" ||
    url.username ||
    url.password ||
    url.port ||
    !/^\/recipes\/\d+(?:-[a-z0-9-]+)?\/?$/.test(url.pathname)
  )
    throw new AsideRecipeError(
      "Use an HTTPS cooking.nytimes.com/recipes recipe URL.",
    );
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}
export function nytRecipeIdentity(value: string): string {
  return new URL(nytRecipeUrl(value)).pathname.match(/^\/recipes\/(\d+)/)![1];
}
const tabSchema = z.object({
  targetId: z.string().min(1).max(200),
  title: z.string().max(2000),
  url: z.string().max(4000),
});
export type AsideRecipeTab = z.infer<typeof tabSchema>;
export function parseAsideOutput(stdout: string, marker: string): unknown {
  const line = stdout.split(/\r?\n/).find((line) => line.startsWith(marker));
  if (!line)
    throw new AsideRecipeError(
      "Aside returned no recipe result. Check that Aside is running and try again.",
    );
  try {
    return JSON.parse(line.slice(marker.length));
  } catch {
    throw new AsideRecipeError("Aside returned an unreadable recipe result.");
  }
}
async function runAside(code: (marker: string) => string): Promise<unknown> {
  const marker = `PI_MEALS_${randomUUID()}:`;
  return new Promise((resolve, reject) => {
    execFile(
      process.env.PI_MEALS_ASIDE_BINARY ?? "aside",
      ["repl", code(marker)],
      {
        shell: false,
        timeout: 45_000,
        killSignal: "SIGKILL",
        maxBuffer: 2_000_000,
      },
      (error, stdout) => {
        if (error) {
          reject(
            new AsideRecipeError(
              "Aside recipe capture failed or timed out. Check that Aside is running and you are signed in to NYT Cooking, then retry.",
            ),
          );
          return;
        }
        try {
          resolve(parseAsideOutput(stdout, marker));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}
export async function listAsideRecipeTabs(): Promise<AsideRecipeTab[]> {
  const result = await runAside(
    (marker) =>
      `console.log(${JSON.stringify(marker)} + JSON.stringify((await listBrowserTabs()).map(t => ({targetId:t.targetId,title:t.title,url:t.url}))));`,
  );
  const tabs = z.array(tabSchema).max(1000).parse(result);
  const seen = new Set<string>();
  return tabs.filter((tab) => {
    try {
      const id = nytRecipeIdentity(tab.url);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    } catch {
      return false;
    }
  });
}
/** Keep only observed recipe nodes, stopping before recommendations and comments. */
export function recipeSnapshotEvidence(tree: string): EvidenceLine[] {
  const lines = tree.split(/\n/);
  const title = lines.find((line) => /- heading ".*" \[level=1\]/.test(line));
  const ingredients = lines.findIndex((line) =>
    /- heading "Ingredients"/.test(line),
  );
  const method = lines.findIndex(
    (line, index) =>
      index > ingredients && /- heading "Preparation"/.test(line),
  );
  if (!title || ingredients < 0 || method < 0)
    throw new AsideRecipeError(
      "NYT recipe ingredients and preparation are not visible. Sign in to NYT Cooking in Aside and retry.",
    );
  const indent = lines[method].match(/^\s*/)![0].length;
  let end = method + 1;
  while (end < lines.length) {
    const line = lines[end];
    const depth = line.match(/^\s*/)![0].length;
    if (line.trim() && depth <= indent && !/^\s*- (?:list:|text:)/.test(line))
      break;
    end++;
  }
  const relevant = [
    title,
    ...lines
      .slice(ingredients, end)
      .filter((line) => !/^\s*- (?:button|link|iframe|img|image)\b/.test(line)),
  ].join("\n");
  if (relevant.length > 128_000)
    throw new AsideRecipeError("NYT recipe evidence exceeds 128 KB.");
  return [{ source: "page", text: relevant }];
}
export function nytRecipePhotoUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4000) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "static01.nyt.com" ||
      url.username ||
      url.password ||
      url.port
    )
      return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
export async function captureAsideRecipe(
  value: string,
): Promise<{ evidence: EvidenceLine[]; photoUrl?: string }> {
  const url = nytRecipeUrl(value);
  const id = nytRecipeIdentity(url);
  const result = await runAside(
    (marker) => `await (async () => {
    const wanted = ${JSON.stringify(url)};
    const identity = value => { try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'cooking.nytimes.com' && !u.username && !u.password && !u.port && /^\\/recipes\\/\\d+(?:-[a-z0-9-]+)?\\/?$/.test(u.pathname) ? u.pathname.match(/^\\/recipes\\/(\\d+)/)[1] : null; } catch { return null; } };
    const match = (await listBrowserTabs()).find(t => identity(t.url) === ${JSON.stringify(id)});
    let owned = false; let target;
    try {
      if (match) { await attachBrowserTab(match.targetId); target = page; } else { target = await openTab(wanted); owned = true; }
      await snapshot(target, {interactive:true});
      const state = await snapshot(target);
      let photoUrl;
      if (identity(target.url()) === ${JSON.stringify(id)}) {
        try {
          photoUrl = await target.evaluate(() => document.querySelector('meta[property="og:image"]')?.getAttribute('content') || document.querySelector('meta[name="twitter:image"]')?.getAttribute('content'));
        } catch { /* An optional photo must never prevent text capture. */ }
      }
      console.log(${JSON.stringify(marker)} + JSON.stringify({url:target.url(),tree:state.tree,photoUrl}));
    } finally { if (owned && target) await closeTab(target); }
  })();`,
  );
  const captured = z
    .object({
      url: z.string().max(4000),
      tree: z.string().max(1_500_000),
      photoUrl: z.unknown().optional(),
    })
    .parse(result);
  if (nytRecipeIdentity(captured.url) !== id)
    throw new AsideRecipeError(
      "Aside opened a different recipe or sign-in page. Open the requested recipe in Aside and retry.",
    );
  return {
    evidence: recipeSnapshotEvidence(captured.tree),
    photoUrl: nytRecipePhotoUrl(captured.photoUrl),
  };
}
