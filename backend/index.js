require("dotenv").config();

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 4000;
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://127.0.0.1:8000";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_URL = process.env.DEEPSEEK_URL || "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));

function mlHeaders(extra = {}) {
  return process.env.ML_SERVICE_API_KEY
    ? { ...extra, "x-ml-service-key": process.env.ML_SERVICE_API_KEY }
    : extra;
}

async function mlJson(method, path, body) {
  const response = await fetch(`${ML_SERVICE_URL}${path}`, {
    method,
    headers: mlHeaders(body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { detail: text }; }
  return { response, data };
}

async function mlBinary(path) {
  return fetch(`${ML_SERVICE_URL}${path}`, { headers: mlHeaders() });
}

function normalizeQuestion(q, index) {
  const type = q.type === "short_phrase" || q.type === "phrase" ? "completion" : (q.type || "completion");
  const acceptable = Array.isArray(q.acceptable_answers)
    ? q.acceptable_answers
    : (q.acceptableAnswersRaw ? q.acceptableAnswersRaw.split(",").map(s => s.trim()).filter(Boolean) : []);
  return {
    id: q.id || q.question_id || `q${index + 1}`,
    type,
    text: q.text || q.question || q.question_text || "",
    options: q.options || {},
    correct: q.correct || q.answer || null,
    acceptable_answers: acceptable,
    expected_answer: q.expected_answer || q.answer || acceptable.join(" | ") || null,
    points: Number(q.points ?? q.max_score ?? q.marks ?? 0),
    context_enabled: Boolean(q.context_enabled ?? q.use_context ?? false),
    context: q.context || q.context_text || "",
  };
}

function normalizeExamPayload(payload) {
  const exam = payload?.exam || payload || {};
  const rawQuestions = exam.questions || payload?.questions || {};
  const questions = Array.isArray(rawQuestions)
    ? rawQuestions.map(normalizeQuestion)
    : Object.entries(rawQuestions).map(([id, q], index) => normalizeQuestion({ ...q, id }, index));
  const normalized = {
    exam_id: exam.exam_id || exam.id || null,
    title: exam.title || exam.name || "Untitled examination",
    course_code: exam.course_code || "",
    course_title: exam.course_title || exam.title || exam.name || "",
    instructions: exam.instructions || "",
    template_type: exam.template_type || exam.template || "mixed",
    context_mode: exam.context_mode || "off",
    max_score_mcq: Number(exam.max_score_mcq ?? 0),
    max_score_phrase: Number(exam.max_score_phrase ?? 0),
    confidence_threshold: Number(exam.confidence_threshold ?? 0.75),
    questions: Object.fromEntries(questions.map(q => [q.id, q])),
  };
  return normalized;
}

async function saveExamToSupabase(payload) {
  const normalized = normalizeExamPayload(payload);
  if (!normalized.exam_id) throw new Error("Exam ID is required");

  const { data: exam, error } = await supabase
    .from("exams")
    .upsert({
      external_id: normalized.exam_id,
      title: normalized.title,
      description: normalized.course_title || null,
      template_type: normalized.template_type,
      context_mode: normalized.context_mode,
      content: normalized,
      created_by: payload.created_by || null,
    }, { onConflict: "external_id" })
    .select("*")
    .single();
  if (error) throw error;

  const questions = Object.values(normalized.questions);
  await supabase.from("questions").delete().eq("exam_id", exam.id);
  if (questions.length) {
    const rows = questions.map((q, index) => ({
      exam_id: exam.id,
      external_id: q.id,
      question_number: index + 1,
      question_text: q.text,
      type: q.type,
      points: q.points,
      expected_answer: q.expected_answer,
      context_enabled: q.context_enabled,
      context_text: q.context,
      options: q.options,
    }));
    const { error: questionError } = await supabase.from("questions").insert(rows);
    if (questionError) throw questionError;
  }
  return exam;
}

function cleanText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function levenshtein(a, b) {
  a = cleanText(a); b = cleanText(b);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        cur[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

function similarity(a, b) {
  const aa = cleanText(a), bb = cleanText(b);
  if (!aa || !bb) return 0;
  return Math.max(0, 1 - levenshtein(aa, bb) / Math.max(aa.length, bb.length));
}

function baselineGrade(question, answer, recognitionConfidence, threshold) {
  const points = Number(question.points || 0);
  if (question.type === "mcq") {
    const correct = cleanText(question.correct);
    const recognized = cleanText(answer);
    const correctAnswer = recognized === correct;
    return {
      score: correctAnswer && recognitionConfidence >= threshold ? points : 0,
      confidence: recognitionConfidence,
      uncertain: recognitionConfidence < threshold,
      unrelated: !correctAnswer,
      reason: correctAnswer ? "MCQ answer matches" : "MCQ answer does not match",
    };
  }

  const acceptable = question.acceptable_answers?.length
    ? question.acceptable_answers
    : [question.expected_answer].filter(Boolean);
  const best = acceptable.reduce((max, item) => Math.max(max, similarity(answer, item)), 0);
  const score = best >= 0.85 ? points : best >= 0.6 ? points * 0.5 : 0;
  return {
    score,
    confidence: recognitionConfidence,
    uncertain: recognitionConfidence < threshold || (best >= 0.45 && best < 0.85),
    unrelated: best < 0.45,
    reason: `Baseline similarity ${best.toFixed(2)}`,
  };
}

async function deepSeekGrade(question, studentAnswer) {
  if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is required for Context grading");
  const points = Number(question.points || 0);
  const prompt = [
    "You are an examination grading assistant.",
    "Do not use the internet or outside knowledge.",
    "Judge the student's response ONLY against the lecturer-provided question, expected answer, and context below.",
    "Return JSON only with verdict, score, and feedback.",
    `Maximum score: ${points}`,
    `Question: ${question.text}`,
    `Lecturer expected answer: ${question.expected_answer || "Not supplied"}`,
    `Lecturer context: ${question.context || "Not supplied"}`,
    `Student response: ${studentAnswer}`,
    "verdict must be exactly one of: accepted, uncertain, unrelated.",
    "accepted means the response answers the question adequately; unrelated means it does not answer the question; uncertain means lecturer review is needed.",
    "score must be a number from 0 to the maximum score.",
  ].join("\n\n");

  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: "You grade only from supplied examination context. Never browse or invent facts." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `DeepSeek request failed (${response.status})`);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned no grading content");
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  const verdict = ["accepted", "uncertain", "unrelated"].includes(parsed.verdict) ? parsed.verdict : "uncertain";
  const score = Math.max(0, Math.min(points, Number(parsed.score) || 0));
  return { verdict, score, feedback: String(parsed.feedback || "") };
}

async function gradeRecognizedAnswers(exam, recognized) {
  const questions = exam.content?.questions || {};
  const threshold = Number(exam.content?.confidence_threshold ?? 0.75);
  const mode = exam.context_mode || exam.content?.context_mode || "off";
  const results = [];

  for (const item of recognized.answers || []) {
    const q = questions[item.question_id];
    if (!q) continue;
    const baseline = baselineGrade(q, item.recognized_text, Number(item.recognition_confidence || 0), threshold);
    let finalScore = baseline.score;
    let flagged = baseline.uncertain;
    let deepseek = null;

    const eligible = q.type !== "mcq" && Boolean(q.context_enabled);
    const shouldUseContext = eligible && mode === "all" || eligible && mode === "necessary" && baseline.uncertain;
    if (shouldUseContext) {
      deepseek = await deepSeekGrade(q, item.recognized_text);
      finalScore = deepseek.score;
      flagged = deepseek.verdict === "uncertain" || baseline.uncertain;
    }

    const recognizedText = String(item.recognized_text ?? "").trim();
    const selectedOption = q.type === "mcq" ? (recognizedText.match(/\b[A-D]\b/i)?.[0]?.toUpperCase() || recognizedText) : null;
    const selectedOptionText = q.type === "mcq" && selectedOption && q.options && typeof q.options === "object"
      ? (Array.isArray(q.options) ? q.options["ABCD".indexOf(selectedOption)] : q.options[selectedOption])
      : null;

    results.push({
      question_id: item.question_id,
      type: q.type,
      question: {
        id: q.id || item.question_id,
        number: q.question_number ?? null,
        text: q.text || q.question || q.question_text || "",
        type: q.type,
        options: q.options || {},
        expected_answer: q.expected_answer || q.correct || q.answer || null,
        points: Number(q.points || 0),
        context: q.context || q.context_text || "",
      },
      recognized_text: recognizedText,
      selected_option: selectedOption,
      selected_option_text: selectedOptionText || null,
      recognition_confidence: Number(item.recognition_confidence || 0),
      score: finalScore,
      suggested_score: finalScore,
      final_score: flagged ? null : finalScore,
      max_score: Number(q.points || 0),
      flagged_for_review: flagged,
      review_required: flagged,
      reviewed: false,
      deepseek_used: Boolean(deepseek),
      deepseek_verdict: deepseek?.verdict || null,
      feedback: deepseek?.feedback || baseline.reason,
    });
  }

  const totalScore = results.reduce((sum, r) => sum + Number(r.final_score ?? r.suggested_score ?? 0), 0);
  const maxScore = Object.values(questions).reduce((sum, q) => sum + Number(q.points || 0), 0);
  return {
    result_id: `result_${Date.now()}`,
    exam_id: exam.external_id,
    student_id: recognized.student_id || null,
    total_score: totalScore,
    max_score: maxScore,
    pending_review_count: results.filter(r => r.flagged_for_review).length,
    questions: results,
  };
}

async function saveResultToSupabase(result) {
  const { data: exam } = await supabase.from("exams").select("id").eq("external_id", result.exam_id).maybeSingle();
  let studentId = null;
  if (result.student_id) {
    const { data: student, error } = await supabase.from("students")
      .upsert({ external_id: String(result.student_id) }, { onConflict: "external_id" })
      .select("id").single();
    if (error) throw error;
    studentId = student.id;
  }

  const { data: saved, error } = await supabase.from("grading_results").upsert({
    external_id: result.result_id,
    exam_id: exam?.id || null,
    student_id: studentId,
    student_external_id: result.student_id ? String(result.student_id) : null,
    total_score: result.total_score,
    max_score: result.max_score,
    pending_review_count: result.pending_review_count,
    payload: result,
  }, { onConflict: "external_id" }).select("*").single();
  if (error) throw error;

  await supabase.from("grading_result_items").delete().eq("result_id", saved.id);
  const rows = (result.questions || []).map(q => ({
    result_id: saved.id,
    question_external_id: q.question_id,
    recognized_text: q.recognized_text,
    recognition_confidence: q.recognition_confidence,
    suggested_score: q.suggested_score,
    final_score: q.final_score,
    max_score: q.max_score,
    flagged_for_review: Boolean(q.flagged_for_review),
    reviewed: Boolean(q.reviewed),
    notes: q.feedback || null,
    payload: q,
  }));
  if (rows.length) {
    const { error: itemError } = await supabase.from("grading_result_items").insert(rows);
    if (itemError) throw itemError;
  }
  return saved;
}

app.get("/api/health", async (req, res) => {
  try {
    const { response, data } = await mlJson("GET", "/health");
    const { error } = await supabase.from("exams").select("id", { count: "exact", head: true });
    res.status(response.ok && !error ? 200 : 503).json({
      backend_status: "ok",
      supabase_reachable: !error,
      ml_service_reachable: response.ok,
      ml_service: data,
      supabase_error: error?.message || null,
      deepseek_configured: Boolean(DEEPSEEK_API_KEY),
    });
  } catch (err) {
    res.status(503).json({ backend_status: "ok", supabase_reachable: false, ml_service_reachable: false, error: err.message });
  }
});

app.get("/api/templates", async (req, res) => {
  try {
    const { response, data } = await mlJson("GET", "/templates");
    res.status(response.status).json(data);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

app.post("/api/exams", async (req, res) => {
  try {
    const normalized = normalizeExamPayload(req.body);
    const { response, data } = await mlJson("GET", "/templates");
    if (!response.ok) return res.status(502).json({ error: "ML template service unavailable", details: data });
    const template = data.find(t => t.type === normalized.template_type);
    if (!template) return res.status(400).json({ error: `Unknown template type: ${normalized.template_type}` });

    const templateIds = template.questions.map(q => q.id);
    const examIds = Object.keys(normalized.questions);
    if (templateIds.length !== examIds.length || templateIds.some(id => !normalized.questions[id])) {
      return res.status(422).json({ error: "Exam questions do not match the selected answer-sheet template", expected_questions: templateIds, received_questions: examIds });
    }
    const saved = await saveExamToSupabase(normalized);
    res.status(201).json({ ...normalized, persistence: { provider: "supabase", id: saved.id } });
  } catch (err) { res.status(500).json({ error: "Exam creation failed", details: err.message }); }
});

app.get("/api/exams", async (req, res) => {
  try {
    const { data, error } = await supabase.from("exams").select("*, questions(*)").order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: "Failed to load exams", details: err.message }); }
});

app.get("/api/exams/:examId", async (req, res) => {
  try {
    const { data, error } = await supabase.from("exams").select("*, questions(*)").eq("external_id", req.params.examId).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Exam not found" });
    res.json(data);
  } catch (err) { res.status(500).json({ error: "Failed to load exam", details: err.message }); }
});

app.get("/api/exams/:examId/question-paper.pdf", async (req, res) => {
  try {
    const { data: exam, error } = await supabase.from("exams").select("content").eq("external_id", req.params.examId).maybeSingle();
    if (error) throw error;
    if (!exam) return res.status(404).json({ error: "Exam not found" });
    const mlResponse = await fetch(`${ML_SERVICE_URL}/render-question-paper.pdf`, { method: "POST", headers: mlHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(exam.content) });
    if (!mlResponse.ok) return res.status(mlResponse.status).json(await mlResponse.json());
    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from(await mlResponse.arrayBuffer()));
  } catch (err) { res.status(502).json({ error: err.message }); }
});

app.get("/api/answer-sheets/:templateType", async (req, res) => {
  try {
    const mlResponse = await mlBinary(`/answer-sheets/${encodeURIComponent(req.params.templateType)}.pdf`);
    if (!mlResponse.ok) return res.status(mlResponse.status).json(await mlResponse.json());
    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from(await mlResponse.arrayBuffer()));
  } catch (err) { res.status(502).json({ error: err.message }); }
});

app.post("/api/grade-script", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded. Expected a form field named 'file'." });
  const { exam_id, student_id } = req.body;
  if (!exam_id) return res.status(400).json({ error: "exam_id is required" });

  try {
    const { data: exam, error } = await supabase.from("exams").select("*").eq("external_id", exam_id).maybeSingle();
    if (error) throw error;
    if (!exam) return res.status(404).json({ error: "Exam not found" });

    const forwardForm = new FormData();
    forwardForm.append("file", new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
    forwardForm.append("template_type", exam.template_type || exam.content?.template_type || "mixed");
    forwardForm.append("exam_id", exam_id);
    if (student_id) forwardForm.append("student_id", student_id);

    const mlResponse = await fetch(`${ML_SERVICE_URL}/recognize-script`, { method: "POST", headers: mlHeaders(), body: forwardForm });
    const recognized = await mlResponse.json();
    if (!mlResponse.ok) return res.status(mlResponse.status).json(recognized);

    const result = await gradeRecognizedAnswers(exam, recognized);
    await saveResultToSupabase(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Grading failed", details: err.message });
  }
});

app.get("/api/results", async (req, res) => {
  try {
    const { data, error } = await supabase.from("grading_results").select("*, grading_result_items(*)").order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: "Failed to load results", details: err.message }); }
});

async function enrichResultWithQuestions(result) {
  let questions = [];
  if (result.exam_id) {
    const { data: questionRows, error: questionError } = await supabase
      .from("questions")
      .select("*")
      .eq("exam_id", result.exam_id)
      .order("question_number", { ascending: true });
    if (questionError) throw questionError;
    questions = questionRows || [];
  }

  const questionMap = new Map(
    questions.map(q => [String(q.external_id || q.id), q])
  );

  const enrichedItems = (result.grading_result_items || []).map(item => {
    const snapshot = item.payload?.question || item.payload?.question_snapshot || null;
    const source = snapshot || questionMap.get(String(item.question_external_id)) || null;

    return {
      ...item,
      question: source ? {
        id: source.external_id || source.id,
        number: source.question_number ?? null,
        text: source.question_text || source.text || "",
        type: source.type,
        options: source.options || {},
        expected_answer: source.expected_answer || null,
        points: Number(source.points || item.max_score || 0),
        context_enabled: Boolean(source.context_enabled),
        context_text: source.context_text || "",
      } : null,
    };
  });

  return {
    ...result,
    grading_result_items: enrichedItems,
    questions: enrichedItems,
  };
}

app.get("/api/results/:resultId", async (req, res) => {
  try {
    const { data: result, error } = await supabase
      .from("grading_results")
      .select("*, grading_result_items(*)")
      .eq("external_id", req.params.resultId)
      .maybeSingle();
    if (error) throw error;
    if (!result) return res.status(404).json({ error: "Result not found" });
    res.json(await enrichResultWithQuestions(result));
  } catch (err) {
    res.status(500).json({ error: "Failed to load result", details: err.message });
  }
});

app.post("/api/results/:resultId/review", async (req, res) => {
  try {
    const { question_id, corrected_score, corrected_text, note, reviewer_id } = req.body;
    const { data: result, error: resultError } = await supabase.from("grading_results").select("id, payload").eq("external_id", req.params.resultId).maybeSingle();
    if (resultError) throw resultError;
    if (!result) return res.status(404).json({ error: "Result not found" });

    const { data: item, error: itemError } = await supabase.from("grading_result_items")
      .select("*").eq("result_id", result.id).eq("question_external_id", question_id).maybeSingle();
    if (itemError) throw itemError;
    if (!item) return res.status(404).json({ error: "Result item not found" });

    const finalScore = Number(corrected_score ?? item.suggested_score ?? 0);
    const { error: updateError } = await supabase.from("grading_result_items").update({
      final_score: finalScore,
      reviewed: true,
      flagged_for_review: false,
      recognized_text: corrected_text ?? item.recognized_text,
      notes: note || item.notes,
      updated_at: new Date().toISOString(),
    }).eq("id", item.id);
    if (updateError) throw updateError;

    await supabase.from("review_actions").insert({
      result_item_id: item.id,
      reviewer_id: reviewer_id || null,
      corrected_score: finalScore,
      corrected_text: corrected_text || null,
      note: note || null,
    });

    const { data: items, error: itemsError } = await supabase.from("grading_result_items").select("final_score, suggested_score, flagged_for_review, reviewed, max_score").eq("result_id", result.id);
    if (itemsError) throw itemsError;
    const total = items.reduce((sum, x) => sum + Number(x.final_score ?? x.suggested_score ?? 0), 0);
    const pending = items.filter(x => x.flagged_for_review && !x.reviewed).length;
    await supabase.from("grading_results").update({ total_score: total, pending_review_count: pending, updated_at: new Date().toISOString() }).eq("id", result.id);

    const { data: updated } = await supabase
      .from("grading_results")
      .select("*, grading_result_items(*)")
      .eq("id", result.id)
      .single();
    res.json(await enrichResultWithQuestions(updated));
  } catch (err) { res.status(500).json({ error: "Review update failed", details: err.message }); }
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(`ML service: ${ML_SERVICE_URL}`);
  console.log(`Supabase: ${SUPABASE_URL}`);
});
