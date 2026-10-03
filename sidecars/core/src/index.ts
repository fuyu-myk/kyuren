import { homedir } from "node:os";
import { join } from "node:path";
import { Scheduler } from "#ambient/schedule.ts";
import { Ambient } from "#ambient/watch.ts";
import { HookListener } from "#coding/hooks.ts";
import { hookSocket } from "#coding/install.ts";
import { CodingWatch } from "#coding/watch.ts";
import { processAlive } from "#coding/alive.ts";
import { createDispatcher } from "#dispatch.ts";
import { ambientHandlers } from "#methods/ambient.ts";
import { codingHandlers } from "#methods/coding.ts";
import { mediaHandlers } from "#methods/media.ts";
import { SOURCES } from "#methods/brief.ts";
import { sharedGate } from "#permission/shared.ts";
import { agentHandlers } from "#methods/agent.ts";
import { modelHandlers } from "#methods/model.ts";
import { oauthHandlers } from "#methods/oauth.ts";
import { projectHandlers } from "#methods/projects.ts";
import { memoryHandlers } from "#methods/memory.ts";
import { ownVault } from "#memory/vaults.ts";
import { scheduledStarter } from "#methods/playbook.ts";
import { watchedOver } from "#agent/watched.ts";
import { secretHandlers } from "#methods/secret.ts";
import { sessionHandlers } from "#methods/session.ts";
import { skillHandlers } from "#methods/skills.ts";
import { webHandlers } from "#methods/web.ts";
import { askMethod } from "#methods/ask.ts";
import { ping } from "#methods/ping.ts";
import { createStdioTransport } from "#transport.ts";

const transport = createStdioTransport();
const dispatcher = createDispatcher(transport);

dispatcher.register("ping", ping);
dispatcher.register("ask", askMethod);
for (const [method, handler] of Object.entries(agentHandlers(transport))) {
  dispatcher.register(method, handler);
}
for (const [method, handler] of Object.entries(modelHandlers(transport))) {
  dispatcher.register(method, handler);
}
for (const [method, handler] of Object.entries(secretHandlers)) {
  dispatcher.register(method, handler);
}
for (const [method, handler] of Object.entries(memoryHandlers(transport))) {
  dispatcher.register(method, handler);
}
for (const [method, handler] of Object.entries(oauthHandlers(transport))) {
  dispatcher.register(method, handler);
}
for (const [method, handler] of Object.entries(sessionHandlers())) {
  dispatcher.register(method, handler);
}
for (const [method, handler] of Object.entries(projectHandlers())) {
  dispatcher.register(method, handler);
}
for (const [method, handler] of Object.entries(skillHandlers())) {
  dispatcher.register(method, handler);
}
for (const [method, handler] of Object.entries(webHandlers(transport))) {
  dispatcher.register(method, handler);
}

const root = process.env.KYUREN_HOME ?? join(homedir(), ".kyuren");
const ambient = new Ambient(transport, sharedGate(), SOURCES, root);
const scheduler = new Scheduler(transport, root, scheduledStarter(sharedGate(), ownVault, () => watchedOver(transport)));
for (const [method, handler] of Object.entries(ambientHandlers(ambient, scheduler))) {
  dispatcher.register(method, handler);
}
const hooks = new HookListener(transport, hookSocket(root), { changed: () => coding.nudge() });
const coding = new CodingWatch(transport, homedir(), processAlive(), () => hooks.pending());
for (const [method, handler] of Object.entries(codingHandlers(coding, hooks, root))) {
  dispatcher.register(method, handler);
}
for (const [method, handler] of Object.entries(mediaHandlers())) {
  dispatcher.register(method, handler);
}
// A core driven by a script answers requests and does nothing on its own: looking at sources and
// running schedules are the running app's to do, and a second doer would do them twice.
if (!process.env.KYUREN_DRIVEN) {
  ambient.start();
  scheduler.start();
  coding.start();
  // Without the line open, a hook finds no one and its agent asks in its own way, as without Kyuren.
  hooks.start().catch((failure: unknown) => transport.send({ event: "coding.hooks.failed", data: { reason: String(failure) } }));
}

transport.listen((line) => dispatcher.handle(line));
transport.send({ event: "sidecar.ready", data: { name: "core" } });
