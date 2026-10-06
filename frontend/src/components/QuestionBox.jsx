import { useState } from "react";

function getStatus(question) {
  if (question.flagged_for_review) return "flagged";
  if (question.type === "mcq") {
    return question.score >= question.max_score ? "correct" : "wrong";
  }
  // Phrase questions are similarity-scored, not binary — treat a strong
  // match as "correct" and a weak one as "wrong" for the visual tag, while
  // the actual number still shows the real score either way.
  const ratio = question.max_score > 0 ? question.score / question.max_score : 0;
  return ratio >= 0.8 ? "correct" : "wrong";
}

const STATUS_LABEL = {
  correct: "Correct",
  wrong: "Incorrect",
  flagged: "Needs review",
};

export default function QuestionBox({ question, onReview }) {
  const status = question.reviewed ? "correct" : getStatus(question);
  const number = question.question_id.replace(/^q/i, "");
  const [scoreInput, setScoreInput] = useState(question.score);
  const [textInput, setTextInput] = useState(question.recognized_text);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    if (!onReview) return;
    setSubmitting(true);
    try {
      await onReview(question.question_id, Number(scoreInput), textInput);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`answer-card answer-card--${status}`}>
      <div className="answer-card__meta">
        <span className="answer-card__number">Q{number}</span>
        <span className={`answer-card__tag answer-card__tag--${status}`}>
          {question.reviewed ? "Reviewed" : STATUS_LABEL[status]}
        </span>
      </div>

      <div className="answer-card__paper">
        <span className="answer-card__recognized">
          {question.recognized_text || <em>(no answer recognized)</em>}
        </span>
      </div>

      <div className="answer-card__stats">
        <span className="answer-card__score">
          {question.final_score ?? question.score} / {question.max_score}
        </span>
        <span className="answer-card__confidence">
          confidence {(question.confidence * 100).toFixed(0)}%
        </span>
      </div>

      {question.notes && !question.reviewed && (
        <p className="answer-card__notes">{question.notes}</p>
      )}

      {question.flagged_for_review && !question.reviewed && onReview && (
        <div className="answer-card__review">
          <label className="answer-card__review-field">
            <span>Correct text</span>
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
            />
          </label>
          <label className="answer-card__review-field answer-card__review-field--narrow">
            <span>Score</span>
            <input
              type="number"
              step="0.5"
              min="0"
              max={question.max_score}
              value={scoreInput}
              onChange={(e) => setScoreInput(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="answer-card__review-confirm"
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting ? "Saving…" : "Confirm"}
          </button>
        </div>
      )}
    </div>
  );
}
