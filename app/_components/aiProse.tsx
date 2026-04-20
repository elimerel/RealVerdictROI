import { Fragment, type ReactNode } from "react";

/**
 * Renders AI-emitted prose with two enhancements:
 *   1. `**bold**` segments become <strong> (for the occasional key figure).
 *   2. Dollar amounts, percentages, and DSCR ratios are highlighted in the
 *      page's accent color (via `text-[var(--accent)]`). The page sets the
 *      `--accent` CSS variable on a parent container.
 *
 * The caller is expected to set `whitespace-pre-wrap` on the container so
 * the model's `\n` line breaks and `→` bullet structure are preserved.
 */
export function renderAIProse(text: string): ReactNode {
  if (!text) return null;

  const boldParts = text.split(/(\*\*[^*\n]+\*\*)/g);
  return boldParts.map((chunk, i) => {
    if (chunk.startsWith("**") && chunk.endsWith("**") && chunk.length > 4) {
      return (
        <strong key={i} className="font-semibold text-zinc-50">
          {highlightNumbers(chunk.slice(2, -2), `b${i}`)}
        </strong>
      );
    }
    return (
      <Fragment key={i}>{highlightNumbers(chunk, `p${i}`)}</Fragment>
    );
  });
}

// Highlights dollar amounts ($123, $123/mo, -$123, +$123.45k), percentages
// (4.2%, -0.5%), and DSCR numbers ("DSCR 0.82"). Anything else is left plain.
// `String.split` with a capture group puts matches at odd indices, so we
// rely on that instead of a stateful `.test()` on a /g regex.
const NUMBER_PATTERN =
  /([+\-−]?\$[\d,]+(?:\.\d+)?(?:[kKmM])?(?:\/mo|\/yr)?|[+\-−]?\d+(?:\.\d+)?%|DSCR\s+\d+(?:\.\d+)?)/g;

function highlightNumbers(text: string, keyPrefix: string): ReactNode {
  const parts = text.split(NUMBER_PATTERN);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return (
        <span
          key={`${keyPrefix}-${i}`}
          className="font-medium text-[var(--accent)]"
        >
          {part}
        </span>
      );
    }
    if (!part) return null;
    return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>;
  });
}
