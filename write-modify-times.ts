#!/usr/bin/env deno run -A
const times: { path: string; atime: string; mtime: string }[] = JSON.parse(Deno.readTextFileSync("../times.json"));
for await (const time of times) {
  try {
    await Deno.utime(time.path, new Date(time.atime), new Date(time.mtime));
  } catch {
    console.log(`Failed to set time for ${time.path}`);
  }
}
