# Risk #6 — Hard-coded PLACEHOLDER

## 🔍 Current State

PLACEHOLDER được hard-code ở 2 chỗ:

```python
# main.yml:262 — node "10問づつバッチ分割"
PLACEHOLDER = "(          )"   # 10 spaces chính xác

# main.yml:430 — node "バッチ展開"
PLACEHOLDER = "(          )"   # phải khớp byte-for-byte
```

**Cách dùng**:
1. **Detect** ([main.yml:330](../workflows/main.yml#L330)): `"has_placeholder": PLACEHOLDER in stem` — exact string match
2. **Replace** ([main.yml:440](../workflows/main.yml#L440)): `stem.replace(PLACEHOLDER, choice)` — exact string replace

Cả 2 đều yêu cầu khớp tuyệt đối.

## ⚠️ Failure Modes

| Excel input | `has_placeholder` | Kết quả | Vấn đề |
|------------|-------------------|---------|--------|
| `I (          ) yesterday.` (10 spaces) | ✅ True | Fill đúng | OK |
| `I ( ) yesterday.` (1 space) | ❌ False | fulltext = stem gốc 4 lần | **Câu bị skip, vào `skipped_items`** |
| `I (     ) yesterday.` (5 spaces) | ❌ False | Tương tự | Skip |
| `I（          ）yesterday.` (full-width parens 全角) | ❌ False | Tương tự | **Skip — common error trong file Nhật!** |
| `I ___ yesterday.` (underscores) | ❌ False | Skip | Format khác |
| `I (...) yesterday.` (dots) | ❌ False | Skip | Format khác |
| `I (          ) yesterday and (          ).` (2 placeholders) | ✅ True | **Replace CẢ 2** thành cùng choice | **Sai logic** — chỉ nên thay placeholder đầu |

### Top 3 cases dễ gặp với KH Nhật

1. **Spaces inconsistent giữa các câu** — author A gõ 10 spaces, author B gõ 5 spaces, author C dùng tab → mỗi file Eiken khác nhau.
2. **Full-width parens (全角 vs 半角)** — Excel Nhật bật IME → tự nhập `（` (full-width) thay vì `(` (half-width). Mắt thường nhìn giống nhau, Python `==` False ngay. **Rất khó debug**.
3. **Câu có/không placeholder mixed** — Workflow vẫn chạy (fallback `else: fulltext = stem`) nhưng output là 4 row giống hệt nhau → vô nghĩa cho việc校閲.

## ✅ Giải pháp đề xuất

### Option A: Regex flexible — **RECOMMEND**

Thay exact string match bằng pattern match:

```python
import re

# Match: ( + 1 or more whitespace + )  |  same with full-width parens
PLACEHOLDER_PATTERN = re.compile(r"[（(][\s　]+[）)]")
# [\s　] = whitespace + full-width space (U+3000)
# [（(] = full-width or half-width opening paren
# [）)] = full-width or half-width closing paren

def has_placeholder(stem):
    return bool(PLACEHOLDER_PATTERN.search(stem))

def fill_placeholder(stem, choice):
    # count=1 → chỉ replace placeholder ĐẦU TIÊN, tránh case 2 placeholder
    return PLACEHOLDER_PATTERN.sub(choice, stem, count=1)
```

**Pros**:
- Accept mọi spacing trong parens (1 space, 10 spaces, full-width space)
- Accept cả full-width và half-width parens
- `count=1` xử lý đúng case multi-placeholder

**Cons**: Phải sửa code ở 2 node, KH không thấy được setting

### Option B: Configurable placeholder qua Start node

Thêm input field ở Start:

```yaml
- label: 'Placeholder pattern (regex)'
  variable: placeholder_pattern
  type: text-input
  default: '[（(][\s　]+[）)]'
  required: false
```

Pass `placeholder_pattern` xuống các Code node, dùng `re.compile(placeholder_pattern)`.

**Pros**: KH tự config mà không cần sửa workflow
**Cons**: KH phải biết regex (rủi ro typo regex → workflow crash). Có thể wrap try/except + fallback default.

### Option C: List of common placeholders

```python
PLACEHOLDERS = [
    "(          )",     # 10 spaces half-width
    "（          ）",    # 10 spaces full-width
    "( )", "(  )", "(   )", "(    )", "(     )",   # 1-5 spaces
    "___", "_____",                                 # underscores
    "(...)",                                        # ellipsis
]

def find_placeholder(stem):
    for p in PLACEHOLDERS:
        if p in stem:
            return p
    return None

def fill(stem, choice):
    p = find_placeholder(stem)
    return stem.replace(p, choice, 1) if p else stem
```

**Pros**: Đơn giản, KH dễ hiểu, dễ thêm pattern mới
**Cons**: Phải maintain list, vẫn miss edge case

## 🏆 Recommendation

**Option A (Regex)** vì:
1. Cover được ~95% trường hợp thực tế (spacing variant + full-width parens — 2 cái phổ biến nhất trong file Nhật)
2. Code thay đổi ít — sửa 2 node, mỗi node thêm ~5 dòng
3. `count=1` xử lý đúng edge case multi-placeholder mà code hiện tại đang sai

## 📝 Patch Plan

**[main.yml:262-330](../workflows/main.yml#L262-L330)** — node "10問づつバッチ分割":
```python
import re
PLACEHOLDER_PATTERN = re.compile(r"[（(][\s　]+[）)]")
...
"has_placeholder": bool(PLACEHOLDER_PATTERN.search(stem)),
```

**[main.yml:430-440](../workflows/main.yml#L430-L440)** — node "バッチ展開":
```python
import re
PLACEHOLDER_PATTERN = re.compile(r"[（(][\s　]+[）)]")
...
if has_ph:
    fulltext = PLACEHOLDER_PATTERN.sub(choice, stem, count=1)
else:
    fulltext = stem
```

**Bonus improvements**:
1. Thêm field `detected_placeholder` (string thực tế tìm thấy) vào output của batch split → giúp debug khi spec lạ
2. Update note ở đầu file documenting regex support

## ❓ Open Questions

- [ ] KH có cần support placeholder format nào khác ngoài parens không? (underscores `___`, brackets `[...]`)
- [ ] Có câu nào trong dataset thực tế có 2+ placeholder không? Nếu có, logic fill thế nào (cùng choice cho cả 2? hay choice khác nhau)?

## 📅 Status

- [ ] Confirm với KH về placeholder format chuẩn
- [ ] Apply patch theo Option A
- [ ] Add test với sample data có mixed placeholder formats
