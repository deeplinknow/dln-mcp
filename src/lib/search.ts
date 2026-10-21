/**
 * MCP-24: keyword search over llms-full.txt, split into sections at its
 * headings. Each section keeps the page URL from the "Source:" line above it.
 */
export interface Section {
  heading: string;
  page: string;
  text: string;
  url: string;
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "do",
  "does",
  "for",
  "how",
  "i",
  "in",
  "is",
  "it",
  "my",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "when",
  "with",
  "why",
]);

export function splitSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let url = "https://deeplinknow.com/llms-full.txt";
  let page = "DeepLinkNow";
  let heading = "";
  let lines: string[] = [];
  let inFence = false;

  const flush = () => {
    const text = lines.join("\n").trim();
    if (text) {
      sections.push({ heading: heading || page, page, text, url });
    }
    lines = [];
  };

  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
    }
    const [, sourceUrl] =
      (inFence ? null : /^Source: (https?:\/\/\S+)\s*$/.exec(line)) ?? [];
    if (sourceUrl) {
      flush();
      url = sourceUrl;
      continue;
    }
    const h = inFence ? null : /^(#{1,3}) (.+)$/.exec(line);
    if (h?.[1] && h[2]) {
      flush();
      if (h[1] === "#") {
        page = h[2].trim();
        heading = page;
      } else {
        heading = h[2].trim();
      }
      continue;
    }
    lines.push(line);
  }
  flush();
  return sections;
}

export function terms(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

function count(haystack: string, needle: string): number {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1 && n < 10) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

export interface Hit extends Section {
  score: number;
}

export function search(
  sections: Section[],
  query: string,
  limit: number
): Hit[] {
  const words = terms(query);
  if (words.length === 0) {
    return [];
  }
  const phrase = query.trim().toLowerCase();
  const hits: Hit[] = [];
  for (const section of sections) {
    const body = section.text.toLowerCase();
    const head = `${section.page} ${section.heading}`.toLowerCase();
    let score = 0;
    let matched = 0;
    for (const word of words) {
      const inBody = count(body, word);
      const inHead = head.includes(word) ? 1 : 0;
      if (inBody + inHead > 0) {
        matched += 1;
      }
      score += inBody + inHead * 5;
    }
    if (matched === 0) {
      continue;
    }
    // Sections that contain every term, or the exact phrase, come first.
    score *= matched / words.length;
    if (words.length > 1 && body.includes(phrase)) {
      score += 10;
    }
    hits.push({ ...section, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function excerpt(text: string, max = 1500): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}\n…`;
}
