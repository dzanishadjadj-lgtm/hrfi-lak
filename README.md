# خادم «حرفي لك» (رمز SMS + رسائل مشفرة + ملفات الحرفيين)

## 1) جهّز رمز SMS (Twilio Verify)
1. أنشئ حسابًا على twilio.com وأضف رصيدًا صغيرًا.
2. من القائمة: Verify ← Services ← Create new. انسخ **Service SID** (يبدأ بـ VA).
3. من Verify ← Settings ← Geo permissions: فعّل **Algeria**.
4. من الصفحة الرئيسية انسخ **Account SID** (AC...) و **Auth Token**.

## 2) انشر الخادم (مثلًا على Render.com)
1. ارفع مجلد herfi-server إلى مستودع GitHub جديد.
2. في Render: New ← Web Service ← اختر المستودع.
   - Build Command: `npm install`
   - Start Command: `npm start`
3. من Environment أضف:
   - `ALLOW_ORIGIN` = رابط موقعك على Netlify (بدون / في النهاية)
   - `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_VERIFY_SID`
   - `DATA_FILE` = `/data/data.json` وأضف Disk بمسار `/data` (لتبقى البيانات بعد إعادة التشغيل)
4. بعد النشر ستحصل على رابط مثل `https://herfi-api.onrender.com`.

## 3) اربط التطبيق
في ملف herfi-lak.html ابحث عن `var DEF=` وضع الرابط:
`api:"https://herfi-api.onrender.com"`
ثم أعد رفع الملف إلى Netlify.

## تجربة على جهازك بدون Twilio
```
npm install
DEV_OTP=1 ALLOW_ORIGIN=http://localhost:5500 node server.js
```
الرمز سيظهر في الشاشة السوداء (الطرفية) بدل SMS.
