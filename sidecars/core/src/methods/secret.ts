import { connected, forget, remember } from "#connect/secrets.ts";

export const secretHandlers = {
  "secret.set": async (params: Record<string, unknown>) => {
    const name = params.name;
    const secret = params.secret;
    if (typeof name !== "string" || name === "") {
      throw new Error("secret.set needs a name");
    }
    if (typeof secret !== "string" || secret === "") {
      forget(name);
      return { connected: connected() };
    }
    remember(name, secret);
    return { connected: connected() };
  },

  "secret.connected": async () => ({ connected: connected() }),
};
