const BACKEND_URL = "http://localhost:4000";

async function request(path, options) {
  const res = await fetch(`${BACKEND_URL}${path}`, options);
  const data = await res.json();
  if (!res.ok) {
    const message = data.error || data.detail || `Request to ${path} failed`;
    throw new Error(message);
  }
  return data;
}

export function getHealth() {
  return request("/api/health");
}

export function getTemplates() {
  return request("/api/templates");
}

export function listExams() {
  return request("/api/exams");
}

export function getExam(examId) {
  return request(`/api/exams/${encodeURIComponent(examId)}`);
}

export function createExam(examPayload) {
  return request("/api/exams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(examPayload),
  });
}

export function questionPaperUrl(examId) {
  return `${BACKEND_URL}/api/exams/${encodeURIComponent(examId)}/question-paper.pdf`;
}

export function answerSheetUrl(templateType) {
  return `${BACKEND_URL}/api/answer-sheets/${encodeURIComponent(templateType)}`;
}

export function gradeScript({ file, examId, studentId }) {
  const form = new FormData();
  form.append("file", file);
  form.append("exam_id", examId);
  if (studentId) form.append("student_id", studentId);
  return request("/api/grade-script", { method: "POST", body: form });
}

export function listResults() {
  return request("/api/results");
}

export function getResult(resultId) {
  return request(`/api/results/${encodeURIComponent(resultId)}`);
}

export function reviewQuestion(resultId, questionId, correctedScore, correctedText) {
  return request(`/api/results/${encodeURIComponent(resultId)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question_id: questionId,
      corrected_score: correctedScore,
      corrected_text: correctedText || null,
    }),
  });
}
