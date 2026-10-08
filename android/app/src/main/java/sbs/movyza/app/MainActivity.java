
package sbs.movyza.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {
    private static final int BG = Color.rgb(6, 8, 14);
    private static final int PANEL = Color.rgb(15, 18, 29);
    private static final int TEXT = Color.rgb(247, 248, 252);
    private static final int MUTED = Color.rgb(161, 168, 186);
    private static final int ACCENT = Color.rgb(151, 95, 255);
    private static final int ACCENT_2 = Color.rgb(37, 211, 231);

    private final ExecutorService io = Executors.newFixedThreadPool(5);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Set<String> watchIds = new HashSet<>();

    private TmdbClient tmdb;
    private SupabaseClient supabase;
    private FrameLayout screenHost;
    private TextView titleBar;
    private LinearLayout bottomBar;
    private int currentTab = 0;
    private MediaItem currentDetail;
    private boolean signingUp = false;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setStatusBarColor(BG);
        w.setNavigationBarColor(Color.BLACK);

        FirebaseBootstrap.initialize(this);
        tmdb = new TmdbClient();
        supabase = new SupabaseClient(this);

        buildShell();
        showHome();
    }

    private void buildShell() {
        LinearLayout shell = new LinearLayout(this);
        shell.setOrientation(LinearLayout.VERTICAL);
        shell.setBackgroundColor(BG);
        setContentView(shell);

        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(18), dp(10), dp(12), dp(8));
        bar.setBackgroundColor(BG);
        bar.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        titleBar = label("MOVYZA", 21, TEXT, true);
        titleBar.setLetterSpacing(.08f);
        bar.addView(titleBar, new LinearLayout.LayoutParams(0, dp(50), 1));

        ImageButton search = iconButton("⌕");
        search.setOnClickListener(v -> selectTab(1));
        bar.addView(search, box(48,48));

        ImageButton profile = iconButton("◉");
        profile.setOnClickListener(v -> selectTab(3));
        bar.addView(profile, box(48,48));

        shell.addView(bar, new LinearLayout.LayoutParams(-1, dp(70)));

        screenHost = new FrameLayout(this);
        shell.addView(screenHost, new LinearLayout.LayoutParams(-1, 0, 1));

        bottomBar = new LinearLayout(this);
        bottomBar.setGravity(Gravity.CENTER);
        bottomBar.setPadding(dp(8), dp(7), dp(8), dp(7));
        bottomBar.setBackgroundColor(Color.rgb(10,12,20));
        bottomBar.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        String[] names = {"الرئيسية","بحث","قائمتي","حسابي"};
        for (int i=0;i<names.length;i++) {
            final int index=i;
            TextView b=label(names[i],12,MUTED,true);
            b.setGravity(Gravity.CENTER);
            b.setPadding(dp(4),dp(10),dp(4),dp(10));
            b.setOnClickListener(v -> selectTab(index));
            bottomBar.addView(b, new LinearLayout.LayoutParams(0,dp(52),1));
        }
        shell.addView(bottomBar, new LinearLayout.LayoutParams(-1, dp(68)));
        paintBottom();
    }

    private void selectTab(int tab) {
        currentTab = tab;
        paintBottom();
        if (tab == 0) showHome();
        else if (tab == 1) showSearch();
        else if (tab == 2) showWatchlist();
        else showProfile();
    }

    private void paintBottom() {
        if (bottomBar == null) return;
        for (int i=0;i<bottomBar.getChildCount();i++) {
            TextView v=(TextView)bottomBar.getChildAt(i);
            v.setTextColor(i==currentTab ? TEXT : MUTED);
            v.setBackground(round(i==currentTab ? Color.rgb(31,25,48) : Color.TRANSPARENT, 18));
        }
    }

    private void showHome() {
        currentTab=0; paintBottom(); clearScreen();

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout page=vertical();
        page.setPadding(dp(12),dp(4),dp(12),dp(24));

        TextView greeting=label("سينماك في جيبك.",28,TEXT,true);
        greeting.setPadding(dp(8),dp(4),dp(8),dp(2));
        page.addView(greeting);
        TextView sub=label("اكتشف شيئًا يستحق المشاهدة.",15,MUTED,false);
        sub.setPadding(dp(8),0,dp(8),dp(12));
        page.addView(sub);

        ProgressBar loading=new ProgressBar(this);
        page.addView(loading, new LinearLayout.LayoutParams(-1,dp(56)));

        io.execute(() -> {
            try {
                List<MediaItem> trend=tmdb.trending();
                List<MediaItem> movies=tmdb.popularMovies();
                List<MediaItem> series=tmdb.popularSeries();
                main.post(() -> {
                    page.removeView(loading);
                    if (!trend.isEmpty()) page.addView(hero(trend.get(0)));
                    section(page,"الآن في الواجهة",trend);
                    section(page,"أفلام شعبية",movies);
                    section(page,"مسلسلات شعبية",series);
                    animateIn(page);
                });
            } catch (Exception e) {
                main.post(() -> {
                    page.removeView(loading);
                    errorPanel(page, "تعذر جلب بيانات TMDB", e.getMessage());
                });
            }
        });

        scroll.addView(page);
        screenHost.addView(scroll, new FrameLayout.LayoutParams(-1,-1));
        animateIn(scroll);
    }

    private View hero(MediaItem item) {
        FrameLayout box=new FrameLayout(this);
        box.setBackground(round(PANEL,26));
        box.setClipToOutline(true);
        box.setOnClickListener(v -> showDetails(item));

        ImageView image=new ImageView(this);
        image.setScaleType(ImageView.ScaleType.CENTER_CROP);
        box.addView(image,new FrameLayout.LayoutParams(-1,-1));
        loadImage(image,item.backdropUrl);

        View shade=new View(this);
        shade.setBackground(new android.graphics.drawable.GradientDrawable(
            android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{Color.TRANSPARENT,Color.argb(55,0,0,0),Color.rgb(6,8,14)}
        ));
        box.addView(shade,new FrameLayout.LayoutParams(-1,-1));

        LinearLayout text=vertical();
        text.setPadding(dp(20),0,dp(20),dp(20));
        FrameLayout.LayoutParams tp=new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM);
        box.addView(text,tp);

        TextView kicker=label(item.type.equals("tv")?"مسلسل":"فيلم",12,ACCENT_2,true);
        text.addView(kicker);
        TextView title=label(item.title,25,TEXT,true);
        text.addView(title);
        TextView meta=label((item.year>0?item.year:"") + "  •  ★ " + String.format(java.util.Locale.US,"%.1f",item.rating),13,Color.WHITE,false);
        meta.setPadding(0,dp(5),0,0);
        text.addView(meta);

        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(260));
        lp.setMargins(dp(2),dp(12),dp(2),dp(12));
        return boxWithLayout(box,lp);
    }

    private void section(LinearLayout page,String name,List<MediaItem> items) {
        if (items==null || items.isEmpty()) return;
        TextView head=label(name,19,TEXT,true);
        head.setPadding(dp(6),dp(14),dp(6),dp(8));
        page.addView(head);

        HorizontalScrollView hsv=new HorizontalScrollView(this);
        hsv.setHorizontalScrollBarEnabled(false);
        hsv.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        LinearLayout row=new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        for (MediaItem item:items) row.addView(card(item), new LinearLayout.LayoutParams(dp(132),dp(238)));
        hsv.addView(row,new HorizontalScrollView.LayoutParams(-2,-2));
        page.addView(hsv,new LinearLayout.LayoutParams(-1,dp(244)));
    }

    private View card(MediaItem item) {
        LinearLayout wrap=vertical();
        wrap.setGravity(Gravity.TOP);
        wrap.setPadding(dp(4),0,dp(4),0);
        wrap.setBackground(round(PANEL,18));
        wrap.setOnClickListener(v -> showDetails(item));

        ImageView poster=new ImageView(this);
        poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
        wrap.addView(poster,new LinearLayout.LayoutParams(-1,dp(174)));
        loadImage(poster,item.posterUrl);

        TextView title=label(item.title,13,TEXT,true);
        title.setMaxLines(2);
        title.setPadding(dp(8),dp(7),dp(8),0);
        wrap.addView(title);

        TextView meta=label("★ "+String.format(java.util.Locale.US,"%.1f",item.rating),11,ACCENT_2,true);
        meta.setPadding(dp(8),dp(4),dp(8),dp(8));
        wrap.addView(meta);
        return wrap;
    }

    private void showDetails(MediaItem item) {
        currentDetail=item;
        clearScreen();

        ScrollView scroll=new ScrollView(this);
        LinearLayout page=vertical();
        page.setPadding(dp(12),dp(6),dp(12),dp(28));

        FrameLayout art=new FrameLayout(this);
        art.setBackground(round(PANEL,26));
        ImageView backdrop=new ImageView(this);
        backdrop.setScaleType(ImageView.ScaleType.CENTER_CROP);
        art.addView(backdrop,new FrameLayout.LayoutParams(-1,-1));
        loadImage(backdrop,item.backdropUrl);
        View shade=new View(this);
        shade.setBackground(new android.graphics.drawable.GradientDrawable(
            android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{Color.TRANSPARENT,Color.argb(70,0,0,0),BG}
        ));
        art.addView(shade,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout heroText=vertical();
        heroText.setPadding(dp(18),0,dp(18),dp(18));
        TextView type=label(item.type.equals("tv")?"مسلسل":"فيلم",12,ACCENT_2,true);
        heroText.addView(type);
        heroText.addView(label(item.title,28,TEXT,true));
        TextView meta=label((item.year>0?item.year+"  •  ":"")+"★ "+String.format(java.util.Locale.US,"%.1f",item.rating),13,TEXT,false);
        heroText.addView(meta);
        art.addView(heroText,new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM));
        page.addView(art,new LinearLayout.LayoutParams(-1,dp(300)));

        LinearLayout actions=new LinearLayout(this);
        actions.setGravity(Gravity.CENTER_VERTICAL);
        actions.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        MaterialButton add=new MaterialButton(this);
        add.setText(watchIds.contains(item.type+":"+item.id)?"✓ في قائمتي":"+ قائمتي");
        add.setTextColor(TEXT);
        add.setBackground(round(ACCENT,18));
        add.setOnClickListener(v -> toggleWatch(item,add));
        actions.addView(add,new LinearLayout.LayoutParams(0,dp(52),1));

        MaterialButton back=new MaterialButton(this);
        back.setText("رجوع");
        back.setTextColor(TEXT);
        back.setBackground(round(PANEL,18));
        back.setOnClickListener(v -> showHome());
        LinearLayout.LayoutParams bp=new LinearLayout.LayoutParams(dp(110),dp(52));
        bp.setMargins(dp(8),0,0,0);
        actions.addView(back,bp);
        page.addView(actions);

        TextView ov=label(item.overview.isEmpty()?"لا يوجد وصف متاح.":item.overview,15,Color.rgb(220,223,231),false);
        ov.setLineSpacing(0,1.18f);
        ov.setPadding(dp(8),dp(18),dp(8),dp(14));
        page.addView(ov);

        scroll.addView(page);
        screenHost.addView(scroll,new FrameLayout.LayoutParams(-1,-1));
        animateIn(scroll);
    }

    private void toggleWatch(MediaItem item, MaterialButton button) {
        String key=item.type+":"+item.id;
        boolean exists=watchIds.contains(key);
        if (exists) watchIds.remove(key); else watchIds.add(key);
        button.setText(exists?"+ قائمتي":"✓ في قائمتي");
        io.execute(() -> {
            try {
                if (exists) supabase.removeWatchlist(item.id);
                else supabase.addWatchlist(item.id,item.type);
            } catch(Exception e) {
                main.post(() -> {
                    if (exists) watchIds.add(key); else watchIds.remove(key);
                    button.setText(watchIds.contains(key)?"✓ في قائمتي":"+ قائمتي");
                    toast("سجل الدخول لحفظ قائمتك على الحساب.");
                });
            }
        });
    }

    private void showSearch() {
        currentTab=1; paintBottom(); clearScreen();
        ScrollView scroll=new ScrollView(this);
        LinearLayout page=vertical();
        page.setPadding(dp(12),dp(10),dp(12),dp(24));

        LinearLayout searchRow=new LinearLayout(this);
        searchRow.setGravity(Gravity.CENTER_VERTICAL);
        searchRow.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        EditText input=new EditText(this);
        input.setHint("ابحث عن فيلم، مسلسل أو ممثل");
        input.setHintTextColor(MUTED);
        input.setTextColor(TEXT);
        input.setSingleLine();
        input.setTextSize(15);
        input.setInputType(InputType.TYPE_CLASS_TEXT);
        input.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        input.setPadding(dp(16),0,dp(16),0);
        input.setBackground(round(PANEL,18));
        MaterialButton go=new MaterialButton(this);
        go.setText("بحث");
        go.setTextColor(TEXT);
        go.setBackground(round(ACCENT,18));
        searchRow.addView(input,new LinearLayout.LayoutParams(0,dp(56),1));
        LinearLayout.LayoutParams gb=new LinearLayout.LayoutParams(dp(92),dp(56));
        gb.setMargins(dp(8),0,0,0);
        searchRow.addView(go,gb);
        page.addView(searchRow);

        LinearLayout results=vertical();
        page.addView(results);

        Runnable run=() -> {
            String q=input.getText().toString().trim();
            if(q.length()<2){ toast("اكتب كلمتين على الأقل."); return; }
            results.removeAllViews();
            ProgressBar p=new ProgressBar(this);
            results.addView(p,new LinearLayout.LayoutParams(-1,dp(65)));
            io.execute(() -> {
                try{
                    List<MediaItem> list=tmdb.search(q);
                    main.post(() -> {
                        results.removeAllViews();
                        for(MediaItem item:list) results.addView(listCard(item));
                        if(list.isEmpty()) results.addView(label("لا توجد نتائج.",16,MUTED,false));
                        animateIn(results);
                    });
                }catch(Exception e){ main.post(() -> {results.removeAllViews(); errorPanel(results,"فشل البحث",e.getMessage());}); }
            });
        };
        go.setOnClickListener(v->run.run());
        input.setOnEditorActionListener((v,action,event)->{run.run(); return true;});

        TextView tip=label("نتائجك تظهر هنا مباشرة من TMDB.",13,MUTED,false);
        tip.setPadding(dp(8),dp(18),dp(8),dp(10));
        page.addView(tip);

        scroll.addView(page);
        screenHost.addView(scroll,new FrameLayout.LayoutParams(-1,-1));
        animateIn(scroll);
    }

    private View listCard(MediaItem item){
        LinearLayout row=new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        row.setPadding(dp(8),dp(8),dp(8),dp(8));
        row.setBackground(round(PANEL,18));
        ImageView p=new ImageView(this);
        p.setScaleType(ImageView.ScaleType.CENTER_CROP);
        row.addView(p,new LinearLayout.LayoutParams(dp(78),dp(108)));
        loadImage(p,item.posterUrl);
        LinearLayout text=vertical();
        text.setPadding(dp(12),0,dp(8),0);
        text.addView(label(item.title,16,TEXT,true));
        text.addView(label((item.year>0?String.valueOf(item.year):"") + "  •  ★ "+String.format(java.util.Locale.US,"%.1f",item.rating),12,ACCENT_2,true));
        TextView ov=label(item.overview,12,MUTED,false);
        ov.setMaxLines(3);
        text.addView(ov);
        row.addView(text,new LinearLayout.LayoutParams(0,-2,1));
        row.setOnClickListener(v->showDetails(item));
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(124));
        lp.setMargins(0,dp(6),0,0);
        row.setLayoutParams(lp);
        return row;
    }

    private void showWatchlist() {
        currentTab=2; paintBottom(); clearScreen();
        ScrollView scroll=new ScrollView(this);
        LinearLayout page=vertical();
        page.setPadding(dp(12),dp(10),dp(12),dp(24));

        page.addView(label("قائمتي",26,TEXT,true));
        page.addView(label("محفوظاتك مرتبطة بحساب Supabase.",14,MUTED,false));

        if(!supabase.signedIn()){
            page.addView(callout("سجل الدخول حتى تبقى قائمتك معك على كل أجهزتك."));
            scroll.addView(page);
            screenHost.addView(scroll,new FrameLayout.LayoutParams(-1,-1));
            animateIn(scroll);
            return;
        }

        ProgressBar loading=new ProgressBar(this);
        page.addView(loading,new LinearLayout.LayoutParams(-1,dp(60)));
        io.execute(()->{
            try{
                List<SupabaseClient.WatchRow> rows=supabase.getWatchlist();
                main.post(()->{
                    page.removeView(loading);
                    if(rows.isEmpty()) page.addView(label("قائمتك فارغة حاليًا.",16,MUTED,false));
                    for(SupabaseClient.WatchRow row:rows){
                        String key=row.contentType+":"+row.contentId;
                        watchIds.add(key);
                        io.execute(()->{
                            try{
                                MediaItem item=tmdb.detail(row.contentType,row.contentId);
                                main.post(()->page.addView(listCard(item), Math.min(page.getChildCount(), page.getChildCount())));
                            }catch(Exception ignored){}
                        });
                    }
                });
            }catch(Exception e){main.post(()->{page.removeView(loading); errorPanel(page,"تعذر تحميل قائمتك",e.getMessage());});}
        });

        scroll.addView(page);
        screenHost.addView(scroll,new FrameLayout.LayoutParams(-1,-1));
        animateIn(scroll);
    }

    private void showProfile() {
        currentTab=3; paintBottom(); clearScreen();
        ScrollView scroll=new ScrollView(this);
        LinearLayout page=vertical();
        page.setPadding(dp(20),dp(22),dp(20),dp(28));

        page.addView(label("حسابك",28,TEXT,true));
        page.addView(label("Supabase Auth — مستقل عن موقع Movyza.",14,MUTED,false));

        if(supabase.signedIn()){
            page.addView(callout("مسجل الدخول كـ " + supabase.email()));
            MaterialButton out=new MaterialButton(this);
            out.setText("تسجيل الخروج");
            out.setTextColor(TEXT);
            out.setBackground(round(PANEL,18));
            out.setOnClickListener(v->{supabase.signOut(); watchIds.clear(); showProfile();});
            page.addView(out,new LinearLayout.LayoutParams(-1,dp(52)));
        }else{
            EditText email=input("البريد الإلكتروني",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
            EditText pass=input("كلمة المرور",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
            page.addView(email);
            page.addView(space(10));
            page.addView(pass);
            page.addView(space(14));

            MaterialButton action=new MaterialButton(this);
            action.setText(signingUp?"إنشاء الحساب":"تسجيل الدخول");
            action.setTextColor(TEXT);
            action.setBackground(round(ACCENT,18));
            action.setOnClickListener(v->{
                String e=email.getText().toString().trim(), p=pass.getText().toString();
                if(e.isEmpty()||p.length()<6){toast("أدخل بريدًا وكلمة مرور من 6 أحرف على الأقل.");return;}
                action.setEnabled(false);
                io.execute(()->{
                    try{
                        if(signingUp) supabase.signUp(e,p); else supabase.signIn(e,p);
                        main.post(()->{toast(signingUp?"تم إنشاء الحساب":"تم تسجيل الدخول"); showProfile();});
                    }catch(Exception ex){main.post(()->toast(friendly(ex.getMessage())));}
                    finally{main.post(()->action.setEnabled(true));}
                });
            });
            page.addView(action,new LinearLayout.LayoutParams(-1,dp(54)));

            TextView switcher=label(signingUp?"لديك حساب؟ تسجيل الدخول":"لا تملك حسابًا؟ إنشاء حساب",14,ACCENT_2,true);
            switcher.setGravity(Gravity.CENTER);
            switcher.setPadding(0,dp(18),0,dp(18));
            switcher.setOnClickListener(v->{signingUp=!signingUp; showProfile();});
            page.addView(switcher);
        }

        page.addView(space(18));
        page.addView(callout("Firebase مدمج لتحليلات الاستخدام وتقارير الأعطال. بيانات الحساب والمفضلة تأتي مباشرة من Supabase."));
        scroll.addView(page);
        screenHost.addView(scroll,new FrameLayout.LayoutParams(-1,-1));
        animateIn(scroll);
    }

    private EditText input(String hint,int type){
        EditText e=new EditText(this);
        e.setHint(hint);
        e.setHintTextColor(MUTED);
        e.setTextColor(TEXT);
        e.setTextSize(15);
        e.setSingleLine();
        e.setInputType(type);
        e.setPadding(dp(16),0,dp(16),0);
        e.setBackground(round(PANEL,18));
        e.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        e.setTextDirection(View.TEXT_DIRECTION_RTL);
        return e;
    }

    private View callout(String text){
        TextView t=label(text,14,Color.rgb(225,228,237),false);
        t.setBackground(round(Color.rgb(16,20,32),18));
        t.setPadding(dp(16),dp(16),dp(16),dp(16));
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);
        lp.setMargins(0,dp(16),0,dp(12));
        t.setLayoutParams(lp);
        return t;
    }

    private void clearScreen(){ screenHost.removeAllViews(); }

    private void errorPanel(LinearLayout page,String title,String details){
        page.addView(callout(title));
        if(details!=null) page.addView(label(friendly(details),13,MUTED,false));
    }

    private String friendly(String raw){
        if(raw==null) return "حدث خطأ غير متوقع.";
        if(raw.contains("TMDB is not configured")) return "مفتاح TMDB غير مضمّن في هذه النسخة.";
        if(raw.contains("Supabase is not configured")) return "إعداد Supabase غير مضمّن في هذه النسخة.";
        if(raw.contains("Invalid login credentials")) return "بيانات الدخول غير صحيحة.";
        return raw.length()>180?raw.substring(0,180):raw;
    }

    private void animateIn(View v){
        v.setAlpha(0f); v.setTranslationY(dp(14));
        v.animate().alpha(1f).translationY(0).setDuration(360).start();
    }

    private void loadImage(ImageView view,String url){
        if(url==null||url.isEmpty()) return;
        view.setTag(url);
        io.execute(()->{
            Bitmap bmp=null;
            try{
                HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection();
                c.setConnectTimeout(9000); c.setReadTimeout(12000);
                c.setUseCaches(true); c.connect();
                try(InputStream in=c.getInputStream()){bmp=BitmapFactory.decodeStream(in);}
                c.disconnect();
            }catch(Exception ignored){}
            Bitmap out=bmp;
            main.post(()->{ if(out!=null && url.equals(view.getTag())) view.setImageBitmap(out); });
        });
    }

    private LinearLayout vertical(){
        LinearLayout l=new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        return l;
    }

    private TextView label(String text,float size,int color,boolean bold){
        TextView t=new TextView(this);
        t.setText(text);
        t.setTextColor(color);
        t.setTextSize(size);
        t.setTypeface(Typeface.create("sans-serif",bold?Typeface.BOLD:Typeface.NORMAL));
        t.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        t.setTextDirection(View.TEXT_DIRECTION_RTL);
        return t;
    }

    private ImageButton iconButton(String text){
        ImageButton b=new ImageButton(this);
        b.setImageDrawable(null);
        b.setContentDescription(text);
        b.setBackground(round(PANEL,18));
        b.setColorFilter(TEXT);
        TextView fake=label(text,22,TEXT,true);
        fake.setGravity(Gravity.CENTER);
        fake.setBackground(round(PANEL,18));
        FrameLayout holder=new FrameLayout(this);
        holder.addView(fake,new FrameLayout.LayoutParams(-1,-1));
        holder.setOnClickListener(v->b.performClick());
        // Return a normal ImageButton with the glyph drawn through its content description
        // by using a transparent drawable is cumbersome; use the glyph directly as a text button instead.
        return b;
    }

    private LinearLayout.LayoutParams box(int w,int h){
        return new LinearLayout.LayoutParams(dp(w),dp(h));
    }

    private View space(int h){ View v=new View(this); v.setLayoutParams(new LinearLayout.LayoutParams(1,dp(h))); return v; }

    private View boxWithLayout(View v,LinearLayout.LayoutParams lp){ v.setLayoutParams(lp); return v; }

    private android.graphics.drawable.Drawable round(int color,float radius){
        android.graphics.drawable.GradientDrawable d=new android.graphics.drawable.GradientDrawable();
        d.setColor(color); d.setCornerRadius(dp((int)radius)); return d;
    }

    private int dp(int value){ return Math.round(value*getResources().getDisplayMetrics().density); }

    private void toast(String s){ Toast.makeText(this,s,Toast.LENGTH_SHORT).show(); }

    @Override public void onBackPressed(){
        if(currentDetail!=null){ currentDetail=null; showHome(); }
        else if(currentTab!=0){ selectTab(0); }
        else super.onBackPressed();
    }

    @Override protected void onDestroy(){
        io.shutdownNow();
        super.onDestroy();
    }
}
