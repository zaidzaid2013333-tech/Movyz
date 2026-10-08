package com.movyza.app

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.movyza.app.data.Movie
import kotlin.math.min

object MovyzaColors {
    val Bg = Color(0xFF04081A)
    val Bg2 = Color(0xFF0A1230)
    val Navy500 = Color(0xFF14308A)
    val Gold300 = Color(0xFFF7DE9C)
    val Gold400 = Color(0xFFF2D48A)
    val Gold500 = Color(0xFFE3B864)
    val Gold600 = Color(0xFFD9A94A)
    val Gold700 = Color(0xFFC99A3E)
    val Text = Color(0xFFF6F2E8)
    val Text2 = Color(0xFFB6C0DE)
    val Text3 = Color(0xFF8C97BA)
    val Glass = Color(0x12FFFFFF)
    val Glass2 = Color(0x1AFFFFFF)
    val GlassStrong = Color(0xE60A1230)
    val GlassBorder = Color(0x29FFFFFF)
}

object MovyzaShapes {
    val Sm = RoundedCornerShape(12.dp)
    val Md = RoundedCornerShape(16.dp)
    val Lg = RoundedCornerShape(20.dp)
    val Xl = RoundedCornerShape(26.dp)
    val Nav = RoundedCornerShape(30.dp)
}

val MovyzaFontFamily = FontFamily.SansSerif

val MovyzaTitle = TextStyle(
    fontFamily = MovyzaFontFamily,
    fontWeight = FontWeight.SemiBold,
    color = MovyzaColors.Text
)

val MovyzaBody = TextStyle(
    fontFamily = MovyzaFontFamily,
    fontWeight = FontWeight.Normal,
    color = MovyzaColors.Text2
)

@Composable
fun MovyzaTheme(content: @Composable () -> Unit) {
    androidx.compose.material3.MaterialTheme(
        colorScheme = androidx.compose.material3.darkColorScheme(
            primary = MovyzaColors.Gold400,
            secondary = MovyzaColors.Gold500,
            tertiary = MovyzaColors.Navy500,
            background = MovyzaColors.Bg,
            surface = MovyzaColors.Bg2,
            surfaceVariant = MovyzaColors.GlassStrong,
            onPrimary = MovyzaColors.Bg,
            onBackground = MovyzaColors.Text,
            onSurface = MovyzaColors.Text
        ),
        typography = androidx.compose.material3.Typography(
            titleLarge = MovyzaTitle.copy(fontSize = 24.sp),
            titleMedium = MovyzaTitle.copy(fontSize = 18.sp),
            bodyLarge = MovyzaBody.copy(fontSize = 15.sp, lineHeight = 24.sp),
            bodyMedium = MovyzaBody.copy(fontSize = 13.sp, lineHeight = 21.sp),
            labelLarge = MovyzaTitle.copy(fontSize = 13.sp)
        ),
        content = content
    )
}

@Composable
fun MovyzaBackground(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit = {}) {
    Box(
        modifier
            .fillMaxSize()
            .background(MovyzaColors.Bg)
            .drawBehind {
                val goldCenter = androidx.compose.ui.geometry.Offset(size.width * 0.92f, size.height * 0.05f)
                val blueCenter = androidx.compose.ui.geometry.Offset(size.width * 0.50f, size.height * 0.54f)
                val goldRadius = min(size.width, size.height) * 0.78f
                val blueRadius = min(size.width, size.height) * 0.92f

                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(MovyzaColors.Gold600.copy(alpha = .18f), Color.Transparent),
                        center = goldCenter,
                        radius = goldRadius
                    ),
                    center = goldCenter,
                    radius = goldRadius
                )
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(MovyzaColors.Navy500.copy(alpha = .38f), Color.Transparent),
                        center = blueCenter,
                        radius = blueRadius
                    ),
                    center = blueCenter,
                    radius = blueRadius
                )
                drawRect(Color.White.copy(alpha = .012f))
            }
    ) { content() }
}

@Composable
fun GlassCard(
    modifier: Modifier = Modifier,
    shape: androidx.compose.ui.graphics.Shape = MovyzaShapes.Lg,
    strong: Boolean = false,
    border: Boolean = true,
    content: @Composable BoxScope.() -> Unit
) {
    Box(
        modifier
            .clip(shape)
            .background(if (strong) MovyzaColors.GlassStrong else MovyzaColors.Glass)
            .then(
                if (border) Modifier.border(
                    BorderStroke(1.dp, MovyzaColors.GlassBorder),
                    shape
                ) else Modifier
            )
            .drawBehind {
                drawRect(
                    Brush.verticalGradient(
                        listOf(Color.White.copy(alpha = .055f), Color.Transparent)
                    )
                )
            },
        content = content
    )
}

@Composable
fun GlassIconButton(
    onClick: () -> Unit,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    contentDescription: String,
    modifier: Modifier = Modifier,
    tint: Color = MovyzaColors.Text
) {
    androidx.compose.material3.Surface(
        modifier = modifier.size(46.dp),
        shape = CircleShape,
        color = MovyzaColors.Glass2,
        border = BorderStroke(1.dp, MovyzaColors.GlassBorder),
        onClick = onClick
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = contentDescription, tint = tint, modifier = Modifier.size(21.dp))
        }
    }
}

@Composable
fun GoldButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: Boolean = true
) {
    androidx.compose.material3.Surface(
        modifier = modifier.height(48.dp),
        shape = MovyzaShapes.Md,
        color = Color.Transparent,
        border = BorderStroke(1.dp, MovyzaColors.Gold300.copy(alpha = .18f)),
        onClick = onClick
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Brush.horizontalGradient(listOf(MovyzaColors.Gold300, MovyzaColors.Gold600)))
                .padding(horizontal = 18.dp),
            contentAlignment = Alignment.Center
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (icon) {
                    Icon(Icons.Outlined.PlayArrow, null, tint = MovyzaColors.Bg, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(7.dp))
                }
                Text(text, color = MovyzaColors.Bg, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            }
        }
    }
}

@Composable
fun GlassPill(
    text: String,
    modifier: Modifier = Modifier,
    active: Boolean = false,
    onClick: (() -> Unit)? = null
) {
    val background by animateColorAsState(
        if (active) MovyzaColors.Gold500.copy(alpha = .20f) else MovyzaColors.Glass,
        tween(220),
        label = "pill-bg"
    )
    if (onClick != null) {
        androidx.compose.material3.Surface(
            modifier = modifier,
            shape = RoundedCornerShape(999.dp),
            color = background,
            border = BorderStroke(
                1.dp,
                if (active) MovyzaColors.Gold500.copy(alpha = .46f) else MovyzaColors.GlassBorder
            ),
            onClick = onClick
        ) {
            Box(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), contentAlignment = Alignment.Center) {
                Text(
                    text,
                    color = if (active) MovyzaColors.Gold300 else MovyzaColors.Text2,
                    fontSize = 12.sp,
                    fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                    maxLines = 1
                )
            }
        }
    } else {
        androidx.compose.material3.Surface(
            modifier = modifier,
            shape = RoundedCornerShape(999.dp),
            color = background,
            border = BorderStroke(1.dp, MovyzaColors.GlassBorder)
        ) {
            Box(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), contentAlignment = Alignment.Center) {
                Text(
                    text,
                    color = if (active) MovyzaColors.Gold300 else MovyzaColors.Text2,
                    fontSize = 12.sp,
                    maxLines = 1
                )
            }
        }
    }
}

@Composable
fun SectionHeader(
    title: String,
    count: Int? = null,
    onAll: (() -> Unit)? = null
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, color = MovyzaColors.Text, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
            if (count != null) {
                Text(count.toString() + " نتيجة", color = MovyzaColors.Text3, fontSize = 10.sp)
            }
        }
        if (onAll != null) {
            Text(
                "الكل",
                color = MovyzaColors.Gold400,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 4.dp)
            )
        }
    }
}

@Composable
fun PosterCard(
    movie: Movie,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    rank: Int? = null
) {
    androidx.compose.material3.Surface(
        modifier = modifier,
        shape = MovyzaShapes.Md,
        color = Color.Transparent,
        border = BorderStroke(1.dp, MovyzaColors.GlassBorder),
        onClick = onClick
    ) {
        Column {
            Box(
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(0.67f)
                    .clip(MovyzaShapes.Md)
            ) {
                AsyncImage(
                    model = movie.posterUrl,
                    contentDescription = movie.title,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
                Box(
                    Modifier
                        .align(Alignment.TopStart)
                        .padding(7.dp)
                ) {
                    GlassPill("★ " + String.format("%.1f", movie.rating))
                }
                if (rank != null) {
                    Text(
                        rank.toString().padStart(2, '0'),
                        color = Color.White.copy(alpha = .18f),
                        fontSize = 44.sp,
                        fontWeight = FontWeight.Black,
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .padding(start = 7.dp, bottom = 1.dp)
                    )
                }
            }
            Text(
                movie.title.ifBlank { movie.originalTitle },
                color = MovyzaColors.Text,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp)
            )
        }
    }
}

@Composable
fun ProgressRing(progress: Float, modifier: Modifier = Modifier, size: Int = 44) {
    Canvas(modifier.then(Modifier.size(size.dp))) {
        val stroke = 3.dp.toPx()
        drawArc(
            color = Color.White.copy(alpha = .16f),
            startAngle = -90f,
            sweepAngle = 360f,
            useCenter = false,
            style = androidx.compose.ui.graphics.drawscope.Stroke(width = stroke, cap = StrokeCap.Round)
        )
        drawArc(
            brush = Brush.sweepGradient(listOf(MovyzaColors.Gold300, MovyzaColors.Gold600)),
            startAngle = -90f,
            sweepAngle = 360f * progress.coerceIn(0f, 1f),
            useCenter = false,
            style = androidx.compose.ui.graphics.drawscope.Stroke(width = stroke, cap = StrokeCap.Round)
        )
    }
}

@Composable
fun ShimmerBox(modifier: Modifier) {
    val transition = rememberInfiniteTransition(label = "shimmer")
    val alpha by transition.animateFloat(
        .30f,
        .62f,
        infiniteRepeatable(tween(850, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "shimmer-alpha"
    )
    Box(
        modifier
            .clip(MovyzaShapes.Md)
            .background(Color.White.copy(alpha = alpha))
    )
}

@Composable
fun AnimatedPressScale(content: @Composable () -> Unit) {
    val scale by animateFloatAsState(1f, tween(180), label = "press-scale")
    Box(Modifier.scale(scale)) { content() }
}
