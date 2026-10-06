import { useState, useEffect, useCallback } from "react";
import { listExams } from "../api.js";

const TEMPLATE_SHORT_LABEL = {
  mixed: "Mixed",
  all_mcq: "All MCQ",
  all_completion: "All Completion",
};

export default function UploadForm({ onSubmit, isLoading }) {
  const [file, setFile] = useState(null);
  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [loadError, setLoadError] = useState(null);

  const loadExams = useCallback(async () => {
    try {
      const data = await listExams();
      setExams(data);
      if (data.length > 0 && !examId) setExamId(data[0].exam_id);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadExams();
  }, [loadExams]);

  function handleFileChange(e) {
    setFile(e.target.files?.[0] || null);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!file || !examId) return;
    onSubmit({ file, examId, studentId });
  }

  return (
    <aside className="upload-panel">
      <h2 className="panel-heading">Grade a script</h2>
      <p className="panel-subtext">
        Upload a scanned or photographed answer sheet. It'll be scored against
        the exam you pick below.
      </p>

      {exams.length === 0 && !loadError && (
        <p className="panel-notice">
          No exams yet — create one on the <strong>Exams</strong> tab first.
        </p>
      )}
      {loadError && (
        <p className="panel-notice panel-notice--error">
          Couldn't load exams: {loadError}
        </p>
      )}

      <form onSubmit={handleSubmit} className="upload-form">
        <label className="field">
          <span className="field-label">Scanned script</span>
          <input type="file" accept="image/*" onChange={handleFileChange} required />
        </label>

        <label className="field">
          <span className="field-label">Exam</span>
          <select value={examId} onChange={(e) => setExamId(e.target.value)} required>
            <option value="" disabled>
              Select an exam…
            </option>
            {exams.map((exam) => (
              <option key={exam.exam_id} value={exam.exam_id}>
                {exam.course_code} — {exam.course_title} ({TEMPLATE_SHORT_LABEL[exam.template_type] || exam.template_type})
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Student ID (optional)</span>
          <input
            type="text"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            placeholder="e.g. ENG2019001"
          />
        </label>

        <button type="submit" className="submit-button" disabled={isLoading || !file || !examId}>
          {isLoading ? "Grading…" : "Grade script"}
        </button>
      </form>
    </aside>
  );
}
