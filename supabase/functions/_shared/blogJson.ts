// Tolerant parser for blog-generator model output.
//
// Claude often returns a blog as JSON whose HTML contains raw quotes
// (`<a href="https://...">`) or a raw newline. JSON.parse then throws
// "Expected ',' or '}' after property value" or "Bad control character"
// and the keyword is marked failed. Tool use avoids that when the API
// parses the tool input, and this extractor recovers the text path.

export interface GeneratedBlog {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  meta_title: string;
  meta_description: string;
  secondary_keywords: string[];
  faq: Array<{ question: string; answer: string }>;
}

const MIN_CONTENT_CHARS = 500;

export function describeJsonFailure(raw: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const pos = Number(message.match(/position\s+(\d+)/i)?.[1] ?? "");
  let near = "";
  if (Number.isFinite(pos) && pos >= 0 && pos <= raw.length) {
    const start = Math.max(0, pos - 48);
    const end = Math.min(raw.length, pos + 48);
    near = ` Near position ${pos}: ${JSON.stringify(raw.slice(start, end))}.`;
  }
  return `Blog JSON parse failed (${raw.length} characters): ${message}.${near}`;
}

/** Drop a markdown fence and keep the outermost object, even if it was cut off. */
export function sliceJsonObject(raw: string): string {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = s.indexOf("{");
  if (start === -1) return s;
  const end = s.lastIndexOf("}");
  if (end > start) return s.slice(start, end + 1);
  return s.slice(start);
}

function nextSignificant(input: string, from: number): string {
  for (let j = from; j < input.length; j++) {
    const ch = input[j];
    if (ch !== " " && ch !== "\n" && ch !== "\r" && ch !== "\t") return ch;
  }
  return "";
}

/**
 * Repair the usual model mistakes: unescaped quotes inside a string,
 * raw control characters, trailing commas, and a response cut off mid-value.
 */
export function repairModelJson(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inString) {
      if (escaped) {
        out += c;
        escaped = false;
        continue;
      }
      if (c === "\\") {
        out += c;
        escaped = true;
        continue;
      }
      if (c === '"') {
        const next = nextSignificant(input, i + 1);
        const closes = next === "" || next === ":" || next === "," || next === "}" || next === "]";
        if (closes) {
          out += '"';
          inString = false;
        } else {
          out += '\\"';
        }
        continue;
      }
      if (c === "\n") { out += "\\n"; continue; }
      if (c === "\r") { out += "\\r"; continue; }
      if (c === "\t") { out += "\\t"; continue; }
      if (c.charCodeAt(0) < 0x20) {
        out += "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
        continue;
      }
      out += c;
      continue;
    }

    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "{") { stack.push("}"); out += c; continue; }
    if (c === "[") { stack.push("]"); out += c; continue; }
    if ((c === "}" || c === "]") && stack.length && stack[stack.length - 1] === c) {
      stack.pop();
    }
    out += c;
  }

  if (escaped) out += "\\";
  if (inString) out += '"';
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop();
  return out.replace(/,\s*([}\]])/g, "$1");
}

export function parseModelJson(raw: string): unknown {
  const sliced = sliceJsonObject(raw);
  try {
    return JSON.parse(sliced);
  } catch (original) {
    try {
      return JSON.parse(repairModelJson(sliced));
    } catch {
      throw new Error(describeJsonFailure(sliced, original));
    }
  }
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function readFaq(value: unknown): GeneratedBlog["faq"] {
  if (!Array.isArray(value)) return [];
  const faq: GeneratedBlog["faq"] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const question = (item as { question?: unknown }).question;
    const answer = (item as { answer?: unknown }).answer;
    if (typeof question === "string" && typeof answer === "string" && question.trim() && answer.trim()) {
      faq.push({ question, answer });
    }
  }
  return faq;
}

export function assertGeneratedBlog(value: unknown): GeneratedBlog {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Blog JSON was not an object");
  }
  const row = value as Record<string, unknown>;
  const required = ["title", "slug", "excerpt", "content", "meta_title", "meta_description"] as const;
  const missing = required.filter((key) => typeof row[key] !== "string" || !(row[key] as string).trim());
  if (missing.length) {
    throw new Error(`Blog JSON missing or empty fields: ${missing.join(", ")}`);
  }
  const content = (row.content as string).trim();
  if (content.length < MIN_CONTENT_CHARS) {
    throw new Error(
      `Blog JSON content is too short (${content.length} characters); the model response was likely truncated`,
    );
  }
  return {
    title: (row.title as string).trim(),
    slug: (row.slug as string).trim(),
    excerpt: (row.excerpt as string).trim(),
    content,
    meta_title: (row.meta_title as string).trim(),
    meta_description: (row.meta_description as string).trim(),
    secondary_keywords: readStringList(row.secondary_keywords),
    faq: readFaq(row.faq),
  };
}

/** finish_reason "length" means the model hit max_tokens and the HTML may be cut off. */
export function blogOutputLooksTruncated(
  blog: GeneratedBlog,
  finishReason: string | null | undefined,
  maxTokens: number,
): string | null {
  if (finishReason !== "length") return null;
  const closed = /<\/(p|ul|ol|li|h2|h3|strong|a)>\s*$/i.test(blog.content.trim());
  if (!closed) {
    return `Model output truncated at max_tokens=${maxTokens} (finish_reason=length, content ${blog.content.length} characters, HTML not closed)`;
  }
  return null;
}
