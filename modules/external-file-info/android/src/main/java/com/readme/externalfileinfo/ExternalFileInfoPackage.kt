package com.readme.externalfileinfo

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.util.Log
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import org.json.JSONArray
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
      ExternalLaunchIntentRegistry.markNewDelivery(intent)
      ExternalIntentLog.log(activity, "onNewIntent", intent)
    }
    // React Native와 다른 모듈도 이 Intent를 그대로 처리해야 하므로 소비하지 않는다.
    return false
  }

  override fun onDestroy(activity: Activity) {
    // 사용자가 Activity를 끝냈다면 이 태스크가 같은 Intent로 복원될 일이 없다.
    // 설정 변경 등으로 다시 만들어지는 경우(isFinishing=false)는 기록을 유지한다.
    if (activity.isFinishing) {
      ExternalLaunchIntentRegistry.forgetTask(activity)
    }
  }
}

/**
 * 외부 파일 Intent가 "새로 전달된 요청"인지, "이미 처리한 Intent를 다시 받은 것"인지 구분한다.
 *
 * Android는 Activity를 복원할 때(백그라운드에서 프로세스가 종료된 뒤 최근 앱/앱 전환으로 복귀,
 * 설정 변경으로 인한 재생성) 태스크를 처음 만든 Intent를 그대로 다시 넘긴다. 이때
 * FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY는 태스크 기록이 지워진 뒤 최근 앱에서 새로 시작할 때만 붙으므로,
 * 그 플래그만으로는 복원을 구분할 수 없다. JS가 Intent를 처리할 때 태스크 ID와 URI를 기록해 두고,
 * 같은 태스크에서 같은 URI가 다시 오면 복원으로 판단한다. onNewIntent로 들어온 Intent는 항상 새 요청이다.
 */
internal object ExternalLaunchIntentRegistry {
  private const val PREFS_NAME = "external_file_intent"
  private const val KEY_CLAIMED = "claimed"
  private const val MAX_CLAIMED = 20

  private val newDeliveries = mutableSetOf<String>()

  @Synchronized
  fun markNewDelivery(intent: Intent) {
    intent.dataString?.let { newDeliveries.add(it) }
  }

  /** 새로 전달된 Intent면 처리 대상으로 기록하고 true, 이미 처리했던 Intent면 false. */
  @Synchronized
  fun claim(activity: Activity, uri: String): Boolean {
    val key = "${activity.taskId}|$uri"
    val claimed = readClaimed(activity)
    val launchedFromHistory =
      (activity.intent?.flags ?: 0) and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0
    val isNewDelivery = when {
      newDeliveries.remove(uri) -> true
      launchedFromHistory -> false
      else -> !claimed.contains(key)
    }
    claimed.remove(key)
    claimed.add(key)
    writeClaimed(activity, claimed.takeLast(MAX_CLAIMED))
    return isNewDelivery
  }

  @Synchronized
  fun forgetTask(activity: Activity) {
    val prefix = "${activity.taskId}|"
    val claimed = readClaimed(activity)
    if (claimed.removeAll { it.startsWith(prefix) }) {
      writeClaimed(activity, claimed)
    }
  }

  private fun readClaimed(context: Context): MutableList<String> {
    val serialized = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_CLAIMED, null) ?: return mutableListOf()
    return runCatching {
      val array = JSONArray(serialized)
      MutableList(array.length()) { array.getString(it) }
    }.getOrElse { mutableListOf() }
  }

  private fun writeClaimed(context: Context, claimed: List<String>) {
    // 기록 직후 프로세스가 종료되어도 복원 판별이 가능하도록 동기 저장한다.
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_CLAIMED, JSONArray(claimed).toString())
      .commit()
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
