const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

async function request(path, options) {
  const res = await fetch(`${BACKEND_URL}${path}`, options);
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const message = data?.error || data?.detail || data?.details || `Request to ${path} failed`;
    throw new Error(message);
  }
  return data;
}

export function getHealth() { return request("/api/health"); }
export function getTemplates() { return request("/api/templates"); }
export function listExams() { return request("/api/exams"); }
export function getExam(examId) { return request(`/api/exams/${encodeURIComponent(examId)}`); }
export function createExam(examPayload) {
  return request("/api/exams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(examPayload) });
}
export function questionPaperUrl(examId) { return `${BACKEND_URL}/api/exams/${encodeURIComponent(examId)}/question-paper.pdf`; }
export function answerSheetUrl(templateType) { return `${BACKEND_URL}/api/answer-sheets/${encodeURIComponent(templateType)}`; }
export function gradeScript({ file, examId, studentId }) {
  const form = new FormData(); form.append("file", file); form.append("exam_id", examId); if (studentId) form.append("student_id", studentId);
  return request("/api/grade-script", { method: "POST", body: form });
}
export function listResults() { return request("/api/results"); }
export function getResult(resultId) { return request(`/api/results/${encodeURIComponent(resultId)}`); }
export function reviewQuestion(resultId, questionId, correctedScore, correctedText) {
  return request(`/api/results/${encodeURIComponent(resultId)}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question_id: questionId, corrected_score: correctedScore, corrected_text: correctedText || null }) });
}

export function normalizeResult(raw) {
  if (!raw) return null;
  const items = raw.questions || raw.grading_result_items || [];
  return {
    ...raw,
    result_id: raw.result_id || raw.external_id || raw.id,
    exam_id: raw.exam_id || raw.exam?.external_id,
    student_id: raw.student_id || raw.student_external_id,
    max_possible_score: raw.max_possible_score ?? raw.max_score ?? raw.maximum_score ?? 0,
    total_score: raw.total_score ?? 0,
    pending_review_count: raw.pending_review_count ?? items.filter((q) => q.flagged_for_review && !q.reviewed).length,
    questions: items.map((q) => ({
      ...q,
      question_id: q.question_id || q.question_external_id || q.id,
      confidence: q.confidence ?? q.recognition_confidence ?? 0,
      score: q.score ?? q.suggested_score ?? 0,
      max_score: q.max_score ?? q.maximum_score ?? 0,
      recognized_text: q.recognized_text ?? "",
      selected_option: q.selected_option ?? q.payload?.selected_option ?? null,
      selected_option_text: q.selected_option_text ?? q.payload?.selected_option_text ?? null,
      question: q.question || q.question_snapshot || null,
    })),
  };
}

export function normalizeResults(raw) {
  return (Array.isArray(raw) ? raw : []).map(normalizeResult);
}
