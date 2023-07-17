#!/usr/bin/env deno run -A
import { walk } from "https://deno.land/std@0.155.0/fs/walk.ts";

const times: { path: string; atime: Date; mtime: Date }[] = [];
for await (const entry of walk(Deno.cwd(), { includeDirs: false })) {
  if (!entry.isFile) continue;
  const { atime, mtime } = await Deno.stat(entry.path);
  times.push({ path: entry.path, atime: atime!, mtime: mtime! });
}

const timesJson = JSON.stringify(times, null, 2);
Deno.writeTextFileSync("../times.json", timesJson);
