import { QUIZ_SCHEMA_JSON } from "#lib/schemas/quiz-schema.js";

/** Default generation prompt template. Placeholders: {{learningObjective}}, {{request}}, {{quiz_schema}}. */
export const DEFAULT_GENERATION_PROMPT_TEMPLATE = `Generate a multiple-choice quiz "{{request}}" for learning objective "{{learningObjective}}".

Return ONLY valid JSON matching this schema exactly. Do not include markdown code fences. Do not include any extra keys.

### Schema:

{{quiz_schema}}`;

/**
 * Build the full prompt for the test model: generate a quiz for the learning objective + request.
 * Return ONLY valid JSON matching the schema; no markdown fences, no extra keys.
 */
export function buildTestPrompt(learningObjective: string, request: string): string {
	return buildTestPromptFromTemplate(DEFAULT_GENERATION_PROMPT_TEMPLATE, learningObjective, request);
}

/**
 * Build generation prompt from a custom template. Placeholders: {{learningObjective}}, {{request}}, {{quiz_schema}}.
 */
export function buildTestPromptFromTemplate(
	template: string,
	learningObjective: string,
	request: string
): string {
	return template
		.replace(/\{\{learningObjective\}\}/g, learningObjective)
		.replace(/\{\{request\}\}/g, request)
		.replace(/\{\{quiz_schema\}\}/g, QUIZ_SCHEMA_JSON);
}

/**
 * Build the generation prompt for a quiz that must come from a given source text (a sourced, "RAG" request).
 * The source sits in its own block so the model can tell it apart from the instructions.
 */
export function buildSourcedTestPrompt(learningObjective: string, request: string, sourceText: string): string {
	return buildTestPrompt(learningObjective, request).replace(
		"\n\nReturn ONLY valid JSON",
		"\n\nBase every question only on the source text below. Do not ask about anything the source does not say, and make every answer key agree with the source.\n\n" +
			`<SOURCE_TEXT>\n${sourceText.trim()}\n</SOURCE_TEXT>\n\nReturn ONLY valid JSON`
	);
}

/**
 * Build the full generation prompt when using enrichment: append JSON schema instructions to the expanded prompt.
 */
export function buildGenerationPromptFromExpanded(expandedInstruction: string): string {
	return (
		expandedInstruction.trim() +
		"\n\nReturn ONLY valid JSON matching this schema exactly. Do not include markdown code fences. Do not include any extra keys.\n\n### Schema:\n\n" +
		QUIZ_SCHEMA_JSON
	);
}
