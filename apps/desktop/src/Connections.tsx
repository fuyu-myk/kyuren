import { useCallback, useEffect, useState } from "react";
import { connectService, expiredConnections, forgetSecret, storeSecret } from "@/connect";

/// What a service needs before it can be connected. A pasted token is stored as it is; a client
/// registration starts an authorisation instead, and the credential comes back on its own.
type Service = {
  name: string;
  how: "token" | "oauth";
  fields: Array<{ key: "clientId" | "clientSecret" | "token"; label: string; secret: boolean }>;
};

const SERVICES: Service[] = [
  { name: "anthropic", how: "token", fields: [{ key: "token", label: "api key", secret: true }] },
  { name: "notion", how: "token", fields: [{ key: "token", label: "integration token", secret: true }] },
  {
    name: "google",
    how: "oauth",
    fields: [
      { key: "clientId", label: "client id", secret: false },
      { key: "clientSecret", label: "client secret", secret: true },
    ],
  },
  {
    name: "microsoft",
    how: "oauth",
    fields: [{ key: "clientId", label: "application (client) id", secret: false }],
  },
];

type Props = {
  connected: string[];
  onConnected: (names: string[]) => void;
  onTrouble: (reason: string) => void;
};

export function Connections({ connected, onConnected, onTrouble }: Props) {
  const [expired, setExpired] = useState<string[]>([]);

  // A grant is only known to have expired once the service refuses it, so each is tried whenever
  // what is held changes, a connection made again included.
  useEffect(() => {
    let current = true;
    void expiredConnections()
      .then((names) => current && setExpired(names))
      .catch(() => current && setExpired([]));
    return () => {
      current = false;
    };
  }, [connected]);

  return (
    <section className="connections">
      <h2>connections</h2>
      {SERVICES.map((service) => (
        <One
          key={service.name}
          service={service}
          held={connected.includes(service.name)}
          expired={expired.includes(service.name)}
          onConnected={onConnected}
          onTrouble={onTrouble}
        />
      ))}
    </section>
  );
}

function One({
  service,
  held,
  expired,
  onConnected,
  onTrouble,
}: { service: Service; held: boolean; expired: boolean } & Omit<Props, "connected">) {
  const [values, setValues] = useState<Record<string, string>>({});

  const ready = service.fields.every((field) => (values[field.key] ?? "").trim() !== "");

  const connect = useCallback(async () => {
    try {
      if (service.how === "token") {
        onConnected(await storeSecret(service.name, values.token ?? ""));
      } else {
        await connectService(service.name, values.clientId ?? "", values.clientSecret);
      }
      setValues({});
    } catch (failure) {
      onTrouble(String(failure));
    }
  }, [service, values, onConnected, onTrouble]);

  // Nothing typed, so the client already held asks for the grant again.
  const again = useCallback(async () => {
    try {
      await connectService(service.name, "");
    } catch (failure) {
      onTrouble(String(failure));
    }
  }, [service, onTrouble]);

  const forget = useCallback(async () => {
    try {
      onConnected(await forgetSecret(service.name));
    } catch (failure) {
      onTrouble(String(failure));
    }
  }, [service, onConnected, onTrouble]);

  if (held && expired) {
    return (
      <p className="connected expired">
        <strong>{service.name}</strong> access has expired
        <button className="quiet" onClick={() => void again()}>
          connect again
        </button>
        <button className="quiet" onClick={() => void forget()}>
          forget
        </button>
      </p>
    );
  }

  if (held) {
    return (
      <p className="connected">
        <strong>{service.name}</strong> is connected
        <button className="quiet" onClick={() => void forget()}>
          forget
        </button>
      </p>
    );
  }

  return (
    <div className="connecting">
      {service.fields.map((field) => (
        <input
          key={field.key}
          type={field.secret ? "password" : "text"}
          value={values[field.key] ?? ""}
          placeholder={`${service.name} ${field.label}`}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) =>
            setValues((was) => ({ ...was, [field.key]: event.target.value }))
          }
        />
      ))}
      <button disabled={!ready} onClick={() => void connect()}>
        connect
      </button>
    </div>
  );
}
