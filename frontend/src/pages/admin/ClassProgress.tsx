import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button, Spinner } from "../../components/ui";
import { DIFFICULTIES, difficultyLabel, domainsForSection, sectionLabel, skillsForDomain, type SectionKey } from "../../lib/satTaxonomy";
import { fnJson, getToken } from "../../lib/supabase";

type SkillProgress = {
  section: SectionKey;
  domain: string | null;
  skill: string | null;
  difficulty: number | null;
  assigned: number;
  total: number;
};
const sections = ["math", "reading_writing"] as const;
const difficultyNames = { easy: "Easy", medium: "Medium", hard: "Hard" };
const formatCount = new Intl.NumberFormat();

function sectionProgress(section: SectionKey, rows: SkillProgress[]) {
  const domains = new Map<string, Map<string, SkillProgress[]>>();
  for (const domain of domainsForSection(section)) {
    domains.set(domain, new Map(skillsForDomain(section, domain).map(skill => [skill, []])));
  }
  for (const row of rows) {
    if (row.section !== section) continue;
    const domain = row.domain?.trim() || "Unclassified domain";
    const skill = row.skill?.trim() || "Unclassified skill";
    const skills = domains.get(domain) ?? new Map<string, SkillProgress[]>();
    if (!domains.has(domain)) domains.set(domain, skills);
    const matches = skills.get(skill) ?? [];
    if (!skills.has(skill)) skills.set(skill, matches);
    matches.push(row);
  }
  return domains;
}

export default function ClassProgress({ classId }: { classId: string }) {
  const [rows, setRows] = useState<SkillProgress[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    void getToken()
      .then(token => fnJson<{ skills: SkillProgress[] }>(`admin-classes/${classId}/progress`, { token }))
      .then(data => { if (active) setRows(data.skills); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [classId, retry]);

  if (error) return <div className="login-error" role="alert">
    <p>Unable to load class progress.</p>
    <Button variant="outline" size="sm" onClick={() => { setError(false); setRetry(value => value + 1); }}>Try again</Button>
  </div>;
  if (!rows) return <Spinner />;

  return <section className="class-skill-progress" aria-label="Progress by skill">
    <p className="muted">Share of the active question bank assigned to this class. Each bank question counts once.</p>
    {sections.map(section => <details key={section} className="class-progress-subject">
      <summary><ChevronRight size={17} aria-hidden="true" /><span>{sectionLabel(section)}</span></summary>
      <div className="class-progress-domains">
        {[...sectionProgress(section, rows)].map(([domain, skills]) => <details key={domain} className="class-progress-domain">
          <summary><ChevronRight size={15} aria-hidden="true" /><span>{domain}</span></summary>
          <ul className="class-progress-skills">
            {[...skills].map(([skill, progress]) => <li key={skill} className="class-progress-skill">
              <h3>{skill}</h3>
              <div className="class-progress-difficulties">
                {DIFFICULTIES.map(difficulty => {
                  const totals = progress.filter(row => difficultyLabel(row.difficulty) === difficulty)
                    .reduce((sum, row) => ({ assigned: sum.assigned + row.assigned, total: sum.total + row.total }), { assigned: 0, total: 0 });
                  const coverage = totals.total ? 100 * totals.assigned / totals.total : 0;
                  const percentage = coverage > 0 && coverage < 1 ? "<1%" : coverage > 99 && coverage < 100 ? ">99%" : `${Math.round(coverage)}%`;
                  return <div className="class-progress-difficulty" key={difficulty}>
                    <div><span>{difficultyNames[difficulty]}</span><strong>{percentage}</strong></div>
                    <progress
                      aria-label={`${skill}, ${difficultyNames[difficulty]}`}
                      aria-valuetext={`${formatCount.format(totals.assigned)} assigned out of ${formatCount.format(totals.total)} in the bank`}
                      max={100}
                      value={coverage}
                    />
                    <span className="class-progress-count">{formatCount.format(totals.assigned)} of {formatCount.format(totals.total)} assigned</span>
                  </div>;
                })}
              </div>
            </li>)}
          </ul>
        </details>)}
      </div>
    </details>)}
  </section>;
}
