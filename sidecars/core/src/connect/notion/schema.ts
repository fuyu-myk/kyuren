/// Reading a workspace rather than being told about it. Which property carries the date, and which
/// status options mean finished, differ per database and are discovered from the schema.

export type Property = {
  type?: string;
  status?: { groups?: Array<{ name?: string; option_ids?: string[] }>; options?: Array<{ id?: string; name?: string }> };
};

export type Schema = Record<string, Property>;

export function dateProperty(schema: Schema): string | undefined {
  return Object.entries(schema).find(([, property]) => property.type === "date")?.[0];
}

export function titleProperty(schema: Schema): string | undefined {
  return Object.entries(schema).find(([, property]) => property.type === "title")?.[0];
}

/// Notion groups status options into To-do, In progress and Complete. The group is what means
/// finished, not the option's name, which a workspace is free to call anything.
export function finishedNames(schema: Schema): Set<string> {
  const finished = new Set<string>();

  for (const property of Object.values(schema)) {
    if (property.type !== "status" || !property.status) continue;
    const byId = new Map(
      (property.status.options ?? []).map((option) => [option.id ?? "", option.name ?? ""]),
    );
    for (const group of property.status.groups ?? []) {
      if ((group.name ?? "").toLowerCase() !== "complete") continue;
      for (const id of group.option_ids ?? []) {
        const name = byId.get(id);
        if (name) finished.add(name);
      }
    }
  }

  return finished;
}
