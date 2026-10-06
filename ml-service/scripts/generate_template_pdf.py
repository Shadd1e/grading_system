"""
Generates a printable A4 answer sheet PDF whose alignment markers and answer
boxes land EXACTLY at the pixel coordinates defined in data/template.json
(at the template's reference_width x reference_height, assumed to be at
150 DPI — 1240x1754 px is exactly A4 at 150 DPI).

This means: print this PDF, scan/photograph it, and app/preprocessing/segment.py
will find the boxes in the right place with zero coordinate changes needed.

If you redesign the layout (move boxes, add questions), edit template.json
FIRST, then re-run this script — template.json is the single source of truth
for where every box lives, shared by both the printable sheet and the
recognition pipeline.

Usage:
    python scripts/generate_template_pdf.py
    python scripts/generate_template_pdf.py --template data/template.json --output data/answer_sheet.pdf
"""
import argparse
import json
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm

# template.json coordinates are defined at 150 DPI (1240x1754 px == A4).
# PDF/reportlab units are points, 72 per inch. This is the one conversion
# factor everything below depends on.
PX_TO_PT = 72.0 / 150.0


def px_to_pt_rect(x, y, w, h, page_height_pt):
    """Convert a template.json box [x, y, w, h] (top-left origin, y-down,
    in reference pixels) into reportlab's (x, y, w, h) with bottom-left
    origin, y-up, in points."""
    pt_x = x * PX_TO_PT
    pt_w = w * PX_TO_PT
    pt_h = h * PX_TO_PT
    pt_y_top = y * PX_TO_PT
    pt_y_bottom = page_height_pt - pt_y_top - pt_h
    return pt_x, pt_y_bottom, pt_w, pt_h


def draw_alignment_markers(c, template, page_height_pt):
    marker_size_px = 25  # must match generate_synthetic_test_sheet's marker_size
    marker_size_pt = marker_size_px * PX_TO_PT
    for name, value in template["alignment_markers"].items():
        if name == "_comment":
            continue
        cx_px, cy_px = value
        cx_pt = cx_px * PX_TO_PT
        cy_pt = page_height_pt - (cy_px * PX_TO_PT)
        half = marker_size_pt / 2
        c.setFillColorRGB(0, 0, 0)
        c.rect(cx_pt - half, cy_pt - half, marker_size_pt, marker_size_pt, fill=1, stroke=0)


def draw_header(c, page_width_pt, page_height_pt):
    margin = 15 * mm
    y = page_height_pt - margin

    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(page_width_pt / 2, y, "FEDERAL UNIVERSITY OF PETROLEUM RESOURCES, EFFURUN")
    y -= 16
    c.setFont("Helvetica", 10)
    c.drawCentredString(page_width_pt / 2, y, "Department of Computer Science — Structured Answer Sheet")
    y -= 20

    c.setFont("Helvetica", 9)
    field_y = y
    c.drawString(margin, field_y, "Name:")
    c.line(margin + 35, field_y - 2, margin + 220, field_y - 2)
    c.drawString(margin + 235, field_y, "Reg. No:")
    c.line(margin + 275, field_y - 2, page_width_pt - margin, field_y - 2)

    field_y -= 20
    c.drawString(margin, field_y, "Course Code:")
    c.line(margin + 60, field_y - 2, margin + 200, field_y - 2)
    c.drawString(margin + 215, field_y, "Date:")
    c.line(margin + 245, field_y - 2, page_width_pt - margin, field_y - 2)

    field_y -= 25
    c.setFont("Helvetica-Oblique", 8)
    c.drawString(
        margin, field_y,
        "Instructions: Write ONE capital letter (A-D) per MCQ box. Keep answers within the box borders. "
        "Do not mark outside the printed boxes."
    )
    return field_y - 10


def draw_question_boxes(c, template, page_height_pt, content_top_pt):
    c.setFont("Helvetica-Bold", 9)
    mcq_labelled = False
    phrase_labelled = False

    for q in template["questions"]:
        x, y, w, h = q["box"]
        pt_x, pt_y, pt_w, pt_h = px_to_pt_rect(x, y, w, h, page_height_pt)

        # Section headers, printed once, just above the first box of each type.
        if q["type"] == "mcq" and not mcq_labelled:
            c.setFont("Helvetica-Bold", 11)
            c.drawString(pt_x, pt_y + pt_h + 14, "Section A — Multiple Choice (write A, B, C, or D)")
            mcq_labelled = True
        if q["type"] == "phrase" and not phrase_labelled:
            c.setFont("Helvetica-Bold", 11)
            c.drawString(pt_x, pt_y + pt_h + 14, "Section B — Short Answer (a few words)")
            phrase_labelled = True

        c.setLineWidth(1.2)
        c.setStrokeColorRGB(0.35, 0.35, 0.35)
        c.rect(pt_x, pt_y, pt_w, pt_h, fill=0, stroke=1)

        # Question number label, placed just to the left of / above the box.
        c.setFont("Helvetica-Bold", 9)
        c.setFillColorRGB(0, 0, 0)
        label = q["id"].upper().replace("Q", "Q")
        if q["type"] == "mcq":
            c.drawCentredString(pt_x + pt_w / 2, pt_y + pt_h + 4, label)
        else:
            c.drawString(pt_x, pt_y + pt_h + 4, f"{label}:")


def generate_answer_sheet_pdf(template_path: str, output_path: str):
    with open(template_path) as f:
        template = json.load(f)

    page_width_pt, page_height_pt = A4
    c = canvas.Canvas(output_path, pagesize=A4)

    content_top = draw_header(c, page_width_pt, page_height_pt)
    draw_question_boxes(c, template, page_height_pt, content_top)
    draw_alignment_markers(c, template, page_height_pt)

    # Footer note explaining the corner squares, so students/invigilators
    # don't mistake them for something to write on.
    c.setFont("Helvetica-Oblique", 7)
    c.setFillColorRGB(0.4, 0.4, 0.4)
    c.drawString(15 * mm, 10 * mm,
                 "The four black corner squares are alignment markers for automated scanning. Do not write on or cover them.")

    c.save()
    print(f"Wrote answer sheet PDF to {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", default="data/template.json")
    parser.add_argument("--output", default="data/answer_sheet.pdf")
    args = parser.parse_args()
    generate_answer_sheet_pdf(args.template, args.output)
