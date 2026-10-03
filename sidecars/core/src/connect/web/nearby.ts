import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

/// Endings of names that only ever lead to this machine or the network it sits on.
const NEARBY_ENDINGS = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];

function nearbyV4(name: string): boolean {
  const parts = name.split(".").map(Number);
  if (parts.length !== 4 || parts.some((one) => !Number.isInteger(one))) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 127 || a === 0 || a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // Shared address space, where a carrier's or a mesh network's machines sit.
  return a === 100 && b >= 64 && b <= 127;
}

function nearbyV6(name: string): boolean {
  const bits = bitsV6(name);
  if (bits === undefined) return true;
  // Unspecified, loopback, and a v4 address written as v6, which could be any of the above.
  const marked = (bits >> 32n) & 0xffffn;
  if (bits >> 48n === 0n && (marked === 0n || marked === 0xffffn)) return true;
  const first = Number(bits >> 112n);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/// An IPv6 address written out the one way a parsed address writes it, or nothing for what is not one.
function canonicalV6(name: string): string | undefined {
  try {
    return new URL(`http://[${name.split("%")[0]}]/`).hostname.slice(1, -1);
  } catch {
    return undefined;
  }
}

/// A network this machine is on: an address of its own there, and how many leading bits name it.
export type Network = { address: string; family: "IPv4" | "IPv6"; prefix: number };

/// The widest masks taken for a network at all: one any wider, misreported say, would make every
/// address nearby.
const WIDEST = { IPv4: 8, IPv6: 32 } as const;

/// Every network this machine is on, its own public ones included: on a network with public
/// addresses, the router and everything beside it are as near as anything private.
function networks(): Network[] {
  return Object.values(networkInterfaces())
    .flatMap((one) => one ?? [])
    .map((one) => ({
      address: one.address,
      family: one.family,
      prefix: Number(one.cidr?.split("/")[1] ?? (one.family === "IPv4" ? 32 : 128)),
    }));
}

function bitsV4(address: string): bigint | undefined {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return parts.reduce((bits, part) => (bits << 8n) | BigInt(part), 0n);
}

function bitsV6(address: string): bigint | undefined {
  const canonical = canonicalV6(address);
  if (canonical === undefined) return undefined;
  const [head = "", tail] = canonical.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const groups = tail === undefined ? left : [...left, ...new Array<string>(8 - left.length - right.length).fill("0"), ...right];
  return groups.reduce((bits, group) => (bits << 16n) | BigInt(Number.parseInt(group, 16)), 0n);
}

/// Whether an address is on a network: the same as the network's own address in its leading bits.
export function holds(network: Network, address: string): boolean {
  const width = network.family === "IPv4" ? 32 : 128;
  const bits = network.family === "IPv4" ? bitsV4 : bitsV6;
  const own = bits(network.address);
  const other = bits(address);
  if (own === undefined || other === undefined) return false;
  if (own === other) return true;
  if (network.prefix < WIDEST[network.family] || network.prefix > width) return false;
  const mask = ((1n << BigInt(width)) - 1n) ^ ((1n << BigInt(width - network.prefix)) - 1n);
  return (own & mask) === (other & mask);
}

function onNetwork(address: string, family: Network["family"]): boolean {
  return networks().some((network) => network.family === family && holds(network, address));
}

/// Whether a host, as a parsed address gives it, is this machine or the network it sits on. A
/// public name is not looked up, so one that leads home anyway is beyond what this can tell.
export function nearby(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (name.includes(":")) {
    const canonical = canonicalV6(name);
    return canonical === undefined || nearbyV6(canonical) || onNetwork(canonical, "IPv6");
  }
  // A name of one word is found through the network's own search domains, never the public web's.
  if (!name.includes(".") || NEARBY_ENDINGS.some((ending) => name.endsWith(ending))) return true;
  return nearbyV4(name) || onNetwork(name, "IPv4");
}

/// Every address a host is found at.
export type Resolve = (host: string) => Promise<string[]>;

export const lookupAll: Resolve = async (host) => (await lookup(host, { all: true, verbatim: true })).map((one) => one.address);

/// Whether a host leads to this machine or its network: by its name, or by any address it is found
/// at. A name that cannot be looked up is not trusted to lead anywhere else, and one whose answer
/// changes between this look and the browser's own is beyond what a look can tell.
export async function leadsNearby(host: string, resolve: Resolve = lookupAll): Promise<boolean> {
  if (nearby(host)) return true;
  const name = host.replace(/^\[|\]$/g, "");
  if (isIP(name) !== 0) return false;
  try {
    const found = await resolve(name);
    return found.length === 0 || found.some((one) => nearby(one));
  } catch {
    return true;
  }
}
