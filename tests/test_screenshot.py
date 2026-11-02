import json
import urllib.request
from pathlib import Path

import numpy as np
import pytest

import geoxplain
from geoxplain import GeoXplainWidget, GeoXplain


def _array(value: float = 1.0) -> np.ndarray:
    return np.full((2, 4), value, dtype=np.float32)


def _viewer_data_url(index_url: str) -> str:
    return index_url.rsplit('/', 1)[0] + '/viewer_data.json'


def test_viewer_screenshot_uses_default_path_and_dimensions(monkeypatch, tmp_path):
    calls = {}

    def fake_capture(payload, out_path, *, width, height, timeout, launch_state=None):
        calls.update({
            'payload': payload,
            'out_path': Path(out_path),
            'width': width,
            'height': height,
            'timeout': timeout,
            'launch_state': launch_state,
        })
        Path(out_path).write_bytes(b'png')
        return Path(out_path)

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr('geoxplain.viewer.capture_viewer_screenshot', fake_capture)

    viewer = GeoXplain(out_path=str(tmp_path / 'viewer_data.json'))
    viewer.add_attribution(_array(), pressure_level=850)

    path = viewer.screenshot(timeout=12.5)

    assert path == calls['out_path']
    assert path.parent == Path('screenshots')
    assert path.name.startswith('geoxplain-screenshot-')
    assert calls['width'] == 1100
    assert calls['height'] == 820
    assert calls['timeout'] == 12.5
    assert calls['launch_state'] is None
    assert calls['payload']['methods']


def test_viewer_screenshot_custom_path_dimensions_and_launch_state(monkeypatch, tmp_path):
    calls = {}

    def fake_capture(payload, out_path, *, width, height, timeout, launch_state=None):
        calls.update({
            'out_path': Path(out_path),
            'width': width,
            'height': height,
            'launch_state': launch_state,
        })
        Path(out_path).write_bytes(b'png')
        return Path(out_path)

    monkeypatch.setattr('geoxplain.viewer.capture_viewer_screenshot', fake_capture)
    viewer = GeoXplain(out_path=str(tmp_path / 'viewer_data.json'))
    viewer.add_attribution(_array(), pressure_level=850)
    launch_state = {'selectedMethod': 'saliency'}

    path = viewer.screenshot(
        tmp_path / 'custom.png',
        width=640,
        height=360,
        output_dir=tmp_path / 'ignored',
        launch_state=launch_state,
    )

    assert path == tmp_path / 'custom.png'
    assert calls['out_path'] == tmp_path / 'custom.png'
    assert calls['width'] == 640
    assert calls['height'] == 360
    assert calls['launch_state'] is launch_state


def test_viewer_open_serves_current_export_and_closes(tmp_path):
    viewer = GeoXplain(out_path=tmp_path / 'viewer_data.json')
    viewer.add_attribution(_array(), pressure_level=850)

    handle = viewer.open(open_browser=False)
    try:
        assert handle.url.startswith('http://127.0.0.1:')
        with urllib.request.urlopen(_viewer_data_url(handle.url), timeout=2.0) as response:
            payload = json.loads(response.read())

        assert payload['appTitle'] == 'GeoXplain'
        assert payload['methods']
    finally:
        handle.close()

    handle.close()


def test_viewer_open_can_launch_webbrowser(monkeypatch, tmp_path):
    opened = []
    monkeypatch.setattr('geoxplain.viewer.webbrowser.open', lambda url: opened.append(url) or True)

    viewer = GeoXplain(out_path=tmp_path / 'viewer_data.json')
    viewer.add_attribution(_array(), pressure_level=850)

    handle = viewer.open()
    try:
        assert opened == [handle.url]
    finally:
        handle.close()


def test_widget_browser_export_uses_packaged_browser_bundle(monkeypatch, tmp_path):
    # config_dir treats absolute paths as Jupyter server-relative (deferred
    # until page context arrives), so a plain unit test must use a relative
    # path, which resolves from the kernel working directory.
    monkeypatch.chdir(tmp_path)
    export_dir = tmp_path / 'browser-export'
    widget = GeoXplainWidget(config_dir='browser-export')
    try:
        widget.add_attribution({'z-2': _array()}, method='Saliency')

        browser_config = dict(widget.browser_config)
        assert browser_config['enabled'] is True
        assert browser_config['href'].startswith('http://127.0.0.1:')
        assert 'live=1' in browser_config['href']

        assert (export_dir / 'index.html').exists()
        assert (export_dir / 'assets' / 'index.js').exists()
        assert (export_dir / 'assets' / 'index.css').exists()

        with (export_dir / 'viewer_data.json').open(encoding='utf-8') as handle:
            payload = json.load(handle)
        assert payload['methods']
        package_static = Path(geoxplain.__file__).parent / 'static'
        assert not (package_static / 'viewer_data.json').exists()
    finally:
        widget.close()


def test_widget_screenshot_uses_reported_surface_and_launch_state(monkeypatch, tmp_path):
    calls = {}

    def fake_capture(payload, out_path, *, width, height, timeout, launch_state=None):
        calls.update({
            'payload': payload,
            'out_path': Path(out_path),
            'width': width,
            'height': height,
            'timeout': timeout,
            'launch_state': launch_state,
        })
        Path(out_path).write_bytes(b'png')
        return Path(out_path)

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr('geoxplain.widget.capture_viewer_screenshot', fake_capture)
    monkeypatch.setattr(GeoXplainWidget, '_refresh_browser_export', lambda self, payload=None: None)

    widget = GeoXplainWidget(height=620)
    try:
        widget.add_attribution({'z-2': _array()}, method='Saliency')
        launch_state = {
            'selectedMethod': 'saliency',
            'timestampIndex': 0,
            'viewMode': 'map',
            'mapType': 'topo',
        }
        widget._handle_frontend_message(
            widget,
            {
                'kind': 'geoxplain:viewer_state',
                'launchState': launch_state,
                'surface': {'width': 777.2, 'height': 333.4},
                'ready': True,
            },
            [],
        )

        path = widget.screenshot(output_dir=tmp_path / 'shots', timeout=4.0)

        assert path == calls['out_path']
        assert path.parent == tmp_path / 'shots'
        assert calls['width'] == 777
        assert calls['height'] == 333
        assert calls['timeout'] == 4.0
        assert calls['launch_state'] is launch_state
        assert calls['payload']['methods']
        assert widget._last_viewer_ready is True
    finally:
        widget.close()


def test_widget_screenshot_falls_back_to_widget_height(monkeypatch, tmp_path):
    calls = {}

    def fake_capture(payload, out_path, *, width, height, timeout, launch_state=None):
        calls.update({'width': width, 'height': height, 'launch_state': launch_state})
        Path(out_path).write_bytes(b'png')
        return Path(out_path)

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr('geoxplain.widget.capture_viewer_screenshot', fake_capture)
    monkeypatch.setattr(GeoXplainWidget, '_refresh_browser_export', lambda self, payload=None: None)

    widget = GeoXplainWidget(height=512)
    try:
        widget.add_attribution({'z-2': _array()}, method='Saliency')
        widget.screenshot(output_dir=tmp_path)

        assert calls['width'] == 1100
        assert calls['height'] == 512
        assert calls['launch_state'] is None
    finally:
        widget.close()


def test_browser_launch_state_cameras_survive_initial_data_load(tmp_path):
    playwright_api = pytest.importorskip('playwright.sync_api')
    from geoxplain._screenshot import _ScreenshotServer, _screenshot_url
    from geoxplain._static_server import _copy_browser_bundle, _write_json_atomic

    viewer = GeoXplain(target_color='#00ff00')
    viewer.add_attribution(
        _array(),
        pressure_level=850,
        target={'lat': 30, 'lon': 120},
    )
    viewer.add_overlay(_array(), name='Launch Overlay', colormap='viridis')
    viewer.add_overlay(_array(), name='Hidden Overlay', colormap='viridis')
    launch_state = {
        'selectedMethod': 'saliency',
        'timestampIndex': 0,
        'viewMode': 'map',
        'mapType': 'topo',
        'pressureLevels': [{'id': 'z-2', 'visible': True, 'opacity': 1.0}],
        'smoothImportedGrids': True,
        'smoothImportedGridSigma': 0.5,
        'overlayLayerStates': [
            {
                'slug': 'launch-overlay',
                'visible': True,
                'opacity': 0.25,
                'colormap': 'plasma',
                'stretchLow': 0.2,
                'stretchHigh': 0.8,
            },
            {
                'slug': 'hidden-overlay',
                'visible': False,
                'opacity': 0.4,
                'colormap': 'thermal',
                'stretchLow': 0.1,
                'stretchHigh': 0.9,
            },
        ],
        'globeCamera': {'lat': 30, 'lng': 120, 'altitude': 1.5},
        'mapCamera': {'lng': 120, 'lat': 30, 'zoom': 3, 'pitch': 0},
    }

    bundle_dir = tmp_path / 'browser'
    _copy_browser_bundle(bundle_dir, hint='Build the frontend browser bundle.')
    _write_json_atomic(bundle_dir / 'viewer_data.json', viewer._build_payload())
    server = _ScreenshotServer(bundle_dir)

    try:
        with playwright_api.sync_playwright() as playwright:
            try:
                browser = playwright.chromium.launch(
                    args=['--use-gl=angle', '--use-angle=swiftshader'],
                )
            except playwright_api.Error as exc:
                pytest.skip(f'Playwright Chromium is unavailable: {exc}')

            try:
                page = browser.new_page(
                    viewport={'width': 1100, 'height': 820},
                    device_scale_factor=1,
                )
                page.goto(
                    _screenshot_url(server.href, launch_state),
                    wait_until='load',
                    timeout=15_000,
                )
                page.wait_for_selector(
                    '[data-geoxplain-viewer-ready="true"]',
                    timeout=15_000,
                )

                # The bug's auto-fit flight lasted 1200 ms. Waiting past it
                # ensures this checks the stable camera, not its starting frame.
                page.wait_for_timeout(1400)
                position = page.locator(
                    '[data-geoxplain-renderer-layer="map"] svg circle',
                ).evaluate(
                    """(circle) => {
                      const svg = circle.ownerSVGElement
                      const rect = svg.getBoundingClientRect()
                      return {
                        cx: Number(circle.getAttribute('cx')),
                        cy: Number(circle.getAttribute('cy')),
                        width: rect.width,
                        height: rect.height,
                        display: circle.getAttribute('display'),
                      }
                    }"""
                )
                overlay_state = page.locator(
                    '[data-geoxplain-overlay-slug="launch-overlay"]',
                ).evaluate(
                    """(row) => {
                      const handles = row.querySelectorAll(
                        '[title^="Drag handles"] > div',
                      )
                      return {
                        visible: row.querySelector('[role="switch"]')?.getAttribute('aria-checked'),
                        opacity: row.querySelector('.pl-8.mb-2 .font-mono')?.textContent,
                        colormap: row.querySelector('button[aria-pressed="true"]')?.getAttribute('aria-label'),
                        stretchLow: handles[1]?.style.left,
                        stretchHigh: handles[2]?.style.left,
                      }
                    }"""
                )
                hidden_overlay_visible = page.locator(
                    '[data-geoxplain-overlay-slug="hidden-overlay"] [role="switch"]',
                ).get_attribute('aria-checked')

                globe_launch_state = {**launch_state, 'viewMode': 'globe'}
                page.goto(
                    _screenshot_url(server.href, globe_launch_state),
                    wait_until='load',
                    timeout=15_000,
                )
                page.wait_for_selector(
                    '[data-geoxplain-viewer-ready="true"]',
                    timeout=15_000,
                )
                page.wait_for_timeout(1400)
                globe_marker = page.locator(
                    '[data-geoxplain-renderer-layer="globe"] canvas',
                ).evaluate(
                    """(source) => {
                      const copy = document.createElement('canvas')
                      copy.width = source.width
                      copy.height = source.height
                      const context = copy.getContext('2d')
                      context.drawImage(source, 0, 0)
                      const { data, width, height } = context.getImageData(
                        0, 0, copy.width, copy.height,
                      )
                      let count = 0
                      let sumX = 0
                      let sumY = 0
                      for (let y = 0; y < height; y += 1) {
                        for (let x = 0; x < width; x += 1) {
                          const i = 4 * (y * width + x)
                          if (data[i] < 80 && data[i + 1] > 180 && data[i + 2] < 100) {
                            count += 1
                            sumX += x
                            sumY += y
                          }
                        }
                      }
                      return {
                        count,
                        cx: sumX / count,
                        cy: sumY / count,
                        width,
                        height,
                      }
                    }"""
                )
            finally:
                browser.close()
    finally:
        server.close()

    assert position['display'] != 'none'
    assert position['cx'] == pytest.approx(position['width'] / 2, abs=2)
    assert position['cy'] == pytest.approx(position['height'] / 2, abs=2)
    assert overlay_state == {
        'visible': 'true',
        'opacity': '25%',
        'colormap': 'Plasma',
        'stretchLow': '20%',
        'stretchHigh': '80%',
    }
    assert hidden_overlay_visible == 'false'
    assert globe_marker['count'] > 20
    assert globe_marker['cx'] == pytest.approx(globe_marker['width'] / 2, abs=3)
    assert globe_marker['cy'] == pytest.approx(globe_marker['height'] / 2, abs=3)


def test_browser_selects_custom_palette_when_overlay_definition_changes(tmp_path):
    playwright_api = pytest.importorskip('playwright.sync_api')
    from geoxplain._screenshot import _ScreenshotServer
    from geoxplain._static_server import _copy_browser_bundle, _write_json_atomic

    viewer = GeoXplain()
    viewer.add_attribution(_array(), pressure_level=850)
    viewer.add_overlay(_array(), name='Weather Field', colormap='viridis')

    bundle_dir = tmp_path / 'browser'
    _copy_browser_bundle(bundle_dir, hint='Build the frontend browser bundle.')
    _write_json_atomic(bundle_dir / 'viewer_data.json', viewer._build_payload())
    server = _ScreenshotServer(bundle_dir)

    try:
        with playwright_api.sync_playwright() as playwright:
            try:
                browser = playwright.chromium.launch(
                    args=['--use-gl=angle', '--use-angle=swiftshader'],
                )
            except playwright_api.Error as exc:
                pytest.skip(f'Playwright Chromium is unavailable: {exc}')

            try:
                page = browser.new_page(
                    viewport={'width': 1100, 'height': 820},
                    device_scale_factor=1,
                )
                page.goto(server.href, wait_until='load', timeout=15_000)
                page.wait_for_selector(
                    '[data-geoxplain-viewer-ready="true"]',
                    timeout=15_000,
                )
                row = page.locator(
                    '[data-geoxplain-overlay-slug="weather-field"]',
                )
                assert row.locator('button[aria-pressed]').evaluate_all(
                    '(buttons) => buttons.map((button) => button.getAttribute("aria-label"))'
                ) == ['Viridis', 'Plasma', 'Thermal', 'Seq.']

                viewer.add_overlay(
                    _array(),
                    name='Weather Field',
                    colormap=[(0.0, '#2166ac'), (0.5, '#f7f7f7'), (1.0, '#b2182b')],
                )
                _write_json_atomic(
                    bundle_dir / 'viewer_data.json',
                    viewer._build_payload(),
                )

                custom_button = row.locator(
                    'button[aria-label="Custom"][aria-pressed="true"]',
                )
                custom_button.wait_for(timeout=10_000)
                assert row.locator('button[aria-pressed]').evaluate_all(
                    '(buttons) => buttons.map((button) => button.getAttribute("aria-label"))'
                ) == ['Viridis', 'Plasma', 'Thermal', 'Custom']
            finally:
                browser.close()
    finally:
        server.close()
