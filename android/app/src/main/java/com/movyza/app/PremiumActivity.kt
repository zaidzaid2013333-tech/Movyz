package com.movyza.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier

class PremiumActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MovyzaTheme {
                Surface(Modifier.fillMaxSize(), color = MovyzaColors.Bg) {
                    MovyzaNativeApp()
                }
            }
        }
    }
}
