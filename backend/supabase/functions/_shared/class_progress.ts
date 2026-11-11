import type { serviceClient } from "./supabase.ts";
import { allProgressRows, progressRowsByIds } from "./assignment_progress.ts";

type Assignment = { test_id: string; content_scope: string | null; module_ids: string[] | null };
type Section = { id: string; test_id: string; section_type: string };
type Module = { id: string; section_id: string };
type BankQuestion = { id: string; section: string; domain: string | null; skill: string | null; difficulty: number };
type SkillProgress = Omit<BankQuestion, "id"> & { assigned: number; total: number };

function assignedModuleIds(assignments: Assignment[], sections: Section[], modules: Module[]): string[] {
  const assignmentsByTest = Map.groupBy(assignments, assignment => assignment.test_id);
  const modulesBySection = Map.groupBy(modules, module => module.section_id);
  const ids = [];
  for (const section of sections) {
    const scopedModules = new Set<string>();
    let entireSection = false;
    for (const assignment of assignmentsByTest.get(section.test_id) ?? []) {
      const scope = assignment.content_scope ?? "full_test";
      if (scope === "full_test" || scope === section.section_type) {
        entireSection = true;
        break;
      }
      if (scope === "custom_modules") {
        for (const id of assignment.module_ids ?? []) scopedModules.add(id);
      }
    }
    for (const module of modulesBySection.get(section.id) ?? []) {
      if (entireSection || scopedModules.has(module.id)) ids.push(module.id);
    }
  }
  return ids;
}

function summarizeBankCoverage(bank: BankQuestion[], assignedIds: Set<string>): SkillProgress[] {
  const totals = new Map<string, SkillProgress>();
  for (const { id, section, domain, skill, difficulty } of bank) {
    const key = JSON.stringify([section, domain, skill, difficulty]);
    let progress = totals.get(key);
    if (!progress) {
      progress = { section, domain, skill, difficulty, assigned: 0, total: 0 };
      totals.set(key, progress);
    }
    progress.total++;
    if (assignedIds.has(id)) progress.assigned++;
  }
  return [...totals.values()];
}

export async function loadClassProgress(svc: ReturnType<typeof serviceClient>, classId: string): Promise<SkillProgress[]> {
  const [assignments, bank] = await Promise.all([
    allProgressRows<Assignment>(start =>
      svc.from("test_assignments").select("test_id,content_scope,module_ids").eq("class_id", classId).order("id").range(start, start + 499)
    ),
    // Match the Practice Question Bank's active, rated question filter.
    allProgressRows<BankQuestion>(start =>
      svc.from("questions").select("id,section,domain,skill,difficulty").eq("status", "active").not("difficulty", "is", null).order("id").range(start, start + 499)
    ),
  ]);
  const sections = await progressRowsByIds<Section>(svc, "test_sections", "id,test_id,section_type", "test_id", assignments.map(assignment => assignment.test_id));
  const modules = await progressRowsByIds<Module>(svc, "test_modules", "id,section_id", "section_id", sections.map(section => section.id));
  const links = await progressRowsByIds<{ question_id: string }>(
    svc, "test_module_questions", "question_id", "module_id", assignedModuleIds(assignments, sections, modules),
  );
  return summarizeBankCoverage(bank, new Set(links.map(link => link.question_id)));
}
