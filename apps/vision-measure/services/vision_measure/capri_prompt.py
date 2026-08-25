"""
The Capri Optics fitting protocol, as a prompt.

The operator types a model identifier and the protocol is applied to it. Nothing here
validates that identifier against a local list: whatever is typed is passed to the model,
which looks the model up and reports what it finds.

What the protocol does insist on is the failure mode. When the published dimensions
cannot be found or verified, the answer is NOT DETECTED — a null, said plainly — never a
plausible-looking number. That is the one rule worth being rigid about here: every figure
downstream (B/2, B-11, the placement on the face) is derived from A and B, so an invented
B would propagate silently through the entire report wearing the appearance of a
supplier-published measurement.
"""

import re
from typing import Any, Dict, List, Optional

# Progressive corridors need roughly 11 mm below the fitting cross; the bifocal segment
# sits 5 mm below the geometric centre. The protocol's own constants.
BIFOCAL_DROP_MM = 5.0
PROGRESSIVE_DROP_MM = 11.0


def fitting_heights(b_mm: Optional[float]) -> Dict[str, Optional[float]]:
    """
    The three heights of the protocol, measured from the TOP EDGE of the lens.

    Pure arithmetic on whatever B the model reported — it looks nothing up. Having our
    own figure is what lets the report show when the model's own arithmetic disagrees.
    """
    if b_mm is None:
        return {"monofocal": None, "bifocal": None, "progressive": None}
    return {
        "monofocal": round(b_mm / 2.0, 1),
        "bifocal": round(b_mm / 2.0 - BIFOCAL_DROP_MM, 1),
        "progressive": round(b_mm - PROGRESSIVE_DROP_MM, 1),
    }


PRODUCT_URL_TEMPLATE = "https://caprioptics.com/product/{slug}/"

# Capri product URLs are the model code, lowercased: DC210 -> /product/dc210/. Verified
# against dc210 and dc404. The operator types more than the code ("DC210 Black Green
# Red"), so the code is pulled out rather than slugifying the whole string.
_MODEL_CODE = re.compile(r"[A-Za-z]{1,5}\s*-?\s*\d{2,5}[A-Za-z]?")


def candidate_urls(frame_id: str) -> List[str]:
    """
    The product pages worth opening for this identifier, most likely first.

    Returns [] when no model code can be read out of the text. An empty list is the
    signal not to enable browsing at all: offering the model a URL built from noise is
    worse than offering none, because a 404 reads like "the frame does not exist".
    """
    text = (frame_id or "").strip()
    if not text:
        return []

    urls: List[str] = []
    seen = set()
    for match in _MODEL_CODE.finditer(text):
        slug = re.sub(r"[\s-]+", "", match.group(0)).lower()
        if slug and slug not in seen:
            seen.add(slug)
            urls.append(PRODUCT_URL_TEMPLATE.format(slug=slug))
    return urls[:3]


_PRODUCT_DATA = """PART 1 — CAPRI OPTICS PRODUCT DATA

Identify the exact Capri Optics brand, model and colour for the identifier given above.

Primary source: https://caprioptics.com/  — for example
https://caprioptics.com/product/dc404/
{url_block}
HOW A CAPRI PRODUCT PAGE IS LAID OUT. Verified against the live DC210 and DC404 pages,
so look for these exact labels rather than hunting for a generic table:

  * A TECHNICAL TABLE with one ROW PER COLOUR VARIANT and the columns:
        A | B | ED | Circ | UPC
    plus a boxed size written like "51- 19- 145" (eye - bridge - temple).
    THIS TABLE IS THE AUTHORITATIVE SOURCE. Read the row whose colour matches the
    identifier above. Example row from DC210: A = 53.8, B = 42.4, ED = 57.4, Circ = 158.3.

  * SUMMARY FIELDS that give a RANGE across every variant, not one frame:
        "Eye size (mm): 51-53 mm"       -> the nominal A range
        "B Measurement: 41-50 mm"       -> the nominal B range
        "Bridge size (mm): 18-19 mm"    -> the DBL range
        "Temple length (mm): 145-150 mm"

ORDER OF PREFERENCE, strictly:
  1. The technical-table row for THIS colour. Use it whenever you can identify the row.
  2. If the colour cannot be matched but the table exists, use the row that the boxed size
     matches, and say in "notes" which row you took.
  3. Only if there is no usable row at all, take the midpoint of the summary range, set
     "bSource" accordingly and say in "notes" that the figure is a nominal range midpoint
     and not this frame's published dimension.

"Eye size" IS the nominal A -- the horizontal lens dimension. Do not treat it as unusable
just because it appears as a range: a labelled range from the manufacturer is a far better
answer than a null. What "Eye size" is NOT is B.

IF YOU CANNOT REACH OR FIND THE PAGE, OR CANNOT VERIFY A VALUE:
report that value as NOT DETECTED — leave it null in the JSON and say so in "notes".
Never substitute a guess, a typical value, or a figure inferred from the frame photograph
and presented as if the supplier had published it. A null is the correct answer here; an
invented millimetre is not, because A and B drive every calculation that follows.

READ THE BOXED SIZE CORRECTLY. "53-17-145" means 53 mm eye size, 17 mm bridge/DBL,
145 mm temple length. So from that string:
    A  = 53 (nominal)      DBL = 17        temple = 145
    B  is NOT 17. B never comes from the boxed size. The 17 is the bridge.
Whenever the technical table gives an explicit A and B, those override the boxed size.

For example, for DC404:  A = 53.8 mm, B = 42.2 mm, ED = 60.3 mm, Circ = 164.6 mm,
boxed size 53-17-145.

DO NOT return the whole block as null when the page loaded. If you reached the page, you
have at minimum the boxed size and the summary ranges, which give A, DBL and the temple
length. Report what you have and mark the rest NOT DETECTED, field by field. An all-null
answer from a page you successfully opened is a reading failure, not an absent dimension.

PART 2 — A AND B

A is the horizontal dimension of one lens: a horizontal line through the geometric centre
of that lens. B is the vertical dimension of one lens: a vertical line through the same
centre. Their intersection is the geometric centre of the lens. All fitting heights are
measured from the TOP EDGE of the lens.

PART 3 — FALLBACK RULE FOR B

If B is not available but A is, use B = A and state clearly:
"Fallback applied: B was not provided by the source, therefore B = A was used."

If B is published as a range, use the nominal value — "B = 31-40 mm" gives B = 35.5 mm —
and say that B is a nominal/coarse value.

Never invent a B. Do not use bridge width, temple length or the commercial frame size
as B. If neither A nor B can be established, report both as NOT DETECTED and leave the
three fitting heights null as well.
"""


_HEIGHTS = f"""PART 4 — OPTICAL FITTING HEIGHTS

  H_monofocal   = B / 2
  H_bifocal     = (B / 2) - {BIFOCAL_DROP_MM:.0f}      (a SUBTRACTION; never + {BIFOCAL_DROP_MM:.0f})
  H_progressive = B - {PROGRESSIVE_DROP_MM:.0f}

Measured from the TOP EDGE of the lens. Round to ONE decimal place.

PART 5 — WORKED EXAMPLE

For DC404 with A = 53.8, B = 42.2, ED = 60.3, DBL = 17:
  monofocal    42.2 / 2 = 21.1 mm
  bifocal      21.1 - 5 = 16.1 mm
  progressive  42.2 - 11 = 31.2 mm
"""


_PERSON_ANALYSIS = """PART 6 — FRONTAL IMAGE ANALYSIS

IMAGE 1 is a frontal photograph of the person. Analyse it VISUALLY.

Do NOT use or mention facial-landmark frameworks (MediaPipe, dlib, FaceMesh, OpenCV
landmarks or any other), and do not produce landmark coordinates. Visual analysis only,
together with the known physical dimensions of the frame.

Estimate, labelling each "Visual estimate from frontal image": apparent left and right eye
positions, apparent eye-to-eye distance, apparent nasal bridge location and width,
apparent nose width, approximate face centre, vertical symmetry, head rotation relative to
the camera, image resolution and usable scale references.

PART 7 — NASAL BRIDGE WIDTH

The horizontal width of the nasal bridge AT THE HEIGHT WHERE THE FRAME BRIDGE WILL SIT.
Do not confuse it with nose width, nostril width, interpupillary distance, or the frame's
own bridge width. If the image carries no reliable physical scale, explain how you
estimated the scale.

PART 8 — FRAME BRIDGE WIDTH

Prefer the supplier's DBL / Bridge / Bridge Size. From "53-17-145" the bridge is 17 mm.
For a published range such as 20-22 mm use the nominal 21 mm, and distinguish the range
from the nominal value. Do NOT use B as the bridge width. If it cannot be established,
report NOT DETECTED.

PART 9 — BRIDGE COMPARISON

  Bridge Width Difference    = Frame Bridge Width - Person Nasal Bridge Width
  Absolute Bridge Difference = ABS(of the above)

Interpret as "approximately compatible", "the frame bridge is wider than the estimated
nasal bridge", or "narrower". Do NOT claim clinical suitability.

PART 10 — VERTICAL POSITIONING

The frame bridge should sit 2 mm ABOVE the person's estimated nasal bridge. With image Y
increasing downward:

  Target frame bridge Y = Person nasal bridge Y - (2 mm expressed in pixels)

PART 11 — IMAGE SCALE

Derive millimetres per pixel from the frame's known physical dimensions, preferring A. If
the visible A occupies X pixels, pixels per mm = X / A, and 2 mm = 2 x that. The frame
photo and the person photo are separate photographs at different scales: derive each
independently and transform the frame into the person's image coordinates.

If A was NOT DETECTED, the scale cannot be established from it — say so, and report the
pixel figures as NOT DETECTED rather than deriving them from an assumed A.

PART 12 — HORIZONTAL POSITIONING

Centre the frame on the person's visual facial centre, then refine against apparent eye
positions, the bridge position, the nasal bridge position and the symmetry of the frame on
the face. Report the person's visual centre, the frame's centre and the horizontal offset.

PART 13 — SCALE ON THE FACE

Estimate the frame's apparent scale relative to the face from A, B, DBL and ED. Where the
person's image has no known physical scale, use the visual relationships between frame
width, apparent eye-to-eye distance, apparent nasal bridge width and apparent face width,
and label the result "Estimated visual scale".

PART 14 — CONFIDENCE AND LIMITATIONS

Give HIGH / MEDIUM / LOW for A, B, the optical heights, the nasal bridge position and
width, the frame scale, and the horizontal and vertical placement. Explain any
uncertainty.

A single frontal image cannot give the true 3D depth of a nasal bridge. Never claim the
anatomy was measured. The correct terms are "estimated apparent nasal bridge position" and
"estimated apparent nasal bridge width". This is a virtual try-on / visual fitting
estimation, not a clinical measurement.

Never hide an intermediate value. Never invent a measurement. Always distinguish
supplier-published figures, nominal values, visual estimates, calculated values and
assumptions, so another engineer could reproduce every step.
"""


CAPRI_SCHEMA = """PART 15 — OUTPUT

Fill this block inside your JSON answer. It is the protocol's summary table, and it is
what the optician reads first. Anything you could not establish stays null — that IS the
"not detected" answer, and it is always preferable to a fabricated number:

  "capri": {
    "frameId": string|null,
    "brand": string|null,
    "model": string|null,
    "color": string|null,
    "commercialSize": string|null,
    "sourceUrl": string|null,
    "lensWidthAMM": number|null,
    "lensHeightBMM": number|null,
    "edMM": number|null,
    "circMM": number|null,
    "bridgeDBLMM": number|null,
    "templeLengthMM": number|null,
    "bSource": string,
    "monofocalHeightMM": number|null,
    "bifocalHeightMM": number|null,
    "progressiveHeightMM": number|null,
    "personNasalBridgeWidthMM": number|null,
    "bridgeWidthDifferenceMM": number|null,
    "verticalOffsetAboveBridgeMM": number|null,
    "pixelsPerMM": number|null,
    "verticalOffsetPx": number|null,
    "horizontalAdjustmentPx": number|null,
    "verticalAdjustmentPx": number|null,
    "headRotationNote": string,
    "confidence": { "<field>": "HIGH"|"MEDIUM"|"LOW" },
    "notes": [string]
  }

"bSource" says where B came from: "supplier_published", "nominal_from_range",
"fallback_b_equals_a", or "not_detected".
"verticalOffsetAboveBridgeMM" is 2.0 unless you have a stated reason to differ.
"""


def build_capri_prompt(frame_id: str) -> Dict[str, Any]:
    """
    Returns {"text": ...} for the Capri protocol applied to `frame_id`.

    The identifier is passed through exactly as typed. Nothing is looked up, filtered or
    rejected here — the model does the lookup and says what it found, or reports NOT
    DETECTED.
    """
    identifier = (frame_id or "").strip()
    urls = candidate_urls(identifier)

    # With a URL-reading tool enabled, naming the exact page is what turns "search the
    # web" into an instruction the model can actually carry out. Without the tool these
    # lines are inert text, so they are safe to emit either way.
    url_block = (
        "\nOPEN THESE PAGES DIRECTLY. They are the product pages for this identifier,\n"
        "most likely first. Read the technical table on the page you reach:\n"
        + "\n".join(f"  {u}" for u in urls)
        + "\n\nIf a page does not load or does not correspond to this model, say so in\n"
        '"notes" and report the values as NOT DETECTED.\n'
        if urls
        else ""
    )

    role = (
        "Act as an ophthalmic optics specialist, eyewear-frame geometry expert, "
        "computer-vision analyst, and virtual try-on specialist.\n\n"
        f'The operator is fitting the Capri Optics model identified as: "{identifier}".\n\n'
        "Analyse that model together with the frontal photograph of the person and "
        "determine: the frame's technical dimensions; the monofocal, bifocal and "
        "progressive fitting heights; the person's apparent nasal bridge position and "
        "width; the frame's bridge width; the horizontal and vertical positioning needed "
        "to place the frame correctly on that face; how far above the nasal bridge the "
        "frame should sit; and every intermediate measurement and calculation.\n"
    )

    return {
        "browseUrls": urls,
        "text": "\n".join(
            [
                "=== CAPRI OPTICS FITTING PROTOCOL ===",
                role,
                _PRODUCT_DATA.format(url_block=url_block),
                _HEIGHTS,
                _PERSON_ANALYSIS,
                CAPRI_SCHEMA,
            ]
        ),
        "frameId": identifier,
    }
