"""FastAPI inference service for the handwriting recognition models.

The service deliberately does not own exams, results, lecturer settings, or
DeepSeek grading. Pxxl owns those concerns and calls this service for OCR.
"""
import os
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.preprocessing.segment import load_template, process_answer_sheet
from app.mcq_model.infer import load_recognizer as load_mcq_recognizer
from app.phrase_model.infer import load_recognizer as load_phrase_recognizer

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
TEMPLATES_DIR = DATA_DIR / "templates"
MCQ_CHECKPOINT = ROOT / "training" / "checkpoints" / "mcq_cnn.pt"
TROCR_CHECKPOINT = ROOT / "training" / "checkpoints" / "trocr_finetuned"

TEMPLATE_TYPES = ("mixed", "all_mcq", "all_completion")
API_KEY = os.getenv("ML_SERVICE_API_KEY", "").strip()

app = FastAPI(title="Handwriting Recognition ML Service", version="2.0.0")

# Browser CORS is only useful for local development. Production traffic should
# be Pxxl -> ML service server-to-server.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _load_templates():
    result = {}
    for template_type in TEMPLATE_TYPES:
        path = TEMPLATES_DIR / template_type / "template.json"
        if path.exists():
            result[template_type] = load_template(str(path))
    return result


templates = _load_templates()
mcq_recognizer = load_mcq_recognizer(str(MCQ_CHECKPOINT))
phrase_recognizer = load_phrase_recognizer(str(TROCR_CHECKPOINT))


class RecognitionAnswer(BaseModel):
    question_id: str
    type: str
    recognized_text: str
    recognition_confidence: float


class RecognitionResponse(BaseModel):
    exam_id: Optional[str] = None
    student_id: Optional[str] = None
    answers: list[RecognitionAnswer]


def _authorize(x_ml_service_key: Optional[str]) -> None:
    if API_KEY and x_ml_service_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid ML service API key")


@app.get("/health")
def health(x_ml_service_key: Optional[str] = Header(default=None)):
    _authorize(x_ml_service_key)
    return {
        "status": "ok",
        "service": "ml-recognition",
        "version": "2.0.0",
        "mcq_model_loaded": mcq_recognizer is not None,
        "trocr_model_loaded": phrase_recognizer is not None,
        "templates_loaded": sorted(templates.keys()),
    }


@app.post("/recognize-script", response_model=RecognitionResponse)
async def recognize_script(
    file: UploadFile = File(...),
    template_type: str = Form("mixed"),
    exam_id: Optional[str] = Form(None),
    student_id: Optional[str] = Form(None),
    x_ml_service_key: Optional[str] = Header(default=None),
):
    _authorize(x_ml_service_key)

    if template_type not in templates:
        raise HTTPException(status_code=400, detail=f"Unknown template type: {template_type}")
    if mcq_recognizer is None:
        raise HTTPException(status_code=503, detail="EMNIST/MCQ model is not loaded")
    if phrase_recognizer is None and template_type != "all_mcq":
        raise HTTPException(status_code=503, detail="TrOCR model is not loaded")

    raw = await file.read()
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Could not decode uploaded image")

    try:
        boxes = process_answer_sheet(image, templates[template_type])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    answers = []
    for box in boxes:
        if box.type == "mcq":
            text, confidence = mcq_recognizer.predict(box.image)
        else:
            text, confidence = phrase_recognizer.predict(box.image)

        answers.append(
            RecognitionAnswer(
                question_id=box.id,
                type=box.type,
                recognized_text=text,
                recognition_confidence=round(float(confidence), 6),
            )
        )

    return RecognitionResponse(exam_id=exam_id, student_id=student_id, answers=answers)

@app.get("/templates")
def list_templates(x_ml_service_key: Optional[str] = Header(default=None)):
    """Expose the static answer-sheet layouts without making ML the exam store."""
    _authorize(x_ml_service_key)
    result = []
    labels = {"mixed": "Mixed", "all_mcq": "All MCQ", "all_completion": "All Completion"}
    for template_type in TEMPLATE_TYPES:
        template = templates.get(template_type)
        if not template:
            continue
        result.append({
            "type": template_type,
            "label": labels.get(template_type, template_type.replace("_", " ").title()),
            "question_count": len(template.get("questions", [])),
            "questions": template.get("questions", []),
            "reference_width": template.get("reference_width"),
            "reference_height": template.get("reference_height"),
        })
    return result


@app.get("/answer-sheets/{template_type}.pdf")
def answer_sheet(template_type: str, x_ml_service_key: Optional[str] = Header(default=None)):
    _authorize(x_ml_service_key)
    if template_type not in TEMPLATE_TYPES:
        raise HTTPException(status_code=404, detail="Unknown template type")
    path = DATA_DIR / "answer_sheets" / f"{template_type}_answer_sheet.pdf"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Answer sheet not found")
    from fastapi.responses import FileResponse
    return FileResponse(path, media_type="application/pdf", filename=path.name)


@app.post("/render-question-paper.pdf")
async def render_question_paper(payload: dict, x_ml_service_key: Optional[str] = Header(default=None)):
    """Render a question paper from supplied exam content.

    The ML service renders the document but does not persist the examination.
    """
    _authorize(x_ml_service_key)
    exam_content = payload.get("exam") if isinstance(payload.get("exam"), dict) else payload
    template_type = exam_content.get("template_type") or exam_content.get("template")
    if template_type not in templates:
        raise HTTPException(status_code=400, detail=f"Unknown template type: {template_type}")

    from app.exam_content import validate_against_template, generate_question_paper_pdf
    try:
        validate_against_template(exam_content, templates[template_type])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    output_dir = DATA_DIR / "generated_question_papers"
    output_dir.mkdir(parents=True, exist_ok=True)
    exam_id = str(exam_content.get("exam_id") or exam_content.get("id") or "exam")
    safe_id = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in exam_id)
    output_path = output_dir / f"{safe_id}.pdf"
    generate_question_paper_pdf(exam_content, str(output_path))

    from fastapi.responses import FileResponse
    return FileResponse(output_path, media_type="application/pdf", filename=f"{safe_id}.pdf")
