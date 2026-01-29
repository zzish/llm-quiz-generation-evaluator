/** Default enrichment prompt template. Placeholders: {{learning_objective}}, {{teacher_request}}, {{request}}, {{learningObjective}}. */
export const DEFAULT_ENRICHMENT_PROMPT_TEMPLATE = `### ROLE
You are an expert Instructional Designer and Curriculum Specialist. Your task is to transform a simple teacher request into a high-fidelity "Expanded Prompt" that will guide an LLM to generate a rigorous, pedagogically sound multiple-choice quiz.

### INPUTS
- Learning Objective: {{learning_objective}}
- Teacher Request: {{teacher_request}}

### TASK: THE ENRICHMENT BLUEPRINT
Analyze the inputs and generate a structured "Expanded Instruction Set" covering the following:

1. **Objective Decoding**: 
   - Deconstruct the standard/objective. What are the specific "must-know" facts and "can-do" skills? 
   - If a standard code (e.g., CCSS) is provided, explain its meaning in plain language.

2. **Cognitive Depth (Bloom's Taxonomy)**:
   - Identify how to vary the questions. Include 30% Recall (Level 1), 50% Application/Analysis (Level 2-3), and 20% Evaluation/Synthesis (Level 4) if appropriate for the grade level.

3. **Context & Scenarios**: 
   - Suggest real-world contexts or word-problem scenarios (e.g., for Math: shopping, building; for Science: lab observations).

4. **Distractor Strategy**: 
   - List common misconceptions students have for this specific topic. Instruct the quiz generator to use these as plausible but incorrect distractors.

5. **Clarity & Tone**: 
   - Define the appropriate reading level and vocabulary for the implied grade.

### OUTPUT FORMAT
Your entire response must be a refined, comprehensive prompt that begins with:
"Generate a multiple-choice quiz "{{request}}" for learning objective "{{learningObjective}}" with detailed instructions ...`;

/**
 * Build enrichment prompt from a custom template. Placeholders: {{learning_objective}}, {{teacher_request}}, {{request}}, {{learningObjective}}.
 */
export function buildEnrichmentPromptFromTemplate(
	template: string,
	learningObjective: string,
	teacherRequest: string
): string {
	return template
		.replace(/\{\{learning_objective\}\}/g, learningObjective)
		.replace(/\{\{teacher_request\}\}/g, teacherRequest)
		.replace(/\{\{request\}\}/g, teacherRequest)
		.replace(/\{\{learningObjective\}\}/g, learningObjective);
}
