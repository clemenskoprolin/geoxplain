"""Delayed, throttled stdout progress reporting for slow attribution imports.

Importing a :class:`~geoxplain.xia_result.XiaResultProtocol` bundle preprocesses
one grid per layer, which can take a while for large multi-frame results.
:class:`_DelayedLayerProgressReporter` prints a single, self-updating
``Processing layer N/total`` line — but only after an initial quiet period, so
fast imports stay silent.
"""

from __future__ import annotations

import sys
import threading
import time

_ATTRIBUTION_PROGRESS_INITIAL_DELAY_SECONDS = 30.0
_ATTRIBUTION_PROGRESS_UPDATE_INTERVAL_SECONDS = 15.0


class _DelayedLayerProgressReporter:
    def __init__(self, total_layers: int) -> None:
        self._total_layers = total_layers
        self._current_layer = 0
        self._active_layers = 0
        self._started_at = time.monotonic()
        self._last_emit_at: float | None = None
        self._has_emitted = False
        self._last_message_len = 0
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def __enter__(self) -> '_DelayedLayerProgressReporter':
        self.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.stop()

    def start(self) -> None:
        if self._total_layers <= 0 or self._thread is not None:
            return
        self._started_at = time.monotonic()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join()
        with self._lock:
            has_emitted = self._has_emitted
        if has_emitted:
            sys.stdout.write('\n')
            sys.stdout.flush()

    def begin_layer(self) -> None:
        with self._lock:
            if self._current_layer < self._total_layers:
                self._current_layer += 1
            self._active_layers += 1

    def finish_layer(self) -> None:
        with self._lock:
            self._active_layers = max(0, self._active_layers - 1)

    def _run(self) -> None:
        while not self._stop.is_set():
            wait_seconds = self._seconds_until_next_emit(time.monotonic())
            if self._stop.wait(wait_seconds):
                return
            if self._stop.is_set():
                return
            if not self._emit_if_due():
                self._stop.wait(0.1)

    def _seconds_until_next_emit(self, now: float) -> float:
        with self._lock:
            next_emit_at = (
                self._started_at + _ATTRIBUTION_PROGRESS_INITIAL_DELAY_SECONDS
                if self._last_emit_at is None
                else self._last_emit_at + _ATTRIBUTION_PROGRESS_UPDATE_INTERVAL_SECONDS
            )
        return max(0.0, next_emit_at - now)

    def _emit_if_due(self, now: float | None = None) -> bool:
        if now is None:
            now = time.monotonic()
        with self._lock:
            if (
                self._current_layer <= 0
                or self._total_layers <= 0
                or self._active_layers <= 0
            ):
                return False
            if self._last_emit_at is None:
                delay = _ATTRIBUTION_PROGRESS_INITIAL_DELAY_SECONDS
                if now - self._started_at < delay:
                    return False
            else:
                interval = _ATTRIBUTION_PROGRESS_UPDATE_INTERVAL_SECONDS
                if now - self._last_emit_at < interval:
                    return False
            self._last_emit_at = now
            current_layer = min(self._current_layer, self._total_layers)
            total_layers = self._total_layers
            prefix = '\r' if self._has_emitted else ''
            message = f'Processing layer {current_layer}/{total_layers}'
            padding = ' ' * max(0, self._last_message_len - len(message))
            self._has_emitted = True
            self._last_message_len = len(message)

        sys.stdout.write(f'{prefix}{message}{padding}')
        sys.stdout.flush()
        return True
