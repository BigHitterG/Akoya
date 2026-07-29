from pathlib import Path
import sys

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "assets" / "docs" / "Akoya-Medical-Clinical-Product-Overview.pdf"

NAVY = HexColor("#17384E")
DARK = HexColor("#17232D")
BLUE = HexColor("#2E7D89")
PINK = HexColor("#DC5577")
PINK_SOFT = HexColor("#F8E5EC")
SURFACE = HexColor("#F4F7F9")
MUTED = HexColor("#526675")
LINE = HexColor("#D8E2E9")


def wrap_text(pdf, text, font, size, max_width):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if pdf.stringWidth(candidate, font, size) <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_wrapped(pdf, text, x, y, max_width, font="Helvetica", size=8.4, leading=11, color=MUTED):
    pdf.setFont(font, size)
    pdf.setFillColor(color)
    lines = wrap_text(pdf, text, font, size, max_width)
    for line in lines:
        pdf.drawString(x, y, line)
        y -= leading
    return y


def rounded_card(pdf, x, y, width, height, fill=SURFACE, stroke=LINE, radius=10):
    pdf.setFillColor(fill)
    pdf.setStrokeColor(stroke)
    pdf.roundRect(x, y, width, height, radius, fill=1, stroke=1)


def build(output_path):
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    pdf = canvas.Canvas(str(output), pagesize=letter)
    width, height = letter
    margin = 36

    pdf.setTitle("Akoya Medical Clinical Product Overview")
    pdf.setAuthor("Akoya Medical, LLC")
    pdf.setSubject("Akoya Eye Shield product and evaluation overview")

    # Header
    logo_path = ROOT / "assets" / "images" / "IMG_1997.png"
    if logo_path.exists():
        pdf.drawImage(ImageReader(str(logo_path)), margin, height - 67, 34, 34, preserveAspectRatio=True, mask="auto")
    pdf.setFillColor(NAVY)
    pdf.setFont("Helvetica-Bold", 15)
    pdf.drawString(margin + 44, height - 45, "AKOYA MEDICAL")
    pdf.setFillColor(MUTED)
    pdf.setFont("Helvetica-Bold", 7.5)
    pdf.drawString(margin + 44, height - 59, "CLINICAL PRODUCT OVERVIEW")
    pdf.setStrokeColor(LINE)
    pdf.line(margin, height - 78, width - margin, height - 78)

    # Hero
    pdf.setFillColor(PINK)
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawString(margin, height - 99, "PATIENT-COMFORT PRODUCT")
    pdf.setFillColor(DARK)
    pdf.setFont("Helvetica-Bold", 25)
    pdf.drawString(margin, height - 128, "A focused visual barrier")
    pdf.drawString(margin, height - 157, "for needle-based care")
    hero_y = draw_wrapped(
        pdf,
        "Akoya Eye Shield is a single-patient-use, nonsterile visual barrier designed to limit a patient's view of procedural activity below eye level while leaving an upper viewing area open.",
        margin,
        height - 178,
        316,
        size=9.5,
        leading=13,
    )
    pill_y = hero_y - 8
    pdf.setFillColor(PINK)
    pdf.roundRect(margin, pill_y - 18, 112, 20, 10, fill=1, stroke=0)
    pdf.setFillColor(white)
    pdf.setFont("Helvetica-Bold", 7.3)
    pdf.drawCentredString(margin + 56, pill_y - 11, "SINGLE-PATIENT USE")

    product_path = ROOT / "assets" / "images" / "Product Image 1.JPG"
    image_x, image_y, image_w, image_h = 389, height - 236, 187, 135
    rounded_card(pdf, image_x, image_y, image_w, image_h)
    if product_path.exists():
        pdf.drawImage(ImageReader(str(product_path)), image_x + 12, image_y + 22, image_w - 24, image_h - 32, preserveAspectRatio=True, anchor="c", mask="auto")
    pdf.setFillColor(DARK)
    pdf.setFont("Helvetica-Bold", 8.2)
    pdf.drawString(image_x + 12, image_y + 9, "AKOYA EYE SHIELD")

    # Mechanism and facts
    section_top = height - 268
    card_w = (width - (2 * margin) - 14) / 2
    rounded_card(pdf, margin, section_top - 116, card_w, 116, fill=HexColor("#EDF4F5"))
    rounded_card(pdf, margin + card_w + 14, section_top - 116, card_w, 116, fill=white)

    pdf.setFillColor(BLUE)
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawString(margin + 14, section_top - 18, "WHAT THE DESIGN DOES")
    pdf.setFillColor(DARK)
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(margin + 14, section_top - 40, "Limits the lower procedural view")
    draw_wrapped(pdf, "An opaque lower region and conformable interface are designed to limit visibility below eye level.", margin + 14, section_top - 55, card_w - 28, size=8, leading=10)
    pdf.setFillColor(DARK)
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(margin + 14, section_top - 88, "Leaves an upper viewing area open")
    draw_wrapped(pdf, "The open upper area allows partial forward or upward visibility.", margin + 14, section_top - 103, card_w - 28, size=8, leading=10)

    facts_x = margin + card_w + 28
    pdf.setFillColor(BLUE)
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawString(facts_x, section_top - 18, "CURRENT PRODUCT FACTS")
    facts = [
        "Single-patient use; not intended for reuse",
        "Nonsterile",
        "Latex-free",
        "Assembled in the USA",
        "Available by quote in flexible quantities",
    ]
    fact_y = section_top - 41
    for fact in facts:
        pdf.setFillColor(PINK)
        pdf.circle(facts_x + 3, fact_y + 2, 2.4, fill=1, stroke=0)
        pdf.setFillColor(DARK)
        pdf.setFont("Helvetica", 8.4)
        pdf.drawString(facts_x + 13, fact_y, fact)
        fact_y -= 15

    # Proposed settings
    settings_top = section_top - 138
    pdf.setFillColor(BLUE)
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawString(margin, settings_top, "SETTINGS PROPOSED FOR ORGANIZATIONAL REVIEW")
    settings = ["IV placement", "Port access", "Blood draws", "Selected injections"]
    box_gap = 10
    box_w = (width - 2 * margin - 3 * box_gap) / 4
    for index, setting in enumerate(settings):
        x = margin + index * (box_w + box_gap)
        rounded_card(pdf, x, settings_top - 39, box_w, 29, fill=SURFACE)
        pdf.setFillColor(DARK)
        pdf.setFont("Helvetica-Bold", 8)
        pdf.drawCentredString(x + box_w / 2, settings_top - 28, setting)

    # Evaluation path
    path_top = settings_top - 62
    pdf.setFillColor(BLUE)
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawString(margin, path_top, "SUGGESTED ORGANIZATION-LED EVALUATION")
    pdf.setFillColor(DARK)
    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawString(margin, path_top - 20, "A 30-day, one-site starting framework")
    path_cards_y = path_top - 99
    path_w = (width - 2 * margin - 18) / 3
    steps = [
        ("01", "PRODUCT REVIEW", "Akoya supplies samples, available documentation, and a brief staff demonstration."),
        ("02", "ONE-SITE EVALUATION", "The organization sets the site, scope, patients, duration, and applicable requirements."),
        ("03", "NEXT-STEP DECISION", "The organization decides whether pricing or a paid rollout discussion is appropriate."),
    ]
    for index, (number, title, body) in enumerate(steps):
        x = margin + index * (path_w + 9)
        rounded_card(pdf, x, path_cards_y, path_w, 68, fill=SURFACE)
        pdf.setFillColor(PINK)
        pdf.setFont("Helvetica-Bold", 8)
        pdf.drawString(x + 11, path_cards_y + 51, number)
        pdf.setFillColor(DARK)
        pdf.setFont("Helvetica-Bold", 7.5)
        pdf.drawString(x + 34, path_cards_y + 51, title)
        draw_wrapped(pdf, body, x + 11, path_cards_y + 35, path_w - 22, size=7, leading=8.5)

    # Feedback and patent
    info_y = path_cards_y - 81
    info_w = (width - 2 * margin - 14) / 2
    rounded_card(pdf, margin, info_y, info_w, 66, fill=PINK_SOFT, stroke=PINK_SOFT)
    rounded_card(pdf, margin + info_w + 14, info_y, info_w, 66, fill=NAVY, stroke=NAVY)
    pdf.setFillColor(PINK)
    pdf.setFont("Helvetica-Bold", 7.5)
    pdf.drawString(margin + 12, info_y + 49, "INITIAL PATIENT-REPORTED FEEDBACK")
    draw_wrapped(pdf, "45 completed questionnaires among 50 patients in a breast-biopsy setting. Descriptive feedback only; not a controlled clinical study.", margin + 12, info_y + 35, info_w - 24, size=7.3, leading=9, color=DARK)
    pdf.setFillColor(white)
    pdf.setFont("Helvetica-Bold", 7.5)
    pdf.drawString(margin + info_w + 26, info_y + 49, "PATENT INFORMATION")
    draw_wrapped(pdf, "Technology and method described in U.S. Patent No. 12,629,282 B1, issued May 19, 2026. Inventors: Drew Richard Zaun and Thomas Raymond Goetz.", margin + info_w + 26, info_y + 35, info_w - 24, size=7.3, leading=9, color=white)

    # Contact footer
    footer_y = 52
    pdf.setStrokeColor(LINE)
    pdf.line(margin, footer_y + 49, width - margin, footer_y + 49)
    pdf.setFillColor(DARK)
    pdf.setFont("Helvetica-Bold", 8.5)
    pdf.drawString(margin, footer_y + 34, "Tom Goetz")
    pdf.drawString(213, footer_y + 34, "Drew Zaun")
    pdf.setFillColor(MUTED)
    pdf.setFont("Helvetica", 7.3)
    pdf.drawString(margin, footer_y + 22, "Co-Owner & Head of Product")
    pdf.drawString(213, footer_y + 22, "Co-Owner & Chief Sales & Marketing Officer")
    pdf.setFillColor(NAVY)
    pdf.setFont("Helvetica-Bold", 7.8)
    pdf.drawString(margin, footer_y + 7, "tgoetz@akoyamedical.com")
    pdf.drawString(213, footer_y + 7, "dzaun@akoyamedical.com")
    pdf.drawRightString(width - margin, footer_y + 26, "515-587-5863")
    pdf.drawRightString(width - margin, footer_y + 10, "akoyamedical.com")
    pdf.setFillColor(MUTED)
    pdf.setFont("Helvetica", 5.9)
    pdf.drawCentredString(width / 2, 24, "For product-evaluation discussion. No clinical outcome is guaranteed. Each organization controls its own clinical, compliance, privacy, and procurement review.")

    pdf.showPage()
    pdf.save()
    return output


if __name__ == "__main__":
    destination = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT
    print(build(destination))
