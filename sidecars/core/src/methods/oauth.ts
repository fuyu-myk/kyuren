import { access as googleAccess, credentials as googleHeld, forgetAccess as forgetGoogle } from "#connect/google/api.ts";
import { GOOGLE } from "#connect/google/provider.ts";
import { access as microsoftAccess, credentials as microsoftHeld, forgetAccess as forgetMicrosoft } from "#connect/microsoft/api.ts";
import { MICROSOFT } from "#connect/microsoft/provider.ts";
import { consent } from "#connect/oauth/consent.ts";
import type { Provider } from "#connect/oauth/provider.ts";
import { Withdrawn } from "#connect/oauth/tokens.ts";
import type { Transport } from "#transport.ts";

type Service = {
  provider: Provider;
  forget: () => void;
  /// The client the user registered, held with the grant it was given.
  held: () => { clientId: string; clientSecret?: string } | undefined;
  access: () => Promise<string>;
};

const SERVICES: Record<string, Service> = {
  google: { provider: GOOGLE, forget: forgetGoogle, held: googleHeld, access: googleAccess },
  microsoft: { provider: MICROSOFT, forget: forgetMicrosoft, held: microsoftHeld, access: microsoftAccess },
};

/// Whether the service refuses the grant held for it. One that cannot be reached is not called
/// refused, since connecting again would not help.
async function refused(service: Service): Promise<boolean> {
  try {
    await service.access();
    return false;
  } catch (failure) {
    return failure instanceof Withdrawn;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function oauthHandlers(transport: Transport) {
  return {
    "oauth.connect": async (params: Record<string, unknown>) => {
      const name = text(params.service) ?? "";
      const service = SERVICES[name];
      if (!service) throw new Error(`${name || "that"} is not a service Kyuren connects to`);

      // Nothing typed connects the client already held again, so an expired grant is given anew
      // without the user finding the client's secret a second time.
      const typed = text(params.clientId);
      const held = typed ? undefined : service.held();
      const clientId = typed ?? held?.clientId;
      if (!clientId) throw new Error(`${name} needs a client id`);

      const clientSecret = typed ? text(params.clientSecret) : held?.clientSecret;
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

    /// The connected services whose grant is refused, each tried once.
    "oauth.expired": async () => {
      const connected = Object.entries(SERVICES).filter(([, service]) => service.held() !== undefined);
      const checked = await Promise.all(connected.map(async ([name, service]) => ((await refused(service)) ? [name] : [])));
      return { names: checked.flat() };
    },
  };
}
