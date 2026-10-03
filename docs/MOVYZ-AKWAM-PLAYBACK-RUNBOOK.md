# Movyz Playback / Akwam Runbook

## الهدف
هذا الملف هو المرجع الوحيد لتشغيل وسحب مصادر Movyz. أي AI أو مبرمج جديد يجب أن يقرأه قبل تعديل نظام المصادر أو المشغل.

## وصف النجاح المرجعي
فيلم Interstellar (TMDB 157336) أصبح يعمل بنجاح بعد توحيد هذه الطبقات:
1. المصدر النهائي محفوظ مسبقًا في Supabase.
2. أثناء المشاهدة لا يوجد Resolver ولا Browser Run ولا بحث خارجي.
3. مصدر Akwam المحفوظ يمر عبر Movyz Playback Proxy.
4. الـProxy يرسل Referer إلى Akwam.ss ويمرر Range.
5. الـProxy يعيد Content-Length / Content-Range / Accept-Ranges / Content-Type.
6. مشغل HTML5 يستخدم native MP4 عندما يكون النوع MP4.
7. عند توفر metadata يتم تنفيذ startup warmup: seek مؤقتًا إلى ~120 ثانية ثم الرجوع إلى 0.
8. إذا لم يصل metadata خلال نافذة البداية، تتم تجربة مصدر Prepared آخر.
9. عند تغيير الجودة أثناء المشاهدة يتم حفظ موضع المشاهدة ومحاولة الاستئناف.

## أصل المصادر
- Discovery origin الوحيد المعتمد: `https://akwam.ss`
- لا تضف `ak.sv` أو `akwam.net` أو `akwam.it` كبدائل.
- قد يكون الـhost النهائي لملف الوسائط مختلفًا عن Akwam.ss؛ هذا طبيعي إذا كان هو الرابط النهائي الذي يعيده Akwam.
- لا تعتمد على Embed صفحات خارجية كمصدر تشغيل نهائي.
- لا تحفظ صفحة intermediate على أنها media source.

## شرط المصدر النهائي
كل row في `public.playback_sources` يجب أن يمثل رابط وسائط نهائيًا صالحًا:
- HTTPS فقط.
- `source_type` واحد من: hls / mp4 / dash / webm / direct.
- `quality` ليست auto أو source أو فارغة.
- `provider_reference = 'akwam'` لمصادر Akwam.
- `is_working = true` فقط عندما المصدر صالح للاستخدام.
- الرابط يجب أن يكون final media URL، وليس صفحة `/embed`.
- وجود كلمة `/download/` داخل المسار لا يعني تلقائيًا أنها صفحة خاطئة؛ الحكم يكون على كون الرابط النهائي Media URL فعليًا.

## التخزين
جدول التشغيل:
`public.playback_sources`

حقول مهمة:
- provider_id
- content_type: movie أو episode
- content_id
- source_type
- url
- provider_reference
- quality
- language
- label_ar / label_en
- expires_at
- is_working
- last_checked_at
- failure_count

Provider:
- `public.providers`
- المفتاح: `arprov`

## قاعدة الجودات
للأفلام، الهدف المعتاد:
- 1080p
- 720p
- 480p
- ويمكن 360p إذا كانت هذه هي الجودة الوحيدة المتاحة.

وجود جودة واحدة لا يعني أن الفيلم اكتمل.
يجب ألا يمسح تحديث جودة واحدة الجودات الأخرى السليمة.

نظام الملء الحالي يجب أن يعيد زيارة الأفلام التي لديها جودة أو جودتان فقط، وألا يعتبرها مكتملة حتى يكتمل سلم الجودات المستهدف عندما تتوفر من المصدر.

للحلقات: يجب حفظ كل مصدر صالح لكل حلقة متاحة، ولا تعتبر الحلقة مكتملة إذا لم يكن لها مصدر صالح.

## مسار المستخدم الصحيح
المستخدم
→ Movyz Watch API
→ Supabase playback_sources
→ Movyz Playback Proxy
→ الرابط النهائي المحفوظ
→ HTML5 player

ممنوع:
المستخدم → Resolver
المستخدم → Browser Run
المستخدم → live discovery على Akwam

أي Resolver / scraping / Browser Run يجب أن يحدث فقط في مرحلة التحضير الخلفية إذا كان مطلوبًا لاستخراج المصدر وحفظه، وليس عند مشاهدة المستخدم.

## Playback Proxy
الملف: `server/playback-proxy.ts`

الـProxy يجب أن:
- يتحقق من token موقّع.
- يرسل Referer المناسب.
- يحترم Range من المتصفح.
- يمرر Content-Length.
- يمرر Content-Range.
- يمرر Accept-Ranges.
- يمرر Content-Type.
- لا يعيد raw Akwam URL للواجهة عندما يكون المصدر Akwam.
- لا يتطلب Browser Run.

أي endpoint يعيد مصادر Akwam للمستخدم يجب أن يستدعي:
`getFreshArProvSourcesForContent(..., requestUrl, env)`
حتى يتم إنشاء Proxy URL.

## المسارات التي يجب أن تستخدم Proxy
هذه قاعدة عامة لكل أفلام وحلقات الحالي والمستقبلي:
- `/api/v1/movies/tmdb/:tmdbId`
- `/api/v1/movies/:id`
- `/api/v1/series/tmdb/:tmdbId/watch/:season/:episode`
- `/api/v1/series/:id/watch/:season/:episode`
- `/api/v1/watch/:id?type=movie`
- `/api/v1/watch/:id?type=episode`
- `/api/v1/playback/prepared`

لا تضف endpoint جديدًا يعيد `playback_sources.url` الخام لمصدر Akwam.

## المشغل
الملف: `src/pages/WatchPage.tsx`

### المصدر الافتراضي
- يفضّل 1080p.
- ثم 720p.
- ثم 480p.
- ثم أي جودة صالحة متاحة.

### Startup warmup
للمصادر الطويلة:
- بعد loadedmetadata/canplay، إذا duration > 125s:
  - seek إلى ~120s
  - انتظر seeked أو timeout قصير
  - ارجع إلى الوقت الأصلي (عادة 0)
- لا تعيد هذه العملية أكثر من مرة لنفس URL/type.

الهدف من warmup ليس تشغيل الفيديو من الدقيقة الثانية؛ الهدف إجبار المصدر على تهيئة seek/buffer ثم العودة للبداية.

### Startup failover
إذا لم يصل metadata خلال النافذة المحددة:
- جرّب مصدر Prepared آخر.
- لا تدخل في حلقة switching لا نهائية.
- لا تستخدم live resolver.

### Quality switch
عند اختيار جودة جديدة:
- خزّن currentTime.
- بدّل المصدر.
- انتظر loadedmetadata/canplay.
- استأنف الموضع السابق إذا كان ذلك ممكنًا.
- لا تعيد المستخدم إلى 0 بلا سبب.

## قواعد السلامة عند الإصلاح
لا تفعل:
- حذف كل مصادر فيلم لأن جودة واحدة فشلت.
- استبدال proxy برابط Akwam خام.
- إعادة Resolver إلى runtime.
- إضافة Browser Run لكل مشاهدة.
- اعتبار /download/ صفحة خاطئة بدون فحص نوع الرابط النهائي.
- اعتبار الفيلم مكتملًا بسبب وجود 1080p فقط.
- مسح 720p/480p السليمة أثناء تحديث 1080p.
- إدخال fake sources أو روابط وهمية.
- إخفاء فشل المصدر فقط من الواجهة.

## أفضلية التخزين
عند refresh لمصادر Akwam:
- احذف/استبدل فقط الجودة التي يتم تحديثها.
- احتفظ بالجودات السليمة الأخرى.
- dedupe حسب quality + type + URL.
- لا تكتب source_type غير مدعوم.

## التحقق أثناء التحضير
قبل إعلان المصدر جاهزًا:
1. HTTPS صالح.
2. URL قابل للتحليل.
3. source_type صحيح.
4. quality صحيحة.
5. ليس Embed page.
6. ليس intermediate page.
7. المصدر يرد كوسائط أو قابل للتعامل معه كوسائط عبر النوع المحفوظ.
8. حفظ last_checked_at و failure_count.
9. عند توفر Range، يجب أن ينجح اختبار bytes=0-1 عبر المسار المقصود.

## التحقق بعد النشر
Smoke tests يجب أن تتأكد من:
- API يعيد sources.
- Akwam source يتحول إلى Movyz proxy.
- proxy يرجع HTTP 200 أو 206.
- Content-Type منطقي لفيديو/HLS/DASH.
- لا يوجد raw Akwam URL في response عندما يكون provider Akwam.
- movie وepisode كلاهما يمران بنفس proxy.

## تشخيص أي فيلم لا يعمل
رتّب التشخيص بهذا الترتيب:
1. هل source موجود في playback_sources؟
2. هل quality/type صحيحان؟
3. هل is_working=true؟
4. هل API أعاد Proxy URL؟
5. هل Proxy يرجع 200/206؟
6. هل Content-Type صحيح؟
7. هل Range يعمل؟
8. هل loadedmetadata وصل؟
9. هل startup warmup نجح؟
10. هل المصدر الآخر يعمل بعد failover؟
لا تبدأ بإعادة بناء المشغل إذا كانت المشكلة في المصدر أو الـProxy.

## أرقام وحالة قاعدة البيانات لا تُحفظ كحقائق دائمة
أعداد المصادر والأفلام تتغير باستمرار. عند سؤال "كم الآن؟" يجب تنفيذ query مباشر في Supabase.
لا تعتمد على رقم قديم موجود في هذه الوثيقة.

## الأمن
ملاحظة مهمة: يوجد حاليًا تنبيه Supabase بأن `public.playback_source_jobs` لديه RLS معطّل.
SQL المعالجة المقترحة من Supabase:
```sql
ALTER TABLE "public"."playback_source_jobs" ENABLE ROW LEVEL SECURITY;
```
لا يتم تطبيقه تلقائيًا دون وضع سياسات الوصول المناسبة بعد التفعيل.

## آخر تغييرات مرجعية
- إصلاح استخدام Akwam.ss كـorigin وحيد.
- استخدام مسار البحث العامل في Akwam.ss.
- قبول final media paths التي قد تحتوي `/download/`.
- منع حفظ intermediate /download pages كمصادر.
- تحويل مصادر Akwam المحفوظة إلى Movyz Playback Proxy.
- إضافة startup 2:00 warmup.
- إضافة startup failover.
- إصلاح الملء بحيث يعيد محاولة الجودات الناقصة.
- إصلاح كل مسارات مشاهدة movie/episode حتى تمر مصادر Akwam عبر الـProxy.

## قاعدة مهمة لأي AI لاحق
لا تخترع معماريّة جديدة قبل فحص هذا الملف والكود الحالي.
المبدأ:
PREPARE ONCE → STORE → PROXY AT PLAYBACK → NATIVE PLAYER → WARMUP → FAILOVER

أي تغيير يجب أن يحافظ على هذا التسلسل.
