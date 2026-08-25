"""
The measurement contract shared by both strategies.

Strategy A and strategy B return exactly the same object, which is what makes an A/B
comparison on one capture meaningful: the panel renders both through the same view and
the operator compares numbers, not formats.

Field names mirror the printed optician report (PD, corridor/BOX height, height to
pupil centre, pantoscopic and wrap angle, facial width, plus the frame's own boxing
dimensions), so a result can be handed to a lab without a translation step.
"""

from typing import Any, Dict, List, Optional, Tuple

from services.vision_measure.capri_prompt import fitting_heights

# Clinically plausible bands. A figure outside its band is NOT dropped: it is kept and
# flagged, because knowing that a model produced an impossible number is the point of
# the whole A/B exercise.
FACIAL_RANGES: Dict[str, Tuple[float, float]] = {
    "pdTotalMM": (48.0, 82.0),
    "pdRightMM": (22.0, 42.0),
    "pdLeftMM": (22.0, 42.0),
    "corridorHeightRightMM": (12.0, 38.0),
    "corridorHeightLeftMM": (12.0, 38.0),
    "pupilCenterHeightMM": (10.0, 40.0),
    "pantoscopicAngleDeg": (-5.0, 25.0),
    "wrapAngleDeg": (0.0, 35.0),
    "faceWidthMM": (110.0, 175.0),
}

FRAME_RANGES: Dict[str, Tuple[float, float]] = {
    "lensWidthMM": (38.0, 65.0),
    "bridgeMM": (12.0, 28.0),
    "templeLengthMM": (115.0, 160.0),
    "lensHeightMM": (22.0, 55.0),
    "totalFrontWidthMM": (105.0, 165.0),
}

FRAME_TEXT_FIELDS = ("brand", "model", "color", "sizeCode", "shape", "material",
                     "rimType")

# The Capri protocol's summary table. Present only when the operator entered a frame
# identifier; it goes FIRST in the report, because when a specific model is being fitted
# these are the numbers the optician reads before anything else.
CAPRI_RANGES: Dict[str, Tuple[float, float]] = {
    "lensWidthAMM": (38.0, 65.0),
    "lensHeightBMM": (22.0, 55.0),
    "edMM": (40.0, 75.0),
    "circMM": (100.0, 200.0),
    "bridgeDBLMM": (12.0, 28.0),
    "templeLengthMM": (115.0, 160.0),
    "monofocalHeightMM": (11.0, 28.0),
    "bifocalHeightMM": (6.0, 23.0),
    "progressiveHeightMM": (11.0, 45.0),
    "personNasalBridgeWidthMM": (8.0, 30.0),
    "bridgeWidthDifferenceMM": (-20.0, 20.0),
    "verticalOffsetAboveBridgeMM": (0.0, 10.0),
}

CAPRI_FREE_NUMBERS = ("pixelsPerMM", "verticalOffsetPx", "horizontalAdjustmentPx",
                      "verticalAdjustmentPx")

# The fitting height is THE number for a progressive lens: too little and the corridor
# does not fit inside the lens, so the wearer never reaches the reading zone. It was
# derivable from the facial block before, but only if you knew which of the three height
# fields meant what — and one of them was never even defined. Now it is its own block.
PROGRESSIVE_RANGES: Dict[str, Tuple[float, float]] = {
    "fittingHeightRightMM": (12.0, 38.0),
    "fittingHeightLeftMM": (12.0, 38.0),
    "minimumRequiredMM": (13.0, 30.0),
}

# Industry practice, and the reason a frame can be rejected outright for progressives.
PROGRESSIVE_SHORT_CORRIDOR_MM = 18.0
PROGRESSIVE_STANDARD_CORRIDOR_MM = 22.0

# The literal schema handed to the model. Kept as one string so both strategies request
# the identical object and neither can drift.
JSON_SCHEMA_PROMPT = """Return ONE JSON object and nothing else. No markdown, no code
fence, no prose before or after. Use exactly this shape; use null for any value you
cannot establish — never invent a plausible-looking number:

{
  "facial": {
    "pdTotalMM": number|null,
    "pdRightMM": number|null,
    "pdLeftMM": number|null,
    "corridorHeightRightMM": number|null,
    "corridorHeightLeftMM": number|null,
    "pupilCenterHeightMM": number|null,
    "pantoscopicAngleDeg": number|null,
    "wrapAngleDeg": number|null,
    "faceWidthMM": number|null
  },
  "frame": {
    "brand": string|null,
    "model": string|null,
    "color": string|null,
    "sizeCode": string|null,
    "lensWidthMM": number|null,
    "bridgeMM": number|null,
    "templeLengthMM": number|null,
    "lensHeightMM": number|null,
    "totalFrontWidthMM": number|null,
    "shape": string|null,
    "material": string|null,
    "rimType": string|null,
  },
  "progressive": {
    "fittingHeightRightMM": number|null,
    "fittingHeightLeftMM": number|null,
    "minimumRequiredMM": number|null,
    "suitable": true|false|null,
    "note": string
  },
  "inputs": {
    "faceImageShowsOnePerson": true|false|null,
    "frameImageShowsEyewear": true|false|null,
    "problem": string|null
  },
  "fit": {
    "verdict": string,
    "score": number,
    "issues": [string],
    "recommendations": [string]
  },
  "confidence": {
    "<fieldName>": {
      "level": "high"|"medium"|"low",
      "source": "measured"|"derived"|"estimated",
      "note": string
    }
  },
  "notes": [string]
}

Rules for the numeric fields:
- Every length is in millimetres, every angle in degrees. Never output a unit suffix.
- OD is the PATIENT'S right eye and OS the patient's left eye. The photograph may be
  mirrored; decide laterality from facial anatomy, not from which side of the image the
  eye appears on.
- pdRightMM + pdLeftMM must equal pdTotalMM within 1 mm.
- The three height fields are DIFFERENT measurements. Do not return the same number for
  all of them; if you can only establish one, return that one and leave the others null.
    * "corridorHeightRight/LeftMM" — from the pupil centre straight DOWN to the lowest
      inner point of the lens aperture ON THAT VERTICAL. This is the fitting height a
      progressive lens needs.
    * "pupilCenterHeightMM" — from the pupil centre to the BOTTOM LINE of the boxing
      rectangle (the horizontal tangent to the lowest point of the lens). On any lens
      whose lowest point is not directly under the pupil, this is SMALLER than the
      corridor height above.
- The "progressive" block is the single most important output for a varifocal fitting:
    * "fittingHeightRight/LeftMM" is the corridor height per eye, repeated here because
      this is where the optician looks for it.
    * "minimumRequiredMM": what the lens design needs. Roughly 18 mm for a short-corridor
      design and 22 mm for a standard one. Choose one and say which in "note".
    * "suitable": true only if BOTH fitting heights reach that minimum. false when they
      do not — that is a frame the patient should not order progressives in. null if you
      could not establish the heights at all.
- FIRST, judge the two photographs in "inputs". IMAGE 1 must show exactly ONE person's
  face; IMAGE 2 must show a pair of spectacles or an eyewear frame. If either is
  wrong — no face, several people, or IMAGE 2 is not eyewear — set the corresponding
  flag false, describe it in "problem", and leave every measurement null. Measuring a
  photograph that does not show what it should produces numbers with no referent,
  which is worse than no numbers.
- "rimType" is how the lens is held: full rim, semi-rimless (nylor) or rimless.
- "score" is 0-100: how well this frame suits this face.
- Populate "confidence" for every non-null numeric field you return.
"""


def _coerce_number(value: Any) -> Optional[float]:
    """Accepts 61, "61", "61.0 mm", "8°"; rejects anything else."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = (
            value.replace("mm", "")
            .replace("MM", "")
            .replace("°", "")
            .replace("deg", "")
            .replace(",", ".")
            .strip()
        )
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def _coerce_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _coerce_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return []


def normalize_result(raw: Dict[str, Any]) -> Dict[str, Any]:
    """
    Turns whatever the model returned into the contract above.

    Nothing is discarded silently: values that fail to parse or fall outside their
    clinical band land in `outOfRange` / `warnings` so the panel can mark them instead
    of presenting a bad figure as a reading.
    """
    raw = raw if isinstance(raw, dict) else {}
    raw_facial = raw.get("facial") if isinstance(raw.get("facial"), dict) else {}
    raw_frame = raw.get("frame") if isinstance(raw.get("frame"), dict) else {}
    raw_fit = raw.get("fit") if isinstance(raw.get("fit"), dict) else {}
    raw_conf = raw.get("confidence") if isinstance(raw.get("confidence"), dict) else {}

    warnings: List[str] = []
    out_of_range: List[str] = []

    facial: Dict[str, Optional[float]] = {}
    for key, (lo, hi) in FACIAL_RANGES.items():
        value = _coerce_number(raw_facial.get(key))
        facial[key] = value
        if value is not None and not (lo <= value <= hi):
            out_of_range.append(key)

    frame: Dict[str, Any] = {}
    for key, (lo, hi) in FRAME_RANGES.items():
        value = _coerce_number(raw_frame.get(key))
        frame[key] = value
        if value is not None and not (lo <= value <= hi):
            out_of_range.append(key)
    for key in FRAME_TEXT_FIELDS:
        frame[key] = _coerce_text(raw_frame.get(key))

    # Monocular PDs that do not add up mean the model measured the two eyes
    # independently of the total — a coherence failure worth surfacing, not hiding.
    pd_total, pd_r, pd_l = facial["pdTotalMM"], facial["pdRightMM"], facial["pdLeftMM"]
    if pd_total is not None and pd_r is not None and pd_l is not None:
        if abs((pd_r + pd_l) - pd_total) > 1.0:
            warnings.append(
                f"Incoherencia: DIP OD ({pd_r:.1f}) + DIP OS ({pd_l:.1f}) "
                f"no coincide con la DIP total ({pd_total:.1f}) mm."
            )

    raw_inputs = raw.get("inputs") if isinstance(raw.get("inputs"), dict) else {}

    def _flag(value: Any) -> Optional[bool]:
        return value if isinstance(value, bool) else None

    inputs = {
        "faceImageShowsOnePerson": _flag(raw_inputs.get("faceImageShowsOnePerson")),
        "frameImageShowsEyewear": _flag(raw_inputs.get("frameImageShowsEyewear")),
        "problem": _coerce_text(raw_inputs.get("problem")),
    }

    # A photograph that does not show what it should is not a measurement problem, it is
    # a capture problem — and the operator can fix it in seconds if told.
    if inputs["faceImageShowsOnePerson"] is False:
        warnings.append(
            "La foto del rostro no muestra a una sola persona: "
            + (inputs["problem"] or "revísala y vuelve a capturar.")
        )
    if inputs["frameImageShowsEyewear"] is False:
        warnings.append(
            "La imagen de la montura no parece unas gafas: "
            + (inputs["problem"] or "sube una foto de la montura.")
        )

    raw_capri = raw.get("capri") if isinstance(raw.get("capri"), dict) else {}
    capri: Dict[str, Any] = {}
    if raw_capri:
        for key, (lo, hi) in CAPRI_RANGES.items():
            value = _coerce_number(raw_capri.get(key))
            capri[key] = value
            if value is not None and not (lo <= value <= hi):
                out_of_range.append(key)
        # Pixel figures have no clinical band: they depend on the photograph's resolution.
        for key in CAPRI_FREE_NUMBERS:
            capri[key] = _coerce_number(raw_capri.get(key))
        for key in ("frameId", "brand", "model", "color", "commercialSize",
                    "sourceUrl", "bSource", "headRotationNote"):
            capri[key] = _coerce_text(raw_capri.get(key))
        capri["notes"] = _coerce_list(raw_capri.get("notes"))

        # If the model gave B but skipped one of the three heights, derive it here. This
        # is arithmetic on the model's OWN B — nothing is looked up and no dimension is
        # supplied from anywhere else. A B the model could not establish stays null, and
        # so do all three heights.
        derived = fitting_heights(capri.get("lensHeightBMM"))
        for key, name in (
            ("monofocalHeightMM", "monofocal"),
            ("bifocalHeightMM", "bifocal"),
            ("progressiveHeightMM", "progressive"),
        ):
            reported = capri.get(key)
            if reported is None:
                if derived[name] is not None:
                    capri[key] = derived[name]
                continue

            # The model's own figure is kept — it is the one that came with its reasoning
            # — but a height that does not follow from the B it reported is a slip worth
            # naming. Silently accepting it would let a wrong fitting height through
            # wearing the authority of a calculation.
            if derived[name] is not None and abs(reported - derived[name]) > 0.15:
                warnings.append(
                    f"Incoherencia en la altura {name}: el modelo indica "
                    f"{reported} mm, pero con su propio B="
                    f"{capri['lensHeightBMM']} mm corresponde {derived[name]} mm."
                )
        conf = raw_capri.get("confidence")
        capri["confidence"] = (
            {str(k): str(v) for k, v in conf.items()} if isinstance(conf, dict) else {}
        )

    raw_prog = raw.get("progressive") if isinstance(raw.get("progressive"), dict) else {}
    progressive: Dict[str, Any] = {}
    for key, (lo, hi) in PROGRESSIVE_RANGES.items():
        value = _coerce_number(raw_prog.get(key))
        progressive[key] = value
        if value is not None and not (lo <= value <= hi):
            out_of_range.append(key)

    suitable = raw_prog.get("suitable")
    progressive["suitable"] = suitable if isinstance(suitable, bool) else None
    progressive["note"] = _coerce_text(raw_prog.get("note")) or ""

    # The heights are the corridor heights by definition, so fall back to them rather
    # than reporting nothing when the model filled only the facial block.
    for side in ("Right", "Left"):
        if progressive[f"fittingHeight{side}MM"] is None:
            progressive[f"fittingHeight{side}MM"] = facial[f"corridorHeight{side}MM"]

    # And decide suitability ourselves when the model left it out but gave the numbers:
    # this is arithmetic, not judgement, and it is the answer the optician came for.
    heights = [
        progressive["fittingHeightRightMM"],
        progressive["fittingHeightLeftMM"],
    ]
    minimum = progressive["minimumRequiredMM"]
    if progressive["suitable"] is None and minimum is not None and all(h is not None for h in heights):
        progressive["suitable"] = all(h >= minimum for h in heights)

    if progressive["suitable"] is False:
        warnings.append(
            "Altura insuficiente para progresivos: "
            f"{heights[0]}/{heights[1]} mm frente a {minimum} mm requeridos."
        )

    score = _coerce_number(raw_fit.get("score"))
    if score is not None:
        score = max(0.0, min(100.0, score))

    confidence: Dict[str, Dict[str, str]] = {}
    for key, value in raw_conf.items():
        if isinstance(value, dict):
            confidence[str(key)] = {
                "level": _coerce_text(value.get("level")) or "low",
                "source": _coerce_text(value.get("source")) or "estimated",
                "note": _coerce_text(value.get("note")) or "",
            }
        else:
            confidence[str(key)] = {
                "level": _coerce_text(value) or "low",
                "source": "estimated",
                "note": "",
            }

    if not any(v is not None for v in facial.values()):
        warnings.append(
            "El modelo no devolvió ninguna medida facial utilizable. "
            "Revisa la respuesta en bruto."
        )

    return {
        "inputs": inputs,
        "capri": capri,
        "facial": facial,
        "frame": frame,
        "progressive": progressive,
        "fit": {
            "verdict": _coerce_text(raw_fit.get("verdict")) or "",
            "score": score,
            "issues": _coerce_list(raw_fit.get("issues")),
            "recommendations": _coerce_list(raw_fit.get("recommendations")),
        },
        "confidence": confidence,
        "notes": _coerce_list(raw.get("notes")),
        "outOfRange": sorted(set(out_of_range)),
        "warnings": warnings,
    }
