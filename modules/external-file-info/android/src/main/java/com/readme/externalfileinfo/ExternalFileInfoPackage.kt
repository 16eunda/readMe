package com.readme.externalfileinfo

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.util.Log
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import java.lang.ref.WeakReference

class ExternalFileInfoPackage : Package {
  override fun createReactActivityLifecycleListeners(
    activityContext: Context,
  ): List<ReactActivityLifecycleListener> {
    val activity = activityContext as? Activity ?: return emptyList()
    return listOf(ExternalFileIntentLifecycleListener(activity))
  }
}

/**
 * singleTask Activity로 다시 들어온 Intent를 Activity의 "현재 Intent"로 반영한다.
 *
 * React Native는 onNewIntent를 받았을 때 JS가 준비되어 있으면 `url` 이벤트로 넘기지만,
 * 백그라운드에서 앱 프로세스가 종료된 뒤 기존 태스크로 재실행되는 경우처럼 JS가 아직 로드 중이면
 * "Tried to access onNewIntent while context is not ready"로 Intent를 버린다.
 * 게다가 Activity.setIntent를 호출하지 않으므로 이후 Linking.getInitialURL()은
 * 태스크를 처음 만든 이전 Intent(런처 실행 또는 예전에 연 파일)를 돌려준다.
 * 최신 Intent를 여기서 반영해 두면 JS가 늦게 준비되어도 방금 선택한 파일을 읽을 수 있다.
 */
private class ExternalFileIntentLifecycleListener(activity: Activity) : ReactActivityLifecycleListener {
  private val activityRef = WeakReference(activity)

  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    ExternalIntentLog.log(activity, "onCreate", activity.intent)
  }

  override fun onNewIntent(intent: Intent?): Boolean {
    val activity = activityRef.get() ?: return false
    if (intent != null) {
      activity.intent = intent
      ExternalIntentLog.log(activity, "onNewIntent", intent)
    }
    // React Native와 다른 모듈도 이 Intent를 그대로 처리해야 하므로 소비하지 않는다.
    return false
  }
}

internal object ExternalIntentLog {
  private const val TAG = "ExternalFileIntent"

  fun log(context: Context, callback: String, intent: Intent?) {
    if (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) return
    if (intent == null) return
    val clipUris = intent.clipData?.let { clip ->
      (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri?.toString() }
    } ?: emptyList()
    Log.i(
      TAG,
      "[$callback] action=${intent.action} data=${intent.dataString} mimeType=${intent.type} " +
        "flags=0x${Integer.toHexString(intent.flags)} clipData=$clipUris",
    )
  }
}
