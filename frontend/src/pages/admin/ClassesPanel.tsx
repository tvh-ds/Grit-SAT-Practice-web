import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { StudentClass } from "../../lib/types";
import type { ProgressStudent, VocabReport } from "../../lib/adminProgress";
import { Button, Modal, Spinner, fmtDate } from "../../components/ui";
import AdminStudentProgressTable from "../../components/AdminStudentProgressTable";
import ClassProgress from "./ClassProgress";
const VocabularyAssignments = lazy(() => import("./VocabularyAssignments"));
import "../../styles/admin-progress.css";

type Student = ProgressStudent;
type Assignment = { id: string; title: string; kind: "practice" | "full"; assigned_at: string; timer_minutes?: number; student_count: number; completed_count: number; avg_accuracy: number | null };
const classTabs = { students: "Students", assignments: "Assignments", progress: "Progress", vocabulary: "Vocabulary" } as const;

export default function ClassesPage() {
  const { classId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tabs = Object.keys(classTabs) as Array<keyof typeof classTabs>;
  const tab = tabs.find(value => value === params.get("tab")) ?? "students";
  const [classes, setClasses] = useState<StudentClass[] | null>(null);
  const [students, setStudents] = useState<Student[] | null>(null);
  const [vocabulary, setVocabulary] = useState<VocabReport | null>(null);
  const [editing, setEditing] = useState<StudentClass | "new" | null>(null);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const search = params.get("assignment_search") ?? "";
  const assignmentKind = params.get("assignment_kind") ?? "all";
  const assignmentStatus = params.get("assignment_status") ?? "all";
  const update = (key: string, value: string) => setParams(previous => { const next = new URLSearchParams(previous); if (value && value !== "all") next.set(key, value); else next.delete(key); return next; }, { replace: true });
  async function loadClasses() {
    const token = await getToken();
    setClasses((await fnJson<{ classes: StudentClass[] }>("admin-classes", { token })).classes);
  }
  useEffect(() => {
    let live = true;
    void getToken().then(token => Promise.all([
      fnJson<{ classes: StudentClass[] }>("admin-classes", { token }).then(data => { if (live) setClasses(data.classes); }),
    ].map(promise => promise.catch(e => { if (live) setError(e instanceof Error ? e.message : "Unable to load class progress"); })))).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, []);
  const viewingClass = !!classId;
  useEffect(() => {
    if (!viewingClass) return;
    let live = true;
    void getToken().then(token => Promise.all([
      fnJson<{ students: Student[] }>("admin-students?progress=1", { token }).then(data => { if (live) setStudents(data.students); }),
      fnJson<VocabReport>("admin-vocab/assignments", { token }).then(data => { if (live) setVocabulary(data); }),
    ])).catch(e => { if (live) setError(e instanceof Error ? e.message : "Unable to load class progress"); });
    return () => { live = false; };
  }, [viewingClass]);
  useEffect(() => {
    if (!editing || students || viewingClass) return;
    let live = true;
    void getToken().then(token => fnJson<{ students: Student[] }>("admin-students", { token }))
      .then(data => { if (live) setStudents(data.students); })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : "Unable to load students"); });
    return () => { live = false; };
  }, [editing, students, viewingClass]);
  useEffect(() => {
    let live = true;
    setAssignments(null); setHistoryError("");
    if (classId) void getToken().then(token => fnJson<{ assignments: Assignment[] }>(`admin-classes/${classId}`, { token }))
      .then(data => { if (live) setAssignments(data.assignments); })
      .catch(e => { if (live) setHistoryError(e instanceof Error ? e.message : "Unable to load assignments"); });
    return () => { live = false; };
  }, [classId]);
  const selected = classes?.find(cls => cls.id === classId);
  const members = (students ?? []).filter(student => selected?.student_ids.includes(student.id));
  const returnTo = location.pathname + location.search;
  const visibleAssignments = (assignments ?? []).filter(a => a.title.toLowerCase().includes(search.toLowerCase()) && (assignmentKind === "all" || a.kind === assignmentKind) && (assignmentStatus === "all" || (assignmentStatus === "completed" ? a.student_count > 0 && a.completed_count === a.student_count : a.completed_count < a.student_count)));
  return <section aria-label="Classes">
    {!classId ? <>
      <div className="admin-class-heading"><div><h1 className="page-title">Classes</h1><p className="page-sub">Open a class to track every student, assignment, and daily vocabulary review.</p></div><Button onClick={() => setEditing("new")}>New class</Button></div>
      {classes && <div className="admin-progress-scroll"><table className="table"><thead><tr><th>Class</th><th>Students</th><th>Created</th><th /></tr></thead><tbody>{classes.map(cls => <tr key={cls.id}><td><Link to={`/admin/classes/${cls.id}`}>{cls.name}</Link></td><td>{cls.student_ids.length}</td><td>{fmtDate(cls.created_at)}</td><td><Link className="btn btn-outline btn-sm" to={`/admin/classes/${cls.id}`}>View class</Link></td></tr>)}</tbody></table>{classes.length === 0 && <p className="muted">No classes yet. Create a class and add students to get started.</p>}</div>}
    </> : selected ? <>
      <Link to="/admin/classes" className="muted">← Classes</Link>
      <div className="admin-class-heading"><div><h1 className="page-title">{selected.name}</h1><p className="page-sub">Complete progress for every current class member.</p></div><Button variant="outline" onClick={() => setEditing(selected)} disabled={!students}>Edit class</Button></div>
      <div className="admin-class-summary"><span><strong>{selected.student_ids.length}</strong>Students</span><span><strong>{assignments?.length ?? "—"}</strong>Class assignments</span><span><strong>{assignments ? assignments.reduce((n, a) => n + a.completed_count, 0) : "—"}/{assignments ? assignments.reduce((n, a) => n + a.student_count, 0) : "—"}</strong>Student submissions completed</span><span><strong>{vocabulary ? vocabulary.decks.filter(d => d.students.some(s => selected.student_ids.includes(s.student_id))).length : "—"}</strong>Assigned vocabulary decks</span></div>
      <nav className="admin-work-tabs" aria-label="Class progress">{tabs.map(value => <button key={value} type="button" className="btn btn-outline" aria-current={tab === value ? "page" : undefined} onClick={() => update("tab", value)}>{classTabs[value]}</button>)}</nav>
      {tab === "students" && (students ? <AdminStudentProgressTable students={members} vocabulary={vocabulary} returnTo={returnTo} /> : !error && <Spinner />)}
      {tab === "assignments" && <>
        <p className="muted">All work assigned to this class, including completed assignments. Counts retain the original recipients when membership changes.</p>
        {historyError && <div className="login-error" role="alert">{historyError}</div>}
        {!assignments && !historyError && <Spinner />}
        <div className="toolbar admin-progress-filters"><label>Find assignment<input className="input" type="search" placeholder="Assignment title" value={search} onChange={e => update("assignment_search", e.target.value)} /></label><label>Type<select className="select" value={assignmentKind} onChange={e => update("assignment_kind", e.target.value)}><option value="all">All types</option><option value="practice">Practice sets</option><option value="full">Full-length tests</option></select></label><label>Completion<select className="select" value={assignmentStatus} onChange={e => update("assignment_status", e.target.value)}><option value="all">All assignments</option><option value="completed">Everyone completed</option><option value="incomplete">Incomplete</option></select></label></div>
        {assignments && <div className="admin-progress-scroll"><table className="table"><thead><tr><th>Assignment</th><th>Type</th><th>Assigned</th><th>Completed / assigned</th><th>Average score</th><th /></tr></thead><tbody>{visibleAssignments.map(a => <tr key={`${a.kind}-${a.id}`}><td>{a.title}</td><td>{a.kind === "practice" ? "Practice set" : "Full-length test"}</td><td>{fmtDate(a.assigned_at)}</td><td>{a.completed_count}/{a.student_count}</td><td>{a.avg_accuracy == null ? "—" : `${a.avg_accuracy}%`}</td><td><Link className="btn btn-outline btn-sm" to={`/admin/assignments/${a.kind}/${a.id}?return_to=${encodeURIComponent(returnTo)}`}>View students</Link></td></tr>)}</tbody></table>{visibleAssignments.length === 0 && <p className="muted">No assignments match this view.</p>}</div>}
      </>}
      {tab === "progress" && <ClassProgress key={selected.id} classId={selected.id} />}
      {tab === "vocabulary" && <Suspense fallback={<Spinner />}><VocabularyAssignments key={selected.id} classId={selected.id} returnTo={returnTo} /></Suspense>}
    </> : classes ? <p role="alert">Class not found. <Link to="/admin/classes">Return to classes</Link></p> : null}
    {error && <div className="login-error" role="alert">{error} Reload the page to retry.</div>}
    {!classes && !error && <Spinner />}
    {editing && students && <ClassEditor cls={editing === "new" ? null : editing} students={students} onClose={() => setEditing(null)} onSaved={async id => { setEditing(null); await loadClasses(); navigate(`/admin/classes/${id}`); }} />}
    {editing && !students && <Modal title="Loading students" onClose={() => setEditing(null)}>{error ? <p role="alert">{error}</p> : <Spinner />}</Modal>}
  </section>;
}

export function ClassEditor({ cls, students, onClose, onSaved }: { cls: StudentClass | null; students: Student[]; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const [name, setName] = useState(cls?.name ?? ""), [selected, setSelected] = useState(new Set(cls?.student_ids ?? []));
  const [search, setSearch] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const filtered = students.filter((s) => `${s.full_name ?? ""} ${s.email ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const token = await getToken();
      const result = await fnJson<{ id: string }>(cls ? `admin-classes/${cls.id}` : "admin-classes", { method: cls ? "PUT" : "POST", token, body: { name: name.trim(), student_ids: [...selected] } });
      await onSaved(result.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save class"); setBusy(false); }
  }
  return <Modal title={cls ? "Edit class" : "New class"} onClose={busy ? () => {} : onClose}><form onSubmit={(e) => void save(e)} style={{ display: "grid", gap: 14 }}>
    <div><label htmlFor="class-name" className="field-label">Class name</label><input id="class-name" autoFocus className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} placeholder="e.g. SAT Saturday" /></div>
    <div><label htmlFor="class-student-search" className="field-label">Students · {selected.size} selected</label><input id="class-student-search" className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email" /></div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setSelected((prev) => new Set([...prev, ...filtered.map((s) => s.id)]))}>Select all shown</Button><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setSelected(new Set())}>Clear selection</Button></div>
    <div style={{ maxHeight: 260, overflowY: "auto", display: "grid", gap: 10 }}>{filtered.map((s) => <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, overflowWrap: "anywhere" }}><input type="checkbox" disabled={busy} checked={selected.has(s.id)} onChange={() => setSelected((prev) => { const next = new Set(prev); if (next.has(s.id)) next.delete(s.id); else next.add(s.id); return next; })} /><span>{s.full_name || "Unnamed student"}<span className="muted" style={{ display: "block", fontSize: 12 }}>{s.email}</span></span></label>)}{!filtered.length && <p className="muted">{students.length ? "No students match this search." : "Create student accounts before adding members."}</p>}</div>
    {error && <div className="login-error" role="alert">{error}</div>}
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save class"}</Button></div>
  </form></Modal>;
}
