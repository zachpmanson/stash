-include .env

ANDROID_HOME ?= $(HOME)/Library/Android/sdk
export ANDROID_HOME

APK := android/app/build/outputs/apk/release/app-release.apk
APP_ID := com.zachmanson.stash
LAUNCH_ACTIVITY := $(APP_ID)/.MainActivity

.PHONY: build deploy devices

build:
	pnpm prebuild
	cd android && ./gradlew assembleRelease

devices:
	@adb devices

# Installs on your phone and launches the app. Auto-detects the phone by
# excluding any emulator-* serial and preferring the device's stable mDNS
# serial (adb-<serial>._adb-tls-connect._tcp) over its host:port alias, since
# the host:port form changes whenever wireless debugging reconnects.
# Override with: make deploy DEVICE=<serial> (also settable via .env)
deploy: build
	@if [ -n "$(DEVICE)" ]; then \
		TARGET="$(DEVICE)"; \
	else \
		CANDIDATES=$$(adb devices | awk 'NR>1 && $$2=="device" {print $$1}' | grep -v '^emulator-'); \
		TARGET=$$(printf '%s\n' "$$CANDIDATES" | grep '_adb-tls-connect\._tcp$$' | head -1); \
		if [ -z "$$TARGET" ]; then TARGET=$$(printf '%s\n' "$$CANDIDATES" | head -1); fi; \
	fi; \
	if [ -z "$$TARGET" ]; then \
		echo "No physical device found. Connect your phone (USB or wireless debugging) and try again." >&2; exit 1; \
	fi; \
	echo "==> Deploying to $$TARGET"; \
	adb -s "$$TARGET" install -r $(APK) && adb -s "$$TARGET" shell am start -n $(LAUNCH_ACTIVITY)
