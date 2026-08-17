-include .env

ANDROID_HOME ?= $(HOME)/android-sdk
export ANDROID_HOME

APK := android/app/build/outputs/apk/release/app-release.apk
DEBUG_APK := android/app/build/outputs/apk/debug/app-debug.apk
APP_ID := com.zachmanson.stash
DEBUG_APP_ID := $(APP_ID).debug
ACTIVITY := $(APP_ID)/.MainActivity

.PHONY: build debug deploy clean format typecheck dev devices connect

# Default to all ABIs (large APK). Override for a single ABI, e.g.:
#   make build ABI=arm64-v8a
#   make debug ABI=arm64-v8a
ABI ?= all
ARCH_ARGS := $(if $(filter all,$(ABI)),,-PreactNativeArchitectures=$(ABI))

build:
	pnpm prebuild
	cd android && ./gradlew assembleRelease $(ARCH_ARGS)

debug:
	pnpm prebuild
	cd android && ./gradlew assembleDebug $(ARCH_ARGS)

deploy-debug: debug
	adb install -r $(DEBUG_APK)
	adb shell am start -n $(DEBUG_APP_ID)/.MainActivity

format:
	cd android && ./gradlew lint

clean:
	cd android && ./gradlew clean

typecheck:
dev:
	pnpm start

include $(HOME)/beltino/scripts/android-deploy.mk
