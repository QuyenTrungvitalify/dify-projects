"""Generate additional sample test files for Eiken proofread workflow.

Complements [generate_sample.py](generate_sample.py) (which makes the main
84-question sample) with smaller / specialized files for different test scenarios.

Outputs:
  - sample_smoke_10.xlsx       — Quick 10-question smoke test (fastest iteration)
  - sample_error_heavy.xlsx    — 20 questions with intentional errors (test all error types)
  - sample_gb_english.xlsx     — 20 UK English questions (test language=en-GB)
  - sample_edge_cases.xlsx     — 15 tricky edge cases (multi-line, long, special chars)

Each file ships with .csv counterpart for CSV upload path.
"""

from __future__ import annotations

import csv
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font

PLACEHOLDER = "(          )"

HEADERS = [
    "#", "Item ID", "Grade", "Category 1", "Target", "Stem",
    "Answer Choice 1", "Answer Choice 2", "Answer Choice 3", "Answer Choice 4",
    "Correct Answer Number",
]


def q(stem: str, choices: list[str], correct: int, target: str = "Grammar",
      category: str = "Vocabulary", grade: str = "2") -> dict:
    return {
        "grade": grade, "category": category, "target": target,
        "stem": stem, "choices": choices, "correct": correct,
    }


# =====================================================================
# Sample 1: SMOKE TEST (10 questions, fast iteration)
# =====================================================================
SMOKE_QUESTIONS = [
    # 6 clean (should be filtered out)
    q(f"She {PLACEHOLDER} to school every day.", ["goes", "go", "went", "going"], 1),
    q(f"I {PLACEHOLDER} my homework before lunch.", ["finish", "finished", "finishing", "finishes"], 2),
    q(f"The book is {PLACEHOLDER} the table.", ["in", "on", "at", "by"], 2),
    q(f"He {PLACEHOLDER} speak three languages.", ["can", "should", "must", "may"], 1),
    q(f"She is {PLACEHOLDER} excellent student.", ["a", "an", "the", "some"], 2),
    q(f"They {PLACEHOLDER} dinner when I called.", ["are eating", "ate", "were eating", "eat"], 3),
    # 2 with intentional errors (should appear in output)
    q(f"She have {PLACEHOLDER} apple every morning.", ["a", "an", "the", "some"], 2,
      target="[TEST] Grammar: 'She have' agreement"),
    q(f"He dont {PLACEHOLDER} to read from a paper.", ["want", "wants", "wanted", "wanting"], 1,
      target="[TEST] Spelling: 'dont'"),
    # 2 no-placeholder (data defects, should be filtered)
    q("She goes to school every day.",
      ["walks", "runs", "drives", "rides"], 1, target="[TEST] Missing placeholder"),
    q("The weather is very nice today.",
      ["sunny", "rainy", "cloudy", "snowy"], 1, target="[TEST] Missing placeholder"),
]


# =====================================================================
# Sample 2: ERROR HEAVY (20 questions, lots of intentional errors)
# Tests error detection coverage + Y1 columns populate correctly
# =====================================================================
ERROR_HEAVY_QUESTIONS = [
    # Subject-verb agreement errors (5)
    q(f"She have {PLACEHOLDER} apple every morning.", ["a", "an", "the", "some"], 2,
      target="[TEST] SV-agreement"),
    q(f"He don't {PLACEHOLDER} the answer to that question.", ["know", "knows", "knew", "knowing"], 2,
      target="[TEST] SV with don't"),
    q(f"The students is {PLACEHOLDER} the test now.", ["take", "takes", "taking", "taken"], 3,
      target="[TEST] Plural subject with 'is'"),
    q(f"My family are {PLACEHOLDER} on vacation next week.", ["go", "going", "went", "goes"], 2,
      target="[TEST] 'family are'"),
    q(f"Each of the boys {PLACEHOLDER} present.", ["are", "is", "were", "have been"], 2,
      target="[TEST] 'Each of'"),

    # Spelling errors (5)
    q(f"He dont {PLACEHOLDER} to study tonight.", ["want", "wants", "wanted", "wanting"], 1,
      target="[TEST] dont"),
    q(f"They wont {PLACEHOLDER} the meeting.", ["join", "joins", "joined", "joining"], 1,
      target="[TEST] wont"),
    q(f"She didnt {PLACEHOLDER} her homework yesterday.", ["finish", "finishes", "finished", "finishing"], 1,
      target="[TEST] didnt"),
    q(f"There is alot of {PLACEHOLDER} in this room.", ["furniture", "furnitures", "people", "thing"], 1,
      target="[TEST] alot"),
    q(f"He recieved {PLACEHOLDER} package this morning.", ["a", "an", "the", "some"], 1,
      target="[TEST] recieved"),

    # Article errors (3)
    q(f"She is {PLACEHOLDER} engineer at Google.", ["a", "the", "—", "some"], 1,
      target="[TEST] should be 'an'"),
    q(f"I saw {PLACEHOLDER} elephant at the zoo.", ["a", "the", "some", "—"], 1,
      target="[TEST] 'a elephant'"),
    q(f"He bought {PLACEHOLDER} umbrella for the rain.", ["a", "the", "some", "—"], 1,
      target="[TEST] 'a umbrella'"),

    # Tense errors (4)
    q(f"Yesterday I go to {PLACEHOLDER} store.", ["a", "the", "some", "an"], 2,
      target="[TEST] 'Yesterday I go'"),
    q(f"Last week she eat {PLACEHOLDER} apples.", ["many", "much", "any", "some"], 1,
      target="[TEST] 'Last week she eat'"),
    q(f"Tomorrow I went to {PLACEHOLDER} doctor.", ["a", "the", "some", "an"], 2,
      target="[TEST] 'Tomorrow I went'"),
    q(f"Right now they was {PLACEHOLDER} TV.", ["watch", "watches", "watching", "watched"], 3,
      target="[TEST] 'they was'"),

    # Multi-error potential (3)
    q(f"She have a {PLACEHOLDER} apple and dont like it.", ["red", "delicious", "fresh", "sweet"], 1,
      target="[TEST] Multiple errors per stem"),
    q(f"He are very {PLACEHOLDER} and dont understand it.", ["happy", "tired", "smart", "sad"], 1,
      target="[TEST] Multiple errors per stem"),
    q(f"They was {PLACEHOLDER} TV when she arrive.", ["watch", "watching", "watched", "watches"], 2,
      target="[TEST] Multiple errors per stem"),
]


# =====================================================================
# Sample 3: GB ENGLISH (20 questions, UK spellings + GB-specific grammar)
# Test language=en-GB switch works correctly
# =====================================================================
GB_ENGLISH_QUESTIONS = [
    # Clean GB English (should pass with language=en-GB but flag with en-US)
    q(f"My mum {PLACEHOLDER} the colour of the new car.", ["likes", "like", "liked", "liking"], 1,
      target="GB: mum + colour"),
    q(f"The neighbourhood is {PLACEHOLDER} quiet today.", ["very", "much", "many", "more"], 1,
      target="GB: neighbourhood"),
    q(f"He {PLACEHOLDER} maths in school.", ["studies", "study", "studied", "studying"], 1,
      target="GB: maths"),
    q(f"We had {PLACEHOLDER} fish and chips at the pub.", ["a", "an", "some", "the"], 3,
      target="GB: pub culture"),
    q(f"The lift is {PLACEHOLDER} the corner.", ["in", "on", "at", "by"], 4,
      target="GB: lift (US: elevator)"),
    q(f"She bought new {PLACEHOLDER} for the trip.", ["luggage", "luggages", "baggage", "baggages"], 1,
      target="GB: luggage"),
    q(f"He {PLACEHOLDER} to the cinema with his friends.", ["goes", "go", "went", "going"], 1,
      target="GB: cinema (US: movie theater)"),
    q(f"The biscuits are {PLACEHOLDER} the table.", ["in", "on", "at", "under"], 2,
      target="GB: biscuits (US: cookies)"),
    q(f"My favourite colour is {PLACEHOLDER}.", ["blue", "blueish", "blueing", "blued"], 1,
      target="GB: favourite + colour"),
    q(f"He travelled {PLACEHOLDER} kilometres yesterday.", ["100", "100s", "hundred", "100th"], 1,
      target="GB: travelled + kilometres"),
    q(f"The counsellor {PLACEHOLDER} advice to students.", ["gives", "give", "gave", "given"], 1,
      target="GB: counsellor"),
    q(f"She labelled the {PLACEHOLDER} carefully.", ["box", "boxes", "boxed", "boxing"], 1,
      target="GB: labelled"),
    q(f"They {PLACEHOLDER} the appointment yesterday.", ["cancelled", "cancel", "canceling", "canceled"], 1,
      target="GB: cancelled"),
    q(f"The mum took her child to {PLACEHOLDER} school.", ["a", "the", "—", "some"], 2,
      target="GB: mum"),
    q(f"He apologised for {PLACEHOLDER} the meeting.", ["miss", "missing", "missed", "to miss"], 2,
      target="GB: apologised"),

    # GB English with intentional grammar errors
    q(f"My mum have {PLACEHOLDER} colour pencils.", ["many", "much", "any", "some"], 1,
      target="[TEST] GB grammar: 'mum have'"),
    q(f"The neighbourhood are {PLACEHOLDER} quiet.", ["very", "more", "much", "many"], 1,
      target="[TEST] GB grammar: 'neighbourhood are'"),
    q(f"He dont like {PLACEHOLDER} colour blue.", ["a", "an", "the", "some"], 3,
      target="[TEST] GB grammar: 'dont' + 'the colour'"),
    q(f"She didnt cancelled {PLACEHOLDER} appointment.", ["a", "an", "the", "her"], 4,
      target="[TEST] GB grammar: 'didnt cancelled'"),
    q(f"The maths teacher are {PLACEHOLDER} today.", ["sick", "sicker", "sickly", "sicken"], 1,
      target="[TEST] GB grammar: 'teacher are'"),
]


# =====================================================================
# Sample 4: EDGE CASES (15 tricky scenarios)
# =====================================================================
EDGE_CASE_QUESTIONS = [
    # Multi-line dialog (5)
    q("A: How was your weekend?\n"
      f"B: It was great! I {PLACEHOLDER} my grandparents.",
      ["visit", "visited", "visiting", "have visited"], 2, target="EDGE: A:/B: dialog"),
    q("A: What time is the meeting?\n"
      f"B: It {PLACEHOLDER} at 3 PM in the main room.",
      ["start", "starts", "started", "starting"], 2, target="EDGE: dialog with time"),
    q("A: Did you finish the report?\n"
      f"B: Not yet, but I {PLACEHOLDER} it by tomorrow.",
      ["finish", "finished", "will finish", "have finished"], 3, target="EDGE: dialog future"),
    q("Person A: Where are you going?\n"
      f"Person B: I'm going to {PLACEHOLDER} groceries.",
      ["buy", "buys", "bought", "buying"], 1, target="EDGE: dialog with 'Person'"),
    q("Teacher: Can you explain this concept?\n"
      f"Student: I'll {PLACEHOLDER} my best to explain.",
      ["do", "does", "did", "doing"], 1, target="EDGE: teacher-student dialog"),

    # Very long stem (3)
    q(f"In the late nineteenth century, when industrialization was rapidly transforming "
      f"the economies and societies of Western nations, many workers found themselves "
      f"struggling to {PLACEHOLDER} the new realities of factory labor and urban living.",
      ["adapt", "adapts", "adapted", "adapting"], 4, target="EDGE: very long stem"),
    q(f"Despite the numerous challenges that the research team encountered during the "
      f"course of their lengthy investigation, including limited funding, equipment "
      f"failures, and unfavorable weather conditions, they ultimately {PLACEHOLDER} "
      f"groundbreaking results that surprised the entire scientific community.",
      ["achieve", "achieves", "achieved", "achieving"], 3, target="EDGE: very long stem"),
    q(f"The committee, after carefully reviewing all of the submitted proposals from "
      f"various departments throughout the university, finally {PLACEHOLDER} a decision "
      f"that would significantly affect the institution's research priorities for years to come.",
      ["reach", "reaches", "reached", "reaching"], 3, target="EDGE: very long stem"),

    # Special characters in stem (3)
    q(f"She said \"I {PLACEHOLDER} ready,\" with confidence.",
      ["am", "is", "are", "be"], 1, target="EDGE: quotes in stem"),
    q(f"The recipe calls for 1/2 cup of {PLACEHOLDER}.",
      ["sugar", "sugars", "sweet", "sweets"], 1, target="EDGE: fractions"),
    q(f"He paid $50.99 for {PLACEHOLDER} book.",
      ["a", "an", "the", "some"], 3, target="EDGE: currency"),

    # Tricky choices (2)
    q(f"She {PLACEHOLDER} him about the problem.", ["told", "said", "spoke", "talked"], 1,
      target="EDGE: similar choices (told/said)"),
    q(f"It's been raining {PLACEHOLDER} 3 hours.", ["for", "since", "during", "while"], 1,
      target="EDGE: for/since distinction"),

    # No placeholder defect (1)
    q("She enjoys reading books in her free time.",
      ["novels", "fiction", "stories", "comics"], 1, target="[TEST] No placeholder"),

    # All-same choices (defensive, weird but possible)
    q(f"The {PLACEHOLDER} is on the table.", ["book", "book", "book", "book"], 1,
      target="EDGE: all 4 choices same word"),
]


# =====================================================================
# Helpers
# =====================================================================
def write_files(questions: list[dict], basename: str, fixtures_dir: Path,
                id_prefix: str = "E2") -> tuple[Path, Path]:
    """Write xlsx + csv pair. Returns (xlsx_path, csv_path)."""
    rows = []
    for idx, item in enumerate(questions, start=1):
        rows.append([
            idx,
            f"{id_prefix}-{idx:03d}",
            item["grade"],
            item["category"],
            item["target"],
            item["stem"],
            item["choices"][0], item["choices"][1],
            item["choices"][2], item["choices"][3],
            item["correct"],
        ])

    xlsx_path = fixtures_dir / f"{basename}.xlsx"
    csv_path = fixtures_dir / f"{basename}.csv"

    wb = Workbook()
    ws = wb.active
    ws.title = "Questions"
    ws.append(HEADERS)
    for r in rows:
        ws.append(r)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    wb.save(xlsx_path)

    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(HEADERS)
        writer.writerows(rows)

    return xlsx_path, csv_path


def main():
    fixtures_dir = Path(__file__).parent

    samples = [
        ("sample_smoke_10",     SMOKE_QUESTIONS,        "E2"),
        ("sample_error_heavy",  ERROR_HEAVY_QUESTIONS,  "E2"),
        ("sample_gb_english",   GB_ENGLISH_QUESTIONS,   "GB"),
        ("sample_edge_cases",   EDGE_CASE_QUESTIONS,    "EDGE"),
    ]

    print(f"Generating {len(samples)} sample files in {fixtures_dir}/\n")
    for basename, questions, id_prefix in samples:
        xlsx, csv_path = write_files(questions, basename, fixtures_dir, id_prefix)
        size = xlsx.stat().st_size
        print(f"  ✅ {basename}: {len(questions)} questions ({size:,} bytes xlsx)")

    print(f"\n✅ Done. {len(samples)} xlsx + {len(samples)} csv files generated.")


if __name__ == "__main__":
    main()
