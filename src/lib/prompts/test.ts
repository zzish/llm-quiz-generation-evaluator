import { QUIZ_SCHEMA_JSON } from "$lib/schemas/quiz-schema";

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
 * Build the full generation prompt when using enrichment: append JSON schema instructions to the expanded prompt.
 */
export function buildGenerationPromptFromExpanded(expandedInstruction: string): string {
	return (
		expandedInstruction.trim() +
		"\n\nReturn ONLY valid JSON matching this schema exactly. Do not include markdown code fences. Do not include any extra keys.\n\n### Schema:\n\n" +
		QUIZ_SCHEMA_JSON
	);
}
