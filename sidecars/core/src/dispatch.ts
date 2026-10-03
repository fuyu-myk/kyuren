import { ErrorCode, fail, isRequest, ok, parseRequest } from "#protocol.ts";
import type { Transport } from "#transport.ts";

export type Handler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

export type Dispatcher = {
  register: (method: string, handler: Handler) => void;
  handle: (line: string) => Promise<void>;
};

export function createDispatcher(transport: Transport): Dispatcher {
  const handlers = new Map<string, Handler>();

  return {
    register(method, handler) {
      handlers.set(method, handler);
    },

    async handle(line) {
      const parsed = parseRequest(line);

      if (!isRequest(parsed)) {
        if (parsed.id === null) {
          transport.send({ event: "sidecar.malformed", data: { reason: parsed.reason } });
        } else {
          transport.send(fail(parsed.id, ErrorCode.InvalidParams, parsed.reason));
        }
        return;
      }

      const handler = handlers.get(parsed.method);
      if (!handler) {
        transport.send(fail(parsed.id, ErrorCode.MethodNotFound, `no handler for ${parsed.method}`));
        return;
      }

      try {
        transport.send(ok(parsed.id, await handler(parsed.params ?? {})));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        transport.send(fail(parsed.id, ErrorCode.Internal, message));
      }
    },
  };
}
