package com.readme.externalfileinfo

import android.content.ContentResolver
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.OpenableColumns
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction

class ExternalFileInfoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExternalFileInfo")

    AsyncFunction("getDisplayNameAsync") { uriString: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val uri = Uri.parse(uriString)

      context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { cursor ->
          val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (nameIndex >= 0 && cursor.moveToFirst()) {
            val displayName = cursor.getString(nameIndex)
            if (!displayName.isNullOrBlank()) {
              return@AsyncFunction displayName
            }
          }
        }

      null
    }

    AsyncFunction("readTextFileAsync") { uriString: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val uri = Uri.parse(uriString)
      val sample = context.contentResolver.openInputStream(uri)?.use(::readEncodingSample)
        ?: throw IllegalArgumentException("파일을 열 수 없습니다.")
      val encoding = detectTextEncoding(sample)

      context.contentResolver.openInputStream(uri)?.use { input ->
        skipFully(input, encoding.bomBytes)
        input.bufferedReader(Charset.forName(encoding.charsetName)).use { reader ->
          reader.readText()
        }
      } ?: throw IllegalArgumentException("파일을 열 수 없습니다.")
    }

    AsyncFunction("isGooglePlayInstallAsync") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val packageManager = context.packageManager
      val installerPackage = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        runCatching {
          packageManager.getInstallSourceInfo(context.packageName).installingPackageName
        }.getOrNull()
      } else {
        @Suppress("DEPRECATION")
        packageManager.getInstallerPackageName(context.packageName)
      }
      val playStoreEnabled = runCatching {
        packageManager.getApplicationInfo("com.android.vending", 0).enabled
      }.getOrDefault(false)

      installerPackage == "com.android.vending" && playStoreEnabled
    }

    // 외부 파일 Intent가 새로 전달된 요청이면 true. Activity 복원으로 이미 처리한 Intent를 다시 받은 경우 false.
    AsyncFunction("claimExternalIntentAsync") { uri: String ->
      // Activity 없이는 복원 여부를 판별할 근거가 없으므로 새 요청으로 취급하지 않는다.
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      ExternalLaunchIntentRegistry.claim(activity, uri)
    }

    // 개발 로그용: 현재 Activity Intent(onNewIntent로 최신화됨)의 전달 형태와 URI 읽기 권한
    AsyncFunction("getCurrentIntentInfoAsync") {
      val activity = appContext.currentActivity ?: return@AsyncFunction null
      val intent = activity.intent ?: return@AsyncFunction null
      val data = intent.data
      val clipUris = intent.clipData?.let { clip ->
        (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri?.toString() }
      } ?: emptyList()
      val readPermission = when {
        data == null -> "no-data"
        data.scheme != ContentResolver.SCHEME_CONTENT -> "not-content-uri"
        activity.checkUriPermission(
          data,
          Process.myPid(),
          Process.myUid(),
          Intent.FLAG_GRANT_READ_URI_PERMISSION,
        ) == PackageManager.PERMISSION_GRANTED -> "granted"
        else -> "denied"
      }

      mapOf(
        "action" to intent.action,
        "data" to intent.dataString,
        "mimeType" to intent.type,
        "flags" to "0x${Integer.toHexString(intent.flags)}",
        "grantReadUriFlag" to (intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0),
        "persistableGrantFlag" to (intent.flags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION != 0),
        "clipDataUris" to clipUris,
        "readPermission" to readPermission,
      )
    }

    AsyncFunction("clearCurrentIntentDataAsync") { expectedUri: String ->
      val activity = appContext.currentActivity
      val currentIntent = activity?.intent
      if (activity != null && currentIntent?.dataString == expectedUri) {
        activity.intent = Intent(currentIntent).apply {
          data = null
          clipData = null
        }
      }
      null
    }
  }

  private fun readEncodingSample(input: InputStream): ByteArray {
    val output = ByteArrayOutputStream(ENCODING_SAMPLE_SIZE)
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var remaining = ENCODING_SAMPLE_SIZE

    while (remaining > 0) {
      val read = input.read(buffer, 0, minOf(buffer.size, remaining))
      if (read < 0) break
      output.write(buffer, 0, read)
      remaining -= read
    }

    return output.toByteArray()
  }

  private fun skipFully(input: InputStream, byteCount: Int) {
    var remaining = byteCount
    while (remaining > 0) {
      val skipped = input.skip(remaining.toLong()).toInt()
      if (skipped > 0) {
        remaining -= skipped
      } else if (input.read() >= 0) {
        remaining -= 1
      } else {
        break
      }
    }
  }

  private fun detectTextEncoding(bytes: ByteArray): DetectedEncoding {
    if (bytes.size >= 2) {
      if (bytes[0] == 0xFF.toByte() && bytes[1] == 0xFE.toByte()) {
        return DetectedEncoding("UTF-16LE", 2)
      }
      if (bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte()) {
        return DetectedEncoding("UTF-16BE", 2)
      }
    }

    if (
      bytes.size >= 3 &&
      bytes[0] == 0xEF.toByte() &&
      bytes[1] == 0xBB.toByte() &&
      bytes[2] == 0xBF.toByte()
    ) {
      return DetectedEncoding("UTF-8", 3)
    }

    val sampleLength = bytes.size
    if (decodeStrictPrefix(bytes, sampleLength, "UTF-8") != null) {
      return DetectedEncoding("UTF-8", 0)
    }

    val candidates = listOf("MS949", "EUC-KR", "UTF-16LE", "UTF-16BE", "windows-1252")
    var bestCharset = "MS949"
    var bestScore = Int.MIN_VALUE

    for (charsetName in candidates) {
      val decoded = decodeStrictPrefix(bytes, sampleLength, charsetName) ?: continue
      val sample = decoded.take(4000)
      val controlPenalty = sample.count { it.code < 32 && it != '\n' && it != '\t' && it != '\r' } * 20
      val koreanBonus = sample.count { it in '\uAC00'..'\uD7A3' } * 3
      val asciiBonus = sample.count { it.code in 32..126 }
      val nullPenalty = sample.count { it == '\u0000' } * 100
      val score = koreanBonus + asciiBonus - controlPenalty - nullPenalty

      if (score > bestScore) {
        bestScore = score
        bestCharset = charsetName
      }
    }

    return DetectedEncoding(bestCharset, 0)
  }

  private fun decodeStrictPrefix(
    bytes: ByteArray,
    requestedLength: Int,
    charsetName: String,
  ): String? {
    // 샘플 끝이 멀티바이트 문자 중간일 수 있으므로 최대 3바이트를 줄여 재시도한다.
    for (trimmedBytes in 0..3) {
      val length = requestedLength - trimmedBytes
      if (length <= 0) break
      if (charsetName.startsWith("UTF-16") && length % 2 != 0) continue

      try {
        return Charset.forName(charsetName)
          .newDecoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
          .decode(ByteBuffer.wrap(bytes, 0, length))
          .toString()
      } catch (_: CharacterCodingException) {
        // 다음 길이로 재시도
      } catch (_: IllegalArgumentException) {
        return null
      }
    }

    return null
  }

  companion object {
    private const val ENCODING_SAMPLE_SIZE = 256 * 1024
  }

  private data class DetectedEncoding(
    val charsetName: String,
    val bomBytes: Int,
  )
}
