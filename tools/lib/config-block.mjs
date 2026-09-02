/**
 * A deliberately tiny reader for one flat, indented block of `.upptimerc.yml`.
 *
 * This project ships with zero dependencies, so there is no YAML parser here.
 * That is fine for what we need -- a handful of `key: value` lines under a
 * single top-level key -- but it is NOT a YAML parser and must not be used as
 * one. It does not understand nesting, lists, anchors, multi-line scalars, or
 * escapes. If a future need outgrows that, read the file with a real parser
 * rather than extending this.
 */

const DEFAULT_I18N = {
  allSystemsOperational: "All systems operational",
  activeIncidents: "Ongoing Incidents",
};

function unquote(value) {
  const trimmed = value.trim();
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  return quoted ? trimmed.slice(1, -1) : trimmed;
}

function stripInlineComment(value) {
  // Only a ` #` preceded by whitespace starts a comment; a bare `#` can be
  // part of a value (a colour, a fragment). Quoted values are left alone.
  const trimmed = value.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return trimmed;
  const at = trimmed.search(/\s#/);
  return at === -1 ? trimmed : trimmed.slice(0, at);
}

export function readIndentedBlock(text, key) {
  const lines = String(text ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === `${key}:`);
  if (start === -1) return {};

  const block = {};
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue;
    // A non-indented, non-empty line ends the block.
    if (!/^\s/.test(line)) break;
    if (line.trim().startsWith("#")) continue;

    const at = line.indexOf(":");
    if (at === -1) continue;
    const name = line.slice(0, at).trim();
    if (!name) continue;
    block[name] = unquote(stripInlineComment(line.slice(at + 1)));
  }
  return block;
}

/**
 * The banner's wording, from config, falling back per-key rather than
 * wholesale -- a partially filled i18n block should not blank the strings it
 * does not mention.
 */
export function readI18n(text) {
  return { ...DEFAULT_I18N, ...readIndentedBlock(text, "i18n") };
}
