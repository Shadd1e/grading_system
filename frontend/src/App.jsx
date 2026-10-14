import { useState, useEffect, useCallback } from "react";
import UploadForm from "./components/UploadForm.jsx";
import ResultsView from "./components/ResultsView.jsx";
import ExamBuilder from "./components/ExamBuilder.jsx";
import ResultsHistory from "./components/ResultsHistory.jsx";
import Examinations from "./components/Examinations.jsx";
import { getHealth, gradeScript, reviewQuestion, listExams, listResults, normalizeResults } from "./api.js";
import "./App.css";

const TABS = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "grade", label: "Grade scripts", icon: "↗" },
  { id: "exams", label: "Examinations", icon: "□" },
  { id: "results", label: "Results", icon: "▤" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [health, setHealth] = useState(null);
  const [exams, setExams] = useState([]);
  const [results, setResults] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [healthData, examData, resultData] = await Promise.all([getHealth(), listExams(), listResults()]);
      setHealth(healthData);
      setExams(Array.isArray(examData) ? examData : []);
      setResults(normalizeResults(resultData));
      setError(null);
    } catch (err) {
      setError(err.message);
      try { setHealth(await getHealth()); } catch { setHealth(null); }
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleSubmit({ file, examId, studentId }) {
    setIsLoading(true); setError(null); setResult(null);
    try {
      const data = await gradeScript({ file, examId, studentId });
      setResult(data);
      setActiveTab("grade");
      await refresh();
    } catch (err) { setError(err.message); } finally { setIsLoading(false); }
  }

  async function handleReview(questionId, correctedScore, correctedText) {
    const current = result?.result_id || result?.external_id;
    const updated = await reviewQuestion(current, questionId, correctedScore, correctedText);
    setResult(updated);
    await refresh();
  }

  const pending = results.reduce((n, r) => n + Number(r.pending_review_count || 0), 0);
  const healthy = Boolean(health?.backend_status === "ok" && health?.supabase_reachable && health?.ml_service_reachable);
  const ml = health?.ml_service;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">G</div><div><strong>GradeFlow</strong><span>Assessment workspace</span></div></div>
        <nav className="side-nav">
          {TABS.map((tab) => <button key={tab.id} className={`side-nav__item ${activeTab === tab.id ? "is-active" : ""}`} onClick={() => setActiveTab(tab.id)}><span>{tab.icon}</span>{tab.label}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className={`system-mini ${healthy ? "is-ok" : "is-warning"}`}><span className="dot"/><div><strong>{healthy ? "All systems operational" : "Check system status"}</strong><small>Backend · Supabase · ML</small></div></div>
          <button className="refresh-link" onClick={refresh}>↻ Refresh status</button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar"><div><p className="eyebrow">Examination control center</p><h1>{activeTab === "exam-builder" ? "Create examination" : TABS.find((t) => t.id === activeTab)?.label}</h1></div><div className="topbar-status"><span className={`status-dot ${healthy ? "is-ok" : "is-warning"}`}/><span>{healthy ? "Connected" : "Attention needed"}</span></div></header>

        {activeTab === "overview" && <Overview exams={exams} results={results} pending={pending} ml={ml} onGrade={() => setActiveTab("grade")} onExam={() => setActiveTab("exams")} />}
        {activeTab === "grade" && <main className="content-grid"><UploadForm onSubmit={handleSubmit} isLoading={isLoading} /><ResultsView result={result} error={error} isLoading={isLoading} onReview={result ? handleReview : null} /></main>}
        {activeTab === "exams" && <main className="content-wide"><Examinations onCreate={() => setActiveTab("exam-builder")} /></main>}
        {activeTab === "exam-builder" && <main className="content-wide"><div className="exam-builder-back"><button className="back-button" onClick={() => setActiveTab("exams")}>← Back to examinations</button></div><ExamBuilder onCreated={() => { refresh(); setActiveTab("exams"); }} /></main>}
        {activeTab === "results" && <main className="content-wide"><ResultsHistory /></main>}
      </div>
    </div>
  );
}

function Overview({ exams, results, pending, ml, onGrade, onExam }) {
  const latest = results.slice(0, 5);
  return <main className="content-wide overview">
    <section className="hero-card"><div><span className="hero-kicker">AUTOMATED ASSESSMENT</span><h2>Grade handwriting. Review uncertainty. Keep every result.</h2><p>One workspace for exam creation, scanned scripts, recognition confidence and lecturer review.</p><div className="hero-actions"><button className="primary-button" onClick={onGrade}>Grade a script <span>→</span></button><button className="ghost-button" onClick={onExam}>Create an exam</button></div></div><div className="hero-orb"><span>AI</span><small>Recognition<br/>+ review</small></div></section>
    <section className="metric-grid"><Metric label="Examinations" value={exams.length} note="stored in Supabase"/><Metric label="Scripts graded" value={results.length} note="all-time results"/><Metric label="Awaiting review" value={pending} note="flagged responses" accent={pending > 0}/><Metric label="MCQ model" value={ml?.mcq_model_loaded ? "Ready" : "Offline"} note="EMNIST classifier"/></section>
    <section className="overview-columns"><div className="panel"><div className="panel-head"><div><span className="section-label">RECENT RESULTS</span><h3>Latest grading activity</h3></div><button className="text-button" onClick={() => document.querySelector(".side-nav__item:nth-child(4)")?.click()}>View all →</button></div>{latest.length ? latest.map((r) => <ResultMini key={r.result_id} result={r}/>) : <Empty title="No grading activity yet" text="Grade your first script and results will appear here."/>}</div><div className="panel"><div className="panel-head"><div><span className="section-label">WORKFLOW</span><h3>From paper to result</h3></div></div><WorkflowStep n="01" title="Create examination" text="Build MCQ, Completion or Essay questions and set marking rules."/><WorkflowStep n="02" title="Capture script" text="Upload a scanned or photographed answer sheet."/><WorkflowStep n="03" title="Recognize & grade" text="ML reads responses and separates confidence from correctness."/><WorkflowStep n="04" title="Review uncertainty" text="Lecturers confirm flagged responses before results settle."/></div></section>
  </main>;
}
function Metric({label,value,note,accent}) { return <div className={`metric-card ${accent ? "is-accent" : ""}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function ResultMini({result}) { const pct=result.max_possible_score ? Math.round(result.total_score/result.max_possible_score*100) : 0; return <div className="result-mini"><div className="result-mini__avatar">{String(result.student_id || "?").slice(0,1).toUpperCase()}</div><div><strong>{result.student_id || "Unidentified student"}</strong><small>{result.exam_id || "Examination"}</small></div><div className="result-mini__score"><strong>{result.total_score}/{result.max_possible_score}</strong><small>{pct}%{result.pending_review_count ? ` · ${result.pending_review_count} review` : ""}</small></div></div>; }
function WorkflowStep({n,title,text}) { return <div className="workflow-step"><span>{n}</span><div><strong>{title}</strong><p>{text}</p></div></div>; }
function Empty({title,text}) { return <div className="empty-block"><strong>{title}</strong><span>{text}</span></div>; }
