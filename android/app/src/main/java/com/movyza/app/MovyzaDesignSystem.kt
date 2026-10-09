package com.movyza.app

import android.provider.Settings
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BookmarkAdd
import androidx.compose.material.icons.outlined.BookmarkAdded
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.TextDirection
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.movyza.app.data.CastMemberItem
import com.movyza.app.data.Movie
import com.movyza.app.data.WatchHistoryEntry
import java.util.Locale

object MovyzaColors {
    // Midnight Glass palette from the supplied native-app design specification.
    val Bg = Color(0xFF05070D)
    val Bg2 = Color(0xFF0A1226)
    val SurfaceElevated = Color(0xFF101C38)
    // Compatibility alias used by existing screen and player-theme code.
    val Navy500 = Color(0xFF0A1226)

    val Gold300 = Color(0xFFF5B942)
    val Gold400 = Color(0xFFF5B942)
    val Gold500 = Color(0xFFC8902A)
    val Gold600 = Color(0xFFC8902A)
    val Gold700 = Color(0xFF80531A)

    val Text = Color(0xFFF4F6FB)
    val Text2 = Color(0xFFA9B2C7)
    val Text3 = Color(0xFF6B7590)

    val GoldSoft = Gold400.copy(alpha = 0.16f)
    val GoldBrush = Brush.linearGradient(listOf(Gold400, Gold600))
    val ScreenBrush = Brush.verticalGradient(listOf(Bg, Bg2, Bg))
    val GlassFill = Brush.verticalGradient(
        listOf(Color.White.copy(alpha = 0.10f), Color.White.copy(alpha = 0.03f))
    )
    val GlassStroke = Brush.verticalGradient(
        listOf(Color.White.copy(alpha = 0.28f), Color.White.copy(alpha = 0.04f))
    )

    // Keep public aliases used throughout existing screens.
    val Glass = Color.White.copy(alpha = 0.10f)
    val Glass2 = Color.White.copy(alpha = 0.03f)
    val GlassStrong = Color(0xE60A1226)
    val GlassCardBg = Color(0x330A1226)
    val GlassBorder = Color.White.copy(alpha = 0.16f)
    val GoldBorder = Gold400.copy(alpha = 0.42f)
    val SkeletonFill = Color(0xFF101C38)
    val SkeletonHighlight = Color(0xFF1A2945)
}

object MovyzaShapes {
    val Xs = RoundedCornerShape(10.dp)
    val Sm = RoundedCornerShape(14.dp)
    val Md = RoundedCornerShape(22.dp)
    val Lg = RoundedCornerShape(22.dp)
    val Xl = RoundedCornerShape(28.dp)
    val Pill = RoundedCornerShape(999.dp)
    val Poster = RoundedCornerShape(20.dp)
}

@Composable
fun rememberReducedMotion(): Boolean {
    val context = LocalContext.current
    return remember(context) {
        runCatching {
            Settings.Global.getFloat(
                context.contentResolver,
                Settings.Global.ANIMATOR_DURATION_SCALE,
                1f
            ) == 0f
        }.getOrDefault(false)
    }
}

/** Static one-pass Midnight Glass background; no blur and no ongoing animation. */
@Composable
fun MovyzaMidnightBackdrop(modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        drawRect(brush = MovyzaColors.ScreenBrush)
        drawCircle(
            color = MovyzaColors.Gold400.copy(alpha = 0.06f),
            radius = size.width * 0.76f,
            center = Offset(size.width * 0.92f, size.height * 0.03f)
        )
    }
}

val MovyzaFontFamily = FontFamily.SansSerif

val MovyzaTitle = TextStyle(
    fontFamily = MovyzaFontFamily,
    fontWeight = FontWeight.Bold,
    color = MovyzaColors.Text
)

val MovyzaBody = TextStyle(
    fontFamily = MovyzaFontFamily,
    fontWeight = FontWeight.Normal,
    color = MovyzaColors.Text2
)

@Composable
fun MovyzaTheme(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
        MaterialTheme(
            colorScheme = darkColorScheme(
                primary = MovyzaColors.Gold400,
                secondary = MovyzaColors.Gold500,
                tertiary = MovyzaColors.Navy500,
                background = MovyzaColors.Bg,
                surface = MovyzaColors.Bg2,
                surfaceVariant = MovyzaColors.SurfaceElevated,
                onPrimary = MovyzaColors.Bg,
                onBackground = MovyzaColors.Text,
                onSurface = MovyzaColors.Text
            ),
            typography = Typography(
                headlineLarge = MovyzaTitle.copy(fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.Black),
                titleLarge = MovyzaTitle.copy(fontSize = 21.sp, lineHeight = 27.sp, fontWeight = FontWeight.ExtraBold),
                titleMedium = MovyzaTitle.copy(fontSize = 17.sp, lineHeight = 23.sp, fontWeight = FontWeight.Bold),
                bodyLarge = MovyzaBody.copy(fontSize = 14.sp, lineHeight = 22.sp),
                bodyMedium = MovyzaBody.copy(fontSize = 13.sp, lineHeight = 20.sp),
                labelLarge = MovyzaTitle.copy(fontSize = 13.sp, fontWeight = FontWeight.Bold),
                labelMedium = MovyzaBody.copy(fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            ),
            content = content
        )
    }
}

@Composable
fun GlassCard(
    modifier: Modifier = Modifier,
    shape: Shape = MovyzaShapes.Lg,
    strong: Boolean = false,
    goldAccent: Boolean = false,
    onClick: (() -> Unit)? = null,
    content: @Composable BoxScope.() -> Unit
) {
    val clickModifier = if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier
    val glassBorder = if (goldAccent) {
        Brush.verticalGradient(
            listOf(
                MovyzaColors.Gold400.copy(alpha = 0.68f),
                MovyzaColors.Gold600.copy(alpha = 0.20f)
            )
        )
    } else MovyzaColors.GlassStroke

    Box(
        modifier = modifier
            .clip(shape)
            .background(
                if (strong) MovyzaColors.Bg2.copy(alpha = 0.68f)
                else MovyzaColors.Bg2.copy(alpha = 0.22f),
                shape
            )
            .background(MovyzaColors.GlassFill, shape)
            .border(width = 0.8.dp, brush = glassBorder, shape = shape)
            .then(clickModifier),
        content = content
    )
}

@Composable
fun GlassIconButton(
    onClick: () -> Unit,
    icon: ImageVector,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    tint: Color = MovyzaColors.Text,
    goldBorder: Boolean = false
) {
    Surface(
        modifier = modifier.size(48.dp),
        shape = CircleShape,
        color = MovyzaColors.Bg2.copy(alpha = 0.72f),
        border = BorderStroke(0.8.dp, if (goldBorder) MovyzaColors.GoldBorder else MovyzaColors.GlassStroke)
    ) {
        IconButton(onClick = onClick) {
            Icon(icon, contentDescription = contentDescription, tint = tint, modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
fun GoldButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = Icons.Outlined.PlayArrow,
    enabled: Boolean = true
) {
    val reducedMotion = rememberReducedMotion()
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed && !reducedMotion && enabled) 0.96f else 1f,
        animationSpec = tween(durationMillis = 140, easing = FastOutSlowInEasing),
        label = "gold-button-press"
    )
    Row(
        modifier = modifier
            .height(54.dp)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(MovyzaShapes.Pill)
            .background(MovyzaColors.GoldBrush)
            .border(
                0.8.dp,
                Brush.verticalGradient(
                    listOf(Color.White.copy(alpha = 0.32f), Color.White.copy(alpha = 0.04f))
                ),
                MovyzaShapes.Pill
            )
            .clickable(
                enabled = enabled,
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick
            )
            .padding(horizontal = 18.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(19.dp), tint = MovyzaColors.Bg)
            Spacer(Modifier.width(7.dp))
        }
        Text(
            text = text,
            color = MovyzaColors.Bg,
            fontWeight = FontWeight.Black,
            fontSize = 14.sp,
            maxLines = 1
        )
    }
}

@Composable
fun GlassPill(
    text: String,
    modifier: Modifier = Modifier,
    active: Boolean = false,
    icon: ImageVector? = null,
    onClick: (() -> Unit)? = null
) {
    val shape = MovyzaShapes.Pill
    val textColor = if (active) MovyzaColors.Gold300 else MovyzaColors.Text2
    val clickMod = if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier
    val fillBrush = if (active) {
        Brush.verticalGradient(
            listOf(MovyzaColors.Gold400.copy(alpha = 0.22f), MovyzaColors.Gold600.copy(alpha = 0.12f))
        )
    } else MovyzaColors.GlassFill

    Row(
        modifier = modifier
            .clip(shape)
            .background(fillBrush, shape)
            .border(0.8.dp, if (active) MovyzaColors.GoldBorder else MovyzaColors.GlassStroke, shape)
            .then(clickMod)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = textColor, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(7.dp))
        }
        Text(
            text = text,
            color = textColor,
            fontSize = 12.sp,
            fontWeight = if (active) FontWeight.Bold else FontWeight.SemiBold,
            maxLines = 1
        )
    }
}

@Composable
fun MovyzaBadge(
    text: String,
    modifier: Modifier = Modifier,
    gold: Boolean = true
) {
    Box(
        modifier = modifier
            .clip(MovyzaShapes.Pill)
            .background(Color(0xCC050812))
            .border(1.dp, if (gold) MovyzaColors.GoldBorder else MovyzaColors.GlassBorder, MovyzaShapes.Pill)
            .padding(horizontal = 9.dp, vertical = 4.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = text,
            color = if (gold) MovyzaColors.Gold300 else MovyzaColors.Text2,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1
        )
    }
}

@Composable
fun SectionHeader(
    title: String,
    subtitle: String? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .width(3.dp)
                .height(22.dp)
                .clip(MovyzaShapes.Pill)
                .background(MovyzaColors.Gold400)
        )
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = title,
                color = MovyzaColors.Text,
                fontSize = 18.sp,
                fontWeight = FontWeight.ExtraBold,
                maxLines = 1
            )
            if (!subtitle.isNullOrBlank()) {
                Text(
                    text = subtitle,
                    color = MovyzaColors.Text3,
                    fontSize = 11.sp,
                    maxLines = 1
                )
            }
        }
        if (actionLabel != null && onAction != null) {
            Text(
                text = actionLabel,
                color = MovyzaColors.Gold300,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .clip(MovyzaShapes.Sm)
                    .clickable(onClick = onAction)
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            )
        }
    }
}

/**
 * Fixed-Structure Hero Banner Template:
 * Keeps the exact same Box/Column/Row/Button hierarchy whether `movie` is null (loading) or loaded.
 */
@Composable
fun MovyzaHeroTemplate(
    movie: Movie?,
    watchlisted: Boolean,
    heroIndex: Int = 0,
    heroCount: Int = 1,
    onSelectHeroIndex: ((Int) -> Unit)? = null,
    onPlay: () -> Unit,
    onOpenDetails: () -> Unit,
    onToggleWatchlist: () -> Unit,
    modifier: Modifier = Modifier
) {
    val hasData = movie != null
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(500.dp)
            .padding(horizontal = 16.dp)
            .clip(MovyzaShapes.Xl)
            .background(MovyzaColors.SurfaceElevated)
            .border(1.dp, MovyzaColors.GlassBorder, MovyzaShapes.Xl)
            .then(if (hasData) Modifier.clickable(onClick = onOpenDetails) else Modifier)
    ) {
        AsyncImage(
            model = movie?.backdropUrl ?: movie?.posterUrl,
            contentDescription = movie?.displayTitle,
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop
        )

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0.0f to Color(0x44040507),
                        0.36f to Color.Transparent,
                        0.68f to Color(0xD9040507),
                        1.0f to MovyzaColors.Bg
                    )
                )
        )

        Row(
            modifier = Modifier
                .align(Alignment.TopStart)
                .fillMaxWidth()
                .padding(14.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            MovyzaBadge(
                text = if (hasData) "اختيار Movyza" else "جارٍ التحميل"
            )

            if (heroCount > 1) {
                Row(
                    modifier = Modifier
                        .clip(MovyzaShapes.Pill)
                        .background(Color(0xB3050812))
                        .border(1.dp, MovyzaColors.GlassBorder, MovyzaShapes.Pill)
                        .padding(horizontal = 8.dp, vertical = 5.dp),
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    for (idx in 0 until heroCount) {
                        val active = idx == heroIndex
                        Box(
                            modifier = Modifier
                                .height(6.dp)
                                .width(if (active) 18.dp else 6.dp)
                                .clip(MovyzaShapes.Pill)
                                .background(if (active) MovyzaColors.Gold300 else MovyzaColors.Text3.copy(alpha = 0.45f))
                                .clickable { onSelectHeroIndex?.invoke(idx) }
                        )
                    }
                }
            }
        }

        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .padding(18.dp)
        ) {
            Text(
                text = movie?.displayTitle ?: "٠٠٠٠٠٠٠٠٠٠٠٠٠٠",
                color = if (hasData) MovyzaColors.Text else Color.Transparent,
                fontSize = 29.sp,
                lineHeight = 35.sp,
                fontWeight = FontWeight.Black,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = if (!hasData) {
                    Modifier
                        .fillMaxWidth(0.68f)
                        .clip(MovyzaShapes.Xs)
                        .background(MovyzaColors.SkeletonHighlight)
                } else Modifier
            )

            Spacer(Modifier.height(8.dp))

            val metaText = if (movie != null) {
                listOfNotNull(
                    "★ " + String.format(Locale.US, "%.1f", movie.rating),
                    if (movie.mediaType == "series") "مسلسل" else "فيلم",
                    movie.yearText.takeIf { it.isNotBlank() }
                ).joinToString("  •  ")
            } else {
                "★ 0.0  •  فيلم  •  2026"
            }

            Text(
                text = metaText,
                color = if (hasData) MovyzaColors.Gold300 else Color.Transparent,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                modifier = if (!hasData) {
                    Modifier
                        .width(150.dp)
                        .clip(MovyzaShapes.Xs)
                        .background(MovyzaColors.SkeletonFill)
                } else Modifier
            )

            Spacer(Modifier.height(8.dp))

            Text(
                text = movie?.overview?.takeIf { it.isNotBlank() }
                    ?: "اكتشف التفاصيل الكاملة وشاهد بجودة عالية على منصة موفيزا.",
                color = if (hasData) MovyzaColors.Text2 else Color.Transparent,
                fontSize = 13.sp,
                lineHeight = 20.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = if (!hasData) {
                    Modifier
                        .fillMaxWidth(0.9f)
                        .clip(MovyzaShapes.Xs)
                        .background(MovyzaColors.SkeletonFill)
                } else Modifier
            )

            Spacer(Modifier.height(14.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                GoldButton(
                    text = "مشاهدة الآن",
                    onClick = onPlay,
                    enabled = hasData,
                    modifier = Modifier.weight(1f)
                )

                GlassCard(
                    modifier = Modifier.height(48.dp),
                    shape = MovyzaShapes.Md,
                    strong = true,
                    onClick = if (hasData) onOpenDetails else null
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Outlined.Info,
                            contentDescription = "التفاصيل",
                            tint = MovyzaColors.Text,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            "التفاصيل",
                            color = MovyzaColors.Text,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

                GlassIconButton(
                    onClick = { if (hasData) onToggleWatchlist() },
                    icon = if (watchlisted) Icons.Outlined.BookmarkAdded else Icons.Outlined.BookmarkAdd,
                    contentDescription = "قائمتي",
                    tint = if (watchlisted) MovyzaColors.Gold300 else MovyzaColors.Text,
                    goldBorder = watchlisted,
                    modifier = Modifier.size(48.dp)
                )
            }
        }
    }
}

/**
 * Fixed-Structure Vertical Poster Card Template:
 * Identical Composable node layout during loading (`movie == null`) and loaded (`movie != null`).
 */
@Composable
fun MovyzaPosterCardTemplate(
    movie: Movie?,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    fixedWidth: Dp? = 150.dp
) {
    // Poster cards now follow the web catalogue pattern: artwork first, title below,
    // and compact rating/year metadata outside the poster (not oversized overlay badges).
    val sizeMod = if (fixedWidth != null) modifier.width(fixedWidth) else modifier.fillMaxWidth()
    val clickMod = if (movie != null && onClick != null) Modifier.clickable(onClick = onClick) else Modifier

    Column(
        modifier = sizeMod.then(clickMod)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(0.68f)
                .clip(MovyzaShapes.Md)
                .background(MovyzaColors.SurfaceElevated)
                .border(1.dp, MovyzaColors.GlassBorder, MovyzaShapes.Md)
        ) {
            AsyncImage(
                model = movie?.posterUrl,
                contentDescription = movie?.displayTitle,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop
            )

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0.0f to Color.Transparent,
                            0.64f to Color.Transparent,
                            1.0f to Color(0xD9040507)
                        )
                    )
            )

            if (movie != null) {
                MovyzaBadge(
                    text = if (movie.mediaType == "series") "مسلسل" else "فيلم",
                    gold = false,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(8.dp)
                )
            } else {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(8.dp)
                        .size(width = 42.dp, height = 18.dp)
                        .clip(MovyzaShapes.Pill)
                        .background(MovyzaColors.SkeletonHighlight)
                )
            }
        }

        Spacer(Modifier.height(10.dp))

        Text(
            text = movie?.displayTitle ?: "٠٠٠٠٠٠٠٠٠٠",
            color = if (movie != null) MovyzaColors.Text else Color.Transparent,
            fontSize = 13.sp,
            lineHeight = 18.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = if (movie == null) {
                Modifier
                    .fillMaxWidth(0.82f)
                    .clip(MovyzaShapes.Xs)
                    .background(MovyzaColors.SkeletonHighlight)
            } else Modifier.fillMaxWidth()
        )

        Spacer(Modifier.height(4.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(
                text = if (movie != null) "★" else " ",
                color = if (movie != null) MovyzaColors.Gold300 else Color.Transparent,
                fontSize = 11.sp,
                fontWeight = FontWeight.Black
            )
            Text(
                text = movie?.let { String.format(Locale.US, "%.1f", it.rating) } ?: "0.0",
                color = if (movie != null) MovyzaColors.Gold300 else Color.Transparent,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                modifier = if (movie == null) Modifier
                    .width(24.dp)
                    .clip(MovyzaShapes.Xs)
                    .background(MovyzaColors.SkeletonFill) else Modifier
            )
            Text(
                text = "·",
                color = MovyzaColors.Text3,
                fontSize = 11.sp
            )
            Text(
                text = movie?.yearText?.ifBlank { "—" } ?: "2026",
                color = if (movie != null) MovyzaColors.Text3 else Color.Transparent,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Clip,
                modifier = if (movie == null) Modifier
                    .width(42.dp)
                    .clip(MovyzaShapes.Xs)
                    .background(MovyzaColors.SkeletonFill) else Modifier
            )
        }
    }
}

/**
 * Fixed-Structure Horizontal Media Card Template:
 * Used in Search & Watchlist. Preserves identical layout tree whether `movie` is null or loaded.
 */
@Composable
fun MovyzaHorizontalCardTemplate(
    movie: Movie?,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier
) {
    val hasData = movie != null && onClick != null
    GlassCard(
        modifier = modifier
            .fillMaxWidth()
            .height(114.dp),
        shape = MovyzaShapes.Md,
        onClick = if (hasData) onClick else null
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(width = 68.dp, height = 94.dp)
                    .clip(MovyzaShapes.Sm)
                    .background(MovyzaColors.SurfaceElevated)
                    .border(1.dp, MovyzaColors.GlassBorder, MovyzaShapes.Sm)
            ) {
                AsyncImage(
                    model = movie?.posterUrl,
                    contentDescription = movie?.displayTitle,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
            }

            Spacer(Modifier.width(12.dp))

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.Center
            ) {
                Text(
                    text = movie?.displayTitle ?: "٠٠٠٠٠٠٠٠٠٠٠٠",
                    color = if (movie != null) MovyzaColors.Text else Color.Transparent,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = if (movie == null) {
                        Modifier
                            .fillMaxWidth(0.65f)
                            .clip(MovyzaShapes.Xs)
                            .background(MovyzaColors.SkeletonHighlight)
                    } else Modifier
                )

                Spacer(Modifier.height(5.dp))

                val meta = if (movie != null) {
                    listOfNotNull(
                        "★ " + String.format(Locale.US, "%.1f", movie.rating),
                        if (movie.mediaType == "series") "مسلسل" else "فيلم",
                        movie.yearText.takeIf { it.isNotBlank() }
                    ).joinToString("  •  ")
                } else {
                    "★ 0.0  •  فيلم"
                }

                Text(
                    text = meta,
                    color = if (movie != null) MovyzaColors.Gold300 else Color.Transparent,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    modifier = if (movie == null) {
                        Modifier
                            .width(110.dp)
                            .clip(MovyzaShapes.Xs)
                            .background(MovyzaColors.SkeletonFill)
                    } else Modifier
                )

                Spacer(Modifier.height(5.dp))

                Text(
                    text = movie?.overview?.ifBlank { "اضغط لعرض التفاصيل والمشاهدة المباشرة." }
                        ?: "٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠",
                    color = if (movie != null) MovyzaColors.Text3 else Color.Transparent,
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = if (movie == null) {
                        Modifier
                            .fillMaxWidth(0.88f)
                            .clip(MovyzaShapes.Xs)
                            .background(MovyzaColors.SkeletonFill)
                    } else Modifier
                )
            }
        }
    }
}

@Composable
fun MovyzaContinueWatchingCard(
    entry: WatchHistoryEntry,
    onResume: () -> Unit,
    onDetails: () -> Unit,
    modifier: Modifier = Modifier
) {
    GlassCard(
        modifier = modifier
            .width(235.dp)
            .height(132.dp),
        shape = MovyzaShapes.Md,
        goldAccent = true,
        onClick = onResume
    ) {
        Box(Modifier.fillMaxSize()) {
            AsyncImage(
                model = entry.backdropPath?.let { "https://image.tmdb.org/t/p/w500$it" }
                    ?: entry.posterPath?.let { "https://image.tmdb.org/t/p/w342$it" },
                contentDescription = entry.title,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0.0f to Color(0x4D04060D),
                            0.45f to Color(0x9904060D),
                            1.0f to Color(0xF204060D)
                        )
                    )
            )

            MovyzaBadge(
                text = if (entry.mediaType == "series") "م${entry.season} • ح${entry.episode}" else "متابعة الفيلم",
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(8.dp)
            )

            Box(
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(38.dp)
                    .clip(CircleShape)
                    .background(MovyzaColors.Gold400),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Outlined.PlayArrow,
                    contentDescription = "استئناف",
                    tint = MovyzaColors.Bg,
                    modifier = Modifier.size(22.dp)
                )
            }

            Column(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .padding(10.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = entry.title,
                        color = MovyzaColors.Text,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = "التفاصيل",
                        color = MovyzaColors.Gold300,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .clip(MovyzaShapes.Xs)
                            .clickable(onClick = onDetails)
                            .padding(horizontal = 4.dp, vertical = 2.dp)
                    )
                }
                Spacer(Modifier.height(6.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(4.dp)
                        .clip(MovyzaShapes.Pill)
                        .background(MovyzaColors.GlassBorder)
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxHeight()
                            .fillMaxWidth(entry.progressFraction)
                            .clip(MovyzaShapes.Pill)
                            .background(MovyzaColors.Gold400)
                    )
                }
            }
        }
    }
}

@Composable
fun MovyzaCastBubble(
    member: CastMemberItem,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.width(86.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(68.dp)
                .clip(CircleShape)
                .background(MovyzaColors.SurfaceElevated)
                .border(1.dp, MovyzaColors.GlassBorder, CircleShape),
            contentAlignment = Alignment.Center
        ) {
            if (member.profileUrl != null) {
                AsyncImage(
                    model = member.profileUrl,
                    contentDescription = member.name,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
            } else {
                Icon(
                    Icons.Outlined.Person,
                    contentDescription = null,
                    tint = MovyzaColors.Text3,
                    modifier = Modifier.size(28.dp)
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            text = member.name,
            color = MovyzaColors.Text,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center
        )
        if (member.character.isNotBlank()) {
            Text(
                text = member.character,
                color = MovyzaColors.Text3,
                fontSize = 10.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center
            )
        }
    }
}
