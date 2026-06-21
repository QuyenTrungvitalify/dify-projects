"""Generate sample_84_questions.xlsx for testing Eiken proofread workflow.

Outputs:
  - sample_84_questions.xlsx — 84 Eiken-style fill-in-the-blank questions
  - sample_84_questions.csv  — same data in CSV format (alternate upload path)
  - README.md                — what's in the file + intentional test cases

Question distribution (84 total):
  - 70 clean grammar fill-in-blank (single-line stem)   → most should pass LT clean
  - 8 multi-line dialog A:/B: format                    → tests multi-line handling
  - 3 intentional grammar issues in stem text          → tests LT error detection
  - 3 no-placeholder rows (data defect)                 → tests filter logic
"""

from __future__ import annotations

import csv
from pathlib import Path

from openpyxl import Workbook

PLACEHOLDER = "(          )"  # 10 spaces — matches current workflow PLACEHOLDER

# Column headers must match parse logic in main.yml node "10問づつバッチ分割"
HEADERS = [
    "#",
    "Item ID",
    "Grade",
    "Category 1",
    "Target",
    "Stem",
    "Answer Choice 1",
    "Answer Choice 2",
    "Answer Choice 3",
    "Answer Choice 4",
    "Correct Answer Number",
]


def q(stem: str, choices: list[str], correct: int, target: str = "Grammar",
      category: str = "Vocabulary", grade: str = "2") -> dict:
    """Build a question dict. correct is 1-indexed."""
    return {
        "grade": grade,
        "category": category,
        "target": target,
        "stem": stem,
        "choices": choices,
        "correct": correct,
    }


# ----- 70 clean single-line questions across grammar topics -----

CLEAN_QUESTIONS = [
    # Verb tense (15)
    q(f"She {PLACEHOLDER} to school every day.", ["goes", "go", "went", "going"], 1),
    q(f"They {PLACEHOLDER} dinner when I called.", ["are eating", "ate", "were eating", "eat"], 3),
    q(f"I {PLACEHOLDER} my homework before lunch.", ["finish", "finished", "finishing", "finishes"], 2),
    q(f"He {PLACEHOLDER} to Paris next month.", ["goes", "went", "is going", "go"], 3),
    q(f"We {PLACEHOLDER} here since 2020.", ["live", "lived", "have lived", "are living"], 3),
    q(f"The train {PLACEHOLDER} at 9 PM yesterday.", ["leaves", "left", "is leaving", "has left"], 2),
    q(f"By next year, she {PLACEHOLDER} graduated.", ["will have", "has", "is", "had"], 1),
    q(f"If it {PLACEHOLDER} tomorrow, we will stay home.", ["rains", "rained", "will rain", "raining"], 1),
    q(f"He {PLACEHOLDER} TV when his phone rang.", ["watches", "watched", "was watching", "watching"], 3),
    q(f"I {PLACEHOLDER} him at the party last night.", ["meet", "met", "have met", "meeting"], 2),
    q(f"By the time you arrive, I {PLACEHOLDER} cooking.", ["finish", "finished", "will have finished", "am finishing"], 3),
    q(f"She {PLACEHOLDER} in this office for ten years.", ["works", "worked", "has worked", "is working"], 3),
    q(f"They {PLACEHOLDER} the project last week.", ["complete", "completed", "have completed", "completing"], 2),
    q(f"He {PLACEHOLDER} the news when I told him.", ["already knows", "already knew", "had already known", "is knowing"], 3),
    q(f"We {PLACEHOLDER} dinner at 7 PM tonight.", ["have", "had", "will have", "having"], 3),

    # Articles (10)
    q(f"She is {PLACEHOLDER} excellent student.", ["a", "an", "the", "some"], 2),
    q(f"I bought {PLACEHOLDER} apple from the store.", ["a", "an", "the", "any"], 2),
    q(f"He plays {PLACEHOLDER} guitar very well.", ["a", "an", "the", "—"], 3),
    q(f"{PLACEHOLDER} sun rises in the east.", ["A", "An", "The", "—"], 3),
    q(f"Can you pass me {PLACEHOLDER} salt, please?", ["a", "an", "the", "some"], 3),
    q(f"She has {PLACEHOLDER} hour to finish the test.", ["a", "an", "the", "some"], 2),
    q(f"He wants to be {PLACEHOLDER} doctor someday.", ["a", "an", "the", "—"], 1),
    q(f"They live in {PLACEHOLDER} United States.", ["a", "an", "the", "—"], 3),
    q(f"I saw {PLACEHOLDER} movie you recommended.", ["a", "an", "the", "some"], 3),
    q(f"She is reading {PLACEHOLDER} interesting book.", ["a", "an", "the", "some"], 2),

    # Prepositions (10)
    q(f"The meeting is {PLACEHOLDER} 3 PM.", ["in", "on", "at", "by"], 3),
    q(f"She was born {PLACEHOLDER} July.", ["in", "on", "at", "by"], 1),
    q(f"My birthday is {PLACEHOLDER} Sunday.", ["in", "on", "at", "by"], 2),
    q(f"He arrived {PLACEHOLDER} the airport early.", ["in", "on", "at", "to"], 3),
    q(f"The book is {PLACEHOLDER} the table.", ["in", "on", "at", "by"], 2),
    q(f"I'm going {PLACEHOLDER} vacation next week.", ["in", "on", "at", "to"], 2),
    q(f"She lives {PLACEHOLDER} a small village.", ["in", "on", "at", "by"], 1),
    q(f"He works {PLACEHOLDER} a hospital.", ["in", "on", "at", "by"], 3),
    q(f"The cat jumped {PLACEHOLDER} the table.", ["in", "on", "onto", "by"], 3),
    q(f"She walked {PLACEHOLDER} the park.", ["in", "on", "through", "by"], 3),

    # Conjunctions (8)
    q(f"He was tired, {PLACEHOLDER} he kept working.", ["and", "but", "because", "so"], 2),
    q(f"She studied hard, {PLACEHOLDER} she passed the exam.", ["and", "but", "because", "so"], 4),
    q(f"I stayed home {PLACEHOLDER} it was raining.", ["and", "but", "because", "so"], 3),
    q(f"{PLACEHOLDER} he was sick, he went to work.", ["Because", "Although", "Since", "While"], 2),
    q(f"You can have tea {PLACEHOLDER} coffee.", ["and", "but", "or", "so"], 3),
    q(f"He will call you {PLACEHOLDER} he arrives.", ["when", "while", "until", "during"], 1),
    q(f"She sang {PLACEHOLDER} she danced.", ["and", "but", "because", "so"], 1),
    q(f"I'll wait here {PLACEHOLDER} you come back.", ["when", "while", "until", "during"], 3),

    # Subject-verb agreement (10)
    q(f"Each of the students {PLACEHOLDER} a book.", ["have", "has", "having", "are having"], 2),
    q(f"Neither of them {PLACEHOLDER} the answer.", ["know", "knows", "knowing", "are knowing"], 2),
    q(f"The news {PLACEHOLDER} surprising.", ["are", "is", "were", "have been"], 2),
    q(f"Ten dollars {PLACEHOLDER} a lot for a sandwich.", ["are", "is", "were", "have been"], 2),
    q(f"My family {PLACEHOLDER} going on vacation.", ["is", "are", "were", "have"], 1),
    q(f"The teacher and the students {PLACEHOLDER} talking.", ["is", "are", "was", "has been"], 2),
    q(f"Everybody {PLACEHOLDER} a chance to speak.", ["have", "has", "having", "are having"], 2),
    q(f"There {PLACEHOLDER} many books on the shelf.", ["is", "are", "was", "has"], 2),
    q(f"Mathematics {PLACEHOLDER} my favorite subject.", ["are", "is", "were", "have been"], 2),
    q(f"The committee {PLACEHOLDER} reached a decision.", ["have", "has", "having", "are having"], 2),

    # Modal verbs (8)
    q(f"You {PLACEHOLDER} finish your work before lunch.", ["can", "should", "must", "may"], 3),
    q(f"It {PLACEHOLDER} rain tomorrow.", ["can", "should", "must", "might"], 4),
    q(f"He {PLACEHOLDER} speak three languages.", ["can", "should", "must", "may"], 1),
    q(f"You {PLACEHOLDER} not enter without permission.", ["can", "should", "must", "may"], 3),
    q(f"She {PLACEHOLDER} be at home now; her car is here.", ["can", "should", "must", "may"], 3),
    q(f"{PLACEHOLDER} I borrow your pen?", ["Can", "Should", "Must", "Will"], 1),
    q(f"You {PLACEHOLDER} eat too much sugar.", ["shouldn't", "couldn't", "mustn't", "wouldn't"], 1),
    q(f"He {PLACEHOLDER} have forgotten the meeting.", ["can", "should", "must", "may"], 4),

    # Quantifiers (5)
    q(f"There aren't {PLACEHOLDER} apples in the basket.", ["some", "any", "much", "a lot"], 2),
    q(f"How {PLACEHOLDER} time do you need?", ["many", "much", "some", "few"], 2),
    q(f"She has {PLACEHOLDER} friends in the city.", ["many", "much", "any", "a little"], 1),
    q(f"There is {PLACEHOLDER} water in the bottle.", ["many", "few", "a little", "a few"], 3),
    q(f"I have {PLACEHOLDER} questions to ask.", ["a few", "a little", "much", "any"], 1),

    # Comparatives (4)
    q(f"This book is {PLACEHOLDER} than that one.", ["interesting", "more interesting", "most interesting", "interest"], 2),
    q(f"She is the {PLACEHOLDER} student in her class.", ["smart", "smarter", "smartest", "more smart"], 3),
    q(f"He runs {PLACEHOLDER} than his brother.", ["fast", "faster", "fastest", "more fast"], 2),
    q(f"This is the {PLACEHOLDER} day of my life.", ["good", "better", "best", "well"], 3),
]


# ----- 8 multi-line dialog questions (A:/B: format) -----

DIALOG_QUESTIONS = [
    q("A: How are you going to prepare for your history presentation?\n"
      f"B: I'm going to learn the speech {PLACEHOLDER}. I don't want to read from a paper.",
      ["on duty", "in return", "by heart", "for sure"], 3, target="Idiom"),
    q("A: What did you do last weekend?\n"
      f"B: I {PLACEHOLDER} my grandparents in the countryside.",
      ["visit", "visited", "visiting", "have visited"], 2, target="Past Tense"),
    q("A: Where is the meeting going to be held?\n"
      f"B: It will be {PLACEHOLDER} the main conference room.",
      ["in", "on", "at", "by"], 1, target="Preposition"),
    q("A: Have you finished the report?\n"
      f"B: Not yet, but I {PLACEHOLDER} it by Friday.",
      ["finish", "finished", "will finish", "have finished"], 3, target="Future Tense"),
    q("A: Do you know who broke the window?\n"
      f"B: I think it {PLACEHOLDER} have been the children.",
      ["can", "should", "must", "may"], 3, target="Modal Verb"),
    q("A: Why didn't you come to the party?\n"
      f"B: I would have come, {PLACEHOLDER} I had to work late.",
      ["and", "but", "because", "so"], 2, target="Conjunction"),
    q("A: How long have you been studying English?\n"
      f"B: I {PLACEHOLDER} English for five years.",
      ["study", "studied", "have studied", "am studying"], 3, target="Present Perfect"),
    q("A: Is there anything I can help you with?\n"
      f"B: Yes, could you please pass me {PLACEHOLDER} salt?",
      ["a", "an", "the", "some"], 3, target="Article"),
]


# ----- 3 questions with intentional grammar issues -----
# These are designed so even after picking the "correct" answer, LT may flag.
# Useful to verify the workflow's filter/display of errors.

ERROR_QUESTIONS = [
    # Stem itself has subject-verb mismatch even after fill — LT should catch
    q(f"She have {PLACEHOLDER} apple every morning.",
      ["a", "an", "the", "some"], 2, target="[TEST] Stem grammar error"),
    # Article + double word
    q(f"He dont {PLACEHOLDER} to read from a paper.",
      ["want", "wants", "wanted", "wanting"], 1, target="[TEST] Spelling 'dont'"),
    # Awkward but technically valid — may trigger style suggestion
    q(f"There is {PLACEHOLDER} of people waiting outside the store.",
      ["alot", "a lot", "lots", "many"], 1, target="[TEST] 'alot' typo as correct choice"),
]


# ----- 3 questions WITHOUT placeholder (data defect) -----
# These test the filter logic that drops items without placeholder.

NO_PLACEHOLDER_QUESTIONS = [
    q("She goes to school every day.",
      ["walks", "runs", "drives", "rides"], 1, target="[TEST] Missing placeholder"),
    q("The weather is very nice today.",
      ["sunny", "rainy", "cloudy", "snowy"], 1, target="[TEST] Missing placeholder"),
    q("He bought a new car last week.",
      ["red", "blue", "green", "white"], 1, target="[TEST] Missing placeholder"),
]


def main():
    fixtures_dir = Path(__file__).parent
    xlsx_path = fixtures_dir / "sample_84_questions.xlsx"
    csv_path = fixtures_dir / "sample_84_questions.csv"
    readme_path = fixtures_dir / "README.md"

    # Combine + assign IDs
    all_questions = (
        CLEAN_QUESTIONS + DIALOG_QUESTIONS + ERROR_QUESTIONS + NO_PLACEHOLDER_QUESTIONS
    )
    assert len(all_questions) == 84, f"Expected 84 questions, got {len(all_questions)}"

    rows = []
    for idx, item in enumerate(all_questions, start=1):
        row = [
            idx,
            f"E{item['grade']}-{idx:03d}",
            item["grade"],
            item["category"],
            item["target"],
            item["stem"],
            item["choices"][0],
            item["choices"][1],
            item["choices"][2],
            item["choices"][3],
            item["correct"],
        ]
        rows.append(row)

    # --- Write XLSX ---
    wb = Workbook()
    ws = wb.active
    ws.title = "Questions"
    ws.append(HEADERS)
    for row in rows:
        ws.append(row)
    # Bold header row
    from openpyxl.styles import Font
    for cell in ws[1]:
        cell.font = Font(bold=True)
    wb.save(xlsx_path)

    # --- Write CSV ---
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(HEADERS)
        writer.writerows(rows)

    # --- Write README ---
    readme = f"""# Sample test fixtures — Eiken Stem Proofread

Generated by [generate_sample.py](generate_sample.py).

## Files

- `sample_84_questions.xlsx` — primary test input ({xlsx_path.stat().st_size} bytes)
- `sample_84_questions.csv` — same data in CSV format (alternate upload path)

## Question distribution (84 total)

| Group | Count | Purpose |
|-------|-------|---------|
| Clean grammar single-line | {len(CLEAN_QUESTIONS)} | Realistic Eiken Grade 2 fill-in-blank; correct answer = grammatical sentence |
| Multi-line dialog (A:/B:) | {len(DIALOG_QUESTIONS)} | Tests workflow handles `\\n` in stem correctly |
| Intentional stem errors | {len(ERROR_QUESTIONS)} | Tests LT error detection + Y1 columns (Errors/Fixed) populated correctly |
| Missing placeholder | {len(NO_PLACEHOLDER_QUESTIONS)} | Tests filter logic — these MUST be dropped to skipped_items, not output |

## Expected behavior in workflow

After running through Eiken Stem Proofread workflow v2 (Option 1 + Y1 + 2-mode):

| Output metric | Expected value |
|---------------|----------------|
| `total_items` | 84 |
| `skipped_items` | 3 (the no-placeholder rows) |
| `processed_items` | 81 (entered LT check) |
| `row_count` in XLSX | Depends on LT detection; expect ~3-10 (the ERROR_QUESTIONS + any false positives) |
| `api_errors` | 0 if API healthy |

→ Most clean questions will be filtered out (no errors detected → dropped per spec).
→ Test rows marked `[TEST]` in `Target` column for easy identification in output.

## How to use

### Upload to Dify Studio
1. Run Eiken Stem Proofread workflow
2. Upload `sample_84_questions.xlsx` to `input_file` parameter
3. Select mode (`free` for testing, `premium` after env vars setup)
4. Run

### Verify output
- Open downloaded XLSX
- Check `skipped_items` contains 3 rows with `[TEST] Missing placeholder` in Target
- Check `Errors` column populated for `[TEST] Stem grammar error` and `[TEST] Spelling 'dont'` rows
- Verify column structure: # / Item ID / Original / Fixed (clean) / Errors / Error Count

## Regenerate

```bash
.venv/bin/python tests/fixtures/generate_sample.py
```
"""
    readme_path.write_text(readme)

    print(f"✅ Generated {len(all_questions)} questions")
    print(f"   XLSX: {xlsx_path} ({xlsx_path.stat().st_size} bytes)")
    print(f"   CSV:  {csv_path} ({csv_path.stat().st_size} bytes)")
    print(f"   README: {readme_path}")


if __name__ == "__main__":
    main()
