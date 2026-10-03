import { forgetAccess as forgetGoogle } from "#connect/google/api.ts";
import { GOOGLE } from "#connect/google/provider.ts";
import { forgetAccess as forgetMicrosoft } from "#connect/microsoft/api.ts";
import { MICROSOFT } from "#connect/microsoft/provider.ts";
import { consent } from "#connect/oauth/consent.ts";
import type { Provider } from "#connect/oauth/provider.ts";
import type { Transport } from "#transport.ts";

const SERVICES: Record<string, { provider: Provider; forget: () => void }> = {
  google: { provider: GOOGLE, forget: forgetGoogle },
  microsoft: { provider: MICROSOFT, forget: forgetMicrosoft },
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function oauthHandlers(transport: Transport) {
  return {
    "oauth.connect": async (params: Record<string, unknown>) => {
      const name = text(params.service) ?? "";
      const service = SERVICES[name];
      if (!service) throw new Error(`${name || "that"} is not a service Kyuren connects to`);

      const clientId = text(params.clientId);
      if (!clientId) throw new Error(`${name} needs a client id`);

      const clientSecret = text(params.clientSecret);
      if (service.provider.secret && !clientSecret) {
        throw new Error(`${name} needs a client secret`);
      }

      const flow = await consent(service.provider, clientId, clientSecret);

      // The address is returned at once so the browser can open while the listener waits. Waiting
      // for the grant here would hold the request open for as long as the user takes to consent.
      void flow.tokens.then(
        (tokens) => {
          if (!tokens.refresh) {
            transport.send({
              event: "oauth.failed",
              data: {
                service: name,
                reason: `${name} granted access but no refresh token, so it would expire in an hour`,
              },
            });
            return;
          }
          service.forget();
          transport.send({
            event: "secret.store",
            data: {
              name,
              secret: JSON.stringify(
                service.provider.secret
                  ? { clientId, clientSecret, refresh: tokens.refresh }
                  : { clientId, refresh: tokens.refresh },
              ),
            },
          });
          transport.send({ event: "oauth.connected", data: { service: name } });
        },
        (failure: unknown) => {
          transport.send({
            event: "oauth.failed",
            data: {
              service: name,
              reason: failure instanceof Error ? failure.message : String(failure),
            },
          });
        },
      );

      return { url: flow.url };
    },
  };
}
