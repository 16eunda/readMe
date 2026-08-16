package com.readme.externalfileinfo

import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
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
      val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          output.write(buffer, 0, read)
        }
        output.toByteArray()
      } ?: throw IllegalArgumentException("파일을 열 수 없습니다.")

      decodeText(bytes)
    }
  }

  private fun decodeText(bytes: ByteArray): String {
    if (bytes.size >= 2) {
      if (bytes[0] == 0xFF.toByte() && bytes[1] == 0xFE.toByte()) {
        return String(bytes, 2, bytes.size - 2, Charset.forName("UTF-16LE"))
      }
      if (bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte()) {
        return String(bytes, 2, bytes.size - 2, Charset.forName("UTF-16BE"))
      }
    }

    if (
      bytes.size >= 3 &&
      bytes[0] == 0xEF.toByte() &&
      bytes[1] == 0xBB.toByte() &&
      bytes[2] == 0xBF.toByte()
    ) {
      return String(bytes, 3, bytes.size - 3, Charsets.UTF_8)
    }

    val candidates = listOf("UTF-8", "MS949", "EUC-KR", "UTF-16LE", "UTF-16BE", "windows-1252")
    var bestText: String? = null
    var bestScore = Int.MIN_VALUE

    for (charsetName in candidates) {
      val decoded = decodeStrict(bytes, charsetName) ?: continue
      val sample = decoded.take(4000)
      val replacementPenalty = sample.count { it == '\uFFFD' } * 200
      val controlPenalty = sample.count { it.code < 32 && it != '\n' && it != '\t' && it != '\r' } * 20
      val koreanBonus = sample.count { it in '\uAC00'..'\uD7A3' } * 3
      val asciiBonus = sample.count { it.code in 32..126 }
      val score = koreanBonus + asciiBonus - replacementPenalty - controlPenalty

      if (score > bestScore) {
        bestScore = score
        bestText = decoded
      }
    }

    return bestText ?: String(bytes, Charset.forName("MS949"))
  }

  private fun decodeStrict(bytes: ByteArray, charsetName: String): String? {
    return try {
      Charset.forName(charsetName)
        .newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes))
        .toString()
    } catch (_: CharacterCodingException) {
      null
    } catch (_: IllegalArgumentException) {
      null
    }
  }
}
