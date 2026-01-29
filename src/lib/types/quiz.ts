export type QuizQuestionType = "multiple_choice";

export interface QuizQuestion {
	id: number;
	type: QuizQuestionType;
	question: string;
	choices: string[];
	answer_index: number;
	explanation: string;
}

export interface QuizOutput {
	quiz_title: string;
	learning_objective: string;
	questions: QuizQuestion[];
}
