"""
Automated regression test for the OpenCV segmentation pipeline.

This does NOT need real scanned scripts, torch, or transformers to run —
only opencv-python and numpy. Run it any time you touch segment.py:

    cd ml-service
    python -m pytest tests/test_segmentation.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.preprocessing.segment import (
    load_template,
    generate_synthetic_test_sheet,
    process_answer_sheet,
)

TEMPLATE_PATH = Path(__file__).resolve().parents[1] / "data" / "template.json"


def test_segmentation_no_rotation():
    template = load_template(str(TEMPLATE_PATH))
    sheet = generate_synthetic_test_sheet(template, rotation_degrees=0.0)
    boxes = process_answer_sheet(sheet, template)

    expected_ids = [q["id"] for q in template["questions"]]
    assert [b.id for b in boxes] == expected_ids
    for b in boxes:
        assert b.image.size > 0


def test_segmentation_with_rotation():
    """The real-world case: scripts are rarely scanned perfectly straight."""
    template = load_template(str(TEMPLATE_PATH))
    for angle in (-4.0, -1.5, 1.5, 4.0):
        sheet = generate_synthetic_test_sheet(template, rotation_degrees=angle)
        boxes = process_answer_sheet(sheet, template)
        assert len(boxes) == len(template["questions"]), (
            f"Failed to recover all boxes at rotation={angle} degrees"
        )


def test_box_types_match_template():
    template = load_template(str(TEMPLATE_PATH))
    sheet = generate_synthetic_test_sheet(template, rotation_degrees=2.0)
    boxes = process_answer_sheet(sheet, template)

    box_by_id = {b.id: b for b in boxes}
    for q in template["questions"]:
        assert box_by_id[q["id"]].type == q["type"]


def test_hollow_boxes_not_mistaken_for_markers():
    """Regression test for a real bug found during development: OpenCV's
    contourArea() on a HOLLOW rectangle outline (like an empty answer box)
    returns almost the same value as a genuinely SOLID filled square of the
    same size, because contourArea measures the area enclosed by the
    boundary curve, not how many pixels are actually dark inside it. This
    previously caused large empty answer boxes to be mistaken for the small
    solid alignment markers, silently misaligning every question box.
    The fix checks actual pixel density inside the bounding box rather than
    contourArea. This test locks that behaviour in."""
    from app.preprocessing.segment import _to_grayscale, _denoise_and_binarise, _find_marker_centroids

    template = load_template(str(TEMPLATE_PATH))
    sheet = generate_synthetic_test_sheet(template, rotation_degrees=0.0)

    gray = _to_grayscale(sheet)
    binary = _denoise_and_binarise(gray)
    detected = _find_marker_centroids(binary)

    expected = template["alignment_markers"]
    expected_points = [
        tuple(expected["top_left"]), tuple(expected["top_right"]),
        tuple(expected["bottom_left"]), tuple(expected["bottom_right"]),
    ]

    for (dx, dy), (ex, ey) in zip(detected, expected_points):
        distance = ((dx - ex) ** 2 + (dy - ey) ** 2) ** 0.5
        assert distance < 5, (
            f"Detected marker ({dx},{dy}) is {distance:.1f}px from expected "
            f"({ex},{ey}) — likely locked onto a hollow answer box instead "
            f"of the real solid marker."
        )


if __name__ == "__main__":
    test_segmentation_no_rotation()
    test_segmentation_with_rotation()
    test_box_types_match_template()
    test_hollow_boxes_not_mistaken_for_markers()
    print("All segmentation tests passed.")
