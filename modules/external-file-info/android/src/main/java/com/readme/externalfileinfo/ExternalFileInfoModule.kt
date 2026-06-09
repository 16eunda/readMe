package com.readme.externalfileinfo

import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

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
  }
}
