import { TextSubstitution } from "../types";

export function applySubstitutions(text: string, subs: TextSubstitution[]): string {
  let out = text;
  for (const s of subs) {
    if (!s.find) continue;
    const escaped = s.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flags = s.case_sensitive ? "g" : "gi";
    out = out.replace(new RegExp(escaped, flags), s.replace);
  }
  return out;
}
