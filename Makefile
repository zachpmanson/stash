-include .env

ANDROID_HOME ?= $(HOME)/android-sdk
export ANDROID_HOME

APK := android/app/build/outputs/apk/release/app-release.apk
APP_ID := com.zachmanson.stash
ACTIVITY := $(APP_ID)/.MainActivity

.PHONY: build deploy clean format typecheck dev devices connect

build:
	pnpm prebuild
	cd android && ./gradlew assembleRelease

format:
	cd android && ./gradlew lint

clean:
	cd android && ./gradlew clean

typecheck:
dev:
	pnpm start

include $(HOME)/beltino/scripts/android-deploy.mk
