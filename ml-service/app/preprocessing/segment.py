"""
OpenCV preprocessing and segmentation pipeline.

Pipeline for one scanned/photographed answer sheet:
    1. Load image, convert to greyscale.
    2. Denoise + binarise.
    3. Detect the four corner alignment markers (solid black squares
       printed on the template) and use them to compute a perspective
       transform that deskews AND resizes the sheet to the template's
       reference resolution.
    4. Crop out each question's box using the coordinates in template.json.

This corresponds to Iteration 3 of your methodology and directly follows
the design rationale from de Elias, Tasinafo & Hirata Jr. (2021): a fixed,
template-based layout with explicit alignment markers is far more robust
than trying to do open-ended layout analysis on an unstructured page.
"""

import json
import cv2
import numpy as np
from pathlib import Path
from dataclasses import dataclass
from typing import Dict, List, Tuple


@dataclass
class QuestionBox:
    id: str
    type: str  # "mcq" or "phrase"
    image: np.ndarray  # cropped, cleaned-up image for this question


def load_template(template_path: str) -> dict:
    with open(template_path, "r") as f:
        return json.load(f)


def _to_grayscale(image: np.ndarray) -> np.ndarray:
    if len(image.shape) == 3:
        return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return image


def _denoise_and_binarise(gray: np.ndarray) -> np.ndarray:
    """Light denoise + adaptive threshold. Adaptive thresholding copes much
    better with uneven lighting across a photographed page than a single
    global threshold would."""
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    binary = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=35,
        C=15,
    )
    return binary


def _find_marker_centroids(binary: np.ndarray, expected_count: int = 4) -> List[Tuple[float, float]]:
    """Find solid black squares (alignment markers) in the binarised image.

    Markers are printed as filled black squares, so after thresholding they
    show up as compact, roughly-square dark blobs. We look for contours with:
      - area within a plausible range for a marker at this image size
      - an aspect ratio close to 1 (roughly square)
      - a HIGH ACTUAL PIXEL DENSITY inside the bounding box (see note below)
    """
    # Markers are BLACK on a white background. THRESH_BINARY above makes
    # ink/dark regions == 0 and background == 255, so invert to find them
    # as foreground blobs via findContours.
    inverted = cv2.bitwise_not(binary)
    contours, _ = cv2.findContours(inverted, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    h, w = binary.shape
    image_area = h * w
    candidates = []

    for c in contours:
        area = cv2.contourArea(c)
        # Markers should be small relative to the page but not tiny noise specks.
        if area < image_area * 0.0002 or area > image_area * 0.01:
            continue
        x, y, bw, bh = cv2.boundingRect(c)
        if bh == 0:
            continue
        aspect = bw / float(bh)
        if not (0.7 <= aspect <= 1.3):
            continue

        # IMPORTANT: contourArea measures the area ENCLOSED by the contour's
        # outer boundary curve. For a hollow rectangle outline (e.g. an empty
        # answer box drawn as a thin border), the outer boundary still traces
        # a full rectangle, so contourArea/bbox_area comes out close to 1.0
        # even though almost none of the interior is actually dark. That
        # false positive is exactly what answer-sheet boxes look like, so a
        # contourArea-based fill ratio cannot tell a solid marker apart from
        # a hollow box outline.
        #
        # The fix: measure the ACTUAL fraction of dark pixels inside the
        # bounding box directly from the binary mask (countNonZero), which
        # is near 1.0 only for a genuinely solid filled square.
        region = inverted[y:y + bh, x:x + bw]
        pixel_density = cv2.countNonZero(region) / float(bw * bh)

        if pixel_density > 0.75:  # genuinely solid, not just an outline
            cx, cy = x + bw / 2.0, y + bh / 2.0
            candidates.append((cx, cy, area))

    if len(candidates) < expected_count:
        raise ValueError(
            f"Could not find {expected_count} alignment markers "
            f"(found {len(candidates)} candidates). Check scan quality/lighting, "
            f"or that the template's corner squares printed correctly."
        )

    # Keep the largest `expected_count` candidates (most likely to be real
    # markers rather than stray noise) then sort into TL, TR, BL, BR by position.
    candidates.sort(key=lambda t: t[2], reverse=True)
    candidates = candidates[:expected_count]
    points = [(cx, cy) for cx, cy, _ in candidates]

    points.sort(key=lambda p: (p[1], p[0]))  # sort by y first, then x
    top_two = sorted(points[:2], key=lambda p: p[0])
    bottom_two = sorted(points[2:], key=lambda p: p[0])
    top_left, top_right = top_two
    bottom_left, bottom_right = bottom_two

    return [top_left, top_right, bottom_left, bottom_right]


def deskew_and_align(image: np.ndarray, template: dict) -> np.ndarray:
    """Detect the four corner markers and warp the image so they land exactly
    on the reference coordinates from template.json. This simultaneously
    corrects rotation, minor perspective skew, and scales the image to the
    reference resolution, so every downstream box coordinate is reliable."""

    gray = _to_grayscale(image)
    binary = _denoise_and_binarise(gray)

    top_left, top_right, bottom_left, bottom_right = _find_marker_centroids(binary)

    src_pts = np.float32([top_left, top_right, bottom_left, bottom_right])

    markers = template["alignment_markers"]
    dst_pts = np.float32([
        markers["top_left"],
        markers["top_right"],
        markers["bottom_left"],
        markers["bottom_right"],
    ])

    matrix = cv2.getPerspectiveTransform(src_pts, dst_pts)
    ref_w = template["reference_width"]
    ref_h = template["reference_height"]
    aligned = cv2.warpPerspective(image, matrix, (ref_w, ref_h))
    return aligned


def crop_questions(aligned_image: np.ndarray, template: dict) -> List[QuestionBox]:
    """Crop out each question box defined in the template from the aligned image."""
    boxes = []
    for q in template["questions"]:
        x, y, w, h = q["box"]
        crop = aligned_image[y:y + h, x:x + w]
        cleaned = _clean_crop_for_recognition(crop)
        boxes.append(QuestionBox(id=q["id"], type=q["type"], image=cleaned))
    return boxes


def _clean_crop_for_recognition(crop: np.ndarray) -> np.ndarray:
    """Light per-box cleanup before handing off to a recognition model:
    greyscale + mild denoise. Deliberately does NOT binarise here — both
    the CNN and TrOCR expect fairly natural greyscale/RGB input, and harsh
    binarisation at this stage can destroy stroke detail that helps
    recognition."""
    gray = _to_grayscale(crop)
    denoised = cv2.fastNlMeansDenoising(gray, h=10)
    return denoised


def process_answer_sheet(image: np.ndarray, template: dict) -> List[QuestionBox]:
    """Full pipeline: raw image in, list of cropped+cleaned question boxes out."""
    aligned = deskew_and_align(image, template)
    return crop_questions(aligned, template)


# ---------------------------------------------------------------------------
# Synthetic test-sheet generator.
#
# You won't have real scanned scripts on day one. This function draws a fake
# answer sheet (with the four alignment markers + question boxes matching
# template.json) so you can verify the segmentation pipeline works BEFORE
# you have any real data, and use it as a regression test afterwards.
# ---------------------------------------------------------------------------
def generate_synthetic_test_sheet(template: dict, rotation_degrees: float = 0.0) -> np.ndarray:
    w, h = template["reference_width"], template["reference_height"]
    canvas = np.full((h, w, 3), 255, dtype=np.uint8)

    marker_size = 25
    for name, value in template["alignment_markers"].items():
        if name == "_comment":
            continue
        cx, cy = value
        half = marker_size // 2
        cv2.rectangle(
            canvas,
            (int(cx - half), int(cy - half)),
            (int(cx + half), int(cy + half)),
            (0, 0, 0),
            thickness=-1,
        )

    for q in template["questions"]:
        x, y, bw, bh = q["box"]
        cv2.rectangle(canvas, (x, y), (x + bw, y + bh), (150, 150, 150), thickness=2)
        # Draw a fake handwritten mark inside so crops aren't blank.
        cv2.putText(
            canvas, "A" if q["type"] == "mcq" else "ans",
            (x + 10, y + bh // 2 + 10),
            cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2,
        )

    if rotation_degrees != 0.0:
        # Rotate in place around the page center. Real scanners/cameras
        # capture a fixed-size frame, so this matches realistic behaviour —
        # which is exactly why the alignment markers need a safe margin from
        # the page edge (see template.json): too tight a margin and modest
        # skew during scanning clips a corner marker off-frame.
        center = (w // 2, h // 2)
        rot_matrix = cv2.getRotationMatrix2D(center, rotation_degrees, 1.0)
        canvas = cv2.warpAffine(
            canvas, rot_matrix, (w, h), borderValue=(255, 255, 255)
        )

    return canvas


if __name__ == "__main__":
    # Quick manual smoke test: generate a slightly rotated synthetic sheet,
    # run it through the full pipeline, and report how many boxes came out.
    template_path = Path(__file__).resolve().parents[2] / "data" / "template.json"
    template = load_template(str(template_path))

    test_sheet = generate_synthetic_test_sheet(template, rotation_degrees=2.5)

    out_path = Path(__file__).resolve().parents[2] / "data" / "samples" / "synthetic_test_sheet.png"
    cv2.imwrite(str(out_path), test_sheet)
    print(f"Wrote synthetic test sheet to {out_path}")

    boxes = process_answer_sheet(test_sheet, template)
    print(f"Segmented {len(boxes)} question boxes:")
    for b in boxes:
        print(f"  {b.id} ({b.type}): shape={b.image.shape}")
