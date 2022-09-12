import { parse } from "https://deno.land/std@0.155.0/flags/mod.ts";
import { ensureDir } from "https://deno.land/std@0.155.0/fs/ensure_dir.ts";
import { move } from "https://deno.land/std@0.155.0/fs/move.ts";
import { walk } from "https://deno.land/std@0.155.0/fs/walk.ts";
import {
  dirname,
  extname,
  relative,
  resolve,
} from "https://deno.land/std@0.155.0/path/mod.ts";
import { writeAll } from "https://deno.land/std@0.155.0/streams/conversion.ts";

const ignored = new Set([".DS_Store"]);
const stripSync = new Set([".DS_Store"]);

class ProgramError extends Error {}

const encoder = new TextEncoder();

interface ProgramInit {
  ingest: string;
  bucket: string;
  encode: { type: "arg" | "tmp"; path: string };
  archive: string;
  debug: {
    stdout?: string;
    stderr?: string;
  };
}

function printHelp() {
  console.log(
    "video-log-ingest.ts --ingest=<ingest/folder> [--encode=encode/folder] --archive=<archive folder> [--debug-stdout=stdout.log] [--debug-stderr=stderr.log]"
  );
}

async function writeStdout(...parts: string[]) {
  await writeAll(Deno.stdout, encoder.encode(parts.join(" ")));
}

class Program {
  static async run(args: string[]) {
    const {
      help,
      h,
      ingest,
      bucket,
      encode,
      archive,
      "debug-stdout": debugStdout,
      "debug-stderr": debugStderr,
    } = parse(args, {
      string: [
        "ingest",
        "bucket",
        "encode",
        "archive",
        "debug-stdout",
        "debug-stderr",
      ],
      boolean: ["help", "h"],
    });

    if (help || h) {
      printHelp();
      return;
    }

    if (!ingest) {
      throw new ProgramError("Ingest folder required");
    }

    if (!bucket) {
      throw new ProgramError("Bucket required");
    }

    if (!archive) {
      throw new ProgramError("Archive folder required");
    }

    const prefix = "video-log-ingest-";
    const init: ProgramInit = {
      ingest,
      bucket,
      encode: {
        type: encode === undefined ? "tmp" : "arg",
        path: encode ?? (await Deno.makeTempDir({ prefix })),
      },
      archive,
      debug: {
        stdout: debugStdout,
        stderr: debugStderr,
      },
    };

    const prog = new Program(init);
    try {
      await prog.ingest();
    } finally {
      await prog.cleanup();
    }
  }

  readonly #ingest: string;
  readonly #bucket: string;
  readonly #encode: string;
  readonly #archive: string;
  readonly #debug: {
    readonly stdout?: string;
    readonly stderr?: string;
  };

  #delete: string[] = [];

  constructor(init: ProgramInit) {
    ({
      ingest: this.#ingest,
      bucket: this.#bucket,
      archive: this.#archive,
      debug: this.#debug,
    } = init);

    this.#encode = init.encode.path;
    if (init.encode.type === "tmp") {
      this.#delete.push(init.encode.path);
    }
  }

  async ingest() {
    for await (const entry of walk(this.#ingest)) {
      if (ignored.has(entry.name) || !entry.isFile) {
        continue;
      }

      const inputName = relative(this.#ingest, entry.path);
      const input = entry.path;
      const ext = extname(inputName);
      const outputName =
        inputName.substring(0, inputName.length - ext.length) + ".mp4";
      const output = resolve(this.#encode, outputName);
      const archive = resolve(this.#archive, inputName);

      await writeStdout(`Encoding ${inputName} to ${outputName}...`);
      await this.#ffmpeg(input, output);
      await ensureDir(dirname(archive));
      await move(input, archive);
      console.log("DONE");
    }

    console.log("Syncing to S3");
    await this.#sync();
  }

  async cleanup() {
    await Promise.all(
      this.#delete.map((path) => Deno.remove(path, { recursive: true }))
    );
  }

  async #ffmpeg(input: string, output: string) {
    ensureDir(dirname(output));
    await this.#runSilent([
      "ffmpeg",
      "-i",
      input,
      "-y",
      "-crf",
      "23",
      "-movflags",
      "+faststart",
      "-pix_fmt",
      "yuv420p",
      "-hide_banner",
      output,
    ]);
  }

  async #sync() {
    for await (const entry of walk(this.#encode)) {
      if (entry.isFile && stripSync.has(entry.name)) {
        await Deno.remove(entry.path);
      }
    }

    await this.#run([
      "aws",
      "s3",
      "sync",
      this.#encode,
      this.#bucket,
      "--storage-class",
      "INTELLIGENT_TIERING",
    ]);
  }

  async #run(cmd: string[]) {
    const p = Deno.run({ cmd });
    try {
      const { success } = await p.status();

      if (!success) {
        throw new ProgramError(`Failed to run command ${JSON.stringify(cmd)}`);
      }
    } finally {
      p.close();
    }
  }

  async #runSilent(cmd: string[]) {
    const p = Deno.run({ cmd, stdout: "piped", stderr: "piped" });
    try {
      const streams = [];

      if (this.#debug.stdout) {
        streams.push(this.#streamOutput(p.stdout.readable, this.#debug.stdout));
      }

      if (this.#debug.stderr) {
        streams.push(this.#streamOutput(p.stderr.readable, this.#debug.stderr));
      }

      const { success } = await p.status();

      if (streams.length > 0) {
        await Promise.all(streams);
      }

      if (!success) {
        throw new ProgramError(`Failed to run command ${JSON.stringify(cmd)}`);
      }
    } finally {
      p.close();
    }
  }

  async #streamOutput(input: ReadableStream<Uint8Array>, output: string) {
    const f = await Deno.open(output, {
      write: true,
      create: true,
      truncate: true,
    });
    try {
      await input.pipeTo(f.writable);
    } finally {
      try {
        f.close();
      } catch {
        // Nothing to do.
      }
    }
  }
}

if (import.meta.main) {
  try {
    await Program.run(Deno.args);
  } catch (err) {
    if (err instanceof ProgramError) {
      printHelp();
      console.log();
      console.error(err.message);
      Deno.exit(1);
    }

    throw err;
  }
}
