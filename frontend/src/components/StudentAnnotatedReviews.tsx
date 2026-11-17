import { useCallback, useEffect, useState } from "react";
import { Download, Eye } from "lucide-react";
import { AnnotationExport, AnnotationPages } from "./AssignmentAnnotations";
import { annotationFingerprint, validAnnotation } from "../lib/reviewAnnotations";
import type { AnnotationQuestion, ReviewAnnotation } from "../lib/reviewAnnotations";
import { fnJson, getToken } from "../lib/supabase";
import { Button } from "./ui";

type SharedAnnotation = { question_id: string; document: unknown; content_hash: string; assignment_wide: boolean };
type ReviewPages = { questions: AnnotationQuestion[]; annotations: Record<string, ReviewAnnotation> };

async function matchReviews(questions: AnnotationQuestion[], rows: SharedAnnotation[]): Promise<ReviewPages> {
  const matches = await Promise.all(questions.map(async question => {
    const candidates = rows.filter(row => row.question_id === question.question_id && validAnnotation(row.document));
    // A review of this student's attempt takes precedence over general feedback.
    for (const assignmentWide of [false, true]) {
      const scoped = candidates.filter(row => row.assignment_wide === assignmentWide);
      if (!scoped.length) continue;
      const boardQuestion = assignmentWide ? { ...question, your_answer: undefined } : question;
      const hash = await annotationFingerprint(boardQuestion);
      const row = scoped.find(item => item.content_hash === hash);
      if (row) return { question: boardQuestion, annotation: row.document as ReviewAnnotation };
    }
    return null;
  }));
  const found = matches.filter(match => match !== null);
  return {
    questions: found.map(match => match.question),
    annotations: Object.fromEntries(found.map(match => [match.question.question_id, match.annotation])),
  };
}

export default function StudentAnnotatedReviews({ attemptId, questions, title }: {
  attemptId: string; questions: AnnotationQuestion[]; title: string;
}) {
  const [pages, setPages] = useState<ReviewPages | null>(null);
  const [open, setOpen] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    void (async () => {
      try {
        const token = await getToken();
        const { annotations } = await fnJson<{ annotations: SharedAnnotation[] }>(`student-scores/${attemptId}/annotations`, { token });
        const reviews = await matchReviews(questions, annotations);
        if (active) setPages(reviews);
      } catch {
        if (active) setLoadFailed(true);
      }
    })();
    return () => { active = false; };
  }, [attemptId, questions, retry]);

  async function download() {
    if (!pages || downloading) return;
    setDownloading(true);
    setDownloadFailed(false);
    try {
      const [{ renderToStaticMarkup }, { downloadAnnotatedReviews }] = await Promise.all([
        import("react-dom/server"), import("../lib/downloadAnnotatedReviews"),
      ]);
      await downloadAnnotatedReviews(title, renderToStaticMarkup(<AnnotationPages title={title} {...pages} />));
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  }

  if (loadFailed) return <div role="alert" className="annotation-review-toolbar">
    Annotated reviews couldn’t load.
    <Button variant="ghost" size="sm" onClick={() => setRetry(value => value + 1)}>Retry</Button>
  </div>;
  if (!pages?.questions.length) return null;

  const downloadButton = <Button variant="outline" onClick={() => void download()} disabled={downloading}>
    <Download size={16} aria-hidden="true" /> {downloading ? "Preparing download…" : "Download reviews"}
  </Button>;
  const downloadError = downloadFailed && <span role="alert">Download failed. Try again or use Print / Save as PDF in the viewer.</span>;

  return <div className="annotation-review-toolbar">
    <Button variant="outline" onClick={() => setOpen(true)}><Eye size={16} aria-hidden="true" /> View annotated reviews ({pages.questions.length})</Button>
    {downloadButton}
    {!open && downloadError}
    {open && <AnnotationExport title={title} {...pages} onClose={close} studentActions={<>{downloadButton}{downloadError}</>} />}
  </div>;
}
