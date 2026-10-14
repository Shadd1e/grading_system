import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getExam,
  listExams,
  questionPaperUrl,
  answerSheetUrl,
} from "../api.js";

const typeLabels = {
  mcq: "MCQ",
  completion: "Completion",
  phrase: "Completion",
  essay: "Essay",
  mixed: "Mixed",
  all_mcq: "MCQ",
  all_completion: "Completion",
};

function examIdOf(exam) {
  return exam?.external_id || exam?.exam_id || exam?.id;
}

function examTitle(exam) {
  return exam?.title || exam?.course_title || exam?.course_code || "Untitled examination";
}

function examQuestions(exam) {
  if (Array.isArray(exam?.questions)) return exam.questions;
  if (Array.isArray(exam?.content?.questions)) return exam.content.questions;
  if (exam?.content?.questions && typeof exam.content.questions === "object") {
    return Object.entries(exam.content.questions).map(([id, q], index) => ({ ...q, id, question_number: q.question_number || index + 1 }));
  }
  return [];
}

function questionType(q) {
  return q?.type || q?.question_type || "mcq";
}

function questionText(q) {
  return q?.question_text || q?.text || q?.question || "Question text unavailable";
}

function questionOptions(q) {
  const raw = q?.options;
  if (Array.isArray(raw)) return raw.map((x, i) => ({ label: x?.label || String.fromCharCode(65 + i), text: x?.text ?? String(x) }));
  if (raw && typeof raw === "object") return Object.entries(raw).map(([label, text]) => ({ label, text: typeof text === "object" ? text.text : text }));
  return [];
}

function createdDate(exam) {
  const value = exam?.created_at || exam?.createdAt;
  if (!value) return "Date not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date not available" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function getTemplateType(exam) {
  return exam?.template_type || exam?.templateType || exam?.content?.template_type || "mixed";
}

export default function Examinations({ onCreate }) {
  const [exams, setExams] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listExams();
      const rows = Array.isArray(data) ? data : Array.isArray(data?.exams) ? data.exams : [];
      setExams(rows);
      setError(null);
      if (selectedId && !rows.some((x) => String(examIdOf(x)) === String(selectedId))) {
        setSelectedId(null);
        setSelected(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { load(); }, [load]);

  async function openExam(exam) {
    const id = examIdOf(exam);
    if (!id) return;
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const detail = await getExam(id);
      setSelected(detail || exam);
      setError(null);
    } catch (err) {
      // Listing data can already contain the complete exam. Keep it usable if detail retrieval fails.
      setSelected(exam);
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return exams.filter((exam) => {
      const type = getTemplateType(exam).toLowerCase();
      const matchesFilter = filter === "all" || type === filter || (filter === "mcq" && type === "all_mcq") || (filter === "completion" && type === "all_completion");
      const haystack = [examTitle(exam), exam?.description, exam?.course_code, exam?.external_id].filter(Boolean).join(" ").toLowerCase();
      return matchesFilter && (!query || haystack.includes(query));
    });
  }, [exams, filter, search]);

  if (selectedId && selected) {
    return (
      <ExamDetail
        exam={selected}
        loading={detailLoading}
        onBack={() => { setSelectedId(null); setSelected(null); setError(null); }}
        error={error}
      />
    );
  }

  return (
    <main className="examinations-page">
      <section className="examinations-header">
        <div>
          <span className="section-label">EXAMINATION ARCHIVE</span>
          <h2>Created examinations</h2>
          <p>View every examination stored by the system, inspect its questions, and print or download the paper and matching answer sheet.</p>
        </div>
        <button className="primary-button" onClick={onCreate}>+ Create examination</button>
      </section>

      <section className="exam-toolbar">
        <div className="exam-search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search examinations…" /></div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All types</option>
          <option value="mcq">MCQ</option>
          <option value="completion">Completion</option>
          <option value="essay">Essay</option>
          <option value="mixed">Mixed</option>
        </select>
        <button className="secondary-button exam-refresh" onClick={load} disabled={loading}>↻ Refresh</button>
      </section>

      {error && <div className="panel-notice panel-notice--error exam-error">{error}</div>}
      {loading ? <div className="empty-state"><p>Loading examinations…</p></div> : !filtered.length ? <div className="empty-state"><p className="empty-state__title">No examinations found</p><p>Create an examination or adjust your search.</p></div> : (
        <section className="exam-list">
          {filtered.map((exam) => <ExamCard key={examIdOf(exam)} exam={exam} onView={() => openExam(exam)} />)}
        </section>
      )}
    </main>
  );
}

function ExamCard({ exam, onView }) {
  const type = getTemplateType(exam);
  const questions = examQuestions(exam);
  const id = examIdOf(exam);
  return (
    <article className="exam-card">
      <div className="exam-card__top">
        <div className="exam-card__type">{typeLabels[type] || type.replaceAll("_", " ")}</div>
        <span className="exam-card__date">{createdDate(exam)}</span>
      </div>
      <h3>{examTitle(exam)}</h3>
      <p>{exam?.description || exam?.instructions || "Examination paper"}</p>
      <div className="exam-card__meta"><span>{questions.length || exam?.question_count || 0} questions</span><span>{exam?.context_mode ? `Context: ${exam.context_mode}` : "Context off"}</span><span>{id || "No ID"}</span></div>
      <div className="exam-card__actions">
        <button className="primary-button" onClick={onView}>View exam</button>
        <a className="secondary-button" href={questionPaperUrl(id)} target="_blank" rel="noreferrer">Print / PDF</a>
        <a className="secondary-button" href={answerSheetUrl(type)} target="_blank" rel="noreferrer">Answer sheet</a>
      </div>
    </article>
  );
}

function ExamDetail({ exam, loading, onBack, error }) {
  const questions = examQuestions(exam);
  const id = examIdOf(exam);
  const type = getTemplateType(exam);
  return (
    <main className="exam-detail-page">
      <button className="back-button" onClick={onBack}>← Back to examinations</button>
      <section className="exam-detail-hero">
        <div>
          <span className="section-label">EXAMINATION</span>
          <h2>{examTitle(exam)}</h2>
          <p>{exam?.description || exam?.instructions || "Examination paper"}</p>
          <div className="exam-detail-meta"><span>{typeLabels[type] || type}</span><span>{questions.length || exam?.question_count || 0} questions</span><span>Created {createdDate(exam)}</span></div>
        </div>
        <div className="exam-detail-actions">
          <a className="primary-button" href={questionPaperUrl(id)} target="_blank" rel="noreferrer">Print / download exam</a>
          <a className="secondary-button" href={answerSheetUrl(type)} target="_blank" rel="noreferrer">Download answer sheet</a>
        </div>
      </section>

      {error && <div className="panel-notice panel-notice--error exam-error">{error}</div>}
      <section className="exam-question-panel">
        <div className="panel-head"><div><span className="section-label">QUESTION PAPER</span><h3>Questions and options</h3></div><span className="question-count">{questions.length} questions</span></div>
        {loading ? <div className="empty-state"><p>Loading examination…</p></div> : questions.length ? questions.map((q, index) => <QuestionPreview key={q.id || q.external_id || index} question={q} index={index} />) : <div className="empty-state"><p className="empty-state__title">No questions available</p><p>The examination exists, but its question data was not returned.</p></div>}
      </section>
    </main>
  );
}

function QuestionPreview({ question, index }) {
  const type = questionType(question);
  const options = questionOptions(question);
  return (
    <article className="question-preview">
      <div className="question-preview__number">Q{question.question_number || index + 1}</div>
      <div className="question-preview__body">
        <div className="question-preview__type">{typeLabels[type] || type}</div>
        <h4>{questionText(question)}</h4>
        {type === "mcq" && options.length > 0 && <div className="question-preview__options">{options.map((option) => <div key={option.label} className="question-preview__option"><span>{option.label}</span><p>{option.text}</p></div>)}</div>}
        {type !== "mcq" && <div className="question-preview__writing">Student response area · {type === "essay" ? "Essay" : "Completion"}</div>}
      </div>
    </article>
  );
}
