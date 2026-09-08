// Deterministic (no LLM) keyword-based mapping from a free-text persona
// description to a trait vector — keeps "no LLM required" true for the
// hosted app even when a user describes their audience. Less nuanced than
// an actual model reading the text, but zero-dependency and always works.
// See the skill's references/personas.md for the full trait rubric this
// mirrors a small slice of.
const SIGNALS = [
  { re: /distract|multitask|busy|on the go|while doing|second screen/i, trait: "attention", value: 0.2 },
  { re: /focus|attentive|careful reader|thorough|detail.?oriented/i, trait: "attention", value: 0.85 },
  { re: /tech.?savvy|power user|developer|engineer|technical audience/i, trait: "techSavvy", value: 0.9 },
  { re: /non.?technical|novice|beginner|first.?time|unfamiliar with (tech|computers|apps)/i, trait: "techSavvy", value: 0.2 },
  { re: /senior|older|elderly|low dexterity|motor|arthritis/i, trait: "dexterity", value: 0.25 },
  { re: /mobile|thumb|small screen|one.?handed/i, trait: "dexterity", value: 0.55 },
  { re: /non.?native|esl|second language|limited english|learning english/i, trait: "languageFluency", value: 0.2 },
  { re: /fluent|native speaker/i, trait: "languageFluency", value: 0.95 },
  { re: /patient|thorough|takes their time|methodical/i, trait: "patience", value: 0.8 },
  { re: /rush|hurried|impatient|quick|in a hurry|busy schedule|no time/i, trait: "patience", value: 0.25 },
];

// Returns null (caller should fall back to the default balanced archetype
// mix) if given no usable text.
export function parsePersonaText(text) {
  if (!text || !text.trim()) return null;
  const traits = { attention: 0.5, techSavvy: 0.5, dexterity: 0.7, languageFluency: 0.85, patience: 0.5 };
  const matchedSignals = [];
  for (const s of SIGNALS) {
    if (s.re.test(text)) {
      traits[s.trait] = s.value;
      matchedSignals.push(`${s.trait}=${s.value}`);
    }
  }
  return { traits, matchedSignals };
}
