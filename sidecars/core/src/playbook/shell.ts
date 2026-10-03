export type Placed = {
  script: string;
  /// The inputs the script names, by the variable each was given.
  env: Record<string, string>;
};

const PLACEHOLDER = /\{\{\s*[\w-]+\s*\}\}/;

/// A command with each input in it handed to the shell as a variable rather than as text, quoted
/// for wherever its braces stand: a value holding a quote, a semicolon or a substitution cannot
/// become more of the command, unless the approved command gives its text to a shell again.
export function inShell(command: string, inputs: Record<string, string>): Placed | { refused: string } {
  // Inside a substitution the quoting starts over, so where a value would stand cannot be told
  // from here; a value there is not placed at all.
  if (PLACEHOLDER.test(command) && /\$\(|`/.test(command)) {
    return { refused: "an input is not put inside a substitution, where the shell would read it again" };
  }
  const placeholder = /\{\{\s*([\w-]+)\s*\}\}/y;
  const variables = new Map<string, string>();
  const env: Record<string, string> = {};
  let script = "";
  let quote: "'" | '"' | undefined;
  let at = 0;
  while (at < command.length) {
    placeholder.lastIndex = at;
    const brace = placeholder.exec(command);
    if (brace) {
      const name = brace[1] ?? "";
      let variable = variables.get(name);
      if (variable === undefined) {
        variable = `KYUREN_INPUT_${variables.size}`;
        variables.set(name, variable);
        env[variable] = inputs[name] ?? "";
      }
      script += quote === "'" ? `'"\${${variable}}"'` : quote === '"' ? `\${${variable}}` : `"\${${variable}}"`;
      at = placeholder.lastIndex;
      continue;
    }
    const char = command[at] ?? "";
    if (char === "\\" && quote !== "'") {
      script += command.slice(at, at + 2);
      at += 2;
      continue;
    }
    if (char === "'" && quote !== '"') quote = quote === "'" ? undefined : "'";
    else if (char === '"' && quote !== "'") quote = quote === '"' ? undefined : '"';
    script += char;
    at += 1;
  }
  return { script, env };
}
