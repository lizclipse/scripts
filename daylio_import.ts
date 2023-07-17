#!/usr/bin/env deno run -A
import { ensureDirSync } from "https://deno.land/std@0.155.0/fs/ensure_dir.ts";
import { writeAllSync } from "https://deno.land/std@0.155.0/streams/conversion.ts";
import { moodMap, tagMap } from "./config/daylio.ts";

const tm: Map<number, string> = tagMap();
const cwd = Deno.cwd();
// const daylioEnc = Deno.readTextFileSync(`${cwd}/backup.daylio`);
// // File is base64 encoded
// const daylio: Daylio = JSON.parse(atob(daylioEnc));
const daylio: Daylio = JSON.parse(Deno.readTextFileSync(`${cwd}/backup.json`));
const mm: Map<number, number> = moodMap();

for (const tag of daylio.tags) {
  if (!tm.has(tag.id)) {
    tm.set(tag.id, tag.name.replaceAll(" ", ""));
  }
}

ensureDirSync(`${cwd}/diary`);

interface Entry {
  tags: number[];
  assets: string[];
  moods: number[];
  notes: string[];
  time: Date;
}
const entries = new Map<string, Entry>();
for (const {
  year,
  month,
  day,
  mood,
  tags,
  assets,
  note,
  datetime,
} of daylio.dayEntries.sort((a, b) => a.datetime - b.datetime)) {
  const title = `${year}-${padZero(month + 1)}-${padZero(day)}`;
  let entry = entries.get(title);
  if (!entry) {
    entry = {
      tags: [],
      assets: [],
      moods: [],
      notes: [],
      time: new Date(datetime),
    };
    entries.set(title, entry);
  } else {
    console.log(`Duplicate entry: ${title}`);
  }

  entry.tags.push(...tags);
  entry.assets.push(
    ...assets.map((a) => `![](./images/${year}/${month}/${day}/${a}.jpg)`)
  );
  const moodValue = mm.get(mood);
  if (moodValue != null) entry.moods.push(moodValue);
  else console.log(`Unknown mood: ${mood}`);
  entry.notes.push(note);
}

for (const [title, { tags, assets, moods, notes, time }] of entries) {
  const entry = `---
tags: ${tags
    .map((t) => 'diary/' + tm.get(t))
    .filter(t => {
      if (!t) {
        console.log(`Unknown tag: ${t}`);
        return false;
      }
      return true;
    })
    .join(", ")}
mood: ${moods.join(", ")}
---

${notes.join("\n\n---\n\n")}
${assets.join("\n")}
`;

  // Deno.writeTextFileSync(`${cwd}/diary/${title}.md`, entry);
  const file = await Deno.open(`${cwd}/diary/${title}.md`, {
    create: true,
    write: true,
  });

  try {
    writeAllSync(file, new TextEncoder().encode(entry));
    Deno.futimeSync(file.rid, time, time);
  } finally {
    file.close();
  }
}

interface Tag {
  id: number;
  order: number;
  name: string;
  id_tag_group: number;
  icon: number;
  state: number;
  createdAt: number; // ms
}

interface Mood {
  state: number;
  // 1: great, 2: good, 3: meh, 4: bad, 5: awful
  mood_group_id: number;
  mood_group_order: number;
  id: number;
  custom_name: string;
  icon_id: number;
  predefined_name_id: number;
}

interface DaylioEntry {
  year: number;
  hour: number;
  minute: number;
  mood: number;
  month: number;
  timeZoneOffset: number;
  note_title: string;
  datetime: number;
  note: string;
  assets: number[];
  tags: number[];
  day: number;
}

interface Asset {
  type: number;
  createdAt: number;
  createdAtOffset: number;
  checksum: string;
  id: number;
}

interface Daylio {
  tags: Tag[];
  customMoods: Mood[];
  dayEntries: DaylioEntry[];
  assets: Asset[];
}

function padZero(n: number) {
  return n.toString().padStart(2, "0");
}
