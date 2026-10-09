package com.movyza.app

import com.movyza.app.data.UserSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * Native email verification and recovery calls for Supabase Auth.
 * Public/publishable keys are the only client credentials used here.
 * No service-role key is accepted or stored by this class.
 */
class NativeAuthClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val authBase: String
        get() = BuildConfig.SUPABASE_URL.trimEnd('/') + "/auth/v1"

    suspend fun resendSignupCode(email: String) {
        request(
            "/resend",
            JSONObject()
                .put("type", "signup")
                .put("email", normalizedEmail(email))
        )
    }

    suspend fun verifySignupCode(email: String, token: String): UserSession {
        val response = request(
            "/verify",
            JSONObject()
                .put("type", "signup")
                .put("email", normalizedEmail(email))
                .put("token", token.trim())
        )
        return response.toUserSession()
    }

    suspend fun requestPasswordReset(email: String) {
        val redirect = URLEncoder.encode("https://movyza.sbs/reset-password", Charsets.UTF_8.name())
        request(
            "/recover?redirect_to=$redirect",
            JSONObject().put("email", normalizedEmail(email))
        )
    }

    suspend fun resetPasswordWithCode(email: String, token: String, newPassword: String) {
        val verification = request(
            "/verify",
            JSONObject()
                .put("type", "recovery")
                .put("email", normalizedEmail(email))
                .put("token", token.trim())
        )
        val accessToken = verification.optString("access_token")
            .takeIf { it.isNotBlank() }
            ?: throw IOException("otp_expired: لم يُرجع التحقق جلسة صالحة. اطلب رمز استعادة جديدًا.")

        request(
            "/user",
            JSONObject().put("password", newPassword),
            accessToken = accessToken,
            method = "PUT"
        )
    }

    private suspend fun request(
        endpoint: String,
        payload: JSONObject,
        accessToken: String? = null,
        method: String = "POST"
    ): JSONObject = withContext(Dispatchers.IO) {
        val base = BuildConfig.SUPABASE_URL.trimEnd('/')
        val publishableKey = BuildConfig.SUPABASE_ANON_KEY
        if (base.isBlank() || publishableKey.isBlank()) {
            throw IOException("auth_not_configured: خدمة الحسابات غير مهيأة في هذه النسخة.")
        }

        val url = "$authBase$endpoint"
        val requestBody = payload.toString().toRequestBody(jsonType)
        val builder = Request.Builder()
            .url(url)
            .header("apikey", publishableKey)
            .header("Authorization", "Bearer ${accessToken ?: publishableKey}")
            .header("Accept", "application/json")

        when (method) {
            "PUT" -> builder.put(requestBody)
            else -> builder.post(requestBody)
        }

        client.newCall(builder.build()).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            val result = runCatching { JSONObject(raw.ifBlank { "{}" }) }
                .getOrElse { JSONObject() }
            if (!response.isSuccessful) {
                val code = result.optString(
                    "code",
                    result.optString("error_code", result.optString("error", "auth_error"))
                )
                val detail = result.optString(
                    "msg",
                    result.optString("message", result.optString("error_description", ""))
                )
                throw IOException("$code: $detail (HTTP ${response.code})")
            }
            result
        }
    }

    private fun JSONObject.toUserSession(): UserSession {
        val accessToken = optString("access_token")
            .takeIf { it.isNotBlank() }
            ?: throw IOException("email_not_confirmed: لم يكتمل تأكيد البريد. تحقق من الرمز وحاول مرة أخرى.")
        val user = optJSONObject("user") ?: JSONObject()
        val userId = user.optString("id")
        val email = user.optString("email")
        if (userId.isBlank()) {
            throw IOException("auth_session_missing_user: تحقق من البريد ثم سجّل الدخول من جديد.")
        }
        return UserSession(accessToken, userId, email)
    }

    private fun normalizedEmail(email: String) = email.trim().lowercase()
}
