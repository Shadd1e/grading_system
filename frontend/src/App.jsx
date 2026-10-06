import { useState, useEffect, useCallback } from "react";
import UploadForm from "./components/UploadForm.jsx";
import ResultsView from "./components/ResultsView.jsx";
import ExamBuilder from "./components/ExamBuilder.jsx";
import ResultsHistory from "./components/ResultsHistory.jsx";
import { getHealth, gradeScript, reviewQuestion } from "./api.js";
import "./App.css";

const TABS = [
  { id: "grade", label: "Grade" },
  { id: "exams", label: "Exams" },
  { id: "history", label: "History" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("grade");
  const [health, setHealth] = useState(null);
  const [mlHealth, setMlHealth] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const checkHealth = useCallback(async () => {
    try {
      const data = await getHealth();
      setHealth(true);
      setMlHealth(data.ml_service || null);
    } catch {
      setHealth(false);
      setMlHealth(null);
    }
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  async function handleSubmit({ file, examId, studentId }) {
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await gradeScript({ file, examId, studentId });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleReview(questionId, correctedScore, correctedText) {
    const updated = await reviewQuestion(result.result_id, questionId, correctedScore, correctedText);
    setResult(updated);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">Grading Assistant</h1>
        <StatusPill health={health} mlHealth={mlHealth} onRetry={checkHealth} />
      </header>

      <nav className="app-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`app-tab ${activeTab === tab.id ? "app-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {activeTab === "grade" && (
          <>
            <UploadForm onSubmit={handleSubmit} isLoading={isLoading} />
            <ResultsView
              result={result}
              error={error}
              isLoading={isLoading}
              onReview={result ? handleReview : null}
            />
          </>
        )}
        {activeTab === "exams" && (
          <div className="app-main__full">
            <ExamBuilder />
          </div>
        )}
        {activeTab === "history" && (
          <div className="app-main__full">
            <ResultsHistory />
          </div>
        )}
      </main>
    </div>
  );
}

function StatusPill({ health, mlHealth, onRetry }) {
  if (health === null) {
    return <span className="status-pill status-pill--checking">Checking connection…</span>;
  }
  if (health === false) {
    return (
      <button className="status-pill status-pill--down" onClick={onRetry}>
        Backend unreachable — retry
      </button>
    );
  }
  if (!mlHealth?.mcq_model_loaded) {
    return (
      <button className="status-pill status-pill--down" onClick={onRetry}>
        ML service reachable, but MCQ model not loaded — retry
      </button>
    );
  }
  const phraseNote = mlHealth.phrase_model_loaded ? "" : " (phrase model not trained yet)";
  return <span className="status-pill status-pill--up">Connected{phraseNote}</span>;
}
