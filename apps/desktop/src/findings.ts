import { invoke } from "@tauri-apps/api/core";

export type Note = { slug: string; title: string; at: string };

export function researchNotes(): Promise<Note[]> {
  return invoke<{ notes: Note[] }>("research_notes").then((reply) => reply.notes);
}

export function readResearch(slug: string): Promise<string> {
  return invoke<{ text: string }>("research_read", { slug }).then((reply) => reply.text);
}
