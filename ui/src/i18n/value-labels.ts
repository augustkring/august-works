import { i18n } from ".";

/**
 * Looks up the customer-visible label for a raw enum value such as
 * `in_progress`. The English fallback keeps the previous humanised wording, so
 * an unknown value still renders readable text in both languages.
 */
export function valueLabel(group: "title" | "badge" | "sentence", value: string, fallback: string): string {
  return i18n.t(`screens.values.${group}.${value}`, { ns: "experience", defaultValue: fallback });
}

/** Screen copy lookup for helpers that run outside a component (`screens.*` in the experience catalogue). */
export function screenText(key: string, options: Record<string, unknown> = {}): string {
  return i18n.t(`screens.${key}`, { ns: "experience", ...options });
}
