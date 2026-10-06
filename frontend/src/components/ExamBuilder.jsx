import { useState, useEffect, useCallback } from "react";
import { getTemplates, createExam, questionPaperUrl, answerSheetUrl } from "../api.js";

function naturalOrder(id) {
  const match = id.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

function blankQuestion(type) {
  if (type === "mcq") {
    return { type: "mcq", text: "", options: { A: "", B: "", C: "", D: "" }, correct: "A" };
  }
  return { type: "phrase", text: "", acceptableAnswersRaw: "" };
}

const TEMPLATE_SHORT_LABEL = {
  mixed: "Mixed",
  all_mcq: "All MCQ",
  all_completion: "All Completion",
};

export default function ExamBuilder() {
  const [allTemplates, setAllTemplates] = useState(null); // full list from the API
  const [templateError, setTemplateError] = useState(null);
  const [templateType, setTemplateType] = useState(null); // currently selected type

  const [examId, setExamId] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [courseTitle, setCourseTitle] = useState("");
  const [instructions, setInstructions] = useState(
    "Answer ALL questions. Write your answers in the correspondingly numbered box on the structured answer sheet provided."
  );
  const [maxScoreMcq, setMaxScoreMcq] = useState(2);
  const [maxScorePhrase, setMaxScorePhrase] = useState(5);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.75);
  const [questions, setQuestions] = useState({});

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [createdExam, setCreatedExam] = useState(null);

  const loadTemplates = useCallback(async () => {
    try {
      const data = await getTemplates();
      setAllTemplates(data);
      if (data.length > 0) setTemplateType((prev) => prev || data[0].type);
      setTemplateError(null);
    } catch (err) {
      setTemplateError(err.message);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // Whenever the chosen template type changes, (re)seed the question editor
  // with blank entries matching THAT template's shape. Switching types
  // deliberately discards any in-progress answers for the old shape, since
  // question count/type may differ entirely (e.g. mixed -> all_mcq).
  const activeTemplate = allTemplates?.find((t) => t.type === templateType) || null;

  useEffect(() => {
    if (!activeTemplate) return;
    const sorted = [...activeTemplate.questions].sort(
      (a, b) => naturalOrder(a.id) - naturalOrder(b.id)
    );
    setQuestions(() => {
      const next = {};
      for (const q of sorted) next[q.id] = blankQuestion(q.type);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateType]);

  function updateQuestion(id, patch) {
    setQuestions((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function updateOption(id, letter, value) {
    setQuestions((prev) => ({
      ...prev,
      [id]: { ...prev[id], options: { ...prev[id].options, [letter]: value } },
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    setCreatedExam(null);

    try {
      const payloadQuestions = {};
      for (const [id, q] of Object.entries(questions)) {
        if (q.type === "mcq") {
          payloadQuestions[id] = {
            type: "mcq",
            text: q.text,
            options: q.options,
            correct: q.correct,
          };
        } else {
          payloadQuestions[id] = {
            type: "phrase",
            text: q.text,
            acceptable_answers: q.acceptableAnswersRaw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          };
        }
      }

      const payload = {
        exam_id: examId,
        template_type: templateType,
        course_code: courseCode,
        course_title: courseTitle,
        instructions,
        max_score_mcq: Number(maxScoreMcq),
        max_score_phrase: Number(maxScorePhrase),
        confidence_threshold: Number(confidenceThreshold),
        questions: payloadQuestions,
      };

      const result = await createExam(payload);
      setCreatedExam(result);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (templateError) {
    return (
      <div className="empty-state empty-state--error">
        <p className="empty-state__title">Couldn't load answer sheet templates</p>
        <p>{templateError}</p>
      </div>
    );
  }

  if (!allTemplates || !activeTemplate) {
    return (
      <div className="empty-state">
        <p>Loading answer sheet layouts…</p>
      </div>
    );
  }

  if (createdExam) {
    return (
      <div className="exam-created">
        <p className="empty-state__title">Exam created</p>
        <p>
          <strong>{createdExam.course_code}</strong> — {createdExam.course_title} (
          {createdExam.question_count} questions, {TEMPLATE_SHORT_LABEL[createdExam.template_type]})
        </p>
        <div className="exam-created__links">
          <a
            className="submit-button exam-created__link"
            href={questionPaperUrl(createdExam.exam_id)}
            target="_blank"
            rel="noreferrer"
          >
            Open question paper PDF
          </a>
          <a
            className="secondary-button exam-created__link"
            href={answerSheetUrl(createdExam.template_type)}
            target="_blank"
            rel="noreferrer"
          >
            Download blank answer sheet PDF
          </a>
        </div>
        <p className="panel-subtext">
          Go to the <strong>Grade</strong> tab — this exam will now show up in the dropdown there.
        </p>
        <button className="secondary-button" onClick={() => setCreatedExam(null)}>
          Create another exam
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="exam-builder">
      <div className="exam-builder__header-fields">
        <fieldset className="field template-picker">
          <legend className="field-label">Answer sheet layout</legend>
          <div className="template-picker__options">
            {allTemplates.map((t) => (
              <label key={t.type} className="template-picker__option">
                <input
                  type="radio"
                  name="template-type"
                  checked={templateType === t.type}
                  onChange={() => setTemplateType(t.type)}
                />
                {t.label}
              </label>
            ))}
          </div>
          <span className="field-hint">
            Changing this resets the question list below to match the new layout.
          </span>
        </fieldset>

        <label className="field">
          <span className="field-label">Exam ID</span>
          <input
            type="text"
            value={examId}
            onChange={(e) => setExamId(e.target.value)}
            placeholder="CSC301_test1_2026"
            required
          />
          <span className="field-hint">No spaces — used as a filename internally.</span>
        </label>
        <label className="field">
          <span className="field-label">Course code</span>
          <input type="text" value={courseCode} onChange={(e) => setCourseCode(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Course title</span>
          <input type="text" value={courseTitle} onChange={(e) => setCourseTitle(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Instructions</span>
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} />
        </label>
        <div className="exam-builder__score-row">
          <label className="field field--narrow">
            <span className="field-label">MCQ points</span>
            <input type="number" step="0.5" value={maxScoreMcq} onChange={(e) => setMaxScoreMcq(e.target.value)} />
          </label>
          <label className="field field--narrow">
            <span className="field-label">Phrase points</span>
            <input type="number" step="0.5" value={maxScorePhrase} onChange={(e) => setMaxScorePhrase(e.target.value)} />
          </label>
          <label className="field field--narrow">
            <span className="field-label">Confidence threshold</span>
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={confidenceThreshold}
              onChange={(e) => setConfidenceThreshold(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="exam-builder__questions">
        {[...activeTemplate.questions]
          .sort((a, b) => naturalOrder(a.id) - naturalOrder(b.id))
          .map((tq) => {
            const q = questions[tq.id];
            if (!q) return null;
            const number = naturalOrder(tq.id);
            return (
              <div key={tq.id} className="question-editor">
                <div className="question-editor__header">
                  <span className="question-editor__number">Q{number}</span>
                  <span className="question-editor__type">
                    {tq.type === "mcq" ? "Multiple choice" : "Short phrase"}
                  </span>
                </div>

                <label className="field">
                  <span className="field-label">Question text</span>
                  <textarea
                    value={q.text}
                    onChange={(e) => updateQuestion(tq.id, { text: e.target.value })}
                    rows={2}
                    required
                  />
                </label>

                {tq.type === "mcq" ? (
                  <div className="question-editor__options">
                    {["A", "B", "C", "D"].map((letter) => (
                      <label key={letter} className="field question-editor__option">
                        <span className="field-label">
                          <input
                            type="radio"
                            name={`correct-${tq.id}`}
                            checked={q.correct === letter}
                            onChange={() => updateQuestion(tq.id, { correct: letter })}
                          />{" "}
                          Option {letter}
                          {q.correct === letter && (
                            <span className="question-editor__correct-badge">correct</span>
                          )}
                        </span>
                        <input
                          type="text"
                          value={q.options[letter]}
                          onChange={(e) => updateOption(tq.id, letter, e.target.value)}
                          required
                        />
                      </label>
                    ))}
                  </div>
                ) : (
                  <label className="field">
                    <span className="field-label">Acceptable answers (comma-separated)</span>
                    <input
                      type="text"
                      value={q.acceptableAnswersRaw}
                      onChange={(e) => updateQuestion(tq.id, { acceptableAnswersRaw: e.target.value })}
                      placeholder="hash table, hashtable, hash map"
                      required
                    />
                  </label>
                )}
              </div>
            );
          })}
      </div>

      {submitError && <p className="panel-notice panel-notice--error">{submitError}</p>}

      <button type="submit" className="submit-button" disabled={submitting}>
        {submitting ? "Creating…" : "Create exam"}
      </button>
    </form>
  );
}
