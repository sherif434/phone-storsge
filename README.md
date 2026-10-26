# غمزونة Cloud

واجهة تخزين ملفات شخصية مبنية بـ HTML/CSS/JavaScript Modules، مع Firebase Authentication وCloud Firestore وCloud Storage، قابلة للنشر على GitHub Pages.

> **حالة المشروع:** ملفات المصدر وقواعد الأمان جاهزة للتهيئة. لا يعمل تسجيل الدخول أو رفع الملفات قبل إنشاء مشروع Firebase، إدخال إعداداته، وتطبيق القواعد. لا توجد سعة 5 GB مجانية مضمونة من هذا المستودع.

## هيكل الملفات

- `index.html` — الواجهات: ترحيب، تسجيل حساب، دخول، لوحة التحكم، الإعدادات.
- `assets/css/styles.css` — تصميم متجاوب RTL.
- `assets/js/app.js` — المصادقة وإدارة الملفات.
- `firebase-config.example.js` — قالب إعدادات العميل.
- `firestore.rules` — قواعد Firestore.
- `storage.rules` — قواعد Storage.
- `.github/workflows/pages.yml` — نشر GitHub Pages.

## 1. إنشاء مشروع Firebase

1. افتح https://console.firebase.google.com/ وأنشئ مشروعًا.
2. من Project settings أضف تطبيق Web، ثم انسخ إعدادات Firebase.
3. فعّل Authentication → Sign-in method → Email/Password.
4. أنشئ قاعدة Cloud Firestore في وضع الإنتاج.
5. أنشئ Storage bucket. قد تتطلب Storage فوترة مفعّلة حسب الموقع والخطة الحالية؛ راجع شاشة Billing/Usage في وحدة التحكم قبل الاعتماد عليها.
6. من إعدادات Authentication → Authorized domains أضف نطاق GitHub Pages الذي سيستضيف الموقع (مثل `OWNER.github.io`) إذا لم يكن موجودًا.
7. انسخ `firebase-config.example.js` إلى `firebase-config.js` واملأ القيم. لا تضع أي service-account JSON أو Admin SDK secret في الموقع.

**تنبيه:** إعدادات Firebase Web مثل apiKey ليست أسرار صلاحيات إدارية؛ لكن قواعد Firestore وStorage هي التي يجب أن تمنع الوصول غير المصرح به. لا تنشر بيانات خدمة أو مفاتيح إدارية مطلقًا.

## 2. تطبيق قواعد الأمان

من Firebase Console افتح Firestore → Rules وانسخ محتوى `firestore.rules` ثم Publish. افتح Storage → Rules وانسخ محتوى `storage.rules` ثم Publish.

القواعد تقصر القراءة والكتابة على UID الخاص بالمستخدم وتمنع تحديث بيانات الملف الوصفية بعد الإنشاء. حد حجم الملف على Storage Rules هو 512 MiB. اختبر القواعد بحسابين منفصلين في Firebase Rules Playground أو Emulator قبل وضع بيانات حساسة.

**ملاحظة أمنية:** قواعد Storage لا توفر حصة تراكمية موثوقة 5 GB لكل مستخدم بمفردها. فحص 5 GB في الواجهة لتحسين تجربة الاستخدام فقط، ويمكن تجاوزه بطلبات مباشرة. لفرض حصة صارمة، أضف خدمة خلفية موثوقة (Cloud Functions/Cloud Run) تتحقق من الحجم التراكمي وتنفذ الحجز والتنظيف ذريًا. كذلك، حذف الحساب النهائي غير مفعّل في الواجهة عمدًا؛ يتطلب وظيفة خادمية موثوقة تحذف الملفات والبيانات وتعيد التحقق من المستخدم.

## 3. إعداد Firebase config محليًا

انسخ القالب:
- Windows PowerShell: `Copy-Item firebase-config.example.js firebase-config.js`
- macOS/Linux: `cp firebase-config.example.js firebase-config.js`

عدّل `firebase-config.js` بقيم تطبيق الويب من Firebase Console. هذا الملف مستثنى من Git بواسطة `.gitignore`. إذا رغبت باستخدام GitHub Pages مباشرة، فإن الموقع يحتاج إلى ملف إعداد عميل متاح للمتصفح. لا يمكن إخفاء قيم إعداد العميل داخل موقع ثابت؛ أمّن المشروع عبر القواعد وقيود API، ولا تضع أسرارًا خاصة فيه.

## 4. النشر على GitHub Pages

1. ارفع ملفات المشروع إلى مستودع GitHub.
2. افتح Settings → Pages، واختر **GitHub Actions** كمصدر للنشر.
3. أضف إعداد العميل في ملف `firebase-config.js` محليًا ثم قرر طريقة تزويده أثناء النشر. الأفضل إعداد workflow يستقبل القيم من GitHub Actions Secrets/Variables وينشئ الملف أثناء البناء. لا توجد عملية نشر تلقائية مفعّلة في هذا المستودع قبل مراجعة الإعدادات.
4. بعد نجاح GitHub Actions سيظهر رابط الموقع في Settings → Pages.

GitHub Pages استضافة ثابتة؛ لا تنفذ وظائف خادمية لحساب الحصص أو حذف الحسابات. لا يمكن للواجهة وحدها ضمان أن المستخدم لم يتجاوز الحصة.

## 5. حدود التخزين والملفات

- الحد المطبق في الواجهة: 5 GiB لكل حساب، محسوب على أساس الملفات الظاهرة في Firestore.
- الحد لكل ملف في الواجهة والقواعد: 512 MiB.
- هذه الحدود ليست خطة أو حصة مقدمة من Firebase. السعة الفعلية والتكلفة وحدود الرفع والتحميل تتبع مشروع Firebase والخطة والمنطقة والقيود الحالية. راجع وثائق Firebase الرسمية: https://firebase.google.com/docs/storage وhttps://firebase.google.com/pricing.
- رفع ملف إلى Storage ثم كتابة metadata إلى Firestore عمليتان منفصلتان؛ الكود يحاول حذف الملف من Storage إذا فشلت كتابة metadata.
- لا ترفع ملفات حساسة قبل اختبار القواعد والتأكد من تفعيل الفوترة/الحدود والتنبيهات المناسبة.

## 6. ما هو مدعوم وما يحتاج استكمالًا

- مدعوم في الواجهة: إنشاء حساب بكلمة مرور قوية عشوائية، نسخ كلمة المرور، تسجيل الدخول، رابط إعادة تعيين كلمة المرور، عرض قائمة الملفات، الرفع مع تقدم، التنزيل، الحذف، البحث، حالة الاتصال.
- تغيير كلمة المرور: يتم حاليًا عبر رابط إعادة تعيين آمن بالبريد، وليس عبر نموذج تغيير كلمة مرور مباشر.
- حذف الحساب: معطّل عمدًا إلى حين إضافة وظيفة خادمية موثوقة لتنظيف الملفات والبيانات.
- لا يوجد عمل دون إنترنت في النسخة الحالية حسب النطاق المطلوب.
- لا يتم تخزين كلمة المرور في Firestore أو localStorage ولا تُطبع في console.
- كلمة مرور الحساب المولدة تظهر مرة واحدة بعد الإنشاء؛ انسخها واحفظها في مدير كلمات مرور قبل المتابعة.

## 7. التحقق قبل الاستخدام الحقيقي

- أنشئ حساب اختبار A وحساب اختبار B.
- تأكد أن A لا يستطيع قراءة ملفات B أو تنزيلها أو حذفها.
- اختبر ملفًا صغيرًا، ملفًا قريبًا من 512 MiB، وملفًا أكبر من الحد.
- اختبر الرفع عند امتلاء الحد التطبيقي، ثم تحقق من أن الحصة الخادمية مطبقة إذا أضفت وظيفة الحصص.
- اختبر إعادة تعيين كلمة المرور، الجلسة، تسجيل الخروج، وفشل الشبكة.
- راقب Firebase Usage وBilling.
- اختبارات المتصفح والهواتف لم تُنفّذ تلقائيًا بمجرد رفع الملفات؛ يجب إجراؤها بعد إعداد المشروع.

## مراجع رسمية

- Firebase Authentication: https://firebase.google.com/docs/auth
- Firestore Security Rules: https://firebase.google.com/docs/firestore/security/get-started
- Storage Security Rules: https://firebase.google.com/docs/storage/security
- GitHub Pages: https://docs.github.com/pages