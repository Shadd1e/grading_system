import QuestionBox from "./QuestionBox.jsx";
import { normalizeResult } from "../api.js";
export default function ResultsView({ result, error, isLoading, onReview }) {
 if(isLoading)return <section className="results-panel"><div className="empty-state"><p className="empty-state__title">Reading and grading the script</p><p>Recognition, confidence checks and scoring are running.</p></div></section>;
 if(error)return <section className="results-panel"><div className="empty-state empty-state--error"><p className="empty-state__title">Grading could not be completed</p><p>{error}</p></div></section>;
 if(!result)return <section className="results-panel"><div className="empty-state"><p className="empty-state__title">Ready for a script</p><p>Upload an answer sheet to see recognition, scores and review decisions here.</p></div></section>;
 const r=normalizeResult(result), pct=r.max_possible_score?Math.round(r.total_score/r.max_possible_score*100):0;
 return <section className="results-panel"><div className="results-summary"><div><span className="results-summary__label">{r.exam_id||"EXAMINATION"} · {r.student_id||"STUDENT NOT IDENTIFIED"}</span><div className="results-summary__score">{r.total_score}<span className="results-summary__of"> / {r.max_possible_score}</span><span className="results-summary__pct">{pct}%</span></div></div>{r.pending_review_count>0&&<div className="results-summary__pending">{r.pending_review_count} awaiting lecturer review</div>}</div><div className="answer-card-list">{r.questions.map(q=><QuestionBox key={q.question_id} question={q} onReview={onReview}/>)}</div></section>;
}
