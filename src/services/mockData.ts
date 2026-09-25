import { Genre, Movie, Series, ProviderHealth, AuditLog } from '../types';

import heroCinemaImg from '../assets/images/movyza_hero_cinema_1790351827335.jpg';
import movieBackdropImg from '../assets/images/movyza_movie_backdrop_1790351839749.jpg';
import seriesBackdropImg from '../assets/images/movyza_series_backdrop_1790351852207.jpg';
import cinemaActionImg from '../assets/images/movyza_cinema_action_1790351863353.jpg';

export const GENRES: Genre[] = [
  { id: 28, name: 'أكشن', nameEn: 'Action', slug: 'action' },
  { id: 18, name: 'دراما', nameEn: 'Drama', slug: 'drama' },
  { id: 53, name: 'إثارة وتشويق', nameEn: 'Thriller', slug: 'thriller' },
  { id: 80, name: 'جريمة', nameEn: 'Crime', slug: 'crime' },
  { id: 36, name: 'تاريخي', nameEn: 'History', slug: 'history' },
  { id: 9648, name: 'غموض', nameEn: 'Mystery', slug: 'mystery' },
  { id: 35, name: 'كوميديا', nameEn: 'Comedy', slug: 'comedy' },
  { id: 878, name: 'خيال علمي', nameEn: 'Sci-Fi', slug: 'sci-fi' },
  { id: 10752, name: 'حرب', nameEn: 'War', slug: 'war' },
  { id: 10749, name: 'رومانسي', nameEn: 'Romance', slug: 'romance' },
];

export const INITIAL_MOVIES: Movie[] = [
  {
    id: 'mov-101',
    type: 'movie',
    title: 'صائد الظلال: صراع العروش والرمال',
    titleEn: 'Shadow Hunter: Dune Conflict',
    originalTitle: 'The Sand Reckoning',
    year: 2025,
    releaseDate: '2025-11-14',
    rating: 8.9,
    votesCount: 42150,
    runtime: 142,
    overview: 'في قلب صحراء غامضة غارقة في أسرار النفوذ، يتورط محقق استخباراتي سابق في كشف شبكة تجارة مظلمة تهدد أمن المنطقة، ليجد نفسه في مواجهة أشباح ماضيه وتحالفات قاسية لا ترحم.',
    overviewEn: 'Deep in an enigmatic desert steeped in ancient political intrigue, a former intelligence operative investigates a clandestine cartel, uncovering a conspiracy that bridges desert kingdoms and global power plays.',
    posterUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80',
    backdropUrl: heroCinemaImg,
    genres: [GENRES[0], GENRES[2], GENRES[4]],
    director: 'مروان حامد',
    directorEn: 'Marwan Hamed',
    cast: [
      { id: 'c1', name: 'كريم عبد العزيز', nameEn: 'Karim Abdel Aziz', character: 'يحيى الرملي', characterEn: 'Yahia El Ramly', avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80' },
      { id: 'c2', name: 'أحمد عز', nameEn: 'Ahmed Ezz', character: 'العقيد مراد', characterEn: 'Col. Mourad', avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80' },
      { id: 'c3', name: 'هند صبري', nameEn: 'Hend Sabry', character: 'د. ليلى فهمي', characterEn: 'Dr. Leila Fahmy', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80' },
      { id: 'c4', name: 'إياد نصار', nameEn: 'Eyad Nassar', character: 'شاهين', characterEn: 'Shaheen', avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&auto=format&fit=crop&q=80' }
    ],
    sources: [
      { id: 's1', type: 'mp4', quality: '1080p', language: 'ar', label: 'سيرفر الحافة السريع (CDN 1)', labelEn: 'Fast Edge CDN (Primary)', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', isWorking: true, provider: 'Akamai Edge' },
      { id: 's2', type: 'mp4', quality: '720p', language: 'ar', label: 'سيرفر النسخ السحابي (Cloud 2)', labelEn: 'Cloud Mirror (Secondary)', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4', isWorking: true, provider: 'CloudStream Adapter' },
      { id: 's3', type: 'mp4', quality: '480p', language: 'ar', label: 'سيرفر خفيف للهواتف (Mobile)', labelEn: 'Lightweight Mobile Stream', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', isWorking: true, provider: 'EgyBest Mirror' }
    ],
    isFeatured: true,
    isTrending: true,
    isPopular: true,
    addedAt: '2026-03-01T12:00:00Z',
    ageRating: '16+'
  },
  {
    id: 'mov-102',
    type: 'movie',
    title: 'مملكة الرماد: ملحمة الأسوار',
    titleEn: 'Kingdom of Ashes: The Bastion',
    originalTitle: 'The Ash Citadel',
    year: 2025,
    releaseDate: '2025-09-22',
    rating: 8.6,
    votesCount: 38400,
    runtime: 135,
    overview: 'ملحمة تاريخية مشوقة عن معركة استرداد الحصن الشرقي ضد جيوش الغزاة، حيث تتشابك الشجاعة مع الخيانة وتتوقف مصائر الآلاف على حكمة قائد معزول.',
    overviewEn: 'An epic historical saga chronicling the defense of the eastern fortress against overwhelming forces, where valor intertwines with betrayal and the fate of an empire rests upon a single besieged commander.',
    posterUrl: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=600&auto=format&fit=crop&q=80',
    backdropUrl: movieBackdropImg,
    genres: [GENRES[4], GENRES[0], GENRES[1]],
    director: 'حاتم علي (تخليداً لذكراه)',
    directorEn: 'Hatem Ali Tribute',
    cast: [
      { id: 'c5', name: 'غسان مسعود', nameEn: 'Ghassan Massoud', character: 'القائد المنصور', characterEn: 'Commander Mansour', avatarUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200&auto=format&fit=crop&q=80' },
      { id: 'c6', name: 'تيم حسن', nameEn: 'Taim Hasan', character: 'سيف الدين', characterEn: 'Saif Al-Din', avatarUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=200&auto=format&fit=crop&q=80' },
      { id: 'c7', name: 'سلافة معمار', nameEn: 'Sulafa Memar', character: 'الملكة زهرة', characterEn: 'Queen Zahra', avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&auto=format&fit=crop&q=80' }
    ],
    sources: [
      { id: 's4', type: 'mp4', quality: '1080p', language: 'ar', label: 'سيرفر الألياف الفائقة (Fiber-1)', labelEn: 'Ultra Fiber CDN (1080p)', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4', isWorking: true, provider: 'FastEdge CDN' },
      { id: 's5', type: 'mp4', quality: '720p', language: 'ar', label: 'سيرفر سحابي بديل', labelEn: 'Backup Cloud', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4', isWorking: true, provider: 'FaselHD Adapter' }
    ],
    isFeatured: false,
    isTrending: true,
    isPopular: true,
    addedAt: '2026-02-18T10:00:00Z',
    ageRating: '18+'
  },
  {
    id: 'mov-103',
    type: 'movie',
    title: 'شيفرة القاهرة: العملية صفر',
    titleEn: 'Cairo Code: Operation Zero',
    originalTitle: 'Zero Hour Cipher',
    year: 2026,
    releaseDate: '2026-01-10',
    rating: 8.4,
    votesCount: 29100,
    runtime: 118,
    overview: 'سباق محموم مع الزمن في شوارع العاصمة، حيث يحاول خبير أمن سيبراني فك تشفير هجوم إلكتروني منسق يستهدف البنية التحتية للمدينة قبل انقطاع الكهرباء التام.',
    overviewEn: 'A high-octane cyber thriller tracking a genius network analyst racing against the clock through the neon-lit avenues of modern Cairo to thwart an orchestrated blackout infrastructure assault.',
    posterUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=600&auto=format&fit=crop&q=80',
    backdropUrl: cinemaActionImg,
    genres: [GENRES[0], GENRES[2], GENRES[7]],
    director: 'طارق العريان',
    directorEn: 'Tarek Al Arian',
    cast: [
      { id: 'c8', name: 'آسر ياسين', nameEn: 'Asser Yassin', character: 'عمر شاكر', characterEn: 'Omar Shaker', avatarUrl: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=200&auto=format&fit=crop&q=80' },
      { id: 'c9', name: 'أمينة خليل', nameEn: 'Amina Khalil', character: 'سارة فريد', characterEn: 'Sara Farid', avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&auto=format&fit=crop&q=80' }
    ],
    sources: [
      { id: 's6', type: 'mp4', quality: '1080p', language: 'ar', label: 'سيرفر البرق المباشر (Direct CDN)', labelEn: 'Direct Lightning CDN', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackSeeTheWorld.mp4', isWorking: true, provider: 'Cloudflare Stream' }
    ],
    isFeatured: false,
    isTrending: false,
    isPopular: true,
    addedAt: '2026-02-25T14:30:00Z',
    ageRating: 'PG-13'
  },
  {
    id: 'mov-104',
    type: 'movie',
    title: 'المحطة الأخيرة: رحلة إلى الغيب',
    titleEn: 'The Last Station: Horizon',
    originalTitle: 'Terminal Horizon',
    year: 2024,
    releaseDate: '2024-12-05',
    rating: 8.2,
    votesCount: 21300,
    runtime: 126,
    overview: 'دراما إنسانية فلسفية تدور حول ركاب قطار ليلي يعلق في محطة جبلية نائية خلال عاصفة ثلجية، لتنكشف أسرار كل راكب ومخاوفه الدفينة.',
    overviewEn: 'A poignant philosophical drama following passengers stranded at a remote high-altitude station during a blizzard, forcing each soul to confront unspoken truths and reconciliations.',
    posterUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&auto=format&fit=crop&q=80',
    backdropUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1600&auto=format&fit=crop&q=80',
    genres: [GENRES[1], GENRES[5]],
    director: 'يسري نصر الله',
    directorEn: 'Yousry Nasrallah',
    cast: [
      { id: 'c10', name: 'ماجد الكدواني', nameEn: 'Maged El Kedwany', character: 'الناظر مختار', characterEn: 'Stationmaster Mokhtar', avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80' },
      { id: 'c11', name: 'منة شلبي', nameEn: 'Menna Shalaby', character: 'فريدة', characterEn: 'Farida', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80' }
    ],
    sources: [
      { id: 's7', type: 'mp4', quality: '1080p', language: 'ar', label: 'سيرفر VIP عالي النقاء', labelEn: 'VIP High Definition Stream', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WhatCarCanYouGetForAGrand.mp4', isWorking: true, provider: 'ArabStream CDN' }
    ],
    isFeatured: false,
    isTrending: false,
    isPopular: false,
    addedAt: '2026-01-15T09:00:00Z',
    ageRating: 'PG-13'
  }
];

export const INITIAL_SERIES: Series[] = [
  {
    id: 'ser-201',
    type: 'series',
    title: 'حارة الأسرار: العهد المفقود',
    titleEn: 'Quarter of Secrets: The Lost Covenant',
    originalTitle: 'The Lost Alley Covenant',
    startYear: 2025,
    releaseDate: '2025-10-01',
    rating: 9.1,
    votesCount: 56200,
    overview: 'مسلسل تشويق وإثارة تدور أحداثه في حي تاريخي عتيق تخفي جدرانه وثائق سرية تعود لقرن مضى، تتصارع ثلاث عائلات نافذة لامتلاكها بشتى الطرق المشروعة والدموية.',
    overviewEn: 'A gripping prestige mystery set in an ancient metropolitan district where centuries-old hidden covenants trigger a brutal war of influence among three venerable dynasties.',
    posterUrl: 'https://images.unsplash.com/photo-1514306191717-452ec28c7814?w=600&auto=format&fit=crop&q=80',
    backdropUrl: seriesBackdropImg,
    genres: [GENRES[1], GENRES[3], GENRES[5]],
    creator: 'سامر البرقاوي',
    creatorEn: 'Samer Al Barkawi',
    cast: [
      { id: 'sc1', name: 'تيم حسن', nameEn: 'Taim Hasan', character: 'جبل الصقر', characterEn: 'Jabal Al Saqr', avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80' },
      { id: 'sc2', name: 'نادين نسيب نجيم', nameEn: 'Nadine Nassib Njeim', character: 'بيان نجم', characterEn: 'Bayan Najm', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80' },
      { id: 'sc3', name: 'منى واصف', nameEn: 'Muna Wassef', character: 'أم النور', characterEn: 'Um Al Nour', avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&auto=format&fit=crop&q=80' }
    ],
    seasonsCount: 2,
    episodesCount: 20,
    seasons: [
      {
        id: 'sea-1',
        seriesId: 'ser-201',
        seasonNumber: 1,
        name: 'الموسم الأول: البدايات الغامضة',
        nameEn: 'Season 1: Dark Inceptions',
        posterUrl: 'https://images.unsplash.com/photo-1514306191717-452ec28c7814?w=600&auto=format&fit=crop&q=80',
        overview: 'فتح الصندوق الخشبي القديم وظهور أول خيوط المؤامرة.',
        airDate: '2025-10-01',
        episodesCount: 10,
        episodes: [
          {
            id: 'ep-101',
            seriesId: 'ser-201',
            seasonNumber: 1,
            episodeNumber: 1,
            title: 'حلقة 1: مفتاح السرداب',
            titleEn: 'Episode 1: The Crypt Key',
            overview: 'يعود جبل إلى مسقط رأسه بعد غياب عشر سنوات ليتفاجأ بوصية غامضة تركها والده الراحل تشير إلى سرداب مقفل.',
            overviewEn: 'Jabal returns home after a decade to discover his late fathers cryptic testament pointing toward a sealed vault.',
            stillUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80',
            duration: 48,
            airDate: '2025-10-01',
            sources: [
              { id: 'eps1', type: 'mp4', quality: '1080p', language: 'ar', label: 'سيرفر فائق السرعة (CDN)', labelEn: 'High Speed CDN', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', isWorking: true, provider: 'FastEdge CDN' },
              { id: 'eps2', type: 'mp4', quality: '720p', language: 'ar', label: 'سيرفر بديل (Mirror)', labelEn: 'Alternative Mirror', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4', isWorking: true, provider: 'FaselHD Adapter' }
            ]
          },
          {
            id: 'ep-102',
            seriesId: 'ser-201',
            seasonNumber: 1,
            episodeNumber: 2,
            title: 'حلقة 2: همسات الليل',
            titleEn: 'Episode 2: Night Whispers',
            overview: 'محاولة اقتحام منزل العائلة ليلاً تؤكد لجبل أن الوصية لم تكن مجرد أوهام، بل سر قاتل يبحث عنه الجميع.',
            overviewEn: 'A midnight break-in confirms that the testament was no delusion, but a lethal secret coveted by adversaries.',
            stillUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&auto=format&fit=crop&q=80',
            duration: 45,
            airDate: '2025-10-08',
            sources: [
              { id: 'eps3', type: 'mp4', quality: '1080p', language: 'ar', label: 'سيرفر رئيسي (CDN)', labelEn: 'Primary CDN', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', isWorking: true, provider: 'FastEdge CDN' }
            ]
          },
          {
            id: 'ep-103',
            seriesId: 'ser-201',
            seasonNumber: 1,
            episodeNumber: 3,
            title: 'حلقة 3: عقد الهدنة الهش',
            titleEn: 'Episode 3: Fragile Truce',
            overview: 'لقاء عاصف يجمع وجهاء الحي للاتفاق على تهدئة الأوضاع، لكن نوايا الغدر تشتعل خلف الأبواب المغلقة.',
            overviewEn: 'Districts elders convene to forge a tenuous peace, yet betrayal simmers behind closed courtyard doors.',
            stillUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=80',
            duration: 52,
            airDate: '2025-10-15',
            sources: [
              { id: 'eps4', type: 'mp4', quality: '1080p', language: 'ar', label: 'سيرفر رئيسي (CDN)', labelEn: 'Primary CDN', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4', isWorking: true, provider: 'FastEdge CDN' }
            ]
          }
        ]
      },
      {
        id: 'sea-2',
        seriesId: 'ser-201',
        seasonNumber: 2,
        name: 'الموسم الثاني: عاصفة الانتقام',
        nameEn: 'Season 2: Storm of Retribution',
        posterUrl: 'https://images.unsplash.com/photo-1514306191717-452ec28c7814?w=600&auto=format&fit=crop&q=80',
        overview: 'اشتعال المواجهة المباشرة بين التحالفات وسقوط الأقنعة.',
        airDate: '2026-02-01',
        episodesCount: 10,
        episodes: [
          {
            id: 'ep-201',
            seriesId: 'ser-201',
            seasonNumber: 2,
            episodeNumber: 1,
            title: 'حلقة 1: رماد الهدنة',
            titleEn: 'Episode 1: Ashes of Truce',
            overview: 'بعد انفجار مستودع البضائع، يدرك جبل أن الحرب الشاملة قد بدأت ولا رجوع عنها.',
            overviewEn: 'Following the warehouse blast, Jabal realizes full-scale war has commenced with no turning back.',
            stillUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80',
            duration: 50,
            airDate: '2026-02-01',
            sources: [
              { id: 'eps5', type: 'mp4', quality: '1080p', language: 'ar', label: 'سيرفر فائق السرعة (CDN)', labelEn: 'High Speed CDN', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4', isWorking: true, provider: 'FastEdge CDN' }
            ]
          }
        ]
      }
    ],
    isFeatured: true,
    isTrending: true,
    isPopular: true,
    addedAt: '2026-02-10T16:00:00Z',
    ageRating: '16+'
  },
  {
    id: 'ser-202',
    type: 'series',
    title: 'المحقق شمس: ملفات الجريمة المعقدة',
    titleEn: 'Inspector Shams: Cold Case Dossiers',
    originalTitle: 'Shams: Unsolved Files',
    startYear: 2025,
    releaseDate: '2025-11-20',
    rating: 8.7,
    votesCount: 31200,
    overview: 'ضابط تحقيق عبقري مصاب بالأرق يقود وحدة نخبوية متخصصة في الجرائم المعقدة والغامضة التي قيدت ضد مجهول لسنوات.',
    overviewEn: 'An insomniac master detective leads an elite investigative taskforce reopening baffling cold cases across Alexandria.',
    posterUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&auto=format&fit=crop&q=80',
    backdropUrl: cinemaActionImg,
    genres: [GENRES[3], GENRES[5], GENRES[2]],
    creator: 'أحمد مراد',
    creatorEn: 'Ahmed Mourad',
    cast: [
      { id: 'sc4', name: 'فتحي عبد الوهاب', nameEn: 'Fathy Abdel Wahab', character: 'المقدم شمس', characterEn: 'Major Shams', avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80' },
      { id: 'sc5', name: 'روبي', nameEn: 'Ruby', character: 'المحققة مريم', characterEn: 'Detective Mariam', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80' }
    ],
    seasonsCount: 1,
    episodesCount: 8,
    seasons: [
      {
        id: 'sea-shams-1',
        seriesId: 'ser-202',
        seasonNumber: 1,
        name: 'الموسم الأول: جثة الميناء',
        nameEn: 'Season 1: Harbor Corpse',
        posterUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&auto=format&fit=crop&q=80',
        overview: 'حل لغز الجريمة الغامضة في ميناء الإسكندرية القديم.',
        airDate: '2025-11-20',
        episodesCount: 8,
        episodes: [
          {
            id: 'ep-s1-1',
            seriesId: 'ser-202',
            seasonNumber: 1,
            episodeNumber: 1,
            title: 'حلقة 1: سر الرصيف 4',
            titleEn: 'Episode 1: Pier 4 Enigma',
            overview: 'العثور على حقيبة غامضة داخل حاوية شحن مهجورة يفتح قضية اختفاء تعود إلى عام 2012.',
            overviewEn: 'A container discovery triggers the reopening of a high-profile 2012 disappearance.',
            stillUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&auto=format&fit=crop&q=80',
            duration: 44,
            airDate: '2025-11-20',
            sources: [
              { id: 'eps6', type: 'mp4', quality: '1080p', language: 'ar', label: 'سيرفر فائق السرعة (CDN)', labelEn: 'High Speed CDN', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WhatCarCanYouGetForAGrand.mp4', isWorking: true, provider: 'FastEdge CDN' }
            ]
          }
        ]
      }
    ],
    isFeatured: false,
    isTrending: true,
    isPopular: true,
    addedAt: '2026-01-20T11:00:00Z',
    ageRating: '18+'
  }
];

export const INITIAL_PROVIDERS: ProviderHealth[] = [
  {
    id: 'prov-1',
    name: 'Akamai Edge Network',
    adapterName: 'AkamaiDirectHLSAdapter',
    type: 'direct',
    status: 'healthy',
    enabled: true,
    latencyMs: 38,
    successRate: 99.8,
    lastChecked: 'منذ دقيقة واحدة',
    activeSources: 142
  },
  {
    id: 'prov-2',
    name: 'FaselHD Stream Extractor',
    adapterName: 'FaselHDScraperAdapter',
    type: 'scraper',
    status: 'healthy',
    enabled: true,
    latencyMs: 145,
    successRate: 97.4,
    lastChecked: 'منذ 3 دقائق',
    activeSources: 98
  },
  {
    id: 'prov-3',
    name: 'EgyBest Cloud Stream',
    adapterName: 'EgyBestCloudAdapter',
    type: 'api',
    status: 'healthy',
    enabled: true,
    latencyMs: 82,
    successRate: 98.9,
    lastChecked: 'منذ دقيقتين',
    activeSources: 120
  },
  {
    id: 'prov-4',
    name: 'CloudStream Multi-Mirror',
    adapterName: 'CloudStreamEngine',
    type: 'api',
    status: 'degraded',
    enabled: true,
    latencyMs: 320,
    successRate: 91.2,
    lastChecked: 'منذ 5 دقائق',
    activeSources: 64
  }
];

export const INITIAL_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'log-1',
    timestamp: '2026-09-25 15:42:10',
    userId: 'usr-admin-1',
    userEmail: 'admin@movyza.tv',
    action: 'تحديث سيرفرات البث',
    actionEn: 'Update Playback Sources',
    target: 'صائد الظلال (mov-101)',
    details: 'إضافة سيرفر Akamai CDN بدقة 1080p',
    ip: '197.165.22.4'
  },
  {
    id: 'log-2',
    timestamp: '2026-09-25 14:15:33',
    userId: 'usr-owner-1',
    userEmail: 'owner@movyza.tv',
    action: 'مزامنة بيانات TMDB',
    actionEn: 'TMDB Aggressive Sync',
    target: 'حارة الأسرار (ser-201)',
    details: 'تحديث بيانات الحلقات والممثلين والصور المصغرة',
    ip: '197.165.22.1'
  },
  {
    id: 'log-3',
    timestamp: '2026-09-25 11:05:40',
    userId: 'usr-admin-1',
    userEmail: 'admin@movyza.tv',
    action: 'فحص صحة المزودات',
    actionEn: 'Health Check Triggered',
    target: 'جميع المزودات (All Providers)',
    details: 'اكتشاف بطء مؤقت في CloudStream Mirror ومعالجته',
    ip: '197.165.22.4'
  }
];
