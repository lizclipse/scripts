#!/usr/bin/env deno run -A

import { ensureDir } from "https://deno.land/std@0.155.0/fs/ensure_dir.ts";

const dateRe = /(\d{4})-(\d{2})-(\d{2})/;
for await (const entry of Deno.readDir(Deno.cwd())) {
  if (!entry.isFile) continue;
  if (!entry.name.endsWith(".md")) continue;
  const match = dateRe.exec(entry.name);
  if (!match) continue;
  const [, year, month] = match;
  const newPath = `${year}/${month}/Entry ${entry.name}`;
  console.log(`${entry.name} -> ${newPath}`);
  await ensureDir(`${Deno.cwd()}/${year}/${month}`);
  await Deno.rename(entry.name, newPath);
}
