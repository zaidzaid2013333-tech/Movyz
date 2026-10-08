package com.movyza.app.ramuscanary;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.view.Gravity;
import android.widget.TextView;

public final class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TextView view = new TextView(this);
        view.setText("Movyza Ramus canary");
        view.setTextColor(Color.WHITE);
        view.setTextSize(24f);
        view.setGravity(Gravity.CENTER);
        view.setBackgroundColor(Color.BLACK);
        setContentView(view);
    }
}
