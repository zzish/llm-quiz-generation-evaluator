/** Exact quiz JSON schema for the test-model prompt (strict). */
export const QUIZ_SCHEMA_OBJECT = {
	quiz_title: "string",
	learning_objective: "string",
	questions: [
		{
			id: 1,
			type: "multiple_choice",
			question: "string",
			choices: ["string", "string", "string", "string"],
			answer_index: 0,
			explanation: "string",
		},
	],
} as const;

export const QUIZ_SCHEMA_JSON = JSON.stringify(QUIZ_SCHEMA_OBJECT, null, 2);
