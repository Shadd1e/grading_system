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

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

app.use(cors());
app.use(express.json({ limit: "5mb" }));

function mlHeaders(extra = {}) {
  return process.env.ML_SERVICE_API_KEY
    ? { ...extra, Authorization: `Bearer ${process.env.ML_SERVICE_API_KEY}` }
    : extra;
}

async function mlJson(method, path, body) {
  const response = await fetch(`${ML_SERVICE_URL}${path}`, {
    method,
    headers: mlHeaders(body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  return { response, data };
}

async function mlBinary(path) {
  return fetch(`${ML_SERVICE_URL}${path}`, { headers: mlHeaders() });
}

function normalizeExamPayload(payload) {
  const exam = payload?.exam || payload || {};
  return {
    external_id: exam.id || exam.exam_id || null,
    title: exam.title || exam.name || "Untitled examination",
    description: exam.description || null,
    template_type: exam.template_type || exam.template || null,
    context_mode: exam.context_mode || "off",
    content: payload || {},
    created_by: exam.created_by || null,
  };
}

function extractQuestions(payload) {
  const exam = payload?.exam || payload || {};
  return Array.isArray(exam.questions) ? exam.questions : Array.isArray(payload?.questions) ? payload.questions : [];
}

async function saveExamToSupabase(payload) {
  const normalized = normalizeExamPayload(payload);
  const { data: exam, error } = await supabase
    .from("exams")
    .upsert(normalized, { onConflict: "external_id" })
    .select("*")
    .single();
  if (error) throw error;

  const questions = extractQuestions(payload);
  if (questions.length) {
    const rows = questions.map((q, index) => ({
      exam_id: exam.id,
      external_id: q.id || q.question_id || null,
      question_number: q.question_number ?? q.number ?? index + 1,
      question_text: q.question || q.question_text || q.text || null,
      type: q.type === "short_phrase" ? "completion" : (q.type || "completion"),
      points: q.max_score ?? q.points ?? q.marks ?? 0,
      expected_answer: q.expected_answer || q.answer || (Array.isArray(q.acceptable_answers) ? q.acceptable_answers.join(" | ") : null),
      context_enabled: Boolean(q.context_enabled ?? q.use_context ?? false),
      context_text: q.context || q.context_text || null,
      options: q.options || [],
    }));
    const { error: questionError } = await supabase
      .from("questions")
      .upsert(rows, { onConflict: "exam_id,question_number" });
    if (questionError) throw questionError;
  }

  return exam;
}

async function saveResultToSupabase(result) {
  const examExternalId = result.exam_id || result.examId || result.exam?.id || null;
  const studentExternalId = result.student_id || result.studentId || null;
  let examId = null;

  if (examExternalId) {
    const { data: exam } = await supabase.from("exams").select("id").eq("external_id", examExternalId).maybeSingle();
    examId = exam?.id || null;
  }

  let studentId = null;
  if (studentExternalId) {
    const { data: student, error } = await supabase
      .from("students")
      .upsert({ external_id: String(studentExternalId) }, { onConflict: "external_id" })
      .select("id")
      .single();
    if (error) throw error;
    studentId = student.id;
  }

  const { data: saved, error } = await supabase
    .from("grading_results")
    .upsert({
      external_id: result.result_id || result.id || null,
      exam_id: examId,
      student_id: studentId,
      student_external_id: studentExternalId ? String(studentExternalId) : null,
      total_score: result.total_score ?? null,
      max_score: result.max_score ?? result.maximum_score ?? null,
      pending_review_count: result.pending_review_count ?? result.pending_reviews ?? 0,
      payload: result,
    }, { onConflict: "external_id" })
    .select("*")
    .single();
  if (error) throw error;

  const items = Array.isArray(result.questions) ? result.questions : [];
  if (items.length) {
    const rows = items.map((q) => ({
      result_id: saved.id,
      question_external_id: q.question_id || q.id || q.question_number?.toString() || null,
      recognized_text: q.recognized_text ?? q.recognised_text ?? null,
      recognition_confidence: q.confidence ?? q.recognition_confidence ?? null,
      suggested_score: q.score ?? q.suggested_score ?? null,
      final_score: q.final_score ?? null,
      max_score: q.max_score ?? q.maximum_score ?? null,
      flagged_for_review: Boolean(q.flagged_for_review ?? q.review_required ?? false),
      reviewed: Boolean(q.reviewed),
      notes: q.notes || null,
      payload: q,
    }));
    await supabase.from("grading_result_items").delete().eq("result_id", saved.id);
    const { error: itemError } = await supabase.from("grading_result_items").insert(rows);
    if (itemError) throw itemError;
  }

  return saved;
}

// Health: backend + ML + Supabase.
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
    });
  } catch (err) {
    res.status(503).json({ backend_status: "ok", supabase_reachable: false, ml_service_reachable: false, error: err.message });
  }
});

app.get("/api/templates", async (req, res) => {
  try {
    const { response, data } = await mlJson("GET", "/templates");
    res.status(response.status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Create exam in ML first so question-paper generation remains compatible, then persist it in Supabase.
app.post("/api/exams", async (req, res) => {
  try {
    const { response, data } = await mlJson("POST", "/exams", req.body);
    if (!response.ok) return res.status(response.status).json(data);
    const saved = await saveExamToSupabase(data);
    res.status(201).json({ ...data, persistence: { provider: "supabase", id: saved.id } });
  } catch (err) {
    res.status(500).json({ error: "Exam creation failed", details: err.message });
  }
});

app.get("/api/exams", async (req, res) => {
  try {
    const { data, error } = await supabase.from("exams").select("*, questions(*)").order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to load exams", details: err.message });
  }
});

app.get("/api/exams/:examId", async (req, res) => {
  try {
    const { data, error } = await supabase.from("exams").select("*, questions(*)").eq("external_id", req.params.examId).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Exam not found" });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to load exam", details: err.message });
  }
});

app.get("/api/exams/:examId/question-paper.pdf", async (req, res) => {
  try {
    const mlResponse = await mlBinary(`/exams/${encodeURIComponent(req.params.examId)}/question-paper.pdf`);
    if (!mlResponse.ok) return res.status(mlResponse.status).json(await mlResponse.json());
    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from(await mlResponse.arrayBuffer()));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/answer-sheets/:templateType", async (req, res) => {
  try {
    const mlResponse = await mlBinary(`/answer-sheets/${encodeURIComponent(req.params.templateType)}.pdf`);
    if (!mlResponse.ok) return res.status(mlResponse.status).json(await mlResponse.json());
    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from(await mlResponse.arrayBuffer()));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/grade-script", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded. Expected a form field named 'file'." });
  const { exam_id, answer_key_path, student_id } = req.body;
  if (!exam_id && !answer_key_path) return res.status(400).json({ error: "Provide either 'exam_id' or 'answer_key_path'." });

  try {
    const forwardForm = new FormData();
    forwardForm.append("file", new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
    if (exam_id) forwardForm.append("exam_id", exam_id);
    if (answer_key_path) forwardForm.append("answer_key_path", answer_key_path);
    if (student_id) forwardForm.append("student_id", student_id);

    const mlResponse = await fetch(`${ML_SERVICE_URL}/grade-script`, { method: "POST", headers: mlHeaders(), body: forwardForm });
    const result = await mlResponse.json();
    if (!mlResponse.ok) return res.status(mlResponse.status).json(result);

    await saveResultToSupabase(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Grading completed/failed before persistence could be confirmed", details: err.message });
  }
});

app.get("/api/results", async (req, res) => {
  try {
    const { data, error } = await supabase.from("grading_results").select("*, grading_result_items(*)").order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to load results", details: err.message });
  }
});

app.get("/api/results/:resultId", async (req, res) => {
  try {
    const { data, error } = await supabase.from("grading_results").select("*, grading_result_items(*)").eq("external_id", req.params.resultId).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Result not found" });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to load result", details: err.message });
  }
});

app.post("/api/results/:resultId/review", async (req, res) => {
  try {
    // Keep the existing ML review endpoint in sync while Supabase remains the permanent store.
    const { response, data } = await mlJson("POST", `/results/${encodeURIComponent(req.params.resultId)}/review`, req.body);
    if (!response.ok) return res.status(response.status).json(data);
    await saveResultToSupabase(data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Review update failed", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(`ML service: ${ML_SERVICE_URL}`);
  console.log(`Supabase: ${SUPABASE_URL}`);
});
