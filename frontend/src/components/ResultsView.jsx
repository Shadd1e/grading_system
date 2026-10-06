import QuestionBox from "./QuestionBox.jsx";

export default function ResultsView({ result, error, isLoading, onReview }) {
  if (isLoading) {
    return (
      <section className="results-panel">
        <div className="empty-state">
          <p>Reading the script and grading each answer…</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="results-panel">
        <div className="empty-state empty-state--error">
          <p className="empty-state__title">Grading failed</p>
          <p>{error}</p>
        </div>
      </section>
    );
  }

  if (!result) {
    return (
      <section className="results-panel">
        <div className="empty-state">
          <p className="empty-state__title">No script graded yet</p>
          <p>Upload a scanned answer sheet on the left to see results here.</p>
        </div>
      </section>
    );
  }

  const percentage =
    result.max_possible_score > 0
      ? Math.round((result.total_score / result.max_possible_score) * 100)
      : 0;

  return (
    <section className="results-panel">
      <div className="results-summary">
        <div>
          <span className="results-summary__label">
            {result.student_id ? `Student ${result.student_id}` : result.result_id}
          </span>
          <div className="results-summary__score">
            {result.total_score} <span className="results-summary__of">/ {result.max_possible_score}</span>
            <span className="results-summary__pct">({percentage}%)</span>
          </div>
        </div>
        {result.pending_review_count > 0 && (
          <div className="results-summary__pending">
            {result.pending_review_count} question{result.pending_review_count !== 1 ? "s" : ""} awaiting review
          </div>
        )}
      </div>

      <div className="answer-card-list">
        {result.questions.map((q) => (
          <QuestionBox key={q.question_id} question={q} onReview={onReview} />
        ))}
      </div>
    </section>
  );
}
