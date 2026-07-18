# Độ tin cậy bộ đo — kiểm trước đợt chạy (2026-07-18)

Kiểm chính công cụ đo TRƯỚC khi tin số liệu. Tìm ra 2 sai lệch; ghi lại để mọi báo cáo sau dùng
đúng oracle.

## Nguồn số liệu — cái nào tin được

| Metric | Nguồn | Tin được? |
|---|---|---|
| `numTurns` (cost table) | `task.json.cost.<phase>.numTurns` — từ **result event thật** của Claude, không tính lại | ✅ chính xác, nhưng xem Sai lệch #2 |
| model / cacheRead | `task.json.cost.<phase>.*` — result event | ✅ chính xác |
| wall-clock (`time`) | mtime artifact − fire time | ⚠️ đúng "phase mất bao lâu" nhưng gồm chờ I/O + delay auto-advance |
| tool-call / ✗ count | đếm dòng `- <tool> … ✓/✗` trong `transcripts/<phase>.md` | ✅ `✗ = tool_result.is_error` (run-transcript.ts:84); cho grep/rg/find ✗ = **bị hook chặn** |

## Sai lệch #1 — MODEL không nhất quán giữa run

`claude` CLI của Builder **không pin model**. Khi context một turn phình lớn (③ thrash), CLI tự nhảy
`claude-haiku-4-5` → **`claude-opus-4-8[1m]`** (1M-context beta).

Bằng chứng — implement phase, đợt này:

| run | model | cacheRead | turn |
|---|---|---|---|
| P11 phone | **opus-4-8[1m]** | **1.50M** | 40 |
| P04 form | haiku-4-5 | 0.31M | 16 |
| P01 news | haiku-4-5 | 0.55M | 22 |

P11 thrash nhiều → context >1M → nhảy Opus. Đây là **hệ quả** của thrash, không phải nguyên nhân
độc lập — nhưng nghĩa là **P11 KHÔNG dùng để so turn/time xuyên run** (khác model). Mọi báo cáo
phải **ghi model từng phase**; chỉ so các run **cùng model**.

## Sai lệch #2 — TURN đo SAI TRỤC cho thrash tìm-kiếm

Oracle "đáng tin nhất" (turn) lại **ngược** cho lớp lỗi 071, vì nhiều call bị chặn **nén vào ít turn**.
Hai run cùng Haiku, cùng độ phức tạp:

| oracle | P04 webhook (không pattern) | P01 schedule (có pattern) | tách đúng? |
|---|---|---|---|
| **turn** | 16 | 22 | ❌ **NGƯỢC** |
| tool-call | 60 | 21 | ✅ webhook 2.9× |
| **grep denied** | 7 | 2 | ✅ webhook 3.5× — **trực tiếp nhất** |
| wall-clock | 522s | 320s | ✅ nhưng nhiễu I/O |

→ **Oracle đúng cho thrash = số call bị chặn (hoặc tool-call count), KHÔNG phải turn.** Đây chính là
lý do spec 071 **S2** (`denied_calls_max` predicate) cần thiết: suite entry hiện gate bằng
`implement_turns_max` — sẽ **không bắt được** webhook thrash (16 turn lọt cap 30).

## Hệ quả cho kết luận 071 (đã đo)

Kết luận "webhook thiếu pattern → ③ đắt" **vẫn đúng**, nhưng bằng chứng **sạch nhất** là **P04 vs P01
(cùng Haiku), đo bằng call-count + grep-denied**, KHÔNG phải P11 (Opus) và KHÔNG phải turn. Các báo
cáo P04/P11 đã ghi wall-clock làm điểm nhấn — vẫn đúng hướng, nhưng oracle chuẩn là denied-count.

## Quy tắc cho các run tiếp theo

1. Ghi **model từng phase** vào mỗi báo cáo.
2. So sánh chỉ giữa **các run cùng model**.
3. Oracle thrash = **grep-denied count** + **tool-call count**, không phải turn/wall-clock.
4. Nếu một run nhảy Opus[1m] → đánh dấu "không so turn được", coi là tín hiệu thrash mạnh.
