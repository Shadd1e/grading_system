import { useState, useEffect, useCallback } from "react";
import { listResults, getResult, reviewQuestion } from "../api.js";
import ResultsView from "./ResultsView.jsx";

export default function ResultsHistory() {
  const [summaries, setSummaries] = useState(null);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadSummaries = useCallback(async () => {
    try {
      const data = await listResults();
      setSummaries(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadSummaries();
  }, [loadSummaries]);

  async function openResult(resultId) {
    setSelectedId(resultId);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const data = await getResult(resultId);
      setDetail(data);
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleReview(questionId, correctedScore, correctedText) {
    const updated = await reviewQuestion(selectedId, questionId, correctedScore, correctedText);
    setDetail(updated);
    loadSummaries(); // refresh the list so the pending-review count stays accurate
  }

  if (error) {
    return (
      <div className="empty-state empty-state--error">
        <p className="empty-state__title">Couldn't load past results</p>
        <p>{error}</p>
      </div>
    );
  }

  if (!summaries) {
    return (
      <div className="empty-state">
        <p>Loading history…</p>
      </div>
    );
  }

  if (summaries.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state__title">No scripts graded yet</p>
        <p>Once you grade a script on the Grade tab, it'll show up here.</p>
      </div>
    );
  }

  return (
    <div className="history-layout">
      <div className="history-list">
        {summaries.map((s) => {
          const pct =
            s.max_possible_score > 0 ? Math.round((s.total_score / s.max_possible_score) * 100) : 0;
          return (
            <button
              key={s.result_id}
              className={`history-row ${selectedId === s.result_id ? "history-row--active" : ""}`}
              onClick={() => openResult(s.result_id)}
            >
              <div className="history-row__main">
                <span className="history-row__student">{s.student_id || s.result_id}</span>
                <span className="history-row__exam">{s.exam_id}</span>
              </div>
              <div className="history-row__meta">
                <span className="history-row__score">
                  {s.total_score}/{s.max_possible_score} ({pct}%)
                </span>
                {s.pending_review_count > 0 && (
                  <span className="history-row__pending">{s.pending_review_count} pending</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="history-detail">
        <ResultsView
          result={detail}
          error={detailError}
          isLoading={detailLoading}
          onReview={selectedId ? handleReview : null}
        />
      </div>
    </div>
  );
}
