# نصيب

## تشغيل الخادم

يتطلب تشغيل `server.js` استضافة تدعم Node.js؛ **GitHub Pages لا يشغّل Node.js**.

1. استخدم استضافة Node واربط هذا المستودع.
2. أضف `SUPABASE_URL` و`SUPABASE_ANON_KEY` كمتغيرات بيئة في الاستضافة.
3. شغّل الأمر `npm start`.
4. افحص الخادم عبر `/api/healthz`.

يمكن استخدام `SUPABASE_PUBLISHABLE_KEY` بدل `SUPABASE_ANON_KEY`. لا تضع مفتاح `service_role` في الواجهة أو المستودع.

الخادم يقدّم `index.html` والملفات الثابتة ويحقن إعدادات Supabase العامة. لا ينفّذ المدفوعات أو صلاحيات الإدارة بنفسه؛ يجب حماية هذه العمليات بسياسات Supabase وقواعد قاعدة البيانات.
