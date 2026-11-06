import { z } from "npm:zod@3";

export const createStudentSchema = z.object({
  email: z.string().email("A valid email is required"),
  temporary_password: z.string().min(8, "Temporary password must be at least 8 characters"),
  full_name: z.string().min(1).max(200),
  grade_level: z.string().max(50).optional().nullable(),
  school: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const requiredPhoneSchema = z.string().trim().min(8).max(30).regex(/^\+?[\d\s().-]+$/)
  .refine((value) => (value.match(/\d/g)?.length ?? 0) >= 8, "Enter a valid Zalo phone number");

export const updateStudentSchema = z.object({
  full_name: z.string().trim().min(1).max(200).optional(),
  grade_level: z.string().max(50).optional().nullable(),
  school: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  phone_number: requiredPhoneSchema.optional(),
  parent_name: z.string().trim().min(1).max(200).optional(),
  parent_phone_number: requiredPhoneSchema.optional(),
});

export const studentProfileSubmissionSchema = z.object({
  full_name: z.string().trim().min(1).max(200),
  phone_number: requiredPhoneSchema,
  parent_name: z.string().trim().min(1).max(200),
  parent_phone_number: requiredPhoneSchema,
});

export const resetPasswordSchema = z.object({
  new_password: z.string().min(8, "Password must be at least 8 characters"),
});

export const choiceSchema = z.object({
  label: z.string().min(1).max(2),
  text: z.string().min(1),
  is_correct: z.boolean().default(false),
  position: z.number().int().min(1),
});

export const questionCreateSchema = z.object({
  section: z.enum(["reading_writing", "math"]),
  question_type: z.enum(["multiple_choice", "student_produced"]),
  passage_id: z.string().uuid().optional().nullable(),
  prompt: z.string().min(1),
  domain: z.string().max(100).optional().nullable(),
  skill: z.string().max(100).optional().nullable(),
  difficulty: z.number().int().min(1).max(5).optional().nullable(),
  correct_answer: z.string().max(500).optional().nullable(),
  explanation: z.string().max(5000).optional().nullable(),
  source_question_id: z.string().max(100).optional().nullable(),
  stimulus_image_path: z.string().max(1000).optional().nullable(),
  choices: z.array(choiceSchema).max(6).optional().default([]),
  status: z.enum(["active", "archived"]).optional().default("active"),
});

export const questionUpdateSchema = questionCreateSchema.partial();

export const passageSchema = z.object({
  title: z.string().max(300).optional().nullable(),
  content: z.string().min(1),
  source: z.string().max(300).optional().nullable(),
});

export const testCreateSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional().nullable(),
  is_public: z.boolean().default(false),
});

export const testUpdateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).optional().nullable(),
  is_public: z.boolean().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});

export const sectionCreateSchema = z.object({
  test_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  section_type: z.enum(["reading_writing", "math"]),
  position: z.number().int().min(1),
});

export const sectionUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  section_type: z.enum(["reading_writing", "math"]).optional(),
  position: z.number().int().min(1).optional(),
});

export const moduleCreateSchema = z.object({
  section_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  time_limit_minutes: z.number().int().min(1).max(600),
  position: z.number().int().min(1),
  is_adaptive: z.boolean().default(false),
});

export const moduleUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  time_limit_minutes: z.number().int().min(1).max(600).optional(),
  position: z.number().int().min(1).optional(),
  is_adaptive: z.boolean().optional(),
});

export const linkQuestionSchema = z.object({
  module_id: z.string().uuid(),
  question_id: z.string().uuid(),
  position: z.number().int().min(1),
  points: z.number().min(0.5).max(10).default(1),
});

export const linkUpdateSchema = z.object({
  position: z.number().int().min(1).optional(),
  points: z.number().min(0.5).max(10).optional(),
});

export const fullTestQuestionEditSchema = z.object({
  prompt: z.string().min(1).max(20000),
  passage_text: z.string().max(20000).nullable(),
  correct_answer: z.string().max(500).nullable(),
  explanation: z.string().max(5000).nullable(),
  stimulus_image_path: z.string().max(1000).nullable(),
  choices: z.array(z.object({
    label: z.string().trim().min(1).max(2),
    text: z.string().min(1).max(10000),
  })).max(6),
}).superRefine((value, ctx) => {
  if (value.choices.length > 0 && value.choices.length < 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["choices"], message: "Multiple-choice questions need at least two choices" });
  }
  const labels = value.choices.map((choice) => choice.label.trim().toUpperCase());
  if (new Set(labels).size !== labels.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["choices"], message: "Choice labels must be unique" });
  }
  if (value.choices.length > 0 && value.correct_answer && !labels.includes(value.correct_answer.trim().toUpperCase())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["correct_answer"], message: "Correct answer must match one of the choice labels" });
  }
});

export const manualImportDraftCreateSchema = z.object({
  source_module_name: z.enum([
    "Reading and Writing Module 1", "Reading and Writing Module 2", "Math Module 1", "Math Module 2",
  ]),
  question_type: z.enum(["multiple_choice", "student_produced"]),
  prompt: z.string().min(1).max(20000),
  passage_text: z.string().max(20000).optional().nullable(),
  suggested_answer: z.string().max(500).optional().nullable(),
  stimulus_image_path: z.string().max(1000).optional().nullable(),
  choices: z.array(z.object({
    label: z.string().trim().min(1).max(2),
    text: z.string().min(1).max(10000),
    position: z.number().int().min(1),
  })).max(6).default([]),
}).superRefine((value, ctx) => {
  if (value.question_type === "multiple_choice" && value.choices.length < 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["choices"], message: "Multiple-choice questions need at least two choices" });
  }
  const labels = value.choices.map((choice) => choice.label.trim().toUpperCase());
  if (new Set(labels).size !== labels.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["choices"], message: "Choice labels must be unique" });
  }
  if (value.question_type === "student_produced" && value.choices.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["choices"], message: "Student-produced questions cannot have choices" });
  }
  if (value.question_type === "multiple_choice" && value.suggested_answer &&
      !value.choices.some((choice) => choice.label.trim().toUpperCase() === value.suggested_answer!.trim().toUpperCase())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["suggested_answer"], message: "Correct answer must match one of the choice labels" });
  }
});

export const assignmentScopeSchema = z.enum(["full_test", "reading_writing", "math", "custom_modules"]);

export const assignTestSchema = z.object({
  test_id: z.string().uuid(),
  student_id: z.string().uuid(),
  due_at: z.string().datetime().optional().nullable(),
  content_scope: assignmentScopeSchema.default("full_test"),
  module_ids: z.array(z.string().uuid()).max(4).optional(),
});

export const assignManySchema = z.object({
  student_ids: z.array(z.string().uuid()).min(1).max(1000).optional(),
  class_id: z.string().uuid().optional(),
  due_at: z.string().datetime().optional().nullable(),
  content_scope: assignmentScopeSchema.default("full_test"),
  module_ids: z.array(z.string().uuid()).max(4).optional(),
}).refine((v) => Boolean(v.class_id) !== Boolean(v.student_ids?.length), { message: "Choose students or one class" });

export const pdfImportCreateSchema = z.object({
  storage_path: z.string().min(1),
  original_filename: z.string().min(1),
  file_size: z.number().int().positive().optional().nullable(),
  ocr_mode: z.enum(["auto", "all", "none"]).optional(),
  content_scope: z.enum(["full_test", "reading_writing", "math", "single_module"]).optional(),
  target_module: z.enum(["rw1", "rw2", "math1", "math2"]).optional().nullable(),
});

export const startAttemptSchema = z.object({
  test_id: z.string().uuid(),
  assignment_id: z.string().uuid().optional(),
});

export const advanceModuleSchema = z.object({
  attempt_id: z.string().uuid(),
  module_id: z.string().uuid(),
  time_spent_seconds: z.number().int().min(0).optional().default(0),
});

export const pauseAttemptSchema = z.object({
  attempt_id: z.string().uuid(),
});

const textAnnotationSchema = z.object({
  id: z.string().uuid(),
  target: z.union([
    z.enum(["passage", "prompt"]),
    z.string().regex(/^choice:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  ]),
  quote: z.string().min(1).max(2000),
  occurrence: z.number().int().min(0).max(100).optional(),
  start: z.number().int().min(0).max(20000).optional(),
  end: z.number().int().min(1).max(20000).optional(),
  color: z.enum(["yellow", "blue", "pink", "none"]),
  underline: z.boolean(),
}).superRefine((annotation, ctx) => {
  const hasStart = annotation.start !== undefined;
  const hasEnd = annotation.end !== undefined;
  if (hasStart !== hasEnd) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Annotation ranges need both start and end offsets" });
    return;
  }
  if (hasStart && hasEnd && (annotation.end! <= annotation.start! || annotation.end! - annotation.start! !== annotation.quote.length)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Annotation offsets must match the quoted source text" });
  }
});

export const responseSaveSchema = z.object({
  attempt_id: z.string().uuid(),
  question_id: z.string().uuid(),
  module_id: z.string().uuid(),
  selected_choice_id: z.string().uuid().optional().nullable(),
  typed_answer: z.string().max(500).optional().nullable(),
  marked_for_review: z.boolean().optional(),
  eliminated_choice_ids: z.array(z.string().uuid()).optional(),
  highlights: z.array(z.string().max(2000))
    .max(50)
    .refine((items) => items.reduce((size, item) => size + item.length, 0) <= 24_000)
    .optional(),
  annotations: z.array(textAnnotationSchema)
    .max(500)
    .refine((items) => items.reduce((size, item) => size + item.quote.length, 0) <= 24_000)
    .optional(),
  time_spent_seconds: z.number().int().min(0).optional(),
});

export const errorLogReviewSaveSchema = z.object({
  attempt_id: z.string().uuid(),
  question_id: z.string().uuid(),
  note: z.string().trim().max(3000),
  reviewed: z.boolean(),
});

export const submitAttemptSchema = z.object({
  attempt_id: z.string().uuid(),
});

export const approveDraftSchema = z.object({
  section: z.enum(["reading_writing", "math"]).optional(),
  question_type: z.enum(["multiple_choice", "student_produced"]).optional(),
  passage_text: z.string().max(20000).optional().nullable(),
  domain: z.string().max(100).optional().nullable(),
  skill: z.string().max(100).optional().nullable(),
  difficulty: z.number().int().min(1).max(5).optional().nullable(),
  correct_answer: z.string().max(500).optional().nullable(),
  explanation: z.string().max(5000).optional().nullable(),
  add_to_test_id: z.string().uuid().optional().nullable(),
  add_to_module_id: z.string().uuid().optional().nullable(),
  position: z.number().int().min(1).optional(),
});

export const updateDraftSchema = z.object({
  visual_code: z.string().max(250000).nullable().optional(),
  visual_format: z.enum(["svg", "html"]).nullable().optional(),
  prompt: z.string().min(1).optional(),
  passage_text: z.string().max(20000).optional().nullable(),
  section: z.enum(["reading_writing", "math"]).optional().nullable(),
  question_type: z.enum(["multiple_choice", "student_produced"]).optional().nullable(),
  domain: z.string().max(100).optional().nullable(),
  skill: z.string().max(100).optional().nullable(),
  difficulty: z.number().int().min(1).max(5).optional().nullable(),
  suggested_answer: z.string().max(500).optional().nullable(),
  explanation: z.string().max(5000).optional().nullable(),
  has_visual_stimulus: z.boolean().optional(),
  stimulus_image_path: z.string().max(1000).optional().nullable(),
  stimulus_source_image_path: z.string().max(1000).optional().nullable(),
  stimulus_crop_rect: z.object({ x: z.number().int(), y: z.number().int(), w: z.number().int().min(1), h: z.number().int().min(1) }).optional().nullable(),
  stimulus_crop_source: z.enum(["auto", "manual", "full_page"]).optional().nullable(),
  stimulus_crop_status: z.enum(["pending", "confirmed"]).optional(),
  choices: z.array(choiceSchema.partial().extend({ id: z.string().uuid().optional() })).optional(),
});

export const saveDraftEditorSchema = updateDraftSchema.extend({
  assigned_module_name: z.enum([
    "Reading and Writing Module 1", "Reading and Writing Module 2",
    "Math Module 1", "Math Module 2",
  ]),
  display_order: z.number().int().min(1),
  expected_updated_at: z.string().datetime({ offset: true }),
  choices: z.array(z.object({
    label: z.string().min(1).max(2),
    text: z.string().trim().min(1),
    position: z.number().int().min(1).max(6),
  })).min(2).max(6).optional(),
});

export const aiFindingDecisionSchema = z.object({
  reason: z.string().trim().min(1).max(2000).optional(),
});

export const aiBatchApproveSchema = z.object({
  drafts: z.array(z.object({
    id: z.string().uuid(),
    snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })).min(1).max(200),
});

// ---------------------------------------------------------------------------
// Practice sets (admin)
// ---------------------------------------------------------------------------
export const practiceCreateSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional().nullable(),
  time_limit_minutes: z.number().int().min(1).max(600),
  question_ids: z.array(z.string().uuid()).min(1).max(100),
});

export const practiceUpdateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).optional().nullable(),
  time_limit_minutes: z.number().int().min(1).max(600).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});

export const practiceAddQuestionsSchema = z.object({
  question_ids: z.array(z.string().uuid()).min(1).max(100),
});

export const practiceAssignSchema = z.object({
  student_ids: z.array(z.string().uuid()).min(1).max(1000).optional(),
  class_id: z.string().uuid().optional(),
  timer_minutes: z.number().int().min(1).max(600),
  due_at: z.string().datetime().optional().nullable(),
}).refine((v) => Boolean(v.class_id) !== Boolean(v.student_ids?.length), { message: "Choose students or one class" });

export const studentClassSchema = z.object({
  name: z.string().trim().min(1).max(100),
  student_ids: z.array(z.string().uuid()).max(1000),
});

export const practiceQuestionEditSchema = z.object({
  position: z.number().int().min(1).optional(),
  prompt: z.string().min(1).optional(),
  section: z.enum(["reading_writing", "math"]).optional(),
  question_type: z.enum(["multiple_choice", "student_produced"]).optional(),
  passage_id: z.string().uuid().optional().nullable(),
  domain: z.string().max(100).optional().nullable(),
  skill: z.string().max(100).optional().nullable(),
  difficulty: z.number().int().min(1).max(5).optional().nullable(),
  correct_answer: z.string().max(500).optional().nullable(),
  explanation: z.string().max(5000).optional().nullable(),
  choices: z.array(choiceSchema).max(6).optional(),
});

// ---------------------------------------------------------------------------
// Vocabulary (student)
// ---------------------------------------------------------------------------
export const deckCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  color: z.string().max(20).optional().default("#7f1d1d"),
});

export const deckUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  color: z.string().max(20).optional(),
});

export const cardCreateSchema = z.object({
  deck_id: z.string().uuid(),
  word: z.string().min(1).max(120),
  definition: z.string().min(1).max(2000),
  example_sentence: z.string().max(1000).optional().nullable(),
  part_of_speech: z.string().max(50).optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).optional().default([]),
});

export const cardUpdateSchema = z.object({
  word: z.string().min(1).max(120).optional(),
  definition: z.string().min(1).max(2000).optional(),
  example_sentence: z.string().max(1000).optional().nullable(),
  part_of_speech: z.string().max(50).optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export const importCardsSchema = z.object({
  deck_id: z.string().uuid(),
  text: z.string().min(1).max(200000),
});

// ---------------------------------------------------------------------------
// Vocabulary (admin-managed decks)
// ---------------------------------------------------------------------------
export const adminDeckUpdateSchema = deckUpdateSchema.extend({
  status: z.enum(["active", "archived"]).optional(),
});

export const adminCardCreateSchema = cardCreateSchema.omit({ deck_id: true });

export const adminImportCardsSchema = z.object({
  text: z.string().min(1).max(200000),
});

export const assignVocabDeckSchema = z.object({
  student_ids: z.array(z.string().uuid()).max(1000),
});

export const vocabReviewSchema = z.object({
  card_id: z.string().uuid(),
  rating: z.number().int().min(1).max(4),
  mode: z.enum(["study", "sprint"]).default("study"),
  response_ms: z.number().int().min(0).optional().nullable(),
  reviewed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  submission_id: z.string().uuid(),
  expected_version: z.number().int().min(0).optional(),
}).superRefine((value, ctx) => {
  if (value.mode === "study" && value.expected_version === undefined) {
    ctx.addIssue({ code: "custom", path: ["expected_version"], message: "Study reviews require an expected state version" });
  }
  if (value.mode === "sprint" && value.expected_version !== undefined) {
    ctx.addIssue({ code: "custom", path: ["expected_version"], message: "Sprint reviews do not accept a schedule version" });
  }
});
