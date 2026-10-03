import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/// What has already reached the user, kept on disk so that a restart does not surface it again.
/// Bounded: the oldest are forgotten once there are more than it is asked to hold.
export class Seen {
  private readonly path: string;
  private readonly most: number;
  private readonly keys: Set<string>;

  constructor(path: string, most: number) {
    this.path = path;
    this.most = most;
    this.keys = new Set(this.read());
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }

  add(key: string): void {
    this.keys.add(key);
    if (this.keys.size > this.most) {
      for (const old of [...this.keys].slice(0, this.keys.size - this.most)) this.keys.delete(old);
    }
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify([...this.keys]));
  }

  private read(): string[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      return Array.isArray(parsed) ? parsed.filter((one): one is string => typeof one === "string") : [];
    } catch {
      return [];
    }
  }
}
