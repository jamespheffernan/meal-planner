import { mkdir, copyFile, readdir } from 'node:fs/promises'
await mkdir(new URL('../dist/scripts/', import.meta.url), { recursive: true })
for (const name of await readdir(new URL('../src/scripts/', import.meta.url))) {
  if (name.startsWith('pi-meals-') && name.endsWith('.py')) await copyFile(new URL(`../src/scripts/${name}`, import.meta.url), new URL(`../dist/scripts/${name}`, import.meta.url))
}
