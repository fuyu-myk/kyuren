import { createInterface } from "node:readline";
import type { Outbound } from "#protocol.ts";

export type Transport = {
  send: (message: Outbound) => void;
  listen: (onLine: (line: string) => void | Promise<void>) => void;
};

export function createStdioTransport(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Transport {
  return {
    send(message) {
      output.write(`${JSON.stringify(message)}\n`);
    },
    listen(onLine) {
      const reader = createInterface({ input, crlfDelay: Infinity });
      reader.on("line", (line) => {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          void onLine(trimmed);
        }
      });
      reader.on("close", () => process.exit(0));
    },
  };
}
