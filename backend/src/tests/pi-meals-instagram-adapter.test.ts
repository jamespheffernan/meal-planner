import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
const execute = promisify(execFile);
const workRoot = "/Volumes/4TB Private/Offloaded/Agent Work/pi-meals-20261007";
describe("Python Sweeper adapter", () => {
  it("calls only single-link inspection and recipe extraction, maps evidence, and removes temporary media", async () => {
    const directory = await mkdtemp(`${workRoot}/adapter-test-`);
    try {
      const pilot = resolve(directory, "pilot.py");
      const adapter = resolve("src/scripts/pi-meals-instagram.py");
      await writeFile(
        pilot,
        `from types import SimpleNamespace\nfrom pathlib import Path\ndef inspect_instagram_url(url, work_dir, cookies_from_browser, *, download_media):\n assert cookies_from_browser is None\n assert download_media\n assert url == 'https://www.instagram.com/reel/abc/'\n (work_dir/'media.mp4').write_text('fixture')\n return SimpleNamespace(evidence=[SimpleNamespace(source='caption',text='Soup'),SimpleNamespace(source='spoken instructions',text='Simmer.'),SimpleNamespace(source='on-screen text',text='200 g tomatoes')], media_context={'extraction_gaps':['speech incomplete']},error='')\ndef recipe_from_evidence(lines):\n return {'is_recipe':True,'proof':'called'}\ndef read_messages(*args):\n raise AssertionError('WhatsApp must never be read')\n`,
      );
      const { stdout } = await execute(
        "python3",
        [adapter, "https://www.instagram.com/reel/abc/?igsh=x"],
        {
          env: {
            ...process.env,
            MANON_SWEEPER_PATH: pilot,
            PI_MEALS_WORK_DIR: resolve(directory, "media"),
          },
          timeout: 3000,
        },
      );
      const result = JSON.parse(stdout);
      expect(result.evidence.map((e: any) => e.source)).toEqual([
        "caption",
        "speech",
        "ocr",
      ]);
      expect(result.recipe.proof).toBe("called");
      expect(result.gaps).toEqual(["speech incomplete"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("returns an actionable missing extractor gap", async () => {
    const { stdout } = await execute(
      "python3",
      [
        resolve("src/scripts/pi-meals-instagram.py"),
        "https://instagram.com/p/abc/",
      ],
      {
        env: {
          ...process.env,
          MANON_SWEEPER_PATH: "/nonexistent/pi-meals-pilot.py",
        },
        timeout: 3000,
      },
    );
    expect(JSON.parse(stdout).gaps.join(" ")).toContain("MANON_SWEEPER_PATH");
  });
});
