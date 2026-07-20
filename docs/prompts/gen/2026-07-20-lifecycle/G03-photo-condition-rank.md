# G03 — Chấm hạng tình trạng hàng secondhand từ ảnh, không chắc thì nói không chắc (JA, vision)

```
中古品を仕入れて販売しています。仕入れた商品の写真を何枚か撮って送るので、
傷・汚れ・欠けがないかを見て、状態ランク(A:きれい/B:使用感あり/C:傷が目立つ)をつけてほしいです。
Cランクのものは「出品前に要確認」と出してもらえると助かります。
どこを見てそのランクにしたかも書いてください。あとで自分の目で確かめたいので。
それと、写真だけでは判断できないもの(動作確認が必要な家電など)は、
無理にランクをつけずに「写真では判断不可」と正直に言ってください。
```

## Bối cảnh giả định
Người bán đồ secondhand cá nhân/nhỏ, tự chụp ảnh nhập hàng. Chính user chủ động XIN sự trung thực
("không chắc thì đừng ép rank") — đề hiếm khi user tự mở đường lui; xem build có LẠM DỤNG đường
lui (cái gì cũng 判断不可) hay dùng đúng mực.

## Trục năng lực được thử
**Vision nhiều ảnh** (P02 là vision OCR; đây là vision ĐÁNH GIÁ chủ quan — trục mới) · phân hạng
theo rubric user cho (A/B/C) · **trung thực có kiểm soát hai chiều**: không ép rank khi thiếu cơ sở
NHƯNG không né việc bằng cách 判断不可 tràn lan · giải thích "nhìn vào đâu" (evidence per verdict —
để user tự kiểm) · C-rank kèm cờ 「出品前に要確認」.

## Hình dạng build tốt
- `start` file-list ảnh (nhiều ảnh, `allowed_file_types: image`) → LLM vision với rubric A/B/C
  tường minh trong prompt + luật 判断不可 (tiêu chí RÕ khi nào được dùng: đồ điện cần chạy thử,
  ảnh mờ/thiếu góc) → output có cấu trúc: rank · lý do chỉ vào chi tiết ảnh · cờ 要確認 khi C ·
  判断不可 kèm LÝ DO thiếu gì (góc chụp? cần cắm điện?).
- Model vision là LLM node — model rỗng vẫn là nợ đã biết; vision cần model có mắt (notes phải nói
  chọn model vision-capable, không phải model bất kỳ).
- Không nhét tool/plugin thừa — đề này thuần vision + văn.

## Bẫy đã biết
Vision "nhìn thấy" vết xước không tồn tại (hallucinate damage — rubric phải bắt chỉ-nói-cái-thấy-
được, kèm vị trí trong ảnh) · 判断不可 thành lối thoát lười (mọi thứ đều 不可) — prompt cần tiêu
chí dùng · rank giữa A/B mơ hồ theo định nghĩa user (「使用感」) — 1 câu định nghĩa vận hành trong
prompt là điểm cộng, tự chế thang mới thay thang user là điểm trừ · nhiều ảnh 1 món vs mỗi ảnh 1
món — mơ hồ thật, đáng thành open question ①.

## MANUAL dự kiến
Bộ ảnh thật: món xước rõ / món sạch / ảnh mờ / đồ điện — xem rank + lý do + tỉ lệ 判断不可 có
hợp lý · nhiều ảnh cùng món có bị chấm thành nhiều món không.
