# G02 — Soạn tin tuyển dụng từ mô tả công việc, tự rà từ ngữ phân biệt (VI)

```
Bên mình tuyển người khá thường xuyên mà mỗi lần viết tin đăng tuyển lại mất cả buổi,
với cả sếp hay nhắc là câu chữ phải cẩn thận, không được ghi mấy cái như giới hạn tuổi,
ưu tiên nam hay nữ, hay yêu cầu ngoại hình — dễ bị phản ánh lắm.
Mình muốn: dán bản mô tả công việc nội bộ vào (thường viết khá thô, gạch đầu dòng),
rồi nhận về một tin đăng tuyển hoàn chỉnh, giọng thân thiện chuyên nghiệp.
Quan trọng: trước khi đưa mình, phải tự rà lại một lượt xem còn sót từ ngữ nào nhạy cảm
kiểu phân biệt tuổi tác, giới tính, ngoại hình không, sót thì tự sửa.
Cho mình xem luôn một danh sách những chỗ đã sửa và vì sao sửa, để mình học theo.
```

## Bối cảnh giả định
Nhân viên HR công ty Việt Nam, viết tin đăng Facebook/TopCV. Ràng buộc compliance đến từ sếp thật
(luật lao động + phản ánh cộng đồng). Muốn học theo ("cho mình xem chỗ đã sửa") — nhu cầu thật của
người làm nghề.

## Trục năng lực được thử
**Chuỗi LLM tự-rà-soát** (draft → self-check theo tiêu chí phân biệt → bản sửa; trục P08 nhưng
tiêu chí compliance thay vì glossary) · **lang-sync VI không-base** (thêm mẫu cho nghi vấn số 6) ·
paste-text đầu vào thô gạch đầu dòng · 2 output: bản đăng + bản đối chiếu đã-sửa-vì-sao (họ hàng
trục tách-kênh G02 đợt trước).

## Hình dạng build tốt
- `start` (paragraph text) → LLM-1 soạn tin → LLM-2 RÀ theo danh mục cụ thể (tuổi/giới/ngoại hình
  + gợi ý thay) trả JSON các vi phạm → `code` áp bản vá + dựng bảng "đã sửa | vì sao" → `end` 2
  output riêng.
- Tiêu chí rà phải NẰM TRONG prompt node rà (danh mục tường minh), không phó mặc "tự biết".
- Digest/SPEC/notes tiếng Việt.

## Bẫy đã biết
Tự-rà bằng đúng model vừa viết dễ "tự khen đạt" — tách 2 node LLM với system prompt rà độc lập là
tối thiểu · vi phạm kiểu ẩn ("nhanh nhẹn trẻ trung", "hình thức ưa nhìn", "nam ưu tiên đi công
trình") — danh mục trong prompt có cover cách nói vòng không · bản "đã sửa vì sao" rỗng khi không
có vi phạm — phải nói "không tìm thấy" chứ không im · output đăng được luôn ≠ chứa lời giải thích
lẫn vào (tách kênh).

## MANUAL dự kiến
Dán một JD thô thật có cài 3 lỗi (「dưới 30 tuổi」「nữ, ngoại hình khá」「nam ưu tiên」) xem bắt đủ
không + bản đăng sạch thật không · giọng "thân thiện chuyên nghiệp" chấm tay.
