"""
Generates BOTH the student-facing question paper PDF and the machine-facing
answer_key.json from a single exam_content.json source of truth.

Why one source file: keeping questions/options in one place and correct
answers in another (hand-edited separately) is how they silently drift out
of sync. This script derives both outputs from the same file every time, so
they can't disagree with each other.

Validation: before generating anything, this checks that the question IDs
and types in exam_content.json exactly match the question IDs and types in
template.json. If they don't, it refuses to generate and tells you exactly
what's missing/extra/mismatched — rather than silently producing an answer
key that grades the wrong questions (see grading/engine.py's grade_script,
which iterates the answer key, not the template, so a mismatch there fails
silently at grading time instead of at generation time).

Usage:
    python scripts/generate_question_paper.py
    python scripts/generate_question_paper.py \\
        --exam-content data/exam_content_example.json \\
        --template data/template.json \\
        --question-paper-output data/question_paper.pdf \\
        --answer-key-output data/answer_key_generated.json
"""
import argparse
import json
import re
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.utils import simpleSplit


def natural_question_order(question_id: str):
    """Sort 'q1', 'q2', ..., 'q10' in numeric order, not lexicographic order
    (which would otherwise put 'q10' right after 'q1')."""
    match = re.search(r"\d+", question_id)
    return int(match.group()) if match else 0


def load_json(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def validate_against_template(exam_content: dict, template: dict) -> None:
    """Refuse to generate anything if exam_content.json's questions don't
    exactly match template.json's questions (same IDs, same types). This is
    the check that prevents the silent-mismatch footgun described in the
    grading engine: a typo'd or missing question ID here would otherwise
    only surface as a silently-ungraded question much later."""
    template_questions = {q["id"]: q["type"] for q in template["questions"]}
    exam_questions = {
        qid: q["type"] for qid, q in exam_content["questions"].items()
    }

    template_ids = set(template_questions)
    exam_ids = set(exam_questions)

    missing_from_exam = template_ids - exam_ids
    extra_in_exam = exam_ids - template_ids
    type_mismatches = [
        qid for qid in (template_ids & exam_ids)
        if template_questions[qid] != exam_questions[qid]
    ]

    errors = []
    if missing_from_exam:
        errors.append(
            f"Questions in template.json but missing from exam_content.json: "
            f"{sorted(missing_from_exam, key=natural_question_order)}"
        )
    if extra_in_exam:
        errors.append(
            f"Questions in exam_content.json but not in template.json (no box "
            f"exists for these on the answer sheet): "
            f"{sorted(extra_in_exam, key=natural_question_order)}"
        )
    if type_mismatches:
        for qid in type_mismatches:
            errors.append(
                f"Question '{qid}' is type '{template_questions[qid]}' in "
                f"template.json but '{exam_questions[qid]}' in exam_content.json"
            )

    if errors:
        raise ValueError(
            "exam_content.json does not match template.json — refusing to "
            "generate, since this would silently produce a mismatched answer "
            "key. Fix the following:\n  - " + "\n  - ".join(errors)
        )


def derive_answer_key(exam_content: dict) -> dict:
    """Extract just the grading-relevant fields from exam_content.json, in
    the exact shape app/grading/engine.py expects (see
    data/answer_key_example.json)."""
    answers = {}
    for qid, q in exam_content["questions"].items():
        if q["type"] == "mcq":
            answers[qid] = {"type": "mcq", "answer": q["correct"]}
        else:
            answers[qid] = {"type": "phrase", "acceptable_answers": q["acceptable_answers"]}

    return {
        "answer_key_id": exam_content["exam_id"],
        "max_score_mcq": exam_content["max_score_mcq"],
        "max_score_phrase": exam_content["max_score_phrase"],
        "confidence_threshold": exam_content["confidence_threshold"],
        "answers": answers,
    }


def generate_question_paper_pdf(exam_content: dict, output_path: str) -> None:
    page_width, page_height = A4
    margin = 20 * mm
    usable_width = page_width - 2 * margin

    c = canvas.Canvas(output_path, pagesize=A4)
    y = page_height - margin

    def new_page_if_needed(space_needed: float):
        nonlocal y
        if y - space_needed < margin:
            c.showPage()
            y = page_height - margin

    # --- Header ---
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(page_width / 2, y, exam_content["course_code"] + " — " + exam_content["course_title"])
    y -= 20
    c.setFont("Helvetica", 10)
    c.drawCentredString(page_width / 2, y, "Question Paper")
    y -= 25

    c.setFont("Helvetica-Oblique", 9)
    for line in simpleSplit(exam_content["instructions"], "Helvetica-Oblique", 9, usable_width):
        c.drawString(margin, y, line)
        y -= 12
    y -= 15

    c.setLineWidth(0.5)
    c.line(margin, y, page_width - margin, y)
    y -= 25

    # --- Questions ---
    sorted_ids = sorted(exam_content["questions"].keys(), key=natural_question_order)
    for qid in sorted_ids:
        q = exam_content["questions"][qid]
        number = natural_question_order(qid)

        new_page_if_needed(60)
        c.setFont("Helvetica-Bold", 11)
        question_lines = simpleSplit(f"{number}. {q['text']}", "Helvetica-Bold", 11, usable_width)
        for line in question_lines:
            new_page_if_needed(16)
            c.drawString(margin, y, line)
            y -= 16
        y -= 4

        if q["type"] == "mcq":
            c.setFont("Helvetica", 10)
            for letter in sorted(q["options"].keys()):
                new_page_if_needed(15)
                option_text = f"     {letter}) {q['options'][letter]}"
                c.drawString(margin, y, option_text)
                y -= 15
        else:
            c.setFont("Helvetica-Oblique", 9)
            new_page_if_needed(15)
            c.drawString(margin, y, "     (Write your answer in the box on the answer sheet.)")
            y -= 15

        y -= 15  # gap before next question

    c.save()
    print(f"Wrote question paper to {output_path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--exam-content", default="data/exam_content_example.json")
    parser.add_argument("--template", default="data/template.json")
    parser.add_argument("--question-paper-output", default="data/question_paper.pdf")
    parser.add_argument("--answer-key-output", default="data/answer_key_generated.json")
    args = parser.parse_args()

    exam_content = load_json(args.exam_content)
    template = load_json(args.template)

    validate_against_template(exam_content, template)

    answer_key = derive_answer_key(exam_content)
    Path(args.answer_key_output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.answer_key_output, "w") as f:
        json.dump(answer_key, f, indent=2)
    print(f"Wrote answer key to {args.answer_key_output}")

    generate_question_paper_pdf(exam_content, args.question_paper_output)


if __name__ == "__main__":
    main()
