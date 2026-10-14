import { useState } from "react";

function getStatus(q) {
  if (q.flagged_for_review && !q.reviewed) return "flagged";
  if (q.type === "mcq") return q.score >= q.max_score ? "correct" : "wrong";
  return q.max_score && q.score / q.max_score >= 0.8 ? "correct" : "wrong";
}

const labels = { correct: "Good", wrong: "Incorrect", flagged: "Needs review" };

function displayValue(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  if (typeof value === "object") return String(value.text ?? value.label ?? value.value ?? value.option ?? JSON.stringify(value));
  return String(value);
}

function optionEntries(options) {
  if (Array.isArray(options)) {
    return options.map((value, index) => [String.fromCharCode(65 + index), displayValue(value)]);
  }
  if (options && typeof options === "object") {
    return Object.entries(options).map(([key, value]) => [key, displayValue(value)]);
  }
  return [];
}

function normaliseOption(value) {
  return displayValue(value).trim().toLowerCase();
}

export default function QuestionBox({ question, onReview }) {
  const needsReview = Boolean(question.flagged_for_review && !question.reviewed);
  const status = question.reviewed ? "correct" : getStatus(question);
  const [open, setOpen] = useState(needsReview);
  const [score, setScore] = useState(question.final_score ?? question.score ?? 0);
  const [text, setText] = useState(question.recognized_text || "");
  const [saving, setSaving] = useState(false);

  const details = question.question || {};
  const options = optionEntries(details.options);
  const questionText = displayValue(details.text || question.question_text || "");
  const expected = displayValue(details.expected_answer || question.expected_answer || "");
  const studentAnswer = displayValue(question.recognized_text || "");
  const selectedOption = displayValue(question.selected_option || "");
  const selectedOptionText = displayValue(question.selected_option_text || "");
  const questionNumber = details.number ?? (String(question.question_id || "").replace(/^q/i, "") || "?");

  async function save() {
    setSaving(true);
    try {
      await onReview(question.question_id, Number(score), text);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`answer-card answer-card--${status} ${open ? "answer-card--open" : "answer-card--collapsed"}`}>
      <div className="answer-card__top">
        <div className="answer-card__meta">
          <span className="answer-card__number">Q{questionNumber}</span>
          <span className={`answer-card__tag answer-card__tag--${status}`}>
            {question.reviewed ? "Reviewed" : labels[status]}
          </span>
        </div>

        <div className="answer-card__top-main">
          <div className="answer-card__student-answer">
            <span>{question.type === "mcq" ? "Student choice" : "Student answer"}</span>
            <strong>
              {question.type === "mcq"
                ? (selectedOption ? `${selectedOption}${selectedOptionText ? ` — ${selectedOptionText}` : ""}` : studentAnswer || "(no answer recognized)")
                : (studentAnswer || "(no answer recognized)")}
            </strong>
          </div>
          <div className="answer-card__stats">
            <span className="answer-card__score">{question.final_score ?? question.score} / {question.max_score}</span>
            <span className="answer-card__confidence">
              recognition {(Number(question.confidence || 0) * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        <button type="button" className="answer-card__view" onClick={() => setOpen(value => !value)}>
          {open ? "Hide question" : "View question & options"}
        </button>
      </div>

      {open && (
        <div className="answer-card__details">
          <div className="answer-card__question">
            <span className="answer-card__detail-label">QUESTION</span>
            <p>{questionText || "(question not available)"}</p>
          </div>

          {options.length > 0 && (
            <div className="answer-card__options">
              <span className="answer-card__detail-label">OPTIONS</span>
              {options.map(([key, value]) => {
                const keyMatch = normaliseOption(selectedOption) === normaliseOption(key);
                const textMatch = normaliseOption(selectedOptionText) === normaliseOption(value);
                const legacyMatch = !selectedOption && normaliseOption(studentAnswer) === normaliseOption(key);
                const selected = keyMatch || textMatch || legacyMatch;
                const correct = normaliseOption(expected) === normaliseOption(key)
                  || normaliseOption(expected) === normaliseOption(value);

                return (
                  <div key={key} className={`answer-card__option ${selected ? "is-selected" : ""} ${correct ? "is-correct" : ""}`}>
                    <span className="answer-card__option-key">{key}</span>
                    <span>{value}</span>
                    {selected && <b>{correct ? "Student choice · Correct" : "Student choice · Wrong"}</b>}
                    {!selected && correct && <b>Correct answer</b>}
                  </div>
                );
              })}
            </div>
          )}

          <div className="answer-card__response">
            <span className="answer-card__detail-label">{question.type === "mcq" ? "STUDENT'S CHOSEN ANSWER" : "STUDENT'S ANSWER"}</span>
            <div>
              {question.type === "mcq"
                ? (selectedOption ? `${selectedOption}${selectedOptionText ? ` — ${selectedOptionText}` : ""}` : studentAnswer || "(no answer recognized)")
                : (studentAnswer || "(no answer recognized)")}
            </div>
          </div>

          {expected && (
            <div className="answer-card__expected">
              <span className="answer-card__detail-label">{options.length ? "CORRECT ANSWER" : "EXPECTED ANSWER"}</span>
              <div>{expected}</div>
            </div>
          )}

          {question.notes && !question.reviewed && <p className="answer-card__notes">{question.notes}</p>}

          {needsReview && onReview && (
            <div className="answer-card__review">
              <label className="answer-card__review-field">
                <span>Recognized answer / correction</span>
                <input value={text} onChange={e => setText(e.target.value)} />
              </label>
              <label className="answer-card__review-field">
                <span>Final score</span>
                <input type="number" step="0.5" min="0" max={question.max_score} value={score} onChange={e => setScore(e.target.value)} />
              </label>
              <button className="answer-card__review-confirm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Confirm review"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
