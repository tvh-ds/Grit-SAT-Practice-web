import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./auth.ts";

const PAGE_SIZE = 10;

interface ErrorLogPage {
  items: Array<Record<string, unknown> & { stimulus_image_path?: string | null }>;
  total: number;
  needs_review_count: number;
  domains: string[];
  skills: string[];
}

// Callers must authorize access to studentId before using this service-role read.
export async function loadErrorLogPage(svc: SupabaseClient, studentId: string, url: URL) {
  const rawPage = url.searchParams.get("page") ?? "1";
  const page = Number(rawPage);
  const domain = url.searchParams.get("domain")?.trim() ?? "";
  const skill = url.searchParams.get("skill")?.trim() ?? "";
  if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(page) || page < 1 || page > 10000) {
    throw new HttpError(400, "Invalid error log page");
  }
  if (domain.length > 100 || skill.length > 100) throw new HttpError(400, "Invalid error log filter");

  const readPage = async (filterDomain: string, filterSkill: string, requestedPage: number) => {
    const { data, error } = await svc.rpc("get_student_error_log_page", {
      p_student_id: studentId,
      p_domain: filterDomain || null,
      p_skill: filterSkill || null,
      p_page: requestedPage,
      p_page_size: PAGE_SIZE,
    });
    if (error) {
      console.error("Unable to load student error log", error);
      throw new HttpError(500, "Unable to load the error log");
    }
    return data as ErrorLogPage;
  };

  // The RPC's total is filtered, while needs_review_count covers the whole log.
  // Use an unfiltered total so the review progress stays accurate under filters.
  const [result, unfiltered] = await Promise.all([
    readPage(domain, skill, page),
    domain || skill ? readPage("", "", 1) : Promise.resolve(null),
  ]);
  const summary = unfiltered ?? result;
  const imagePaths = [...new Set((result.items ?? [])
    .map(item => item.stimulus_image_path)
    .filter((path): path is string => typeof path === "string" && Boolean(path)))];
  const signedByPath = new Map<string, string>();
  if (imagePaths.length > 0) {
    const { data: signed, error: signError } = await svc.storage
      .from("question-assets").createSignedUrls(imagePaths, 60 * 60);
    if (signError) console.error("Failed to sign error log stimulus images", signError);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
    }
  }
  const questionIds = [...new Set((result.items ?? []).map(item => item.question_id).filter((id): id is string => typeof id === "string" && Boolean(id)))];
  const visualById = new Map<string, { visual_code: string | null; visual_format: string | null }>();
  if (questionIds.length) {
    const { data, error } = await svc.from("questions").select("id,visual_code,visual_format").in("id", questionIds);
    if (error) throw new HttpError(500, "Unable to load question visuals");
    for (const question of data ?? []) visualById.set(question.id, question);
  }
  const items = (result.items ?? []).map(({ stimulus_image_path, ...item }) => ({
    ...(visualById.get(String(item.question_id)) ?? {}),
    ...item,
    stimulus_image_url: stimulus_image_path ? signedByPath.get(stimulus_image_path) ?? null : null,
  }));
  return {
    ...result,
    items,
    needs_review_count: summary.needs_review_count,
    reviewed_count: summary.total - summary.needs_review_count,
    review_total: summary.total,
    page,
    page_size: PAGE_SIZE,
  };
}
