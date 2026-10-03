const OLLAMA = (process.env.KYUREN_OLLAMA_URL ?? "http://localhost:11434/v1").replace(/\/v1\/?$/, "");
const MODEL = process.env.KYUREN_EMBED_MODEL ?? "nomic-embed-text";

/// This model is trained with the two asked about separately: a note is something to be found, a
/// question is something doing the finding. Embedding both the same way loses that.
const AS_NOTE = "search_document: ";
const AS_QUESTION = "search_query: ";

/// Sent together. One at a time costs a request each; in batches it is about eight milliseconds a
/// chunk, so a whole vault is seconds rather than minutes.
const BATCH = 64;

async function call(inputs: string[]): Promise<Float32Array[]> {
  const response = await fetch(`${OLLAMA}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: inputs }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    throw new Error(`embedding failed: ${response.status} ${(await response.text()).slice(0, 120)}`);
  }

  const answer = (await response.json()) as { embeddings?: number[][] };
  return (answer.embeddings ?? []).map((one) => Float32Array.from(one));
}

export async function embedNotes(texts: string[]): Promise<Float32Array[]> {
  const vectors: Float32Array[] = [];
  for (let at = 0; at < texts.length; at += BATCH) {
    vectors.push(...(await call(texts.slice(at, at + BATCH).map((text) => AS_NOTE + text))));
  }
  return vectors;
}

export async function embedQuestion(question: string): Promise<Float32Array | undefined> {
  const [vector] = await call([AS_QUESTION + question]);
  return vector;
}

export async function embeddingWorks(): Promise<boolean> {
  try {
    return (await embedQuestion("a question")) !== undefined;
  } catch {
    return false;
  }
}

export type Embedder = {
  notes(texts: string[]): Promise<Float32Array[]>;
  question(question: string): Promise<Float32Array | undefined>;
};

/// What the application embeds with. Tests hand in another, so nothing there needs Ollama.
export const ollama: Embedder = { notes: embedNotes, question: embedQuestion };
