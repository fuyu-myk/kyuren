import assert from "node:assert/strict";
import { networkInterfaces } from "node:os";
import { test } from "node:test";
import { holds, leadsNearby, nearby } from "#connect/web/nearby.ts";

/// As an address's host reads once parsed, which is how every caller has it.
const host = (url: string) => new URL(url).hostname;

test("this machine and the network it sits on are nearby, by name or by address in either family", () => {
  for (const url of [
    "http://localhost/",
    "http://localhost./",
    "http://router/",
    "http://nas./",
    "http://app.localhost/",
    "http://printer.local/",
    "http://router.lan/",
    "http://nas.home.arpa/",
    "http://metadata.google.internal/",
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://0.0.0.0/",
    "http://10.1.2.3/",
    "http://172.16.4.4/",
    "http://192.168.0.5/",
    "http://169.254.169.254/",
    "http://100.100.100.100/",
    "http://[::1]/",
    "http://[::]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fd12:3456::1]/",
    "http://[fe80::1]/",
  ]) {
    assert.equal(nearby(host(url)), true, url);
  }
});

test("the public web is not nearby, whatever its names start with", () => {
  for (const url of [
    "https://example.com/",
    "https://fdic.gov/",
    "https://fcc.gov/",
    "https://8.8.8.8/",
    "https://172.32.0.1/",
    "https://[2606:4700::1111]/",
    "https://localhost.example.com/",
    "http://[::1:2:3]/",
  ]) {
    assert.equal(nearby(host(url)), false, url);
  }
});

test("a public name that leads home is nearby, and one that cannot be looked up is not trusted", async () => {
  const looked = async (host: string) =>
    ({ "home.example": ["127.0.0.1"], "away.example": ["93.184.216.34", "2606:2800:220:1::"], "split.example": ["93.184.216.34", "10.0.0.5"] })[host] ?? [];
  assert.equal(await leadsNearby("home.example", looked), true);
  assert.equal(await leadsNearby("away.example", looked), false);
  assert.equal(await leadsNearby("split.example", looked), true, "one address at home is enough");
  assert.equal(await leadsNearby("nowhere.example", looked), true);
  assert.equal(await leadsNearby("broken.example", async () => { throw new Error("no answer"); }), true);
  assert.equal(await leadsNearby("93.184.216.34", async () => { throw new Error("an address is not looked up"); }), false);
  assert.equal(await leadsNearby("localhost", async () => []), true);
});

test("an IPv6 address is nearby however it is spelled, and so is every address this machine answers at", () => {
  for (const host of ["0:0:0:0:0:0:0:1", "0000::1", "0::1", "0:0:0:0:0:ffff:7f00:1", "[0:0:0:0:0:0:0:1]", "fe80::1%en0"]) {
    assert.equal(nearby(host), true, host);
  }
  const own = Object.values(networkInterfaces()).flatMap((all) => all ?? []).map((one) => one.address);
  assert.ok(own.length > 0);
  for (const address of own) assert.equal(nearby(address), true, address);
});

test("an address on a network this machine is on is nearby, however public its range", () => {
  const home = { address: "2001:db8:1234:5678::abcd", family: "IPv6" as const, prefix: 64 };
  assert.equal(holds(home, "2001:db8:1234:5678::1"), true, "the router");
  assert.equal(holds(home, "2001:db8:1234:5679::1"), false, "the next network over");
  const office = { address: "203.0.113.40", family: "IPv4" as const, prefix: 24 };
  assert.equal(holds(office, "203.0.113.1"), true);
  assert.equal(holds(office, "203.0.114.1"), false);
  assert.equal(holds({ address: "2001:db8::1", family: "IPv6", prefix: 0 }, "2606:4700::1111"), false, "a mask too wide to be a network is no network");
  assert.equal(holds(home, "203.0.113.1"), false, "nor does one family hold the other's addresses");
});
